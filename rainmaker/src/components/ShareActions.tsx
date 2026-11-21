"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Globe, LoaderCircle, MapPin, Megaphone, Plus, Share2 } from "lucide-react";
import { api, useToast } from "./client";
import type { Lead } from "@/lib/types";

export function ShareActions({
  shared,
  niches,
  defaultNiche,
  defaultCity,
}: {
  shared: { name: string; website?: string; mapsUrl?: string; raw: string };
  niches: { id: string; label: string }[];
  defaultNiche: string;
  defaultCity: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState(shared.name);
  const [website, setWebsite] = useState(shared.website ?? "");
  const [niche, setNiche] = useState(defaultNiche);
  const [city, setCity] = useState(defaultCity);
  const [busy, setBusy] = useState(false);

  async function addLead() {
    if (!name.trim()) {
      toast("Add the business name", "error");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ lead: Lead }>("/api/leads", {
        method: "POST",
        json: { lead: { name: name.trim(), niche, city, website: website.trim() || undefined, notes: shared.mapsUrl ? `Map link: ${shared.mapsUrl}` : undefined } },
      });
      let id = res.lead.id;
      if (website.trim()) {
        const audited = await api<{ lead: Lead }>(`/api/leads/${id}/audit`, { method: "POST", json: {} }).catch(() => null);
        if (audited) id = audited.lead.id;
      }
      toast("Added to your pipeline");
      router.push(`/pipeline?lead=${id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
      setBusy(false);
    }
  }

  const adsHref = `/ads?${new URLSearchParams({ business: name, niche, location: city, ...(website ? { website } : {}) })}`;

  if (!shared.raw) {
    return (
      <div className="card card-pad stack">
        <div className="row" style={{ gap: 10 }}>
          <Share2 size={18} className="faint" />
          <b>Nothing was shared</b>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          After you install Rainmaker on your phone, open a business in Google Maps or a website in Chrome, tap Share, and pick Rainmaker. It lands here.
        </p>
        <Link href="/prospects" className="btn" style={{ width: "fit-content" }}>
          Find clients instead
        </Link>
      </div>
    );
  }

  return (
    <div className="card card-pad stack" style={{ gap: 14, maxWidth: 640 }}>
      <div className="tip neutral" style={{ wordBreak: "break-word" }}>
        <Share2 size={15} />
        <span>{shared.raw}</span>
      </div>
      <label className="field">
        <span>Business name</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brightside Family Dental" />
      </label>
      <label className="field">
        <span>Website</span>
        <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="Leave empty if they don't have one" inputMode="url" />
        {shared.mapsUrl && (
          <small className="row" style={{ gap: 5 }}>
            <MapPin size={12} /> Map link saved to the lead&apos;s notes
          </small>
        )}
      </label>
      <div className="grid-2">
        <label className="field">
          <span>Niche</span>
          <select className="select" value={niche} onChange={(e) => setNiche(e.target.value)}>
            {niches.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>City</span>
          <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
      </div>
      <div className="row wrap">
        <button className="btn primary lg" onClick={() => void addLead()} disabled={busy}>
          {busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />} {website ? "Add lead and audit site" : "Add lead"}
        </button>
        <Link href={adsHref} className="btn lg">
          <Megaphone size={16} /> Make sample ads
        </Link>
        {website && (
          <a href={website} target="_blank" rel="noreferrer" className="btn ghost lg">
            <Globe size={16} /> Open site
          </a>
        )}
      </div>
    </div>
  );
}
