// Turning a business's website into the AI guide's knowledge base: which
// pages to read, the FAQs and branding on them, and the text the guide
// answers from. Pure helpers, unit tested.

import { pageText } from "../prospecting/crawl-parse.ts";

export interface PageLink {
  url: string;
  text: string;
}

const ASSET = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?|pptx?|ics|xml|json|css|js)(\?|$)/i;

/** Links on a page that stay on the same site, without anchors, files or mailto. */
export function pageLinks(html: string, pageUrl: string): PageLink[] {
  const base = new URL(pageUrl);
  const host = base.host.replace(/^www\./, "");
  const out = new Map<string, PageLink>();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(m[1], base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || u.host.replace(/^www\./, "") !== host || ASSET.test(u.pathname)) continue;
    u.hash = "";
    const url = u.toString();
    if (!out.has(url)) out.set(url, { url, text: m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) });
  }
  return [...out.values()];
}

const WANT: [RegExp, number][] = [
  [/faq|questions/i, 7],
  [/service|what-we-do|solutions|repair|install|maintenance|treatment/i, 6],
  [/pric|rates|cost|fees|quote|estimate/i, 6],
  [/product|shop|catalog|equipment|inventory|menu/i, 5],
  [/book|appointment|schedule|reserve/i, 5],
  [/emergency|24.?7|same.?day/i, 5],
  [/contact|hours|location|visit/i, 4],
  [/area|cities|region|serv(e|ing)/i, 3],
  [/financ|warrant|guarantee|insurance|payment/i, 3],
  [/about|team|story|why/i, 3],
  [/review|testimonial/i, 2],
];
const SKIP = /blog|news|tag\/|category\/|author|login|cart|checkout|account|privacy|terms|cookie|careers|jobs|wp-|feed|sitemap|search|\?/i;

/** The most useful pages to read, best first: services, pricing, FAQs, booking, contact. */
export function rankPages(links: PageLink[], homeUrl: string, max = 10): string[] {
  const home = new URL(homeUrl);
  const scored = links
    .filter((l) => {
      const u = new URL(l.url);
      return u.pathname !== "/" && u.pathname !== home.pathname && !SKIP.test(u.pathname + u.search);
    })
    .map((l) => {
      const u = new URL(l.url);
      const hay = `${u.pathname} ${l.text}`;
      const score = WANT.reduce((s, [re, w]) => (re.test(hay) ? s + w : s), 0) - u.pathname.split("/").filter(Boolean).length;
      return { url: l.url, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return [...new Set(scored.map((x) => x.url))].slice(0, max);
}

const strip = (s: string) => pageText(s).replace(/\s+/g, " ").trim();

export interface Faq {
  q: string;
  a: string;
}

/** Questions the site answers: FAQPage structured data, then headings and summaries that end in "?". */
export function extractFaqs(html: string, max = 20): Faq[] {
  const out: Faq[] = [];
  const seen = new Set<string>();
  const add = (q: string, a: string) => {
    const qq = q.replace(/\s+/g, " ").trim();
    const aa = a.replace(/\s+/g, " ").trim().slice(0, 500);
    const key = qq.toLowerCase();
    if (qq.length < 8 || qq.length > 200 || !aa || seen.has(key) || out.length >= max) return;
    seen.add(key);
    out.push({ q: qq, a: aa });
  };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const stack: unknown[] = [JSON.parse(m[1].trim())];
      while (stack.length) {
        const n = stack.pop();
        if (!n || typeof n !== "object") continue;
        if (Array.isArray(n)) {
          stack.push(...n);
          continue;
        }
        const o = n as Record<string, unknown>;
        if (o["@type"] === "Question" && typeof o.name === "string") {
          const ans = o.acceptedAnswer as { text?: unknown } | undefined;
          if (typeof ans?.text === "string") add(o.name, strip(ans.text));
        }
        for (const v of Object.values(o)) if (v && typeof v === "object") stack.push(v);
      }
    } catch {
      // not JSON
    }
  }
  const body = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ");
  for (const m of body.matchAll(/<(h[2-6]|summary|dt|strong|button)\b[^>]*>([\s\S]*?)<\/\1>([\s\S]{0,1500}?)(?=<(h[1-6]|summary|dt)\b|$)/gi)) {
    const q = strip(m[2]);
    if (q.endsWith("?")) add(q, strip(m[3]));
  }
  return out;
}

export interface Brand {
  name?: string;
  color?: string;
  /** Their logo, or failing that their site icon. */
  logo?: string;
  /** The picture they share links with (og:image), often a hero photo. */
  image?: string;
  headline?: string;
  tagline?: string;
}

const HEX = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

function rgbOf(hex: string): [number, number, number] | undefined {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(full)) return undefined;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** Relative luminance (0 black to 1 white). */
export function luminance(hex: string): number {
  const rgb = rgbOf(hex);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function saturation(hex: string): number {
  const rgb = rgbOf(hex);
  if (!rgb) return 0;
  const max = Math.max(...rgb) / 255;
  const min = Math.min(...rgb) / 255;
  const l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
}

/**
 * The site's accent colour from its inline styles, when it doesn't declare a
 * theme colour: the most used saturated colour, counting colours named
 * primary, accent, brand or button twice as much. Greys, black and white
 * don't count.
 */
export function dominantColor(html: string): string | undefined {
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n") + "\n" + [...html.matchAll(/\sstyle=["']([^"']+)["']/gi)].map((m) => m[1]).join("\n");
  const score = new Map<string, number>();
  for (const m of css.matchAll(HEX)) {
    const rgb = rgbOf(m[0]);
    if (!rgb) continue;
    const hex = `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const lum = luminance(hex);
    if (saturation(hex) < 0.35 || lum < 0.03 || lum > 0.75) continue;
    const before = css.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0);
    const weight = /primary|accent|brand|button|btn|link|theme|highlight/i.test(before) ? 2 : 1;
    score.set(hex, (score.get(hex) ?? 0) + weight);
  }
  let best: string | undefined;
  for (const [hex, n] of score) if (n >= 2 && (!best || n > score.get(best)!)) best = hex;
  return best;
}

/** The first <img> that looks like the site's logo. */
function logoImage(html: string): string | undefined {
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/logo/i.test(tag)) continue;
    const src = attr(tag, /\sdata-(?:lazy-)?src=["']([^"']+)["']/i) ?? attr(tag, /\ssrc=["']([^"']+)["']/i) ?? attr(tag, /\ssrcset=["']([^"'\s,]+)/i);
    if (src && !/^data:/i.test(src)) return src;
  }
  return undefined;
}

const attr = (html: string, re: RegExp) => html.match(re)?.[1]?.trim();

/** The look of the site, for the demo page: name, theme colour, logo or hero image, headline, tagline. */
export function extractBrand(html: string, pageUrl: string): Brand {
  const meta = (name: string) =>
    attr(html, new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")) ??
    attr(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i"));
  const abs = (u?: string) => {
    if (!u) return undefined;
    try {
      const x = new URL(u, pageUrl);
      return /^https?:$/.test(x.protocol) ? x.toString() : undefined;
    } catch {
      return undefined;
    }
  };
  const theme = meta("theme-color");
  const themeOk = theme && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(theme) && luminance(theme) < 0.85 ? theme : undefined;
  const title = attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = attr(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const icon =
    attr(html, /<link[^>]+rel=["']apple-touch-icon(?:-precomposed)?["'][^>]+href=["']([^"']+)["']/i) ??
    attr(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon(?:-precomposed)?["']/i) ??
    attr(html, /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i);
  return {
    name: meta("og:site_name") ?? (title ? strip(title).split(/\s[|–—-]\s/)[0].trim().slice(0, 80) : undefined),
    color: themeOk ?? dominantColor(html),
    logo: abs(logoImage(html) ?? icon),
    image: abs(meta("og:image") ?? meta("twitter:image")),
    headline: h1 ? strip(h1).slice(0, 140) || undefined : undefined,
    tagline: meta("description")?.slice(0, 220) || meta("og:description")?.slice(0, 220),
  };
}

export interface PageText {
  url: string;
  title?: string;
  text: string;
}

/** A page's own words, without menus, headers and footers. */
export function pageContent(html: string, url: string): PageText {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const text = strip(main.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " "));
  const title = attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  return { url, title: title ? strip(title).slice(0, 120) : undefined, text };
}

/**
 * The knowledge base the guide answers from: the business's facts, its FAQs,
 * then each page's text, capped so it stays fast to search.
 */
export function buildKbText(input: { business: string; facts: string[]; faqs: Faq[]; pages: PageText[] }, maxChars = 80_000, perPage = 9_000): string {
  const parts = [`# ${input.business}`, ...input.facts.filter(Boolean)];
  if (input.faqs.length) {
    parts.push("", "## Frequently asked questions");
    for (const f of input.faqs) parts.push(`Q: ${f.q}`, `A: ${f.a}`, "");
  }
  for (const p of input.pages) {
    if (p.text.length < 80) continue;
    parts.push("", `## ${p.title || "Page"} (${p.url})`, p.text.slice(0, perPage));
  }
  const text = parts.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

const GENERIC_LINK = /^(services?|our services|all services|what we do|learn more|read more|view all|see all|more|details|click here|home|about|about us|contact|contact us|book now|get a quote|free quote|call now|menu|shop|products?)$/i;
const SERVICE_PATH = /service|repair|install|replace|clean|maintenance|treatment|inspection|removal|product|equipment|rental|emergency/i;

/** Names of the services or products the site links to ("Furnace Repair"), for the demo page and questions. */
export function serviceNames(links: PageLink[], max = 8): string[] {
  const out: string[] = [];
  for (const l of links) {
    const t = l.text.replace(/\s+/g, " ").trim();
    if (t.length < 4 || t.length > 40 || GENERIC_LINK.test(t) || !/[a-z]/i.test(t) || t.split(" ").length > 5) continue;
    if (!SERVICE_PATH.test(new URL(l.url).pathname)) continue;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Questions and answers in text the owner pasted: a line ending in "?"
 * followed by its answer on the next lines.
 */
export function faqsFromText(text: string, max = 20): Faq[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: Faq[] = [];
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const q = lines[i].replace(/^(q(uestion)?\s*[:.)-]|[-*\d.)]+)\s*/i, "").trim();
    if (!q.endsWith("?") || q.length < 8 || q.length > 200) continue;
    const answer: string[] = [];
    for (let j = i + 1; j < lines.length && lines[j] && !lines[j].endsWith("?"); j++) answer.push(lines[j].replace(/^a(nswer)?\s*[:.)-]\s*/i, ""));
    if (answer.length) out.push({ q, a: answer.join(" ").slice(0, 500) });
  }
  return out;
}

const NOT_A_PHOTO = /logo|icon|sprite|favicon|avatar|badge|pixel|spacer|placeholder|loader|flag|payment|visa|mastercard|paypal|stars?[-_.]|rating|arrow|button|emoji|gravatar|1x1/i;

/**
 * The big pictures on a page, best first: the share image, then photos in
 * <img>, <picture> and background images, largest srcset candidate of each.
 * Logos, icons and tracking pixels are skipped.
 */
export function pagePhotos(html: string, pageUrl: string, max = 6): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u?: string) => {
    if (!u || out.length >= max || /^data:/i.test(u)) return;
    let x: URL;
    try {
      x = new URL(u.replace(/&amp;/g, "&").trim(), pageUrl);
    } catch {
      return;
    }
    if (!/^https?:$/.test(x.protocol) || /\.(svg|ico|gif)$/i.test(x.pathname) || NOT_A_PHOTO.test(x.pathname)) return;
    const key = x.toString();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };
  const biggest = (srcset?: string) => {
    if (!srcset) return undefined;
    const cands = srcset
      .split(/,\s+(?=\S)/)
      .map((c) => c.trim().split(/\s+/))
      .filter((p) => p[0] && !/^data:/i.test(p[0]))
      .map(([u, d]) => ({ u, n: d ? parseFloat(d) * (d.endsWith("x") ? 1000 : 1) : 1 }));
    return cands.sort((a, b) => b.n - a.n)[0]?.u;
  };
  const meta = (name: string) =>
    attr(html, new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i")) ??
    attr(html, new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i"));
  add(meta("og:image"));
  add(meta("twitter:image"));
  for (const m of html.matchAll(/<(img|source)\b[^>]*>/gi)) {
    const tag = m[0];
    if (/logo|icon/i.test(tag.replace(/\s(?:src|srcset|data-src|data-srcset)=["'][^"']*["']/gi, ""))) continue;
    const w = Number(attr(tag, /\swidth=["']?(\d+)/i));
    const h = Number(attr(tag, /\sheight=["']?(\d+)/i));
    if ((w && w < 400) || (h && h < 250)) continue;
    const set = attr(tag, /\sdata-srcset=["']([^"']+)["']/i) ?? attr(tag, /\ssrcset=["']([^"']+)["']/i);
    add(biggest(set) ?? attr(tag, /\sdata-(?:lazy-)?src=["']([^"']+)["']/i) ?? (m[1].toLowerCase() === "img" ? attr(tag, /\ssrc=["']([^"']+)["']/i) : undefined));
  }
  for (const m of html.matchAll(/background(?:-image)?\s*:\s*url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(m[1]);
  return out;
}
