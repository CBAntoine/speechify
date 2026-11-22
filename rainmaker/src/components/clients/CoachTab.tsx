"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ConversationProvider, useConversationControls, useConversationMode, useConversationStatus } from "@elevenlabs/react";
import { ClipboardCheck, LoaderCircle, Mic, PhoneOff, Send, Trash, Upload } from "lucide-react";
import { useToast } from "@/components/client";
import { SCENARIOS } from "@/lib/clients/practice";
import type { WorkspaceView } from "@/lib/clients/view";
import { timeAgo } from "@/lib/format";
import type { CallReview, Scorecard } from "@/lib/types";
import { Field, ServiceHeader, useAct } from "./shared";

function ScoreCard({ s }: { s: Scorecard }) {
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 14 }}>
        <span className={`big-score ${s.overall >= 75 ? "good" : s.overall >= 50 ? "warm" : "hot"}`}>{s.overall}</span>
        <p className="muted small" style={{ margin: 0 }}>{s.summary}</p>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {s.scores.map((x) => (
          <div key={x.id} className="skill-row">
            <span className="small" style={{ fontWeight: 600 }}>{x.label}</span>
            <span className="skill-bar" aria-label={`${x.score} of 5`}>
              {[1, 2, 3, 4, 5].map((n) => (
                <i key={n} className={n <= x.score ? "on" : ""} />
              ))}
            </span>
            <span className="faint small">{x.note}</span>
          </div>
        ))}
      </div>
      {s.strengths.length > 0 && (
        <div>
          <b className="small">Did well</b>
          <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {s.strengths.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {s.fixes.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <b className="small">Next time</b>
          {s.fixes.map((f, i) => (
            <div key={i} className="fix">
              <b className="small">{f.issue}</b>
              <div className="small">{f.instead}</div>
            </div>
          ))}
        </div>
      )}
      <span className="faint small">{s.by === "ai" ? "Scored by Claude" : "Scored by the built-in rules (add a Claude key for line-by-line coaching)"}</span>
    </div>
  );
}

type Line = { who: "rep" | "customer" | "system"; text: string };

function PracticeInner({ view, rep, onScored }: { view: WorkspaceView; rep: string; onScored: (r: CallReview) => void }) {
  const c = view.client;
  const toast = useToast();
  const { startSession, endSession, sendUserMessage } = useConversationControls();
  const { status } = useConversationStatus();
  const { isSpeaking } = useConversationMode();
  const [scenario, setScenario] = useState(SCENARIOS[0].id);
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState("");
  const [mode, setMode] = useState<"voice" | "text" | null>(null);
  const [scoring, setScoring] = useState(false);
  const [starting, setStarting] = useState(false);
  const convId = useRef<string | null>(null);
  const connected = status === "connected";
  const meta = SCENARIOS.find((s) => s.id === scenario)!;

  const score = useCallback(async () => {
    const id = convId.current;
    convId.current = null;
    if (!id) return;
    setScoring(true);
    try {
      const res = await fetch(`/api/clients/${c.id}/coach`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: id, rep, title: `Practice: ${meta.label}` }) });
      const data = (await res.json()) as { review?: CallReview; error?: string };
      if (!res.ok || !data.review) throw new Error(data.error ?? "Couldn't score the call");
      onScored(data.review);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setScoring(false);
    }
  }, [c.id, meta.label, onScored, rep, toast]);

  const start = async (m: "voice" | "text") => {
    setStarting(true);
    setLines([]);
    try {
      const res = await fetch(`/api/clients/${c.id}/practice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario, mode: m }) });
      const data = (await res.json()) as { auth?: { conversationToken: string } | { signedUrl: string }; variables?: Record<string, string>; language?: "en" | "es" | "fr"; error?: string };
      if (!res.ok || !data.auth) throw new Error(data.error ?? "Practice calls aren't available right now");
      const auth = "conversationToken" in data.auth ? { conversationToken: data.auth.conversationToken, connectionType: "webrtc" as const } : { signedUrl: data.auth.signedUrl, connectionType: "websocket" as const };
      setMode(m);
      startSession({
        ...auth,
        textOnly: m === "text",
        dynamicVariables: data.variables,
        ...(data.language && data.language !== "en" ? { overrides: { agent: { language: data.language } } } : {}),
        onConnect: ({ conversationId }: { conversationId: string }) => {
          convId.current = conversationId;
          setLines((l) => [...l, { who: "system", text: m === "voice" ? "Connected. You're answering the phone: say hello." : "Connected. The customer writes first." }]);
        },
        onMessage: ({ message, role }: { message?: string; role?: string }) => {
          if (message?.trim()) setLines((l) => [...l, { who: role === "agent" ? "customer" : "rep", text: message }]);
        },
        onDisconnect: () => {
          setMode(null);
          void score();
        },
        onError: (msg: string) => toast(msg, "error"),
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="grid-2" style={{ gap: 12 }}>
        <Field label="Scenario" hint={meta.tip}>
          <select className="select" value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={connected}>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <div className="row wrap" style={{ gap: 8, alignSelf: "end", paddingBottom: 4 }}>
          {connected ? (
            <button className="btn danger" onClick={() => endSession()}>
              <PhoneOff size={14} /> End and score
            </button>
          ) : (
            <>
              <button className="btn primary" disabled={starting || scoring || !view.integrations.eleven} onClick={() => void start("voice")}>
                {starting ? <LoaderCircle size={14} className="spin" /> : <Mic size={14} />} Practice by voice
              </button>
              <button className="btn" disabled={starting || scoring || !view.integrations.eleven} onClick={() => void start("text")}>
                Practice by chat
              </button>
            </>
          )}
        </div>
      </div>
      {!view.integrations.eleven && <p className="faint small" style={{ margin: 0 }}>Practice calls need ELEVENLABS_API_KEY. Scoring pasted transcripts works without it.</p>}
      {(lines.length > 0 || scoring) && (
        <div className="practice-log">
          {lines.map((l, i) => (
            <div key={i} className={`msg ${l.who === "rep" ? "out" : l.who === "customer" ? "in" : "sys"}`}>
              {l.who !== "system" && <span className="faint small">{l.who === "rep" ? rep || "You" : "Customer"}</span>}
              <div>{l.text}</div>
            </div>
          ))}
          {connected && mode === "voice" && <div className="faint small">{isSpeaking ? "Customer is speaking…" : "Listening…"}</div>}
          {scoring && (
            <div className="faint small">
              <LoaderCircle size={13} className="spin" style={{ display: "inline", verticalAlign: -2 }} /> Scoring the call…
            </div>
          )}
        </div>
      )}
      {connected && mode === "text" && (
        <form
          className="copy-field"
          onSubmit={(e) => {
            e.preventDefault();
            const t = typed.trim();
            if (!t) return;
            setLines((l) => [...l, { who: "rep", text: t }]);
            sendUserMessage(t);
            setTyped("");
          }}
        >
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Your reply" aria-label="Your reply" />
          <button className="btn primary" type="submit">
            <Send size={14} />
          </button>
        </form>
      )}
    </div>
  );
}

export function CoachTab({ view }: { view: WorkspaceView }) {
  const c = view.client;
  const toast = useToast();
  const { act, busy } = useAct();
  const [rep, setRep] = useState("");
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [uploading, setUploading] = useState(false);
  const [latest, setLatest] = useState<CallReview | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const reviews = view.reviews;
  const byRep = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const r of reviews) m.set(r.rep, [...(m.get(r.rep) ?? []), r.scorecard.overall]);
    return [...m].map(([name, xs]) => ({ name, n: xs.length, avg: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) })).sort((a, b) => b.avg - a.avg);
  }, [reviews]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("rep", rep);
      form.append("title", title || file.name);
      const res = await fetch(`/api/clients/${c.id}/coach`, { method: "POST", body: form });
      const data = (await res.json()) as { review?: CallReview; error?: string };
      if (!res.ok || !data.review) throw new Error(data.error ?? "Couldn't transcribe it");
      setLatest(data.review);
      toast("Recording transcribed and scored");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <ServiceHeader client={c} id="sales_coach">
        <div className="grid-3" style={{ gap: 12 }}>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Calls reviewed this month</span>
            <b className="metric">{view.month.coaching.reviewed}</b>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Average score</span>
            <b className="metric">{view.month.coaching.average ?? "–"}</b>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            <span className="faint small">Team</span>
            <b className="small">{byRep.map((r) => `${r.name} ${r.avg}`).join(" · ") || "–"}</b>
          </div>
        </div>
      </ServiceHeader>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>Review a real call</h3>
            <label className={`btn sm ${uploading ? "disabled" : ""}`}>
              {uploading ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />} Upload recording
              <input type="file" accept="audio/*,video/*" hidden disabled={uploading || !view.integrations.eleven} onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            </label>
          </div>
          <div className="card-body stack" style={{ gap: 12 }}>
            <div className="grid-2" style={{ gap: 12 }}>
              <Field label="Who handled it">
                <input className="input" value={rep} onChange={(e) => setRep(e.target.value)} placeholder="e.g. Sam" />
              </Field>
              <Field label="Call name (optional)">
                <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Quote request, Tuesday" />
              </Field>
            </div>
            <Field label="Transcript" hint={view.integrations.eleven ? "Or upload a recording: it's transcribed with who said what." : "One turn per line, like Rep: … and Customer: …"}>
              <textarea className="textarea" rows={8} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={"Rep: Thanks for calling, this is Sam. How can I help?\nCustomer: Hi, how much is a cleaning?"} />
            </Field>
            <button
              className="btn primary"
              style={{ alignSelf: "flex-start" }}
              disabled={!transcript.trim() || Boolean(busy)}
              onClick={async () => {
                const r = await act<{ review: CallReview; note?: string }>("score", `/api/clients/${c.id}/coach`, { method: "POST", json: { transcript, rep, title } }, (r) => r.note ?? `Scored ${r.review.scorecard.overall}/100`);
                if (r) {
                  setLatest(r.review);
                  setTranscript("");
                }
              }}
            >
              {busy === "score" ? <LoaderCircle size={14} className="spin" /> : <ClipboardCheck size={14} />} Score it
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>Practise with a tough customer</h3>
          </div>
          <div className="card-body">
            <ConversationProvider>
              <PracticeInner view={view} rep={rep} onScored={(r) => setLatest(r)} />
            </ConversationProvider>
          </div>
        </section>
      </div>

      {latest && (
        <section className="card">
          <div className="card-head">
            <h3 style={{ margin: 0 }}>{latest.title}</h3>
            <span className="faint small">{latest.rep}</span>
          </div>
          <div className="card-body">
            <ScoreCard s={latest.scorecard} />
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h3 style={{ margin: 0 }}>History</h3>
        </div>
        {reviews.length ? (
          <div className="list">
            {reviews.map((r) => (
              <div key={r.id} className="list-item" style={{ display: "block" }}>
                <div className="row between" style={{ gap: 8 }}>
                  <button type="button" className="link-btn" style={{ textAlign: "left" }} onClick={() => setOpen(open === r.id ? null : r.id)}>
                    <b>{r.title}</b> <span className="faint small">· {r.rep} · {timeAgo(r.createdAt)} · {r.source}</span>
                  </button>
                  <span className="row" style={{ gap: 6 }}>
                    <span className={`badge ${r.scorecard.overall >= 75 ? "good" : r.scorecard.overall >= 50 ? "warm" : "hot"}`}>{r.scorecard.overall}</span>
                    <button className="btn ghost icon sm" aria-label="Delete review" onClick={() => void act(`del:${r.id}`, `/api/clients/${c.id}/coach?review=${r.id}`, { method: "DELETE" }, "Deleted")}>
                      <Trash size={13} />
                    </button>
                  </span>
                </div>
                {open === r.id && (
                  <div style={{ marginTop: 10 }}>
                    <ScoreCard s={r.scorecard} />
                    <details style={{ marginTop: 10 }}>
                      <summary className="small" style={{ cursor: "pointer" }}>Transcript</summary>
                      <pre className="code-block">{r.transcript}</pre>
                    </details>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="card-body faint small">No calls reviewed yet.</div>
        )}
      </section>
    </div>
  );
}
