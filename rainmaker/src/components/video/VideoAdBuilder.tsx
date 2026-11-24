"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Film, LoaderCircle, Mail, Sparkles, Trash } from "lucide-react";
import { api, CopyButton, useToast } from "@/components/client";
import { timeAgo } from "@/lib/format";
import type { VideoAd } from "@/lib/types";
import { VideoAdPlayer } from "./VideoAdPlayer";

// Ad Studio → Video ad: pick a business from the pipeline, tick the products
// to sell (the ones their findings point to come first), and get a video
// made from their real data, ready to email.

type LeadLite = { id: string; name: string; niche: string; city?: string; website?: string; email?: string };
type Choice = { id: string; name: string; tagline: string; features: string[]; icon: string; monthly: number; recommended: boolean; why?: string };
type Listing = { videos: VideoAd[]; choices: Choice[]; claude: boolean; elevenlabs: boolean };

const MAX_PRODUCTS = 4;
const mediaUrl = (token: string, id?: string) => (id ? `/api/public/video/${token}/${id}` : undefined);

export function VideoAdBuilder({ leads, initialLeadId, agency }: { leads: LeadLite[]; initialLeadId?: string; agency: string }) {
  const toast = useToast();
  const [leadId, setLeadId] = useState(initialLeadId && leads.some((l) => l.id === initialLeadId) ? initialLeadId : (leads[0]?.id ?? ""));
  const [data, setData] = useState<Listing | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [format, setFormat] = useState<"vertical" | "square">("vertical");
  const [voice, setVoice] = useState(true);
  const [research, setResearch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [notes, setNotes] = useState<Record<string, string[]>>({});
  const [emailTo, setEmailTo] = useState<Record<string, string>>({});
  const [origin, setOrigin] = useState("");
  const lead = leads.find((l) => l.id === leadId);

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!leadId) return;
    setData(null);
    api<Listing>(`/api/videos?leadId=${encodeURIComponent(leadId)}`)
      .then((d) => {
        setData(d);
        setPicked(new Set(d.choices.filter((c) => c.recommended).slice(0, 3).map((c) => c.id)));
      })
      .catch((err) => toast(err instanceof Error ? err.message : String(err), "error"));
  }, [leadId, toast]);

  const products = useMemo(() => Object.fromEntries((data?.choices ?? []).map((c) => [c.id, c])), [data]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size >= MAX_PRODUCTS) {
        toast(`Pick up to ${MAX_PRODUCTS} products: one scene each keeps the video short.`, "error");
        return prev;
      } else next.add(id);
      return next;
    });
  }

  async function create() {
    if (!lead || !picked.size) return;
    setBusy(true);
    const steps = [
      [0, "Checking their website…"],
      [6000, data?.claude && research ? "Researching them on the web…" : "Reading their website…"],
      [data?.claude && research ? 40000 : 12000, data?.claude ? "Claude is writing the script from their facts…" : "Writing the script…"],
      [data?.claude && research ? 70000 : 30000, voice && data?.elevenlabs ? "Recording the voiceover…" : "Putting it together…"],
    ] as const;
    const timers = steps.map(([ms, text]) => setTimeout(() => setPhase(text), ms));
    try {
      const r = await api<{ video: VideoAd; notes: string[] }>("/api/videos", {
        method: "POST",
        json: { leadId: lead.id, products: [...picked], format, voice: voice && data?.elevenlabs, research: research && data?.claude },
      });
      setData((d) => (d ? { ...d, videos: [r.video, ...d.videos] } : d));
      if (r.notes.length) setNotes((n) => ({ ...n, [r.video.id]: r.notes }));
      toast(`Video ad ready for ${lead.name}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      timers.forEach(clearTimeout);
      setPhase("");
      setBusy(false);
    }
  }

  async function email(v: VideoAd) {
    try {
      await api(`/api/videos/${v.id}`, { method: "POST", json: { action: "email", to: emailTo[v.id] || undefined } });
      toast("Email drafted with the video link. Review it and send it from your Inbox.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function remove(v: VideoAd) {
    if (!confirm("Delete this video ad? Its link stops working.")) return;
    try {
      await api(`/api/videos/${v.id}`, { method: "DELETE" });
      setData((d) => (d ? { ...d, videos: d.videos.filter((x) => x.id !== v.id) } : d));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  if (!leads.length) {
    return (
      <div className="card card-pad stack">
        <b>Video ads are made from a business's real data</b>
        <span className="muted small">Add the business to your pipeline first (Find clients or Pipeline), then come back to make its video.</span>
        <div>
          <Link className="btn sm primary" href="/prospects">
            Find clients
          </Link>
        </div>
      </div>
    );
  }

  const choices = data?.choices ?? [];
  const recommended = choices.filter((c) => c.recommended);
  const others = choices.filter((c) => !c.recommended);
  const leadEmail = lead?.email;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="vbuilder">
        <section className="card card-pad stack" style={{ gap: 12 }}>
          <div className="row between">
            <h2 className="display" style={{ margin: 0, fontSize: 19 }}>
              <Film size={17} style={{ display: "inline", verticalAlign: -2 }} /> Video ad
            </h2>
            <span className="badge brand">
              <Sparkles size={12} /> {data?.claude ? "Written by Claude" : "Template"}
            </span>
          </div>
          <label className="field">
            <span>Business</span>
            <select className="select" value={leadId} onChange={(e) => setLeadId(e.target.value)} disabled={busy}>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.city ? ` · ${l.city}` : ""}
                </option>
              ))}
            </select>
          </label>
          <div className="muted small">
            A short video for the owner about <b>their</b> business: what&apos;s working, what we found on their website and listing, and how the products you tick would
            fix it. It uses only real data: their website check{lead?.website ? ", their website (headline, services, logo, photo, brand colour)" : ""}, their Google
            rating when you have it, facts about their industry{data?.claude ? ", and web research about them" : ""}.
          </div>
          <div className="field">
            <span>Format</span>
            <div className="seg">
              <button type="button" aria-pressed={format === "vertical"} onClick={() => setFormat("vertical")}>
                Vertical 9:16
              </button>
              <button type="button" aria-pressed={format === "square"} onClick={() => setFormat("square")}>
                Square 1:1
              </button>
            </div>
          </div>
          <label className="vopt">
            <input type="checkbox" className="check" checked={voice && Boolean(data?.elevenlabs)} disabled={!data?.elevenlabs} onChange={(e) => setVoice(e.target.checked)} />
            <span>
              Narrate it with an ElevenLabs voice
              {data && !data.elevenlabs && <small className="faint"> · needs ELEVENLABS_API_KEY</small>}
            </span>
          </label>
          <label className="vopt">
            <input type="checkbox" className="check" checked={research && Boolean(data?.claude)} disabled={!data?.claude} onChange={(e) => setResearch(e.target.checked)} />
            <span>
              Research them on the web first (reviews, specials, news)
              {data && !data.claude && <small className="faint"> · needs ANTHROPIC_API_KEY</small>}
            </span>
          </label>
          <button className="btn primary" onClick={() => void create()} disabled={busy || !data || !picked.size}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Film size={15} />} {busy ? phase || "Working…" : `Create video ad${picked.size ? ` selling ${picked.size} product${picked.size === 1 ? "" : "s"}` : ""}`}
          </button>
          {busy && <div className="faint small">This takes up to two minutes. You can keep working in another tab.</div>}
        </section>

        <section className="card card-pad stack" style={{ gap: 8 }} aria-label="Products to sell">
          <div className="row between">
            <b>Products to sell</b>
            <span className="faint small">
              {picked.size}/{MAX_PRODUCTS} ticked
            </span>
          </div>
          {!data ? (
            <div className="faint small">
              <LoaderCircle size={13} className="spin" style={{ display: "inline", verticalAlign: -2 }} /> Loading…
            </div>
          ) : (
            <>
              {recommended.length > 0 && <div className="faint small">Fits what we found on {lead?.name}:</div>}
              {[...recommended, ...(showAll ? others : [])].map((c) => (
                <label key={c.id} className={`vchoice ${picked.has(c.id) ? "on" : ""}`}>
                  <input type="checkbox" className="check" checked={picked.has(c.id)} onChange={() => toggle(c.id)} disabled={busy} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{c.name}</b> <span className="faint small">${c.monthly}/mo</span>
                    <span className="muted small" style={{ display: "block" }}>
                      {c.why ?? c.tagline}
                    </span>
                  </span>
                </label>
              ))}
              {others.length > 0 && (
                <button type="button" className="btn sm ghost" onClick={() => setShowAll((s) => !s)}>
                  {showAll ? "Show fewer" : `Show all ${choices.length} products`}
                </button>
              )}
            </>
          )}
        </section>
      </div>

      {data?.videos.map((v) => {
        const url = `${origin}/video/${v.token}`;
        const vNotes = notes[v.id];
        return (
          <section key={v.id} className="card card-pad stack" style={{ gap: 12 }}>
            <div className="row between wrap" style={{ gap: 6 }}>
              <b>
                {v.business} · {v.format === "vertical" ? "Vertical" : "Square"}
              </b>
              <span className="faint small">
                {timeAgo(v.createdAt)} · {v.writtenBy === "claude" ? "Claude" : "Template"} · {v.facts.length} facts{v.views ? ` · opened ${v.views} time${v.views === 1 ? "" : "s"}` : ""}
              </span>
            </div>
            {vNotes && (
              <div className="tip warn">
                <span className="small">{vNotes.join(" ")}</span>
              </div>
            )}
            <VideoAdPlayer
              scenes={v.scenes}
              timing={v.timing}
              brand={v.brand}
              logoUrl={mediaUrl(v.token, v.brand.logo)}
              photoUrl={mediaUrl(v.token, v.brand.photo)}
              voiceUrl={mediaUrl(v.token, v.voiceover?.assetId)}
              business={v.business}
              agency={agency}
              format={v.format}
              products={v.products.map((id) => products[id]).filter(Boolean)}
              fileName={`${v.business} video ad`}
              allowDownload
            />
            <div className="stack" style={{ gap: 6 }}>
              {!leadEmail && (
                <input
                  className="input"
                  type="email"
                  value={emailTo[v.id] ?? ""}
                  onChange={(e) => setEmailTo((m) => ({ ...m, [v.id]: e.target.value }))}
                  placeholder={`${v.business}'s email address`}
                  aria-label="Their email address"
                />
              )}
              <div className="row wrap" style={{ gap: 6 }}>
                <button className="btn sm primary" onClick={() => void email(v)} disabled={!leadEmail && !emailTo[v.id]}>
                  <Mail size={14} /> Email it to them
                </button>
                <CopyButton text={url} label="Copy link" className="btn sm" />
                <a className="btn sm" href={`/video/${v.token}?preview=1`} target="_blank" rel="noopener">
                  <ExternalLink size={13} /> Open their page
                </a>
                <Link className="btn sm ghost" href="/inbox">
                  Inbox
                </Link>
                <span className="spacer" />
                <button className="btn sm ghost" onClick={() => void remove(v)} aria-label="Delete video">
                  <Trash size={13} />
                </button>
              </div>
              <span className="faint small">
                The email goes to your Inbox as a draft{leadEmail ? ` to ${leadEmail}` : ""}, with the link to their private video page. Nothing is sent until you approve it.
              </span>
            </div>
            <details>
              <summary className="small">Facts used ({v.facts.length})</summary>
              <ul className="vfacts">
                {v.facts.map((f) => (
                  <li key={f.id} className={v.scenes.some((s) => s.factIds.includes(f.id)) ? "used" : ""}>
                    {v.scenes.some((s) => s.factIds.includes(f.id)) && <Check size={12} />} {f.text} <span className="faint">({f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.source}</a> : f.source})</span>
                  </li>
                ))}
              </ul>
            </details>
            <details>
              <summary className="small">Script ({v.scenes.length} scenes)</summary>
              <ol className="vfacts">
                {v.scenes.map((s, i) => (
                  <li key={i}>
                    <b>{s.headline}</b>
                    {s.sub ? ` · ${s.sub}` : ""}
                    <div className="muted small">“{s.voiceover}”</div>
                  </li>
                ))}
              </ol>
              <div className="faint small" style={{ marginTop: 6 }}>
                Email: <b>{v.email.subject}</b>
              </div>
            </details>
          </section>
        );
      })}
    </div>
  );
}
