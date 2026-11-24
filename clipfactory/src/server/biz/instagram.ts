import fs from "node:fs";
import { readSecret, removeSecret, writeSecret } from "../secrets.ts";
import { AuthError, type PostMeta, type Posted, type Stats } from "./publishers.ts";

// Instagram Reels through Meta's content publishing API, for a professional
// (Business or Creator) account. Connect with a long-lived access token from
// your Meta app's dashboard:
//  - "Instagram API with Instagram Login" tokens (start with IG…) talk to graph.instagram.com
//    and are refreshed here before their 60 days run out;
//  - "Facebook Login for Business" tokens (start with EAA…) talk to graph.facebook.com,
//    for an Instagram account linked to a Facebook Page.
// The video goes up as a resumable upload to rupload.facebook.com, so it never
// needs a public URL. https://developers.facebook.com/docs/instagram-platform/content-publishing/

const VERSION = () => process.env.CF_IG_API_VERSION || "v24.0";
const IG_HOST = () => process.env.CF_IG_API_URL || "https://graph.instagram.com";
const FB_HOST = () => process.env.CF_FB_API_URL || "https://graph.facebook.com";

export interface IgLogin {
  igUserId: string;
  username: string;
  avatar?: string;
  token: string;
  kind: "instagram" | "facebook";
  /** When the token stops working (long-lived Instagram tokens: 60 days). */
  expiresAt?: number;
  savedAt: number;
}

const file = (accountId: string) => `instagram-${accountId.replace(/^instagram:/, "").replace(/[^\w-]/g, "")}.json`;

export function igLogin(accountId: string): IgLogin | null {
  return readSecret<IgLogin>(file(accountId));
}

export function igReady(accountId: string): boolean {
  const l = igLogin(accountId);
  return Boolean(l && (!l.expiresAt || l.expiresAt > Date.now()));
}

export function forgetInstagram(accountId: string) {
  removeSecret(file(accountId));
}

const host = (l: Pick<IgLogin, "kind">) => (l.kind === "instagram" ? IG_HOST() : FB_HOST());

async function call<T>(l: Pick<IgLogin, "kind" | "token">, method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<T> {
  const u = new URL(`${host(l)}/${VERSION()}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", l.token);
  const res = await fetch(u, { method });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } };
  if (!res.ok || body.error) {
    const e = body.error;
    const msg = e?.error_user_msg || e?.message || `HTTP ${res.status}`;
    if (res.status === 401 || e?.code === 190) throw new AuthError(`Instagram: ${msg}`);
    throw new Error(`Instagram: ${msg}`);
  }
  return body;
}

/** Connect an account from a long-lived access token. Returns one account per Instagram profile the token can post to. */
export async function connectInstagram(token: string): Promise<{ accountId: string; login: IgLogin }[]> {
  const t = token.trim();
  if (t.startsWith("IG")) {
    const me = await call<{ user_id?: string; id?: string; username?: string; profile_picture_url?: string }>({ kind: "instagram", token: t }, "GET", "/me", { fields: "user_id,username,profile_picture_url" });
    const login: IgLogin = { igUserId: String(me.user_id ?? me.id), username: me.username ?? "instagram", avatar: me.profile_picture_url, token: t, kind: "instagram", expiresAt: Date.now() + 59 * 86400_000, savedAt: Date.now() };
    const accountId = `instagram:${login.igUserId}`;
    writeSecret(file(accountId), login);
    return [{ accountId, login }];
  }
  const pages = await call<{ data?: { instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }[] }>({ kind: "facebook", token: t }, "GET", "/me/accounts", { fields: "instagram_business_account{id,username,profile_picture_url}" });
  const out: { accountId: string; login: IgLogin }[] = [];
  for (const p of pages.data ?? []) {
    const ig = p.instagram_business_account;
    if (!ig) continue;
    const login: IgLogin = { igUserId: ig.id, username: ig.username ?? "instagram", avatar: ig.profile_picture_url, token: t, kind: "facebook", savedAt: Date.now() };
    const accountId = `instagram:${ig.id}`;
    writeSecret(file(accountId), login);
    out.push({ accountId, login });
  }
  if (!out.length) throw new Error("That token can't see any Instagram professional account linked to a Facebook Page.");
  return out;
}

/** Instagram Login tokens last 60 days; refresh once they're a day old and within 10 days of running out. */
async function fresh(accountId: string): Promise<IgLogin> {
  const l = igLogin(accountId);
  if (!l) throw new AuthError("This Instagram account isn't connected.");
  if (l.kind !== "instagram" || !l.expiresAt) return l;
  if (l.expiresAt < Date.now()) throw new AuthError("The Instagram token expired; paste a new one.");
  if (l.expiresAt - Date.now() > 10 * 86400_000 || Date.now() - l.savedAt < 86400_000) return l;
  const u = new URL(`${IG_HOST()}/refresh_access_token`);
  u.searchParams.set("grant_type", "ig_refresh_token");
  u.searchParams.set("access_token", l.token);
  const res = await fetch(u);
  const r = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !r.access_token) return l;
  const next = { ...l, token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 60 * 86400) * 1000, savedAt: Date.now() };
  writeSecret(file(accountId), next);
  return next;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function igPost(accountId: string, path: string, meta: PostMeta, onProgress?: (f: number) => void): Promise<Posted> {
  const l = await fresh(accountId);
  // 1. A Reels container that takes a resumable upload.
  const box = await call<{ id: string; uri?: string }>(l, "POST", `/${l.igUserId}/media`, { media_type: "REELS", upload_type: "resumable", caption: meta.caption.slice(0, 2200), share_to_feed: "true" });
  // 2. The bytes, straight to Meta.
  const size = fs.statSync(path).size;
  const uri = box.uri || `https://rupload.facebook.com/ig-api-upload/${VERSION()}/${box.id}`;
  const up = await fetch(uri, { method: "POST", headers: { Authorization: `OAuth ${l.token}`, offset: "0", file_size: String(size) }, body: new Uint8Array(fs.readFileSync(path)) });
  const upBody = (await up.json().catch(() => ({}))) as { success?: boolean; debug_info?: { message?: string } };
  if (!up.ok || upBody.success === false) {
    const why = upBody.debug_info?.message ?? `HTTP ${up.status}`;
    // Meta documents direct (resumable) uploads for Facebook Login for Business apps.
    throw new Error(l.kind === "instagram" ? `Instagram refused the upload (${why}). Meta documents direct video uploads for Facebook Login for Business: connect this account with a Facebook token (EAA…) for a Page linked to it.` : `Instagram upload failed: ${why}`);
  }
  onProgress?.(1);
  // 3. Wait for Instagram to process it.
  const every = Number(process.env.CF_IG_POLL_MS || 5000);
  let state = "IN_PROGRESS";
  for (let i = 0; i < 72 && state === "IN_PROGRESS"; i++) {
    await sleep(every);
    const st = await call<{ status_code?: string; status?: string }>(l, "GET", `/${box.id}`, { fields: "status_code,status" });
    state = st.status_code ?? "IN_PROGRESS";
    if (state === "ERROR" || state === "EXPIRED") throw new Error(`Instagram couldn't process the video (${st.status ?? state}).`);
  }
  if (state !== "FINISHED") throw new Error("Instagram is still processing the video after 6 minutes; try again later.");
  // 4. Publish.
  const pub = await call<{ id: string }>(l, "POST", `/${l.igUserId}/media_publish`, { creation_id: box.id });
  const link = await call<{ permalink?: string }>(l, "GET", `/${pub.id}`, { fields: "permalink" }).catch(() => ({}) as { permalink?: string });
  return { remoteId: pub.id, url: link.permalink };
}

export async function igStats(accountId: string, ids: string[]): Promise<Map<string, Stats>> {
  const l = await fresh(accountId);
  const out = new Map<string, Stats>();
  for (const id of ids) {
    const basic = await call<{ like_count?: number; comments_count?: number }>(l, "GET", `/${id}`, { fields: "like_count,comments_count" }).catch(() => null);
    // Views need the insights permission; without it the post still counts, at 0.
    const ins = await call<{ data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(l, "GET", `/${id}/insights`, { metric: "views" }).catch(() => null);
    const v = ins?.data?.find((d) => d.name === "views");
    out.set(id, { views: v?.total_value?.value ?? v?.values?.[0]?.value ?? 0, likes: basic?.like_count, comments: basic?.comments_count });
  }
  return out;
}
