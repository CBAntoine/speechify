import { useState } from "react";
import { Check, ChevronRight, Inbox, Mail, MessageCircle, MessageSquare, Phone, Reply, Send } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { InboxItem, OneTapItem, OutreachResponse } from "../api";
import { run } from "../commands";
import { ago, clock, INTENT_LABEL, INTENT_TONE, money } from "../format";
import { href } from "../router";
import { formDialog, useApi } from "../store";
import { Button, Card, Chip, CopyButton, cx, Empty, ErrorNote, Loading, PageHeader, Progress, useBusy } from "../ui";

const CH: Record<OneTapItem["channel"], { label: string; verb: string; icon: LucideIcon }> = {
  call: { label: "Calls", verb: "Call", icon: Phone },
  sms: { label: "Texts", verb: "Text", icon: MessageSquare },
  dm: { label: "DMs", verb: "Open DM", icon: MessageCircle },
};

const STATUS_TONE: Record<string, string> = { queued: "blue", pending_approval: "amber", sent: "green", failed: "red", discarded: "grey", draft: "grey" };
const STATUS_TEXT: Record<string, string> = { queued: "Queued", pending_approval: "Waiting for you", sent: "Sent", failed: "Failed", discarded: "Not sent", draft: "Draft" };

export function Outreach() {
  const { data, error, loading, reload } = useApi<OutreachResponse>("/api/outreach");

  return (
    <div className="page">
      <PageHeader title="Outreach" sub="Email goes out on its own inside your caps and hours. Calls, texts and DMs are one tap from your phone." />
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {!data && loading ? <Loading label="Loading outreach…" /> : null}
      {data ? (
        <div className="outreach-grid">
          <div className="stack">
            <OneTap items={data.oneTap} />
            <InboxCard items={data.inbox} />
          </div>
          <EmailQueue data={data} />
        </div>
      ) : null}
    </div>
  );
}

function EmailQueue({ data }: { data: OutreachResponse }) {
  return (
    <Card title="Email today" icon={Mail} action={<span className="num small">{data.sentToday} / {data.cap}</span>}>
      <Progress value={data.sentToday} max={Math.max(1, data.cap)} tone={data.sentToday >= data.cap ? "amber" : "green"} label="Emails sent against today's cap" />
      <p className="muted small mt-sm">{data.sentToday >= data.cap ? "Today's cap is reached. The rest go out tomorrow." : `${Math.max(0, data.cap - data.sentToday)} more can go out today.`}</p>
      {data.scheduled.length ? (
        <ul className="queue">
          {data.scheduled.map((s) => (
            <li key={s.messageId}>
              <a href={href("lead", s.leadId)} className="queue-row">
                <span className="queue-text">
                  <b>{s.leadName}</b>
                  <span className="muted small clamp-1">{s.subject}</span>
                </span>
                <span className="queue-meta">
                  <Chip tone={STATUS_TONE[s.status] ?? "grey"}>{STATUS_TEXT[s.status] ?? s.status}</Chip>
                  {s.sendAfter ? <span className="muted tiny">{new Date(s.sendAfter).toDateString() === new Date().toDateString() ? clock(s.sendAfter) : ago(s.sendAfter)}</span> : null}
                </span>
                <ChevronRight size={16} aria-hidden className="muted" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Nothing queued" body="New pitches line up here as the Filmer finishes each video." />
      )}
    </Card>
  );
}

function OneTap({ items }: { items: OneTapItem[] }) {
  const open = items.filter((i) => !i.done);
  const groups = (["call", "sms", "dm"] as const).map((c) => ({ c, items: items.filter((i) => i.channel === c) })).filter((g) => g.items.length);
  return (
    <Card title="Your one-tap list" icon={Phone} action={<span className="muted small">{open.length ? `${open.length} to do` : "All done"}</span>}>
      <p className="muted small">Personal, one-to-one messages from your own phone. Each takes about ten seconds.</p>
      {groups.length ? (
        groups.map((g) => (
          <div key={g.c} className="onetap-group">
            <h3 className="group-title">
              {CH[g.c].label} <span className="muted num">{g.items.filter((i) => !i.done).length}</span>
            </h3>
            <ul className="onetap">
              {g.items.map((it) => (
                <OneTapRow key={`${it.leadId}-${it.channel}`} item={it} />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <Empty title="Nothing to tap right now" body="Businesses without an email show up here with a call script, a text and a DM ready to go." />
      )}
    </Card>
  );
}

function OneTapRow({ item }: { item: OneTapItem }) {
  const [busy, act] = useBusy();
  const [open, setOpen] = useState(false);
  const meta = CH[item.channel];
  const external = item.href.startsWith("http");

  const done = () =>
    act(async () => {
      if (item.channel === "call") {
        const v = await formDialog({
          title: `How did the call with ${item.leadName} go?`,
          confirmLabel: "Save",
          fields: [
            {
              name: "outcome",
              label: "Outcome",
              type: "select",
              options: [
                { value: "called_interested", label: "Interested" },
                { value: "called_no_answer", label: "No answer / voicemail" },
                { value: "called_not_interested", label: "Not interested" },
              ],
            },
            { name: "note", label: "Note (optional)", type: "textarea" },
          ],
        });
        if (v) await run("log_outcome", { lead: item.leadId, outcome: v.outcome, note: v.note, channel: "call" });
        return;
      }
      await run("log_outcome", { lead: item.leadId, outcome: item.channel === "sms" ? "texted" : "messaged", channel: item.channel }, { quiet: true });
    });

  return (
    <li className={cx("onetap-row", item.done && "is-done")}>
      <div className="onetap-main">
        <a className="onetap-lead" href={href("lead", item.leadId)}>
          {item.leadName}
        </a>
        <button type="button" className="onetap-peek" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "Hide" : item.channel === "call" ? "Script" : "Message"}
        </button>
      </div>
      {open ? <pre className="msg-text">{item.text}</pre> : null}
      <div className="onetap-actions">
        {item.done ? (
          <span className="chip tone-green">
            <Check size={12} aria-hidden /> Done
          </span>
        ) : (
          <>
            <a className="btn btn-primary btn-lg onetap-go" href={item.href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
              <meta.icon size={18} aria-hidden /> {meta.verb}
            </a>
            <CopyButton text={item.text} />
            <Button size="sm" tone="ghost" icon={Check} busy={busy} onClick={done}>
              Done
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function InboxCard({ items }: { items: InboxItem[] }) {
  return (
    <Card title="Replies" icon={Inbox} action={<span className="muted small">{items.length ? `${items.length} recent` : ""}</span>}>
      {items.length ? (
        <ul className="inbox">
          {items.map((m) => (
            <InboxRow key={m.id} m={m} />
          ))}
        </ul>
      ) : (
        <Empty title="No replies yet" body="When a business writes back, the Closer reads it, works out what they want and drafts the answer." />
      )}
    </Card>
  );
}

function InboxRow({ m }: { m: InboxItem }) {
  const [busy, act] = useBusy();
  const [reply, setReply] = useState(m.analysis?.suggestedReply ?? "");
  const a = m.analysis;
  return (
    <li className={cx("inbox-row", a?.needsHuman && "needs-you")}>
      <div className="inbox-head">
        <a href={href("lead", m.leadId)}>
          <b>{m.leadName}</b>
        </a>
        <span className="muted small">
          {m.channel === "email" ? "Email" : m.channel === "sms" ? "Text" : m.channel === "dm" ? "DM" : "Call"} · {ago(m.sentAt ?? m.createdAt)}
        </span>
      </div>
      {a ? (
        <div className="row gap-sm wrap">
          <Chip tone={INTENT_TONE[a.intent]}>{INTENT_LABEL[a.intent]}</Chip>
          {a.needsHuman ? <Chip tone="amber">Needs you</Chip> : null}
          {a.dealHintCents ? <Chip tone="money">{money(a.dealHintCents)} in play</Chip> : null}
        </div>
      ) : null}
      {m.subject ? <b className="small">{m.subject}</b> : null}
      <p className="inbox-body clamp-4">{m.body}</p>
      {a?.summary ? <p className="small muted">Closer: {a.summary}</p> : null}
      {a && !["unsubscribe", "auto_reply", "wrong_person"].includes(a.intent) ? (
        <div className="reply-box">
          <label className="field">
            <span className="field-label">Reply</span>
            <textarea className="input" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
          </label>
          <div className="row gap-sm wrap">
            <Button
              tone="primary"
              icon={Send}
              busy={busy}
              disabled={!reply.trim()}
              onClick={() => act(() => run("send_reply", { lead: m.leadId, body: reply }, { confirm: { title: `Send this reply to ${m.leadName}?`, body: reply.slice(0, 300), confirmLabel: "Send reply" } }))}
            >
              Send reply
            </Button>
            <Button tone="ghost" icon={Reply} disabled={busy} onClick={() => act(() => run("draft_reply", { lead: m.leadId }))}>
              Redraft
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
