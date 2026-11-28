import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Clapperboard,
  ExternalLink,
  FileText,
  Globe,
  Hammer,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  PenLine,
  RefreshCw,
  Reply,
  Send,
  StickyNote,
  Stethoscope,
  Smartphone,
} from "lucide-react";
import type { LeadDetail, LeadResponse, Message, VariantId } from "../api";
import { run } from "../commands";
import { ago, dateTime, INTENT_LABEL, INTENT_TONE, money } from "../format";
import { href } from "../router";
import { confirmDialog, formDialog, useApi, useStore } from "../store";
import { Button, Card, Chip, CopyButton, cx, Empty, ErrorNote, LinkButton, Loading, Rating, Score, StateChip, StatusChip, useBusy } from "../ui";
import { EventRow } from "./Activity";
import { nicheLabel } from "./Pipeline";

const VARIANT_NOTE: Record<string, string> = {
  bold: "Full-bleed photo, big type",
  classic: "Split layout, timeless",
  fresh: "Light, airy, rounded",
};

const OUTCOMES = [
  { value: "called_interested", label: "Called — interested" },
  { value: "called_no_answer", label: "Called — no answer" },
  { value: "called_not_interested", label: "Called — not interested" },
  { value: "replied", label: "They replied (outside the app)" },
  { value: "won", label: "Won — they paid" },
  { value: "lost", label: "Lost" },
  { value: "dnc", label: "Do not contact again" },
];

export function LeadDetailScreen({ id }: { id: string }) {
  const { data, error, loading, reload } = useApi<LeadResponse>(`/api/leads/${encodeURIComponent(id)}`);
  const settings = useStore((s) => s.settings);

  if (error && !data) {
    return (
      <div className="page">
        <BackLink />
        <ErrorNote message={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return <div className="page">{loading ? <Loading label="Opening the lead…" /> : null}</div>;

  const { lead, messages, events } = data;
  return (
    <div className="page lead-page">
      <BackLink />
      <LeadHeader lead={lead} nicheText={nicheLabel(lead.niche, settings?.niches)} />
      {lead.error ? (
        <div className="callout tone-red" role="alert">
          <span>
            <b>{lead.errorStage ? `${capitalize(lead.errorStage)} hit a problem: ` : "Something went wrong: "}</b>
            {lead.error}
          </span>
          <Button size="sm" tone="ghost" icon={RefreshCw} onClick={() => void run("rebuild", { lead: lead.id, what: "all" })}>
            Try again
          </Button>
        </div>
      ) : null}
      <div className="lead-layout">
        <div className="lead-main">
          <Mockups lead={lead} />
          <VideoCard lead={lead} />
          <DiagnosisCard lead={lead} />
          <PitchCard lead={lead} />
          <Thread lead={lead} messages={messages} />
          <Card title="Timeline" pad={false}>
            {events.length ? (
              <ol className="feed">
                {events.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </ol>
            ) : (
              <div className="pad">
                <Empty title="No crew activity yet" />
              </div>
            )}
          </Card>
        </div>
        <aside className="lead-side">
          <FactsCard lead={lead} />
          <DealCard lead={lead} />
          <AuditCard lead={lead} />
          {lead.reviews?.length ? (
            <Card title="What customers say">
              <ul className="reviews">
                {lead.reviews.slice(0, 3).map((r, i) => (
                  <li key={i}>
                    <Rating value={r.rating} />
                    <p>“{r.text.length > 220 ? `${r.text.slice(0, 220)}…` : r.text}”</p>
                    <span className="muted small">
                      {r.author}
                      {r.when ? ` · ${r.when}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          <NotesCard lead={lead} />
        </aside>
      </div>
    </div>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function BackLink() {
  return (
    <a className="back-link" href={href("pipeline")}>
      <ArrowLeft size={16} aria-hidden /> Pipeline
    </a>
  );
}

function LeadHeader({ lead, nicheText }: { lead: LeadDetail; nicheText: string }) {
  const [busy, act] = useBusy();
  const canPitch = Boolean(lead.pitch) && !["pitched", "replied", "negotiating", "won", "lost", "dnc"].includes(lead.status);

  const sendPitch = () =>
    act(() =>
      run(
        "send_pitch",
        { lead: lead.id },
        {
          confirm: {
            title: `Send the pitch to ${lead.name}?`,
            body: lead.email ? `The first email goes to ${lead.email} now (inside your sending hours), with the proposal link and video. Follow-ups are scheduled after it.` : "There's no email on file, so the Pitcher adds this lead to your one-tap call and text list instead.",
            confirmLabel: "Send it",
          },
        },
      ),
    );

  const rebuild = () =>
    act(async () => {
      const v = await formDialog({
        title: "Rebuild",
        body: "The crew redoes this step with the latest data and settings.",
        confirmLabel: "Rebuild",
        fields: [
          {
            name: "what",
            label: "What to rebuild",
            type: "select",
            options: [
              { value: "mockups", label: "The three mockups" },
              { value: "video", label: "The video" },
              { value: "pitch", label: "The pitch pack" },
              { value: "all", label: "Everything" },
            ],
          },
        ],
      });
      if (v) await run("rebuild", { lead: lead.id, what: v.what });
    });

  const outcome = () =>
    act(async () => {
      const v = await formDialog({
        title: `Log an outcome for ${lead.name}`,
        confirmLabel: "Save",
        fields: [
          { name: "outcome", label: "What happened", type: "select", options: OUTCOMES },
          { name: "amount", label: "Amount (if they paid)", type: "number", placeholder: String(Math.round(lead.priceCents / 100)), hint: "In dollars. Leave empty for the standard price." },
          { name: "note", label: "Note (optional)", type: "textarea" },
        ],
      });
      if (!v) return;
      const amount = v.amount ? Number(v.amount) : undefined;
      if (v.outcome === "dnc") {
        const yes = await confirmDialog({ title: "Never contact them again?", body: "Mainstreet adds them to the do-not-contact list and stops every message.", confirmLabel: "Do not contact", tone: "danger" });
        if (!yes) return;
      }
      await run("log_outcome", { lead: lead.id, outcome: v.outcome, note: v.note, amount: Number.isFinite(amount) ? amount : undefined });
    });

  const draft = () =>
    act(async () => {
      const v = await formDialog({
        title: "Draft a reply",
        body: "The Closer writes a reply to their latest message. Nothing is sent until you say so.",
        confirmLabel: "Draft it",
        fields: [{ name: "instructions", label: "Anything it should say? (optional)", type: "textarea", placeholder: "e.g. Offer a quick call on Thursday" }],
      });
      if (v) await run("draft_reply", { lead: lead.id, instructions: v.instructions });
    });

  return (
    <header className="lead-head">
      <div className="lead-head-main">
        <div className="lead-head-title">
          <h1>{lead.name}</h1>
          <Score value={lead.score} />
        </div>
        <p className="muted">
          {nicheText} · {lead.city}
          {lead.region ? `, ${lead.region}` : ""}
          {lead.createdAt ? ` · found ${ago(lead.createdAt)}` : ""}
        </p>
        <div className="chips-row">
          <StatusChip status={lead.status} />
          <StateChip state={lead.websiteState} />
          {lead.audit?.copyrightYear ? <Chip tone="amber">© {lead.audit.copyrightYear}</Chip> : null}
          <Rating value={lead.rating} count={lead.reviewCount} />
        </div>
      </div>
      <div className="lead-actions">
        {canPitch ? (
          <Button tone="primary" icon={Send} busy={busy} onClick={sendPitch}>
            Send pitch
          </Button>
        ) : null}
        {lead.proposalUrl ? (
          <LinkButton href={lead.proposalUrl} external icon={ExternalLink}>
            Proposal
          </LinkButton>
        ) : null}
        <Button icon={PenLine} disabled={busy} onClick={outcome}>
          Log outcome
        </Button>
        <Button tone="ghost" icon={Reply} disabled={busy} onClick={draft}>
          Draft reply
        </Button>
        <Button tone="ghost" icon={RefreshCw} disabled={busy} onClick={rebuild}>
          Rebuild
        </Button>
      </div>
    </header>
  );
}

// ── Mockups ──────────────────────────────────────────────────────────────

function Mockups({ lead }: { lead: LeadDetail }) {
  const variants = lead.files?.variants ?? [];
  const [pick, setPick] = useState<VariantId | undefined>(lead.chosenVariant ?? variants[0]?.id);
  useEffect(() => {
    if (!pick && variants[0]) setPick(variants[0].id);
  }, [pick, variants]);
  const current = variants.find((v) => v.id === pick) ?? variants[0];

  if (!variants.length) {
    return (
      <Card title="Mockups" icon={Hammer}>
        <Empty
          title={["new", "qualified", "diagnosed"].includes(lead.status) ? "The Builder hasn't started yet" : "No mockups"}
          body={["new", "qualified", "diagnosed"].includes(lead.status) ? "Three designs appear here once the diagnosis is done." : "Rebuild to make them."}
        />
      </Card>
    );
  }

  return (
    <Card
      title="Mockups"
      icon={Hammer}
      action={
        current ? (
          <a className="card-link" href={current.url} target="_blank" rel="noopener noreferrer">
            Open {current.label} <ExternalLink size={13} aria-hidden />
          </a>
        ) : null
      }
    >
      <div className="mockups">
        <div className="variant-list" role="tablist" aria-label="Designs">
          {variants.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={v.id === current?.id} className={cx("variant", v.id === current?.id && "is-on")} onClick={() => setPick(v.id)}>
              <span className="variant-thumb">{v.thumb ? <img src={v.thumb} alt="" loading="lazy" /> : <Smartphone size={18} aria-hidden />}</span>
              <span className="variant-name">
                <span>
                  {v.label}
                  {VARIANT_NOTE[v.id] ? <small className="variant-note">{VARIANT_NOTE[v.id]}</small> : null}
                </span>
                {lead.chosenVariant === v.id ? <Chip tone="money">Chosen</Chip> : null}
              </span>
            </button>
          ))}
        </div>
        {current ? (
          <div className="phone-frame" aria-label={`${current.label} design preview`}>
            <div className="phone-notch" aria-hidden />
            <div className="phone-screen">
              <iframe key={current.url} src={current.url} title={`${lead.name}: ${current.label} design`} loading="lazy" sandbox="allow-same-origin allow-scripts allow-popups" />
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function VideoCard({ lead }: { lead: LeadDetail }) {
  const v = lead.files?.video;
  return (
    <Card title="Video" icon={Clapperboard} action={lead.video ? <span className="muted small">{Math.round(lead.video.durationSec)}s · {lead.video.voice === "elevenlabs" ? "ElevenLabs voice" : lead.video.voice === "system" ? "System voice" : "No voice"}</span> : null}>
      {v ? (
        <div className="video-wrap">
          <video className="video" src={v.url} poster={v.poster} controls playsInline preload="metadata" />
          {lead.video?.script ? (
            <div className="video-script">
              <span className="eyebrow">Voiceover</span>
              <p>“{lead.video.script}”</p>
              <div className="row gap-sm">
                <CopyButton text={lead.video.script} label="Copy script" />
                <LinkButton size="sm" tone="ghost" href={v.url} external icon={ExternalLink}>
                  Open video
                </LinkButton>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <Empty title={lead.variants?.length ? "The Filmer is on it" : "No video yet"} body="A 10–15 second vertical video of their new site, with a voiceover that says their name." />
      )}
    </Card>
  );
}

function DiagnosisCard({ lead }: { lead: LeadDetail }) {
  const d = lead.diagnosis;
  if (!d) {
    return (
      <Card title="Diagnosis" icon={Stethoscope}>
        <Empty title="Not diagnosed yet" body="The Diagnoser explains what's wrong once the website check is done." />
      </Card>
    );
  }
  return (
    <Card title="Diagnosis" icon={Stethoscope} action={<Chip tone={d.fit === "pursue" ? "green" : "grey"}>{d.fit === "pursue" ? "Worth pursuing" : "Skip"}</Chip>}>
      <p className="diag-headline">{d.headline}</p>
      {d.evidence.length ? (
        <ul className="ticks">
          {d.evidence.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      ) : null}
      {d.impact ? <p className="muted">{d.impact}</p> : null}
      {d.hooks.length ? (
        <div className="chips-row">
          {d.hooks.map((h, i) => (
            <Chip key={i} tone="blue">
              {h}
            </Chip>
          ))}
        </div>
      ) : null}
      {d.corePitch ? (
        <blockquote className="core-pitch">
          <span className="eyebrow">Core pitch</span>
          {d.corePitch}
        </blockquote>
      ) : null}
      <div className="facts-inline muted small">
        <span>Angle: {d.angle.replace(/_/g, " ")}</span>
        <span>Tone: {d.tone}</span>
        <span>Suggested price: {money(d.suggestedPriceCents)}</span>
        {d.skipReason ? <span>Why skip: {d.skipReason}</span> : null}
      </div>
    </Card>
  );
}

const PITCH_TABS = ["email", "followups", "sms", "dm", "call"] as const;
const PITCH_LABEL: Record<(typeof PITCH_TABS)[number], string> = { email: "Email", followups: "Follow-ups", sms: "Text", dm: "DM", call: "Call script" };

function PitchCard({ lead }: { lead: LeadDetail }) {
  const [tab, setTab] = useState<(typeof PITCH_TABS)[number]>("email");
  const p = lead.pitch;
  if (!p) {
    return (
      <Card title="Pitch pack" icon={MessageSquare}>
        <Empty title="No pitch yet" body="The Pitcher writes the email, follow-ups, text, DM and call script after the video." />
      </Card>
    );
  }
  const emailText = `Subject: ${p.email.subject}\n\n${p.email.body}`;
  return (
    <Card title="Pitch pack" icon={MessageSquare}>
      <div className="tabs" role="tablist" aria-label="Pitch channels">
        {PITCH_TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={cx("tab-btn", tab === t && "is-on")} onClick={() => setTab(t)}>
            {PITCH_LABEL[t]}
            {t === "followups" && p.followups.length ? <span className="tab-count">{p.followups.length}</span> : null}
          </button>
        ))}
      </div>
      <div className="pitch-body" role="tabpanel">
        {tab === "email" ? (
          <MessageBlock subject={p.email.subject} body={p.email.body} copy={emailText} />
        ) : tab === "followups" ? (
          p.followups.length ? (
            p.followups.map((f, i) => <MessageBlock key={i} label={`Day ${f.day}`} subject={f.subject} body={f.body} copy={`Subject: ${f.subject}\n\n${f.body}`} />)
          ) : (
            <p className="muted">No follow-ups planned.</p>
          )
        ) : tab === "sms" ? (
          <MessageBlock body={p.sms} copy={p.sms} />
        ) : tab === "dm" ? (
          <MessageBlock body={p.dm} copy={p.dm} />
        ) : (
          <MessageBlock body={p.callScript} copy={p.callScript} />
        )}
      </div>
    </Card>
  );
}

function MessageBlock({ label, subject, body, copy }: { label?: string; subject?: string; body: string; copy: string }) {
  return (
    <div className="msg-block">
      <div className="msg-block-head">
        <span>
          {label ? <span className="eyebrow">{label}</span> : null}
          {subject ? <b className="msg-subject">{subject}</b> : null}
        </span>
        <CopyButton text={copy} />
      </div>
      <pre className="msg-text">{body}</pre>
    </div>
  );
}

function Thread({ lead, messages }: { lead: LeadDetail; messages: Message[] }) {
  const sorted = useMemo(() => [...messages].sort((a, b) => (a.sentAt ?? a.createdAt).localeCompare(b.sentAt ?? b.createdAt)), [messages]);
  return (
    <Card title="Messages" icon={Mail} action={<span className="muted small">{messages.length ? `${messages.length} in this thread` : ""}</span>}>
      {sorted.length ? (
        <ol className="thread">
          {sorted.map((m) => (
            <ThreadItem key={m.id} lead={lead} m={m} />
          ))}
        </ol>
      ) : (
        <Empty title="No messages yet" body="Every email, text and call note with this business shows here." />
      )}
    </Card>
  );
}

const CHANNEL_LABEL: Record<Message["channel"], string> = { email: "Email", sms: "Text", dm: "DM", call: "Call", note: "Note" };
const MSG_STATUS: Record<Message["status"], { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "grey" },
  pending_approval: { label: "Waiting for you", tone: "amber" },
  queued: { label: "Queued", tone: "blue" },
  sent: { label: "Sent", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  received: { label: "Received", tone: "sky" },
  manual: { label: "You sent it", tone: "grey" },
};

function ThreadItem({ lead, m }: { lead: LeadDetail; m: Message }) {
  const [busy, act] = useBusy();
  const st = MSG_STATUS[m.status];
  return (
    <li className={cx("bubble", m.direction === "in" ? "is-in" : "is-out", m.channel === "note" && "is-note")}>
      <div className="bubble-meta">
        <b>{m.direction === "in" ? lead.name : m.channel === "note" ? "Note" : "You"}</b>
        <span>· {CHANNEL_LABEL[m.channel]}</span>
        {m.kind === "followup" ? <span>· follow-up</span> : null}
        <span>· {dateTime(m.sentAt ?? m.createdAt)}</span>
        <Chip tone={st.tone}>{st.label}</Chip>
      </div>
      {m.subject ? <b className="bubble-subject">{m.subject}</b> : null}
      <p className="bubble-text">{m.body}</p>
      {m.error ? <p className="field-err">{m.error}</p> : null}
      {m.analysis ? (
        <div className="analysis">
          <div className="row gap-sm wrap">
            <Chip tone={INTENT_TONE[m.analysis.intent]}>{INTENT_LABEL[m.analysis.intent]}</Chip>
            {m.analysis.needsHuman ? <Chip tone="amber">Needs you</Chip> : null}
            {m.analysis.dealHintCents ? <Chip tone="money">{money(m.analysis.dealHintCents)} in play</Chip> : null}
          </div>
          <p className="small">{m.analysis.summary}</p>
          {m.analysis.suggestedReply ? (
            <details className="suggested">
              <summary>Suggested reply</summary>
              <pre className="msg-text">{m.analysis.suggestedReply}</pre>
              <div className="row gap-sm">
                <Button
                  size="sm"
                  tone="primary"
                  icon={Send}
                  busy={busy}
                  onClick={() =>
                    act(() =>
                      run("send_reply", { lead: lead.id, body: m.analysis!.suggestedReply }, { confirm: { title: `Send this reply to ${lead.name}?`, body: m.analysis!.suggestedReply.slice(0, 280), confirmLabel: "Send reply" } }),
                    )
                  }
                >
                  Send this reply
                </Button>
                <CopyButton text={m.analysis.suggestedReply} />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
      {m.direction === "out" && m.status === "pending_approval" && m.kind === "reply" ? (
        <div className="row gap-sm">
          <Button size="sm" tone="primary" icon={Send} busy={busy} onClick={() => act(() => run("send_reply", { lead: lead.id, body: m.body }, { confirm: { title: "Send this reply?", body: m.body.slice(0, 280), confirmLabel: "Send" } }))}>
            Send
          </Button>
        </div>
      ) : null}
    </li>
  );
}

// ── Side cards ───────────────────────────────────────────────────────────

function FactsCard({ lead }: { lead: LeadDetail }) {
  const host = lead.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <Card title="Business">
      <ul className="facts">
        {lead.phone ? (
          <li>
            <Phone size={15} aria-hidden />
            <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>{lead.phone}</a>
          </li>
        ) : null}
        {lead.email ? (
          <li>
            <Mail size={15} aria-hidden />
            <span>
              <a href={`mailto:${lead.email}`}>{lead.email}</a>
              {lead.emailSource ? <small className="muted block">Published on {lead.emailSource.replace(/^https?:\/\//, "")}</small> : null}
            </span>
          </li>
        ) : (
          <li className="muted">
            <Mail size={15} aria-hidden /> No published email — phone and DM only
          </li>
        )}
        {lead.website ? (
          <li>
            <Globe size={15} aria-hidden />
            <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer">
              {host}
            </a>
          </li>
        ) : (
          <li>
            <Globe size={15} aria-hidden /> <span>No website on their listing</span>
          </li>
        )}
        {lead.address ? (
          <li>
            <MapPin size={15} aria-hidden />
            <span>
              {lead.address}
              {lead.mapsUrl ? (
                <>
                  {" · "}
                  <a href={lead.mapsUrl} target="_blank" rel="noopener noreferrer">
                    Map
                  </a>
                </>
              ) : null}
            </span>
          </li>
        ) : null}
      </ul>
      {lead.hours?.length ? (
        <details className="hours">
          <summary>Opening hours</summary>
          <ul>
            {lead.hours.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function DealCard({ lead }: { lead: LeadDetail }) {
  const consent: Record<string, string> = {
    published_email: "Email published on their own site",
    inquiry: "They asked us",
    replied: "They replied",
    none: "None on file",
  };
  return (
    <Card title="Deal">
      <dl className="dl">
        <div>
          <dt>Price</dt>
          <dd className="num">{money(lead.priceCents)}</dd>
        </div>
        {lead.dealValueCents ? (
          <div>
            <dt>Deal value</dt>
            <dd className="num money-text">{money(lead.dealValueCents)}</dd>
          </div>
        ) : null}
        {lead.chosenVariant ? (
          <div>
            <dt>Picked design</dt>
            <dd>{lead.files?.variants.find((v) => v.id === lead.chosenVariant)?.label ?? lead.chosenVariant}</dd>
          </div>
        ) : null}
        <div>
          <dt>Consent basis</dt>
          <dd>{consent[lead.consent?.basis ?? "none"]}</dd>
        </div>
        <div>
          <dt>Last contact</dt>
          <dd>{lead.lastContactAt ? ago(lead.lastContactAt) : "Never"}</dd>
        </div>
        {lead.nextActionAt ? (
          <div>
            <dt>Next step</dt>
            <dd>{ago(lead.nextActionAt)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Follow-ups sent</dt>
          <dd className="num">{lead.followupsSent}</dd>
        </div>
      </dl>
      {lead.status !== "dnc" ? (
        <Button
          size="sm"
          tone="ghost"
          icon={Ban}
          className="mt-sm"
          onClick={() =>
            void run("log_outcome", { lead: lead.id, outcome: "dnc" }, { confirm: { title: `Never contact ${lead.name} again?`, body: "They go on the do-not-contact list and every scheduled message stops.", confirmLabel: "Do not contact", tone: "danger" } })
          }
        >
          Do not contact
        </Button>
      ) : null}
    </Card>
  );
}

function AuditCard({ lead }: { lead: LeadDetail }) {
  const a = lead.audit;
  if (!a && !lead.scoreReasons?.length) return null;
  return (
    <Card title="Website check" icon={FileText}>
      {a ? (
        <>
          {a.findings.length ? (
            <ul className="ticks warn">
              {a.findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          ) : null}
          <div className="audit-grid">
            <Flag ok={a.reachable} label={a.reachable ? `Loads${a.responseMs ? ` in ${(a.responseMs / 1000).toFixed(1)}s` : ""}` : a.error ? `Doesn't load: ${a.error}` : "Doesn't load"} />
            <Flag ok={a.https} label={a.https ? "HTTPS" : "No HTTPS"} />
            <Flag ok={a.mobileViewport} label={a.mobileViewport ? "Mobile layout" : "No mobile layout"} />
            <Flag ok={a.hasClickToCall} label={a.hasClickToCall ? "Tap to call" : "No tap-to-call"} />
            <Flag ok={a.booking.length > 0} label={a.booking.length ? `Booking: ${a.booking.join(", ")}` : "No online booking"} />
            <Flag ok={a.hasContactForm} label={a.hasContactForm ? "Contact form" : "No contact form"} />
          </div>
          {a.oldTech.length || a.cms || a.generator ? (
            <div className="chips-row mt-sm">
              {a.cms ? <Chip>{a.cms}</Chip> : null}
              {a.generator && a.generator !== a.cms ? <Chip>{a.generator}</Chip> : null}
              {a.oldTech.map((t) => (
                <Chip key={t} tone="amber">
                  {t}
                </Chip>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {lead.scoreReasons?.length ? (
        <details className="mt-sm">
          <summary>Why it scored {lead.score ?? "—"}</summary>
          <ul className="small plain">
            {lead.scoreReasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

function Flag({ ok, label }: { ok: boolean; label: string }) {
  return <span className={cx("flag", ok ? "is-ok" : "is-bad")}>{label}</span>;
}

function NotesCard({ lead }: { lead: LeadDetail }) {
  const [busy, act] = useBusy();
  return (
    <Card
      title="Notes"
      icon={StickyNote}
      action={
        <Button
          size="sm"
          tone="ghost"
          busy={busy}
          onClick={() =>
            act(async () => {
              const v = await formDialog({ title: "Add a note", confirmLabel: "Save note", fields: [{ name: "note", label: "Note", type: "textarea", required: true }] });
              if (v) await run("add_note", { lead: lead.id, note: v.note });
            })
          }
        >
          Add
        </Button>
      }
    >
      {lead.notes ? <pre className="notes">{lead.notes}</pre> : <p className="muted small">No notes yet. Atlas can add one: “note that they want a booking page”.</p>}
    </Card>
  );
}
