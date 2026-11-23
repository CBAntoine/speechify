import "server-only";
import { normalizeUrl, safeFetchText } from "@/lib/net";
import { mapLimit } from "@/lib/prospecting/audit";
import { robotsAllowed } from "@/lib/prospecting/crawler";
import { buildKbText, extractBrand, extractFaqs, pageContent, pageLinks, rankPages, serviceNames, type Brand, type Faq, type PageText } from "./site-kb-parse";

// Reads a business's website into the AI guide's knowledge base: the homepage
// and its most useful pages (services, pricing, FAQs, booking, contact).
// Same crawler rules as everywhere in Rainmaker: it says who it is and
// follows robots.txt. A site that asks bots to stay out isn't read.

export class SiteScanError extends Error {
  constructor(
    message: string,
    readonly blocked = false
  ) {
    super(message);
  }
}

export interface SiteScan {
  home: string;
  pages: { url: string; title?: string }[];
  faqs: Faq[];
  brand: Brand;
  services: string[];
  /** The knowledge base text. */
  text: string;
}

export async function scanSite(website: string, opts: { business: string; facts: string[]; maxPages?: number; budgetMs?: number }): Promise<SiteScan> {
  const home = normalizeUrl(website);
  if (!home) throw new SiteScanError("That website address doesn't look right.");
  if (!(await robotsAllowed(home))) {
    throw new SiteScanError("This website asks automated visitors not to read it (robots.txt), so Rainmaker won't scan it. Ask the owner for access, or paste the details the guide should know.", true);
  }
  let first: Awaited<ReturnType<typeof safeFetchText>>;
  try {
    first = await safeFetchText(home, { timeoutMs: 12_000, maxBytes: 2_000_000 });
  } catch (err) {
    throw new SiteScanError(`Couldn't open ${home}: ${err instanceof Error ? err.message : String(err)}.`);
  }
  if (first.status >= 400) throw new SiteScanError(`${home} answered with an error (HTTP ${first.status}).`);

  const deadline = Date.now() + (opts.budgetMs ?? 25_000);
  const links = pageLinks(first.body, first.finalUrl);
  const pages: PageText[] = [pageContent(first.body, first.finalUrl)];
  const faqs: Faq[] = extractFaqs(first.body);
  const more = await mapLimit(rankPages(links, first.finalUrl, opts.maxPages ?? 10), 4, async (url) => {
    if (Date.now() > deadline || !(await robotsAllowed(url))) return undefined;
    try {
      const r = await safeFetchText(url, { timeoutMs: 8_000, maxBytes: 1_500_000 });
      if (r.status >= 400 || !/html/i.test(r.headers["content-type"] ?? "text/html")) return undefined;
      return { page: pageContent(r.body, r.finalUrl), faqs: extractFaqs(r.body) };
    } catch {
      return undefined;
    }
  });
  for (const r of more) {
    if (!r) continue;
    pages.push(r.page);
    for (const f of r.faqs) if (!faqs.some((x) => x.q.toLowerCase() === f.q.toLowerCase()) && faqs.length < 30) faqs.push(f);
  }
  return {
    home: first.finalUrl,
    pages: pages.map((p) => ({ url: p.url, title: p.title })),
    faqs,
    brand: extractBrand(first.body, first.finalUrl),
    services: serviceNames(links),
    text: buildKbText({ business: opts.business, facts: opts.facts, faqs, pages }),
  };
}
