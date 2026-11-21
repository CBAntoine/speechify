import "server-only";
import { normalizeUrl, safeFetchText } from "@/lib/net";
import type { AuditResult } from "@/lib/types";
import { analyzeHtml } from "./analyze";
import { domainCandidates, extractContacts, pageIsBusiness, robotsAllows, type Contacts } from "./crawl-parse";

// Rainmaker's own crawler. It visits only businesses' own websites: the
// homepage, and the contact page when the homepage has no phone or email.
// It identifies itself (see USER_AGENT in net.ts) and follows robots.txt.

type Cache<T> = Map<string, { at: number; value: T }>;
const g = globalThis as { __rmRobots?: Cache<string | null>; __rmCrawl?: Cache<CrawlResult> };
const robotsCache = (g.__rmRobots ??= new Map());
const crawlCache = (g.__rmCrawl ??= new Map());
const HOUR = 60 * 60_000;

/** robots.txt for a site, cached for an hour. Missing or unreadable means no rules. */
async function robotsTxt(origin: string): Promise<string | null> {
  const hit = robotsCache.get(origin);
  if (hit && Date.now() - hit.at < HOUR) return hit.value;
  let value: string | null = null;
  try {
    const res = await safeFetchText(`${origin}/robots.txt`, { timeoutMs: 4_000, maxBytes: 100_000, maxRedirects: 2 });
    if (res.status < 400 && !/<html/i.test(res.body.slice(0, 500))) value = res.body;
  } catch {
    // No robots.txt we can read: the usual reading is that nothing is off limits.
  }
  robotsCache.set(origin, { at: Date.now(), value });
  return value;
}

export async function robotsAllowed(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const txt = await robotsTxt(u.origin);
    return txt === null || robotsAllows(txt, `${u.pathname}${u.search}` || "/");
  } catch {
    return true;
  }
}

export interface CrawlResult {
  audit: AuditResult;
  contacts: Contacts;
}

function notRead(url: string, error: string, extra: Partial<AuditResult> = {}): AuditResult {
  return {
    url,
    fetchedAt: new Date().toISOString(),
    reachable: false,
    https: url.startsWith("https://"),
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
    ...extra,
  };
}

/** Read a business's site: audit the homepage, collect phone, email and address. */
export async function crawlSite(rawUrl: string): Promise<CrawlResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) return { audit: notRead(rawUrl, "Not a valid web address"), contacts: { phones: [], emails: [] } };
  const hit = crawlCache.get(url);
  if (hit && Date.now() - hit.at < (hit.value.audit.reachable ? HOUR : 2 * 60_000)) return hit.value;

  let result: CrawlResult;
  if (!(await robotsAllowed(url))) {
    result = { audit: notRead(url, "The site asks automated visitors not to read it (robots.txt)", { robotsBlocked: true }), contacts: { phones: [], emails: [] } };
  } else {
    let page: Awaited<ReturnType<typeof safeFetchText>> | undefined;
    let error = "";
    for (const candidate of url.startsWith("https://") ? [url, `http://${url.slice(8)}`] : [url]) {
      try {
        page = await safeFetchText(candidate, { timeoutMs: 9_000, maxBytes: 1_200_000 });
        break;
      } catch (err) {
        error ||= err instanceof Error ? err.message : String(err);
      }
    }
    if (!page) {
      result = { audit: notRead(url, error || "Couldn't load the site"), contacts: { phones: [], emails: [] } };
    } else {
      const audit = analyzeHtml({ html: page.body, url, finalUrl: page.finalUrl, status: page.status, responseMs: page.ms, headers: page.headers });
      const contacts = extractContacts(page.body, page.finalUrl);
      // No phone or email on the homepage: read the contact page too.
      if (audit.reachable && (!contacts.phones.length || !contacts.emails.length) && contacts.contactUrl && (await robotsAllowed(contacts.contactUrl))) {
        try {
          const c = await safeFetchText(contacts.contactUrl, { timeoutMs: 6_000, maxBytes: 800_000 });
          if (c.status < 400) {
            const more = extractContacts(c.body, c.finalUrl);
            contacts.phones = [...new Set([...contacts.phones, ...more.phones])].slice(0, 5);
            contacts.emails = [...new Set([...contacts.emails, ...more.emails])].slice(0, 5);
            contacts.address ??= more.address;
          }
        } catch {
          // The homepage is enough.
        }
      }
      audit.emails = [...new Set([...audit.emails, ...contacts.emails])].slice(0, 5);
      result = { audit, contacts };
    }
  }
  crawlCache.set(url, { at: Date.now(), value: result });
  return result;
}

/**
 * A business's own website, found by trying the domains its name suggests
 * ("Coverall Roofing" → coverallroofing.ca, .com, ...) and keeping the first
 * whose page names the business (or shows its phone) and isn't parked.
 */
export async function findWebsite(name: string, opts: { tlds?: string[]; phone?: string; deadline?: number } = {}): Promise<string | undefined> {
  for (const host of domainCandidates(name, opts.tlds)) {
    if (opts.deadline && Date.now() > opts.deadline) break;
    const url = `https://${host}/`;
    try {
      if (!(await robotsAllowed(url))) continue;
      // safeFetchText resolves the name first, so a guess that doesn't exist fails fast.
      const res = await safeFetchText(url, { timeoutMs: 6_000, maxBytes: 600_000, maxRedirects: 4 });
      if (res.status >= 400) continue;
      if (new URL(res.finalUrl).host !== host && !(await robotsAllowed(res.finalUrl))) continue;
      if (pageIsBusiness(res.body, name, { phone: opts.phone })) return new URL(res.finalUrl).origin + "/";
    } catch {
      // Not this one.
    }
  }
  return undefined;
}
