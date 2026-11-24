import { readSecret, writeSecret } from "../secrets.ts";

// Twitch Helix with an app access token (client credentials): live streams,
// a streamer's past broadcasts, and the clips viewers made of them. Clips
// carry vod_offset, the second of the VOD where each starts: the moments the
// community already decided were worth clipping.
// Make an app at https://dev.twitch.tv/console/apps (any OAuth redirect URL).

const API = () => process.env.CF_TWITCH_API_URL || "https://api.twitch.tv/helix";
const TOKEN = () => process.env.CF_TWITCH_TOKEN_URL || "https://id.twitch.tv/oauth2/token";

export interface TwitchCreds {
  clientId: string;
  clientSecret: string;
}

interface TokenCache {
  access_token: string;
  expiresAt: number;
  clientId: string;
}

export function twitchCreds(): TwitchCreds | null {
  const id = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (id && secret) return { clientId: id, clientSecret: secret };
  return readSecret<TwitchCreds>("twitch-app.json");
}

export function saveTwitchCreds(c: TwitchCreds) {
  writeSecret("twitch-app.json", { clientId: c.clientId.trim(), clientSecret: c.clientSecret.trim() });
  mem.token = null;
}

const mem: { token: TokenCache | null } = { token: null };

export class TwitchError extends Error {
  readonly status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

async function token(force = false): Promise<{ token: string; clientId: string }> {
  const creds = twitchCreds();
  if (!creds) throw new TwitchError("Add a Twitch app's client ID and secret first.");
  const cached = mem.token ?? readSecret<TokenCache>("twitch-token.json");
  if (!force && cached && cached.clientId === creds.clientId && cached.expiresAt > Date.now() + 60_000) {
    mem.token = cached;
    return { token: cached.access_token, clientId: creds.clientId };
  }
  const res = await fetch(TOKEN(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new TwitchError(res.status === 400 || res.status === 403 ? "Twitch didn't accept that client ID and secret." : `Twitch login failed (${res.status}).`, res.status);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  const t: TokenCache = { access_token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000, clientId: creds.clientId };
  mem.token = t;
  writeSecret("twitch-token.json", t);
  return { token: t.access_token, clientId: creds.clientId };
}

async function helix<T>(pathAndQuery: string, retried = false): Promise<T> {
  const t = await token();
  const res = await fetch(`${API()}${pathAndQuery}`, { headers: { Authorization: `Bearer ${t.token}`, "Client-Id": t.clientId } });
  if (res.status === 401 && !retried) {
    await token(true);
    return helix<T>(pathAndQuery, true);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new TwitchError(`Twitch: ${body.message || res.statusText || res.status}`, res.status);
  }
  return (await res.json()) as T;
}

const q = (params: Record<string, string | number | (string | number)[] | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    for (const x of Array.isArray(v) ? v : [v]) u.append(k, String(x));
  }
  return u.toString();
};

export interface TwitchUser {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
  description?: string;
  broadcaster_type?: string;
}

export interface TwitchStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id?: string;
  game_name?: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language?: string;
  thumbnail_url?: string;
}

export interface TwitchVideo {
  id: string;
  stream_id?: string | null;
  user_id: string;
  user_login: string;
  title: string;
  created_at: string;
  published_at?: string;
  url: string;
  thumbnail_url?: string;
  view_count: number;
  language?: string;
  type: string;
  /** "3h8m33s". */
  duration: string;
}

export interface TwitchClip {
  id: string;
  url: string;
  broadcaster_id: string;
  video_id: string;
  title: string;
  view_count: number;
  created_at: string;
  /** Seconds. */
  duration: number;
  /** Second of the VOD where the clip starts; null until Twitch links it (or the VOD is gone). */
  vod_offset: number | null;
}

/** "3h8m33s" → seconds. */
export function twitchDuration(d: string): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(d.trim());
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

export async function twitchUsers(logins: string[]): Promise<TwitchUser[]> {
  if (!logins.length) return [];
  const out: TwitchUser[] = [];
  for (let i = 0; i < logins.length; i += 100) {
    const r = await helix<{ data: TwitchUser[] }>(`/users?${q({ login: logins.slice(i, i + 100).map((l) => l.toLowerCase()) })}`);
    out.push(...r.data);
  }
  return out;
}

export async function twitchFollowers(userId: string): Promise<number | undefined> {
  const r = await helix<{ total?: number }>(`/channels/followers?${q({ broadcaster_id: userId, first: 1 })}`).catch(() => null);
  return r?.total;
}

/** Live streams, most viewers first. */
export async function twitchStreams(opts: { userIds?: string[]; language?: string; first?: number; gameId?: string } = {}): Promise<TwitchStream[]> {
  const r = await helix<{ data: TwitchStream[] }>(`/streams?${q({ user_id: opts.userIds, language: opts.language, game_id: opts.gameId, first: opts.first ?? 100, type: "live" })}`);
  return r.data;
}

/** Past broadcasts (archives), newest first. */
export async function twitchVideos(userId: string, first = 10): Promise<TwitchVideo[]> {
  const r = await helix<{ data: TwitchVideo[] }>(`/videos?${q({ user_id: userId, type: "archive", first, sort: "time" })}`);
  return r.data;
}

export async function twitchVideo(id: string): Promise<TwitchVideo | null> {
  const r = await helix<{ data: TwitchVideo[] }>(`/videos?${q({ id })}`).catch(() => null);
  return r?.data[0] ?? null;
}

/** Clips of a broadcaster made between two times, most viewed first (up to `max`). */
export async function twitchClips(broadcasterId: string, startedAt: string, endedAt: string, max = 300): Promise<TwitchClip[]> {
  const out: TwitchClip[] = [];
  let cursor: string | undefined;
  do {
    const r = await helix<{ data: TwitchClip[]; pagination?: { cursor?: string } }>(`/clips?${q({ broadcaster_id: broadcasterId, started_at: startedAt, ended_at: endedAt, first: 100, after: cursor })}`);
    out.push(...r.data);
    cursor = r.pagination?.cursor || undefined;
  } while (cursor && out.length < max);
  return out.sort((a, b) => b.view_count - a.view_count);
}

/** The clips viewers made of one VOD, placed on its timeline. */
export async function clipsOfVod(videoId: string): Promise<{ video: TwitchVideo; clips: { t: number; views: number; title: string; duration: number; url: string }[] } | null> {
  const video = await twitchVideo(videoId);
  if (!video) return null;
  const start = new Date(video.created_at);
  // Clips can be made from the VOD for a while after the stream; look a day past its end.
  const end = new Date(start.getTime() + (twitchDuration(video.duration) + 24 * 3600) * 1000);
  const clips = await twitchClips(video.user_id, start.toISOString(), end.toISOString());
  return {
    video,
    clips: clips
      .filter((c) => c.video_id === videoId && typeof c.vod_offset === "number")
      .map((c) => ({ t: c.vod_offset as number, views: c.view_count, title: c.title, duration: c.duration, url: c.url })),
  };
}
