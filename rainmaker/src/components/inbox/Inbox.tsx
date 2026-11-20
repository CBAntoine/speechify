"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, Check, ExternalLink, Inbox as InboxIcon, LoaderCircle, Mail, MessageSquare, PhoneCall, Plus, Send, Share2, Trash, User } from "lucide-react";
import { api, CopyButton, useToast } from "@/components/client";
import { shareOrCopy, useCanShare } from "@/components/pwa";
import { AgentAvatar, Empty } from "@/components/ui";
import { dueLabel, timeAgo } from "@/lib/format";
import type { Draft, Task } from "@/lib/types";

type AgentLite = { id: string; name: string; icon: string; color: string };

const CHANNEL = {
  email: { label: "Email", icon: Mail },
  sms: { label: "Text", icon: MessageSquare },
  dm: { label: "DM", icon: MessageSquare },
  call: { label: "Call script", icon: PhoneCall },
} as const;

export function Inbox({ drafts: initial, tasks: initialTasks, agents, resend, leads }: { drafts: Draft[]; tasks: Task[]; agents: AgentLite[]; resend: boolean; leads: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [drafts, setDrafts] = useState(initial);
  const [tasks, setTasks] = useState(initialTasks);
  const [tab, setTab] = useState<"pending" | "sent" | "discarded">("pending");
  const [selId, setSelId] = useState<string | undefined>(initial.find((d) => d.status === "pending")?.id);
  // Phones show the list or one message at a time.
  const [view, setView] = useState<"list" | "detail">("list");
  const shareable = useCanShare();
  const [edit, setEdit] = useState({ to: "", subject: "", body: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [newTask, setNewTask] = useState("");

  useEffect(() => setDrafts(initial), [initial]);
  useEffect(() => setTasks(initialTasks), [initialTasks]);

  const list = useMemo(() => drafts.filter((d) => d.status === tab), [drafts, tab]);
  const sel = drafts.find((d) => d.id === selId);

  useEffect(() => {
    if (sel) setEdit({ to: sel.to ?? "", subject: sel.subject ?? "", body: sel.body });
  }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = { pending: drafts.filter((d) => d.status === "pending").length, sent: drafts.filter((d) => d.status === "sent").length, discarded: drafts.filter((d) => d.status === "discarded").length };
  const who = (d: Draft) => agents.find((a) => `agent:${a.id}` === d.createdBy);

  function after(updated: Draft, msg: string) {
    setDrafts((ds) => ds.map((d) => (d.id === updated.id ? updated : d)));
    const next = drafts.find((d) => d.status === "pending" && d.id !== updated.id);
    setSelId(next?.id);
    setView("list");
    toast(msg);
    router.refresh();
  }

  async function send(manual: boolean) {
    if (!sel) return;
    setBusy(manual ? "manual" : "send");
    try {
      const res = await api<{ draft: Draft }>(`/api/drafts/${sel.id}/send`, { method: "POST", json: { ...edit, manual } });
      after(res.draft, manual ? "Marked as sent" : `Sent to ${edit.to}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function discard() {
    if (!sel) return;
    try {
      const res = await api<{ draft: Draft }>(`/api/drafts/${sel.id}`, { method: "PATCH", json: { status: "discarded" } });
      after(res.draft, "Discarded");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function saveEdits() {
    if (!sel) return;
    try {
      const res = await api<{ draft: Draft }>(`/api/drafts/${sel.id}`, { method: "PATCH", json: edit });
      setDrafts((ds) => ds.map((d) => (d.id === sel.id ? res.draft : d)));
      toast("Saved");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function toggleTask(t: Task) {
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)));
    try {
      await api(`/api/tasks/${t.id}`, { method: "PATCH", json: { done: !t.done } });
      router.refresh();
    } catch (e) {
      setTasks((ts) => ts.map((x) => (x.id === t.id ? t : x)));
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    const due = new Date();
    due.setDate(due.getDate() + 1);
    due.setHours(17, 0, 0, 0);
    try {
      const res = await api<{ task: Task }>("/api/tasks", { method: "POST", json: { title: newTask, due: due.toISOString() } });
      setTasks((ts) => [res.task, ...ts]);
      setNewTask("");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const mailto = sel ? `mailto:${encodeURIComponent(edit.to)}?subject=${encodeURIComponent(edit.subject)}&body=${encodeURIComponent(edit.body)}` : "#";
  const smsHref = sel ? `sms:${edit.to.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(edit.body)}` : "#";
  const openTasks = tasks.filter((t) => !t.done);
  const doneTasks = tasks.filter((t) => t.done).slice(0, 5);
  const leadName = (id?: string) => leads.find((l) => l.id === id)?.name;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="studio inbox-split" data-view={view}>
        <section className="card inbox-list" style={{ overflow: "hidden" }}>
          <div className="card-head">
            <div className="tabs">
              {(["pending", "sent", "discarded"] as const).map((t) => (
                <button key={t} className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                  {t === "pending" ? "Waiting" : t === "sent" ? "Sent" : "Discarded"} {counts[t] > 0 && <span className="faint">{counts[t]}</span>}
                </button>
              ))}
            </div>
          </div>
          {list.length ? (
            <div className="list" style={{ maxHeight: 560, overflowY: "auto" }}>
              {list.map((d) => {
                const a = who(d);
                const C = CHANNEL[d.channel];
                return (
                  <button
                    key={d.id}
                    className="list-item"
                    onClick={() => {
                      setSelId(d.id);
                      setView("detail");
                      window.scrollTo({ top: 0 });
                    }}
                    style={{ background: d.id === selId ? "var(--brand-soft)" : undefined }}
                  >
                    {a ? (
                      <AgentAvatar icon={a.icon} color={a.color} size="sm" />
                    ) : (
                      <span className="feed-dot">
                        <User size={14} />
                      </span>
                    )}
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="row" style={{ gap: 6 }}>
                        <b className="truncate small" style={{ flex: 1 }}>
                          {d.leadName ?? d.to ?? "No lead"}
                        </b>
                        <span className="faint small nowrap">{timeAgo(d.sentAt ?? d.createdAt)}</span>
                      </span>
                      <span className="row small muted" style={{ gap: 5 }}>
                        <C.icon size={12} /> {C.label}
                        {d.sample && <span className="badge warm" style={{ height: 18 }}>Sample</span>}
                      </span>
                      <span className="faint small truncate" style={{ display: "block" }}>
                        {d.subject || d.body.split("\n").find((x) => x.trim())}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <Empty icon={<InboxIcon size={18} />} title={tab === "pending" ? "Nothing waiting" : "Nothing here yet"}>
              {tab === "pending" ? "Ask the Outreach Writer to draft first touches for your best leads." : undefined}
            </Empty>
          )}
        </section>

        <section className="card inbox-detail">
          {sel ? (
            <>
              <div className="card-head">
                <button className="btn ghost icon sm inbox-back" onClick={() => setView("list")} aria-label="Back to messages">
                  <ArrowLeft size={18} />
                </button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h2 className="truncate">{sel.leadName ?? "Message"}</h2>
                  <div className="faint small">
                    {CHANNEL[sel.channel].label} · written by {who(sel)?.name ?? "you"} {timeAgo(sel.createdAt)}
                  </div>
                </div>
                {sel.leadId && (
                  <Link href={`/pipeline?lead=${sel.leadId}`} className="btn sm ghost">
                    Lead <ExternalLink size={12} />
                  </Link>
                )}
              </div>
              <div className="card-body stack">
                {sel.rationale && (
                  <div className="tip neutral">
                    <span>
                      <b>Why this message:</b> {sel.rationale}
                    </span>
                  </div>
                )}
                {sel.channel !== "call" && sel.channel !== "dm" && (
                  <label className="field">
                    <span>{sel.channel === "email" ? "To (email)" : "To (phone)"}</span>
                    <input className="input" value={edit.to} onChange={(e) => setEdit({ ...edit, to: e.target.value })} placeholder={sel.channel === "email" ? "owner@business.com" : "(555) 555-0100"} disabled={sel.status !== "pending"} />
                  </label>
                )}
                {sel.channel === "email" && (
                  <label className="field">
                    <span>Subject</span>
                    <input className="input" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} disabled={sel.status !== "pending"} />
                  </label>
                )}
                <label className="field">
                  <span>{sel.channel === "call" ? "Script" : "Message"}</span>
                  <textarea className="textarea" rows={13} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} disabled={sel.status !== "pending"} />
                  <small>
                    {edit.body.trim().split(/\s+/).filter(Boolean).length} words
                    {sel.channel === "sms" ? ` · ${edit.body.length} characters` : ""}
                  </small>
                </label>
                {sel.error && (
                  <div className="tip warn">
                    <span>Last send failed: {sel.error}</span>
                  </div>
                )}
                {sel.status === "pending" ? (
                  <div className="row wrap">
                    {sel.channel === "email" && resend && (
                      <button className="btn primary" onClick={() => void send(false)} disabled={busy !== null}>
                        {busy === "send" ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />} Approve and send
                      </button>
                    )}
                    {sel.channel === "email" && !resend && (
                      <a className="btn primary" href={mailto}>
                        <Mail size={15} /> Open in my email
                      </a>
                    )}
                    {sel.channel === "sms" && (
                      <a className="btn primary" href={smsHref}>
                        <MessageSquare size={15} /> Open in Messages
                      </a>
                    )}
                    <CopyButton text={sel.channel === "email" ? `Subject: ${edit.subject}\n\n${edit.body}` : edit.body} className="btn" />
                    {shareable && (
                      <button className="btn" onClick={() => void shareOrCopy({ title: sel.channel === "email" ? edit.subject : undefined, text: edit.body })}>
                        <Share2 size={15} /> Share
                      </button>
                    )}
                    <button className="btn" onClick={() => void send(true)} disabled={busy !== null}>
                      <Check size={15} /> {sel.channel === "call" ? "Mark as called" : "Mark as sent"}
                    </button>
                    <span className="spacer" />
                    <button className="btn ghost" onClick={() => void saveEdits()}>
                      Save edits
                    </button>
                    <button className="btn ghost danger" onClick={() => void discard()}>
                      <Trash size={15} /> Discard
                    </button>
                  </div>
                ) : (
                  <div className="row">
                    <span className={`badge ${sel.status === "sent" ? "good" : ""}`}>
                      {sel.status === "sent" ? `Sent ${sel.sentVia === "resend" ? "by Rainmaker" : "by you"} ${timeAgo(sel.sentAt)}` : "Discarded"}
                    </span>
                  </div>
                )}
                {sel.channel === "email" && !resend && sel.status === "pending" && (
                  <div className="faint small">Tip: set RESEND_API_KEY and RESEND_FROM to send straight from here. Until then, &ldquo;Open in my email&rdquo; fills in your own mail app.</div>
                )}
              </div>
            </>
          ) : (
            <Empty icon={<Mail size={18} />} title="Pick a message">
              Everything your agents write lands here first. Edit it, then send it or mark it sent.
            </Empty>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>To-do</h2>
          <span className="faint small">{openTasks.length} open</span>
        </div>
        <form className="row" style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)" }} onSubmit={addTask}>
          <input className="input" value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Add a task, e.g. Call Copperline about the proposal" />
          <button className="btn" type="submit">
            <Plus size={15} /> Add
          </button>
        </form>
        <div className="list">
          {[...openTasks, ...doneTasks].map((t) => {
            const d = dueLabel(t.due);
            return (
              <div key={t.id} className="list-item" style={{ alignItems: "center" }}>
                <input type="checkbox" className="check" checked={t.done} onChange={() => void toggleTask(t)} aria-label={`Mark ${t.title} done`} />
                <span style={{ flex: 1, minWidth: 0, textDecoration: t.done ? "line-through" : undefined, color: t.done ? "var(--text-3)" : undefined }}>
                  <div className="truncate">{t.title}</div>
                  {leadName(t.leadId) && (
                    <Link href={`/pipeline?lead=${t.leadId}`} className="faint small">
                      {leadName(t.leadId)}
                    </Link>
                  )}
                </span>
                {!t.done && (
                  <span className={`badge ${d.overdue ? "hot" : ""}`}>
                    <CalendarClock size={12} /> {d.text}
                  </span>
                )}
                {t.createdBy.startsWith("agent:") && <span className="badge violet">Agent</span>}
              </div>
            );
          })}
          {tasks.length === 0 && <div className="faint small" style={{ padding: 18 }}>No tasks. The Chief of Staff agent can set them for you.</div>}
        </div>
      </section>
    </div>
  );
}
