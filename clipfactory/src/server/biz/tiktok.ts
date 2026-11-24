import crypto from "node:crypto";
import fs from "node:fs";
import { readSecret, removeSecret, writeSecret } from "../secrets.ts";
import { AuthError, type PostMeta, type Posted, type Stats } from "./publishers.ts";

// TikTok's Content Posting API, with your own TikTok developer app.
//  - Direct post (scope video.publish) puts the short straight on the account.
//    Until TikTok audits your app it can only post to accounts set to private,
//    as private videos, for up to 5 accounts a day.
//  - Draft (scope video.upload) sends it to the TikTok app's inbox; you tap
//    Post there. Fine for an unaudited app; at most 5 drafts waiting per day.
// Register the app as a Desktop app with the redirect URI
// http://127.0.0.1:3200/api/accounts/tiktok/callback/ (Desktop allows
// 127.0.0.1 over http; PKCE's challenge is hex SHA-256 there).
// Uploads are chunked: 5–64 MB per chunk (the last up to 128 MB), files under
// 5 MB in one piece. https://developers.tiktok.com/doc/content-posting-api-get-started

const AUTH = () => process.env.CF_TIKTOK_AUTH_URL || "https://www.tiktok.com/v2/auth/authorize/";
const API = () => process.env.CF_TIKTOK_API_URL || "https://open.tiktokapis.com";

export interface TikTokApp {
  clientKey: string;
  clientSecret: string;
  /** The redirect URI registered on the app (the login lands there). */
  redirectUri: string;
}

export interface TikTokLogin {
  openId: string;
  access_token: string;
  refresh_token: string;
  expiresAt: number;
  refreshExpiresAt: number;
  scope: string;
  username?: string;
  nickname?: string;
  avatar?: string;
  mode: "direct" | "draft";
}

export function tiktokApp(): TikTokApp | null {
  const key = process.env.TIKTOK_CLIENT_KEY;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (key && secret) return { clientKey: key, clientSecret: secret, redirectUri: process.env.TIKTOK_REDIRECT_URI || "" };
  return readSecret<TikTokApp>("tiktok-app.json");
}

export function saveTiktokApp(a: TikTokApp) {
  writeSecret("tiktok-app.json", { clientKey: a.clientKey.trim(), clientSecret: a.clientSecret.trim(), redirectUri: a.redirectUri.trim() });
}

const loginFile = (accountId: string) => `tiktok-${accountId.replace(/^tiktok:/, "").replace(/[^\w-]/g, "")}.json`;

export function tiktokLogin(accountId: string): TikTokLogin | null {
  return readSecret<TikTokLogin>(loginFile(accountId));
}

export function tiktokReady(accountId: string): boolean {
  const l = tiktokLogin(accountId);
  return Boolean(tiktokApp() && l && l.refreshExpiresAt > Date.now());
}

export function forgetTiktok(accountId: string) {
  removeSecret(loginFile(accountId));
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The TikTok login page, with PKCE. Keep state and verifier until the code comes back. */
export function tiktokLoginUrl(mode: "direct" | "draft"): { url: string; state: string; verifier: string } {
  const app = tiktokApp();
  if (!app?.redirectUri) throw new Error("Add your TikTok app's client key, secret and redirect URI first.");
  const verifier = b64url(crypto.randomBytes(48));
  const state = `${mode}.${b64url(crypto.randomBytes(16))}`;
  const u = new URL(AUTH());
  u.searchParams.set("client_key", app.clientKey);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", ["user.info.basic", mode === "direct" ? "video.publish" : "video.upload", "video.list"].join(","));
  u.searchParams.set("redirect_uri", app.redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", crypto.createHash("sha256").update(verifier).digest("hex"));
  u.searchParams.set("code_challenge_method", "S256");
  return { url: u.toString(), state, verifier };
}

interface TokenRes {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenCall(body: Record<string, string>): Promise<TokenRes> {
  const app = tiktokApp();
  if (!app) throw new AuthError("TikTok isn't set up.");
  const res = await fetch(`${API()}/v2/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams({ client_key: app.clientKey, client_secret: app.clientSecret, ...body }),
  });
  const r = (await res.json().catch(() => ({}))) as TokenRes;
  if (!res.ok || r.error || !r.access_token) throw new AuthError(`TikTok login failed: ${r.error_description || r.error || res.status}`);
  return r;
}

/** Finish the login with the code TikTok sent back; returns the account ID. */
export async function finishTiktokLogin(code: string, verifier: string, mode: "direct" | "draft"): Promise<{ accountId: string; login: TikTokLogin }> {
  const app = tiktokApp()!;
  const r = await tokenCall({ code, grant_type: "authorization_code", redirect_uri: app.redirectUri, code_verifier: verifier });
  const login: TikTokLogin = {
    openId: r.open_id!,
    access_token: r.access_token!,
    refresh_token: r.refresh_token!,
    expiresAt: Date.now() + (r.expires_in ?? 86400) * 1000,
    refreshExpiresAt: Date.now() + (r.refresh_expires_in ?? 365 * 86400) * 1000,
    scope: r.scope ?? "",
    mode,
  };
  const me = await tiktokApi<{ user?: { display_name?: string; username?: string; avatar_url?: string } }>(login, "GET", "/v2/user/info/?fields=open_id,avatar_url,display_name,username").catch(() => null);
  login.nickname = me?.user?.display_name;
  login.username = me?.user?.username;
  login.avatar = me?.user?.avatar_url;
  const accountId = `tiktok:${login.openId}`;
  writeSecret(loginFile(accountId), login);
  return { accountId, login };
}

async function fresh(accountId: string): Promise<TikTokLogin> {
  const l = tiktokLogin(accountId);
  if (!l) throw new AuthError("This TikTok account isn't connected.");
  if (l.expiresAt > Date.now() + 120_000) return l;
  if (l.refreshExpiresAt < Date.now()) throw new AuthError("The TikTok login expired; connect the account again.");
  const r = await tokenCall({ grant_type: "refresh_token", refresh_token: l.refresh_token });
  const next = { ...l, access_token: r.access_token!, refresh_token: r.refresh_token ?? l.refresh_token, expiresAt: Date.now() + (r.expires_in ?? 86400) * 1000, refreshExpiresAt: r.refresh_expires_in ? Date.now() + r.refresh_expires_in * 1000 : l.refreshExpiresAt };
  writeSecret(loginFile(accountId), next);
  return next;
}

interface Envelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}

async function tiktokApi<T>(login: TikTokLogin, method: "GET" | "POST", pathAndQuery: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API()}${pathAndQuery}`, {
    method,
    headers: { Authorization: `Bearer ${login.access_token}`, ...(body ? { "Content-Type": "application/json; charset=UTF-8" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const r = parseBigIds<Envelope<T>>(await res.text());
  const code = r.error?.code;
  if (!res.ok || (code && code !== "ok")) {
    const msg = HINTS[code ?? ""] ?? r.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401 || code === "access_token_invalid" || code === "scope_not_authorized") throw new AuthError(`TikTok: ${msg}`);
    throw new Error(`TikTok: ${msg}`);
  }
  return r.data as T;
}

const HINTS: Record<string, string> = {
  unaudited_client_can_only_post_to_private_accounts: "your TikTok app isn't audited yet, so it can only post to a private account. Set the account to private, switch it to Draft mode, or apply for TikTok's audit.",
  spam_risk_too_many_posts: "TikTok's daily posting limit for this account is reached; it'll go out tomorrow.",
  spam_risk_too_many_pending_share: "5 drafts are already waiting in your TikTok inbox. Post or delete them in the app, and the rest follow.",
  spam_risk_user_banned_from_posting: "TikTok has stopped this account from posting.",
  privacy_level_option_mismatch: "the privacy level isn't one this account allows.",
  url_ownership_unverified: "TikTok wants the domain verified for URL uploads (this app uploads files, so this shouldn't happen).",
};

/**
 * TikTok sends post IDs as JSON numbers, and they're 19 digits: past what a
 * JavaScript number holds exactly. Quote them before parsing so they survive.
 */
export function parseBigIds<T>(text: string): T {
  const safe = text.replace(/("publicaly_available_post_id"\s*:\s*\[)([^\]]*)(\])/g, (_, a: string, nums: string, b: string) => a + nums.replace(/-?\d+/g, (n) => `"${n}"`) + b);
  try {
    return JSON.parse(safe) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Chunks per TikTok's rules: up to 64 MB goes in one piece (chunk_size =
 * the file's size); bigger files in 10 MB chunks, the last one taking the
 * remainder (total = floor(size / chunk)).
 */
export function chunkPlan(size: number, preferred = 10 * 1024 * 1024): { chunkSize: number; count: number } {
  const MB = 1024 * 1024;
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = Math.max(5 * MB, Math.min(64 * MB, preferred));
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function tiktokPost(accountId: string, file: string, meta: PostMeta, onProgress?: (f: number) => void): Promise<Posted> {
  const login = await fresh(accountId);
  const size = fs.statSync(file).size;
  const { chunkSize, count } = chunkPlan(size);
  const source_info = { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: count };
  let init: { publish_id: string; upload_url: string };
  if (login.mode === "draft") {
    init = await tiktokApi(login, "POST", "/v2/post/publish/inbox/video/init/", { source_info });
  } else {
    const info = await tiktokApi<{ privacy_level_options?: string[]; max_video_post_duration_sec?: number; creator_username?: string }>(login, "POST", "/v2/post/publish/creator_info/query/", {});
    const options = info.privacy_level_options ?? ["SELF_ONLY"];
    const want = meta.privacy === "public" ? "PUBLIC_TO_EVERYONE" : meta.privacy === "unlisted" ? "MUTUAL_FOLLOW_FRIENDS" : "SELF_ONLY";
    const privacy_level = options.includes(want) ? want : options.includes("SELF_ONLY") ? "SELF_ONLY" : options[0];
    init = await tiktokApi(login, "POST", "/v2/post/publish/video/init/", {
      post_info: { title: meta.caption.slice(0, 2200), privacy_level, disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 },
      source_info,
    });
  }
  // Upload the chunks in order; the last one takes whatever is left.
  const fd = fs.openSync(file, "r");
  try {
    for (let i = 0; i < count; i++) {
      const start = i * chunkSize;
      const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
      const buf = Buffer.alloc(end - start + 1);
      fs.readSync(fd, buf, 0, buf.length, start);
      const res = await fetch(init.upload_url, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(buf.length), "Content-Range": `bytes ${start}-${end}/${size}` }, body: new Uint8Array(buf) });
      if (res.status !== 201 && res.status !== 206 && !res.ok) throw new Error(`TikTok upload failed at chunk ${i + 1}/${count} (${res.status})`);
      onProgress?.((end + 1) / size);
    }
  } finally {
    fs.closeSync(fd);
  }
  // Follow it until TikTok has it.
  const every = Number(process.env.CF_TIKTOK_POLL_MS || 5000);
  for (let i = 0; i < 60; i++) {
    const st = await tiktokApi<{ status?: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>(login, "POST", "/v2/post/publish/status/fetch/", { publish_id: init.publish_id });
    if (st.status === "FAILED") throw new Error(`TikTok couldn't post it${st.fail_reason ? ` (${st.fail_reason})` : ""}.`);
    if (st.status === "SEND_TO_USER_INBOX") return { remoteId: init.publish_id, note: "In your TikTok inbox: open the app and tap Post." };
    if (st.status === "PUBLISH_COMPLETE") {
      const id = st.publicaly_available_post_id?.[0];
      if (id) return { remoteId: String(id), url: login.username ? `https://www.tiktok.com/@${login.username}/video/${id}` : undefined };
      return { remoteId: init.publish_id, note: "Posted as private (only you can see it). Make it public in the TikTok app." };
    }
    await sleep(every);
  }
  return { remoteId: init.publish_id, note: "TikTok is still processing it." };
}

export async function tiktokStats(accountId: string, ids: string[]): Promise<Map<string, Stats>> {
  const login = await fresh(accountId);
  const out = new Map<string, Stats>();
  // Only public posts have a video ID; drafts and private uploads only have a publish ID.
  const vids = ids.filter((id) => /^\d+$/.test(id));
  for (let i = 0; i < vids.length; i += 20) {
    const r = await tiktokApi<{ videos?: { id: string; view_count?: number; like_count?: number; comment_count?: number }[] }>(login, "POST", "/v2/video/query/?fields=id,view_count,like_count,comment_count", { filters: { video_ids: vids.slice(i, i + 20) } });
    for (const v of r.videos ?? []) out.set(String(v.id), { views: v.view_count ?? 0, likes: v.like_count, comments: v.comment_count });
  }
  return out;
}
