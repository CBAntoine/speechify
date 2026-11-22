"use client";

import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, CalendarCheck, Check, CheckCheck, LoaderCircle, Mail, MessageCircle, Phone, Send, Trash, UserCheck } from "lucide-react";
import { api, useToast } from "@/components/client";
import { Empty } from "@/components/ui";
import type { WorkspaceView } from "@/lib/clients/view";
import { timeAgo } from "@/lib/format";
import { displayPhone } from "@/lib/phone";
import type { ClientMessage, Contact, MsgChannel } from "@/lib/types";
import { useAct } from "./shared";

const PURPOSE: Record<string, string> = { nurture: "Follow-up", reactivation: "Win-back", review: "Review ask", referral: "Referral ask", missed_call: "Missed-call text", reply: "Reply", manual: "You", opt_out: "Opt-out confirmation", alert: "Alert" };
const BY: Record<string, string> = { ai: "AI", template: "Template", staff: "Staff", contact: "" };

function Draft({ m, clientId, onDone }: { m: ClientMessage; clientId: string; onDone: () => void }) {
  const { act, busy } = useAct();
  const [body, setBody] = useState(m.body);
  const [subject, setSubject] = useState(m.subject ?? "");
  return (
    <div className="stack" style={{ gap: 6 }}>
      {m.channel === "email" && <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />}
      <textarea className="textarea" rows={Math.min(8, Math.max(3, Math.ceil(body.length / 60)))} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Draft message" />
      {m.error && <span className={`small ${m.status === "failed" ? "hot-text" : "faint"}`}>{m.error}</span>}
      <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
        <button className="btn ghost sm" disabled={Boolean(busy)} onClick={async () => { if (await act("discard", `/api/clients/${clientId}/messages`, { method: "POST", json: { action: "discard", messageId: m.id } }, "Discarded")) onDone(); }}>
          <Trash size={13} /> Discard
        </button>
        <button className="btn primary sm" disabled={Boolean(busy)} onClick={async () => { if (await act("approve", `/api/clients/${clientId}/messages`, { method: "POST", json: { action: "approve", messageId: m.id, body, subject } }, (r: { message: ClientMessage }) => (r.message.status === "sent" ? "Sent" : r.message.error ?? "Saved as a draft"))) onDone(); }}>
          {busy === "approve" ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} {m.status === "failed" ? "Retry" : "Approve & send"}
        </button>
      </div>
    </div>
  );
}

export function MessagesTab({ view, contactId }: { view: WorkspaceView; contactId?: string }) {
  const c = view.client;
  const toast = useToast();
  const { act, busy } = useAct();
  const [filter, setFilter] = useState<"needs" | "all">(view.counts.drafts + view.counts.needsHuman ? "needs" : "all");
  const [sel, setSel] = useState<string | undefined>(contactId);
  const [thread, setThread] = useState<{ contact: Contact; messages: ClientMessage[] } | null>(null);
  const [text, setText] = useState("");
  const [channel, setChannel] = useState<MsgChannel>("sms");
  const [tick, setTick] = useState(0);

  const convos = useMemo(() => {
    const byContact = new Map<string, ClientMessage[]>();
    for (const m of view.messages) byContact.set(m.contactId, [...(byContact.get(m.contactId) ?? []), m]);
    const rows = [...byContact].map(([id, ms]) => {
      const contact = view.contacts.find((x) => x.id === id);
      const last = ms[ms.length - 1];
      return { id, contact, last, drafts: ms.filter((m) => m.status === "draft" && m.direction === "out").length, failed: ms.filter((m) => m.status === "failed").length };
    });
    for (const x of view.contacts) if (x.needsHuman && !byContact.has(x.id)) rows.push({ id: x.id, contact: x, last: undefined as unknown as ClientMessage, drafts: 0, failed: 0 });
    return rows
      .filter((r) => filter === "all" || r.drafts || r.failed || r.contact?.needsHuman)
      .sort((a, b) => Date.parse(b.last?.at ?? b.contact?.updatedAt ?? "") - Date.parse(a.last?.at ?? a.contact?.updatedAt ?? ""));
  }, [view.messages, view.contacts, filter]);

  useEffect(() => {
    if (!sel) {
      setThread(null);
      return;
    }
    let live = true;
    api<{ contact: Contact; messages: ClientMessage[] }>(`/api/clients/${c.id}/messages?contact=${sel}`)
      .then((t) => {
        if (!live) return;
        setThread(t);
        setChannel(t.contact.phone ? (c.settings.whatsapp && c.whatsappNumber ? "whatsapp" : "sms") : "email");
      })
      .catch((err) => toast(err instanceof Error ? err.message : String(err), "error"));
    return () => {
      live = false;
    };
  }, [sel, c.id, c.settings.whatsapp, c.whatsappNumber, toast, tick, view.messages.length]);

  const reload = () => setTick((n) => n + 1);
  const ct = thread?.contact;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={filter === "needs"} onClick={() => setFilter("needs")}>
            Needs you ({view.counts.drafts + view.counts.needsHuman + view.counts.failed})
          </button>
          <button className="tab" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>
            All conversations
          </button>
        </div>
        {view.counts.drafts > 0 && (
          <button className="btn sm" disabled={Boolean(busy)} onClick={() => void act("all", `/api/clients/${c.id}/messages`, { method: "POST", json: { action: "approve_all" } }, (r: { sent: number; tried: number; error?: string }) => `${r.sent} of ${r.tried} sent${r.error ? `. ${r.error}` : ""}`)}>
            {busy === "all" ? <LoaderCircle size={14} className="spin" /> : <CheckCheck size={14} />} Approve all drafts
          </button>
        )}
      </div>

      <div className="convo-split">
        <section className="card convo-list">
          {convos.length ? (
            convos.map((r) => (
              <button key={r.id} className={`convo-row ${sel === r.id ? "on" : ""}`} onClick={() => setSel(r.id)}>
                <span className="row between" style={{ gap: 6 }}>
                  <b className="truncate">{r.contact?.name ?? "Unknown"}</b>
                  <span className="faint small nowrap">{r.last ? timeAgo(r.last.at) : ""}</span>
                </span>
                <span className="faint small truncate">{r.last ? `${r.last.direction === "in" ? "" : "↗ "}${r.last.body}` : "Wants a person"}</span>
                <span className="row" style={{ gap: 4 }}>
                  {r.drafts > 0 && <span className="badge warm">{r.drafts} draft{r.drafts > 1 ? "s" : ""}</span>}
                  {r.failed > 0 && <span className="badge hot">failed</span>}
                  {r.contact?.needsHuman && <span className="badge hot">needs you</span>}
                  {r.contact?.status === "booked" && <span className="badge good">booked</span>}
                  {r.contact?.optedOutAt && <span className="badge">opted out</span>}
                </span>
              </button>
            ))
          ) : (
            <Empty title={filter === "needs" ? "Nothing waiting" : "No conversations yet"}>{filter === "needs" ? "Drafts, failures and people who want a person show up here." : "Leads, win-back replies and missed-call texts show up here."}</Empty>
          )}
        </section>

        <section className="card convo-thread">
          {!ct ? (
            <Empty icon={<MessageCircle size={18} />} title="Pick a conversation" />
          ) : (
            <>
              <div className="card-head" style={{ alignItems: "flex-start" }}>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ margin: 0 }}>{ct.name}</h3>
                  <div className="faint small">
                    {ct.phone && (
                      <a href={`tel:${ct.phone}`}>
                        <Phone size={11} style={{ display: "inline", verticalAlign: -1 }} /> {displayPhone(ct.phone)}
                      </a>
                    )}
                    {ct.phone && ct.email ? " · " : ""}
                    {ct.email && (
                      <a href={`mailto:${ct.email}`}>
                        <Mail size={11} style={{ display: "inline", verticalAlign: -1 }} /> {ct.email}
                      </a>
                    )}
                  </div>
                  <div className="row wrap" style={{ gap: 4, marginTop: 4 }}>
                    <span className="badge">{ct.source}</span>
                    <span className={`badge ${ct.consent.sms ? "good" : ""}`}>{ct.consent.sms ? "Texts OK" : "No texting permission"}</span>
                    {ct.optedOutAt && <span className="badge hot">Opted out {timeAgo(ct.optedOutAt)}</span>}
                    {ct.interest && <span className="badge outline">{ct.interest}</span>}
                  </div>
                </div>
                <div className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
                  {ct.needsHuman && (
                    <button className="btn sm" onClick={() => void act("handled", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "update", contactId: ct.id, needsHuman: false } }, "Marked handled").then(reload)}>
                      <UserCheck size={13} /> Handled
                    </button>
                  )}
                  <button
                    className="btn sm"
                    onClick={() => {
                      if (ct.status === "booked") return void act("unbook", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "update", contactId: ct.id, booked: false } }, "Unbooked").then(reload);
                      const v = window.prompt(`What is this booking worth? (${c.currency.toUpperCase()}, blank for the usual ${c.jobValue})`, "");
                      if (v === null) return;
                      void act("book", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "update", contactId: ct.id, booked: true, value: v.trim() ? Number(v) : undefined } }, "Marked booked").then(reload);
                    }}
                  >
                    <CalendarCheck size={13} /> {ct.status === "booked" ? "Unbook" : "Booked"}
                  </button>
                  {!ct.jobDoneAt && (
                    <button className="btn sm" onClick={() => void act("job", `/api/clients/${c.id}/contacts`, { method: "POST", json: { action: "jobs_done", ids: [ct.id] } }, "Job done: review request queued").then(reload)}>
                      <BadgeCheck size={13} /> Job done
                    </button>
                  )}
                </div>
              </div>
              <div className="thread">
                {ct.message && (
                  <div className="msg in">
                    <span className="faint small">Their form · {timeAgo(ct.createdAt)}</span>
                    <div>{ct.message}</div>
                  </div>
                )}
                {thread!.messages.map((m) => (
                  <div key={m.id} className={`msg ${m.direction === "in" ? "in" : "out"} ${m.status}`}>
                    <span className="faint small">
                      {m.direction === "in" ? `${m.channel.toUpperCase()} · ${timeAgo(m.at)}` : `${PURPOSE[m.purpose] ?? m.purpose}${BY[m.by] ? ` · ${BY[m.by]}` : ""} · ${m.channel.toUpperCase()} · ${m.status === "sent" ? `sent ${timeAgo(m.sentAt)}` : m.status}`}
                    </span>
                    {m.status === "draft" || m.status === "failed" ? <Draft m={m} clientId={c.id} onDone={reload} /> : <div>{m.subject ? <b>{m.subject}</b> : null}{m.subject ? <br /> : null}{m.body}</div>}
                  </div>
                ))}
              </div>
              <form
                className="composer-row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!text.trim()) return;
                  const r = await act<{ message: ClientMessage }>("send", `/api/clients/${c.id}/messages`, { method: "POST", json: { action: "send", contactId: ct.id, channel, body: text } }, (r) => (r.message.status === "sent" ? "Sent" : r.message.error ?? "Saved as a draft"));
                  if (r) {
                    setText("");
                    reload();
                  }
                }}
              >
                <select className="select sm-select" value={channel} onChange={(e) => setChannel(e.target.value as MsgChannel)} aria-label="Channel">
                  {ct.phone && <option value="sms">Text</option>}
                  {ct.phone && c.whatsappNumber && <option value="whatsapp">WhatsApp</option>}
                  {ct.email && <option value="email">Email</option>}
                </select>
                <textarea className="textarea" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={ct.optedOutAt ? "They opted out: you can't message them." : `Write to ${ct.name.split(" ")[0]}…`} disabled={Boolean(ct.optedOutAt)} aria-label="Message" />
                <button className="btn primary" type="submit" disabled={!text.trim() || Boolean(busy) || Boolean(ct.optedOutAt)} aria-label="Send">
                  {busy === "send" ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />}
                </button>
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
