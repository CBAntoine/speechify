import { getNiche } from "../niches.ts";
import type { DemoSite } from "../providers/places/google.ts";
import type { SiteAudit, WebsiteState } from "../types.ts";
import { errorMessage } from "../util.ts";

// The Scout's website check. One polite request per business (two when we
// look for a published email on the contact page), robots.txt respected.
// `analyzeHtml` is pure so it's unit tested; `auditWebsite` does the network.

export const USER_AGENT = "MainstreetBot/1.0 (website check for a small-business web designer)";

const SOCIAL_HOSTS = /(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|yelp\.com|yelp\.ca|linktr\.ee|linkin\.bio|tiktok\.com|nextdoor\.com|x\.com|twitter\.com|youtube\.com|linkedin\.com|google\.com|goo\.gl|g\.page|maps\.app\.goo\.gl|homeadvisor\.com|angi\.com|houzz\.com|thumbtack\.com|bbb\.org|yellowpages\.(com|ca)|booksy\.com|vagaro\.com|fresha\.com|square\.site|squareup\.com|toasttab\.com|ubereats\.com|doordash\.com|opentable\.com)$/i;
const DEAD_HOSTS = /(^|\.)business\.site$/i; // Google Business Profile websites, shut down in 2024
const FREE_SUBDOMAIN = /(^|\.)(wixsite\.com|weebly\.com|godaddysites\.com|wordpress\.com|blogspot\.com|sites\.google\.com|webs\.com|jimdosite\.com|square\.site)$/i;

const OLD_GENERATORS = /(frontpage|dreamweaver|iweb|microsoft word|adobe muse|publisher|netobjects|homestead|intuit|web\.com sitebuilder|joomla! 1\.|wordpress [1-4]\.)/i;

const BOOKING = /(calendly\.com|acuityscheduling\.com|as\.me\/|squareup\.com\/appointments|square\.site\/book|vagaro\.com|mindbodyonline|zocdoc\.com|localmed\.com|nexhealth\.com|booksy\.com|fresha\.com|joinblvd\.com|setmore\.com|simplybook|housecallpro\.com|servicetitan\.com|getjobber\.com|opentable\.com|resy\.com|exploretock\.com|janeapp\.com|wix-bookings|schedulicity|genbook|appointy|10to8|youcanbook\.me|patientpop|lighthouse360|solutionreach|dentrix|weave\.com)/i;
const BOOKING_TEXT = /\b(book (an |your )?(appointment|online|now|a visit|a table)|schedule (an |your )?(appointment|online|service|now)|request (an |a )?(appointment|quote|estimate)|reserve (a table|now)|get a (free )?(quote|estimate))\b/i;
const NO_SOLICIT =
  /\b(no (solicitation|soliciting|solicitors)|do not (send|email) (us )?(any )?(unsolicited|commercial|marketing)|unsolicited (emails?|offers?|solicitations?|messages?) (are |will )?(not (be )?(accepted|welcome|answered)|ignored)|not accepting (vendor|sales) (calls|emails|solicitations))\b/i;
const PARKED = /(this domain (is|may be) for sale|buy this domain|domain (has )?expired|parked (free|domain)|sedoparking|hugedomains|dan\.com|afternic|godaddy\.com\/(domains|park)|this site can.?t be reached|account (has been )?suspended|website (is )?(coming soon|under construction))/i;

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function first(re: RegExp, s: string): string | undefined {
  const m = re.exec(s);
  return m?.[1] ? decode(m[1].replace(/\s+/g, " ").trim()) || undefined : undefined;
}

function hex6(c: string): string | undefined {
  const m = c.trim().toLowerCase().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return undefined;
  return `#${m[1].length === 3 ? m[1].split("").map((x) => x + x).join("") : m[1]}`;
}

function brandish(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b) >= 40 && Math.max(r, g, b) >= 50;
}

function brandColors(html: string): string[] {
  const out: string[] = [];
  const add = (c?: string) => c && brandish(c) && !out.includes(c) && out.push(c);
  add(hex6(first(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i, html) ?? ""));
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const c = hex6(m[0]);
    if (c && brandish(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  for (const [c] of [...counts].sort((a, b) => b[1] - a[1])) add(c);
  return out.slice(0, 3);
}

function visibleText(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function findEmails(html: string): string[] {
  const set = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) set.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of visibleText(html).matchAll(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi)) set.add(m[0].toLowerCase());
  return [...set].filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e) && !/\.(png|jpe?g|gif|webp|svg)$/i.test(e) && !/(sentry|wixpress|example\.com|domain\.com|email\.com)/i.test(e)).slice(0, 5);
}

export interface AnalyzeInput {
  html: string;
  url?: string;
  finalUrl?: string;
  status?: number;
  responseMs?: number;
  headers?: Record<string, string>;
  niche?: string;
  now?: Date;
}

export function analyzeHtml(input: AnalyzeInput): SiteAudit {
  const { html } = input;
  const now = input.now ?? new Date();
  const year = now.getFullYear();
  const target = input.finalUrl ?? input.url ?? "";
  const text = visibleText(html);

  const years: number[] = [];
  for (const m of html.matchAll(/(?:©|&copy;|&#169;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)) {
    const y = Number(m[1]);
    if (y > 1995 && y <= year + 1) years.push(y);
  }
  const copyrightYear = years.length ? Math.max(...years) : undefined;
  const generator = first(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)["']/i, html) ?? first(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']generator["']/i, html);

  const oldTech: string[] = [];
  if (/\.swf\b|application\/x-shockwave-flash|<embed[^>]+flash/i.test(html)) oldTech.push("Adobe Flash");
  if (/<frameset|<frame\s/i.test(html)) oldTech.push("frames");
  const jq = /jquery[.-]?(1\.[0-8](?:\.\d+)?)(?:\.min)?\.js/i.exec(html) ?? /jquery\/(1\.[0-8](?:\.\d+)?)\//i.exec(html);
  if (jq) oldTech.push(`jQuery ${jq[1]}`);
  if ((html.match(/<font[\s>]/gi) ?? []).length >= 3) oldTech.push("<font> tags");
  if ((html.match(/<table/gi) ?? []).length >= 6 && /bgcolor=|cellpadding=/i.test(html)) oldTech.push("table layout");
  if (/<marquee|<blink/i.test(html)) oldTech.push("<marquee>");
  if (/best viewed (in|with)|internet explorer/i.test(text)) oldTech.push("'best viewed in' notice");
  if (/visitor (counter|number)|you are visitor/i.test(text)) oldTech.push("visitor counter");
  if (generator && OLD_GENERATORS.test(generator)) oldTech.push(generator.slice(0, 40));

  const phones = [...new Set((html.match(/href=["']tel:([^"']+)["']/gi) ?? []).map((m) => m.replace(/href=["']tel:/i, "").replace(/["']$/, "")))].slice(0, 5);
  const booking = [...new Set((html.match(new RegExp(BOOKING.source, "gi")) ?? []).map((s) => s.toLowerCase()))].slice(0, 3);
  if (!booking.length && BOOKING_TEXT.test(text)) booking.push("booking link or form");
  const hasForm = /<form[\s>]/i.test(html) && /type=["']email["']|name=["'][^"']*(email|phone|message)[^"']*["']/i.test(html);
  const fb = first(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|plugins|tr\b|dialog)[^"'?#\s]+)/i, html);
  const ig = first(/href=["'](https?:\/\/(?:www\.)?instagram\.com\/[^"'?#\s]+)/i, html);
  const yelp = first(/href=["'](https?:\/\/(?:www\.)?yelp\.(?:com|ca)\/biz\/[^"'?#\s]+)/i, html);
  const parked = PARKED.test(text.slice(0, 4000)) && text.length < 4000;

  const audit: SiteAudit = {
    url: input.url,
    finalUrl: input.finalUrl,
    fetchedAt: now.toISOString(),
    reachable: input.status !== undefined && input.status < 400,
    status: input.status,
    https: target.startsWith("https://"),
    responseMs: input.responseMs,
    bytes: html.length,
    title: first(/<title[^>]*>([\s\S]*?)<\/title>/i, html)?.slice(0, 160),
    description: (first(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html) ?? first(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i, html))?.slice(0, 300),
    mobileViewport: /<meta[^>]+name=["']viewport["'][^>]*width=device-width/i.test(html),
    copyrightYear,
    generator,
    cms: /wp-content|wp-includes/i.test(html) ? "WordPress" : /wixstatic|_wixCssImports/i.test(html) ? "Wix" : /squarespace/i.test(html) ? "Squarespace" : /img1\.wsimg\.com/i.test(html) ? "GoDaddy Website Builder" : /weebly|editmysite/i.test(html) ? "Weebly" : undefined,
    oldTech,
    booking,
    hasClickToCall: phones.length > 0,
    hasContactForm: hasForm || /hsforms|jotform|typeform|wufoo|formstack|gravityforms|wpforms|formspree/i.test(html),
    emails: findEmails(html),
    phones,
    socials: { facebook: fb, instagram: ig, yelp },
    noSolicitation: NO_SOLICIT.test(text),
    brandColors: brandColors(html),
    parked,
    findings: [],
  };
  audit.findings = findingsFor(audit, { niche: input.niche, now, freeSubdomain: FREE_SUBDOMAIN.test(hostOf(target)) });
  return audit;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function findingsFor(a: SiteAudit, opts: { niche?: string; now: Date; freeSubdomain?: boolean }): string[] {
  const f: string[] = [];
  const year = opts.now.getFullYear();
  if (a.parked) f.push("The domain shows a parked or 'for sale' page instead of the business.");
  if (!a.mobileViewport) f.push("No mobile layout: on a phone it shows a shrunken desktop page.");
  if (a.copyrightYear && a.copyrightYear <= year - 3) f.push(`The footer still says © ${a.copyrightYear}.`);
  if (!a.https) f.push("No HTTPS, so browsers label it 'Not secure'.");
  for (const t of a.oldTech) f.push(t === "Adobe Flash" ? "Parts of it are built in Adobe Flash, which no browser runs anymore." : `Built with old technology (${t}).`);
  if (a.responseMs && a.responseMs > 3500) f.push(`The homepage took ${(a.responseMs / 1000).toFixed(1)} seconds to load.`);
  if (opts.niche && getNiche(opts.niche).booking && !a.booking.length) f.push("There's no way to book online.");
  if (!a.hasClickToCall) f.push("The phone number isn't tappable on mobile.");
  if (!a.description) f.push("No search description, so Google writes its own snippet.");
  if (opts.freeSubdomain) f.push("It's on a free website-builder address rather than its own domain.");
  return f;
}

/** Decide what kind of opportunity the site is. */
export function websiteStateFor(a: SiteAudit, now = new Date()): WebsiteState {
  if (!a.reachable || a.parked) return "dead";
  const year = now.getFullYear();
  const strong = [
    !a.mobileViewport,
    a.copyrightYear !== undefined && a.copyrightYear <= year - 6,
    a.oldTech.some((t) => /flash|frames|<font>|table layout|marquee/i.test(t)),
    a.generator !== undefined && OLD_GENERATORS.test(a.generator),
    !a.https,
  ].filter(Boolean).length;
  if (strong >= 2) return "outdated";
  if (strong === 1 && !a.mobileViewport) return "outdated";
  const weak = [
    strong === 1,
    a.findings.some((x) => x.startsWith("There's no way to book")),
    !a.hasClickToCall,
    !a.hasContactForm,
    (a.responseMs ?? 0) > 3500,
    !a.description,
    a.copyrightYear !== undefined && a.copyrightYear <= year - 3,
  ].filter(Boolean).length;
  return weak >= 3 ? "weak" : "modern";
}

async function robotsAllows(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(6000), redirect: "follow" });
    if (!res.ok) return true;
    const txt = (await res.text()).slice(0, 50_000);
    let applies = false;
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trim();
      const [k, ...rest] = line.split(":");
      const v = rest.join(":").trim();
      if (/^user-agent$/i.test(k)) applies = v === "*" || /mainstreet/i.test(v);
      else if (applies && /^disallow$/i.test(k) && v === "/") return false;
    }
    return true;
  } catch {
    return true;
  }
}

async function getHtml(url: string): Promise<{ html: string; status: number; finalUrl: string; ms: number; headers: Record<string, string> }> {
  const started = Date.now();
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });
  const reader = res.body?.getReader();
  let html = "";
  if (reader) {
    const dec = new TextDecoder();
    for (let total = 0; total < 1_500_000; ) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      html += dec.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {});
  }
  return { html, status: res.status, finalUrl: res.url || url, ms: Date.now() - started, headers: Object.fromEntries(res.headers) };
}

export interface AuditOutcome {
  state: WebsiteState;
  audit?: SiteAudit;
}

export async function auditWebsite(rawUrl: string | undefined, opts: { niche?: string; now?: Date } = {}): Promise<AuditOutcome> {
  const now = opts.now ?? new Date();
  if (!rawUrl) return { state: "none" };
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  const host = hostOf(url);
  const base = (findings: string[], extra: Partial<SiteAudit> = {}): SiteAudit => ({
    url,
    fetchedAt: now.toISOString(),
    reachable: false,
    https: url.startsWith("https://"),
    mobileViewport: false,
    oldTech: [],
    booking: [],
    hasClickToCall: false,
    hasContactForm: false,
    emails: [],
    phones: [],
    socials: {},
    noSolicitation: false,
    brandColors: [],
    parked: false,
    findings,
    ...extra,
  });
  if (DEAD_HOSTS.test(host)) return { state: "dead", audit: base(["The website link goes to a Google Business Profile site, and Google shut those down in 2024."]) };
  if (SOCIAL_HOSTS.test(host)) {
    const where = /facebook|fb\./.test(host) ? "a Facebook page" : /instagram/.test(host) ? "an Instagram profile" : /yelp/.test(host) ? "a Yelp listing" : /google|goo\.gl|g\.page/.test(host) ? "a Google Maps listing" : "a profile on another site";
    return { state: "social_only", audit: base([`The "website" on their Google listing is ${where}, not a site they own.`], { reachable: true, socials: /facebook|fb\./.test(host) ? { facebook: url } : /instagram/.test(host) ? { instagram: url } : {} }) };
  }

  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { state: "dead", audit: base(["The website address on their listing isn't a valid link."]) };
  }
  if (!(await robotsAllows(origin))) return { state: "weak", audit: base(["Their robots.txt asks bots not to visit, so we didn't check the site."], { reachable: true }) };

  let page: Awaited<ReturnType<typeof getHtml>>;
  try {
    page = await getHtml(url);
  } catch (err) {
    const msg = errorMessage(err);
    if (url.startsWith("https://") && /cert|ssl|tls|self.signed|expired/i.test(msg)) {
      try {
        page = await getHtml(url.replace(/^https:/, "http:"));
        const a = analyzeHtml({ html: page.html, url, finalUrl: page.finalUrl, status: page.status, responseMs: page.ms, headers: page.headers, niche: opts.niche, now });
        a.findings.unshift("Its HTTPS certificate is broken or expired, so browsers show a security warning.");
        return { state: "outdated", audit: a };
      } catch {
        /* fall through to dead */
      }
    }
    const why = /ENOTFOUND|EAI_AGAIN/i.test(msg) ? "The domain no longer exists (it doesn't resolve)." : /timeout|abort/i.test(msg) ? "The site didn't load within 12 seconds." : `The site doesn't load (${msg.slice(0, 80)}).`;
    return { state: "dead", audit: base([why], { error: msg }) };
  }
  if (page.status >= 400) return { state: "dead", audit: base([`The site returns an error page (HTTP ${page.status}).`], { status: page.status, finalUrl: page.finalUrl }) };

  const audit = analyzeHtml({ html: page.html, url, finalUrl: page.finalUrl, status: page.status, responseMs: page.ms, headers: page.headers, niche: opts.niche, now });
  if (!audit.emails.length) {
    for (const p of ["/contact", "/contact-us", "/contact.html"]) {
      try {
        const c = await getHtml(new URL(p, page.finalUrl).href);
        if (c.status < 400) {
          audit.emails = findEmails(c.html);
          if (NO_SOLICIT.test(visibleText(c.html))) audit.noSolicitation = true;
          if (audit.emails.length) {
            audit.emailPage = c.finalUrl;
            break;
          }
        }
      } catch {
        /* next */
      }
    }
  }
  return { state: websiteStateFor(audit, now), audit };
}

/** Demo mode: a believable audit for a fictional site, without any network. */
export function demoAudit(site: DemoSite, website: string | undefined, niche: string, now = new Date()): AuditOutcome {
  if (site.state === "none" || !website) return { state: "none" };
  const fake = (over: Partial<SiteAudit>): SiteAudit => ({
    url: website,
    finalUrl: website,
    fetchedAt: now.toISOString(),
    reachable: true,
    status: 200,
    https: false,
    responseMs: 900,
    mobileViewport: true,
    oldTech: [],
    booking: [],
    hasClickToCall: false,
    hasContactForm: false,
    emails: site.email ? [site.email] : [],
    phones: [],
    socials: {},
    noSolicitation: false,
    brandColors: [],
    parked: false,
    findings: [],
    ...over,
  });
  if (site.state === "social_only") return { state: "social_only", audit: fake({ socials: { facebook: website }, findings: ['The "website" on their Google listing is a Facebook page, not a site they own.'] }) };
  if (site.state === "dead") return { state: "dead", audit: fake({ reachable: false, status: undefined, findings: ["The domain no longer exists (it doesn't resolve)."] }) };
  if (site.state === "outdated") {
    const a = fake({ mobileViewport: false, copyrightYear: site.copyrightYear, responseMs: 4200, oldTech: site.copyrightYear && site.copyrightYear < 2013 ? ["table layout", "<font> tags"] : ["jQuery 1.7.2"] });
    a.findings = findingsFor(a, { niche, now });
    return { state: "outdated", audit: a };
  }
  if (site.state === "weak") {
    const a = fake({ https: true, copyrightYear: site.copyrightYear, responseMs: 3900, description: undefined });
    a.findings = findingsFor(a, { niche, now });
    return { state: "weak", audit: a };
  }
  const a = fake({ https: true, copyrightYear: site.copyrightYear, booking: ["calendly.com"], hasClickToCall: true, hasContactForm: true, description: "A modern site", responseMs: 700 });
  a.findings = findingsFor(a, { niche, now });
  return { state: "modern", audit: a };
}
