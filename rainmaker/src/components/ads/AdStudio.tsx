"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, Clapperboard, Download, Share2, FileText, Image as ImageIcon, LayoutTemplate, LoaderCircle, Megaphone, Mic, Search,
  Sparkles, Target, Trash, Wand, X,
} from "lucide-react";
import { api, CopyButton, download, useToast } from "@/components/client";
import { Empty } from "@/components/ui";
import { campaignIssues, campaignText, googleAdsCsv, LIMITS } from "@/lib/ads/limits";
import { timeAgo } from "@/lib/format";
import type { AdCampaign, Creative } from "@/lib/types";
import { CreativeSvg, downloadPng, sharePng, SIZES, type CreativeSize, type CreativeTemplate } from "./Creative";
import { ArtControls, AudioTab } from "./Media";
import { shareOrCopy, useCanShare } from "@/components/pwa";
import { Counter, FeedPreview, SearchPreview } from "./Previews";

type LeadLite = { id: string; name: string; niche: string; city?: string; website?: string };
type NicheLite = { id: string; label: string; offers: string[]; booking: boolean };
type Tab = "overview" | "meta" | "google" | "video" | "landing" | "creative" | "audio";

const GOALS = ["Book more appointments", "Get more phone calls", "Get more quote requests", "Fill a promotion or event", "Get more online orders"];

export function AdStudio({
  leads,
  niches,
  campaigns: initialCampaigns,
  initial,
  claude,
  elevenlabs = false,
}: {
  leads: LeadLite[];
  niches: NicheLite[];
  campaigns: AdCampaign[];
  initial: { leadId?: string; business?: string; niche?: string; location?: string; website?: string; campaignId?: string };
  claude: boolean;
  elevenlabs?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const initialLead = leads.find((l) => l.id === initial.leadId);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [brief, setBrief] = useState({
    leadId: initialLead?.id ?? "",
    businessName: initialLead?.name ?? initial.business ?? "",
    niche: initialLead?.niche ?? initial.niche ?? niches[0]?.id ?? "dentist",
    location: initialLead?.city ?? initial.location ?? "",
    website: initialLead?.website ?? initial.website ?? "",
    goal: GOALS[0],
    offer: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [chars, setChars] = useState(0);
  const [campaign, setCampaign] = useState<AdCampaign | null>(initialCampaigns.find((c) => c.id === initial.campaignId) ?? null);
  const [tab, setTab] = useState<Tab>("meta");
  const [template, setTemplate] = useState<CreativeTemplate>("bold");
  const [size, setSize] = useState<CreativeSize>("square");
  const [creative, setCreative] = useState<Creative | null>(campaign?.creative ?? null);
  const svgRef = useRef<SVGSVGElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const shareable = useCanShare();

  // Opened straight to a saved campaign (e.g. from a lead): on phones the
  // brief comes first, so jump down to the campaign.
  useEffect(() => {
    if (initial.campaignId && window.matchMedia("(max-width: 1180px)").matches) {
      resultsRef.current?.scrollIntoView({ block: "start" });
    }
  }, [initial.campaignId]);

  const niche = niches.find((n) => n.id === brief.niche);
  const issues = useMemo(() => (campaign ? campaignIssues(campaign) : []), [campaign]);

  function pickLead(id: string) {
    const l = leads.find((x) => x.id === id);
    setBrief((b) => (l ? { ...b, leadId: l.id, businessName: l.name, niche: l.niche, location: l.city ?? b.location, website: l.website ?? "" } : { ...b, leadId: "" }));
  }

  /** A campaign changed on the server (new art or voiceover): keep the list and the open one in sync. */
  function updateCampaign(c: AdCampaign) {
    setCampaigns((cs) => cs.map((x) => (x.id === c.id ? c : x)));
    setCampaign(c);
  }

  function open(c: AdCampaign) {
    setCampaign(c);
    setCreative(c.creative);
    setTab("meta");
    // Phones stack the brief above the results, so bring the results into view.
    requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!brief.businessName.trim()) {
      toast("Name the business first", "error");
      return;
    }
    setBusy(true);
    setChars(0);
    setPhase(brief.website ? "Checking their website…" : "Starting…");
    try {
      const res = await fetch("/api/ads/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...brief, leadId: brief.leadId || undefined }),
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let done: AdCampaign | null = null;
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as { type: string; phase?: string; chars?: number; campaign?: AdCampaign; error?: string; ai?: boolean };
          if (msg.type === "phase") setPhase(msg.phase === "auditing" ? "Checking their website…" : msg.phase === "thinking" ? "Working out the angle and offer…" : "Writing the campaign…");
          else if (msg.type === "progress") setChars(msg.chars ?? 0);
          else if (msg.type === "error") throw new Error(msg.error);
          else if (msg.type === "done" && msg.campaign) {
            done = msg.campaign;
            if (!msg.ai) toast("Starter template (demo mode). Add an Anthropic key for a campaign written for this business.");
          }
        }
      }
      if (!done) throw new Error("The campaign didn't finish. Try again.");
      setCampaigns((cs) => [done!, ...cs]);
      open(done);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
      setPhase("");
    }
  }

  async function remove(c: AdCampaign) {
    if (!confirm("Delete this campaign?")) return;
    try {
      await api(`/api/ads/${c.id}`, { method: "DELETE" });
      setCampaigns((cs) => cs.filter((x) => x.id !== c.id));
      setCampaign(null);
      toast("Deleted");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const cr = creative ?? campaign?.creative;
  const slug = (campaign?.businessName ?? "campaign").toLowerCase().replace(/[^a-z0-9]+/g, "-");

  return (
    <div className="studio">
      <div className="studio-form stack" style={{ gap: 14 }}>
        <form className="card" onSubmit={generate}>
          <div className="card-head">
            <h2>Campaign brief</h2>
            <span className="badge brand">
              <Sparkles size={12} /> {claude ? "Claude" : "Template"}
            </span>
          </div>
          <div className="card-body stack">
            {leads.length > 0 && (
              <label className="field">
                <span>From your pipeline</span>
                <select className="select" value={brief.leadId} onChange={(e) => pickLead(e.target.value)}>
                  <option value="">Type a business below…</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Business name</span>
              <input className="input" value={brief.businessName} onChange={(e) => setBrief({ ...brief, businessName: e.target.value, leadId: "" })} placeholder="e.g. Brightside Family Dental" required />
            </label>
            <div className="grid-2" style={{ gap: 10 }}>
              <label className="field">
                <span>Niche</span>
                <select className="select" value={brief.niche} onChange={(e) => setBrief({ ...brief, niche: e.target.value })}>
                  {niches.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>City</span>
                <input className="input" value={brief.location} onChange={(e) => setBrief({ ...brief, location: e.target.value })} placeholder="e.g. Toronto, ON" />
              </label>
            </div>
            <label className="field">
              <span>Website</span>
              <input className="input" value={brief.website} onChange={(e) => setBrief({ ...brief, website: e.target.value })} placeholder="We'll read it for context" />
            </label>
            <label className="field">
              <span>Goal</span>
              <select className="select" value={brief.goal} onChange={(e) => setBrief({ ...brief, goal: e.target.value })}>
                {GOALS.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Offer</span>
              <input className="input" value={brief.offer} onChange={(e) => setBrief({ ...brief, offer: e.target.value })} placeholder="Leave empty and Claude proposes one" />
            </label>
            {niche && niche.offers.length > 0 && (
              <div className="chips">
                {niche.offers.map((o) => (
                  <button key={o} type="button" className="chip" aria-pressed={brief.offer === o} onClick={() => setBrief({ ...brief, offer: brief.offer === o ? "" : o })}>
                    {o}
                  </button>
                ))}
              </div>
            )}
            <label className="field">
              <span>Notes for Claude (optional)</span>
              <textarea className="textarea" rows={3} value={brief.notes} onChange={(e) => setBrief({ ...brief, notes: e.target.value })} placeholder="Prices, specials, what makes them different, what to avoid…" />
            </label>
            {busy ? (
              <div className="stack" style={{ gap: 8 }}>
                <div className="row small muted">
                  <LoaderCircle size={15} className="spin" /> {phase}
                </div>
                <div className="progress">
                  <div style={{ width: `${Math.min(96, 6 + (chars / 9000) * 90)}%` }} />
                </div>
              </div>
            ) : (
              <button className="btn primary lg" type="submit">
                <Wand size={16} /> Build the campaign
              </button>
            )}
          </div>
        </form>

        {campaigns.length > 0 && (
          <section className="card">
            <div className="card-head">
              <h3>Saved campaigns</h3>
              <span className="faint small">{campaigns.length}</span>
            </div>
            <div className="list" style={{ maxHeight: 340, overflowY: "auto" }}>
              {campaigns.map((c) => (
                <button key={c.id} className="list-item" onClick={() => open(c)} style={{ background: c.id === campaign?.id ? "var(--brand-soft)" : undefined }}>
                  <span className="icon-tile" style={{ background: c.creative.palette.bg, color: c.creative.palette.accent }}>
                    <Megaphone size={14} />
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate small" style={{ fontWeight: 600 }}>
                      {c.businessName}
                    </div>
                    <div className="truncate faint small">
                      {c.creative.headline} · {timeAgo(c.createdAt)}
                    </div>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="stack" style={{ gap: 14, minWidth: 0, scrollMarginTop: 72 }} ref={resultsRef}>
        {!campaign ? (
          <div className="card">
            <Empty icon={<Megaphone size={18} />} title="Tailored ads in about a minute">
              Pick a lead or type a business. You get a strategy, three Meta ads with creative, a Google search ad with 15 headlines, short-video scripts and landing-page copy, all checked against each platform&apos;s limits.
            </Empty>
            <div className="grid-3" style={{ padding: "0 18px 18px" }}>
              {[
                ["Win the client", "Send a prospect a sample made for their business with your first email."],
                ["Serve the client", "Launch-ready copy for clients you already manage, in their voice."],
                ["Stay honest", "Claude uses only real facts and marks anything it doesn't know as [placeholder]."],
              ].map(([t, d]) => (
                <div key={t} className="card" style={{ padding: 14, boxShadow: "none", background: "var(--panel-2)" }}>
                  <div style={{ fontWeight: 650, marginBottom: 4 }}>{t}</div>
                  <div className="muted small">{d}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="card card-pad">
              <div className="row between wrap" style={{ gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 8, marginBottom: 4 }}>
                    {campaign.createdBy === "template" && <span className="badge warm">Template</span>}
                    {campaign.createdBy.startsWith("agent:") && (
                      <span className="badge violet">{campaign.createdBy === "agent:copilot" ? "By Copilot" : campaign.createdBy === "agent:autopilot" ? "By Autopilot" : "By Ad Strategist"}</span>
                    )}
                    <span className="faint small">{timeAgo(campaign.createdAt)}</span>
                  </div>
                  <h2 className="display" style={{ margin: 0, fontSize: 22 }}>
                    {campaign.businessName}
                  </h2>
                  <div className="muted small">
                    {campaign.goal}
                    {campaign.offer ? ` · ${campaign.offer}` : ""}
                  </div>
                </div>
                <div className="row wrap">
                  <CopyButton text={campaignText(campaign)} label="Copy all" className="btn sm" />
                  <button className="btn sm" onClick={() => download(`${slug}-google-ads.csv`, googleAdsCsv(campaign, campaign.website ?? "https://example.com"), "text/csv")}>
                    <Download size={14} /> Google Ads CSV
                  </button>
                  <button className="btn sm ghost danger" onClick={() => void remove(campaign)} aria-label="Delete campaign">
                    <Trash size={14} />
                  </button>
                  <button className="btn sm ghost" onClick={() => setCampaign(null)} aria-label="Close campaign">
                    <X size={14} />
                  </button>
                </div>
              </div>
              {issues.length > 0 && (
                <div className="tip warn" style={{ marginTop: 12 }}>
                  <span>
                    {issues.length} line{issues.length > 1 ? "s are" : " is"} over a platform limit and will be cut: {issues.map((i) => i.where).join(", ")}.
                  </span>
                </div>
              )}
              <div className="tabs" style={{ marginTop: 14 }}>
                {(
                  [
                    ["meta", "Meta ads", Megaphone],
                    ["google", "Google search", Search],
                    ["video", "Short video", Clapperboard],
                    ["creative", "Creative", ImageIcon],
                    ["audio", "Audio ad", Mic],
                    ["landing", "Landing page", LayoutTemplate],
                    ["overview", "Strategy", Target],
                  ] as const
                ).map(([id, label, Ico]) => (
                  <button key={id} className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                    <Ico size={13} /> {label}
                  </button>
                ))}
              </div>
            </div>

            {tab === "overview" && (
              <div className="stack" style={{ gap: 14 }}>
                <div className="card card-pad stack" style={{ gap: 10 }}>
                  <div className="section-title" style={{ margin: 0 }}>
                    The plan
                  </div>
                  <p style={{ margin: 0, lineHeight: 1.65 }}>{campaign.strategy.summary}</p>
                  <dl className="kv" style={{ marginTop: 6 }}>
                    <dt>Audience</dt>
                    <dd>{campaign.strategy.audience}</dd>
                    <dt>Budget</dt>
                    <dd>{campaign.strategy.budget}</dd>
                  </dl>
                </div>
                <div className="grid-3">
                  {campaign.strategy.angles.map((a) => (
                    <div key={a.name} className="card card-pad stack" style={{ gap: 6 }}>
                      <span className="badge brand" style={{ width: "fit-content" }}>
                        {a.name}
                      </span>
                      <div style={{ fontWeight: 650 }}>&ldquo;{a.hook}&rdquo;</div>
                      <div className="muted small">{a.why}</div>
                    </div>
                  ))}
                </div>
                <div className="card card-pad">
                  <div className="section-title">How you&apos;ll know it works</div>
                  <ul className="clean">
                    {campaign.strategy.kpis.map((k) => (
                      <li key={k}>
                        <Check size={14} /> {k}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {tab === "meta" && cr && (
              <div className="ad-grid">
                {campaign.meta.map((ad, i) => (
                  <div key={i} className="stack" style={{ gap: 10 }}>
                    <div className="row between">
                      <span className="badge brand">{ad.angle}</span>
                      <span className="row" style={{ gap: 4 }}>
                        {shareable && (
                          <button className="btn sm ghost" onClick={() => void shareOrCopy({ title: ad.headline, text: `${ad.primaryText}\n\n${ad.headline}\n${ad.description}` })}>
                            Share
                          </button>
                        )}
                        <CopyButton text={`${ad.primaryText}\n\nHeadline: ${ad.headline}\nDescription: ${ad.description}\nCTA: ${ad.cta}`} className="btn sm ghost" label="Copy ad" />
                      </span>
                    </div>
                    <FeedPreview ad={ad} business={campaign.businessName} creative={cr} template={(["bold", "split", "minimal"] as const)[i % 3]} url={campaign.website} />
                    <div className="card" style={{ padding: "10px 14px" }}>
                      <div className="asset-list">
                        <div className="asset">
                          <span className="faint small" style={{ width: 82 }}>
                            Primary
                          </span>
                          <span className="small" style={{ flex: 1 }}>
                            First {LIMITS.metaPrimary} characters show before &ldquo;See more&rdquo;
                          </span>
                          <Counter text={ad.primaryText} max={LIMITS.metaPrimary} />
                        </div>
                        <div className="asset">
                          <span className="faint small" style={{ width: 82 }}>
                            Headline
                          </span>
                          <span style={{ flex: 1 }}>{ad.headline}</span>
                          <Counter text={ad.headline} max={LIMITS.metaHeadline} />
                        </div>
                        <div className="asset">
                          <span className="faint small" style={{ width: 82 }}>
                            Description
                          </span>
                          <span style={{ flex: 1 }}>{ad.description}</span>
                          <Counter text={ad.description} max={LIMITS.metaDescription} />
                        </div>
                        <div className="asset">
                          <span className="faint small" style={{ width: 82 }}>
                            Visual idea
                          </span>
                          <span className="small muted" style={{ flex: 1 }}>
                            {ad.creativeIdea}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "google" && (
              <div className="grid-2" style={{ alignItems: "start" }}>
                <div className="stack" style={{ gap: 14 }}>
                  <SearchPreview headlines={campaign.google.headlines} descriptions={campaign.google.descriptions} url={campaign.website} business={campaign.businessName} />
                  <div className="card card-pad stack" style={{ gap: 10 }}>
                    <div className="row between">
                      <div className="section-title" style={{ margin: 0 }}>
                        Keywords
                      </div>
                      <CopyButton text={campaign.google.keywords.join("\n")} className="btn sm ghost" />
                    </div>
                    <div className="chips">
                      {campaign.google.keywords.map((k) => (
                        <span key={k} className="chip">
                          {k}
                        </span>
                      ))}
                    </div>
                    <div className="section-title" style={{ margin: "6px 0 0" }}>
                      Negative keywords
                    </div>
                    <div className="chips">
                      {campaign.google.negativeKeywords.map((k) => (
                        <span key={k} className="chip high">
                          −{k}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="card">
                  <div className="card-head">
                    <h3>
                      Headlines <span className="faint">{campaign.google.headlines.length}/15</span>
                    </h3>
                    <CopyButton text={campaign.google.headlines.join("\n")} className="btn sm ghost" />
                  </div>
                  <div className="card-body asset-list" style={{ paddingTop: 6 }}>
                    {campaign.google.headlines.map((h, i) => (
                      <div key={i} className="asset">
                        <span className="faint small" style={{ width: 18 }}>
                          {i + 1}
                        </span>
                        <span style={{ flex: 1 }}>{h}</span>
                        <Counter text={h} max={LIMITS.googleHeadline} />
                      </div>
                    ))}
                  </div>
                  <div className="card-head" style={{ borderTop: "1px solid var(--line)" }}>
                    <h3>Descriptions</h3>
                    <CopyButton text={campaign.google.descriptions.join("\n")} className="btn sm ghost" />
                  </div>
                  <div className="card-body asset-list" style={{ paddingTop: 6 }}>
                    {campaign.google.descriptions.map((d, i) => (
                      <div key={i} className="asset" style={{ alignItems: "flex-start" }}>
                        <span style={{ flex: 1 }}>{d}</span>
                        <Counter text={d} max={LIMITS.googleDescription} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === "video" && (
              <div className="stack" style={{ gap: 14 }}>
                {campaign.video.map((v, i) => (
                  <div key={i} className="card card-pad stack" style={{ gap: 10 }}>
                    <div className="row between">
                      <h3 className="display" style={{ margin: 0, fontSize: 17 }}>
                        {v.title}
                      </h3>
                      <CopyButton text={`${v.title}\nHook: ${v.hook}\n\n${v.script}\n\nShots:\n${v.shots.map((s, k) => `${k + 1}. ${s}`).join("\n")}`} className="btn sm ghost" />
                    </div>
                    <div className="tip">
                      <Clapperboard size={15} />
                      <span>
                        <b>First 2 seconds:</b> {v.hook}
                      </span>
                    </div>
                    <p className="muted" style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                      {v.script}
                    </p>
                    <div className="story">
                      {v.shots.map((s, k) => (
                        <div key={k} className="shot">
                          <b>Shot {k + 1}</b>
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === "landing" && (
              <div className="card" style={{ overflow: "hidden" }}>
                <div style={{ padding: "44px 32px", background: `linear-gradient(135deg, ${campaign.creative.palette.bg}, color-mix(in srgb, ${campaign.creative.palette.bg} 80%, black))`, color: campaign.creative.palette.fg }}>
                  <div style={{ opacity: 0.8, fontWeight: 650, marginBottom: 14 }}>{campaign.businessName}</div>
                  <h2 className="display" style={{ margin: 0, fontSize: 34, lineHeight: 1.1, maxWidth: 620 }}>
                    {campaign.landing.headline}
                  </h2>
                  <p style={{ fontSize: 17, opacity: 0.85, maxWidth: 560, margin: "12px 0 20px" }}>{campaign.landing.subheadline}</p>
                  <span className="btn lg" style={{ background: campaign.creative.palette.accent, borderColor: campaign.creative.palette.accent, color: "#111" }}>
                    {campaign.landing.cta}
                  </span>
                </div>
                <div className="card-body">
                  <ul className="clean">
                    {campaign.landing.bullets.map((b) => (
                      <li key={b}>
                        <Check size={15} style={{ color: "var(--good)" }} /> {b}
                      </li>
                    ))}
                  </ul>
                  <div className="row" style={{ marginTop: 14 }}>
                    <CopyButton text={[campaign.landing.headline, campaign.landing.subheadline, ...campaign.landing.bullets.map((b) => `- ${b}`), `Button: ${campaign.landing.cta}`].join("\n")} label="Copy page copy" />
                  </div>
                </div>
              </div>
            )}

            {tab === "audio" && <AudioTab campaign={campaign} enabled={elevenlabs} onUpdate={updateCampaign} />}

            {tab === "creative" && cr && (
              <div className="grid-2 wide-left">
                <div className="creative-wrap" style={{ maxWidth: size === "story" ? 360 : undefined, justifySelf: "center", width: "100%" }}>
                  <CreativeSvg ref={svgRef} creative={cr} business={campaign.businessName} size={size} template={template} art={campaign.art?.[size] ? `/api/assets/${campaign.art[size]!.assetId}` : undefined} />
                </div>
                <div className="card card-pad stack">
                  <div className="row wrap">
                    <div className="tabs">
                      {(["bold", "split", "minimal"] as const).map((t) => (
                        <button key={t} className="tab" aria-selected={template === t} onClick={() => setTemplate(t)}>
                          {t[0].toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                    <div className="tabs">
                      {(Object.keys(SIZES) as CreativeSize[]).map((s) => (
                        <button key={s} className="tab" aria-selected={size === s} onClick={() => setSize(s)}>
                          {SIZES[s].label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(["headline", "subline", "badge", "cta"] as const).map((k) => (
                    <label key={k} className="field">
                      <span>{k === "cta" ? "Button" : k[0].toUpperCase() + k.slice(1)}</span>
                      <input className="input" value={cr[k]} onChange={(e) => setCreative({ ...cr, [k]: e.target.value })} />
                    </label>
                  ))}
                  <div className="row wrap">
                    {(["bg", "fg", "accent"] as const).map((k) => (
                      <label key={k} className="field" style={{ width: 96 }}>
                        <span>{k === "bg" ? "Background" : k === "fg" ? "Text" : "Accent"}</span>
                        <input type="color" className="input" style={{ padding: 4 }} value={/^#[0-9a-f]{6}$/i.test(cr.palette[k]) ? cr.palette[k] : "#000000"} onChange={(e) => setCreative({ ...cr, palette: { ...cr.palette, [k]: e.target.value } })} />
                      </label>
                    ))}
                  </div>
                  <div className="row wrap">
                    <button
                      className="btn primary"
                      onClick={() => {
                        if (svgRef.current) void downloadPng(svgRef.current, `${slug}-${size}.png`, SIZES[size].w, SIZES[size].h).catch((e) => toast(String(e), "error"));
                      }}
                    >
                      <Download size={15} /> Download PNG
                    </button>
                    {shareable && (
                      <button
                        className="btn"
                        onClick={() => {
                          if (svgRef.current)
                            void sharePng(svgRef.current, `${slug}-${size}.png`, SIZES[size].w, SIZES[size].h, `${campaign.businessName}: ${cr.headline}`).catch((e) => toast(String(e), "error"));
                        }}
                      >
                        <Share2 size={15} /> Share image
                      </button>
                    )}
                    <button className="btn ghost" onClick={() => setCreative(campaign.creative)}>
                      Reset
                    </button>
                  </div>
                  <div className="faint small">
                    <FileText size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Downloads at full size ({SIZES[size].w}×{SIZES[size].h}).
                  </div>
                  <ArtControls campaign={campaign} size={size} enabled={elevenlabs} onUpdate={updateCampaign} />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
