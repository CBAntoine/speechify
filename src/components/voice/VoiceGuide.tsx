"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationClientTool,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { Icon } from "@/components/icons";
import { CATEGORIES, LOCATIONS, isPlaced, locationById, regionById } from "@/lib/data";
import { mapStore, useMapStore } from "@/lib/map-store";
import { longDate } from "@/lib/format";
import { SITE } from "@/lib/site";
import { makeVoiceTools } from "./voice-tools";

type Line = { id: number; role: "user" | "agent" | "tool" | "system"; text: string };

type SessionResponse =
  | {
      ok: true;
      tier: "free" | "crew";
      remaining: number;
      limit: number;
      auth: { conversationToken: string } | { signedUrl: string } | { agentId: string };
    }
  | { ok: false; error: "quota" | "unconfigured" | "upstream"; message: string; tier?: "free" | "crew"; limit?: number };

const QUICK_PROMPTS = [
  "Where's the egg nest?",
  "Zoom into Ocean Drive",
  "Route me from the egg nest to the rooftop sweep",
  "What's new in Leonida today?",
];

export default function VoiceGuide() {
  return (
    <ConversationProvider>
      <VoiceDock />
    </ConversationProvider>
  );
}

function useLines() {
  const [lines, setLines] = useState<Line[]>([]);
  const nextId = useRef(1);
  const push = useCallback((role: Line["role"], text: string) => {
    setLines((prev) => {
      const last = prev[prev.length - 1];
      // The SDK can echo a typed message back as a user transcript; drop the duplicate.
      if (last && last.role === role && last.text === text) return prev;
      return [...prev.slice(-60), { id: nextId.current++, role, text }];
    });
  }, []);
  return { lines, push, clear: () => setLines([]) };
}

function VoiceDock() {
  const open = useMapStore((s) => s.voiceOpen);
  const selectedId = useMapStore((s) => s.selectedId);
  const selectedRegion = useMapStore((s) => s.selectedRegion);
  const { startSession, endSession, sendUserMessage, sendContextualUpdate, getInputVolume, getOutputVolume } =
    useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { isMuted, setMuted } = useConversationInput();
  const { lines, push, clear } = useLines();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "quota" | "error" | "info"; text: string } | null>(null);
  const [mode, setMode] = useState<"voice" | "text" | null>(null);
  const [quota, setQuota] = useState<{ remaining: number; limit: number; tier: "free" | "crew" } | null>(null);
  const pendingText = useRef<string | null>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const connected = status === "connected";
  const connecting = status === "connecting" || busy;

  // ── client tools ──
  const tools = useMemo(() => makeVoiceTools((t) => push("tool", t)), [push]);
  // Dev only: lets automated checks drive the exact handlers the agent calls.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") (window as unknown as { __neonTools?: typeof tools }).__neonTools = tools;
  }, [tools]);
  useConversationClientTool("show_location", tools.show_location);
  useConversationClientTool("search_map", tools.search_map);
  useConversationClientTool("focus_region", tools.focus_region);
  useConversationClientTool("get_latest_news", tools.get_latest_news);
  useConversationClientTool("get_tips", tools.get_tips);
  useConversationClientTool("reset_map", tools.reset_map);
  useConversationClientTool("go_to_place", tools.go_to_place);
  useConversationClientTool("plan_route", tools.plan_route);

  // Keep the agent aware of what the user is looking at.
  useEffect(() => {
    if (!connected) return;
    const loc = locationById(selectedId);
    const region = regionById(selectedRegion);
    if (loc) {
      sendContextualUpdate(
        `The user is now viewing the pin "${loc.name}" (id ${loc.id}, ${CATEGORIES[loc.category].label}, ${loc.confidence}).`,
      );
    } else if (region) {
      sendContextualUpdate(`The user is now viewing the region ${region.name} (id ${region.id}).`);
    }
  }, [connected, selectedId, selectedRegion, sendContextualUpdate]);

  // Orb reacts to live audio levels.
  useEffect(() => {
    if (!connected || mode !== "voice") {
      orbRef.current?.style.setProperty("--level", "0");
      return;
    }
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const level = Math.max(getOutputVolume?.() ?? 0, (getInputVolume?.() ?? 0) * 0.8);
      smooth = smooth * 0.75 + Math.min(1, level * 1.6) * 0.25;
      orbRef.current?.style.setProperty("--level", smooth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [connected, mode, getInputVolume, getOutputVolume]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  // "Ask Sol about this" buttons elsewhere on the page.
  useEffect(() => {
    const onAsk = (e: Event) => {
      const text = (e as CustomEvent<{ text: string }>).detail?.text;
      if (!text) return;
      mapStore.setVoiceOpen(true);
      void ask(text);
    };
    window.addEventListener("na:ask", onAsk);
    return () => window.removeEventListener("na:ask", onAsk);
  });

  async function begin(nextMode: "voice" | "text") {
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      const data = (await res.json()) as SessionResponse;
      if (!data.ok) {
        setNotice({ kind: data.error === "quota" ? "quota" : "error", text: data.message });
        pendingText.current = null;
        return;
      }
      setQuota({ remaining: data.remaining, limit: data.limit, tier: data.tier });
      setMode(nextMode);
      const auth =
        "conversationToken" in data.auth
          ? { conversationToken: data.auth.conversationToken, connectionType: "webrtc" as const }
          : "signedUrl" in data.auth
            ? { signedUrl: data.auth.signedUrl, connectionType: "websocket" as const }
            : { agentId: data.auth.agentId, connectionType: nextMode === "text" ? ("websocket" as const) : ("webrtc" as const) };
      startSession({
        ...auth,
        textOnly: nextMode === "text",
        onConnect: () => {
          push("system", nextMode === "voice" ? "Connected. Start talking." : "Connected.");
          // A session only counts against today's allowance once it has actually connected.
          fetch("/api/voice/session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ mode: nextMode, event: "connected" }),
          })
            .then((r) => r.json() as Promise<{ ok: boolean; remaining: number; limit: number; tier: "free" | "crew" }>)
            .then((q) => q.ok && setQuota({ remaining: q.remaining, limit: q.limit, tier: q.tier }))
            .catch(() => {});
          const loc = locationById(mapStore.get().selectedId);
          sendContextualUpdate(
            `Context: today is ${longDate(new Date().toISOString())}. The user is on the ${data.tier === "crew" ? "Crew Pass (paid)" : "free"} tier and is using ${SITE.name}${loc ? `, currently viewing "${loc.name}" (id ${loc.id})` : ""}.`,
          );
          // Today's pins (new ones land daily), so the agent can pass exact ids.
          sendContextualUpdate(
            `Current pin directory (id: name). Pass these ids to show_location, go_to_place and plan_route.\n${LOCATIONS.slice(0, 150)
              .map((l) => `${l.id}: ${l.name}${isPlaced(l) ? "" : " (not on the map yet)"}`)
              .join("\n")}`,
          );
          if (pendingText.current) {
            const t = pendingText.current;
            pendingText.current = null;
            sendUserMessage(t);
          }
        },
        onMessage: ({ message, role }) => {
          if (message?.trim()) push(role === "agent" ? "agent" : "user", message);
        },
        onDisconnect: () => {
          setMode(null);
          push("system", "Session ended.");
        },
        onError: (msg: string) => {
          console.warn("[voice]", msg);
          setNotice({ kind: "error", text: friendlyError(msg) });
        },
      });
    } catch (err) {
      setNotice({ kind: "error", text: friendlyError(err instanceof Error ? err.message : String(err)) });
    } finally {
      setBusy(false);
    }
  }

  async function ask(text: string) {
    const t = text.trim();
    if (!t) return;
    push("user", t);
    if (connected) {
      sendUserMessage(t);
      return;
    }
    pendingText.current = t;
    await begin("text");
  }

  function stop() {
    endSession();
  }

  const statusLabel = connecting
    ? "Connecting…"
    : connected
      ? mode === "voice"
        ? isSpeaking
          ? `${SITE.guideName} is talking`
          : isMuted
            ? "Mic muted"
            : "Listening…"
        : "Text chat"
      : status === "error"
        ? "Something went wrong"
        : "Ready";

  return (
    <>
      <button
        type="button"
        className={`voice-fab ${open ? "is-hidden" : ""} ${connected ? "is-live" : ""}`}
        onClick={() => mapStore.setVoiceOpen(true)}
        aria-label={`Open ${SITE.guideName}, the voice guide`}
      >
        <span className="voice-fab__orb" aria-hidden="true" />
        <span className="voice-fab__text">
          <strong>Ask {SITE.guideName}</strong>
          <small>{connected ? statusLabel : "Voice guide · live map control"}</small>
        </span>
      </button>

      <aside className={`voice-panel ${open ? "is-open" : ""}`} aria-label={`${SITE.guideName} voice guide`} aria-hidden={!open}>
        <header className="voice-panel__head">
          <div
            ref={orbRef}
            className={`orb ${connected ? "is-live" : ""} ${isSpeaking ? "is-speaking" : ""} ${connecting ? "is-connecting" : ""}`}
            aria-hidden="true"
          >
            <span className="orb__core" />
            <span className="orb__ring orb__ring--1" />
            <span className="orb__ring orb__ring--2" />
          </div>
          <div className="voice-panel__title">
            <strong>{SITE.guideName}</strong>
            <span className="voice-panel__status" role="status" aria-live="polite">
              <span className={`dot ${connected ? "dot--live" : ""}`} /> {statusLabel}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={() => mapStore.setVoiceOpen(false)} aria-label="Close voice guide">
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="voice-panel__log" ref={scrollRef}>
          {lines.length === 0 ? (
            <div className="voice-intro">
              <p>
                I&apos;m {SITE.guideName}. Ask where the secrets are, what changed today, or how to make fast money, and I&apos;ll fly the
                map there for you.
              </p>
              <div className="quick-prompts">
                {QUICK_PROMPTS.map((p) => (
                  <button key={p} type="button" className="chip chip--ghost" onClick={() => ask(p)} disabled={connecting}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            lines.map((l) => (
              <div key={l.id} className={`line line--${l.role}`}>
                {l.text}
              </div>
            ))
          )}
          {notice && (
            <div className={`voice-notice voice-notice--${notice.kind}`}>
              <p>{notice.text}</p>
              {notice.kind === "quota" && (
                <a className="btn btn--sunset btn--sm" href="/crew-pass">
                  <Icon name="crown" size={16} /> Get Crew Pass
                </a>
              )}
            </div>
          )}
        </div>

        <form
          className="voice-panel__input"
          onSubmit={(e) => {
            e.preventDefault();
            const t = draft;
            setDraft("");
            void ask(t);
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={connected ? "Type a message…" : "Type a question, or tap the mic"}
            aria-label="Message the guide"
            maxLength={500}
          />
          <button type="submit" className="icon-btn" disabled={!draft.trim() || connecting} aria-label="Send">
            <Icon name="send" size={18} />
          </button>
        </form>

        <footer className="voice-panel__controls">
          {connected ? (
            <>
              {mode === "voice" && (
                <button
                  type="button"
                  className={`round-btn ${isMuted ? "is-off" : ""}`}
                  onClick={() => setMuted(!isMuted)}
                  aria-label={isMuted ? "Unmute microphone" : "Mute microphone"}
                >
                  <Icon name={isMuted ? "micOff" : "mic"} size={20} />
                </button>
              )}
              <button type="button" className="round-btn round-btn--end" onClick={stop} aria-label="End session">
                <Icon name="end" size={22} />
              </button>
            </>
          ) : (
            <button type="button" className="mic-btn" onClick={() => begin("voice")} disabled={connecting}>
              <Icon name="mic" size={22} />
              <span>{connecting ? "Connecting…" : `Talk to ${SITE.guideName}`}</span>
            </button>
          )}
          {lines.length > 0 && !connected && (
            <button type="button" className="text-btn" onClick={clear}>
              Clear
            </button>
          )}
        </footer>
        <p className="voice-panel__fine">
          {quota
            ? quota.tier === "crew"
              ? `Crew Pass · ${quota.remaining} sessions left today`
              : `${quota.remaining} of ${quota.limit} free sessions left today`
            : "Free daily sessions · Crew Pass gets more"}
          {" · "}
          {SITE.guideName} can make mistakes, so check each pin&apos;s sources.
        </p>
      </aside>
    </>
  );
}

function friendlyError(msg: string): string {
  if (/permission|NotAllowed|denied/i.test(msg)) return "Microphone access was blocked. Allow the mic in your browser, or type instead.";
  if (/NotFound|no.*device/i.test(msg)) return "No microphone found. You can still type your questions.";
  if (/authentication|401|403/i.test(msg)) return "The voice guide isn't authorised right now. Please try again shortly.";
  return "Couldn't reach the voice guide. Check your connection and try again.";
}
