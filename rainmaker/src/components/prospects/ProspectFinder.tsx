"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Check, ChevronDown, Crosshair, ExternalLink, Globe, Lightbulb, LoaderCircle, Mail, MapPin, Megaphone, Phone, Plus, Radar,
  Search, SearchCheck, Star, X,
} from "lucide-react";
import { api, Drawer, useToast } from "@/components/client";
import { AuditDetails, SignalList } from "@/components/AuditDetails";
import { DynIcon, Empty, ScoreRing, SignalChips, TierBadge } from "@/components/ui";
import { PlacePicker, loadSavedPlace, savePlace } from "@/components/PlacePicker";
import type { AuditResult, LeadSource, Prospect, Signal } from "@/lib/types";

export interface NicheLite {
  id: string;
  label: string;
  plural: string;
  icon: string;
  customerValue: string;
  retainer: string;
  offers: string[];
  channels: string[];
  painPoints: string[];
  tip?: string;
  evidence?: { text: string; url: string }[];
}

type Result = { prospects: Prospect[]; source: LeadSource; note?: string; niche: { id: string; label: string; plural: string }; location: string; sources?: { label: string; count: number; url?: string }[] };

const FILTERS: { id: string; label: string; test: (p: Prospect) => boolean }[] = [
  { id: "no_website", label: "No website", test: (p) => has(p.signals, "no_website") || has(p.signals, "site_down") },
  { id: "no_booking", label: "No online booking", test: (p) => has(p.signals, "no_booking") },
  { id: "not_mobile", label: "Not mobile-friendly", test: (p) => has(p.signals, "not_mobile") },
  { id: "no_pixel", label: "Not running ads", test: (p) => has(p.signals, "no_pixel") },
  { id: "runs_ads", label: "Already runs ads", test: (p) => has(p.signals, "runs_ads") },
  { id: "few_reviews", label: "Few reviews", test: (p) => has(p.signals, "few_reviews") || has(p.signals, "low_rating") },
  { id: "new_only", label: "Not in pipeline", test: (p) => !p.savedLeadId },
];

function has(signals: Signal[] | undefined, id: string) {
  return Boolean(signals?.some((s) => s.id === id));
}

const SOURCE_LABEL: Record<string, string> = { google_places: "Google Places", openstreetmap: "OpenStreetMap", open_data: "City licences", web: "Claude web research" };

export function ProspectFinder({
  niches,
  initial,
  places,
}: {
  niches: NicheLite[];
  initial: { niche: string; location: string; go: boolean; fromUrl?: boolean };
  places: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const known = niches.some((n) => n.id === initial.niche);
  const [niche, setNiche] = useState(known ? initial.niche : "custom");
  const [custom, setCustom] = useState(known ? "" : initial.niche);
  const [location, setLocation] = useState(initial.location);
  const [radius, setRadius] = useState(12);
  const [near, setNear] = useState<{ lat: number; lon: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [filters, setFilters] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<Prospect | null>(null);
  const started = useRef(false);

  const nicheInfo = niches.find((n) => n.id === niche);

  const search = useCallback(
    async () => {
      const nicheText = niche === "custom" ? custom.trim() : niche;
      if (!nicheText || (!location.trim() && !near)) {
        toast("Pick a niche and a city first", "error");
        return;
      }
      setLoading(true);
      setError(null);
      setSelected(new Set());
      const timers: ReturnType<typeof setTimeout>[] = [];
      const later = (ms: number, text: string) => timers.push(setTimeout(() => setPhase(text), ms));
      // 20 results: one Google Places request per search when a key is set.
      const body = { niche: nicheText, location: near ? "" : location, ...(near ? { lat: near.lat, lon: near.lon } : {}), radiusKm: radius, limit: 20, audit: 10 };
      try {
        setPhase(places ? "Searching Google Places…" : "Searching OpenStreetMap…");
        later(7000, "Checking their websites for gaps…");
        later(16000, "Scoring who needs you most…");
        const res = await api<Result>("/api/prospects/search", { method: "POST", json: body });
        setResult(res);
        if (!near) savePlace(location);
        const q = new URLSearchParams(near ? { niche: nicheText } : { niche: nicheText, location });
        router.replace(`/prospects?${q}`, { scroll: false });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setResult(null);
      } finally {
        timers.forEach(clearTimeout);
        setLoading(false);
        setPhase("");
      }
    },
    [niche, custom, location, near, radius, places, router, toast]
  );

  function locateMe() {
    if (!("geolocation" in navigator)) {
      toast("This browser can't share your location", "error");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // The picked city stays as it was, so turning "near me" off returns to it.
        setNear({ lat: pos.coords.latitude, lon: pos.coords.longitude });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        toast(err.code === err.PERMISSION_DENIED ? "Location is blocked. Allow it for this site in Chrome's settings." : "Couldn't get your location. Try typing a city.", "error");
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 120_000 }
    );
  }

  // Opened without a place in the address: start from the last place searched
  // on this phone, not the agency's home city.
  useEffect(() => {
    if (initial.fromUrl) return;
    const saved = loadSavedPlace();
    if (saved) setLocation(saved);
  }, [initial.fromUrl]);

  useEffect(() => {
    if (initial.go && !started.current && initial.location) {
      started.current = true;
      void search();
    }
  }, [initial.go, initial.location, search]);

  // The copilot asks for a search while this screen is already open.
  const queued = useRef(false);
  const [asked, setAsked] = useState(0);
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<{ niche?: string; location?: string }>).detail ?? {};
      const want = (d.niche ?? "").trim().toLowerCase();
      if (want) {
        const hit = niches.find((n) => n.id === want || n.label.toLowerCase() === want || n.plural.toLowerCase() === want);
        setNiche(hit ? hit.id : "custom");
        setCustom(hit ? "" : (d.niche ?? "").trim());
      }
      if (d.location?.trim()) {
        setNear(null);
        setLocation(d.location.trim());
      }
      queued.current = true;
      setAsked((n) => n + 1);
    };
    window.addEventListener("rm:prospect-search", onAsk);
    return () => window.removeEventListener("rm:prospect-search", onAsk);
  }, [niches]);
  useEffect(() => {
    if (!queued.current) return;
    queued.current = false;
    void search();
  }, [asked, niche, custom, location, search]);

  const shown = useMemo(() => {
    const list = result?.prospects ?? [];
    return list.filter((p) => filters.every((f) => FILTERS.find((x) => x.id === f)!.test(p)));
  }, [result, filters]);

  const updateProspect = (key: string, patch: Partial<Prospect>) =>
    setResult((r) => (r ? { ...r, prospects: r.prospects.map((p) => (p.key === key ? { ...p, ...patch } : p)) } : r));

  async function save(list: Prospect[]) {
    if (!list.length) return;
    setBusy("save");
    try {
      const res = await api<{ saved: { id: string; name: string; sourceId?: string }[]; skipped: { name: string; leadId?: string }[] }>("/api/leads", { method: "POST", json: { prospects: list } });
      for (const p of list) {
        const s = res.saved.find((x) => x.name === p.name) ?? res.skipped.find((x) => x.name === p.name);
        if (s) updateProspect(p.key, { savedLeadId: "id" in s ? s.id : s.leadId });
      }
      toast(res.saved.length ? `Added ${res.saved.length} to your pipeline${res.skipped.length ? ` (${res.skipped.length} already there)` : ""}` : "Already in your pipeline");
      setSelected(new Set());
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  async function audit(p: Prospect) {
    if (!p.website) return;
    setBusy(p.key);
    try {
      const res = await api<{ audit: AuditResult; signals: Signal[]; score: number }>("/api/prospects/audit", {
        method: "POST",
        json: { url: p.website, niche: p.niche, rating: p.rating, reviewCount: p.reviewCount, phone: p.phone },
      });
      updateProspect(p.key, { audit: res.audit, signals: res.signals, score: res.score });
      if (detail?.key === p.key) setDetail({ ...p, audit: res.audit, signals: res.signals, score: res.score });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const adsHref = (p: Prospect) =>
    `/ads?${new URLSearchParams({ business: p.name, niche: p.niche, location: result?.location ?? location, ...(p.website ? { website: p.website } : {}), ...(p.savedLeadId ? { lead: p.savedLeadId } : {}) })}`;

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <div className="finder">
      <div className="stack" style={{ gap: 14, minWidth: 0 }}>
        <form
          className="card search-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <div className="search-grid">
            <label className="field">
              <span>Niche</span>
              <select className="select" value={niche} onChange={(e) => setNiche(e.target.value)}>
                {niches.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
                <option value="custom">Something else…</option>
              </select>
            </label>
            <PlacePicker
              value={location}
              onChange={(place) => {
                setLocation(place);
                setNear(null);
              }}
              near={Boolean(near)}
              cityAction={
                <button
                  type="button"
                  className="btn icon"
                  onClick={() => (near ? setNear(null) : locateMe())}
                  aria-pressed={Boolean(near)}
                  aria-label={near ? "Stop searching near my location" : "Search near my location"}
                  title={near ? "Pick a city instead" : "Search near me"}
                >
                  {locating ? <LoaderCircle size={16} className="spin" /> : <Crosshair size={16} />}
                </button>
              }
            />
            <label className="field">
              <span>Radius</span>
              <select className="select" value={radius} onChange={(e) => setRadius(Number(e.target.value))} disabled={places && !near}>
                {[5, 12, 25, 40].map((r) => (
                  <option key={r} value={r}>
                    {r} km
                  </option>
                ))}
              </select>
            </label>
            <button className="btn primary" style={{ height: 38 }} disabled={loading}>
              {loading ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />} Search
            </button>
          </div>
          {niche === "custom" && (
            <label className="field" style={{ marginTop: 10 }}>
              <span>What kind of business?</span>
              <input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="e.g. tattoo studio, wedding photographer" />
            </label>
          )}
          <div className="row wrap filters-scroll" style={{ marginTop: 12, gap: 6 }}>
            <span className="faint small" style={{ marginRight: 4 }}>
              Show only:
            </span>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className="chip"
                aria-pressed={filters.includes(f.id)}
                onClick={() => setFilters((x) => (x.includes(f.id) ? x.filter((y) => y !== f.id) : [...x, f.id]))}
              >
                {filters.includes(f.id) && <Check size={12} />}
                {f.label}
              </button>
            ))}
          </div>
        </form>

        {nicheInfo && (
          <details className="niche-mobile">
            <summary className="card niche-summary">
              <span className="icon-tile">
                <DynIcon name={nicheInfo.icon} size={15} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>What works for {nicheInfo.plural}</b>
                <span className="faint small" style={{ display: "block" }}>
                  Offers, customer value, sources
                </span>
              </span>
              <ChevronDown size={18} className="faint chev" />
            </summary>
            <div style={{ marginTop: 10 }}>
              <NichePanel n={nicheInfo} />
            </div>
          </details>
        )}

        {loading && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="row small muted">
              <LoaderCircle size={15} className="spin" /> {phase}
            </div>
            <div className="results">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="card prospect">
                  <div className="skeleton" style={{ height: 18, width: "70%" }} />
                  <div className="skeleton" style={{ height: 12, width: "50%" }} />
                  <div className="skeleton" style={{ height: 26, width: "90%" }} />
                  <div className="skeleton" style={{ height: 30, width: "60%" }} />
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && error && (
          <div className="card card-pad stack">
            <div className="tip warn">
              <span>{error}</span>
            </div>
            <div className="row wrap">
              <button className="btn" onClick={() => void search()}>
                Try again
              </button>
            </div>
          </div>
        )}

        {!loading && !error && result && (
          <>
            <div className="row between wrap" style={{ gap: 8 }}>
              <div className="row wrap small muted" style={{ gap: 8 }}>
                <b style={{ color: "var(--text)" }}>
                  {shown.length} of {result.prospects.length} {result.niche.plural}
                </b>
                near {result.location}
                {result.sources?.length ? (
                  result.sources.map((src) => (
                    <span key={src.label} className="badge outline" title={src.url}>
                      {src.label.replace(/^City of (\S+) business licences$/, "$1 licences")} · {src.count}
                    </span>
                  ))
                ) : (
                  <span className="badge outline">{SOURCE_LABEL[result.source] ?? result.source}</span>
                )}
              </div>
              {shown.length > 0 && (
                <button className="btn sm ghost" onClick={() => setSelected(new Set(shown.filter((p) => !p.savedLeadId).map((p) => p.key)))}>
                  Select all new
                </button>
              )}
            </div>
            {result.note && (
              <div className="tip neutral">
                <Lightbulb size={15} />
                <span>
                  {result.note}
                  {result.source !== "google_places" && (
                    <>
                      {" "}
                      <Link href="/settings">Settings</Link>
                    </>
                  )}
                </span>
              </div>
            )}
            {shown.length ? (
              <div className="results">
                {shown.map((p) => (
                  <article key={p.key} className={`card prospect ${selected.has(p.key) ? "selected" : ""}`}>
                    <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
                      {!p.savedLeadId && <input type="checkbox" className="check" checked={selected.has(p.key)} onChange={() => toggle(p.key)} aria-label={`Select ${p.name}`} style={{ marginTop: 3 }} />}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <button type="button" onClick={() => setDetail(p)} style={{ all: "unset", cursor: "pointer" }}>
                          <h3>{p.name}</h3>
                        </button>
                        <div className="meta-line" style={{ marginTop: 4 }}>
                          {p.address && (
                            <span className="truncate" style={{ maxWidth: "100%" }}>
                              <MapPin size={12} /> {p.address}
                            </span>
                          )}
                        </div>
                      </div>
                      <ScoreRing score={p.score} />
                    </div>
                    <div className="meta-line">
                      {p.rating !== undefined && (
                        <span>
                          <Star size={12} fill="currentColor" style={{ color: "var(--warm)" }} /> {p.rating.toFixed(1)} ({p.reviewCount ?? 0})
                        </span>
                      )}
                      {p.phone && (
                        <span>
                          <Phone size={12} /> {p.phone}
                        </span>
                      )}
                      {p.website ? (
                        <a href={p.website} target="_blank" rel="noreferrer" style={{ color: "var(--brand-ink)" }} title={p.websiteFound ? "Not in any listing: Rainmaker's crawler found it" : undefined}>
                          <Globe size={12} /> {p.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "")}
                          {p.websiteFound ? " (found)" : ""}
                        </a>
                      ) : (
                        <span style={{ color: "var(--hot)" }}>
                          <Globe size={12} /> {p.source === "google_places" ? "No website listed" : "No website found"}
                        </span>
                      )}
                      {p.email && (
                        <a href={`mailto:${p.email}`} style={{ color: "var(--brand-ink)" }}>
                          <Mail size={12} /> {p.email}
                        </a>
                      )}
                    </div>
                    {p.foundIn?.length ? <div className="faint small">Found in {p.foundIn.join(", ")}</div> : null}
                    <SignalChips signals={p.signals} />
                    <div className="actions">
                      {p.savedLeadId ? (
                        <Link href={`/pipeline?lead=${p.savedLeadId}`} className="btn sm">
                          <Check size={14} style={{ color: "var(--good)" }} /> In pipeline
                        </Link>
                      ) : (
                        <button className="btn sm primary" onClick={() => void save([p])} disabled={busy === "save"}>
                          <Plus size={14} /> Add to pipeline
                        </button>
                      )}
                      {p.website && !p.audit && (
                        <button className="btn sm" onClick={() => void audit(p)} disabled={busy === p.key}>
                          {busy === p.key ? <LoaderCircle size={14} className="spin" /> : <SearchCheck size={14} />} Audit site
                        </button>
                      )}
                      <Link href={adsHref(p)} className="btn sm ghost">
                        <Megaphone size={14} /> Sample ads
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="card">
                {result.prospects.length ? (
                  <Empty icon={<Radar size={18} />} title="Nothing matches those filters">
                    Turn a filter off, widen the radius or try a neighbouring city.
                  </Empty>
                ) : (
                  <Empty icon={<Radar size={18} />} title={`No ${result.niche.plural} found here`}>
                    {result.source !== "google_places" ? (
                      <>
                        None of the free sources list any near {result.location}. Try a wider radius or a bigger city nearby, or{" "}
                        <Link href="/settings">add a Claude API key</Link> so Rainmaker also searches the web.
                      </>
                    ) : (
                      "Try a wider radius or a bigger city nearby."
                    )}
                  </Empty>
                )}
              </div>
            )}
          </>
        )}

        {!loading && !error && !result && (
          <div className="card">
            <Empty icon={<Radar size={18} />} title="Search a niche and a city">
              You&apos;ll get a ranked list of businesses with the problems you can fix for them: no booking, slow sites, missing reviews, no ads. Then add the best ones to your pipeline in one click.
            </Empty>
          </div>
        )}

        {selected.size > 0 && (
          <div className="bulkbar">
            <b className="small">{selected.size} selected</b>
            <button className="btn sm primary" onClick={() => void save((result?.prospects ?? []).filter((p) => selected.has(p.key)))} disabled={busy === "save"}>
              {busy === "save" ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />} Add to pipeline
            </button>
            <button className="btn sm ghost" onClick={() => setSelected(new Set())}>
              <X size={14} /> Clear
            </button>
          </div>
        )}
      </div>

      <aside className="playbook-side stack" style={{ gap: 14 }}>
        {nicheInfo ? <NichePanel n={nicheInfo} /> : <div className="card card-pad muted small">Pick a niche from the list to see what works for it.</div>}
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <div className="section-title" style={{ margin: 0 }}>
            How agencies land these clients
          </div>
          <ul className="clean small muted">
            <li>
              <ArrowRight size={13} /> Lead with one gap you found, not a pitch deck.
            </li>
            <li>
              <ArrowRight size={13} /> Send a free sample ad made for them.
            </li>
            <li>
              <ArrowRight size={13} /> Follow up 3 times: many replies come after the first email.
            </li>
          </ul>
          <Link href="/playbooks" className="btn sm">
            See all playbooks <ArrowRight size={14} />
          </Link>
        </div>
      </aside>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} label="Business details">
        {detail && (
          <>
            <div className="drawer-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                  <TierBadge score={detail.score} />
                  <span className="faint small">{detail.category}</span>
                </div>
                <h2>{detail.name}</h2>
                {detail.address && <div className="muted small" style={{ marginTop: 4 }}>{detail.address}</div>}
              </div>
              <ScoreRing score={detail.score} />
              <button className="btn ghost icon" onClick={() => setDetail(null)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="drawer-body stack" style={{ gap: 18 }}>
              <div className="row wrap">
                {detail.savedLeadId ? (
                  <Link href={`/pipeline?lead=${detail.savedLeadId}`} className="btn">
                    Open in pipeline <ArrowRight size={14} />
                  </Link>
                ) : (
                  <button className="btn primary" onClick={() => void save([detail]).then(() => setDetail(null))}>
                    <Plus size={14} /> Add to pipeline
                  </button>
                )}
                <Link href={adsHref(detail)} className="btn">
                  <Megaphone size={14} /> Make sample ads
                </Link>
                {detail.website && !detail.audit && (
                  <button className="btn" onClick={() => void audit(detail)} disabled={busy === detail.key}>
                    {busy === detail.key ? <LoaderCircle size={14} className="spin" /> : <SearchCheck size={14} />} Audit website
                  </button>
                )}
              </div>
              <section>
                <div className="section-title">What you can sell them</div>
                <SignalList signals={detail.signals} />
              </section>
              {detail.audit && (
                <section>
                  <div className="section-title">Website check</div>
                  <AuditDetails audit={detail.audit} />
                </section>
              )}
              <section>
                <div className="section-title">Look closer</div>
                <div className="row wrap">
                  {detail.mapsUrl && (
                    <a className="btn sm" href={detail.mapsUrl} target="_blank" rel="noreferrer">
                      <MapPin size={13} /> Map listing <ExternalLink size={12} />
                    </a>
                  )}
                  <a className="btn sm" href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&search_type=keyword_unordered&q=${encodeURIComponent(detail.name)}`} target="_blank" rel="noreferrer">
                    Are they running Meta ads? <ExternalLink size={12} />
                  </a>
                  <a className="btn sm" href={`https://www.google.com/search?q=${encodeURIComponent(`${detail.name} ${detail.address ?? ""} reviews`)}`} target="_blank" rel="noreferrer">
                    Reviews and website <ExternalLink size={12} />
                  </a>
                </div>
              </section>
            </div>
          </>
        )}
      </Drawer>
    </div>
  );
}

function NichePanel({ n }: { n: NicheLite }) {
  return (
    <div className="card">
      <div className="card-head" style={{ justifyContent: "flex-start" }}>
        <span className="icon-tile">
          <DynIcon name={n.icon} size={15} />
        </span>
        <h3>Winning {n.plural}</h3>
      </div>
      <div className="card-body stack" style={{ gap: 14 }}>
        {n.tip && (
          <div className="tip">
            <Lightbulb size={15} />
            <span>{n.tip}</span>
          </div>
        )}
        <dl className="kv">
          <dt>A customer is worth</dt>
          <dd>{n.customerValue}</dd>
          <dt>Agencies charge</dt>
          <dd>{n.retainer}</dd>
          <dt>Best channels</dt>
          <dd>{n.channels.join(", ")}</dd>
        </dl>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>
            Offers that convert
          </div>
          <ul className="clean small">
            {n.offers.map((o) => (
              <li key={o}>
                <Check size={13} /> {o}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="label" style={{ marginBottom: 6 }}>
            What keeps them up at night
          </div>
          <ul className="clean small muted">
            {n.painPoints.map((o) => (
              <li key={o}>
                <ArrowRight size={13} /> {o}
              </li>
            ))}
          </ul>
        </div>
        {n.evidence && n.evidence.length > 0 && (
          <div className="evidence">
            <div className="label">Sources</div>
            {n.evidence.map((e) => (
              <a key={e.url} href={e.url} target="_blank" rel="noreferrer">
                {e.text}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
