"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationProvider, useConversationClientTool, useConversationControls, useConversationInput, useConversationMode, useConversationStatus,
} from "@elevenlabs/react";
import { ArrowUpRight, Mic, MicOff, MousePointerClick, PhoneOff, Send, Sparkles, X } from "lucide-react";
import { GUIDE, searchGuide } from "@/lib/copilot/guide";
import { matchScreen, screenById, screenForPath, type CopilotCrmTool } from "@/lib/copilot/screens";
import { clickElement, fillElement, findOnScreen, pointTo, readScreen } from "./dom";

// The Rainmaker copilot: an ElevenLabs voice and chat agent that runs the app
// for the owner. Its tools run here, in the browser: screen tools read and
// work the page; CRM tools call /api/copilot/tool. It lives in the app layout,
// so a conversation carries on while it moves between screens.

type Line = { id: number; role: "user" | "agent" | "tool" | "system"; text: string };

const OPEN_EVENT = "rm:copilot";

/** Open the copilot from anywhere in the app. */
export function openCopilot() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}
type Params = Record<string, unknown>;

const SUGGESTIONS = [
  "What needs my attention today?",
  "Find 20 dentists in Toronto that need a website",
  "Take me to Autopilot and turn it on",
  "How do I connect Stripe?",
];

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const CRM_LABEL: Record<CopilotCrmTool, (p: Params) => string> = {
  find_businesses: (p) => `Searching for ${str(p.niche) || "businesses"} near ${str(p.location) || "you"}`,
  save_leads: (p) => `Saving ${Array.isArray(p.leads) ? p.leads.length : ""} leads to the pipeline`,
  list_leads: () => "Reading the pipeline",
  get_lead: () => "Reading a lead",
  update_lead: (p) => (p.stage ? `Moving a lead to ${str(p.stage)}` : "Updating a lead"),
  draft_message: () => "Writing a draft for your approval",
  create_ad_campaign: (p) => `Writing an ad campaign for ${str(p.business_name) || "a business"}`,
  create_task: (p) => `Adding a task: ${str(p.title)}`,
  list_tasks: () => "Reading your tasks",
  audit_website: (p) => `Checking ${str(p.url)}`,
  research_web: () => "Researching the web",
  estimate_ai_guide: () => "Sizing the AI website guide offer",
  build_ai_guide: () => "Reading their website and building the AI guide (about a minute)",
  test_ai_guide: () => "Testing the AI guide's five demo questions",
  pitch_ai_guide: () => "Writing the AI guide pitch for your approval",
  start_ai_guide_trial: () => "Putting the AI guide on their website",
  ai_guide_report: () => "Reading the AI guide's conversations",
  teach_ai_guide: () => "Teaching the AI guide",
  create_video_ad: () => "Making a video ad from their real data (a minute or two)",
  email_video_ad: () => "Drafting the video ad email for your approval",
};

/** Tools that change data: the screen refreshes after them. */
const MUTATES = new Set<CopilotCrmTool>([
  "save_leads",
  "update_lead",
  "draft_message",
  "create_ad_campaign",
  "create_task",
  "audit_website",
  "estimate_ai_guide",
  "build_ai_guide",
  "test_ai_guide",
  "pitch_ai_guide",
  "start_ai_guide_trial",
  "teach_ai_guide",
  "create_video_ad",
  "email_video_ad",
]);

function friendly(msg: string): string {
  if (/permission|notallowed|microphone|getUserMedia/i.test(msg)) return "Your microphone is blocked. Allow it in the browser, or type instead.";
  if (/network|websocket|failed to fetch|livekit/i.test(msg)) return "The connection dropped. Check your internet and try again.";
  return msg.length < 160 ? msg : "Something went wrong with the conversation. Try again.";
}

function waitForPath(target: string, ms = 4000): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (window.location.pathname === target || Date.now() - start > ms) window.setTimeout(resolve, 350);
      else window.setTimeout(tick, 80);
    };
    tick();
  });
}

export interface CopilotProps {
  ownerName: string;
  agencyName: string;
  /** ElevenLabs is configured, so voice and the AI can run. */
  voice: boolean;
}

export function Copilot(props: CopilotProps) {
  return (
    <ConversationProvider>
      <CopilotInner {...props} />
    </ConversationProvider>
  );
}

function CopilotInner({ ownerName, agencyName, voice }: CopilotProps) {
  const router = useRouter();
  const path = usePathname();
  const { startSession, endSession, sendUserMessage, sendContextualUpdate, getInputVolume, getOutputVolume } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { isMuted, setMuted } = useConversationInput();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [mode, setMode] = useState<"voice" | "text" | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const nextId = useRef(1);
  const pendingText = useRef<string | null>(null);
  const prospects = useRef(new Map<string, unknown>());
  const orbRef = useRef<HTMLSpanElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastPath = useRef(path);
  /** Set when the mic is pressed during a typed chat: start a voice call once it ends. */
  const switchToVoice = useRef(false);
  const beginRef = useRef<(m: "voice" | "text") => Promise<void>>(async () => undefined);
  const connected = status === "connected";
  const connecting = busy || status === "connecting";

  const push = useCallback((role: Line["role"], text: string) => {
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.text === text) return prev;
      return [...prev.slice(-120), { id: nextId.current++, role, text }];
    });
  }, []);

  /** Wrap a tool so the panel shows it's working while it runs. */
  const track = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setWorking((n) => n + 1);
    try {
      return await fn();
    } finally {
      setWorking((n) => Math.max(0, n - 1));
    }
  }, []);

  // ── Navigation ──
  const goTo = useCallback(
    async (p: Params): Promise<string> => {
      const s = screenById(str(p.screen)) ?? matchScreen(str(p.screen));
      if (!s) return `No screen called "${str(p.screen)}".`;
      const q = new URLSearchParams();
      if (s.id === "public_store") {
        const slug = str(p.product).toLowerCase().replace(/[^a-z0-9-]/g, "");
        window.open(slug ? `/store/${slug}` : "/store", "_blank", "noopener");
        push("tool", `Opened the public store${slug ? ` (${slug})` : ""} in a new tab`);
        return "The public store opened in a new tab. The copilot stays here.";
      }
      if (s.id === "pipeline" && str(p.lead_id)) q.set("lead", str(p.lead_id));
      if (s.id === "ad_studio") {
        if (str(p.campaign_id)) q.set("campaign", str(p.campaign_id));
        if (str(p.lead_id)) q.set("lead", str(p.lead_id));
        if (str(p.niche)) q.set("niche", str(p.niche));
        if (str(p.location)) q.set("location", str(p.location));
      }
      if (s.id === "find_clients") {
        if (p.search === true && str(p.location) && window.location.pathname === "/prospects") {
          // Already here: ask the open finder to search, so its results stay on screen.
          window.dispatchEvent(new CustomEvent("rm:prospect-search", { detail: { niche: str(p.niche), location: str(p.location) } }));
          push("tool", `Searching ${str(p.niche) || "businesses"} in ${str(p.location)}`);
          return "The search is running on screen; call read_screen in a few seconds to see the results.";
        }
        if (str(p.niche)) q.set("niche", str(p.niche));
        if (str(p.location)) q.set("location", str(p.location));
        if (p.search === true && str(p.location)) q.set("go", "1");
      }
      if (s.id === "agents") {
        if (str(p.agent)) q.set("agent", str(p.agent));
        if (str(p.goal)) q.set("goal", str(p.goal));
      }
      const href = `${s.path}${q.size ? `?${q}` : ""}`;
      router.push(href);
      push("tool", `Opened ${s.label}`);
      await waitForPath(s.path);
      return `${s.label} is open on the user's screen.${q.has("go") ? " The search is running on screen; call read_screen in a few seconds to see the results." : ""}`;
    },
    [push, router]
  );

  // ── Client tools (names match src/lib/copilot/spec.ts) ──
  useConversationClientTool("get_app_state", () =>
    track(async () => {
      const r = await fetch(`/api/copilot/state?path=${encodeURIComponent(window.location.pathname)}`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return "Couldn't load the app state right now.";
      return await r.text();
    })
  );
  useConversationClientTool("how_to", (p: Params) => {
    const hits = searchGuide(str(p.topic), 2);
    return hits.length ? hits.map((t) => `${t.title}: ${t.text}`).join("\n\n") : `No guide entry for that. Topics: ${GUIDE.map((t) => t.id).join(", ")}.`;
  });
  useConversationClientTool("go_to", (p: Params) => goTo(p));
  useConversationClientTool("read_screen", () => JSON.stringify(readScreen(window.location.pathname + window.location.search)));
  useConversationClientTool("click", (p: Params) => {
    const r = clickElement(str(p.element_id), p.confirmed === true);
    if (r.ok) push("tool", `Clicked “${r.label}”`);
    return r.text;
  });
  useConversationClientTool("fill", (p: Params) => {
    const r = fillElement(str(p.element_id), typeof p.value === "string" ? p.value : String(p.value ?? ""));
    if (r.ok) push("tool", `Filled in “${r.label}”`);
    return r.text;
  });
  useConversationClientTool("point_to", (p: Params) => {
    const r = pointTo(str(p.element_id));
    if (r.ok) push("tool", `Pointing at “${r.label}”`);
    return r.text;
  });
  useConversationClientTool("run_team_agent", (p: Params) =>
    track(async () => {
      const agentId = str(p.agent);
      const goal = str(p.goal);
      if (!agentId || !goal) return "Needs an agent and a goal.";
      if (p.confirmed !== true) return "Not started. Each run spends Claude credits: tell the user the agent and goal, ask \"Should I go ahead?\", and call again with confirmed true after a yes.";
      const r = await fetch("/api/agents/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentId, goal }) }).catch(() => null);
      const data = (await r?.json().catch(() => ({}))) as { run?: { id: string }; error?: string } | undefined;
      if (!r?.ok || !data?.run) return `Couldn't start it: ${data?.error ?? "the request failed"}.`;
      push("tool", `Started the ${agentId} agent`);
      router.push(`/agents?agent=${encodeURIComponent(agentId)}`);
      await waitForPath("/agents");
      return "The agent is running on the Agents screen, where the user can watch each step. Anything it writes waits in the Inbox for approval.";
    })
  );

  const crm = useCallback(
    (name: CopilotCrmTool, input: Params) =>
      track(async () => {
        push("tool", CRM_LABEL[name](input ?? {}));
        let carry: unknown[] | undefined;
        if (name === "save_leads" && Array.isArray(input?.leads)) {
          carry = (input.leads as Params[]).map((l) => prospects.current.get(str(l?.key))).filter(Boolean);
        }
        const r = await fetch("/api/copilot/tool", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, input: input ?? {}, prospects: carry }),
        }).catch(() => null);
        const data = (await r?.json().catch(() => ({}))) as { text?: string; isError?: boolean; summary?: string; error?: string; prospects?: { key: string }[] } | undefined;
        if (!r?.ok || !data) return `That didn't work: ${data?.error ?? "the request failed"}.`;
        for (const p of data.prospects ?? []) prospects.current.set(p.key, p);
        if (!data.isError && MUTATES.has(name)) router.refresh();
        if (data.summary && !data.isError) push("tool", data.summary);
        return data.text ?? "Done.";
      }),
    [push, router, track]
  );
  useConversationClientTool("find_businesses", (p: Params) => crm("find_businesses", p));
  useConversationClientTool("save_leads", (p: Params) => crm("save_leads", p));
  useConversationClientTool("list_leads", (p: Params) => crm("list_leads", p));
  useConversationClientTool("get_lead", (p: Params) => crm("get_lead", p));
  useConversationClientTool("update_lead", (p: Params) => crm("update_lead", p));
  useConversationClientTool("draft_message", (p: Params) => crm("draft_message", p));
  useConversationClientTool("create_ad_campaign", (p: Params) => crm("create_ad_campaign", p));
  useConversationClientTool("create_task", (p: Params) => crm("create_task", p));
  useConversationClientTool("list_tasks", (p: Params) => crm("list_tasks", p));
  useConversationClientTool("audit_website", (p: Params) => crm("audit_website", p));
  useConversationClientTool("research_web", (p: Params) => crm("research_web", p));
  useConversationClientTool("estimate_ai_guide", (p: Params) => crm("estimate_ai_guide", p));
  useConversationClientTool("build_ai_guide", (p: Params) => crm("build_ai_guide", p));
  useConversationClientTool("test_ai_guide", (p: Params) => crm("test_ai_guide", p));
  useConversationClientTool("pitch_ai_guide", (p: Params) => crm("pitch_ai_guide", p));
  useConversationClientTool("start_ai_guide_trial", (p: Params) => crm("start_ai_guide_trial", p));
  useConversationClientTool("ai_guide_report", (p: Params) => crm("ai_guide_report", p));
  useConversationClientTool("teach_ai_guide", (p: Params) => crm("teach_ai_guide", p));
  useConversationClientTool("create_video_ad", (p: Params) => crm("create_video_ad", p));
  useConversationClientTool("email_video_ad", (p: Params) => crm("email_video_ad", p));

  /** Without the AI: open screens and answer from the guide. */
  const answerLocally = useCallback(
    (text: string, already = false) => {
      if (!already) push("user", text);
      const s = matchScreen(text);
      if (s && (/\b(go|open|show|take|navigate|bring|switch|jump|view)\b/i.test(text) || text.trim().split(/\s+/).length <= 3)) {
        void goTo({ screen: s.id });
        push("agent", `Here's ${s.label}.`);
        return;
      }
      if (/\b(where|which button|point|show me how)\b/i.test(text)) {
        const spot = findOnScreen(text);
        if (spot) {
          pointTo(spot.id);
          push("tool", `Pointing at “${spot.label}”`);
          push("agent", `It's here on this screen: “${spot.label}”.`);
          return;
        }
      }
      const hit = searchGuide(text, 1)[0];
      if (hit) {
        push("agent", `${hit.title}: ${hit.text}`);
        return;
      }
      push(
        "agent",
        voice ? "I couldn't reach the AI just now. I can still open screens: try “open the pipeline”." : "Right now I can open screens and explain features. Add ELEVENLABS_API_KEY and I'll take actions and talk too."
      );
    },
    [goTo, push, voice]
  );

  // ── Session ──
  const begin = useCallback(
    async (nextMode: "voice" | "text") => {
      setNotice(null);
      setBusy(true);
      try {
        const res = await fetch("/api/copilot/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: nextMode }) });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; briefing?: string; auth?: { conversationToken: string } | { signedUrl: string } };
        if (!res.ok || !data.ok || !data.auth) {
          setNotice(data.error ?? "The copilot isn't available right now.");
          const t = pendingText.current;
          pendingText.current = null;
          if (t) answerLocally(t, true);
          return;
        }
        setMode(nextMode);
        const auth =
          "conversationToken" in data.auth
            ? { conversationToken: data.auth.conversationToken, connectionType: "webrtc" as const }
            : { signedUrl: data.auth.signedUrl, connectionType: "websocket" as const };
        startSession({
          ...auth,
          textOnly: nextMode === "text",
          dynamicVariables: {
            owner_name: ownerName || "there",
            agency_name: agencyName || "your agency",
            today: new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
            current_screen: screenForPath(window.location.pathname).label,
            briefing: data.briefing || "I'm your Rainmaker copilot.",
          },
          onConnect: () => {
            push("system", nextMode === "voice" ? "Connected. Start talking." : "Connected.");
            lastPath.current = window.location.pathname;
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
            if (switchToVoice.current) {
              switchToVoice.current = false;
              push("system", "Switching to voice…");
              window.setTimeout(() => void beginRef.current("voice"), 250);
              return;
            }
            push("system", "Conversation ended.");
          },
          onError: (msg: string) => {
            console.warn("[copilot]", msg);
            setNotice(friendly(msg));
          },
        });
      } catch (err) {
        setNotice(friendly(err instanceof Error ? err.message : String(err)));
      } finally {
        setBusy(false);
      }
    },
    [agencyName, answerLocally, ownerName, push, sendUserMessage, startSession]
  );
  useEffect(() => {
    beginRef.current = begin;
  }, [begin]);

  const ask = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t) return;
      if (!voice) {
        answerLocally(t);
        return;
      }
      push("user", t);
      if (connected) {
        sendUserMessage(t);
        return;
      }
      pendingText.current = t;
      await begin("text");
    },
    [answerLocally, begin, connected, push, sendUserMessage, voice]
  );

  // Keep the agent aware of where the user is.
  useEffect(() => {
    if (!connected || lastPath.current === path) return;
    lastPath.current = path;
    sendContextualUpdate(`The user is now on the ${screenForPath(path).label} screen (${path}).`);
  }, [connected, path, sendContextualUpdate]);

  const close = useCallback(() => {
    switchToVoice.current = false;
    if (connected) endSession();
    setOpen(false);
  }, [connected, endSession]);

  // Ctrl/Cmd+K, or the Copilot buttons in the sidebar and phone top bar.
  // Closing hangs up, so the mic never stays on behind a closed panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) close();
        else setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [close, open]);
  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  // The orb follows the audio level.
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
  }, [lines, notice, working]);

  const statusText = connecting
    ? "Connecting…"
    : working
      ? "Working on it…"
      : connected
        ? mode === "voice"
          ? isSpeaking
            ? "Talking"
            : isMuted
              ? "Mic muted"
              : "Listening…"
          : "Ready"
        : voice
          ? "Voice or chat · runs Rainmaker for you"
          : "Opens screens and explains features";

  if (!open) return null;

  return (
    <section className="copilot-panel" aria-label="Copilot" data-copilot-ignore>
      <div className="cp-head">
        <span ref={orbRef} className={`orb tone-sky ${connected ? "" : "idle"}`} aria-hidden />
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>Copilot</b>
          <small aria-live="polite">{statusText}</small>
        </div>
        {connected && (
          <button type="button" className="btn ghost icon sm" onClick={() => endSession()} aria-label="End conversation" title="End conversation">
            <PhoneOff size={16} />
          </button>
        )}
        <button type="button" className="btn ghost icon sm" onClick={close} aria-label="Close the copilot">
          <X size={17} />
        </button>
      </div>

      <div className="cp-body" ref={scrollRef}>
        {!lines.length && (
          <div className="cp-intro">
            <span className="orb lg idle tone-sky" aria-hidden />
            <p>
              {voice
                ? `Hi${ownerName ? ` ${ownerName.split(" ")[0]}` : ""}. Tell me what to do in Rainmaker: I can open screens, click and fill things in, find clients, work your pipeline, write ads and explain any feature.`
                : "I can open any screen and explain how every feature works. Add ELEVENLABS_API_KEY and I'll also take actions for you, by voice or text."}
            </p>
            {voice && (
              <div className="row" style={{ gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                <button type="button" className="btn primary" onClick={() => void begin("voice")} disabled={connecting}>
                  <Mic size={15} /> Talk to it
                </button>
                <button type="button" className="btn" onClick={() => inputRef.current?.focus()}>
                  Type instead
                </button>
              </div>
            )}
            <div className="cp-suggest">
              {SUGGESTIONS.map((q) => (
                <button key={q} type="button" onClick={() => void ask(q)} disabled={connecting}>
                  <Sparkles size={13} aria-hidden /> {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {lines.map((l) =>
          l.role === "tool" ? (
            <div key={l.id} className="cp-line tool">
              <span>
                {/^Opened/.test(l.text) ? <ArrowUpRight size={12} aria-hidden /> : <MousePointerClick size={12} aria-hidden />} {l.text}
              </span>
            </div>
          ) : (
            <div key={l.id} className={`cp-line ${l.role}`}>
              {l.role === "system" ? <span>{l.text}</span> : <div className="say">{l.text}</div>}
            </div>
          )
        )}
        {working > 0 && (
          <div className="cp-line tool">
            <span className="cp-working">
              <i />
              <i />
              <i /> Working
            </span>
          </div>
        )}
      </div>

      {notice && <div className="cp-notice">{notice}</div>}

      <form
        className="cp-foot"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft;
          setDraft("");
          void ask(t);
        }}
      >
        {voice &&
          (connected && mode === "voice" ? (
            <button type="button" className={`cp-mic ${isMuted ? "muted" : "live"}`} onClick={() => setMuted(!isMuted)} aria-label={isMuted ? "Unmute" : "Mute"}>
              {isMuted ? <MicOff size={17} /> : <Mic size={17} />}
            </button>
          ) : (
            <button
              type="button"
              className="cp-mic"
              onClick={() => {
                if (!connected) return void begin("voice");
                switchToVoice.current = true;
                endSession();
              }}
              disabled={connecting}
              aria-label="Talk by voice"
              title="Talk by voice"
            >
              <Mic size={17} />
            </button>
          ))}
        <input
          ref={inputRef}
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={connected && mode === "voice" ? "Or type…" : "Tell the copilot what to do…"}
          aria-label="Message the copilot"
          maxLength={1000}
        />
        <button type="submit" className="btn primary icon" disabled={!draft.trim() || connecting} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </section>
  );
}
