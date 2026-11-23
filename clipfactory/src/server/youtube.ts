import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Privacy, YouTubeChannel, YouTubeStatus } from "../lib/types.ts";
import { APP_ROOT } from "./paths.ts";

// YouTube Data API v3 over plain fetch: OAuth 2.0 with PKCE (your own Google
// Cloud OAuth client, kept on this machine), and resumable chunked uploads
// that survive dropped connections.

const AUTH_URL = () => process.env.CF_GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = () => process.env.CF_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const REVOKE_URL = () => process.env.CF_GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke";
const API = () => process.env.CF_YOUTUBE_API_URL || "https://www.googleapis.com/youtube/v3";
const UPLOAD = () => process.env.CF_YOUTUBE_UPLOAD_URL || "https://www.googleapis.com/upload/youtube/v3";

/** Upload videos, and read the channel and our own uploads' processing status. */
export const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

// Plain string joins (see paths.ts): the bundler must not trace this folder.
const secretsDir = () => [APP_ROOT, ".secrets"].join(path.sep);
const clientFile = () => [secretsDir(), "youtube-client.json"].join(path.sep);
const tokenFile = () => [secretsDir(), "youtube-token.json"].join(path.sep);

export interface ClientConfig {
  client_id: string;
  client_secret?: string;
  /** "installed" = Desktop app client (any loopback port works), "web" = Web application client. */
  type: "installed" | "web";
}

interface TokenStore {
  access_token: string;
  refresh_token: string;
  /** ms since epoch */
  expiry: number;
  scope?: string;
  channel?: YouTubeChannel;
  /** Set when Google stopped accepting the refresh token. */
  error?: string;
}

export class YouTubeError extends Error {
  status: number;
  reason?: string;
  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

function writeSecret(file: string, data: unknown) {
  fs.mkdirSync(secretsDir(), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

// ── OAuth client (yours, from Google Cloud Console) ───────────────────────

export function clientConfig(): ClientConfig | null {
  if (process.env.YOUTUBE_CLIENT_ID) {
    return { client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET || undefined, type: process.env.YOUTUBE_CLIENT_TYPE === "web" ? "web" : "installed" };
  }
  return readJson<ClientConfig>(clientFile());
}

/**
 * Save an OAuth client. Accepts the JSON Google Cloud Console downloads
 * ({"installed": {...}} for a Desktop app, {"web": {...}} for a Web
 * application) or {"client_id", "client_secret"}.
 */
export function saveClientConfig(raw: unknown): ClientConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const inner = (o.installed ?? o.web ?? o) as Record<string, unknown>;
  const id = typeof inner.client_id === "string" ? inner.client_id.trim() : "";
  const secret = typeof inner.client_secret === "string" ? inner.client_secret.trim() : "";
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) throw new YouTubeError("That isn't a Google OAuth client. Download the JSON from Google Cloud Console → Credentials → your OAuth client.", 400);
  const type: ClientConfig["type"] = o.web ? "web" : "installed";
  const cfg: ClientConfig = { client_id: id, client_secret: secret || undefined, type };
  writeSecret(clientFile(), cfg);
  return cfg;
}

export function removeClientConfig() {
  fs.rmSync(clientFile(), { force: true });
}

/**
 * Where Google sends the user back: the dashboard's root, which forwards to
 * /api/youtube/callback. Desktop clients accept any http://127.0.0.1:<port>
 * (Google documents the bare form, so no path); web clients need this exact
 * URI registered.
 */
export function redirectUriFor(origin: string): string {
  // The login always runs on 127.0.0.1 (the connect route moves localhost there).
  return `${origin.replace(/\/$/, "").replace("//localhost:", "//127.0.0.1:")}/`;
}

// ── Login: authorization code + PKCE ─────────────────────────────────────

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function startLogin(redirectUri: string): { url: string; state: string; verifier: string } {
  const cfg = clientConfig();
  if (!cfg) throw new YouTubeError("Set up your Google OAuth client first.", 400);
  const state = b64url(crypto.randomBytes(18));
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    // Always ask, so Google always returns a refresh token.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { url: `${AUTH_URL()}?${params}`, state, verifier };
}

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number; scope?: string }> {
  const res = await fetch(TOKEN_URL(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(data.error ?? res.status);
    const why = String(data.error_description ?? "");
    throw new YouTubeError(code === "invalid_grant" ? "Google no longer accepts this login (revoked, expired, or the 7-day limit of a \"Testing\" consent screen). Connect YouTube again." : `Google refused the login: ${code}${why ? ` (${why})` : ""}`, res.status, code);
  }
  return data as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}

/** Finish the login: swap the code for tokens and look up the channel. */
export async function finishLogin(code: string, verifier: string, redirectUri: string): Promise<YouTubeChannel> {
  const cfg = clientConfig();
  if (!cfg) throw new YouTubeError("Set up your Google OAuth client first.", 400);
  const t = await tokenRequest({
    code,
    client_id: cfg.client_id,
    ...(cfg.client_secret ? { client_secret: cfg.client_secret } : {}),
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
  if (!t.refresh_token) throw new YouTubeError("Google didn't return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.", 400);
  if (t.scope && !t.scope.includes("youtube.upload")) throw new YouTubeError("Upload permission wasn't granted. Connect again and tick the YouTube upload box.", 403);
  const store: TokenStore = { access_token: t.access_token, refresh_token: t.refresh_token, expiry: Date.now() + t.expires_in * 1000, scope: t.scope };
  writeSecret(tokenFile(), store);
  const channel = await fetchChannel();
  writeSecret(tokenFile(), { ...store, channel });
  return channel;
}

/** A valid access token, refreshed when it's about to expire. */
export async function accessToken(force = false): Promise<string> {
  const store = readJson<TokenStore>(tokenFile());
  if (!store) throw new YouTubeError("YouTube isn't connected.", 401);
  if (!force && store.access_token && store.expiry - Date.now() > 60_000) return store.access_token;
  const cfg = clientConfig();
  if (!cfg) throw new YouTubeError("Set up your Google OAuth client first.", 400);
  try {
    const t = await tokenRequest({ client_id: cfg.client_id, ...(cfg.client_secret ? { client_secret: cfg.client_secret } : {}), grant_type: "refresh_token", refresh_token: store.refresh_token });
    const next: TokenStore = { ...store, access_token: t.access_token, expiry: Date.now() + t.expires_in * 1000, error: undefined, ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}) };
    writeSecret(tokenFile(), next);
    return next.access_token;
  } catch (err) {
    if (err instanceof YouTubeError && err.reason === "invalid_grant") writeSecret(tokenFile(), { ...store, error: err.message });
    throw err;
  }
}

async function api<T>(url: string, init: RequestInit = {}, retried = false): Promise<T> {
  const token = await accessToken();
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` }, signal: init.signal ?? AbortSignal.timeout(30000) });
  if (res.status === 401 && !retried) {
    await accessToken(true);
    return api<T>(url, init, true);
  }
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

/** Turn a YouTube error response into one sentence a person can act on. */
export async function apiError(res: Response): Promise<YouTubeError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string; message?: string }[] } };
  const reason = body.error?.errors?.[0]?.reason ?? "";
  const msg = body.error?.message ?? res.statusText;
  const friendly: Record<string, string> = {
    quotaExceeded: "Your Google Cloud project has used today's YouTube API quota. It resets at midnight Pacific time; you can ask for more in Google Cloud Console.",
    uploadLimitExceeded: "This channel has hit YouTube's daily upload limit. Try again tomorrow.",
    youtubeSignupRequired: "That Google account doesn't have a YouTube channel yet. Create one at youtube.com, then connect again.",
    forbidden: "YouTube refused the upload for this account.",
    invalidTitle: "YouTube rejected the title.",
    invalidDescription: "YouTube rejected the description.",
    invalidPublishAt: "The schedule time must be in the future.",
    invalidTags: "YouTube rejected the tags.",
    insufficientPermissions: "The connection doesn't have upload permission. Connect YouTube again.",
  };
  return new YouTubeError(friendly[reason] ?? `YouTube error ${res.status}: ${msg}`, res.status, reason);
}

async function fetchChannel(): Promise<YouTubeChannel> {
  const data = await api<{ items?: { id: string; snippet: { title: string; customUrl?: string; thumbnails?: Record<string, { url: string }> }; statistics?: { subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean } }[] }>(
    `${API()}/channels?part=snippet,statistics&mine=true`,
  );
  const c = data.items?.[0];
  if (!c) throw new YouTubeError("That Google account doesn't have a YouTube channel yet. Create one at youtube.com, then connect again.", 404, "noChannel");
  return {
    id: c.id,
    title: c.snippet.title,
    handle: c.snippet.customUrl,
    thumbnail: c.snippet.thumbnails?.default?.url ?? c.snippet.thumbnails?.medium?.url,
    subscribers: c.statistics?.hiddenSubscriberCount ? undefined : Number(c.statistics?.subscriberCount ?? 0),
    videos: Number(c.statistics?.videoCount ?? 0),
  };
}

export function status(origin: string): YouTubeStatus {
  const cfg = clientConfig();
  const store = readJson<TokenStore>(tokenFile());
  return {
    configured: Boolean(cfg),
    connected: Boolean(cfg && store?.refresh_token && !store.error),
    redirectUri: redirectUriFor(origin),
    clientType: cfg?.type,
    channel: store?.channel,
    error: store?.error,
  };
}

export function isConnected(): boolean {
  const store = readJson<TokenStore>(tokenFile());
  return Boolean(clientConfig() && store?.refresh_token && !store.error);
}

export async function disconnect() {
  const store = readJson<TokenStore>(tokenFile());
  if (store?.refresh_token) {
    await fetch(`${REVOKE_URL()}?token=${encodeURIComponent(store.refresh_token)}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15000) }).catch(() => {});
  }
  fs.rmSync(tokenFile(), { force: true });
}

// ── Metadata ─────────────────────────────────────────────────────────────

export interface VideoMeta {
  title: string;
  description: string;
  tags: string[];
  privacy: Privacy;
  /** ISO time; YouTube publishes the video then (it stays private until). */
  publishAt?: string;
  language?: string;
  /** Realistic altered or synthetic content (e.g. a cloned-voice dub) must be disclosed. */
  synthetic?: boolean;
}

/** YouTube's limits: title ≤ 100 characters, description ≤ 5000 bytes, no angle brackets, tags ≤ 500 characters in total. */
export function videoResource(m: VideoMeta) {
  const clean = (s: string) => s.replace(/[<>]/g, "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  let title = clean(m.title).replace(/\s+/g, " ").trim();
  if (!title) title = "Highlight";
  if ([...title].length > 100) title = `${[...title].slice(0, 99).join("").trimEnd()}…`;
  let description = clean(m.description).trim();
  while (Buffer.byteLength(description, "utf8") > 5000) description = description.slice(0, -50);
  const tags: string[] = [];
  let used = 0;
  for (const raw of m.tags) {
    const t = clean(raw).replace(/^#/, "").replace(/,/g, " ").trim().slice(0, 60);
    if (!t || tags.includes(t)) continue;
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (tags.length ? 1 : 0);
    if (used + cost > 500) break;
    used += cost;
    tags.push(t);
  }
  const scheduled = Boolean(m.publishAt);
  return {
    snippet: {
      title,
      description,
      tags,
      categoryId: "20", // Gaming
      ...(m.language ? { defaultLanguage: m.language, defaultAudioLanguage: m.language } : {}),
    },
    status: {
      // A scheduled video must be private until publishAt.
      privacyStatus: scheduled ? "private" : m.privacy,
      ...(scheduled ? { publishAt: new Date(m.publishAt!).toISOString() } : {}),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: Boolean(m.synthetic),
      embeddable: true,
    },
  };
}

// ── Resumable upload ──────────────────────────────────────────────────────

export interface UploadedVideo {
  id: string;
  status?: { privacyStatus?: string; publishAt?: string; uploadStatus?: string };
}

const CHUNK = () => {
  const n = Number(process.env.CF_YT_CHUNK || 8 * 1024 * 1024);
  // Chunks must be multiples of 256 KiB.
  return Math.max(262144, Math.floor(n / 262144) * 262144);
};

const RETRY = new Set([500, 502, 503, 504]);
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("Canceled"));
    });
  });

/** Upload a video file: start a resumable session, send 8 MiB chunks, resume after errors. */
export async function uploadVideo(file: string, meta: VideoMeta, opts: { onProgress?: (f: number) => void; signal?: AbortSignal } = {}): Promise<UploadedVideo> {
  const size = fs.statSync(file).size;
  const resource = videoResource(meta);
  const start = async (): Promise<string> => {
    const token = await accessToken();
    const res = await fetch(`${UPLOAD()}/videos?uploadType=resumable&part=snippet,status`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(resource),
      signal: opts.signal,
    });
    if (res.status === 401) {
      await accessToken(true);
      return start();
    }
    if (!res.ok) throw await apiError(res);
    const loc = res.headers.get("location");
    if (!loc) throw new YouTubeError("YouTube didn't return an upload URL.", 500);
    return loc;
  };

  let session = await start();
  let offset = 0;
  let failures = 0;
  const fd = fs.openSync(file, "r");
  try {
    for (;;) {
      if (opts.signal?.aborted) throw new Error("Canceled");
      const len = Math.min(CHUNK(), size - offset);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      let res: Response;
      try {
        const token = await accessToken();
        res = await fetch(session, {
          method: "PUT",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4", "Content-Length": String(len), "Content-Range": `bytes ${offset}-${offset + len - 1}/${size}` },
          body: buf,
          signal: opts.signal,
        });
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        res = new Response(null, { status: 599 }); // network error: resume below
      }
      if (res.status === 200 || res.status === 201) {
        opts.onProgress?.(1);
        return (await res.json()) as UploadedVideo;
      }
      if (res.status === 308) {
        offset = receivedUpTo(res.headers.get("range"));
        failures = 0;
        opts.onProgress?.(offset / size);
        continue;
      }
      if (res.status === 404) {
        // The session expired: start over.
        if (++failures > 3) throw new YouTubeError("YouTube kept losing the upload session.", 404);
        session = await start();
        offset = 0;
        continue;
      }
      if (res.status === 401) {
        await accessToken(true);
        continue;
      }
      if (RETRY.has(res.status) || res.status === 599) {
        if (++failures > 6) throw new YouTubeError(`The upload kept failing (HTTP ${res.status}).`, res.status);
        // Exponential backoff with jitter, as Google recommends.
        const base = Number(process.env.CF_YT_BACKOFF_MS || 1000);
        await sleep(Math.min(30000, base * 2 ** failures + Math.random() * base), opts.signal);
        // Ask YouTube how much it has, then carry on from there.
        const check = await uploadStatus(session, size, opts.signal);
        if (check.done) {
          opts.onProgress?.(1);
          return check.done;
        }
        offset = check.offset;
        continue;
      }
      throw await apiError(res);
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** "bytes=0-1048575" → 1048576; no header means nothing arrived yet. */
export function receivedUpTo(range: string | null): number {
  const m = /bytes=\d+-(\d+)/.exec(range ?? "");
  return m ? Number(m[1]) + 1 : 0;
}

async function uploadStatus(session: string, size: number, signal?: AbortSignal): Promise<{ offset: number; done?: UploadedVideo }> {
  try {
    const token = await accessToken();
    const res = await fetch(session, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Length": "0", "Content-Range": `bytes */${size}` }, signal });
    if (res.status === 200 || res.status === 201) return { offset: size, done: (await res.json()) as UploadedVideo };
    if (res.status === 308) return { offset: receivedUpTo(res.headers.get("range")) };
  } catch {
    /* still offline: retry from the start of the session's known range */
  }
  return { offset: 0 };
}

/** Processing state of an uploaded video. */
export async function videoState(id: string): Promise<{ uploadStatus?: string; privacyStatus?: string; publishAt?: string; failureReason?: string; rejectionReason?: string } | null> {
  const data = await api<{ items?: { status?: { uploadStatus?: string; privacyStatus?: string; publishAt?: string; failureReason?: string; rejectionReason?: string } }[] }>(
    `${API()}/videos?part=status&id=${encodeURIComponent(id)}`,
  );
  return data.items?.[0]?.status ?? null;
}
