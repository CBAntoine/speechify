"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import {
  ConversationProvider,
  useConversationClientTool,
  useConversationControls,
  useConversationInput,
  useConversationMode,
  useConversationStatus,
} from "@elevenlabs/react";

// The conversation with the engineer: an ElevenLabs voice and chat agent whose
// tools run here, in the browser. Tool names match src/voice/spec.ts.

export type Params = Record<string, unknown>;
export type ToolName =
  | "get_workspace"
  | "load_sample"
  | "start_review"
  | "check_review"
  | "answer_approval"
  | "get_findings"
  | "get_finding"
  | "draft_change"
  | "show"
  | "get_workflow";
export type ToolHandlers = Record<ToolName, (p: Params) => Promise<string> | string>;

const LABELS: Record<ToolName, (p: Params) => string> = {
  get_workspace: () => "Checking the workspace",
  load_sample: () => "Loading the sample firewall",
  start_review: (p) => (p.confirmed === true ? "Starting the review" : "Checking before starting a review"),
  check_review: () => "Checking the review",
  answer_approval: (p) => (p.allow === true ? "Allowing the waiting call" : "Declining the waiting call"),
  get_findings: () => "Reading the findings",
  get_finding: (p) => `Opening ${typeof p.finding_id === "string" ? p.finding_id : "a finding"}`,
  draft_change: () => "Drafting the change",
  show: (p) => `Opening ${typeof p.view === "string" ? p.view : "a view"}`,
  get_workflow: (p) => `Looking up ${typeof p.workflow === "string" ? p.workflow : "a workflow"}`,
};

type Line = { id: number; role: "user" | "agent" | "tool" | "system"; text: string };

const SUGGESTIONS = ["Review the sample firewall", "What did you find?", "Explain the worst finding", "Which workflows can you run?"];

function friendly(msg: string): string {
  if (/permission|notallowed|microphone|getUserMedia/i.test(msg)) return "Your microphone is blocked. Allow it in the browser, or type instead.";
  if (/network|websocket|failed to fetch|livekit/i.test(msg)) return "The connection dropped. Check your internet and try again.";
  return msg.length < 200 ? msg : "Something went wrong with the conversation. Try again.";
}

export interface VoiceProps {
  /** Why voice can't start, or null when it can. */
  unavailable: string | null;
  tools: ToolHandlers;
  /** Set by this component: tells the agent about something that happened on the page. */
  notifyRef: MutableRefObject<((text: string) => void) | null>;
  /** A one-line summary of the workspace, given to the agent when the conversation starts. */
  workspace: () => string;
}

export function Voice(props: VoiceProps) {
  return (
    <ConversationProvider>
      <VoiceInner {...props} />
    </ConversationProvider>
  );
}

function VoiceInner({ unavailable, tools, notifyRef, workspace }: VoiceProps) {
  const { startSession, endSession, sendUserMessage, sendContextualUpdate, getInputVolume, getOutputVolume } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const { isMuted, setMuted } = useConversationInput();
  const [lines, setLines] = useState<Line[]>([]);
  const [mode, setMode] = useState<"voice" | "text" | null>(null);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const nextId = useRef(1);
  const pendingText = useRef<string | null>(null);
  const orbRef = useRef<HTMLSpanElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const connected = status === "connected";
  const connecting = busy || status === "connecting";

  const push = useCallback((role: Line["role"], text: string) => {
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.text === text) return prev;
      return [...prev.slice(-150), { id: nextId.current++, role, text }];
    });
  }, []);

  const run = useCallback(
    (name: ToolName) => async (p?: Params) => {
      const params = p ?? {};
      push("tool", LABELS[name](params));
      setWorking((n) => n + 1);
      try {
        return await toolsRef.current[name](params);
      } catch (err) {
        return `That didn't work: ${err instanceof Error ? err.message : String(err)}`;
      } finally {
        setWorking((n) => Math.max(0, n - 1));
      }
    },
    [push],
  );

  useConversationClientTool("get_workspace", run("get_workspace"));
  useConversationClientTool("load_sample", run("load_sample"));
  useConversationClientTool("start_review", run("start_review"));
  useConversationClientTool("check_review", run("check_review"));
  useConversationClientTool("answer_approval", run("answer_approval"));
  useConversationClientTool("get_findings", run("get_findings"));
  useConversationClientTool("get_finding", run("get_finding"));
  useConversationClientTool("draft_change", run("draft_change"));
  useConversationClientTool("show", run("show"));
  useConversationClientTool("get_workflow", run("get_workflow"));

  // The page tells the agent when something finishes while you talk.
  useEffect(() => {
    notifyRef.current = (text: string) => {
      push("system", text);
      if (connected) sendContextualUpdate(text);
    };
    return () => {
      notifyRef.current = null;
    };
  }, [connected, notifyRef, push, sendContextualUpdate]);

  const begin = useCallback(
    async (nextMode: "voice" | "text") => {
      if (unavailable) {
        setNotice(unavailable);
        return;
      }
      setNotice(null);
      setBusy(true);
      try {
        const res = await fetch("/api/voice/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: nextMode }) });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; auth?: { conversationToken: string } | { signedUrl: string } };
        if (!res.ok || !data.ok || !data.auth) {
          setNotice(data.error ?? "The engineer isn't available right now.");
          pendingText.current = null;
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
            today: new Date().toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
            workspace: workspace(),
            replies: nextMode === "voice" ? "spoken aloud" : "read on screen",
          },
          onConnect: () => {
            push("system", nextMode === "voice" ? "Connected. Start talking." : "Connected.");
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
            console.warn("[engineer]", msg);
            setNotice(friendly(msg));
          },
        });
      } catch (err) {
        setNotice(friendly(err instanceof Error ? err.message : String(err)));
      } finally {
        setBusy(false);
      }
    },
    [push, sendUserMessage, startSession, unavailable, workspace],
  );

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

  const statusText = unavailable && !connected
    ? "Voice isn't set up"
    : connecting
    ? "Connecting…"
    : working
      ? "Working on it…"
      : connected
        ? mode === "voice"
          ? isSpeaking
            ? "Talking"
            : isMuted
              ? "Muted"
              : "Listening"
          : "Chatting"
        : "Ready";

  return (
    <section className="voice" aria-label="Conversation with the engineer">
      <div className="voice-head">
        <button
          type="button"
          className={`orb-btn ${connected && mode === "voice" ? "live" : ""}`}
          onClick={() => (connected ? endSession() : void begin("voice"))}
          disabled={connecting}
          aria-label={connected ? "End the conversation" : "Talk to the engineer"}
        >
          <span ref={orbRef} className={`orb ${isSpeaking ? "speaking" : ""}`} aria-hidden="true" />
        </button>
        <div className="voice-title">
          <strong>Engineer</strong>
          <small aria-live="polite">{statusText}</small>
        </div>
        {connected && mode === "voice" ? (
          <button type="button" className="btn ghost sm" onClick={() => setMuted(!isMuted)}>
            {isMuted ? "Unmute" : "Mute"}
          </button>
        ) : null}
        {connected ? (
          <button type="button" className="btn ghost sm" onClick={() => endSession()}>
            End
          </button>
        ) : null}
      </div>

      <div className="transcript" ref={scrollRef}>
        {lines.length === 0 ? (
          <div className="empty">
            {unavailable ? <p className="line notice">{unavailable} The buttons on the right still work.</p> : null}
            <p>Press the circle and talk, or type below. Try:</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          lines.map((l) => (
            <p key={l.id} className={`line ${l.role}`}>
              {l.text}
            </p>
          ))
        )}
        {working ? <p className="line tool working">Working…</p> : null}
        {notice ? <p className="line notice">{notice}</p> : null}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft;
          setDraft("");
          void ask(t);
        }}
      >
        <label htmlFor="ask" className="sr">
          Message the engineer
        </label>
        <input id="ask" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type to the engineer…" autoComplete="off" />
        <button type="submit" className="btn" disabled={!draft.trim() || connecting}>
          Send
        </button>
      </form>
    </section>
  );
}
