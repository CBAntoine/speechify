import "server-only";
import type { AuditResult } from "@/lib/types";
import { crawlSite } from "./crawler";

/**
 * Fetch a business website and list what it has and what it's missing.
 * Goes through Rainmaker's crawler, so it follows robots.txt, falls back to
 * http for sites without HTTPS, and picks up the contact page's email.
 */
export async function auditWebsite(rawUrl: string): Promise<AuditResult> {
  return (await crawlSite(rawUrl)).audit;
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
