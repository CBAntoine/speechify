// Atlas: the ElevenLabs voice (and text) agent that knows what the crew is
// doing and runs the business when you ask. Every command in the registry is
// a client tool here: the handler calls /api/commands/<name> (signed in as
// you), so Atlas can't do anything you couldn't. Confirm-level commands come
// back with needsConfirmation until Atlas asks you and calls again.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversationClientTool,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";
import { Keyboard, Mic, MicOff, PhoneOff, Send, Settings as SettingsIcon, Sparkles, Wrench, X } from "lucide-react";
import { api, postCommand } from "../api";
import type { CommandResult, CrewEvent, VoiceSession } from "../api";
import { COMMAND_NAMES, COMMAND_RISK } from "../commands";
import type { CommandName } from "../commands";
import { AGENT_NAME } from "../format";
import { currentRoute, href, navigate, SCREEN_LABEL, useRoute } from "../router";
import type { ScreenId } from "../router";
import { bump, refreshOverviewSoon, useStore } from "../store";
import { cx } from "../ui";
import { setAtlasOpen, takeAtlasRequest, toggleAtlas, useAtlasOpen, useAtlasRequest } from "./open";

type Line = { id: number; role: "user" | "agent" | "tool" | "system"; text: string };
type Params = Record<string, unknown>;

const SUGGESTIONS = ["What's happening today?", "Does anything need my approval?", "How's the response rate this week?", "Scout dentists in Bend, Oregon"];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const agentName = (v: unknown) => AGENT_NAME[str(v) as keyof typeof AGENT_NAME] ?? (str(v) || "crew");

/** What shows in the transcript while a tool runs. */
const TOOL_LABEL: Record<Exclude<CommandName, "open_screen">, (p: Params) => string> = {
  get_briefing: () => "Checked how the business is doing",
  get_metrics: (p) => `Pulled the numbers${str(p.period) ? ` (${str(p.period)})` : ""}`,
  find_leads: (p) => `Searched the pipeline${str(p.query) ? ` for “${str(p.query)}”` : str(p.status) ? ` (${str(p.status)})` : ""}`,
  get_lead: (p) => `Opened ${str(p.lead) || "a lead"}`,
  list_approvals: () => "Checked what needs your yes",
  decide_approval: (p) => (p.confirmed ? `Recorded your ${str(p.decision) === "reject" ? "no" : "yes"}` : "Checking the decision with you"),
  run_agent: (p) => `Put the ${agentName(p.agent)} to work${str(p.city) ? ` in ${str(p.city)}` : ""}`,
  pause_crew: (p) => (p.agent ? `Paused the ${agentName(p.agent)}` : "Paused the crew"),
  resume_crew: (p) => (p.agent ? `Resumed the ${agentName(p.agent)}` : "Resumed the crew"),
  update_setting: (p) => `${p.confirmed ? "Changed" : "Checking a change to"} ${str(p.path).replace(/\./g, " → ") || "a setting"}`,
  add_target: (p) => `Added ${[str(p.city), str(p.niche)].filter(Boolean).join(" · ") || "a target"}`,
  remove_target: (p) => `Removed ${[str(p.city), str(p.niche)].filter(Boolean).join(" · ") || "a target"}`,
  send_pitch: (p) => (p.confirmed ? `Sending the pitch to ${str(p.lead)}` : `Getting the pitch to ${str(p.lead)} ready`),
  send_reply: (p) => (p.confirmed ? `Sending the reply to ${str(p.lead)}` : `Getting the reply to ${str(p.lead)} ready`),
  draft_reply: (p) => `Drafting a reply to ${str(p.lead)}`,
  log_outcome: (p) => `Logged “${str(p.outcome).replace(/_/g, " ")}” for ${str(p.lead)}`,
  add_note: (p) => `Added a note to ${str(p.lead)}`,
  add_lead: (p) => `Added ${str(p.name) || "a business"}${str(p.city) ? ` in ${str(p.city)}` : ""}`,
  rebuild: (p) => `Rebuilding the ${str(p.what) === "all" ? "whole kit" : str(p.what) || "mockups"} for ${str(p.lead)}`,
  get_activity: (p) => `Read the ${p.agent ? `${agentName(p.agent)}'s ` : ""}activity`,
  get_spend: () => "Checked the spend",
  get_call_list: () => "Pulled your call list",
};

const SCREEN_WORDS: Record<string, ScreenId> = {
  today: "today",
  home: "today",
  dashboard: "today",
  overview: "today",
  pipeline: "pipeline",
  leads: "pipeline",
  lead: "lead",
  outreach: "outreach",
  inbox: "outreach",
  replies: "outreach",
  calls: "outreach",
  approvals: "approvals",
  approval: "approvals",
  crew: "crew",
  agents: "crew",
  settings: "settings",
  voice: "settings",
  activity: "activity",
  log: "activity",
};

// Live crew news Atlas hears mid-conversation. Long commands (run_agent,
// rebuild) answer "on it" right away and finish later, so this is how Atlas
// learns they're done. Routine scans stay out.
const FORWARD_AGENTS = new Set<CrewEvent["agent"]>(["builder", "filmer", "pitcher", "closer", "orchestrator"]);
const FORWARD_LEVELS = new Set<CrewEvent["level"]>(["success", "warn", "error"]);
const FORWARD_EVERY_MS = 3000;

function eventLine(e: CrewEvent): string {
  const who = AGENT_NAME[e.agent as keyof typeof AGENT_NAME] ?? e.agent;
  const text = `[${who}] ${e.leadName ? `${e.leadName}: ` : ""}${e.message}`;
  return text.length > 220 ? `${text.slice(0, 217)}…` : text;
}

function friendly(msg: string): string {
  if (/permission|notallowed|microphone|getusermedia/i.test(msg)) return "Your microphone is blocked. Allow it in the browser's site settings, or type instead.";
  if (/network|websocket|failed to fetch|livekit|ice/i.test(msg)) return "The connection dropped. Check your internet and try again.";
  return msg.length < 180 ? msg : "Something went wrong with the conversation. Try again.";
}

/** The tool result Atlas reads: short, and never so long it floods the context. */
function compact(res: CommandResult): string {
  const out: Record<string, unknown> = { ok: res.ok, say: res.say };
  if (res.needsConfirmation) out.needsConfirmation = res.needsConfirmation;
  if (res.data !== undefined) out.data = res.data;
  const s = JSON.stringify(out);
  if (s.length <= 12_000) return s;
  return JSON.stringify({ ...out, data: `${JSON.stringify(res.data).slice(0, 11_000)}… (cut short: ask for something narrower)` });
}

export default function Atlas(props: { ownerName: string; agencyName: string }) {
  return (
    <ConversationProvider>
      <AtlasInner {...props} />
    </ConversationProvider>
  );
}

function AtlasInner({ ownerName, agencyName }: { ownerName: string; agencyName: string }) {
  const route = useRoute();
  const open = useAtlasOpen();
  const request = useAtlasRequest();
  const { startSession, endSession, sendUserMessage, sendContextualUpdate, getInputVolume, getOutputVolume } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { isMuted, setMuted } = useConversationInput();
  const [lines, setLines] = useState<Line[]>([]);
  const [mode, setMode] = useState<"voice" | "text" | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(0);
  const [notice, setNotice] = useState<{ text: string; settings?: boolean } | null>(null);
  const [draft, setDraft] = useState("");
  const nextId = useRef(1);
  const pendingText = useRef<string | null>(null);
  const fabOrb = useRef<HTMLSpanElement>(null);
  const panelOrb = useRef<HTMLSpanElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastScreen = useRef(route.raw);

  const connected = status === "connected";
  const connecting = busy || status === "connecting";

  const push = useCallback((role: Line["role"], text: string) => {
    if (!text?.trim()) return;
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.text === text) return prev;
      return [...prev.slice(-150), { id: nextId.current++, role, text }];
    });
  }, []);

  const track = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setWorking((n) => n + 1);
    try {
      return await fn();
    } finally {
      setWorking((n) => Math.max(0, n - 1));
    }
  }, []);

  /** Run one registry command for Atlas. */
  const callServer = useCallback(
    async (name: Exclude<CommandName, "open_screen">, params: Params): Promise<string> => {
      push("tool", TOOL_LABEL[name](params ?? {}));
      const res = await track(() => postCommand(name, params ?? {}));
      if (COMMAND_RISK[name] !== "read") {
        bump(150);
        refreshOverviewSoon(500);
      }
      if (!res.ok && !res.needsConfirmation) push("tool", `That didn't work: ${res.say}`);
      return compact(res);
    },
    [push, track],
  );

  const openScreen = useCallback(
    (params: Params): string => {
      const word = str(params.screen).toLowerCase();
      const screen = SCREEN_WORDS[word] ?? (word as ScreenId);
      const leadId = str(params.lead_id);
      if (screen === "lead" || leadId) {
        if (!leadId) return "Which lead? Pass lead_id (from find_leads or get_lead).";
        navigate("lead", leadId);
        push("tool", "Opened the lead on screen");
        if (window.matchMedia("(max-width: 899px)").matches) setAtlasOpen(false);
        return "Opened the lead on the owner's screen.";
      }
      if (!(screen in SCREEN_LABEL)) return `There's no screen called “${word}”. Screens: today, pipeline, outreach, approvals, crew, settings, activity.`;
      navigate(screen);
      push("tool", `Opened ${SCREEN_LABEL[screen]}`);
      if (window.matchMedia("(max-width: 899px)").matches) setAtlasOpen(false);
      return `Opened ${SCREEN_LABEL[screen]}.`;
    },
    [push],
  );

  // ── Session ──
  const begin = useCallback(
    async (next: "voice" | "text") => {
      setNotice(null);
      setBusy(true);
      try {
        let data: VoiceSession;
        try {
          data = await api<VoiceSession>("/api/voice/session", { body: { mode: next } });
        } catch (err) {
          data = { ok: false, error: err instanceof Error ? err.message : "Atlas isn't available right now." };
        }
        if (!data.ok) {
          setNotice({ text: data.error || "Atlas isn't set up yet.", settings: true });
          pendingText.current = null;
          return;
        }
        setMode(next);
        const auth =
          "conversationToken" in data.auth
            ? { conversationToken: data.auth.conversationToken, connectionType: "webrtc" as const }
            : { signedUrl: data.auth.signedUrl, connectionType: "websocket" as const };
        startSession({
          ...auth,
          textOnly: next === "text",
          ...(data.dynamicVariables ? { dynamicVariables: data.dynamicVariables } : {}),
          onConnect: () => {
            push("system", next === "voice" ? "Connected. Go ahead and talk." : "Connected.");
            const r = currentRoute();
            lastScreen.current = r.raw;
            sendContextualUpdate(`The owner has the ${SCREEN_LABEL[r.screen]} screen open${r.screen === "lead" && r.param ? ` (lead ${r.param})` : ""}.`);
            if (pendingText.current) {
              const t = pendingText.current;
              pendingText.current = null;
              sendUserMessage(t);
            }
          },
          onMessage: ({ message, role }: { message?: string; role?: string }) => {
            if (message?.trim()) push(role === "agent" ? "agent" : "user", message);
          },
          onDisconnect: () => {
            setMode(null);
            push("system", "Conversation ended.");
          },
          onError: (msg: string) => {
            console.warn("[atlas]", msg);
            setNotice({ text: friendly(String(msg)) });
          },
        });
      } catch (err) {
        setNotice({ text: friendly(err instanceof Error ? err.message : String(err)) });
      } finally {
        setBusy(false);
      }
    },
    [push, sendContextualUpdate, sendUserMessage, startSession],
  );

  const talk = useCallback(() => {
    if (connecting) return;
    if (connected && mode === "voice") return;
    if (connected) {
      endSession();
      window.setTimeout(() => void begin("voice"), 350);
      return;
    }
    void begin("voice");
  }, [begin, connected, connecting, endSession, mode]);

  const ask = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      push("user", t);
      if (connected) {
        sendUserMessage(t);
        return;
      }
      pendingText.current = t;
      await begin("text");
    },
    [begin, connected, push, sendUserMessage],
  );

  // Requests from the rest of the app ("Ask Atlas", suggestions…).
  useEffect(() => {
    if (!request) return;
    const r = takeAtlasRequest();
    if (!r) return;
    if (r.kind === "voice") talk();
    else void ask(r.prompt);
  }, [request, talk, ask]);

  // While connected, pass notable crew events to Atlas (batched, at most one
  // update every 3 s) so it can mention them: "Builder just finished…".
  const events = useStore((s) => s.events);
  const lastForwarded = useRef(0);
  const outbox = useRef<string[]>([]);
  const lastSentAt = useRef(0);
  const flushTimer = useRef(0);

  useEffect(() => {
    if (!connected) {
      lastForwarded.current = events[0]?.id ?? lastForwarded.current;
      outbox.current = [];
      window.clearTimeout(flushTimer.current);
      flushTimer.current = 0;
      return;
    }
    const fresh = events.filter((e) => e.id > lastForwarded.current);
    if (!fresh.length) return;
    lastForwarded.current = Math.max(lastForwarded.current, ...fresh.map((e) => e.id));
    for (const e of [...fresh].reverse()) {
      if (FORWARD_AGENTS.has(e.agent) && FORWARD_LEVELS.has(e.level)) outbox.current.push(eventLine(e));
    }
    if (!outbox.current.length || flushTimer.current) return;
    const flush = () => {
      flushTimer.current = 0;
      const lines = outbox.current.splice(0, 6);
      const more = outbox.current.length;
      outbox.current = [];
      if (!lines.length) return;
      lastSentAt.current = Date.now();
      sendContextualUpdate(`Live update from the crew (mention it if it matters to the owner):\n${lines.join("\n")}${more ? `\n…and ${more} more.` : ""}`);
    };
    flushTimer.current = window.setTimeout(flush, Math.max(0, FORWARD_EVERY_MS - (Date.now() - lastSentAt.current)));
  }, [events, connected, sendContextualUpdate]);

  useEffect(() => () => window.clearTimeout(flushTimer.current), []);

  // Keep Atlas aware of the screen the owner is looking at.
  useEffect(() => {
    if (!connected || lastScreen.current === route.raw) return;
    lastScreen.current = route.raw;
    sendContextualUpdate(`The owner is now on the ${SCREEN_LABEL[route.screen]} screen${route.screen === "lead" && route.param ? ` (lead ${route.param})` : ""}.`);
  }, [connected, route, sendContextualUpdate]);

  // Ctrl/Cmd+K opens and closes Atlas; Escape closes the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleAtlas();
      } else if (e.key === "Escape" && open && !document.querySelector(".dialog-backdrop")) {
        setAtlasOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open && !connected) window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 80);
  }, [open, connected]);

  // The orbs follow the audio level.
  useEffect(() => {
    const set = (v: string) => {
      fabOrb.current?.style.setProperty("--level", v);
      panelOrb.current?.style.setProperty("--level", v);
    };
    if (!connected || mode !== "voice") {
      set("0");
      return;
    }
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      const level = Math.max(getOutputVolume?.() ?? 0, (getInputVolume?.() ?? 0) * 0.8);
      smooth = smooth * 0.75 + Math.min(1, level * 1.7) * 0.25;
      set(smooth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [connected, mode, getInputVolume, getOutputVolume]);

  useEffect(() => {
    if (!lines.length) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines, notice, working, open]);

  const statusText = connecting
    ? "Connecting…"
    : working
      ? "Working on it…"
      : connected
        ? mode === "voice"
          ? isSpeaking
            ? "Speaking"
            : isMuted
              ? "Mic muted"
              : "Listening"
          : "Ready"
        : "Ask what's happening, or give an order";

  const first = ownerName?.trim().split(/\s+/)[0];
  const live = connected && mode === "voice";

  return (
    <>
      <ToolBindings call={callServer} openScreen={openScreen} />

      <button
        type="button"
        className={cx("atlas-fab", open && "is-open", connected && "is-live", isSpeaking && live && "is-speaking")}
        onClick={toggleAtlas}
        aria-label={open ? "Hide Atlas" : connected ? "Atlas is listening. Open the panel" : "Talk to Atlas"}
        aria-expanded={open}
        title="Atlas (Ctrl+K)"
      >
        <span ref={fabOrb} className={cx("orb", !connected && "idle")} aria-hidden />
        {!open ? <span className="atlas-fab-label">{connected ? (live ? "Listening" : "Atlas") : "Atlas"}</span> : null}
      </button>

      <div className={cx("atlas-backdrop", open && "is-open")} onClick={() => setAtlasOpen(false)} aria-hidden />

      <section className={cx("atlas-panel", open && "is-open")} aria-label="Atlas, your voice agent" aria-hidden={!open} {...(open ? {} : { inert: true })}>
        <header className="atlas-head">
          <span ref={panelOrb} className={cx("orb sm", !connected && "idle", isSpeaking && live && "speaking")} aria-hidden />
          <div className="atlas-title">
            <b>Atlas</b>
            <small aria-live="polite">{statusText}</small>
          </div>
          {connected ? (
            <button type="button" className="btn btn-ghost btn-icon atlas-end" onClick={() => endSession()} aria-label="End the conversation" title="End">
              <PhoneOff size={17} />
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => setAtlasOpen(false)} aria-label="Close Atlas">
            <X size={18} />
          </button>
        </header>

        <div className="atlas-body" ref={scrollRef} aria-live="polite" aria-relevant="additions">
          {!lines.length ? (
            <div className="atlas-intro">
              <button type="button" className={cx("atlas-mic-big", connecting && "is-busy")} onClick={talk} disabled={connecting} aria-label="Talk to Atlas">
                <span className={cx("orb lg", !connected && "idle")} aria-hidden />
                <Mic size={26} className="atlas-mic-icon" aria-hidden />
              </button>
              <p className="atlas-hello">
                {first ? `Hi ${first}. ` : ""}I'm Atlas. I run the crew for {(agencyName || "your agency").replace(/[.\s]+$/, "")}. Ask me what's happening, or tell me what to do.
              </p>
              <div className="atlas-suggest">
                {SUGGESTIONS.map((q) => (
                  <button key={q} type="button" onClick={() => void ask(q)} disabled={connecting}>
                    <Sparkles size={13} aria-hidden /> {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            lines.map((l) =>
              l.role === "tool" ? (
                <div key={l.id} className="atlas-line tool">
                  <span>
                    <Wrench size={11} aria-hidden /> {l.text}
                  </span>
                </div>
              ) : l.role === "system" ? (
                <div key={l.id} className="atlas-line system">
                  <span>{l.text}</span>
                </div>
              ) : (
                <div key={l.id} className={cx("atlas-line", l.role)}>
                  <div className="say">{l.text}</div>
                </div>
              ),
            )
          )}
          {working > 0 ? (
            <div className="atlas-line tool">
              <span className="atlas-working">
                <i />
                <i />
                <i /> Working
              </span>
            </div>
          ) : null}
        </div>

        {notice ? (
          <div className="atlas-notice" role="alert">
            <span>{notice.text}</span>
            {notice.settings ? (
              <a href={href("settings", undefined, { section: "voice" })} onClick={() => window.matchMedia("(max-width: 899px)").matches && setAtlasOpen(false)}>
                <SettingsIcon size={13} aria-hidden /> Settings → Voice
              </a>
            ) : null}
          </div>
        ) : null}

        <form
          className="atlas-foot"
          onSubmit={(e) => {
            e.preventDefault();
            const t = draft;
            setDraft("");
            void ask(t);
          }}
        >
          {live ? (
            <button type="button" className={cx("atlas-mic", isMuted ? "is-muted" : "is-live")} onClick={() => setMuted(!isMuted)} aria-label={isMuted ? "Unmute the microphone" : "Mute the microphone"} aria-pressed={isMuted}>
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
          ) : (
            <button type="button" className="atlas-mic" onClick={talk} disabled={connecting} aria-label="Talk by voice" title="Talk by voice">
              <Mic size={18} />
            </button>
          )}
          <label className="atlas-input">
            <Keyboard size={15} aria-hidden className="muted" />
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={live ? "Or type…" : "Type instead…"}
              aria-label="Message Atlas"
              maxLength={1000}
              enterKeyHint="send"
            />
          </label>
          <button type="submit" className="btn btn-primary btn-icon" disabled={!draft.trim() || connecting} aria-label="Send">
            <Send size={16} />
          </button>
        </form>
      </section>
    </>
  );
}

/** One client tool per registry command (a fixed list, so hooks stay in order). */
function ToolBindings({ call, openScreen }: { call: (name: Exclude<CommandName, "open_screen">, p: Params) => Promise<string>; openScreen: (p: Params) => string }) {
  return (
    <>
      {COMMAND_NAMES.map((name) => (name === "open_screen" ? <OpenScreenTool key={name} run={openScreen} /> : <ServerTool key={name} name={name} call={call} />))}
    </>
  );
}

function ServerTool({ name, call }: { name: Exclude<CommandName, "open_screen">; call: (name: Exclude<CommandName, "open_screen">, p: Params) => Promise<string> }) {
  useConversationClientTool(name, (params: Params) => call(name, params));
  return null;
}

function OpenScreenTool({ run }: { run: (p: Params) => string }) {
  useConversationClientTool("open_screen", (params: Params) => run(params));
  return null;
}
