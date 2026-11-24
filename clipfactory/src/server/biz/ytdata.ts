import { readSecret, writeSecret } from "../secrets.ts";
import { accessToken, isConnected } from "../youtube.ts";

// YouTube Data API reads for the scout: a channel's recent long videos and
// finished streams, trending videos, and the stats of your own posted Shorts.
// Uses YOUTUBE_API_KEY (or one saved in the dashboard); without it, the
// connected channel's login (it has read access). Every call here costs 1
// quota unit of the default 10,000 a day; search (100 units) isn't used.

const API = () => process.env.CF_YOUTUBE_API_URL || "https://www.googleapis.com/youtube/v3";

export function ytApiKey(): string | null {
  return process.env.YOUTUBE_API_KEY || readSecret<{ key: string }>("youtube-api-key.json")?.key || null;
}

export function saveYtApiKey(key: string) {
  writeSecret("youtube-api-key.json", { key: key.trim() });
}

export function ytDataReady(): boolean {
  return Boolean(ytApiKey()) || isConnected();
}

export class YtDataError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function get<T>(resource: string, params: Record<string, string | number | undefined>): Promise<T> {
  const u = new URL(`${API()}/${resource}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, String(v));
  const key = ytApiKey();
  const headers: Record<string, string> = {};
  if (key) u.searchParams.set("key", key);
  else if (isConnected()) headers.Authorization = `Bearer ${await accessToken()}`;
  else throw new YtDataError("Add a YouTube API key or connect your channel first.");
  const res = await fetch(u, { headers });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = body.error?.errors?.[0]?.reason;
    throw new YtDataError(reason === "quotaExceeded" ? "YouTube's daily API quota is used up; it resets at midnight Pacific." : `YouTube: ${body.error?.message ?? res.status}`, res.status);
  }
  return (await res.json()) as T;
}

/** "PT3H2M1S" → seconds. */
export function isoDuration(d: string | undefined): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(d ?? "");
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

export interface YtChannel {
  id: string;
  title: string;
  handle?: string;
  thumbnail?: string;
  subscribers?: number;
  uploads?: string;
}

interface ChannelRes {
  items?: { id: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } }; statistics?: { subscriberCount?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
}

/** A channel by @handle or channel ID. */
export async function ytChannel(handleOrId: string): Promise<YtChannel | null> {
  const isId = /^UC[\w-]{22}$/.test(handleOrId);
  const r = await get<ChannelRes>("channels", { part: "snippet,statistics,contentDetails", ...(isId ? { id: handleOrId } : { forHandle: handleOrId.startsWith("@") ? handleOrId : `@${handleOrId}` }) });
  const c = r.items?.[0];
  if (!c) return null;
  return {
    id: c.id,
    title: c.snippet?.title ?? handleOrId,
    handle: c.snippet?.customUrl,
    thumbnail: c.snippet?.thumbnails?.default?.url,
    subscribers: c.statistics?.subscriberCount ? Number(c.statistics.subscriberCount) : undefined,
    uploads: c.contentDetails?.relatedPlaylists?.uploads,
  };
}

export interface YtVideo {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  durationSec: number;
  views?: number;
  likes?: number;
  comments?: number;
  live: "live" | "upcoming" | "none";
  /** For streams: when it actually started and ended. */
  startedAt?: string;
  endedAt?: string;
  thumbnail?: string;
  categoryId?: string;
}

interface VideosRes {
  items?: {
    id: string;
    snippet?: { title?: string; channelId?: string; channelTitle?: string; publishedAt?: string; liveBroadcastContent?: string; categoryId?: string; thumbnails?: { medium?: { url?: string } } };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    liveStreamingDetails?: { actualStartTime?: string; actualEndTime?: string };
  }[];
}

const toVideo = (v: NonNullable<VideosRes["items"]>[number]): YtVideo => ({
  id: v.id,
  title: v.snippet?.title ?? "",
  channelId: v.snippet?.channelId ?? "",
  channelTitle: v.snippet?.channelTitle ?? "",
  publishedAt: v.snippet?.publishedAt ?? "",
  durationSec: isoDuration(v.contentDetails?.duration),
  views: v.statistics?.viewCount ? Number(v.statistics.viewCount) : undefined,
  likes: v.statistics?.likeCount ? Number(v.statistics.likeCount) : undefined,
  comments: v.statistics?.commentCount ? Number(v.statistics.commentCount) : undefined,
  live: (v.snippet?.liveBroadcastContent as YtVideo["live"]) ?? "none",
  startedAt: v.liveStreamingDetails?.actualStartTime,
  endedAt: v.liveStreamingDetails?.actualEndTime,
  thumbnail: v.snippet?.thumbnails?.medium?.url,
  categoryId: v.snippet?.categoryId,
});

/** Details and stats for up to 50 videos per call. */
export async function ytVideos(ids: string[]): Promise<YtVideo[]> {
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const r = await get<VideosRes>("videos", { part: "snippet,contentDetails,statistics,liveStreamingDetails", id: ids.slice(i, i + 50).join(","), maxResults: 50 });
    out.push(...(r.items ?? []).map(toVideo));
  }
  return out;
}

/** A channel's newest uploads (including finished streams), newest first. */
export async function ytRecent(uploadsPlaylist: string, max = 15): Promise<YtVideo[]> {
  const r = await get<{ items?: { contentDetails?: { videoId?: string } }[] }>("playlistItems", { part: "contentDetails", playlistId: uploadsPlaylist, maxResults: max });
  const ids = (r.items ?? []).map((i) => i.contentDetails?.videoId).filter((x): x is string => Boolean(x));
  const vids = await ytVideos(ids);
  return vids.sort((a, b) => (b.startedAt ?? b.publishedAt).localeCompare(a.startedAt ?? a.publishedAt));
}

/** Trending videos in a category (20 = Gaming, 24 = Entertainment, 22 = People & Blogs). */
export async function ytTrending(categoryId: string, regionCode = "US", max = 50): Promise<YtVideo[]> {
  const r = await get<VideosRes>("videos", { part: "snippet,contentDetails,statistics,liveStreamingDetails", chart: "mostPopular", videoCategoryId: categoryId, regionCode, maxResults: max });
  return (r.items ?? []).map(toVideo);
}
