import { guard, originOf } from "@/server/guard";
import { tiktokLoginUrl } from "@/server/biz/tiktok";

export const dynamic = "force-dynamic";

/** Sends the browser to TikTok's login. ?mode=draft (inbox, works unaudited) or direct. */
export async function GET(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const mode = new URL(req.url).searchParams.get("mode") === "direct" ? "direct" : "draft";
  try {
    const { url, state, verifier } = tiktokLoginUrl(mode);
    const cookie = Buffer.from(JSON.stringify({ state, verifier, mode })).toString("base64url");
    return new Response(null, { status: 302, headers: { Location: url, "Set-Cookie": `cf_tt_oauth=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900` } });
  } catch (err) {
    return Response.redirect(new URL(`/business?tiktok=error&message=${encodeURIComponent((err as Error).message)}`, originOf(req)), 302);
  }
}
