import { addTiktokAccount } from "@/server/app";
import { finishTiktokLogin } from "@/server/biz/tiktok";
import { guard, originOf } from "@/server/guard";

export const dynamic = "force-dynamic";

function saved(req: Request): { state?: string; verifier?: string; mode?: "direct" | "draft" } {
  const raw = /(?:^|;\s*)cf_tt_oauth=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  try {
    return raw ? JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) : {};
  } catch {
    return {};
  }
}

async function finish(req: Request, params: URLSearchParams): Promise<{ ok: true; name: string } | { ok: false; message: string }> {
  const s = saved(req);
  const err = params.get("error");
  if (err) return { ok: false, message: err === "access_denied" ? "You cancelled the TikTok login." : `TikTok said: ${params.get("error_description") || err}` };
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state || !s.state || state !== s.state || !s.verifier) return { ok: false, message: "That TikTok login expired or didn't start here. Press Connect TikTok again." };
  try {
    const { accountId, login } = await finishTiktokLogin(code, s.verifier, s.mode ?? "draft");
    const name = login.username ? `@${login.username}` : login.nickname || "TikTok";
    addTiktokAccount(accountId, name, login.username, login.avatar, login.mode);
    return { ok: true, name };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

const clear = "cf_tt_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";

/** TikTok sends the login back here (register http://127.0.0.1:3200/api/accounts/tiktok/callback on a Desktop app). */
export async function GET(req: Request) {
  const blocked = guard(req, "read");
  if (blocked) return blocked;
  const r = await finish(req, new URL(req.url).searchParams);
  const q = r.ok ? `tiktok=connected&name=${encodeURIComponent(r.name)}` : `tiktok=error&message=${encodeURIComponent(r.message)}`;
  return new Response(null, { status: 302, headers: { Location: new URL(`/business?${q}`, originOf(req)).toString(), "Set-Cookie": clear } });
}

/** If TikTok sent you to a page this server can't see: paste the address you landed on. {"url": "https://…?code=…&state=…"} */
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => null)) as { url?: string } | null;
  let params: URLSearchParams;
  try {
    params = new URL(body?.url ?? "").searchParams;
  } catch {
    return Response.json({ error: "Paste the whole address from the browser's address bar." }, { status: 400 });
  }
  const r = await finish(req, params);
  return r.ok ? Response.json({ name: r.name }, { headers: { "Set-Cookie": clear } }) : Response.json({ error: r.message }, { status: 400 });
}
