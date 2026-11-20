"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CircleCheck, CircleX, ExternalLink, LoaderCircle, Play, Send, Square, Wrench } from "lucide-react";
import { api, useToast } from "@/components/client";
import { AgentAvatar } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import type { AgentRun, RunEvent } from "@/lib/types";

export type AgentLite = { id: string; name: string; role: string; description: string; icon: string; color: string; presets: string[]; tools: string[]; system: string };
export type RunLite = Omit<AgentRun, "events"> & { steps: number };

const TOOL_LABEL: Record<string, string> = {
  pipeline_summary: "Read your pipeline",
  find_businesses: "Search the map for businesses",
  audit_website: "Audit websites",
  save_leads: "Add leads to your pipeline",
  list_leads: "Look up leads",
  get_lead: "Read lead details",
  update_lead: "Update leads",
  draft_message: "Draft messages for your approval",
  create_ad_campaign: "Build ad campaigns",
  create_task: "Create tasks",
  list_tasks: "Read your to-dos",
  research_web: "Research the web (needs a Claude key)",
};

const STATUS: Record<string, { label: string; cls: string }> = {
  running: { label: "Working", cls: "brand" },
  waiting: { label: "Waiting", cls: "warm" },
  done: { label: "Done", cls: "good" },
  error: { label: "Problem", cls: "hot" },
  stopped: { label: "Stopped", cls: "" },
};

const RUNTIME: Record<string, string> = { managed: "Claude Managed Agents", messages: "Claude Messages API", demo: "Demo script" };

export function AgentConsole({
  agents,
  runs: initialRuns,
  initialAgent,
  initialGoal,
  claude,
}: {
  agents: AgentLite[];
  runs: RunLite[];
  initialAgent?: string;
  initialGoal?: string;
  claude: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [agentId, setAgentId] = useState(agents.find((a) => a.id === initialAgent)?.id ?? agents[0].id);
  const [goal, setGoal] = useState(initialGoal ?? "");
  const [runs, setRuns] = useState(initialRuns);
  const [run, setRun] = useState<AgentRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [reply, setReply] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const agent = agents.find((a) => a.id === agentId)!;
  const live = run && (run.status === "running" || run.status === "waiting");

  const load = useCallback(async (id: string) => {
    const res = await api<{ run: AgentRun }>(`/api/agents/runs/${id}`);
    setRun(res.run);
    return res.run;
  }, []);

  useEffect(() => {
    if (!run || !live) return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      try {
        const r = await load(run.id);
        if (r.status === "running" || r.status === "waiting") setTimeout(tick, 1200);
        else {
          setRuns((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: r.status, summary: r.summary, endedAt: r.endedAt } : x)));
          router.refresh();
        }
      } catch {
        setTimeout(tick, 2500);
      }
    };
    const t = setTimeout(tick, 900);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [run?.id, live, load, router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [run?.events.length]);

  async function start(e?: React.FormEvent) {
    e?.preventDefault();
    const text = goal.trim() || agent.presets[0];
    setStarting(true);
    try {
      const res = await api<{ run: AgentRun }>("/api/agents/runs", { method: "POST", json: { agentId, goal: text } });
      setRun(res.run);
      setRuns((rs) => [{ ...res.run, steps: 0 }, ...rs]);
      setGoal("");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setStarting(false);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!run || !reply.trim()) return;
    try {
      const res = await api<{ run: AgentRun }>(`/api/agents/runs/${run.id}`, { method: "POST", json: { action: "message", text: reply } });
      setRun(res.run);
      setReply("");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function stop() {
    if (!run) return;
    try {
      await api(`/api/agents/runs/${run.id}`, { method: "POST", json: { action: "stop" } });
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const runAgent = run ? agents.find((a) => a.id === run.agentId) : undefined;

  return (
    <div className="agents">
      <div className="stack" style={{ gap: 10 }}>
        {agents.map((a) => (
          <button
            key={a.id}
            className="agent-card"
            aria-pressed={a.id === agentId}
            onClick={() => {
              setAgentId(a.id);
              if (run && run.agentId !== a.id && !live) setRun(null);
            }}
          >
            <AgentAvatar icon={a.icon} color={a.color} />
            <span style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 650 }}>{a.name}</div>
              <div className="faint small">{a.role}</div>
              <div className="muted small" style={{ marginTop: 4 }}>
                {a.description}
              </div>
            </span>
          </button>
        ))}
        {runs.length > 0 && (
          <section className="card" style={{ marginTop: 6 }}>
            <div className="card-head">
              <h3>Recent runs</h3>
            </div>
            <div className="list" style={{ maxHeight: 380, overflowY: "auto" }}>
              {runs.slice(0, 20).map((r) => {
                const a = agents.find((x) => x.id === r.agentId);
                const s = STATUS[r.status] ?? STATUS.done;
                return (
                  <button key={r.id} className="list-item" onClick={() => void load(r.id).then((x) => setAgentId(x.agentId))} style={{ background: r.id === run?.id ? "var(--brand-soft)" : undefined }}>
                    {a && <AgentAvatar icon={a.icon} color={a.color} size="sm" />}
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <div className="truncate small" style={{ fontWeight: 600 }}>
                        {r.goal}
                      </div>
                      <div className="row small faint" style={{ gap: 6 }}>
                        <span className={`badge ${s.cls}`} style={{ height: 18 }}>
                          {s.label}
                        </span>
                        {timeAgo(r.startedAt)}
                      </div>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <section className="card" style={{ display: "flex", flexDirection: "column", minHeight: 560 }}>
        {!run ? (
          <>
            <div className="card-head" style={{ justifyContent: "flex-start", gap: 12 }}>
              <AgentAvatar icon={agent.icon} color={agent.color} />
              <div>
                <h2>{agent.name}</h2>
                <div className="faint small">{agent.role}</div>
              </div>
            </div>
            <div className="card-body stack" style={{ gap: 16 }}>
              <p className="muted" style={{ margin: 0 }}>
                {agent.description}
              </p>
              <div>
                <div className="label" style={{ marginBottom: 8 }}>
                  What it can do
                </div>
                <div className="chips">
                  {agent.tools.map((t) => (
                    <span key={t} className="chip">
                      <Wrench size={12} /> {TOOL_LABEL[t] ?? t}
                    </span>
                  ))}
                </div>
              </div>
              <form onSubmit={start} className="stack" style={{ gap: 10 }}>
                <label className="field">
                  <span>Give it a goal</span>
                  <textarea className="textarea" rows={3} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={agent.presets[0]} />
                </label>
                <div className="chips">
                  {agent.presets.map((p) => (
                    <button key={p} type="button" className="chip" onClick={() => setGoal(p)}>
                      {p}
                    </button>
                  ))}
                </div>
                <div className="row wrap">
                  <button className="btn primary lg" disabled={starting}>
                    {starting ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />} Run {agent.name}
                  </button>
                  <span className="faint small">{claude ? "Runs on Claude. It drafts; you approve." : "Demo mode: follows a fixed script using the real tools."}</span>
                </div>
              </form>
              <div className="tip neutral">
                <span>
                  Agents can read and update your pipeline, but they can&apos;t send anything. Every message lands in your{" "}
                  <Link href="/inbox" style={{ textDecoration: "underline" }}>
                    Inbox
                  </Link>{" "}
                  for approval.
                </span>
              </div>
              <button type="button" className="btn ghost sm" style={{ width: "fit-content" }} onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? "Hide" : "Show"} its instructions
              </button>
              {showPrompt && (
                <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0, padding: 14, borderRadius: 12, background: "var(--panel-2)", border: "1px solid var(--line)", maxHeight: 320, overflow: "auto" }}>
                  {agent.system}
                </pre>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="card-head">
              <div className="row" style={{ gap: 12, minWidth: 0 }}>
                {runAgent && <AgentAvatar icon={runAgent.icon} color={runAgent.color} />}
                <div style={{ minWidth: 0 }}>
                  <h2 className="truncate">{runAgent?.name ?? "Agent"}</h2>
                  <div className="row small faint wrap" style={{ gap: 8 }}>
                    <span className={`badge ${STATUS[run.status]?.cls ?? ""}`}>
                      {live && <LoaderCircle size={11} className="spin" />} {STATUS[run.status]?.label ?? run.status}
                    </span>
                    {RUNTIME[run.runtime]}
                    {run.usage?.costUsd !== undefined && <span>· ${run.usage.costUsd.toFixed(2)}</span>}
                    {run.usage && run.usage.costUsd === undefined && <span>· {(run.usage.inputTokens + run.usage.outputTokens).toLocaleString()} tokens</span>}
                  </div>
                </div>
              </div>
              <div className="row">
                {run.sessionId && (
                  <a className="btn sm ghost" href={`https://platform.claude.com/workspaces/default/sessions/${run.sessionId}`} target="_blank" rel="noreferrer">
                    Console <ExternalLink size={12} />
                  </a>
                )}
                {live ? (
                  <button className="btn sm" onClick={() => void stop()}>
                    <Square size={12} /> Stop
                  </button>
                ) : (
                  <button className="btn sm" onClick={() => setRun(null)}>
                    New run
                  </button>
                )}
              </div>
            </div>
            <div className="timeline" style={{ flex: 1, overflowY: "auto", maxHeight: 620 }}>
              {run.events.map((ev) => (
                <Step key={ev.id} ev={ev} />
              ))}
              {live && (
                <div className="step">
                  <span className="ic">
                    <LoaderCircle size={13} className="spin" />
                  </span>
                  <span className="muted pulse" style={{ paddingTop: 2 }}>
                    Working…
                  </span>
                </div>
              )}
              {!live && run.status === "done" && (
                <div className="row wrap" style={{ padding: "10px 18px 4px 56px", gap: 8 }}>
                  <Link href="/pipeline" className="btn sm">
                    Pipeline <ArrowRight size={13} />
                  </Link>
                  <Link href="/inbox" className="btn sm">
                    Inbox <ArrowRight size={13} />
                  </Link>
                  <Link href="/ads" className="btn sm">
                    Ad Studio <ArrowRight size={13} />
                  </Link>
                </div>
              )}
              <div ref={bottom} />
            </div>
            <form className="composer" onSubmit={send}>
              <input
                className="input"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={live ? "Wait for it to finish, or stop it" : run.runtime === "demo" ? "Follow-ups need a Claude API key" : "Ask a follow-up, e.g. now write emails for the top 3"}
                disabled={Boolean(live) || run.runtime === "demo"}
              />
              <button className="btn primary" disabled={Boolean(live) || !reply.trim() || run.runtime === "demo"}>
                <Send size={15} />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function Step({ ev }: { ev: RunEvent }) {
  if (ev.kind === "user")
    return (
      <div className="step msg">
        <span className="ic" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
          <Send size={12} />
        </span>
        <div className="bubble user">{ev.text}</div>
      </div>
    );
  if (ev.kind === "message")
    return (
      <div className="step msg">
        <span className="ic" style={{ background: "var(--violet-soft)", color: "var(--violet)" }}>
          <CircleCheck size={13} />
        </span>
        <div className="bubble">{ev.text}</div>
      </div>
    );
  if (ev.kind === "tool_call")
    return (
      <div className="step">
        <span className="ic">
          <Wrench size={12} />
        </span>
        <span style={{ paddingTop: 2, fontWeight: 550 }}>{ev.text}</span>
      </div>
    );
  if (ev.kind === "tool_result")
    return (
      <div className={`step ${ev.ok ? "ok" : "bad"}`}>
        <span className="ic">{ev.ok ? <CircleCheck size={13} /> : <CircleX size={13} />}</span>
        <span className="muted small" style={{ paddingTop: 3 }}>
          {ev.text}
        </span>
      </div>
    );
  if (ev.kind === "error")
    return (
      <div className="step bad">
        <span className="ic">
          <CircleX size={13} />
        </span>
        <span style={{ color: "var(--hot)", paddingTop: 2 }}>{ev.text}</span>
      </div>
    );
  if (ev.kind === "thinking")
    return (
      <div className="step">
        <span className="ic">
          <LoaderCircle size={12} />
        </span>
        <span className="faint small" style={{ paddingTop: 3 }}>
          Thinking
        </span>
      </div>
    );
  return (
    <div className="step">
      <span className="ic">
        <ArrowRight size={12} />
      </span>
      <span className="faint small" style={{ paddingTop: 3 }}>
        {ev.text}
      </span>
    </div>
  );
}
