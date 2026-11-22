"use client";

import { useEffect, useState } from "react";
import { Bot, ExternalLink, Link2, LoaderCircle, PhoneCall, Share2, Trash } from "lucide-react";
import { api, CopyButton, useToast } from "@/components/client";
import { shareOrCopy, useCanShare } from "@/components/pwa";
import { OfferIcon } from "@/components/store/icons";
import { dollars, priceOf, recommend } from "@/lib/catalog";
import type { DemoAgent, Lead, PriceOverride, StoreCurrency } from "@/lib/types";

// "Sell" section of a lead: what to pitch from the store (from their audit
// and niche), checkout links that tie the purchase to this lead, and the
// demo AI receptionist built from their website.

type StoreInfo = { currency: StoreCurrency; prices: Record<string, PriceOverride>; waiveSetupOnAnnual: boolean; enabled: boolean };

export function SellPanel({ lead, onChange }: { lead: Lead; onChange: (l: Lead) => void }) {
  const toast = useToast();
  const shareable = useCanShare();
  const [info, setInfo] = useState<{ store: StoreInfo; elevenlabs: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    api<{ store: StoreInfo; elevenlabs: boolean }>("/api/sell/settings").then(setInfo).catch(() => setInfo(null));
  }, []);

  const recs = recommend({ niche: lead.niche, signals: lead.signals }, 3).filter((r) => !info?.store.prices[r.offer.id]?.hidden);
  const demoUrl = lead.demo ? `${origin}/demo/${lead.demo.token}` : "";

  async function buildDemo() {
    setBusy("demo");
    try {
      const r = await api<{ demo: DemoAgent; url: string }>(`/api/leads/${lead.id}/demo`, { method: "POST" });
      onChange({ ...lead, demo: r.demo });
      toast("Demo receptionist built from their website. Send them the link.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function removeDemo() {
    if (!confirm("Delete this demo agent? The link stops working.")) return;
    setBusy("remove");
    try {
      await api(`/api/leads/${lead.id}/demo`, { method: "DELETE" });
      onChange({ ...lead, demo: undefined });
      toast("Demo deleted");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="section-title" style={{ margin: 0 }}>
        Pitch from your store
      </div>

      {recs.map(({ offer, reason }) => {
        const price = info ? priceOf(offer, info.store) : undefined;
        const link = `${origin}/store/${offer.slug}?lead=${lead.id}`;
        return (
          <div key={offer.id} className="row" style={{ alignItems: "flex-start", gap: 12 }}>
            <span className="icon-tile">
              <OfferIcon name={offer.icon} size={16} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {offer.name}
                {price && <span className="faint small"> · {dollars(price.monthly, { currency: info!.store.currency })}/mo</span>}
              </div>
              <div className="muted small">{reason}</div>
              <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                <CopyButton text={link} label="Copy checkout link" className="btn sm" />
                {shareable && (
                  <button className="btn sm" onClick={() => void shareOrCopy({ title: offer.name, text: `${offer.name} for ${lead.name}: ${link}` })}>
                    <Share2 size={13} /> Share
                  </button>
                )}
                <a className="btn sm ghost" href={link} target="_blank" rel="noopener">
                  <ExternalLink size={13} /> View
                </a>
              </div>
            </div>
          </div>
        );
      })}
      <div className="faint small">
        <Link2 size={12} style={{ display: "inline", verticalAlign: -1 }} /> Checkout links carry this lead, so a purchase moves it to Won automatically.
      </div>

      <div className="card" style={{ padding: 14, background: "var(--panel-2)" }}>
        <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
          <span className="icon-tile" style={{ background: "var(--violet-soft)", color: "var(--violet)" }}>
            <PhoneCall size={16} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b>Demo AI receptionist</b>
            {lead.clientAgentId ? (
              <div className="muted small">
                Their real receptionist is live.{" "}
                <a className="link-btn" href={`https://elevenlabs.io/app/agents/agents/${lead.clientAgentId}`} target="_blank" rel="noopener">
                  Open in ElevenLabs
                </a>
              </div>
            ) : lead.demo ? (
              <>
                <div className="muted small">Trained on their website. Send them the link: hearing their own business answered is the best pitch there is.</div>
                <div className="copy-field" style={{ marginTop: 8 }}>
                  <input className="input" readOnly value={demoUrl} aria-label="Demo link" />
                  <CopyButton text={demoUrl} className="btn sm" />
                </div>
                <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                  <a className="btn sm" href={demoUrl} target="_blank" rel="noopener">
                    <Bot size={13} /> Try it
                  </a>
                  {shareable && (
                    <button className="btn sm" onClick={() => void shareOrCopy({ title: `AI receptionist for ${lead.name}`, text: `I built an AI receptionist for ${lead.name}. Give it a call: ${demoUrl}` })}>
                      <Share2 size={13} /> Share
                    </button>
                  )}
                  <button className="btn sm ghost" onClick={() => void removeDemo()} disabled={busy === "remove"}>
                    <Trash size={13} /> Delete
                  </button>
                </div>
                {lead.demo.usage && <div className="faint small" style={{ marginTop: 6 }}>Used {lead.demo.usage.sessions} time(s) on {lead.demo.usage.day}</div>}
              </>
            ) : (
              <>
                <div className="muted small">
                  Build an ElevenLabs receptionist from {lead.website ? "their website" : "what we know about them"} and get a private link to send them. {lead.website ? "" : "Add their website first for a much better demo."}
                </div>
                <button className="btn sm primary" style={{ marginTop: 8 }} onClick={() => void buildDemo()} disabled={busy === "demo" || !info?.elevenlabs}>
                  {busy === "demo" ? <LoaderCircle size={14} className="spin" /> : <Bot size={14} />} {busy === "demo" ? "Building (about 20 seconds)…" : "Build demo receptionist"}
                </button>
                {info && !info.elevenlabs && <div className="faint small" style={{ marginTop: 6 }}>Needs your ElevenLabs key (Settings → API keys).</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
