import "server-only";
import { normalizeUrl, safeFetchText } from "@/lib/net";
import { analyzeHtml } from "./analyze";
import type { AuditResult } from "@/lib/types";

const cache = ((globalThis as { __rmAuditCache?: Map<string, { at: number; result: AuditResult }> }).__rmAuditCache ??=
  new Map());
const TTL = 60 * 60 * 1000;
const FAIL_TTL = 2 * 60 * 1000;

function failed(url: string | undefined, error: string): AuditResult {
  return {
    url,
    fetchedAt: new Date().toISOString(),
    reachable: false,
    https: false,
    mobileViewport: false,
    analytics: [],
    pixels: [],
    booking: [],
    chat: [],
    reviewsWidgets: [],
    hasContactForm: false,
    hasClickToCall: false,
    hasSchema: false,
    hasOgImage: false,
    socials: [],
    emails: [],
    phones: [],
    error,
  };
}

/** Fetch a business website and list what it has and what it's missing. */
export async function auditWebsite(rawUrl: string): Promise<AuditResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) return failed(rawUrl, "Not a valid web address");
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < (hit.result.reachable ? TTL : FAIL_TTL)) return hit.result;

  let result: AuditResult;
  try {
    const res = await safeFetchText(url);
    result = analyzeHtml({ html: res.body, url, finalUrl: res.finalUrl, status: res.status, responseMs: res.ms, headers: res.headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Some small-business sites only work over plain http. Try that before
    // calling the site down, so the audit reports "no HTTPS" instead.
    if (url.startsWith("https://")) {
      try {
        const httpUrl = `http://${url.slice("https://".length)}`;
        const res = await safeFetchText(httpUrl);
        result = analyzeHtml({ html: res.body, url: httpUrl, finalUrl: res.finalUrl, status: res.status, responseMs: res.ms, headers: res.headers });
      } catch {
        result = failed(url, msg);
      }
    } else {
      result = failed(url, msg);
    }
  }
  cache.set(url, { at: Date.now(), result });
  return result;
}

/** Run async work over items with a concurrency limit, keeping order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
