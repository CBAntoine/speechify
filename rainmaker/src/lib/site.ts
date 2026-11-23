import "server-only";

// The public address of this deployment, for checkout return links, webhook
// URLs and links in emails. SITE_URL wins; on Vercel the production domain
// is used; otherwise the address the request came in on.

function trim(u: string): string {
  return u.replace(/\/+$/, "");
}

export function siteUrlFrom(headers: Pick<Headers, "get">, fallbackUrl?: string): string {
  const env = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return trim(env);
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (host) {
    const proto = headers.get("x-forwarded-proto") ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
    return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
  }
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (fallbackUrl) return new URL(fallbackUrl).origin;
  return "http://localhost:3100";
}

export function siteUrl(req: Request): string {
  return siteUrlFrom(req.headers, req.url);
}

/** For background work with no request (cron, after()): SITE_URL or the Vercel domain. */
export function siteUrlStatic(): string | undefined {
  const env = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return trim(env);
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return undefined;
}
