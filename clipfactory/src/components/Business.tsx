"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { compactNum, PLATFORM_NAME, PLATFORMS, postValue, type Account, type BizView, type Campaign, type Creator, type Opportunity, type Permission, type Platform, type PostRecord, type Suggestion } from "@/lib/biz";

// The clipping business: who to clip, campaigns, accounts, posts and money.

type Run = (action: string, payload?: Record<string, unknown>) => Promise<unknown>;

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PERM_LABEL: Record<Permission, string> = { campaign: "Paid campaign", allowed: "Allowed", unknown: "Ask first", denied: "No clips" };
const PERM_CLASS: Record<Permission, string> = { campaign: "lime", allowed: "cyan", unknown: "amber", denied: "pink" };
const PLAT_SHORT: Record<string, string> = { youtube: "YT", tiktok: "TT", instagram: "IG", twitch: "TW", kick: "KK" };

function ago(t?: number): string {
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) return `in ${until(t)}`;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function until(t: number): string {
  const s = Math.max(0, Math.round((t - Date.now()) / 1000));
  if (s < 90) return "a minute";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export default function Business() {
  const [v, setV] = useState<BizView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/biz", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setV((await r.json()) as BizView);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 4000);
    return () => clearInterval(t);
  }, [load]);

  // Back from TikTok's login.
  useEffect(() => {
    const url = new URL(window.location.href);
    const tt = url.searchParams.get("tiktok");
    if (!tt) return;
    if (tt === "connected") setNotice(`TikTok connected: ${url.searchParams.get("name") ?? ""}`);
    else setError(url.searchParams.get("message") ?? "The TikTok login didn't finish.");
    for (const k of ["tiktok", "name", "message"]) url.searchParams.delete(k);
    window.history.replaceState(null, "", url);
  }, []);

  const run: Run = useCallback(async (action, payload = {}) => {
    setBusy(action);
    setError(null);
    try {
      const r = await fetch("/api/biz", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
      const body = (await r.json().catch(() => ({}))) as { result?: unknown; snapshot?: BizView; error?: string };
      if (!r.ok) throw new Error(body.error ?? `Failed (${r.status})`);
      if (body.snapshot) setV(body.snapshot);
      return body.result;
    } catch (err) {
      setError((err as Error).message);
      throw err;
    } finally {
      setBusy(null);
    }
  }, []);

  if (!v) return <div className="factory"><div className="hint">Loading…</div></div>;
  const e = v.earnings;
  const on = v.autopilot.enabled;
  return (
    <div className="factory biz">
      <header className="head">
        <div style={{ minWidth: 0 }}>
          <div className="crumb">
            <span className={`dot${on ? "" : " idle"}`} />
            <Link href="/" className="crumb-link">Clip Factory</Link> / Business
          </div>
          <h1 className="title">
            Clipping <em>business</em>
          </h1>
          <div className="subtitle">Who to clip · campaigns · accounts · earnings</div>
          <div className="head-actions">
            <button className={`btn ${on ? "lime" : "primary"}`} onClick={() => run("autopilot.update", { patch: { enabled: !on } }).catch(() => {})} disabled={busy === "autopilot.update"}>
              {on ? "■ Autopilot on" : "▶ Turn autopilot on"}
            </button>
            <button className="btn" onClick={() => run("autopilot.scan").catch(() => {})} disabled={busy === "autopilot.scan"}>
              Scan now
            </button>
            <button className="btn" onClick={() => run("scout.refresh").catch(() => {})} disabled={busy === "scout.refresh"}>
              Refresh scout
            </button>
            <button className="btn" onClick={() => run("stats.refresh").catch(() => {})}>
              Refresh views
            </button>
            <Link className="btn" href="/">
              ← Factory
            </Link>
          </div>
        </div>
        <div className="shipped">
          <div className="label">Earned (est.)</div>
          <div className="count money">{money(e.total.usd)}</div>
          <div className="label">{e.total.paid ? `${money(e.total.paid)} paid out` : "from campaign rates × views"}</div>
        </div>
      </header>

      <div className={`biz-status${on ? " on" : ""}`} role="status">
        {on ? (
          <>
            Autopilot on · {v.status.nextScanAt ? (v.status.nextScanAt <= Date.now() ? "scanning soon" : `next scan in ${until(v.status.nextScanAt)}`) : ""} · {v.status.jobsToday} of {v.autopilot.maxJobsPerDay} VODs today · last scan {ago(v.status.lastScanAt)}
          </>
        ) : (
          <>Autopilot off. Scheduled posts still go out; turn it on to find new VODs and clip them by itself.</>
        )}
        {v.status.lastError && <span className="err"> · {v.status.lastError}</span>}
      </div>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button className="btn" onClick={() => setError(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      {notice && (
        <div className="error-banner ok" role="status">
          <span>{notice}</span>
          <button className="btn" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <Kpis v={v} />

      <div className="grid-2">
        <WhoToClip v={v} run={run} busy={busy} />
        <Discover v={v} run={run} busy={busy} />
      </div>
      <div className="grid-2">
        <Creators v={v} run={run} />
        <Campaigns v={v} run={run} />
      </div>
      <div className="grid-2">
        <Posts v={v} run={run} />
        <Earnings v={v} run={run} />
      </div>
      <div className="grid-2">
        <Accounts v={v} run={run} />
        <Lessons v={v} />
      </div>
      <div className="grid-2">
        <AutopilotSettings v={v} run={run} />
        <Sources v={v} run={run} />
      </div>
      <Log v={v} />
    </div>
  );
}

// ── Numbers across the top ───────────────────────────────────────────

function Kpis({ v }: { v: BizView }) {
  const e = v.earnings;
  const scheduled = v.posts.filter((p) => p.status === "scheduled").length;
  const live = v.posts.filter((p) => p.status === "posted").length;
  const toSubmit = e.submit.reduce((n, s) => n + s.usd, 0);
  const views14 = e.daily.reduce((n, d) => n + d.views, 0);
  const tiles = [
    { label: "Views · 14 days", value: compactNum(views14) },
    { label: "Posts live", value: String(live) },
    { label: "Scheduled", value: String(scheduled) },
    { label: "To submit", value: e.submit.filter((x) => !x.missed).length ? `${e.submit.filter((x) => !x.missed).length}${toSubmit ? ` · ${money(toSubmit)}` : ""}` : "0" },
    { label: "Creators tracked", value: String(v.creators.length) },
    { label: "Active campaigns", value: String(v.campaigns.filter((k) => k.status === "active").length) },
  ];
  return (
    <div className="biz-kpis">
      {tiles.map((t) => (
        <div key={t.label} className="tile">
          <div className="tile-v">{t.value}</div>
          <div className="tile-l">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Who to clip ──────────────────────────────────────────────────────

function WhoToClip({ v, run, busy }: { v: BizView; run: Run; busy: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="panel" aria-label="Who to clip">
      <div className="ph">
        <span className="name">Who to clip · ranked</span>
        <span className="right">{v.opportunitiesAt ? `scouted ${ago(v.opportunitiesAt)}` : "press Refresh scout"}</span>
      </div>
      <div className="pb">
        {!v.opportunities.length && <p className="hint">Add creators below (paste their channel link), or pick some from Worth a look. Then each one gets a score from what their campaign pays, their audience, whether there's a fresh VOD, what viewers are clipping, and how your own posts of them did.</p>}
        <div className="biz-rows">
          {v.opportunities.map((o, i) => (
            <OppRow key={o.creatorId} o={o} rank={i + 1} open={open === o.creatorId} onToggle={() => setOpen(open === o.creatorId ? null : o.creatorId)} run={run} busy={busy} />
          ))}
        </div>
      </div>
    </section>
  );
}

function OppRow({ o, rank, open, onToggle, run, busy }: { o: Opportunity; rank: number; open: boolean; onToggle: () => void; run: Run; busy: string | null }) {
  return (
    <div className="biz-row">
      <div className="opp-main">
        <span className="rank mono">{String(rank).padStart(2, "0")}</span>
        <Avatar src={o.avatar} name={o.creatorName} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="opp-name">
            <a href={o.url} target="_blank" rel="noreferrer">
              {o.creatorName}
            </a>{" "}
            <span className="plat">{PLAT_SHORT[o.platform]}</span> <span className={`pill ${PERM_CLASS[o.permission]}`}>{PERM_LABEL[o.permission]}</span>
            {o.campaign && <span className="pill dark">{money(o.campaign.ratePer1k)}/1K</span>}
          </div>
          <div className="meter" aria-label={`Score ${o.score} of 100`}>
            <i style={{ width: `${o.score}%` }} />
          </div>
          <div className="hint">{o.blocked ? `Waiting: ${o.blocked}` : o.vod ? `Next: "${o.vod.title.slice(0, 70)}"` : ""}</div>
        </div>
        <span className="score mono">{o.score}</span>
      </div>
      <div className="opp-actions">
        <button className="chipbtn" onClick={onToggle} aria-expanded={open}>
          {open ? "Less" : "Why"}
        </button>
        <button className="chipbtn on" disabled={o.permission === "unknown" || o.permission === "denied" || busy === "creator.clip"} title={o.permission === "unknown" ? "Mark them as allowed or add their campaign first" : "Clip their newest VOD now"} onClick={() => run("creator.clip", { id: o.creatorId }).catch(() => {})}>
          Clip now
        </button>
      </div>
      {open && (
        <ul className="reasons">
          {o.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
          <li className="mono hint">
            pay {o.factors.pay} · demand {o.factors.demand} · fresh {o.factors.fresh} · momentum {o.factors.momentum} · your track record {o.factors.track}
          </li>
          {o.usdPerShort !== undefined && <li>At your median views, a short of them earns about {money(o.usdPerShort)}.</li>}
        </ul>
      )}
    </div>
  );
}

function Avatar({ src, name }: { src?: string; name: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img className="avatar" src={src} alt="" width={28} height={28} /> : <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>;
}

// ── Discovery ──────────────────────────────────────────────────────────

function Discover({ v, run, busy }: { v: BizView; run: Run; busy: string | null }) {
  const [lang, setLang] = useState("en");
  const sources = [v.setup.twitch && "Twitch", v.setup.kick && "Kick", v.connections.youtubeData && "YouTube"].filter(Boolean);
  return (
    <section className="panel" aria-label="Worth a look">
      <div className="ph">
        <span className="name">Worth a look</span>
        <span className="right">{v.suggestionsAt ? ago(v.suggestionsAt) : ""}</span>
      </div>
      <div className="pb">
        <div className="toggles" style={{ marginBottom: 8 }}>
          <select className="chipbtn" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="pt">Portuguese</option>
            <option value="de">German</option>
            <option value="fr">French</option>
            <option value="">Any language</option>
          </select>
          <button className="chipbtn on" onClick={() => run("scout.refresh", { language: lang }).catch(() => {})} disabled={busy === "scout.refresh" || !sources.length}>
            Find creators
          </button>
        </div>
        {!sources.length && <p className="hint">Connect Twitch, Kick or YouTube under Sources &amp; keys: discovery reads who's live, how many are watching, and how much their viewers clip them.</p>}
        {sources.length > 0 && !v.suggestions.length && <p className="hint">Press Find creators to look across {sources.join(", ")}.</p>}
        <div className="biz-rows">
          {v.suggestions.slice(0, 25).map((s) => (
            <SuggestionRow key={s.id} s={s} run={run} />
          ))}
        </div>
        {v.suggestions.length > 0 && <p className="hint">Big audiences and lots of community clips mean demand. Before you clip anyone, find their paid campaign or check they allow clips.</p>}
      </div>
    </section>
  );
}

function SuggestionRow({ s, run }: { s: Suggestion; run: Run }) {
  return (
    <div className="biz-row">
      <div className="opp-main">
        <Avatar src={s.avatar} name={s.name} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="opp-name">
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.name}
            </a>{" "}
            <span className="plat">{PLAT_SHORT[s.platform]}</span>
            {s.campaignId && <span className="pill lime">Campaign on file</span>}
          </div>
          <div className="hint">{s.reasons.join(" · ")}</div>
        </div>
        <button className="chipbtn" onClick={() => run("creator.track", { id: s.id }).catch(() => {})}>
          Track
        </button>
      </div>
    </div>
  );
}

// ── Creators ─────────────────────────────────────────────────────────

function Creators({ v, run }: { v: BizView; run: Run }) {
  const [input, setInput] = useState("");
  const [perm, setPerm] = useState<Permission>("unknown");
  const [note, setNote] = useState("");
  return (
    <section className="panel" aria-label="Creators">
      <div className="ph">
        <span className="name">Creators</span>
        <span className="right">{v.creators.length} tracked</span>
      </div>
      <div className="pb">
        <form
          className="biz-form"
          onSubmit={(e) => {
            e.preventDefault();
            run("creator.add", { input, permission: perm, permissionNote: note })
              .then(() => {
                setInput("");
                setNote("");
              })
              .catch(() => {});
          }}
        >
          <label className="field wide">
            Channel link
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="twitch.tv/name · kick.com/name · youtube.com/@name" required />
          </label>
          <label className="field">
            Permission
            <select value={perm} onChange={(e) => setPerm(e.target.value as Permission)}>
              <option value="unknown">Not checked yet</option>
              <option value="allowed">They allow clips</option>
              <option value="denied">They don&apos;t want clips</option>
            </select>
          </label>
          <label className="field">
            Where it says so
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. pinned in their Discord" />
          </label>
          <button className="btn primary" type="submit">
            Add
          </button>
        </form>
        <p className="hint">A creator with a paid campaign on file counts as permission. The autopilot only clips creators marked as paid or allowed.</p>
        <div className="biz-rows">
          {v.creators.map((c) => (
            <CreatorRow key={c.id} c={c} run={run} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CreatorRow({ c, run }: { c: Creator; run: Run }) {
  const [vocab, setVocab] = useState((c.vocabulary ?? []).join(", "));
  const s = c.stats;
  const facts = [
    s?.live ? `live, ${compactNum(s.liveViewers ?? 0)} watching` : s?.avgViewers ? `~${compactNum(s.avgViewers)} viewers` : "",
    s?.followers ? `${compactNum(s.followers)} followers` : s?.subscribers ? `${compactNum(s.subscribers)} subscribers` : "",
    s?.vodsPer7d !== undefined ? `${s.vodsPer7d} VODs this week` : "",
    s?.clips24h ? `${s.clips24h} clips in 24 h` : "",
  ].filter(Boolean);
  return (
    <div className="biz-row">
      <div className="opp-main">
        <Avatar src={c.avatar} name={c.name} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="opp-name">
            <a href={c.url} target="_blank" rel="noreferrer">
              {c.name}
            </a>{" "}
            <span className="plat">{PLAT_SHORT[c.platform]}</span>
          </div>
          <div className="hint">{facts.join(" · ") || "No stats yet"}{c.permissionNote ? ` · ${c.permissionNote}` : ""}</div>
        </div>
        <select className="chipbtn" value={c.permission} onChange={(e) => run("creator.update", { id: c.id, patch: { permission: e.target.value } }).catch(() => {})} aria-label={`Permission for ${c.name}`}>
          <option value="campaign">Paid campaign</option>
          <option value="allowed">Allowed</option>
          <option value="unknown">Ask first</option>
          <option value="denied">No clips</option>
        </select>
      </div>
      <div className="toggles">
        <button className={`chipbtn${c.autopilot ? " on" : ""}`} aria-pressed={c.autopilot} disabled={c.permission === "denied"} onClick={() => run("creator.update", { id: c.id, patch: { autopilot: !c.autopilot } }).catch(() => {})}>
          Autopilot
        </button>
        {c.platform === "twitch" && (
          <button className={`chipbtn${c.clipLane ? " on" : ""}`} aria-pressed={Boolean(c.clipLane)} title="Turn the clips viewers make into shorts within the hour" onClick={() => run("creator.update", { id: c.id, patch: { clipLane: !c.clipLane } }).catch(() => {})}>
            Fast lane
          </button>
        )}
        <input className="chipbtn vocab" value={vocab} onChange={(e) => setVocab(e.target.value)} onBlur={() => vocab !== (c.vocabulary ?? []).join(", ") && run("creator.update", { id: c.id, patch: { vocabulary: vocab } }).catch(() => {})} placeholder="Names & slang for captions (comma-separated)" aria-label={`Words to spell right for ${c.name}`} />
        <button className="chipbtn" onClick={() => confirm(`Stop tracking ${c.name}?`) && run("creator.remove", { id: c.id }).catch(() => {})}>
          Remove
        </button>
      </div>
    </div>
  );
}

// ── Campaigns ────────────────────────────────────────────────────────

const EMPTY_CAMPAIGN = { id: "", name: "", url: "", creatorIds: [] as string[], ratePer1k: "", minViews: "", maxPerPost: "", budgetLeft: "", status: "active", requiredText: "", hashtags: "", mentions: "", platforms: [] as Platform[], minSec: "", maxSec: "", watermark: "", disclosure: "", notes: "", submitWithinMin: "30", feePct: "10" };

function Campaigns({ v, run }: { v: BizView; run: Run }) {
  const [f, setF] = useState(EMPTY_CAMPAIGN);
  const [editing, setEditing] = useState(false);
  const set = (patch: Partial<typeof EMPTY_CAMPAIGN>) => setF((x) => ({ ...x, ...patch }));
  const n = (s: string) => (s.trim() === "" ? undefined : Number(s));
  const edit = (k: Campaign) => {
    setEditing(true);
    setF({ id: k.id, name: k.name, url: k.url ?? "", creatorIds: k.creatorIds, ratePer1k: String(k.ratePer1k), minViews: k.minViews?.toString() ?? "", maxPerPost: k.maxPerPost?.toString() ?? "", budgetLeft: k.budgetLeft?.toString() ?? "", status: k.status, requiredText: k.rules.requiredText ?? "", hashtags: (k.rules.hashtags ?? []).join(", "), mentions: (k.rules.mentions ?? []).join(", "), platforms: k.rules.platforms ?? [], minSec: k.rules.minSec?.toString() ?? "", maxSec: k.rules.maxSec?.toString() ?? "", watermark: k.rules.watermark ?? "", disclosure: k.rules.disclosure ?? "", notes: k.rules.notes ?? "", submitWithinMin: k.submitWithinMin?.toString() ?? "", feePct: k.feePct?.toString() ?? "" });
  };
  const save = () =>
    run("campaign.save", {
      campaign: {
        id: f.id || undefined,
        name: f.name,
        url: f.url || undefined,
        creatorIds: f.creatorIds,
        ratePer1k: n(f.ratePer1k),
        minViews: n(f.minViews),
        maxPerPost: n(f.maxPerPost),
        budgetLeft: n(f.budgetLeft),
        status: f.status,
        submitWithinMin: n(f.submitWithinMin),
        feePct: n(f.feePct),
        rules: { requiredText: f.requiredText, hashtags: f.hashtags, mentions: f.mentions, platforms: f.platforms, minSec: n(f.minSec), maxSec: n(f.maxSec), watermark: f.watermark, disclosure: f.disclosure, notes: f.notes },
      },
    }).then(() => {
      setF(EMPTY_CAMPAIGN);
      setEditing(false);
    });
  return (
    <section className="panel" aria-label="Campaigns">
      <div className="ph">
        <span className="name">Campaigns</span>
        <span className="right toggles">
          <a className="chipbtn" href="https://contentrewards.com/c/discover" target="_blank" rel="noreferrer" title="Live clipping campaigns, with rates and budget left">
            Find campaigns ↗
          </a>
          <button className="chipbtn on" onClick={() => (editing ? (setEditing(false), setF(EMPTY_CAMPAIGN)) : setEditing(true))}>
            {editing ? "Cancel" : "+ Add campaign"}
          </button>
        </span>
      </div>
      <div className="pb">
        {editing && (
          <form
            className="biz-form"
            onSubmit={(e) => {
              e.preventDefault();
              save().catch(() => {});
            }}
          >
            <label className="field wide">
              Name
              <input value={f.name} onChange={(e) => set({ name: e.target.value })} required placeholder="e.g. Streamer clipping (Whop)" />
            </label>
            <label className="field wide">
              Campaign page (where you submit)
              <input value={f.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://whop.com/…" />
            </label>
            <label className="field">
              $ per 1K views
              <input type="number" step="0.01" min="0" value={f.ratePer1k} onChange={(e) => set({ ratePer1k: e.target.value })} required />
            </label>
            <label className="field">
              Paid after (views)
              <input type="number" min="0" value={f.minViews} onChange={(e) => set({ minViews: e.target.value })} placeholder="e.g. 10000" />
            </label>
            <label className="field">
              Max per post ($)
              <input type="number" min="0" value={f.maxPerPost} onChange={(e) => set({ maxPerPost: e.target.value })} />
            </label>
            <label className="field">
              Budget left ($)
              <input type="number" min="0" value={f.budgetLeft} onChange={(e) => set({ budgetLeft: e.target.value })} />
            </label>
            <label className="field" title="Content Rewards: submit within 30 minutes of posting; views count from then on. Leave empty if the campaign has no window.">
              Submit within (min)
              <input type="number" min="1" value={f.submitWithinMin} onChange={(e) => set({ submitWithinMin: e.target.value })} placeholder="none" />
            </label>
            <label className="field" title="The marketplace's cut of payouts (Content Rewards per-view: 10%)">
              Platform fee (%)
              <input type="number" min="0" max="50" value={f.feePct} onChange={(e) => set({ feePct: e.target.value })} />
            </label>
            <label className="field" title="The FTC wants paid promotion disclosed in the video itself">
              On-screen disclosure
              <input value={f.disclosure} onChange={(e) => set({ disclosure: e.target.value })} placeholder="#ad" />
            </label>
            <div className="field wide">
              Creators it pays for
              <div className="toggles">
                {v.creators.length ? (
                  v.creators.map((c) => (
                    <button type="button" key={c.id} className={`chipbtn${f.creatorIds.includes(c.id) ? " on" : ""}`} aria-pressed={f.creatorIds.includes(c.id)} onClick={() => set({ creatorIds: f.creatorIds.includes(c.id) ? f.creatorIds.filter((x) => x !== c.id) : [...f.creatorIds, c.id] })}>
                      {c.name}
                    </button>
                  ))
                ) : (
                  <span className="hint">Add the creator first (left).</span>
                )}
              </div>
            </div>
            <div className="field wide">
              Platforms that count
              <div className="toggles">
                {PLATFORMS.map((p) => (
                  <button type="button" key={p} className={`chipbtn${f.platforms.includes(p) ? " on" : ""}`} aria-pressed={f.platforms.includes(p)} onClick={() => set({ platforms: f.platforms.includes(p) ? f.platforms.filter((x) => x !== p) : [...f.platforms, p] })}>
                    {PLATFORM_NAME[p]}
                  </button>
                ))}
                <span className="hint">none picked = all</span>
              </div>
            </div>
            <label className="field wide">
              Required in every caption
              <input value={f.requiredText} onChange={(e) => set({ requiredText: e.target.value })} placeholder='e.g. "#ad" or "Clipped for @creator"' />
            </label>
            <label className="field">
              Hashtags
              <input value={f.hashtags} onChange={(e) => set({ hashtags: e.target.value })} placeholder="streamerclips, gaming" />
            </label>
            <label className="field">
              Mentions
              <input value={f.mentions} onChange={(e) => set({ mentions: e.target.value })} placeholder="@creator" />
            </label>
            <label className="field">
              Shortest (s)
              <input type="number" min="5" value={f.minSec} onChange={(e) => set({ minSec: e.target.value })} />
            </label>
            <label className="field">
              Longest (s)
              <input type="number" min="8" value={f.maxSec} onChange={(e) => set({ maxSec: e.target.value })} />
            </label>
            <label className="field">
              Watermark
              <input value={f.watermark} onChange={(e) => set({ watermark: e.target.value })} placeholder="@yourhandle" />
            </label>
            <label className="field">
              Status
              <select value={f.status} onChange={(e) => set({ status: e.target.value })}>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="ended">Ended</option>
              </select>
            </label>
            <label className="field wide">
              Rules &amp; direction (Claude reads this when picking moments)
              <input value={f.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="e.g. only gameplay moments, no politics, keep the original audio" />
            </label>
            <button className="btn primary" type="submit">
              Save campaign
            </button>
          </form>
        )}
        {!v.campaigns.length && !editing && <p className="hint">Paid clipping campaigns (Whop Content Rewards and others) pay per 1,000 views. Add each one you join with its rate and rules: the autopilot clips those creators first, writes the captions the way the campaign asks, and works out what you&apos;re owed.</p>}
        <div className="biz-rows">
          {v.campaigns.map((k) => {
            const row = v.earnings.byCampaign.find((r) => r.key === k.id);
            return (
              <div key={k.id} className="biz-row">
                <div className="opp-main">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="opp-name">
                      {k.url ? (
                        <a href={k.url} target="_blank" rel="noreferrer">
                          {k.name}
                        </a>
                      ) : (
                        k.name
                      )}{" "}
                      <span className={`pill ${k.status === "active" ? "lime" : "dark"}`}>{k.status}</span>
                    </div>
                    <div className="hint">
                      {money(k.ratePer1k)}/1K{k.minViews ? ` after ${compactNum(k.minViews)} views` : ""}
                      {k.maxPerPost ? ` · max ${money(k.maxPerPost)}/post` : ""}
                      {k.budgetLeft !== undefined ? ` · ${money(k.budgetLeft)} left` : ""}
                      {k.submitWithinMin ? ` · submit within ${k.submitWithinMin} min` : ""}
                      {k.feePct ? ` · ${k.feePct}% fee` : ""} · {k.creatorIds.map((id) => v.creators.find((c) => c.id === id)?.name ?? id).join(", ") || "no creators"}
                      {row ? ` · ${row.posts} posts, ${compactNum(row.views)} views, ${money(row.usd)}` : ""}
                    </div>
                  </div>
                  <button className="chipbtn" onClick={() => edit(k)}>
                    Edit
                  </button>
                  <button className="chipbtn" onClick={() => confirm(`Delete ${k.name}?`) && run("campaign.remove", { id: k.id }).catch(() => {})}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ── Posts ────────────────────────────────────────────────────────────

function Posts({ v, run }: { v: BizView; run: Run }) {
  const [tab, setTab] = useState<"scheduled" | "posted" | "failed">("scheduled");
  const list = v.posts.filter((p) => (tab === "scheduled" ? p.status === "scheduled" || p.status === "uploading" : p.status === tab));
  const sorted = tab === "scheduled" ? [...list].sort((a, b) => a.at.localeCompare(b.at)) : list;
  const accounts = useMemo(() => new Map(v.accounts.map((a) => [a.id, a])), [v.accounts]);
  const campaigns = useMemo(() => new Map(v.campaigns.map((k) => [k.id, k])), [v.campaigns]);
  const count = (s: string) => v.posts.filter((p) => (s === "scheduled" ? p.status === "scheduled" || p.status === "uploading" : p.status === s)).length;
  return (
    <section className="panel" aria-label="Posts">
      <div className="ph">
        <span className="name">Posts</span>
        <span className="right toggles">
          {(["scheduled", "posted", "failed"] as const).map((t) => (
            <button key={t} className={`chipbtn${tab === t ? " on" : ""}`} aria-pressed={tab === t} onClick={() => setTab(t)}>
              {t} {count(t)}
            </button>
          ))}
        </span>
      </div>
      <div className="pb">
        {!sorted.length && <p className="hint">{tab === "scheduled" ? "Nothing queued. Finished autopilot jobs land here, spread across your accounts' posting hours." : tab === "posted" ? "Nothing posted yet." : "No failures."}</p>}
        <div className="biz-rows">
          {sorted.slice(0, 60).map((p) => (
            <PostRow key={p.id} p={p} a={accounts.get(p.accountId)} k={p.campaignId ? campaigns.get(p.campaignId) : undefined} run={run} hold={v.autopilot.approvePosts && !p.approved} />
          ))}
        </div>
      </div>
    </section>
  );
}

function PostRow({ p, a, k, run, hold }: { p: PostRecord; a?: Account; k?: Campaign; run: Run; hold: boolean }) {
  const val = postValue(p.views, k, p);
  return (
    <div className="biz-row">
      <div className="opp-main">
        <span className="plat">{PLAT_SHORT[p.platform]}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="opp-name">{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a> : p.title}</div>
          <div className="hint">
            {a?.name ?? p.accountId} · {p.status === "scheduled" ? (hold ? `waiting for you (slot ${when(p.at)})` : when(p.at)) : p.status === "uploading" ? "uploading…" : p.postedAt ? new Date(p.postedAt).toLocaleDateString() : ""}
            {p.status === "posted" ? ` · ${compactNum(p.views)} views` : ""}
            {k && p.status === "posted" ? (val.eligible ? ` · ${money(val.usd)}` : ` · ${compactNum(val.toGo)} views to payout`) : ""}
            {p.error ? ` · ${p.error}` : ""}
          </div>
        </div>
        {p.status === "scheduled" && (
          <button className="chipbtn on" onClick={() => run("post.approve", { id: p.id }).catch(() => {})} title="Post it now (then submit it to the campaign)">
            Post now
          </button>
        )}
        {(p.status === "failed" || p.status === "scheduled") && (
          <>
            {p.status === "failed" && (
              <button className="chipbtn" onClick={() => run("post.update", { id: p.id, patch: { retry: true } }).catch(() => {})}>
                Retry
              </button>
            )}
            <button className="chipbtn" onClick={() => run("post.remove", { id: p.id }).catch(() => {})}>
              Drop
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Earnings ─────────────────────────────────────────────────────────

function Earnings({ v, run }: { v: BizView; run: Run }) {
  const e = v.earnings;
  const [by, setBy] = useState<"byCampaign" | "byCreator" | "byPlatform">("byCampaign");
  return (
    <section className="panel" aria-label="Earnings">
      <div className="ph">
        <span className="name">Earnings</span>
        <span className="right">{money(e.total.usd)} est. · {compactNum(e.total.views)} views</span>
      </div>
      <div className="pb">
        <DailyChart days={e.daily} />
        <div className="toggles" style={{ margin: "10px 0 6px" }}>
          {(
            [
              ["byCampaign", "By campaign"],
              ["byCreator", "By creator"],
              ["byPlatform", "By platform"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`chipbtn${by === k ? " on" : ""}`} aria-pressed={by === k} onClick={() => setBy(k)}>
              {label}
            </button>
          ))}
        </div>
        <table className="biz-table">
          <thead>
            <tr>
              <th />
              <th>Posts</th>
              <th>Views</th>
              <th>Est.</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            {e[by].map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="mono">{r.posts}</td>
                <td className="mono">{compactNum(r.views)}</td>
                <td className="mono">{money(r.usd)}</td>
                <td className="mono">{r.paid ? money(r.paid) : "—"}</td>
              </tr>
            ))}
            {!e[by].length && (
              <tr>
                <td colSpan={5} className="hint">
                  Earnings show once posts have views.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <h3 className="sub">
          Submit to campaigns {e.submit.length ? `· ${e.submit.length}` : ""} <SubmitAlerts items={e.submit} />
        </h3>
        {!e.submit.length && <p className="hint">Campaigns don&apos;t take submissions through an API: when a post goes live it shows here with the campaign&apos;s deadline (Content Rewards: 30 minutes, and only views after you submit count). Copy the link, submit it on the campaign page, then press Submitted.</p>}
        <div className="biz-rows">
          {e.submit.map((s) => (
            <div key={s.post.id} className={`biz-row${s.deadline && !s.missed && s.deadline - Date.now() < 10 * 60_000 ? " urgent" : ""}`}>
              <div className="opp-main">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="opp-name">{s.post.title}</div>
                  <div className="hint">
                    {s.campaign.name} · {PLAT_SHORT[s.post.platform]} · {compactNum(s.post.views)} views ·{" "}
                    {s.deadline ? (s.missed ? `window closed ${ago(s.deadline)}` : <b className="countdown">{until(s.deadline)} left to submit</b>) : `${money(s.usd)} so far`}
                  </div>
                </div>
              </div>
              <div className="opp-actions">
                <button className="chipbtn" onClick={() => s.post.url && navigator.clipboard?.writeText(s.post.url)} disabled={!s.post.url} title={s.post.url}>
                  Copy link
                </button>
                {s.campaign.url && (
                  <a className="chipbtn" href={s.campaign.url} target="_blank" rel="noreferrer">
                    Open campaign
                  </a>
                )}
                <button className="chipbtn on" onClick={() => run("post.update", { id: s.post.id, patch: { submitted: true } }).catch(() => {})}>
                  Submitted
                </button>
              </div>
            </div>
          ))}
        </div>
        <PaidEntry v={v} run={run} />
      </div>
    </section>
  );
}

/** A browser notification when a post's submission window opens (so you don't miss the 30 minutes). */
function SubmitAlerts({ items }: { items: { post: PostRecord; deadline?: number; missed?: boolean; campaign: Campaign }[] }) {
  const [perm, setPerm] = useState<string>("default");
  const [told, setTold] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (typeof Notification !== "undefined") setPerm(Notification.permission);
  }, []);
  useEffect(() => {
    if (perm !== "granted") return;
    const fresh = items.filter((i) => i.deadline && !i.missed && !told.has(i.post.id));
    if (!fresh.length) return;
    for (const i of fresh) new Notification("Submit your clip", { body: `${i.post.title} → ${i.campaign.name} (within ${until(i.deadline!)})`, tag: i.post.id });
    setTold((t) => new Set([...t, ...fresh.map((i) => i.post.id)]));
  }, [items, perm, told]);
  if (typeof Notification === "undefined" || perm === "granted") return null;
  return (
    <button className="chipbtn" onClick={() => Notification.requestPermission().then(setPerm)} disabled={perm === "denied"} title={perm === "denied" ? "Notifications are blocked for this site in your browser" : undefined}>
      Alert me
    </button>
  );
}

/** Record what a campaign actually paid for a submitted post. */
function PaidEntry({ v, run }: { v: BizView; run: Run }) {
  const submitted = v.posts.filter((p) => p.submittedAt && p.paid === undefined);
  const [amount, setAmount] = useState<Record<string, string>>({});
  if (!submitted.length) return null;
  return (
    <>
      <h3 className="sub">Waiting for payment · {submitted.length}</h3>
      <div className="biz-rows">
        {submitted.slice(0, 20).map((p) => (
          <div key={p.id} className="biz-row">
            <div className="opp-main">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="opp-name">{p.title}</div>
                <div className="hint">submitted {ago(p.submittedAt)} · {compactNum(p.views)} views</div>
              </div>
              <input className="chipbtn" style={{ width: 90 }} inputMode="decimal" placeholder="$ paid" value={amount[p.id] ?? ""} onChange={(e) => setAmount({ ...amount, [p.id]: e.target.value })} aria-label="Amount paid" />
              <button className="chipbtn on" disabled={!amount[p.id]} onClick={() => run("post.update", { id: p.id, patch: { paid: Number(amount[p.id]) } }).catch(() => {})}>
                Save
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Views per day over two weeks: one series, so no legend; hover a bar for the day's numbers. */
function DailyChart({ days }: { days: { day: string; views: number; usd: number; posts: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.views));
  const best = days.reduce((b, d) => (d.views > b.views ? d : b), days[0]);
  const label = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <figure className="daily" aria-label="Views per day, last 14 days">
      <figcaption className="daily-title">Views per day · 14 days</figcaption>
      <div className="daily-plot">
        {days.map((d) => (
          <div key={d.day} className="daily-col" tabIndex={0} aria-label={`${label(d.day)}: ${d.views.toLocaleString()} views, ${money(d.usd)}`}>
            <div className="daily-bar" style={{ height: `${d.views ? Math.max(3, (d.views / max) * 100) : 0}%` }} />
            {best && d.day === best.day && d.views > 0 && <span className="daily-max mono">{compactNum(d.views)}</span>}
            <span className="daily-tip" role="tooltip">
              <b>{label(d.day)}</b>
              <br />
              {d.views.toLocaleString()} views · {money(d.usd)} · {d.posts} post{d.posts === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>
      <div className="daily-axis mono">
        <span>{label(days[0].day)}</span>
        <span>today</span>
      </div>
      <table className="sr-only">
        <caption>Views and earnings per day</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <th scope="row">{d.day}</th>
              <td>{d.views} views</td>
              <td>{money(d.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ── Accounts ─────────────────────────────────────────────────────────

function Accounts({ v, run }: { v: BizView; run: Run }) {
  const [igToken, setIgToken] = useState("");
  const [pasteUrl, setPasteUrl] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const finishPaste = async () => {
    setMsg(null);
    const r = await fetch("/api/accounts/tiktok/callback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: pasteUrl }) });
    const body = (await r.json().catch(() => ({}))) as { name?: string; error?: string };
    setMsg(r.ok ? `Connected ${body.name}` : (body.error ?? "That didn't work."));
    if (r.ok) setPasteUrl("");
  };
  return (
    <section className="panel" aria-label="Accounts">
      <div className="ph">
        <span className="name">Accounts</span>
        <span className="right">{v.accounts.length} connected</span>
      </div>
      <div className="pb">
        <div className="biz-rows">
          {v.accounts.map((a) => (
            <AccountRow key={a.id} a={a} ready={v.accountsReady[a.id]} creators={v.creators} run={run} />
          ))}
        </div>
        {!v.accounts.length && <p className="hint">Connect where your shorts go. Give each account a creator to make it a theme page; accounts with none take anyone. Each short goes to one account per platform.</p>}
        <div className="connects">
          <div>
            <h3 className="sub">YouTube</h3>
            <p className="hint">Connect your channel from the factory page (Connect YouTube). It shows up here by itself.</p>
          </div>
          <div>
            <h3 className="sub">TikTok</h3>
            {v.setup.tiktokApp ? (
              <div className="toggles">
                <a className="btn" href="/api/accounts/tiktok/connect?mode=draft" title="Sends each short to your TikTok inbox; you tap Post. Works before TikTok audits your app.">
                  Connect (drafts)
                </a>
                <a className="btn" href="/api/accounts/tiktok/connect?mode=direct" title="Posts directly. Until TikTok audits your app, only to a private account, as private videos.">
                  Connect (direct post)
                </a>
              </div>
            ) : (
              <p className="hint">Add your TikTok app under Sources &amp; keys first.</p>
            )}
            <div className="toggles" style={{ marginTop: 6 }}>
              <input className="chipbtn grow" value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} placeholder="Landed on a page that didn't load? Paste its address" aria-label="Address TikTok sent you to" />
              <button className="chipbtn" disabled={!pasteUrl} onClick={() => finishPaste().catch(() => {})}>
                Finish
              </button>
            </div>
            {msg && <p className="hint">{msg}</p>}
          </div>
          <div>
            <h3 className="sub">Instagram Reels</h3>
            <div className="toggles">
              <input className="chipbtn grow" type="password" value={igToken} onChange={(e) => setIgToken(e.target.value)} placeholder="Long-lived access token from your Meta app" aria-label="Instagram access token" />
              <button className="chipbtn on" disabled={igToken.length < 20} onClick={() => run("instagram.connect", { token: igToken }).then(() => setIgToken("")).catch(() => {})}>
                Connect
              </button>
            </div>
            <p className="hint">Needs a Business or Creator account. A Facebook Login for Business token (EAA…, Instagram linked to a Page) uploads videos directly; see the README.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function AccountRow({ a, ready, creators, run }: { a: Account; ready: boolean; creators: Creator[]; run: Run }) {
  return (
    <div className="biz-row">
      <div className="opp-main">
        <Avatar src={a.avatar} name={a.name} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="opp-name">
            {a.name} <span className="plat">{PLAT_SHORT[a.platform]}</span> {ready ? <span className="pill lime">ready</span> : <span className="pill amber">not connected</span>}
          </div>
          <div className="hint">{a.error ? `⚠ ${a.error}` : a.creatorIds.length ? `Theme page: ${a.creatorIds.map((id) => creators.find((c) => c.id === id)?.name ?? id).join(", ")}` : "Takes any creator"}</div>
        </div>
        <label className="field" style={{ width: 92 }}>
          Per day
          <input type="number" min={0} max={50} defaultValue={a.dailyLimit} onBlur={(e) => Number(e.target.value) !== a.dailyLimit && run("account.update", { id: a.id, patch: { dailyLimit: Number(e.target.value) } }).catch(() => {})} />
        </label>
      </div>
      <div className="toggles">
        {creators.map((c) => (
          <button key={c.id} className={`chipbtn${a.creatorIds.includes(c.id) ? " on" : ""}`} aria-pressed={a.creatorIds.includes(c.id)} onClick={() => run("account.update", { id: a.id, patch: { creatorIds: a.creatorIds.includes(c.id) ? a.creatorIds.filter((x) => x !== c.id) : [...a.creatorIds, c.id] } }).catch(() => {})}>
            {c.name}
          </button>
        ))}
        {a.error && (
          <button className="chipbtn" onClick={() => run("account.update", { id: a.id, patch: { clearError: true } }).catch(() => {})}>
            Clear error
          </button>
        )}
        {a.platform !== "youtube" && (
          <button className="chipbtn" onClick={() => confirm(`Disconnect ${a.name}?`) && run("account.remove", { id: a.id }).catch(() => {})}>
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
}

// ── What's working ───────────────────────────────────────────────────

function Lessons({ v }: { v: BizView }) {
  const l = v.lessons;
  return (
    <section className="panel" aria-label="What's working">
      <div className="ph">
        <span className="name">What&apos;s working</span>
        <span className="right">{l ? `${l.posts} posts` : ""}</span>
      </div>
      <div className="pb">
        {!l && <p className="hint">After a few posts have views, this shows which kinds of clips do best for you. The autopilot passes it to Claude as direction for the next picks, per creator.</p>}
        {l && (
          <>
            <p className="hint">Median {compactNum(Math.round(l.medianViews))} views per post.{l.teaser ? ` Cold opens: ${compactNum(Math.round(l.teaser.with))} vs ${compactNum(Math.round(l.teaser.without))} without.` : ""}</p>
            <table className="biz-table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Posts</th>
                  <th>Median views</th>
                </tr>
              </thead>
              <tbody>
                {l.byCategory.map((c) => (
                  <tr key={c.category}>
                    <td>{c.category}</td>
                    <td className="mono">{c.posts}</td>
                    <td className="mono">{compactNum(Math.round(c.medianViews))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="sub">Best</h3>
            <ol className="reasons">
              {l.best.map((b, i) => (
                <li key={`${i}-${b.title}`}>
                  {b.title} <span className="mono hint">{compactNum(b.views)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

// ── Autopilot settings ─────────────────────────────────────────────────

function AutopilotSettings({ v, run }: { v: BizView; run: Run }) {
  const a = v.autopilot;
  const o = a.options;
  const save = (patch: Record<string, unknown>) => run("autopilot.update", { patch }).catch(() => {});
  const num = (label: string, key: string, value: number, min: number, max: number, hint?: string) => (
    <label className="field" title={hint}>
      {label}
      <input type="number" min={min} max={max} defaultValue={value} key={`${key}-${value}`} onBlur={(e) => Number(e.target.value) !== value && save({ [key]: Number(e.target.value) })} />
    </label>
  );
  const flag = (key: string, label: string, value: boolean | undefined) => (
    <button className={`chipbtn${value ? " on" : ""}`} aria-pressed={Boolean(value)} onClick={() => save({ options: { [key]: !value } })}>
      {label}
    </button>
  );
  return (
    <section className="panel" aria-label="Autopilot settings">
      <div className="ph">
        <span className="name">Autopilot settings</span>
      </div>
      <div className="pb">
        <div className="biz-form">
          {num("Scan every (min)", "scanEveryMin", a.scanEveryMin, 5, 1440)}
          {num("VODs per day", "maxJobsPerDay", a.maxJobsPerDay, 0, 100)}
          {num("Shorts per VOD", "shortsPerVod", a.shortsPerVod, 1, 50)}
          {num("Post if score ≥", "minScore", a.minScore, 0, 100, "Only shorts at least this good get posted")}
          <label className="field">
            Post between (hours)
            <span className="toggles" style={{ flexWrap: "nowrap" }}>
              <input type="number" min={0} max={23} defaultValue={a.postHours[0]} key={`h0-${a.postHours[0]}`} onBlur={(e) => save({ postHours: [Number(e.target.value), a.postHours[1]] })} aria-label="From" />
              <input type="number" min={1} max={24} defaultValue={a.postHours[1]} key={`h1-${a.postHours[1]}`} onBlur={(e) => save({ postHours: [a.postHours[0], Number(e.target.value)] })} aria-label="To" />
            </span>
          </label>
          {num("Gap between posts (min)", "spacingMin", a.spacingMin, 10, 1440, "Per account")}
          {num("Skip VODs older than (h)", "maxVodAgeHours", a.maxVodAgeHours, 1, 720)}
          <label className="field">
            YouTube privacy
            <select value={a.privacy} onChange={(e) => save({ privacy: e.target.value })}>
              <option value="public">Public (scheduled)</option>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
            </select>
          </label>
          <label className="field">
            Layout
            <select value={o.layout ?? "auto"} onChange={(e) => save({ options: { layout: e.target.value } })}>
              <option value="auto">Auto</option>
              <option value="split">Facecam split</option>
              <option value="crop">Crop</option>
              <option value="fit">Fit</option>
            </select>
          </label>
          <label className="field">
            Captions
            <select value={o.captionStyle ?? "pop"} onChange={(e) => save({ options: { captionStyle: e.target.value } })}>
              <option value="pop">Word pop</option>
              <option value="karaoke">Karaoke</option>
              <option value="clean">Clean</option>
            </select>
          </label>
          <label className="field wide">
            Your handle (watermark on every short)
            <input defaultValue={o.watermark ?? ""} key={`wm-${o.watermark ?? ""}`} placeholder="@yourhandle" onBlur={(e) => e.target.value !== (o.watermark ?? "") && save({ options: { watermark: e.target.value } })} />
          </label>
        </div>
        <div className="toggles" style={{ marginTop: 8 }}>
          {flag("teaser", "Cold open", o.teaser ?? true)}
          {flag("punchIns", "Punch-ins", o.punchIns ?? true)}
          {flag("sfx", "Sound FX", o.sfx ?? true)}
          {flag("titleBar", "Title bar", o.titleBar)}
          {flag("progressBar", "Progress bar", o.progressBar)}
          {flag("censor", "Bleep swearing", o.censor)}
          <button className={`chipbtn${a.approvePosts ? " on" : ""}`} aria-pressed={a.approvePosts} onClick={() => save({ approvePosts: !a.approvePosts })} title="Posts wait until you press Post now, so you're there to submit them within the campaign's window">
            Ask me before posting
          </button>
        </div>
      </div>
    </section>
  );
}

// ── Sources & keys ───────────────────────────────────────────────────

function Sources({ v, run }: { v: BizView; run: Run }) {
  const [tw, setTw] = useState({ clientId: "", clientSecret: "" });
  const [kk, setKk] = useState({ clientId: "", clientSecret: "" });
  const [yt, setYt] = useState("");
  const [tt, setTt] = useState({ clientKey: v.setup.tiktokApp?.clientKey ?? "", clientSecret: "", redirectUri: v.setup.tiktokApp?.redirectUri || "http://127.0.0.1:3200/api/accounts/tiktok/callback" });
  return (
    <section className="panel" aria-label="Sources and keys">
      <div className="ph">
        <span className="name">Sources &amp; keys</span>
        <span className="right">saved in .secrets/, never in the repo</span>
      </div>
      <div className="pb keys">
        <KeyBlock title="Twitch" ok={v.setup.twitch} help="An app at dev.twitch.tv/console/apps (any redirect URL). Reads who's live, VODs, and the clips viewers make.">
          <input placeholder="Client ID" value={tw.clientId} onChange={(e) => setTw({ ...tw, clientId: e.target.value })} aria-label="Twitch client ID" />
          <input placeholder="Client secret" type="password" value={tw.clientSecret} onChange={(e) => setTw({ ...tw, clientSecret: e.target.value })} aria-label="Twitch client secret" />
          <button className="chipbtn on" onClick={() => run("creds.twitch", tw).catch(() => {})}>
            Save
          </button>
        </KeyBlock>
        <KeyBlock title="Kick" ok={v.setup.kick} help="An app at kick.com/settings/developer. Kick's API shows who's live; it doesn't list VODs, so paste Kick VOD links into New VOD.">
          <input placeholder="Client ID" value={kk.clientId} onChange={(e) => setKk({ ...kk, clientId: e.target.value })} aria-label="Kick client ID" />
          <input placeholder="Client secret" type="password" value={kk.clientSecret} onChange={(e) => setKk({ ...kk, clientSecret: e.target.value })} aria-label="Kick client secret" />
          <button className="chipbtn on" onClick={() => run("creds.kick", kk).catch(() => {})}>
            Save
          </button>
        </KeyBlock>
        <KeyBlock title="YouTube Data API" ok={v.setup.youtubeKey || v.connections.youtubeData} help="An API key from Google Cloud (YouTube Data API v3), or just connect your channel. Reads channels' new videos and view counts.">
          <input placeholder="API key" type="password" value={yt} onChange={(e) => setYt(e.target.value)} aria-label="YouTube API key" />
          <button className="chipbtn on" onClick={() => run("creds.youtubeKey", { key: yt }).catch(() => {})}>
            Save
          </button>
        </KeyBlock>
        <KeyBlock title="TikTok app" ok={Boolean(v.setup.tiktokApp)} help="A Desktop app at developers.tiktok.com with Login Kit + Content Posting API; register the redirect URI below exactly.">
          <input placeholder="Client key" value={tt.clientKey} onChange={(e) => setTt({ ...tt, clientKey: e.target.value })} aria-label="TikTok client key" />
          <input placeholder="Client secret" type="password" value={tt.clientSecret} onChange={(e) => setTt({ ...tt, clientSecret: e.target.value })} aria-label="TikTok client secret" />
          <input placeholder="Redirect URI" value={tt.redirectUri} onChange={(e) => setTt({ ...tt, redirectUri: e.target.value })} aria-label="TikTok redirect URI" />
          <button className="chipbtn on" onClick={() => run("tiktok.app", tt).catch(() => {})}>
            Save
          </button>
        </KeyBlock>
      </div>
    </section>
  );
}

function KeyBlock({ title, ok, help, children }: { title: string; ok: boolean; help: string; children: React.ReactNode }) {
  return (
    <div className="keyblock">
      <h3 className="sub">
        {title} {ok ? <span className="pill lime">connected</span> : <span className="pill dark">not set</span>}
      </h3>
      <p className="hint">{help}</p>
      <div className="toggles">{children}</div>
    </div>
  );
}

// ── Log ──────────────────────────────────────────────────────────────

function Log({ v }: { v: BizView }) {
  return (
    <section className="panel" aria-label="Autopilot log">
      <div className="ph">
        <span className="name">Autopilot log</span>
      </div>
      <div className="pb">
        <div className="biz-log mono">
          {[...v.status.log].reverse().map((l, i) => (
            <div key={`${l.t}-${i}`} className={l.level === "warn" ? "warn" : ""}>
              <span className="t">{new Date(l.t).toLocaleTimeString()}</span> {l.msg}
            </div>
          ))}
          {!v.status.log.length && <span className="hint">Nothing yet.</span>}
        </div>
      </div>
    </section>
  );
}
