// The server listens on 127.0.0.1, but a web page you visit could still try
// to call it: a cross-site form post (CSRF) or a DNS-rebinding domain that
// points at 127.0.0.1. Now that Clip Factory can post to your YouTube channel,
// every route checks who is asking.

const LOCAL = ["127.0.0.1", "localhost", "[::1]"];

function allowedHosts(): Set<string> {
  const extra = (process.env.CF_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...LOCAL, ...extra]);
}

const forbid = (why: string) => Response.json({ error: why }, { status: 403 });

/**
 * null when the request may proceed, else a 403. "read" only checks the Host
 * (enough for GETs: other sites can't read our responses). "write" also
 * requires the request to come from one of our own pages.
 */
export function guard(req: Request, mode: "read" | "write" = "write"): Response | null {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const name = host.replace(/:\d+$/, "");
  if (!allowedHosts().has(name)) return forbid(`Requests for ${name || "an unknown host"} aren't accepted. To use Clip Factory from another device, add its address to CF_ALLOWED_HOSTS.`);
  if (mode === "read") return null;
  const origin = req.headers.get("origin");
  if (origin) {
    let same = false;
    try {
      same = new URL(origin).host.toLowerCase() === host;
    } catch {
      same = false;
    }
    if (!same) return forbid("Only Clip Factory's own pages can do that.");
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return forbid("Only Clip Factory's own pages can do that.");
  return null;
}

/** The origin the browser used (from its Host header), for redirect URIs and redirects back. */
export function originOf(req: Request): string {
  const host = req.headers.get("host");
  if (!host) return new URL(req.url).origin;
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}
