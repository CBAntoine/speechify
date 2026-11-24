// What a video ad may say about a business: facts from your pipeline, their
// website, the website check, their niche, and (optionally) web research,
// each with its source. The script is written from these and nothing else.
// Pure, unit tested.

import type { Niche } from "../niches.ts";
import type { Lead, VideoFact } from "../types.ts";

export interface SiteFacts {
  headline?: string;
  tagline?: string;
  services?: string[];
}

export interface ResearchFacts {
  answer: string;
  sources: { title?: string; url: string }[];
}

const clean = (s: string | undefined, max = 180) =>
  (s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Research bullets ("- ..." or "1. ...") as separate facts, without the URLs. */
export function researchBullets(answer: string, max = 5): string[] {
  return answer
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\(?https?:\/\/\S+\)?/g, "").replace(/\*\*/g, "").trim())
    .filter((l) => l.length >= 20 && l.length <= 260 && !/^(sources?|summary|note)\b[:]?/i.test(l) && !/\b(couldn'?t|could not|unable to|no information|not confirm)/i.test(l))
    .slice(0, max);
}

export function businessFacts(input: { lead: Lead; niche?: Niche; site?: SiteFacts; research?: ResearchFacts }): VideoFact[] {
  const { lead, niche, site, research } = input;
  const facts: VideoFact[] = [];
  const add = (kind: VideoFact["kind"], text: string, source: string, url?: string) => {
    const t = clean(text, 260);
    if (t && !facts.some((f) => f.text === t)) facts.push({ id: `f${facts.length + 1}`, kind, text: t, source, url });
  };
  const city = clean(lead.city ?? "", 60);
  const kind = niche && niche.id !== "custom" ? niche.label : clean(lead.category, 60) || "Local business";
  const checked = `Website check, ${day(lead.audit?.fetchedAt)}`;

  add("business", `${lead.name}: ${kind}${city ? ` in ${city}` : ""}.`, "Your pipeline");
  if (lead.rating && lead.reviewCount) add("business", `${lead.name} is rated ${lead.rating} stars from ${lead.reviewCount} Google reviews.`, "Google");
  if (site?.headline) add("business", `Their website's headline: "${clean(site.headline, 120)}"`, "Their website", lead.website);
  if (site?.tagline) add("business", `How they describe themselves: "${clean(site.tagline, 200)}"`, "Their website", lead.website);
  const services = (site?.services ?? []).map((s) => clean(s, 40)).filter(Boolean).slice(0, 5);
  if (services.length) add("business", `Services on their website: ${list(services)}.`, "Their website", lead.website);

  const a = lead.audit;
  if (a?.reachable) {
    const slowSignal = (lead.signals ?? []).some((s) => s.id === "slow");
    if (typeof a.responseMs === "number" && !slowSignal) {
      const secs = (a.responseMs / 1000).toFixed(1);
      if (a.responseMs > 2500) add("gap", `Slow website: their homepage took ${secs} seconds to respond in our check.`, checked, a.finalUrl ?? a.url);
      else add("strength", `Fast website: their homepage responded in ${secs} seconds in our check.`, checked, a.finalUrl ?? a.url);
    }
    if (a.booking.length) add("strength", `They already take online bookings (${a.booking.slice(0, 2).join(", ")}).`, checked);
    if (a.chat.length) add("strength", `Their website has a chat widget (${a.chat[0]}).`, checked);
    if (a.pixels.length) add("strength", `They have ad tracking installed (${a.pixels.slice(0, 2).join(", ")}), so they run or have run ads.`, checked);
  } else if (a && !a.reachable) {
    add("gap", `Their website didn't load in our check${a.error ? ` (${clean(a.error, 80)})` : ""}.`, checked, a.url);
  }
  if (!lead.website) add("gap", "We couldn't find a website for them.", "Your pipeline");

  // The website check's findings: the gaps to sell against, and what's working.
  for (const s of lead.signals ?? []) {
    const text = s.detail ? `${s.label}: ${s.detail}` : `${s.label}.`;
    add(s.positive ? "strength" : "gap", text, /review|rating/i.test(s.id) ? "Google listing" : checked);
  }

  if (niche && niche.id !== "custom") {
    const value = niche.customerValue.replace(/^\s*\w/, (c) => c.toLowerCase()).replace(/\.$/, "");
    add("industry", `What one new customer is worth to ${niche.plural}, as an industry estimate: ${value}.`, "Rainmaker niche guide");
    for (const p of niche.painPoints.slice(0, 2)) add("industry", `A common problem for ${niche.plural}: ${p}`, "Rainmaker niche guide");
  }

  if (research) {
    const src = research.sources[0];
    for (const b of researchBullets(research.answer)) add("research", b, src?.title ? `Web research: ${src.title}` : "Web research", src?.url);
  }
  return facts;
}

export interface ProductBrief {
  id: string;
  name: string;
  tagline: string;
  features: string[];
  /** Why it fits this business, from their findings. */
  why?: string;
  /** The finding of theirs it fixes ("No online booking"), when there is one. */
  fixes?: string;
}

/** Everything the script may say about the products: their own descriptions. */
export function productText(p: ProductBrief): string {
  return [p.name, p.tagline, ...p.features, p.why ?? "", p.fixes ?? ""].join(" ");
}
