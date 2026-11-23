import { guard, originOf } from "@/server/guard";
import { redirectUriFor, startLogin, YouTubeError } from "@/server/youtube";

export const dynamic = "force-dynamic";

/** Sends the browser to Google's consent screen. */
export async function GET(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const origin = originOf(req);
  const url = new URL(origin);
  // Google's loopback redirect is http://127.0.0.1:<port>; use that host so the cookie comes back with it.
  if (url.hostname === "localhost") {
    url.hostname = "127.0.0.1";
    return Response.redirect(new URL("/api/youtube/connect", url), 302);
  }
  try {
    const redirectUri = redirectUriFor(origin);
    const { url: consent, state, verifier } = startLogin(redirectUri);
    const cookie = Buffer.from(JSON.stringify({ state, verifier, redirectUri })).toString("base64url");
    return new Response(null, {
      status: 302,
      headers: {
        Location: consent,
        "Set-Cookie": `cf_yt_oauth=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
      },
    });
  } catch (err) {
    const msg = err instanceof YouTubeError ? err.message : "Couldn't start the YouTube login.";
    return Response.redirect(new URL(`/?youtube=error&message=${encodeURIComponent(msg)}`, origin), 302);
  }
}
