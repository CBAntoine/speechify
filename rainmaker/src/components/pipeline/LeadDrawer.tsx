"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink, Globe, LoaderCircle, Mail, MapPinned, Megaphone, MessageSquare, Phone, PhoneCall, RefreshCw, Save, Send, Share2, Trash, Video, Wand, X } from "lucide-react";
import { api, CopyButton, Drawer, useToast } from "@/components/client";
import { shareOrCopy, useCanShare } from "@/components/pwa";
import { topSignals } from "@/lib/prospecting/score";
import { AuditDetails, SignalList } from "@/components/AuditDetails";
import { GuidePanel } from "./GuidePanel";
import { SellPanel } from "./SellPanel";
import { DynIcon, ScoreRing, TierBadge } from "@/components/ui";
import { timeAgo, money } from "@/lib/format";
import { STAGES, type AdCampaign, type Channel, type Draft, type Lead } from "@/lib/types";

type Outreach = {
  subject: string;
  body: string;
  rationale: string;
  followUps: { dayOffset: number; subject: string; body: string }[];
  sms: string;
  dm: string;
  callScript: string;
  videoScript: string;
};

type Tab = "overview" | "outreach" | "ads" | "notes";
type Piece = "email" | "sms" | "dm" | "call" | "video";

export function LeadDrawer({
  lead,
  onClose,
  onChange,
  drafts,
  campaigns,
  nicheLabel,
  nicheIcon,
  claude,
}: {
  lead: Lead | null;
  onClose: () => void;
  onChange: (l: Lead | null, removedId?: string) => void;
  drafts: Draft[];
  campaigns: AdCampaign[];
  nicheLabel?: string;
  nicheIcon?: string;
  claude: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Lead>>({});
  const [notes, setNotes] = useState("");
  const [outreach, setOutreach] = useState<Outreach | null>(null);
  const [piece, setPiece] = useState<Piece>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const shareable = useCanShare();

  useEffect(() => {
    if (!lead) return;
    setForm({ contactName: lead.contactName, email: lead.email, phone: lead.phone, website: lead.website, value: lead.value, nextStep: lead.nextStep });
    setNotes(lead.notes ?? "");
    setOutreach(null);
    setSubject("");
    setBody("");
  }, [lead?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!outreach) return;
    const map: Record<Piece, string> = { email: outreach.body, sms: outreach.sms, dm: outreach.dm, call: outreach.callScript, video: outreach.videoScript };
    setBody(map[piece]);
    setSubject(piece === "email" ? outreach.subject : "");
  }, [piece, outreach]);

  if (!lead) return null;

  async function patch(p: Partial<Lead>, msg?: string) {
    setBusy("patch");
    try {
      const res = await api<{ lead: Lead }>(`/api/leads/${lead!.id}`, { method: "PATCH", json: p });
      onChange(res.lead);
      if (msg) toast(msg);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function reaudit() {
    setBusy("audit");
    try {
      const res = await api<{ lead: Lead }>(`/api/leads/${lead!.id}/audit`, { method: "POST", json: { url: form.website } });
      onChange(res.lead);
      toast("Audit updated");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function write() {
    setBusy("write");
    try {
      const res = await api<{ content: Outreach; ai: boolean }>("/api/outreach", { method: "POST", json: { leadId: lead!.id, channel: piece === "video" ? "email" : piece } });
      setOutreach(res.content);
      if (!res.ai) toast("Template version. Add an Anthropic key for a message written just for them.");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!body.trim()) return;
    setBusy("draft");
    try {
      const channel: Channel = piece === "video" ? "dm" : piece;
      await api("/api/drafts", { method: "POST", json: { leadId: lead!.id, channel, subject: piece === "email" ? subject : undefined, body, rationale: outreach?.rationale } });
      toast("Saved to your Inbox for approval");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete ${lead!.name} from your pipeline?`)) return;
    try {
      await api(`/api/leads/${lead!.id}`, { method: "DELETE" });
      onChange(null, lead!.id);
      onClose();
      toast("Lead deleted");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  const leadDrafts = drafts.filter((d) => d.leadId === lead.id);
  const leadCampaigns = campaigns.filter((c) => c.leadId === lead.id);

  return (
    <Drawer open onClose={onClose} label={lead.name}>
      <div className="drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 8, marginBottom: 6 }}>
            <span className="badge outline">
              {nicheIcon && <DynIcon name={nicheIcon} size={12} />} {nicheLabel ?? lead.niche}
            </span>
            <TierBadge score={lead.score} />
          </div>
          <h2>{lead.name}</h2>
          <div className="muted small" style={{ marginTop: 4 }}>
            {lead.address ?? lead.city}
            {lead.lastContactAt ? ` · last touch ${timeAgo(lead.lastContactAt)}` : ""}
          </div>
        </div>
        <ScoreRing score={lead.score} />
        <button className="btn ghost icon" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>
      <div style={{ padding: "12px 20px 0" }} className="row between wrap">
        <div className="tabs" role="tablist">
          {(["overview", "outreach", "ads", "notes"] as Tab[]).map((t) => (
            <button key={t} role="tab" className="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === "overview" ? "Overview" : t === "outreach" ? "Outreach" : t === "ads" ? `Ads${leadCampaigns.length ? ` (${leadCampaigns.length})` : ""}` : "Notes"}
            </button>
          ))}
        </div>
        <select className="select" style={{ width: 150, height: 34 }} value={lead.stage} onChange={(e) => void patch({ stage: e.target.value as Lead["stage"] }, "Stage updated")} aria-label="Stage">
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="drawer-body stack" style={{ gap: 20 }}>
        {tab === "overview" && (
          <>
            <QuickActions lead={lead} />
            <section className="stack" style={{ gap: 10 }}>
              <div className="grid-2">
                <label className="field">
                  <span>Contact name</span>
                  <input className="input" value={form.contactName ?? ""} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Owner or manager" />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input className="input" type="email" value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@business.com" />
                </label>
                <label className="field">
                  <span>Phone</span>
                  <input className="input" value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </label>
                <label className="field">
                  <span>Website</span>
                  <input className="input" value={form.website ?? ""} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="business.com" />
                </label>
                <label className="field">
                  <span>Deal value ($/month)</span>
                  <input className="input" type="number" min={0} value={form.value ?? ""} onChange={(e) => setForm({ ...form, value: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
                <label className="field">
                  <span>Next step</span>
                  <input className="input" value={form.nextStep ?? ""} onChange={(e) => setForm({ ...form, nextStep: e.target.value })} placeholder="e.g. Call Tuesday" />
                </label>
              </div>
              <div className="row wrap">
                <button className="btn primary sm" onClick={() => void patch(form, "Saved")} disabled={busy === "patch"}>
                  <Save size={14} /> Save details
                </button>
                {lead.phone && (
                  <a className="btn sm" href={`tel:${lead.phone}`}>
                    <Phone size={14} /> Call
                  </a>
                )}
                {lead.email && (
                  <a className="btn sm" href={`mailto:${lead.email}`}>
                    <Mail size={14} /> Email
                  </a>
                )}
                {lead.website && (
                  <a className="btn sm" href={lead.website} target="_blank" rel="noreferrer">
                    <Globe size={14} /> Site <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </section>
            <section>
              <div className="row between" style={{ marginBottom: 10 }}>
                <div className="section-title" style={{ margin: 0 }}>
                  What you can sell them
                </div>
                <button className="btn sm" onClick={() => void reaudit()} disabled={busy === "audit"}>
                  {busy === "audit" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} {lead.audit ? "Re-check site" : "Audit site"}
                </button>
              </div>
              <SignalList signals={lead.signals} />
            </section>
            <SellPanel lead={lead} onChange={(l) => onChange(l)} />
            <GuidePanel lead={lead} onChange={(l) => onChange(l)} />
            {lead.audit && (
              <section>
                <div className="section-title">Website check</div>
                <AuditDetails audit={lead.audit} />
                <div className="faint small" style={{ marginTop: 8 }}>
                  Checked {timeAgo(lead.audit.fetchedAt)}
                </div>
              </section>
            )}
            <section>
              <div className="section-title">Look closer</div>
              <div className="row wrap">
                <a className="btn sm" href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&search_type=keyword_unordered&q=${encodeURIComponent(lead.name)}`} target="_blank" rel="noreferrer">
                  Meta Ad Library <ExternalLink size={12} />
                </a>
                <a className="btn sm" href={`https://www.google.com/search?q=${encodeURIComponent(`${lead.name} ${lead.city ?? ""} reviews`)}`} target="_blank" rel="noreferrer">
                  Google reviews <ExternalLink size={12} />
                </a>
                {lead.mapsUrl && (
                  <a className="btn sm" href={lead.mapsUrl} target="_blank" rel="noreferrer">
                    Map listing <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </section>
          </>
        )}

        {tab === "outreach" && (
          <>
            <div className="tabs">
              {(
                [
                  ["email", "Email", Mail],
                  ["sms", "Text", MessageSquare],
                  ["dm", "DM", MessageSquare],
                  ["call", "Call script", PhoneCall],
                  ["video", "Video audit", Video],
                ] as const
              ).map(([id, label, Ico]) => (
                <button key={id} className="tab" aria-selected={piece === id} onClick={() => setPiece(id)}>
                  <Ico size={13} /> {label}
                </button>
              ))}
            </div>
            {!outreach ? (
              <div className="card card-pad stack" style={{ gap: 10, alignItems: "flex-start" }}>
                <div style={{ fontWeight: 600 }}>Write a first touch that opens with what you found</div>
                <div className="muted small">
                  {claude
                    ? "Claude writes an email, a 3-step follow-up, a text, a DM, a call script and a 45-second video-audit script from this lead's audit. Nothing is sent."
                    : "Demo mode: you'll get a template built from the audit findings. Add an Anthropic key for a fully written version."}
                </div>
                <button className="btn primary" onClick={() => void write()} disabled={busy === "write"}>
                  {busy === "write" ? <LoaderCircle size={15} className="spin" /> : <Wand size={15} />} {busy === "write" ? "Writing…" : claude ? "Write with Claude" : "Write from template"}
                </button>
              </div>
            ) : (
              <div className="stack" style={{ gap: 10 }}>
                {piece === "email" && (
                  <label className="field">
                    <span>Subject</span>
                    <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
                  </label>
                )}
                <label className="field">
                  <span>{piece === "video" ? "What to say while you record (Loom or any screen recorder)" : "Message"}</span>
                  <textarea className="textarea" rows={piece === "email" ? 11 : 8} value={body} onChange={(e) => setBody(e.target.value)} />
                </label>
                {outreach.rationale && <div className="faint small">Why: {outreach.rationale}</div>}
                <div className="row wrap">
                  <button className="btn primary sm" onClick={() => void saveDraft()} disabled={busy === "draft"}>
                    <Send size={14} /> Save to Inbox
                  </button>
                  <CopyButton text={piece === "email" ? `Subject: ${subject}\n\n${body}` : body} />
                  {piece === "email" && lead.email && (
                    <a className="btn sm" href={`mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
                      <Mail size={14} /> Email app
                    </a>
                  )}
                  {piece === "sms" && lead.phone && (
                    <a className="btn sm" href={`sms:${lead.phone.replace(/[^\d+]/g, "")}?body=${encodeURIComponent(body)}`}>
                      <MessageSquare size={14} /> Messages
                    </a>
                  )}
                  {piece === "call" && lead.phone && (
                    <a className="btn sm" href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}>
                      <Phone size={14} /> Call now
                    </a>
                  )}
                  {shareable && (
                    <button className="btn sm" onClick={() => void shareOrCopy({ title: piece === "email" ? subject : undefined, text: body })}>
                      <Share2 size={14} /> Share
                    </button>
                  )}
                  <button className="btn sm ghost" onClick={() => void write()} disabled={busy === "write"}>
                    {busy === "write" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Rewrite
                  </button>
                </div>
                {piece === "email" && outreach.followUps.length > 0 && (
                  <div className="card">
                    <div className="card-head">
                      <h3>Follow-ups (reply in the same thread)</h3>
                    </div>
                    <div className="list">
                      {outreach.followUps.map((f, i) => (
                        <div key={i} className="list-item" style={{ flexDirection: "column", gap: 6 }}>
                          <div className="row between" style={{ width: "100%" }}>
                            <span className="badge">Day {f.dayOffset}</span>
                            <CopyButton text={f.body} className="btn sm ghost" />
                          </div>
                          <div className="small" style={{ whiteSpace: "pre-wrap" }}>
                            {f.body}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {leadDrafts.length > 0 && (
              <section>
                <div className="section-title">Messages for this lead</div>
                <div className="stack" style={{ gap: 6 }}>
                  {leadDrafts.map((d) => (
                    <Link key={d.id} href="/inbox" className="row card" style={{ padding: "10px 12px", gap: 10 }}>
                      <span className={`badge ${d.status === "sent" ? "good" : d.status === "pending" ? "brand" : ""}`}>{d.status === "pending" ? "Waiting" : d.status}</span>
                      <span className="truncate small" style={{ flex: 1 }}>
                        {d.subject || d.body.slice(0, 80)}
                      </span>
                      <span className="faint small nowrap">{timeAgo(d.createdAt)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {tab === "ads" && (
          <>
            <div className="card card-pad stack" style={{ gap: 10, alignItems: "flex-start" }}>
              <div style={{ fontWeight: 600 }}>Win them with a free sample</div>
              <div className="muted small">Build a campaign made for {lead.name}: Meta ads with creative, Google search ads, short video scripts and landing-page copy. Send the preview with your first message.</div>
              <Link href={`/ads?lead=${lead.id}`} className="btn primary">
                <Megaphone size={15} /> Build sample ads
              </Link>
            </div>
            {leadCampaigns.map((c) => (
              <Link key={c.id} href={`/ads?campaign=${c.id}`} className="card row" style={{ padding: 14, gap: 12 }}>
                <span className="icon-tile" style={{ background: c.creative.palette.bg, color: c.creative.palette.accent }}>
                  <Megaphone size={14} />
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <div className="truncate" style={{ fontWeight: 600 }}>
                    {c.creative.headline}
                  </div>
                  <div className="faint small truncate">
                    {c.goal} · {timeAgo(c.createdAt)}
                  </div>
                </span>
              </Link>
            ))}
          </>
        )}

        {tab === "notes" && (
          <>
            <label className="field">
              <span>Notes</span>
              <textarea className="textarea" rows={8} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you learned on the call, objections, decision maker…" />
            </label>
            <div className="row">
              <button className="btn primary sm" onClick={() => void patch({ notes }, "Notes saved")}>
                <Save size={14} /> Save notes
              </button>
            </div>
            <dl className="kv">
              <dt>Added</dt>
              <dd>
                {timeAgo(lead.createdAt)} by {lead.createdBy?.startsWith("agent:") ? "an agent" : "you"}
              </dd>
              <dt>Source</dt>
              <dd>{lead.source.replace("_", " ")}</dd>
              <dt>Deal value</dt>
              <dd>{money(lead.value)}/mo</dd>
            </dl>
            <div>
              <button className="btn sm danger" onClick={() => void remove()}>
                <Trash size={14} /> Delete lead
              </button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

/** Big tap targets for what you do from a phone: call, text, email, drive there. */
function QuickActions({ lead }: { lead: Lead }) {
  const toast = useToast();
  const phone = lead.phone?.replace(/[^\d+]/g, "");
  const dest = lead.lat !== undefined && lead.lon !== undefined ? `${lead.lat},${lead.lon}` : [lead.name, lead.address ?? lead.city].filter(Boolean).join(" ");
  const summary = [
    lead.name,
    lead.address ?? lead.city,
    lead.phone,
    lead.website,
    ...topSignals(lead.signals, 3).map((s) => `• ${s.label}`),
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <div className="quick-actions">
      {phone && (
        <a className="quick-action" href={`tel:${phone}`}>
          <Phone size={20} /> Call
        </a>
      )}
      {phone && (
        <a className="quick-action" href={`sms:${phone}`}>
          <MessageSquare size={20} /> Text
        </a>
      )}
      {lead.email && (
        <a className="quick-action" href={`mailto:${encodeURIComponent(lead.email)}`}>
          <Mail size={20} /> Email
        </a>
      )}
      {lead.website && (
        <a className="quick-action" href={lead.website} target="_blank" rel="noreferrer">
          <Globe size={20} /> Website
        </a>
      )}
      {dest && (
        <a className="quick-action" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`} target="_blank" rel="noreferrer">
          <MapPinned size={20} /> Directions
        </a>
      )}
      <button
        type="button"
        className="quick-action"
        onClick={async () => {
          const r = await shareOrCopy({ title: lead.name, text: summary });
          if (r === "copied") toast("Lead details copied");
        }}
      >
        <Share2 size={20} /> Share
      </button>
    </div>
  );
}
