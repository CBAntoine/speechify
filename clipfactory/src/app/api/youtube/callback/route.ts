import { guard, originOf } from "@/server/guard";
import { finishLogin, YouTubeError } from "@/server/youtube";

export const dynamic = "force-dynamic";

/**
 * Google redirects to the dashboard root with ?code&state, which forwards
 * here. This is a cross-site navigation by design, so it only checks the
 * host; the state value in our cookie proves the login started here.
 */
export async function GET(req: Request) {
  const blocked = guard(req, "read");
  if (blocked) return blocked;
  const url = new URL(req.url);
  const origin = originOf(req);
  const back = (q: string) =>
    new Response(null, { status: 302, headers: { Location: new URL(`/?${q}`, origin).toString(), "Set-Cookie": "cf_yt_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" } });
  const raw = /(?:^|;\s*)cf_yt_oauth=([^;]+)/.exec(req.headers.get("cookie") ?? "")?.[1];
  let saved: { state?: string; verifier?: string; redirectUri?: string } = {};
  try {
    saved = raw ? JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) : {};
  } catch {
    saved = {};
  }
  const err = url.searchParams.get("error");
  if (err) return back(`youtube=error&message=${encodeURIComponent(err === "access_denied" ? "You cancelled the YouTube login." : `Google said: ${err}`)}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !saved.state || state !== saved.state || !saved.verifier || !saved.redirectUri) {
    return back(`youtube=error&message=${encodeURIComponent("That login link expired or didn't start here. Press Connect YouTube again.")}`);
  }
  try {
    const channel = await finishLogin(code, saved.verifier, saved.redirectUri);
    return back(`youtube=connected&channel=${encodeURIComponent(channel.title)}`);
  } catch (e) {
    const msg = e instanceof YouTubeError ? e.message : "Couldn't finish the YouTube login.";
    return back(`youtube=error&message=${encodeURIComponent(msg)}`);
  }
}
