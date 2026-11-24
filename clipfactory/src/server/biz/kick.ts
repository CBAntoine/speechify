import type { Vod } from "../../lib/biz.ts";
import { readSecret, writeSecret } from "../secrets.ts";

// Kick's public API (api.kick.com) with an app token (client credentials):
// who's live and how many are watching. Make an app at
// https://kick.com/settings/developer.

const API = () => process.env.CF_KICK_API_URL || "https://api.kick.com";
const TOKEN = () => process.env.CF_KICK_TOKEN_URL || "https://id.kick.com/oauth/token";

export interface KickCreds {
  clientId: string;
  clientSecret: string;
}

export function kickCreds(): KickCreds | null {
  const id = process.env.KICK_CLIENT_ID;
  const secret = process.env.KICK_CLIENT_SECRET;
  if (id && secret) return { clientId: id, clientSecret: secret };
  return readSecret<KickCreds>("kick-app.json");
}

export function kickReady(): boolean {
  return Boolean(kickCreds());
}

export function saveKickCreds(c: KickCreds) {
  writeSecret("kick-app.json", { clientId: c.clientId.trim(), clientSecret: c.clientSecret.trim() });
  mem.token = null;
}

const mem: { token: { value: string; expiresAt: number } | null } = { token: null };

async function token(force = false): Promise<string> {
  const creds = kickCreds();
  if (!creds) throw new Error("Add a Kick app's client ID and secret first.");
  if (!force && mem.token && mem.token.expiresAt > Date.now() + 60_000) return mem.token.value;
  const res = await fetch(TOKEN(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: creds.clientId, client_secret: creds.clientSecret }),
  });
  if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? "Kick didn't accept that client ID and secret." : `Kick login failed (${res.status}).`);
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  mem.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return mem.token.value;
}

async function kick<T>(pathAndQuery: string, retried = false): Promise<T> {
  const res = await fetch(`${API()}${pathAndQuery}`, { headers: { Authorization: `Bearer ${await token()}`, Accept: "application/json" } });
  if (res.status === 401 && !retried) {
    await token(true);
    return kick<T>(pathAndQuery, true);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Kick: ${body.message || res.status}`);
  }
  return (await res.json()) as T;
}

export interface KickChannel {
  id: string;
  slug: string;
  name: string;
  avatar?: string;
  live: boolean;
  liveViewers?: number;
  followers?: number;
  category?: string;
}

interface ChannelRes {
  data?: {
    broadcaster_user_id?: number;
    slug?: string;
    stream_title?: string;
    category?: { name?: string };
    stream?: { is_live?: boolean; viewer_count?: number };
  }[];
}

export async function kickChannel(slug: string): Promise<KickChannel | null> {
  const r = await kick<ChannelRes>(`/public/v1/channels?slug=${encodeURIComponent(slug.toLowerCase())}`);
  const c = r.data?.[0];
  if (!c) return null;
  return {
    id: String(c.broadcaster_user_id ?? ""),
    slug: c.slug ?? slug,
    name: c.slug ?? slug,
    live: Boolean(c.stream?.is_live),
    liveViewers: c.stream?.viewer_count,
    category: c.category?.name,
  };
}

export interface KickLive {
  slug: string;
  name: string;
  viewers: number;
  title?: string;
  category?: string;
  language?: string;
  avatar?: string;
  startedAt?: string;
}

interface LiveRow {
  // v1
  slug?: string;
  broadcaster_user_id?: number;
  stream_title?: string;
  language?: string;
  profile_picture?: string;
  // v2
  title?: string;
  language_code?: string;
  channel?: { slug?: string };
  broadcaster_user?: { username?: string; slug?: string; profile_picture?: string };
  // both
  viewer_count?: number;
  started_at?: string;
  category?: { name?: string };
}

/** Live channels, most viewers first. v1 sorts on the server; it's deprecated, so v2 (unsorted) is the fallback. */
export async function kickLivestreams(opts: { language?: string; limit?: number } = {}): Promise<KickLive[]> {
  const limit = Math.min(100, opts.limit ?? 50);
  const q = new URLSearchParams({ sort: "viewer_count", limit: String(limit) });
  if (opts.language) q.set("language", opts.language);
  let rows: LiveRow[];
  try {
    rows = (await kick<{ data?: LiveRow[] }>(`/public/v1/livestreams?${q}`)).data ?? [];
  } catch {
    const q2 = new URLSearchParams({ limit: "1000" });
    if (opts.language) q2.set("language", opts.language);
    rows = (await kick<{ data?: LiveRow[] }>(`/public/v2/livestreams?${q2}`)).data ?? [];
  }
  const out: KickLive[] = [];
  for (const s of rows) {
    const slug = s.slug ?? s.channel?.slug ?? s.broadcaster_user?.slug ?? s.broadcaster_user?.username;
    if (slug) out.push({ slug, name: slug, viewers: s.viewer_count ?? 0, title: s.stream_title ?? s.title, category: s.category?.name, language: s.language ?? s.language_code, avatar: s.profile_picture ?? s.broadcaster_user?.profile_picture, startedAt: s.started_at });
  }
  return out.sort((a, b) => b.viewers - a.viewers).slice(0, limit);
}

/**
 * A channel's past broadcasts. Kick's public API has no VOD or clip listing
 * (open requests in KickDevDocs #416/#435/#441), and its website's internal
 * API isn't for third parties, so the autopilot can't pick up Kick VODs by
 * itself: it tracks who's live, and you paste the VOD link into New VOD.
 */
export async function kickVods(_slug: string): Promise<Vod[]> {
  return [];
}
