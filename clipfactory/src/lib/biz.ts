// The clipping business: who to clip, which campaigns pay for it, where the
// shorts get posted, and what they earned. Types plus the pure maths, shared
// by the server and the dashboard.

import type { JobOptions, Privacy } from "./types.ts";

/** Where long-form content comes from. */
export type SourcePlatform = "twitch" | "kick" | "youtube";
/** Where shorts get posted. */
export type Platform = "youtube" | "tiktok" | "instagram";
export const PLATFORMS: Platform[] = ["youtube", "tiktok", "instagram"];
export const PLATFORM_NAME: Record<Platform, string> = { youtube: "YouTube Shorts", tiktok: "TikTok", instagram: "Instagram Reels" };

/**
 * campaign: a paid campaign for this creator is on file (that is the permission).
 * allowed: the creator says clips are welcome (note where).
 * unknown: not checked yet; the autopilot won't clip them.
 * denied: they don't want clips; never clipped.
 */
export type Permission = "campaign" | "allowed" | "unknown" | "denied";

export interface CreatorStats {
  followers?: number;
  /** Typical concurrent viewers (Twitch/Kick), from recent streams. */
  avgViewers?: number;
  liveViewers?: number;
  live?: boolean;
  /** YouTube: subscribers and the median views of recent long videos. */
  subscribers?: number;
  recentViews?: number;
  /** Long-form uploads/streams in the last 7 days. */
  vodsPer7d?: number;
  /** Community clips in the last 24 h and their total views (Twitch). */
  clips24h?: number;
  clipViews24h?: number;
  updatedAt: number;
}

export interface Creator {
  /** "<platform>:<handle>", lower case. */
  id: string;
  platform: SourcePlatform;
  /** Twitch login, Kick slug, YouTube @handle or channel ID. */
  handle: string;
  name: string;
  url: string;
  avatar?: string;
  /** Twitch user ID, Kick user ID, YouTube channel ID. */
  platformId?: string;
  permission: Permission;
  /** Where the permission comes from ("Whop campaign", "pinned in their Discord", …). */
  permissionNote?: string;
  /** May the autopilot clip new VODs on its own. */
  autopilot: boolean;
  /** Fast lane: turn the clips viewers make (Twitch) into shorts within the hour. */
  clipLane?: boolean;
  /** Names and slang the captions must spell right (friends, games, catchphrases). */
  vocabulary?: string[];
  language?: string;
  tags?: string[];
  stats?: CreatorStats;
  /** VOD IDs already turned into a job (newest first, capped). */
  seenVods?: string[];
  addedAt: number;
}

export interface CampaignRules {
  /** Must appear in every caption, e.g. "#ad" or "Clipped for @creator". */
  requiredText?: string;
  hashtags?: string[];
  /** Handles to tag, e.g. "@creator". */
  mentions?: string[];
  minSec?: number;
  maxSec?: number;
  /** Platforms the campaign pays for (empty = all). */
  platforms?: Platform[];
  /** Text burned small in a corner of the video, e.g. your handle. */
  watermark?: string;
  /** Paid-promotion disclosure shown in the video itself, e.g. "#ad" (the FTC wants it on screen). */
  disclosure?: string;
  notes?: string;
}

export interface Campaign {
  id: string;
  name: string;
  /** The campaign page (Whop Content Rewards or elsewhere), where posts get submitted. */
  url?: string;
  creatorIds: string[];
  /** US dollars per 1,000 views. */
  ratePer1k: number;
  /** A post has to reach this many views before it pays. */
  minViews?: number;
  /** Most a single post can earn. */
  maxPerPost?: number;
  budget?: number;
  /** What's left in the campaign's budget, as last seen on its page. */
  budgetLeft?: number;
  endsAt?: string;
  status: "active" | "paused" | "ended";
  rules: CampaignRules;
  /**
   * Minutes after posting within which the post must be submitted (Content
   * Rewards: 30, and views only count from submission). Empty: any time.
   */
  submitWithinMin?: number;
  /** The platform's cut of payouts, percent (Content Rewards per-view: 10). */
  feePct?: number;
  addedAt: number;
}

export interface Account {
  /** "<platform>:<remote id>". */
  id: string;
  platform: Platform;
  name: string;
  handle?: string;
  avatar?: string;
  /** Creators this account posts (a theme page); empty = any. */
  creatorIds: string[];
  /** Posts per day at most. */
  dailyLimit: number;
  /** Set when posting there stopped working (expired login, app not approved). */
  error?: string;
  addedAt: number;
}

export type PostStatus = "scheduled" | "uploading" | "posted" | "failed";

export interface PostRecord {
  id: string;
  platform: Platform;
  accountId: string;
  jobId: string;
  shortId: string;
  creatorId?: string;
  campaignId?: string;
  title: string;
  caption: string;
  status: PostStatus;
  /** When it goes out (ISO). */
  at: string;
  remoteId?: string;
  url?: string;
  postedAt?: number;
  views: number;
  likes?: number;
  comments?: number;
  statsAt?: number;
  /** Marked as submitted to the campaign. */
  submittedAt?: number;
  /** Views when it was submitted (some campaigns only pay for views after that). */
  viewsAtSubmit?: number;
  /** In "ask me first" mode: you said go. */
  approved?: boolean;
  /** What the campaign actually paid, entered by you. */
  paid?: number;
  error?: string;
  /** For learning what works. */
  category?: string;
  score?: number;
  hook?: string;
  teaser?: boolean;
}

export interface AutopilotSettings {
  enabled: boolean;
  /** How often to look for new VODs, in minutes. */
  scanEveryMin: number;
  /** VODs turned into shorts per day, at most. */
  maxJobsPerDay: number;
  /** Shorts made from each VOD. */
  shortsPerVod: number;
  /** Only post shorts with at least this viral score. */
  minScore: number;
  /** Local hours to post between, e.g. [10, 23]. */
  postHours: [number, number];
  /** Minutes between posts on one account. */
  spacingMin: number;
  /** YouTube privacy for autopilot posts. */
  privacy: Privacy;
  /** Skip VODs older than this many hours (the news is old). */
  maxVodAgeHours: number;
  /** Job options for autopilot jobs (layout, captions, edit…). */
  options: Partial<JobOptions>;
  /** Hold each post until you press Post (so you're there to submit it to the campaign). */
  approvePosts: boolean;
}

export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  enabled: false,
  scanEveryMin: 30,
  maxJobsPerDay: 6,
  shortsPerVod: 6,
  minScore: 70,
  postHours: [10, 23],
  spacingMin: 150,
  privacy: "public",
  maxVodAgeHours: 48,
  options: {},
  approvePosts: false,
};

export interface Opportunity {
  creatorId: string;
  creatorName: string;
  platform: SourcePlatform;
  url: string;
  avatar?: string;
  /** The newest VOD not clipped yet. */
  vod?: Vod;
  /** 0–100. */
  score: number;
  factors: { pay: number; demand: number; fresh: number; momentum: number; track: number };
  permission: Permission;
  campaign?: { id: string; name: string; ratePer1k: number; minViews?: number };
  /** Median views of your own posts of this creator (when there are 3+). */
  yourMedianViews?: number;
  /** What one short is worth at your median views, under the best campaign. */
  usdPerShort?: number;
  reasons: string[];
  /** Why the autopilot won't take it (no permission, no new VOD…). */
  blocked?: string;
}

export interface Vod {
  id: string;
  url: string;
  title: string;
  /** ISO time the stream/upload started (Twitch created_at, YouTube publish/actual start). */
  startedAt: string;
  durationSec: number;
  views?: number;
  /** Still live: wait until it ends. */
  live?: boolean;
  thumbnail?: string;
}

/** A creator worth a look, found by discovery (not tracked yet). */
export interface Suggestion {
  id: string;
  platform: SourcePlatform;
  handle: string;
  name: string;
  url: string;
  avatar?: string;
  stats: CreatorStats;
  category?: string;
  language?: string;
  reasons: string[];
  /** A campaign on file already names them. */
  campaignId?: string;
}

export interface Connections {
  twitch: boolean;
  kick: boolean;
  youtubeData: boolean;
  tiktok: { configured: boolean };
  instagram: { configured: boolean };
}

export interface BizSnapshot {
  creators: Creator[];
  campaigns: Campaign[];
  accounts: Account[];
  posts: PostRecord[];
  autopilot: AutopilotSettings;
  status: { running: boolean; lastScanAt?: number; nextScanAt?: number; lastError?: string; jobsToday: number; log: { t: number; msg: string; level: "info" | "warn" }[] };
  connections: Connections;
}

/** What the business dashboard gets from the server. */
export interface BizView extends BizSnapshot {
  suggestions: Suggestion[];
  suggestionsAt?: number;
  opportunities: Opportunity[];
  opportunitiesAt?: number;
  earnings: Earnings;
  lessons: Lesson | null;
  accountsReady: Record<string, boolean>;
  setup: { twitch: boolean; kick: boolean; youtubeKey: boolean; tiktokApp?: { clientKey: string; redirectUri: string } };
}

// ── Earnings ─────────────────────────────────────────────────────────

export interface PostValue {
  /** Dollars earned so far under the campaign's terms, after its fee (0 below the threshold). */
  usd: number;
  /** Past the minimum views (or there is none). */
  eligible: boolean;
  /** Views still needed to reach the threshold. */
  toGo: number;
  capped: boolean;
  /** The views that count (after submission, for campaigns that work that way). */
  counted: number;
}

type CampaignTerms = Pick<Campaign, "ratePer1k" | "minViews" | "maxPerPost"> & Partial<Pick<Campaign, "submitWithinMin" | "feePct">>;

/**
 * What a post has earned. Campaigns with a submission window only pay for
 * views after you submitted, and nothing if you never did.
 */
export function postValue(views: number, c?: CampaignTerms | null, post?: Pick<PostRecord, "submittedAt" | "viewsAtSubmit">): PostValue {
  if (!c || !(c.ratePer1k > 0)) return { usd: 0, eligible: false, toGo: 0, capped: false, counted: 0 };
  const windowed = Boolean(c.submitWithinMin);
  const counted = !windowed || !post ? views : post.submittedAt ? Math.max(0, views - (post.viewsAtSubmit ?? 0)) : 0;
  const min = Math.max(0, c.minViews ?? 0);
  if (counted < min || (windowed && post && !post.submittedAt)) return { usd: 0, eligible: false, toGo: Math.max(0, min - counted), capped: false, counted };
  const raw = (counted / 1000) * c.ratePer1k;
  const capped = c.maxPerPost !== undefined && c.maxPerPost > 0 && raw > c.maxPerPost;
  const gross = capped ? c.maxPerPost! : raw;
  return { usd: round2(gross * (1 - Math.min(100, Math.max(0, c.feePct ?? 0)) / 100)), eligible: true, toGo: 0, capped, counted };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface EarningsRow {
  key: string;
  label: string;
  posts: number;
  views: number;
  usd: number;
  paid: number;
  toSubmit: number;
}

export interface Earnings {
  total: EarningsRow;
  byCampaign: EarningsRow[];
  byCreator: EarningsRow[];
  byPlatform: EarningsRow[];
  /**
   * Posts to submit to their campaign: within a submission window (soonest
   * deadline first), or past the threshold for campaigns without one.
   */
  submit: { post: PostRecord; campaign: Campaign; usd: number; deadline?: number; missed?: boolean }[];
  /** Last 14 days: views and dollars per day (local date). */
  daily: { day: string; views: number; usd: number; posts: number }[];
}

export function earnings(posts: PostRecord[], campaigns: Campaign[], creators: Creator[], now = Date.now()): Earnings {
  const camp = new Map(campaigns.map((c) => [c.id, c]));
  const names = new Map(creators.map((c) => [c.id, c.name]));
  const row = (key: string, label: string): EarningsRow => ({ key, label, posts: 0, views: 0, usd: 0, paid: 0, toSubmit: 0 });
  const total = row("all", "All");
  const by = { campaign: new Map<string, EarningsRow>(), creator: new Map<string, EarningsRow>(), platform: new Map<string, EarningsRow>() };
  const submit: Earnings["submit"] = [];
  const days = new Map<string, { views: number; usd: number; posts: number }>();
  for (let i = 13; i >= 0; i--) days.set(localDay(now - i * 86400_000), { views: 0, usd: 0, posts: 0 });
  for (const p of posts) {
    if (p.status !== "posted") continue;
    const c = p.campaignId ? camp.get(p.campaignId) : undefined;
    const v = postValue(p.views, c, p);
    const posted = p.postedAt ?? new Date(p.at).getTime();
    const deadline = c?.submitWithinMin ? posted + c.submitWithinMin * 60_000 : undefined;
    const due = Boolean(c && !p.submittedAt && (deadline ? posted <= now : postValue(p.views, c).eligible));
    const add = (r: EarningsRow) => {
      r.posts++;
      r.views += p.views;
      r.usd = round2(r.usd + v.usd);
      r.paid = round2(r.paid + (p.paid ?? 0));
      if (due) r.toSubmit++;
    };
    add(total);
    const get = (m: Map<string, EarningsRow>, key: string, label: string) => {
      if (!m.has(key)) m.set(key, row(key, label));
      return m.get(key)!;
    };
    add(get(by.campaign, c?.id ?? "none", c?.name ?? "No campaign"));
    add(get(by.creator, p.creatorId ?? "none", (p.creatorId && names.get(p.creatorId)) || "Unknown creator"));
    add(get(by.platform, p.platform, PLATFORM_NAME[p.platform]));
    if (due && c) submit.push({ post: p, campaign: c, usd: deadline ? 0 : postValue(p.views, c).usd, deadline, missed: deadline !== undefined && deadline < now });
    const d = days.get(localDay(p.postedAt ?? new Date(p.at).getTime()));
    if (d) {
      d.views += p.views;
      d.usd = round2(d.usd + v.usd);
      d.posts++;
    }
  }
  const sorted = (m: Map<string, EarningsRow>) => [...m.values()].sort((a, b) => b.usd - a.usd || b.views - a.views);
  return {
    total,
    byCampaign: sorted(by.campaign),
    byCreator: sorted(by.creator),
    byPlatform: sorted(by.platform),
    // Open windows first (soonest deadline), then the rest by value; missed windows last.
    submit: submit.sort((a, b) => Number(Boolean(a.missed)) - Number(Boolean(b.missed)) || (a.deadline ?? Infinity) - (b.deadline ?? Infinity) || b.usd - a.usd),
    daily: [...days.entries()].map(([day, d]) => ({ day, ...d })),
  };
}

export function localDay(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Posting slots ──────────────────────────────────────────────────────

/**
 * The next free time this account can post: inside the posting hours, at
 * least spacingMin after its other posts, under its daily limit. Times are
 * local to this computer.
 */
export function nextSlot(taken: number[], opts: { hours: [number, number]; spacingMin: number; dailyLimit: number; now?: number; leadMin?: number }): number {
  const now = opts.now ?? Date.now();
  const earliest = now + (opts.leadMin ?? 5) * 60_000;
  const gap = Math.max(10, opts.spacingMin) * 60_000;
  const [h0, h1] = [Math.max(0, Math.min(23, opts.hours[0])), Math.max(1, Math.min(24, opts.hours[1]))];
  const sorted = [...taken].sort((a, b) => a - b);
  for (let day = 0; day < 60; day++) {
    const base = new Date(now);
    base.setHours(0, 0, 0, 0);
    base.setDate(base.getDate() + day);
    const open = base.getTime() + h0 * 3600_000;
    const close = base.getTime() + (h1 > h0 ? h1 : 24) * 3600_000;
    const today = sorted.filter((t) => t >= base.getTime() && t < base.getTime() + 86400_000);
    if (today.length >= opts.dailyLimit) continue;
    for (let t = Math.max(open, earliest); t < close; ) {
      const clash = sorted.find((x) => Math.abs(x - t) < gap);
      if (clash === undefined) return roundUp(t, 5);
      t = clash + gap;
    }
  }
  return roundUp(earliest + 86400_000, 5);
}

const roundUp = (t: number, min: number) => Math.ceil(t / (min * 60_000)) * min * 60_000;

// ── Captions with campaign rules ──────────────────────────────────────────────

const LIMIT: Record<Platform, number> = { youtube: 5000, tiktok: 2200, instagram: 2200 };

/** The post text for a platform, with what the campaign requires added once each. */
export function captionFor(platform: Platform, base: { title: string; description: string; hashtags: string[] }, rules?: CampaignRules): string {
  const lines: string[] = [];
  const tags = new Set(base.hashtags.map((h) => h.replace(/^#/, "").toLowerCase()).filter(Boolean));
  for (const h of rules?.hashtags ?? []) tags.add(h.replace(/^#/, "").toLowerCase());
  if (platform === "youtube") tags.add("shorts");
  const has = (text: string, needle: string) => text.toLowerCase().includes(needle.toLowerCase());
  const head = platform === "youtube" ? base.description : `${base.title}${base.description ? `\n\n${base.description}` : ""}`;
  lines.push(head.trim());
  const extra: string[] = [];
  for (const m of rules?.mentions ?? []) {
    const handle = m.startsWith("@") ? m : `@${m}`;
    if (!has(head, handle)) extra.push(handle);
  }
  if (rules?.requiredText && !has(head, rules.requiredText)) extra.push(rules.requiredText);
  if (extra.length) lines.push(extra.join(" "));
  const tagLine = [...tags].filter((t) => !has(head, `#${t}`)).map((t) => `#${t}`).join(" ");
  if (tagLine) lines.push(tagLine);
  let text = lines.filter(Boolean).join("\n\n");
  if (text.length > LIMIT[platform]) text = text.slice(0, LIMIT[platform] - 1) + "…";
  return text;
}

// ── Who to clip ──────────────────────────────────────────────────────

/** 0..1 from a count on a log scale: lo → 0, hi → 1. */
export function logScale(v: number | undefined, lo: number, hi: number): number {
  if (!v || v <= 0) return 0;
  return Math.max(0, Math.min(1, (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))));
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A creator's audience as concurrent viewers, the common unit across platforms. */
export function audienceOf(s?: CreatorStats): number {
  if (!s) return 0;
  // A YouTube long video's views over its first days are roughly 20–40× a stream's concurrent viewers.
  return Math.max(s.avgViewers ?? 0, s.liveViewers ?? 0, (s.recentViews ?? 0) / 30, (s.subscribers ?? 0) / 400, (s.followers ?? 0) / 300);
}

/**
 * How worthwhile clipping this creator is right now, and why. Weights:
 * pay 35 (campaign rate per 1K views), demand 25 (audience size), fresh 20
 * (an unclipped VOD from the last day or two), momentum 10 (community clips
 * and live now), your track record 10 (median views of your posts of them).
 * Without permission it can rank, but the autopilot won't take it.
 */
export function scoreCreator(
  c: Creator,
  ctx: { campaigns: Campaign[]; posts: PostRecord[]; newestVod?: Vod; now?: number; maxVodAgeHours?: number },
): Opportunity {
  const now = ctx.now ?? Date.now();
  const reasons: string[] = [];
  const active = ctx.campaigns.filter((k) => k.status === "active" && k.creatorIds.includes(c.id) && (k.budgetLeft === undefined || k.budgetLeft > 0));
  const best = [...active].sort((a, b) => b.ratePer1k - a.ratePer1k)[0];
  const permission: Permission = best ? "campaign" : c.permission === "campaign" ? "unknown" : c.permission;

  // Most campaigns pay about $1 per 1K views; $2+ is the top of the market.
  const pay = best ? Math.min(1, best.ratePer1k / 2) : 0.1;
  if (best) reasons.push(`Campaign "${best.name}" pays $${best.ratePer1k.toFixed(2)} per 1K views${best.minViews ? ` after ${compactNum(best.minViews)} views` : ""}`);
  else reasons.push("No paid campaign on file: only platform payouts");

  const aud = audienceOf(c.stats);
  const demand = logScale(aud, 100, 100_000);
  if (aud) reasons.push(`Audience ≈ ${compactNum(Math.round(aud))} concurrent viewers`);

  let fresh = 0;
  const vod = ctx.newestVod;
  if (vod && !vod.live) {
    const ageH = (now - new Date(vod.startedAt).getTime() - vod.durationSec * 1000) / 3600_000;
    const maxAge = ctx.maxVodAgeHours ?? 48;
    fresh = ageH <= 12 ? 1 : ageH <= 24 ? 0.8 : ageH <= maxAge ? 0.5 : 0.1;
    reasons.push(`New VOD ${Math.max(0, Math.round(ageH))} h ago (${Math.round(vod.durationSec / 60)} min) not clipped yet`);
  } else if (vod?.live) reasons.push("Live now: the VOD will be ready when the stream ends");

  const s = c.stats;
  const momentum = Math.max(logScale(s?.clipViews24h, 10_000, 5_000_000), s?.live ? 0.5 : 0);
  if (s?.clipViews24h) reasons.push(`Viewers clipped them ${s.clips24h ?? "?"}× in 24 h (${compactNum(s.clipViews24h)} clip views)`);

  const mine = ctx.posts.filter((p) => p.creatorId === c.id && p.status === "posted" && p.statsAt);
  const med = mine.length >= 3 ? median(mine.map((p) => p.views)) : undefined;
  const track = med !== undefined ? logScale(med, 500, 500_000) : 0.4;
  if (med !== undefined) reasons.push(`Your ${mine.length} posts of them: median ${compactNum(Math.round(med))} views`);

  const raw = 0.35 * pay + 0.25 * demand + 0.2 * fresh + 0.1 * momentum + 0.1 * track;
  let blocked: string | undefined;
  if (permission === "denied") blocked = "They don't want clips";
  else if (permission === "unknown") blocked = "No permission on file: find their campaign or ask first";
  else if (!vod) blocked = "No new VOD yet";
  else if (vod.live) blocked = "Still live";
  else if (fresh <= 0.1) blocked = "Newest VOD is too old";
  const usdPerShort = best && med !== undefined ? postValue(med, { ...best, submitWithinMin: undefined }).usd : undefined;
  return {
    creatorId: c.id,
    creatorName: c.name,
    platform: c.platform,
    url: c.url,
    avatar: c.avatar,
    vod,
    score: permission === "denied" ? 0 : Math.round(raw * 100),
    factors: { pay: r2(pay), demand: r2(demand), fresh: r2(fresh), momentum: r2(momentum), track: r2(track) },
    permission,
    campaign: best ? { id: best.id, name: best.name, ratePer1k: best.ratePer1k, minViews: best.minViews } : undefined,
    yourMedianViews: med,
    usdPerShort,
    reasons,
    blocked,
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

export function compactNum(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}K`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

// ── What's working ───────────────────────────────────────────────────

export interface Lesson {
  creatorId?: string;
  posts: number;
  medianViews: number;
  byCategory: { category: string; posts: number; medianViews: number }[];
  best: { title: string; hook?: string; views: number; category?: string }[];
  worst: { title: string; views: number; category?: string }[];
  teaser?: { with: number; without: number };
}

/** What your own numbers say works, overall or for one creator (posts with stats only). */
export function lessons(posts: PostRecord[], creatorId?: string): Lesson | null {
  const ps = posts.filter((p) => p.status === "posted" && p.statsAt && (!creatorId || p.creatorId === creatorId));
  if (ps.length < 3) return null;
  const cats = new Map<string, number[]>();
  for (const p of ps) {
    const k = p.category || "other";
    if (!cats.has(k)) cats.set(k, []);
    cats.get(k)!.push(p.views);
  }
  // One entry per short, with its views summed across the platforms it went to.
  const perShort = new Map<string, { title: string; hook?: string; views: number; category?: string }>();
  for (const p of ps) {
    const k = `${p.jobId}:${p.shortId}`;
    const cur = perShort.get(k);
    if (cur) cur.views += p.views;
    else perShort.set(k, { title: p.title, hook: p.hook, views: p.views, category: p.category });
  }
  const byViews = [...perShort.values()].sort((a, b) => b.views - a.views);
  const withT = ps.filter((p) => p.teaser).map((p) => p.views);
  const without = ps.filter((p) => !p.teaser).map((p) => p.views);
  return {
    creatorId,
    posts: ps.length,
    medianViews: median(ps.map((p) => p.views)),
    byCategory: [...cats.entries()].map(([category, v]) => ({ category, posts: v.length, medianViews: median(v) })).sort((a, b) => b.medianViews - a.medianViews),
    best: byViews.slice(0, 5),
    worst: byViews.length > 5 ? byViews.slice(-3).reverse().map(({ title, views, category }) => ({ title, views, category })) : [],
    teaser: withT.length >= 3 && without.length >= 3 ? { with: median(withT), without: median(without) } : undefined,
  };
}

/** Direction for the orchestrator from your own results ("these did best for this creator"). */
export function directionFrom(l: Lesson | null, name: string): string | undefined {
  if (!l) return undefined;
  const parts: string[] = [];
  const cats = l.byCategory.filter((c) => c.posts >= 2);
  if (cats.length >= 2) parts.push(`On my channels, ${name}'s ${cats[0].category} clips do best (median ${compactNum(Math.round(cats[0].medianViews))} views) and ${cats[cats.length - 1].category} clips worst; prefer the first kind when it's there.`);
  if (l.best.length) parts.push(`My best ${name} clips so far: ${l.best.slice(0, 3).map((b) => `"${b.title}" (${compactNum(b.views)})`).join("; ")}.`);
  return parts.length ? parts.join(" ").slice(0, 480) : undefined;
}
