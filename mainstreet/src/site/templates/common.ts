// Shared building blocks for the three mockup layouts: escaping, the facts a
// page may show (derived only from SiteSpec + BusinessFacts, never invented),
// the base stylesheet, and sections every layout reuses.

import type { BusinessFacts, IconName, SiteSpec, VariantId } from "../../types.ts";
import { FONT_PAIRS, ICONS, MAIL_ICON, PALETTES, STAR_SOLID, type FontPair, type Palette } from "../design.ts";

export interface RenderInput {
  spec: SiteSpec;
  facts: BusinessFacts;
  variant: VariantId;
  /** e.g. "../../hero.jpg"; when missing the hero uses generated CSS/SVG art. */
  heroImageUrl?: string;
  mode: "preview" | "live";
  /** The slim "made for you" bar in preview mode. */
  preview?: { agencyName: string; claimUrl: string; priceLabel: string };
}

// ── Escaping and small helpers ───────────────────────────────────────────

/** HTML-escape anything. null/undefined/NaN/objects become "" so they can never leak into a page. */
export function esc(v: unknown): string {
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "number") s = Number.isFinite(v) ? String(v) : "";
  else if (typeof v === "boolean") s = String(v);
  else s = "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Trimmed, whitespace-collapsed text; "" for anything that isn't a non-empty string. */
export function txt(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

/** A url('…') safe inside <style> blocks and style attributes. */
export function cssUrl(u: string): string {
  const safe = u.replace(/[^A-Za-z0-9\-._~:/?#[\]@!$&*+,;=%]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `url('${safe}')`;
}

/** Only http(s), mailto, tel, relative and fragment links get through. */
export function safeHref(u: string | undefined): string | undefined {
  const s = txt(u);
  if (!s) return undefined;
  if (/^(https?:|mailto:|tel:)/i.test(s) || /^[./#]/.test(s) || !/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return undefined;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((x) => x + x).join("") : h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Blend two hex colours; t = share of b. */
export function mix(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function telHref(phone: string | undefined): string | undefined {
  const raw = txt(phone);
  if (!raw) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return undefined;
  if (raw.startsWith("+")) return `tel:+${digits}`;
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${digits}`;
}

export function icon(name: IconName | string | undefined, cls = ""): string {
  const svg = (name && (ICONS as Record<string, string>)[name]) || ICONS.star;
  return cls ? svg.replace("<svg ", `<svg class="${esc(cls)}" `) : svg;
}

export function stars(rating: number | undefined, cls = "stars"): string {
  const n = Math.max(0, Math.min(5, Math.round(rating ?? 5)));
  let out = "";
  for (let i = 0; i < 5; i++) out += `<span class="${i < n ? "on" : "off"}">${STAR_SOLID}</span>`;
  return `<span class="${esc(cls)}" role="img" aria-label="${n} out of 5 stars">${out}</span>`;
}

export function monogram(name: string): string {
  const skip = new Set(["the", "and", "&", "of", "a", "an", "at", "in", "on", "for", "by"]);
  const words = name
    .replace(/[^\p{L}\p{N}\s&'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !skip.has(w.toLowerCase()));
  const letters = words.slice(0, 2).map((w) => w[0]!.toUpperCase());
  return letters.join("") || (name.trim()[0]?.toUpperCase() ?? "•");
}

// ── Facts a page may show ────────────────────────────────────────────────

export interface Hour {
  day: string;
  short: string;
  time: string;
  closed: boolean;
}

export function parseHours(lines: string[] | undefined): Hour[] {
  const out: Hour[] = [];
  for (const raw of lines ?? []) {
    const line = txt(raw);
    if (!line) continue;
    const i = line.indexOf(":");
    const day = i > 0 && i < 12 ? line.slice(0, i).trim() : "";
    const time = (i > 0 && i < 12 ? line.slice(i + 1) : line).trim() || "Closed";
    out.push({ day, short: day.slice(0, 3), time, closed: /closed/i.test(time) });
  }
  return out;
}

const HEALTH = /dent|ortho|chiro|physio|physical|therap|clinic|medical|doctor|optom|eye|derma|massage|acupunct|podiat|hearing|health/i;
const GUESTS = /restaurant|caf[eé]|coffee|bakery|bistro|diner|pizza|bar\b|brew|kitchen|grill|eatery|food|hotel|inn\b|b&b/i;
const CLIENTS = /law|legal|attorney|account|cpa|tax|insur|real ?estate|realtor|salon|spa|barber|beauty|nail|lash|brow|stylist|consult|financ|architect|design|photo/i;

export function audienceWord(f: BusinessFacts): string {
  const s = `${f.niche} ${f.nicheLabel}`;
  if (HEALTH.test(s)) return "patients";
  if (GUESTS.test(s)) return "guests";
  if (CLIENTS.test(s)) return "clients";
  return "customers";
}

const NICHE_ICONS: [RegExp, IconName][] = [
  [/dent|ortho|tooth/i, "tooth"],
  [/roof|gutter|siding|window|door|home|house|construct|remodel|contractor/i, "home"],
  [/plumb|water|drain|pool|irrigat/i, "drop"],
  [/hvac|heat|furnace|boiler/i, "flame"],
  [/air ?con|cool|refrigerat/i, "snowflake"],
  [/electric|solar|generator/i, "bolt"],
  [/landscap|lawn|garden|tree|nursery|florist|flower/i, "leaf"],
  [/auto|car|mechanic|tire|tyre|body shop|detail/i, "car"],
  [/barber|salon|hair|stylist/i, "scissors"],
  [/spa|beauty|nail|lash|brow|esthet|clean|maid|janitor/i, "sparkle"],
  [/vet|pet|dog|cat|groom|animal/i, "paw"],
  [/caf[eé]|coffee|bakery|tea/i, "coffee"],
  [/restaurant|food|pizza|grill|diner|kitchen|bistro|cater/i, "utensils"],
  [/gym|fitness|yoga|pilates|crossfit|martial|trainer/i, "dumbbell"],
  [/law|legal|attorney|notary/i, "scale"],
  [/account|cpa|tax|insur|financ|consult|real ?estate|realtor/i, "briefcase"],
  [/photo|video|studio/i, "camera"],
  [/paint|decor|interior/i, "brush"],
  [/handyman|repair|locksmith|appliance/i, "wrench"],
  [/carpent|cabinet|deck|fenc|concrete|mason/i, "hammer"],
  [/chiro|physio|physical|therap|massage|medical|clinic|doctor|health/i, "heart"],
];

export function nicheIcon(f: BusinessFacts, spec: SiteSpec): IconName {
  const s = `${f.niche} ${f.nicheLabel}`;
  for (const [re, ic] of NICHE_ICONS) if (re.test(s)) return ic;
  const first = spec.services?.[0]?.icon;
  return first && first in ICONS ? first : "star";
}

export interface Ctx {
  input: RenderInput;
  spec: SiteSpec;
  facts: BusinessFacts;
  variant: VariantId;
  p: Palette;
  f: FontPair;
  name: string;
  location: string;
  nicheLabel: string;
  phoneHref?: string;
  phoneLabel?: string;
  emailHref?: string;
  email?: string;
  address?: string;
  directions?: string;
  hours: Hour[];
  openDays: number;
  rating?: { value: string; count: string; stars: number };
  primary: { href: string; label: string };
  secondary: { href: string; label: string };
  heroImage?: string; // a css url(...)
  icon: IconName;
  audience: string;
  year: number;
  services: { name: string; blurb: string; icon: IconName }[];
  testimonials: { quote: string; author: string; rating?: number }[];
  faq: { q: string; a: string }[];
  highlights: { label: string; detail: string }[];
  hasVisit: boolean;
}

export function buildCtx(input: RenderInput): Ctx {
  const spec = input.spec;
  const facts = input.facts;
  const p = PALETTES[spec.palette] ?? PALETTES.harbor;
  const f = FONT_PAIRS[spec.fontPair] ?? FONT_PAIRS.modern;
  const name = txt(facts.name) || txt(spec.businessName) || "Your business";
  const city = txt(facts.city);
  const region = txt(facts.region);
  const location = [city, region].filter(Boolean).join(", ");
  const phoneHref = telHref(facts.phone);
  const phoneLabel = phoneHref ? txt(facts.phone) : undefined;
  const email = txt(facts.email) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt(facts.email)) ? txt(facts.email) : undefined;
  const emailHref = email ? `mailto:${email}` : undefined;
  const address = txt(facts.address) || undefined;
  const mapsUrl = safeHref(facts.mapsUrl);
  const directions =
    mapsUrl ?? (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}`)}` : undefined);
  const hours = parseHours(facts.hours);
  const openDays = hours.filter((h) => !h.closed && h.day).length;
  const rate = typeof facts.rating === "number" && Number.isFinite(facts.rating) && facts.rating > 0 ? facts.rating : undefined;
  const count = typeof facts.reviewCount === "number" && Number.isFinite(facts.reviewCount) && facts.reviewCount > 0 ? Math.round(facts.reviewCount) : undefined;
  const rating = rate && count ? { value: rate.toFixed(1), count: count.toLocaleString("en-US"), stars: rate } : undefined;

  const services = (spec.services ?? [])
    .map((s) => ({ name: txt(s?.name), blurb: txt(s?.blurb), icon: (s?.icon && s.icon in ICONS ? s.icon : "check") as IconName }))
    .filter((s) => s.name)
    .slice(0, 6);
  const testimonials = (spec.testimonials ?? [])
    .map((t) => ({
      quote: txt(t?.quote),
      author: txt(t?.author),
      rating: typeof t?.rating === "number" && Number.isFinite(t.rating) ? t.rating : undefined,
    }))
    .filter((t) => t.quote)
    .slice(0, 6);
  const faq = (spec.faq ?? []).map((x) => ({ q: txt(x?.q), a: txt(x?.a) })).filter((x) => x.q && x.a).slice(0, 6);
  const highlights = (spec.highlights ?? []).map((h) => ({ label: txt(h?.label), detail: txt(h?.detail) })).filter((h) => h.label).slice(0, 4);

  const primaryLabel = txt(spec.primaryCta) || (phoneHref ? "Call now" : "Get in touch");
  const primary = { href: phoneHref ?? "#contact", label: primaryLabel };
  const secText = txt(spec.secondaryCta);
  let secondary: { href: string; label: string };
  if (/call|phone|ring|talk/i.test(secText) && phoneHref) secondary = { href: phoneHref, label: secText };
  else if (/direction|visit|find us|map|locat/i.test(secText) && directions) secondary = { href: directions, label: secText };
  else if (/call|phone|ring|talk/i.test(secText) && emailHref) secondary = { href: emailHref, label: "Email us" };
  else if (secText) secondary = { href: services.length ? "#services" : "#contact", label: secText };
  else secondary = services.length ? { href: "#services", label: "See services" } : { href: "#contact", label: "Contact" };
  // Two identical tel: buttons side by side read as a mistake; make the second one useful.
  if (secondary.href === primary.href && primary.href.startsWith("tel:")) {
    secondary = directions ? { href: directions, label: "Get directions" } : services.length ? { href: "#services", label: "See services" } : secondary;
  }

  return {
    input,
    spec,
    facts,
    variant: input.variant,
    p,
    f,
    name,
    location,
    nicheLabel: txt(facts.nicheLabel),
    phoneHref,
    phoneLabel,
    emailHref,
    email,
    address,
    directions,
    hours,
    openDays,
    rating,
    primary,
    secondary,
    heroImage: txt(input.heroImageUrl) ? cssUrl(txt(input.heroImageUrl)) : undefined,
    icon: nicheIcon(facts, spec),
    audience: audienceWord(facts),
    year: new Date().getFullYear(),
    services,
    testimonials,
    faq,
    highlights,
    hasVisit: Boolean(hours.length || address || phoneHref || emailHref),
  };
}

// ── Document-level pieces ────────────────────────────────────────────────

export function cssVars(c: Ctx): string {
  const { p, f } = c;
  return `:root{--primary:${p.primary};--primary-ink:${p.primaryInk};--primary-text:${p.primaryText};--accent:${p.accent};--accent-ink:${p.accentInk};--bg:${p.bg};--surface:${p.surface};--soft:${p.soft};--ink:${p.ink};--muted:${p.muted};--border:${p.border};--deep:${p.deep};--deep-ink:${p.deepInk};--deep-muted:${p.deepMuted};--deep-accent:${p.deepAccent};--deep-2:${mix(p.deep, "#000000", 0.28)};--deep-line:${rgba(p.deepInk, 0.14)};--primary-soft:${rgba(p.primary, 0.1)};--primary-line:${rgba(p.primary, 0.22)};--shadow:0 1px 2px ${rgba(p.ink, 0.05)},0 8px 24px ${rgba(p.ink, 0.07)};--shadow-lg:0 2px 6px ${rgba(p.ink, 0.06)},0 24px 60px ${rgba(p.ink, 0.14)};--font-h:${f.heading};--font-b:${f.body};--h-weight:${f.headingWeight};--h-track:${f.headingTracking};--h-scale:${f.headingScale}}`;
}

/** Shared reset, typography and components. Layout files add their own look on top. */
export function baseCss(): string {
  return `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth;scroll-padding-top:84px}
body{margin:0;font-family:var(--font-b);font-size:16px;line-height:1.6;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;overflow-x:hidden}
img,svg,video{display:block;max-width:100%}
a{color:inherit;text-decoration-thickness:1px;text-underline-offset:3px}
p{margin:0}
ul,ol{margin:0;padding:0;list-style:none}
h1,h2,h3,h4{font-family:var(--font-h);font-weight:var(--h-weight);letter-spacing:var(--h-track);line-height:1.08;margin:0;text-wrap:balance;overflow-wrap:break-word}
:focus-visible{outline:3px solid var(--accent);outline-offset:3px;border-radius:6px}
.wrap{width:min(1180px,calc(100% - 40px));margin-inline:auto}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.55em;min-height:50px;padding:.8em 1.4em;border-radius:12px;border:1.5px solid transparent;font-family:var(--font-b);font-weight:700;font-size:1rem;line-height:1.15;text-decoration:none;cursor:pointer;transition:transform .18s ease,box-shadow .18s ease,background-color .18s ease;text-align:center}
.btn svg{width:19px;height:19px;flex:none}
.btn:hover{transform:translateY(-1px)}
.btn-primary{background:var(--primary);color:var(--primary-ink);box-shadow:0 8px 22px ${"var(--primary-line)"}}
.btn-accent{background:var(--accent);color:var(--accent-ink)}
.eyebrow{display:inline-flex;align-items:center;gap:.5em;font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--primary-text)}
.sec{padding:76px 0}
.sec-head{max-width:680px;margin-bottom:36px}
.sec-head h2{font-size:calc(var(--h-scale) * clamp(1.9rem,5.6vw,3rem));margin-top:12px}
.sec-head p{margin-top:14px;color:var(--muted);font-size:1.06rem}
.stars{display:inline-flex;gap:2px;color:#F5B301}
.stars .off{opacity:.28}
.stars svg{width:16px;height:16px}
.hdr .brand{display:flex;align-items:center;gap:10px;min-width:0;text-decoration:none}
.hdr .brand-name{font-family:var(--font-h);font-weight:var(--h-weight);letter-spacing:var(--h-track);font-size:calc(var(--h-scale) * 1.08rem);line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.hdr .mark{flex:none;display:grid;place-items:center;width:38px;height:38px;border-radius:11px;font-family:var(--font-h);font-weight:800;font-size:.95rem;letter-spacing:0}
.hdr-in{display:flex;align-items:center;gap:14px;min-height:68px}
.hdr .nav{display:none}
.hdr-actions{display:flex;align-items:center;gap:8px;margin-left:auto;flex:none}
.hdr .btn-call{min-height:42px;padding:.55em 1em;font-size:.92rem;border-radius:10px}
.hdr .btn-call .num{display:none}
.menu-btn{display:grid;place-content:center;gap:5px;width:42px;height:42px;border-radius:10px;border:1.5px solid currentColor;background:transparent;color:inherit;cursor:pointer;opacity:.85}
.menu-btn span{display:block;width:18px;height:2px;border-radius:2px;background:currentColor;transition:transform .2s ease}
.hdr.open .menu-btn span:first-child{transform:translateY(3.5px) rotate(45deg)}
.hdr.open .menu-btn span:last-child{transform:translateY(-3.5px) rotate(-45deg)}
.hdr.open .nav{display:flex;flex-direction:column;position:absolute;left:12px;right:12px;top:calc(100% + 6px);padding:10px;border-radius:16px;background:var(--surface);color:var(--ink);box-shadow:var(--shadow-lg);border:1px solid var(--border)}
.hdr.open .nav a{padding:14px 14px;border-radius:10px;text-decoration:none;font-weight:600}
.hdr.open .nav a:hover{background:var(--soft)}
.svc-icon{display:grid;place-items:center;flex:none;width:48px;height:48px;border-radius:14px;background:var(--primary-soft);color:var(--primary-text)}
.svc-icon svg{width:24px;height:24px}
.hours{display:grid;gap:2px}
.hours li{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px dashed var(--border);font-size:.97rem}
.hours li:last-child{border-bottom:0}
.hours .d{font-weight:600}
.hours .t{color:var(--muted);text-align:right}
.hours .closed .t{opacity:.75}
.faq-list{display:grid;gap:12px}
.faq-item{border:1px solid var(--border);border-radius:14px;background:var(--surface);overflow:hidden}
.faq-item summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;cursor:pointer;list-style:none;font-weight:700;font-size:1.02rem}
.faq-item summary::-webkit-details-marker{display:none}
.faq-item .pm{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:var(--soft);color:var(--primary-text);font-size:1.15rem;line-height:1;transition:transform .2s ease}
.faq-item[open] .pm{transform:rotate(45deg)}
.faq-item .a{padding:0 20px 18px;color:var(--muted)}
.contact-lines{display:grid;gap:14px}
.contact-lines a,.contact-lines div{display:flex;gap:12px;align-items:flex-start;text-decoration:none;overflow-wrap:anywhere}
.contact-lines svg{flex:none;width:20px;height:20px;margin-top:3px;color:var(--primary-text)}
.ms-preview-bar{position:sticky;bottom:0;z-index:80;background:#111214;color:#fff;font:500 13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:0;box-shadow:0 -6px 24px rgba(0,0,0,.18)}
.ms-preview-bar a{display:flex;align-items:center;gap:12px;padding:11px 16px calc(11px + env(safe-area-inset-bottom));text-decoration:none;color:inherit;max-width:1180px;margin:0 auto}
.ms-preview-bar .t{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.92}
.ms-preview-bar .t b{font-weight:700}
.ms-preview-bar .price{flex:none;opacity:.75}
.ms-preview-bar .go{flex:none;font-weight:700;background:#fff;color:#111;border-radius:999px;padding:6px 12px}
@media (max-width:520px){.ms-preview-bar .price{display:none}}
.ms-framed .ms-preview-bar{display:none}
@media (max-width:759px){.ftr-hours{display:none}}
@media (min-width:760px){
  .sec{padding:108px 0}
  .sec-head{margin-bottom:48px}
}
@media (min-width:980px){
  .hdr .nav{display:flex;align-items:center;gap:4px;margin-left:auto}
  .hdr .nav a{padding:8px 12px;border-radius:9px;text-decoration:none;font-weight:600;font-size:.95rem;opacity:.86}
  .hdr .nav a:hover{opacity:1}
  .hdr-actions{margin-left:10px}
  .menu-btn{display:none}
  .hdr .btn-call .lbl{display:none}
  .hdr .btn-call .num{display:inline}
}
@media (min-width:980px){body .svc-grid[data-n="4"]{grid-template-columns:repeat(2,1fr)}}
@media (prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`;
}

export function navLinks(c: Ctx): { href: string; label: string }[] {
  const links: { href: string; label: string }[] = [];
  if (c.services.length) links.push({ href: "#services", label: "Services" });
  links.push({ href: "#about", label: "About" });
  if (c.testimonials.length) links.push({ href: "#reviews", label: "Reviews" });
  if (c.hasVisit) links.push({ href: "#contact", label: c.hours.length ? "Hours & location" : "Contact" });
  if (c.faq.length) links.push({ href: "#faq", label: "FAQ" });
  return links;
}

/** The header markup every layout uses; each layout styles `.hdr` its own way. */
export function header(c: Ctx, opts: { callClass: string; markStyle?: string }): string {
  const nav = navLinks(c)
    .map((l) => `<a href="${esc(l.href)}">${esc(l.label)}</a>`)
    .join("");
  const call = c.phoneHref
    ? `<a class="btn btn-call ${esc(opts.callClass)}" href="${esc(c.phoneHref)}">${icon("phone")}<span class="lbl">Call</span><span class="num">${esc(c.phoneLabel)}</span></a>`
    : `<a class="btn btn-call ${esc(opts.callClass)}" href="#contact"><span>Contact</span></a>`;
  return `<header class="hdr" data-hdr>
  <div class="wrap hdr-in">
    <a class="brand" href="#top" aria-label="${esc(c.name)}, back to top"><span class="mark"${opts.markStyle ? ` style="${esc(opts.markStyle)}"` : ""} aria-hidden="true">${esc(monogram(c.name))}</span><span class="brand-name">${esc(c.name)}</span></a>
    <nav class="nav" aria-label="Main">${nav}</nav>
    <div class="hdr-actions">${call}<button class="menu-btn" type="button" data-menu aria-expanded="false" aria-label="Open menu"><span></span><span></span></button></div>
  </div>
</header>`;
}

export function ratingLine(c: Ctx, cls = "rating"): string {
  if (!c.rating) return "";
  return `<div class="${esc(cls)}">${stars(c.rating.stars)}<span><b>${esc(c.rating.value)}</b> · ${esc(c.rating.count)} Google reviews</span></div>`;
}

export function hoursList(c: Ctx): string {
  if (!c.hours.length) return "";
  const rows = c.hours
    .map((h) => `<li class="${h.closed ? "closed" : ""}"><span class="d">${esc(h.day || "Hours")}</span><span class="t">${esc(h.time)}</span></li>`)
    .join("");
  return `<ul class="hours">${rows}</ul>`;
}

export function contactLines(c: Ctx): string {
  const lines: string[] = [];
  if (c.address) {
    lines.push(
      c.directions
        ? `<a href="${esc(c.directions)}" target="_blank" rel="noopener">${icon("map")}<span>${esc(c.address)}</span></a>`
        : `<div>${icon("map")}<span>${esc(c.address)}</span></div>`
    );
  }
  if (c.phoneHref) lines.push(`<a href="${esc(c.phoneHref)}">${icon("phone")}<span>${esc(c.phoneLabel)}</span></a>`);
  if (c.emailHref) lines.push(`<a href="${esc(c.emailHref)}">${MAIL_ICON}<span>${esc(c.email)}</span></a>`);
  return lines.length ? `<div class="contact-lines">${lines.join("")}</div>` : "";
}

export function visitButtons(c: Ctx, primaryCls: string, secondaryCls: string): string {
  const out: string[] = [];
  if (c.phoneHref) out.push(`<a class="btn ${esc(primaryCls)}" href="${esc(c.phoneHref)}">${icon("phone")}<span>Call ${esc(c.phoneLabel)}</span></a>`);
  if (c.directions) out.push(`<a class="btn ${esc(c.phoneHref ? secondaryCls : primaryCls)}" href="${esc(c.directions)}" target="_blank" rel="noopener">${icon("map")}<span>Get directions</span></a>`);
  if (!c.phoneHref && c.emailHref) out.push(`<a class="btn ${esc(c.directions ? secondaryCls : primaryCls)}" href="${esc(c.emailHref)}">Email us</a>`);
  return out.length ? `<div class="visit-btns">${out.join("")}</div>` : "";
}

export function faqList(c: Ctx): string {
  return `<div class="faq-list">${c.faq
    .map((x) => `<details class="faq-item"><summary><span>${esc(x.q)}</span><span class="pm" aria-hidden="true">+</span></summary><div class="a"><p>${esc(x.a)}</p></div></details>`)
    .join("")}</div>`;
}

export function testimonialCards(c: Ctx, cardCls: string): string {
  return c.testimonials
    .map(
      (t) => `<figure class="${esc(cardCls)}">
  ${stars(t.rating)}
  <blockquote><p>${esc(t.quote)}</p></blockquote>
  <figcaption><span class="who">${esc(t.author || "Google reviewer")}</span><span class="src">Google review</span></figcaption>
</figure>`
    )
    .join("");
}

export function ctaHref(c: Ctx): string {
  return c.phoneHref ?? c.emailHref ?? c.directions ?? "#contact";
}

export function previewBar(c: Ctx): string {
  const pv = c.input.preview;
  if (c.input.mode !== "preview" || !pv) return "";
  const href = safeHref(pv.claimUrl) ?? "#";
  const price = txt(pv.priceLabel);
  return `<div class="ms-preview-bar" role="region" aria-label="Website preview"><a href="${esc(href)}"><span class="t">Preview made for <b>${esc(c.name)}</b> by ${esc(txt(pv.agencyName) || "our studio")}</span>${price ? `<span class="price">${esc(price)}</span>` : ""}<span class="go">Claim it →</span></a></div>`;
}

export const MENU_SCRIPT = `<script>(function(){try{if(window.self!==window.top)document.documentElement.classList.add('ms-framed')}catch(e){document.documentElement.classList.add('ms-framed')}var h=document.querySelector('[data-hdr]');if(!h)return;var b=h.querySelector('[data-menu]');b&&b.addEventListener('click',function(){var o=h.classList.toggle('open');b.setAttribute('aria-expanded',o?'true':'false')});h.querySelectorAll('.nav a').forEach(function(a){a.addEventListener('click',function(){h.classList.remove('open');b&&b.setAttribute('aria-expanded','false')})})})();</script>`;

/** LocalBusiness structured data for live sites, from real facts only. */
export function jsonLd(c: Ctx): string {
  const data: Record<string, unknown> = { "@context": "https://schema.org", "@type": "LocalBusiness", name: c.name };
  const desc = txt(c.spec.seo?.description);
  if (desc) data.description = desc;
  if (c.phoneLabel) data.telephone = c.phoneLabel;
  if (c.email) data.email = c.email;
  if (c.address) data.address = c.address;
  if (c.rating) data.aggregateRating = { "@type": "AggregateRating", ratingValue: c.rating.value, reviewCount: c.facts.reviewCount };
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

// ── Hero art: used when there is no photo (and underneath one, so a missing file never shows a broken image) ──

export function artLayers(c: Ctx, tone: "dark" | "light"): string {
  const { p } = c;
  if (tone === "dark") {
    return [
      `radial-gradient(70% 55% at 88% 8%, ${rgba(p.primary, 0.92)} 0%, ${rgba(p.primary, 0)} 72%)`,
      `radial-gradient(60% 55% at 4% 96%, ${rgba(p.accent, 0.5)} 0%, ${rgba(p.accent, 0)} 70%)`,
      `radial-gradient(42% 36% at 60% 62%, ${rgba(p.deepAccent, 0.2)} 0%, ${rgba(p.deepAccent, 0)} 72%)`,
      `linear-gradient(165deg, ${mix(p.deep, p.primary, 0.3)} 0%, ${p.deep} 52%, ${mix(p.deep, "#000000", 0.38)} 100%)`,
    ].join(",");
  }
  return [
    `radial-gradient(65% 60% at 88% 10%, ${rgba(p.accent, 0.55)} 0%, ${rgba(p.accent, 0)} 70%)`,
    `radial-gradient(60% 60% at 6% 94%, ${rgba(p.primary, 0.34)} 0%, ${rgba(p.primary, 0)} 70%)`,
    `radial-gradient(40% 40% at 50% 50%, ${rgba(p.surface, 0.9)} 0%, ${rgba(p.surface, 0)} 70%)`,
    `linear-gradient(150deg, ${p.soft} 0%, ${mix(p.soft, p.surface, 0.55)} 50%, ${mix(p.soft, p.primary, 0.14)} 100%)`,
  ].join(",");
}

function moodPattern(c: Ctx, tone: "dark" | "light"): string {
  const { p } = c;
  const line = tone === "dark" ? rgba(p.deepAccent, 0.16) : rgba(p.primary, 0.1);
  const dot = tone === "dark" ? rgba(p.deepInk, 0.16) : rgba(p.primary, 0.16);
  switch (c.spec.mood) {
    case "luxury":
      return `<span class="ms-art-pat" style="background:repeating-linear-gradient(120deg, ${line} 0 1px, transparent 1px 34px)"></span>`;
    case "bold":
      return `<span class="ms-art-pat" style="background:repeating-linear-gradient(135deg, ${line} 0 14px, transparent 14px 46px);mask-image:linear-gradient(90deg,transparent 30%,#000 80%);-webkit-mask-image:linear-gradient(90deg,transparent 30%,#000 80%)"></span>`;
    case "playful":
      return `<span class="ms-art-pat" style="background-image:radial-gradient(${rgba(p.accent, 0.55)} 7px, transparent 8px),radial-gradient(${rgba(p.primary, 0.35)} 5px, transparent 6px);background-size:160px 140px,110px 120px;background-position:20px 30px,70px 90px"></span>`;
    case "earthy":
      return `<svg class="ms-art-pat" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><path d="M-20 230 C 80 170, 140 260, 240 210 S 380 150, 430 190 L 430 320 L -20 320 Z" fill="${rgba(p.accent, tone === "dark" ? 0.22 : 0.28)}"/><path d="M-20 260 C 100 220, 170 300, 280 250 S 400 230, 430 250 L 430 320 L -20 320 Z" fill="${rgba(p.primary, tone === "dark" ? 0.25 : 0.16)}"/></svg>`;
    case "clinical":
      return `<span class="ms-art-pat" style="background-image:radial-gradient(${dot} 1.3px, transparent 1.6px);background-size:22px 22px;mask-image:radial-gradient(70% 70% at 70% 40%,#000,transparent);-webkit-mask-image:radial-gradient(70% 70% at 70% 40%,#000,transparent)"></span>`;
    default:
      return `<span class="ms-art-pat" style="background-image:radial-gradient(${dot} 1.2px, transparent 1.5px);background-size:26px 26px;mask-image:linear-gradient(180deg,#000,transparent 85%);-webkit-mask-image:linear-gradient(180deg,#000,transparent 85%)"></span>`;
  }
}

/** Decoration over the art layers: mood pattern, rings and a large faint niche icon. */
export function artDecor(c: Ctx, tone: "dark" | "light"): string {
  const { p } = c;
  const ring = tone === "dark" ? rgba(p.deepAccent, 0.22) : rgba(p.primary, 0.14);
  const iconColor = tone === "dark" ? rgba(p.deepInk, 0.1) : rgba(p.primary, 0.13);
  return `<span class="ms-art" aria-hidden="true">${moodPattern(c, tone)}<span class="ms-art-ring r1" style="border-color:${ring}"></span><span class="ms-art-ring r2" style="border-color:${ring}"></span><span class="ms-art-icon" style="color:${iconColor}">${icon(c.icon)}</span></span>`;
}

export const ART_CSS = `
.ms-art{position:absolute;inset:0;overflow:hidden;pointer-events:none}
.ms-art-pat{position:absolute;inset:0;width:100%;height:100%;display:block}
.ms-art-ring{position:absolute;border:1.5px solid;border-radius:50%}
.ms-art-ring.r1{width:78vmin;height:78vmin;right:-22vmin;top:-14vmin}
.ms-art-ring.r2{width:52vmin;height:52vmin;right:-9vmin;top:-1vmin}
.ms-art-icon{position:absolute;right:-6%;top:6%;width:min(62vmin,520px);height:min(62vmin,520px);transform:rotate(-9deg)}
.ms-art-icon svg{width:100%;height:100%;stroke-width:.9}
`;

/** Floating chips with real facts, for the illustrated hero cards. */
export function factChips(c: Ctx, max = 3): string[] {
  const chips: string[] = [];
  if (c.rating) chips.push(`<span class="chip">${stars(c.rating.stars, "stars sm")}<b>${esc(c.rating.value)}</b><span>${esc(c.rating.count)} reviews</span></span>`);
  if (c.openDays >= 5) chips.push(`<span class="chip">${icon("clock")}<span>Open ${c.openDays} days a week</span></span>`);
  if (c.location) chips.push(`<span class="chip">${icon("map")}<span>${esc(c.location)}</span></span>`);
  if (c.services[0]) chips.push(`<span class="chip">${icon(c.services[0].icon)}<span>${esc(c.services[0].name)}</span></span>`);
  return chips.slice(0, max);
}

export interface LayoutOutput {
  css: string;
  body: string;
}
