import { audienceOf, compactNum, logScale, median, scoreCreator, type Creator, type CreatorStats, type Opportunity, type SourcePlatform, type Suggestion, type Vod } from "../../lib/biz.ts";
import { kickChannel, kickLivestreams, kickReady, kickVods } from "./kick.ts";
import { biz, bizLog, creatorId, mutate } from "./store.ts";
import { twitchClips, twitchCreds, twitchDuration, twitchFollowers, twitchStreams, twitchUsers, twitchVideos } from "./twitch.ts";
import { ytChannel, ytDataReady, ytRecent, ytTrending } from "./ytdata.ts";

// The scout: who to clip and which of their VODs to clip next.

/** "twitch.tv/name", "kick.com/name", "youtube.com/@name", "@name" (YouTube) → platform + handle. */
export function parseCreator(input: string): { platform: SourcePlatform; handle: string } | null {
  const s = input.trim();
  const pre = /^(twitch|kick|youtube|yt):\s*@?([\w.-]+)$/i.exec(s);
  if (pre) return { platform: pre[1].toLowerCase() === "yt" ? "youtube" : (pre[1].toLowerCase() as SourcePlatform), handle: pre[2] };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return /^@[\w.-]{2,}$/.test(s) ? { platform: "youtube", handle: s } : null;
  }
  const host = u.hostname.replace(/^(www|m)\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "twitch.tv" && parts[0] && !["videos", "directory", "settings"].includes(parts[0])) return { platform: "twitch", handle: parts[0] };
  if (host === "kick.com" && parts[0]) return { platform: "kick", handle: parts[0] };
  if (host === "youtube.com") {
    if (parts[0]?.startsWith("@")) return { platform: "youtube", handle: parts[0] };
    if (parts[0] === "channel" && parts[1]) return { platform: "youtube", handle: parts[1] };
  }
  if (/^@[\w.-]{2,}$/.test(s)) return { platform: "youtube", handle: s };
  return null;
}

export function sourceReady(p: SourcePlatform): boolean {
  return p === "twitch" ? Boolean(twitchCreds()) : p === "kick" ? kickReady() : ytDataReady();
}

const READY_HINT: Record<SourcePlatform, string> = {
  twitch: "Add a Twitch app (client ID + secret) under Sources to read Twitch",
  kick: "Add a Kick app (client ID + secret) under Sources to read Kick",
  youtube: "Add a YouTube API key or connect your channel to read YouTube",
};

/** A new creator, filled in from their platform when it's connected. */
export async function lookupCreator(platform: SourcePlatform, handle: string): Promise<Creator> {
  const id = creatorId(platform, handle);
  const clean = handle.replace(/^@/, "");
  const base: Creator = {
    id,
    platform,
    handle: clean,
    name: clean,
    url: platform === "twitch" ? `https://www.twitch.tv/${clean}` : platform === "kick" ? `https://kick.com/${clean}` : /^UC[\w-]{22}$/.test(clean) ? `https://www.youtube.com/channel/${clean}` : `https://www.youtube.com/@${clean}`,
    permission: "unknown",
    autopilot: false,
    addedAt: Date.now(),
  };
  if (!sourceReady(platform)) return base;
  try {
    if (platform === "twitch") {
      const [u] = await twitchUsers([clean]);
      if (!u) throw new Error(`No Twitch user "${clean}"`);
      return { ...base, name: u.display_name, platformId: u.id, avatar: u.profile_image_url };
    }
    if (platform === "kick") {
      const ch = await kickChannel(clean);
      if (!ch) throw new Error(`No Kick channel "${clean}"`);
      return { ...base, name: ch.name, platformId: ch.id, avatar: ch.avatar };
    }
    const ch = await ytChannel(handle.startsWith("@") || /^UC/.test(handle) ? handle : `@${clean}`);
    if (!ch) throw new Error(`No YouTube channel "${handle}"`);
    return { ...base, name: ch.title, platformId: ch.id, avatar: ch.thumbnail, url: `https://www.youtube.com/channel/${ch.id}` };
  } catch (err) {
    throw new Error((err as Error).message);
  }
}

/** The creator's newest long-form VODs, newest first. */
export async function recentVods(c: Creator): Promise<Vod[]> {
  if (!sourceReady(c.platform)) return [];
  if (c.platform === "twitch") {
    if (!c.platformId) return [];
    const [vids, live] = await Promise.all([twitchVideos(c.platformId, 8), twitchStreams({ userIds: [c.platformId], first: 1 }).catch(() => [])]);
    const liveId = live[0]?.id;
    return vids
      .map((v) => ({ id: v.id, url: v.url, title: v.title, startedAt: v.created_at, durationSec: twitchDuration(v.duration), views: v.view_count, live: Boolean(liveId && v.stream_id === liveId), thumbnail: v.thumbnail_url }))
      .filter((v) => v.durationSec >= 600 || v.live);
  }
  if (c.platform === "kick") return kickVods(c.handle);
  const ch = c.platformId ? await ytChannel(c.platformId) : null;
  if (!ch?.uploads) return [];
  const vids = await ytRecent(ch.uploads, 15);
  return vids
    .filter((v) => v.live !== "upcoming" && (v.durationSec >= 600 || v.live === "live"))
    .map((v) => ({ id: v.id, url: `https://www.youtube.com/watch?v=${v.id}`, title: v.title, startedAt: v.startedAt ?? v.publishedAt, durationSec: v.durationSec, views: v.views, live: v.live === "live", thumbnail: v.thumbnail }));
}

/** Fresh audience numbers for a creator. */
export async function creatorStats(c: Creator, vods?: Vod[]): Promise<CreatorStats> {
  const prev = c.stats ?? { updatedAt: 0 };
  const now = Date.now();
  const week = (vods ?? []).filter((v) => now - new Date(v.startedAt).getTime() < 7 * 86400_000).length;
  if (c.platform === "twitch" && c.platformId) {
    const [live, followers, clips] = await Promise.all([
      twitchStreams({ userIds: [c.platformId], first: 1 }).catch(() => []),
      twitchFollowers(c.platformId),
      twitchClips(c.platformId, new Date(now - 86400_000).toISOString(), new Date(now).toISOString(), 100).catch(() => []),
    ]);
    const viewers = live[0]?.viewer_count;
    // Concurrent viewers only exist while live; keep a running average across scans.
    const avg = viewers ? Math.round(prev.avgViewers ? prev.avgViewers * 0.7 + viewers * 0.3 : viewers) : prev.avgViewers;
    return { ...prev, followers, live: Boolean(live[0]), liveViewers: viewers, avgViewers: avg, clips24h: clips.length, clipViews24h: clips.reduce((n, x) => n + x.view_count, 0), vodsPer7d: week, updatedAt: now };
  }
  if (c.platform === "kick") {
    const ch = await kickChannel(c.handle).catch(() => null);
    const viewers = ch?.liveViewers;
    const avg = viewers ? Math.round(prev.avgViewers ? prev.avgViewers * 0.7 + viewers * 0.3 : viewers) : prev.avgViewers;
    return { ...prev, followers: ch?.followers ?? prev.followers, live: Boolean(ch?.live), liveViewers: viewers, avgViewers: avg, vodsPer7d: week, updatedAt: now };
  }
  const ch = c.platformId ? await ytChannel(c.platformId).catch(() => null) : null;
  const views = (vods ?? []).filter((v) => !v.live && v.views !== undefined).map((v) => v.views!);
  return { ...prev, subscribers: ch?.subscribers ?? prev.subscribers, recentViews: views.length ? median(views) : prev.recentViews, vodsPer7d: week, live: (vods ?? []).some((v) => v.live), updatedAt: now };
}

/** Refresh every tracked creator's stats and VODs, and rank them. */
export async function scoutTracked(opts: { only?: string[] } = {}): Promise<Opportunity[]> {
  const d = biz();
  const out: Opportunity[] = [];
  for (const c of d.creators.filter((x) => !opts.only || opts.only.includes(x.id))) {
    let vods: Vod[] = [];
    let stats = c.stats;
    if (sourceReady(c.platform)) {
      try {
        vods = await recentVods(c);
        stats = await creatorStats(c, vods);
        mutate((dd) => {
          const x = dd.creators.find((y) => y.id === c.id);
          if (x) x.stats = stats;
        });
      } catch (err) {
        bizLog(`Couldn't read ${c.name} on ${c.platform}: ${(err as Error).message}`, "warn");
      }
    }
    const seen = new Set(c.seenVods ?? []);
    const newest = vods.find((v) => !seen.has(v.id));
    const opp = scoreCreator({ ...c, stats }, { campaigns: d.campaigns, posts: d.posts, newestVod: newest, maxVodAgeHours: d.autopilot.maxVodAgeHours });
    if (!sourceReady(c.platform)) opp.reasons.push(READY_HINT[c.platform]);
    out.push(opp);
  }
  out.sort((a, b) => b.score - a.score);
  if (!opts.only)
    mutate((dd) => {
      dd.opportunities = out;
      dd.opportunitiesAt = Date.now();
    });
  return out;
}

/** Creators worth a look: biggest live channels with the most clipping activity, trending long-form, campaign names. */
export async function discover(opts: { language?: string; limit?: number } = {}): Promise<Suggestion[]> {
  const d = biz();
  const tracked = new Set(d.creators.map((c) => c.id));
  const out: Suggestion[] = [];
  const errors: string[] = [];
  if (twitchCreds()) {
    try {
      const streams = (await twitchStreams({ language: opts.language || undefined, first: 100 })).slice(0, 40);
      const since = new Date(Date.now() - 86400_000).toISOString();
      const now = new Date().toISOString();
      const users = await twitchUsers(streams.map((s) => s.user_login));
      for (const s of streams) {
        const id = creatorId("twitch", s.user_login);
        if (tracked.has(id)) continue;
        const clips = await twitchClips(s.user_id, since, now, 100).catch(() => []);
        const clipViews = clips.reduce((n, x) => n + x.view_count, 0);
        const u = users.find((x) => x.id === s.user_id);
        out.push({
          id,
          platform: "twitch",
          handle: s.user_login,
          name: s.user_name,
          url: `https://www.twitch.tv/${s.user_login}`,
          avatar: u?.profile_image_url,
          category: s.game_name,
          language: s.language,
          stats: { liveViewers: s.viewer_count, avgViewers: s.viewer_count, live: true, clips24h: clips.length, clipViews24h: clipViews, updatedAt: Date.now() },
          reasons: [`${compactNum(s.viewer_count)} watching now${s.game_name ? ` · ${s.game_name}` : ""}`, clips.length ? `${clips.length} clips in 24 h, ${compactNum(clipViews)} clip views` : "No clips in the last 24 h"],
        });
      }
    } catch (err) {
      errors.push(`Twitch: ${(err as Error).message}`);
    }
  }
  if (kickReady()) {
    try {
      for (const s of (await kickLivestreams({ language: opts.language, limit: 30 })).filter((x) => !tracked.has(creatorId("kick", x.slug)))) {
        out.push({
          id: creatorId("kick", s.slug),
          platform: "kick",
          handle: s.slug,
          name: s.name,
          url: `https://kick.com/${s.slug}`,
          avatar: s.avatar,
          category: s.category,
          language: s.language,
          stats: { liveViewers: s.viewers, avgViewers: s.viewers, live: true, updatedAt: Date.now() },
          reasons: [`${compactNum(s.viewers)} watching now on Kick${s.category ? ` · ${s.category}` : ""}`],
        });
      }
    } catch (err) {
      errors.push(`Kick: ${(err as Error).message}`);
    }
  }
  if (ytDataReady()) {
    try {
      const seen = new Set<string>();
      for (const cat of ["20", "24", "22"]) {
        for (const v of await ytTrending(cat)) {
          // Long-form only: streams, podcasts, videos worth cutting up.
          if (v.durationSec < 15 * 60 || seen.has(v.channelId)) continue;
          seen.add(v.channelId);
          const id = creatorId("youtube", v.channelId);
          if (tracked.has(id)) continue;
          out.push({
            id,
            platform: "youtube",
            handle: v.channelId,
            name: v.channelTitle,
            url: `https://www.youtube.com/channel/${v.channelId}`,
            category: cat === "20" ? "Gaming" : cat === "24" ? "Entertainment" : "People & Blogs",
            stats: { recentViews: v.views, updatedAt: Date.now() },
            reasons: [`Trending on YouTube: "${v.title.slice(0, 70)}" (${compactNum(v.views ?? 0)} views, ${Math.round(v.durationSec / 60)} min)`],
          });
        }
      }
    } catch (err) {
      errors.push(`YouTube: ${(err as Error).message}`);
    }
  }
  // Creators named by a campaign but not tracked yet come first: that's paid work.
  for (const k of d.campaigns.filter((x) => x.status === "active")) {
    for (const id of k.creatorIds) {
      if (tracked.has(id)) continue;
      const hit = out.find((s) => s.id === id);
      if (hit) hit.campaignId = k.id;
    }
  }
  const rank = (s: Suggestion) => (s.campaignId ? 10 : 0) + 3 * logScale(audienceOf(s.stats), 100, 100_000) + 2 * logScale(s.stats.clipViews24h, 10_000, 5_000_000);
  const ranked = out.sort((a, b) => rank(b) - rank(a)).slice(0, opts.limit ?? 60);
  mutate((dd) => {
    dd.suggestions = ranked;
    dd.suggestionsAt = Date.now();
  });
  if (errors.length) bizLog(`Discovery: ${errors.join("; ")}`, "warn");
  return ranked;
}
