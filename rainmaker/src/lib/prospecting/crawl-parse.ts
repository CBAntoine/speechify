// Rainmaker's own crawler: pure helpers, unit tested. The crawler only visits
// businesses' own websites (a homepage, sometimes the contact page), says who
// it is in its User-Agent, and follows each site's robots.txt.

import { nameKey } from "./opendata-parse.ts";

/** The token our robots.txt rules are read for (from our User-Agent). */
export const ROBOTS_AGENT = "rainmakeraudit";

/**
 * Does robots.txt let `agent` fetch `path`? Standard reading: the group for
 * our agent if there is one, else "*"; the longest matching rule wins, and
 * Allow wins a tie. `*` and `$` work as in Google's spec.
 */
export function robotsAllows(robotsTxt: string, path: string, agent = ROBOTS_AGENT): boolean {
  type Rule = { allow: boolean; pattern: string };
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      lastWasAgent = false;
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.toLowerCase().includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: Rule | undefined;
  for (const r of rules) {
    // `*` matches anything; a trailing `$` anchors the end; all else is literal.
    const anchored = r.pattern.endsWith("$");
    const body = (anchored ? r.pattern.slice(0, -1) : r.pattern).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    if (!new RegExp(`^${body}${anchored ? "$" : ""}`).test(path)) continue;
    if (!best || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

/** "(780) 555-0101" for North American numbers; others as written. */
export function formatPhone(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10 && /^[2-9]\d{2}[2-9]/.test(ten)) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return digits.length >= 7 && digits.length <= 15 ? raw.trim() : undefined;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#64;|&commat;/g, "@")
    .replace(/&#46;|&period;/g, ".")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));

/** Visible text: scripts, styles and tags removed. */
export function pageText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

const JUNK_EMAIL = /(example\.(com|org)|sentry|wixpress|godaddy|domain\.com|yourdomain|email\.com|\.(png|jpe?g|gif|webp|svg)$)/i;

export interface Contacts {
  phones: string[];
  emails: string[];
  /** The contact page, same site, when the page links to one. */
  contactUrl?: string;
  /** Street address from the page's structured data. */
  address?: string;
}

/** Phone numbers, emails, the contact page link and the address on a page. */
export function extractContacts(html: string, pageUrl: string): Contacts {
  const phones = new Set<string>();
  const emails = new Set<string>();
  let address: string | undefined;

  for (const m of html.matchAll(/href=["']tel:([^"']+)["']/gi)) {
    const p = formatPhone(decodeURIComponent(m[1]));
    if (p) phones.add(p);
  }
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const e = decodeURIComponent(m[1]).toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !JUNK_EMAIL.test(e)) emails.add(e);
  }

  // Structured data (schema.org LocalBusiness and friends).
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const stack: unknown[] = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      const o = node as Record<string, unknown>;
      if (typeof o.telephone === "string") {
        const p = formatPhone(o.telephone);
        if (p) phones.add(p);
      }
      if (typeof o.email === "string" && /@/.test(o.email) && !JUNK_EMAIL.test(o.email)) emails.add(o.email.replace(/^mailto:/i, "").toLowerCase());
      const a = o.address as Record<string, unknown> | undefined;
      if (!address && a && typeof a === "object" && typeof a.streetAddress === "string") {
        address = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode].filter((x) => typeof x === "string" && x).join(", ");
      }
      for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
    }
  }

  // Numbers and addresses written in the page text.
  const text = pageText(html);
  for (const m of text.matchAll(/(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/g)) {
    if (phones.size >= 5) break;
    phones.add(`(${m[1]}) ${m[2]}-${m[3]}`);
  }
  for (const m of text.matchAll(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g)) {
    if (emails.size >= 5) break;
    const e = m[0].toLowerCase();
    if (!JUNK_EMAIL.test(e)) emails.add(e);
  }

  let contactUrl: string | undefined;
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!/contact/i.test(m[1]) && !/contact/i.test(m[2].replace(/<[^>]+>/g, ""))) continue;
    try {
      const u = new URL(m[1], pageUrl);
      if (u.host === new URL(pageUrl).host && /^https?:$/.test(u.protocol)) {
        contactUrl = u.toString();
        break;
      }
    } catch {
      // not a URL
    }
  }

  return { phones: [...phones].slice(0, 5), emails: [...emails].slice(0, 5), contactUrl, address };
}

// Words that say what a business does or where; a match needs the rest.
const GENERIC = new Set(
  (
    "and of the for a an roofing roofers roofer roof plumbing plumber plumbers heating cooling air conditioning hvac " +
    "mechanical services service solutions systems contracting contractors contractor construction renovations renovation " +
    "home homes group company enterprises enterprise pro pros professional professionals experts expert repair repairs " +
    "dental dentistry clinic centre center care health wellness studio salon spa fitness gym law legal realty real estate " +
    "auto automotive cleaning landscaping lawn pest control veterinary animal hospital physiotherapy accounting tax " +
    "canada ontario alberta quebec bc toronto vancouver calgary edmonton ottawa london city north south east west"
  ).split(" "),
);

/** The words in a business name that set it apart ("Coverall" in "Coverall Roofing Ltd."). */
export function distinctiveWords(name: string): string[] {
  return nameKey(name)
    .split(" ")
    .filter((w) => w.length >= 2 && !GENERIC.has(w));
}

/** Guesses at a business's own domain, best first, from its name. */
export function domainCandidates(name: string, tlds: string[] = ["ca", "com"]): string[] {
  const words = nameKey(name).split(" ").filter(Boolean);
  if (!words.length || !distinctiveWords(name).length) return [];
  const joined = words.join("");
  const hyphen = words.join("-");
  const noAnd = words.filter((w) => w !== "and").join("");
  const slugs = [...new Set([joined, hyphen, noAnd])].filter((s) => s.length >= 5 && s.length <= 40);
  return slugs.flatMap((s) => tlds.map((t) => `${s}.${t}`)).slice(0, 6);
}

const PARKED =
  /(domain (name )?(is )?for sale|buy this domain|this domain (may be|is) (for sale|available)|parked (free|domain)|domain parking|hugedomains|sedoparking|sedo\.com|afternic|dan\.com|godaddy\.com\/domainsearch|future home of|coming soon|under construction|account suspended|default web site page|it works!|index of \/)/i;

/** Is this page the business's own site (and not a parked or placeholder page)? */
export function pageIsBusiness(html: string, name: string, opts: { phone?: string } = {}): boolean {
  const text = pageText(html);
  if (text.length < 200 || PARKED.test(text.slice(0, 4000))) return false;
  const lower = text.toLowerCase();
  const words = distinctiveWords(name);
  // Whole words, so "mt" doesn't match inside another word.
  if (words.length && words.every((w) => new RegExp(`\\b${w}\\b`).test(lower))) return true;
  const digits = opts.phone?.replace(/\D/g, "").slice(-10);
  return !!digits && digits.length === 10 && text.replace(/\D/g, "").includes(digits);
}
