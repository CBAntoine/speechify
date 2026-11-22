// Pure HTML analysis for the website audit. No network, no imports at runtime,
// so it can be unit tested directly.

import type { AuditResult } from "../types.ts";

type Detector = { name: string; re: RegExp };

const ANALYTICS: Detector[] = [
  { name: "Google Analytics 4", re: /gtag\/js\?id=G-|gtag\(\s*['"]config['"]\s*,\s*['"]G-/i },
  { name: "Google Tag Manager", re: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/i },
  { name: "Universal Analytics (retired)", re: /google-analytics\.com\/analytics\.js|['"]UA-\d{4,}-\d+['"]/i },
  { name: "Microsoft Clarity", re: /clarity\.ms\/tag/i },
  { name: "Hotjar", re: /static\.hotjar\.com|hotjar\.com\/c\/hotjar/i },
  { name: "Plausible", re: /plausible\.io\/js/i },
];

const PIXELS: Detector[] = [
  { name: "Meta Pixel", re: /connect\.facebook\.net\/[^"']*\/fbevents\.js|fbq\(\s*['"]init['"]/i },
  { name: "Google Ads tag", re: /googleadservices\.com|gtag\/js\?id=AW-|['"]AW-\d{6,}/i },
  { name: "TikTok Pixel", re: /analytics\.tiktok\.com/i },
  { name: "LinkedIn Insight", re: /snap\.licdn\.com/i },
  { name: "Microsoft Ads (UET)", re: /bat\.bing\.com/i },
  { name: "Snap Pixel", re: /sc-static\.net\/scevent/i },
  { name: "Nextdoor Pixel", re: /ads\.nextdoor\.com/i },
];

const BOOKING: Detector[] = [
  { name: "Calendly", re: /calendly\.com/i },
  { name: "Acuity", re: /acuityscheduling\.com|as\.me\//i },
  { name: "Square Appointments", re: /squareup\.com\/appointments|square\.site\/book/i },
  { name: "Vagaro", re: /vagaro\.com/i },
  { name: "Mindbody", re: /mindbodyonline\.com|healcode/i },
  { name: "Zocdoc", re: /zocdoc\.com/i },
  { name: "LocalMed", re: /localmed\.com/i },
  { name: "NexHealth", re: /nexhealth\.com/i },
  { name: "Booksy", re: /booksy\.com/i },
  { name: "Fresha", re: /fresha\.com/i },
  { name: "Boulevard", re: /joinblvd\.com|blvd\.co/i },
  { name: "Setmore", re: /setmore\.com/i },
  { name: "SimplyBook", re: /simplybook\.(me|it)/i },
  { name: "Housecall Pro", re: /housecallpro\.com/i },
  { name: "ServiceTitan", re: /servicetitan\.com|scheduler\.servicetitan/i },
  { name: "Jobber", re: /getjobber\.com|clienthub\.getjobber/i },
  { name: "OpenTable", re: /opentable\.com/i },
  { name: "Resy", re: /resy\.com/i },
  { name: "Tock", re: /exploretock\.com/i },
  { name: "Toast online ordering", re: /toasttab\.com/i },
  { name: "Glofox", re: /glofox\.com/i },
  { name: "Wix Bookings", re: /wix-bookings|bookings\.wix/i },
  { name: "Jane App", re: /janeapp\.com/i },
  { name: "ChiroTouch / Patient portal", re: /chirotouch|patientportal/i },
];

const CHAT: Detector[] = [
  { name: "Intercom", re: /widget\.intercom\.io|intercomcdn/i },
  { name: "Drift", re: /js\.driftt\.com|drift\.com\/include/i },
  { name: "Tidio", re: /code\.tidio\.co/i },
  { name: "LiveChat", re: /cdn\.livechatinc\.com/i },
  { name: "tawk.to", re: /embed\.tawk\.to/i },
  { name: "Crisp", re: /client\.crisp\.chat/i },
  { name: "Zendesk chat", re: /static\.zdassets\.com|zopim/i },
  { name: "Podium", re: /podium\.com\/widget|connect\.podium/i },
  { name: "Birdeye webchat", re: /birdeye\.com\/embed|widgets\.birdeye/i },
  { name: "HubSpot chat", re: /js\.hs-scripts\.com|js\.usemessages\.com/i },
  { name: "Olark", re: /static\.olark\.com/i },
  { name: "Freshchat", re: /wchat\.freshchat\.com/i },
  { name: "Smith.ai", re: /smith\.ai/i },
  { name: "LeadConnector (GoHighLevel)", re: /leadconnectorhq\.com|msgsndr\.com/i },
];

const REVIEWS: Detector[] = [
  { name: "Birdeye", re: /birdeye\.com/i },
  { name: "Podium reviews", re: /podium\.com\/reviews/i },
  { name: "Trustindex", re: /trustindex\.io/i },
  { name: "Elfsight reviews", re: /elfsight\.com|apps\.elfsight/i },
  { name: "NiceJob", re: /nicejob\.co/i },
  { name: "Grade.us", re: /grade\.us/i },
];

const CMS: Detector[] = [
  { name: "GoHighLevel site", re: /leadconnectorhq\.com|msgsndr\.com/i },
  { name: "Wix", re: /static\.wixstatic\.com|_wixCssImports|wix-code|X-Wix-/i },
  { name: "Squarespace", re: /static1\.squarespace\.com|squarespace-cdn/i },
  { name: "Shopify", re: /cdn\.shopify\.com/i },
  { name: "Webflow", re: /data-wf-site|website-files\.com/i },
  { name: "GoDaddy Website Builder", re: /img1\.wsimg\.com/i },
  { name: "Duda", re: /multiscreensite\.com|dudamobile|irp\.cdn-website\.com/i },
  { name: "Weebly", re: /weebly\.com|editmysite\.com/i },
  { name: "WordPress", re: /wp-content|wp-includes/i },
];

const SOCIALS: Detector[] = [
  { name: "Facebook", re: /facebook\.com\/(?!tr\b|plugins|sharer|dialog)[A-Za-z0-9.\-_]+/i },
  { name: "Instagram", re: /instagram\.com\/[A-Za-z0-9._]+/i },
  { name: "TikTok", re: /tiktok\.com\/@[A-Za-z0-9._]+/i },
  { name: "YouTube", re: /youtube\.com\/(@|channel\/|c\/|user\/)/i },
  { name: "LinkedIn", re: /linkedin\.com\/(company|in)\//i },
  { name: "X / Twitter", re: /(?:twitter|x)\.com\/[A-Za-z0-9_]{2,}/i },
  { name: "Yelp", re: /yelp\.com\/biz\//i },
  { name: "Google reviews link", re: /g\.page\/|search\.google\.com\/local\/writereview|maps\.app\.goo\.gl/i },
];

function detect(list: Detector[], haystack: string): string[] {
  const out: string[] = [];
  for (const d of list) if (d.re.test(haystack)) out.push(d.name);
  return out;
}

function firstMatch(re: RegExp, s: string): string | undefined {
  const m = re.exec(s);
  return m?.[1]?.replace(/\s+/g, " ").trim() || undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

const SCHEMA_TYPES =
  /"@type"\s*:\s*"(LocalBusiness|Dentist|MedicalBusiness|MedicalClinic|HealthAndBeautyBusiness|DaySpa|BeautySalon|HairSalon|HomeAndConstructionBusiness|RoofingContractor|HVACBusiness|Plumber|Electrician|LegalService|Attorney|RealEstateAgent|ExerciseGym|SportsActivityLocation|Restaurant|FoodEstablishment|AutoRepair|AutomotiveBusiness|ProfessionalService|AccountingService|VeterinaryCare|Physician|MedicalOrganization|LodgingBusiness|Store|Organization)"/i;

export interface AnalyzeInput {
  html: string;
  url?: string;
  finalUrl?: string;
  status?: number;
  responseMs?: number;
  headers?: Record<string, string>;
  now?: Date;
}

/** Turn a page's HTML into audit facts. */
function hex6(c: string): string | undefined {
  const m = c.trim().toLowerCase().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!m) return undefined;
  const h = m[1];
  return `#${h.length === 3 ? h.split("").map((x) => x + x).join("") : h}`;
}

/** Saturation-ish check: drop whites, blacks and greys, which say nothing about a brand. */
function isBrandish(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max - min >= 40 && max >= 50;
}

/**
 * The site's brand colours: theme-color first, then the most used colourful
 * hex values in its inline CSS. Used to make ad art and creative cards that
 * match the business.
 */
export function brandColors(html: string, max = 3): string[] {
  const out: string[] = [];
  const add = (c?: string) => {
    if (c && isBrandish(c) && !out.includes(c)) out.push(c);
  };
  add(hex6(firstMatch(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i, html) ?? ""));
  add(hex6(firstMatch(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i, html) ?? ""));
  add(hex6(firstMatch(/<meta[^>]+name=["']msapplication-TileColor["'][^>]+content=["']([^"']+)["']/i, html) ?? ""));
  const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") + [...html.matchAll(/style=["']([^"']+)["']/gi)].map((m) => m[1]).join(";");
  const counts = new Map<string, number>();
  for (const m of css.matchAll(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    const c = hex6(m[0]);
    if (c && isBrandish(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  for (const [c] of [...counts].sort((a, b) => b[1] - a[1])) add(c);
  return out.slice(0, max);
}

export function analyzeHtml(input: AnalyzeInput): AuditResult {
  const { html, url, finalUrl, status, responseMs } = input;
  const now = input.now ?? new Date();
  const headerBlob = Object.entries(input.headers ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const haystack = `${html}\n${headerBlob}`;

  const title = firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, html);
  const description =
    firstMatch(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, html) ??
    firstMatch(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i, html);
  const h1raw = firstMatch(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html);
  const h1 = h1raw ? decodeEntities(h1raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 140) : undefined;

  const years: number[] = [];
  const yearRe = /(?:©|&copy;|&#169;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi;
  let ym: RegExpExecArray | null;
  while ((ym = yearRe.exec(html))) {
    const y = Number(ym[1]);
    if (y > 1995 && y <= now.getFullYear() + 1) years.push(y);
  }
  const copyrightYear = years.length ? Math.max(...years) : undefined;

  const emails = Array.from(
    new Set(
      (html.match(/mailto:([^"'?\s>]+)/gi) ?? [])
        .map((m) => decodeURIComponent(m.slice(7)).toLowerCase())
        .filter((e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(e))
    )
  ).slice(0, 5);
  const phones = Array.from(
    new Set((html.match(/href=["']tel:([^"']+)["']/gi) ?? []).map((m) => m.replace(/href=["']tel:/i, "").replace(/["']$/, "")))
  ).slice(0, 5);

  const hasForm = /<form[\s>]/i.test(html);
  const hasContactInputs = /type=["']email["']|name=["'][^"']*(email|phone|message)[^"']*["']/i.test(html);
  const embeddedForms = /hsforms|jotform|typeform|wufoo|formstack|gravityforms|wpforms|formspree|leadconnectorhq\.com\/widget\/form/i.test(html);

  const target = finalUrl ?? url ?? "";

  return {
    url,
    finalUrl,
    fetchedAt: now.toISOString(),
    reachable: status !== undefined && status < 400,
    https: target.startsWith("https://"),
    status,
    responseMs,
    bytes: html.length,
    title: title ? decodeEntities(title).slice(0, 160) : undefined,
    description: description ? decodeEntities(description).slice(0, 300) : undefined,
    h1,
    mobileViewport: /<meta[^>]+name=["']viewport["'][^>]*width=device-width/i.test(html),
    analytics: detect(ANALYTICS, haystack),
    pixels: detect(PIXELS, haystack),
    booking: detect(BOOKING, haystack).concat(
      /\b(book (an )?(appointment|online|now)|schedule (an )?(appointment|online|now)|request (an )?appointment)\b/i.test(html) &&
        !detect(BOOKING, haystack).length
        ? ["Booking link or form"]
        : []
    ),
    chat: detect(CHAT, haystack),
    reviewsWidgets: detect(REVIEWS, haystack),
    cms: detect(CMS, haystack)[0],
    hasContactForm: (hasForm && hasContactInputs) || embeddedForms,
    hasClickToCall: phones.length > 0,
    hasSchema: SCHEMA_TYPES.test(html),
    hasOgImage: /<meta[^>]+property=["']og:image["']/i.test(html),
    copyrightYear,
    socials: detect(SOCIALS, html),
    emails,
    phones,
    brandColors: brandColors(html),
    ogImage: (() => {
      const raw = firstMatch(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i, html) ?? firstMatch(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i, html);
      if (!raw) return undefined;
      try {
        return new URL(decodeEntities(raw), target || undefined).href;
      } catch {
        return undefined;
      }
    })(),
  };
}
