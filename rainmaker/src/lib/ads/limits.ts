// Platform text limits and export helpers. Pure, unit tested, usable in the
// browser and on the server.

import type { AdCampaign } from "../types.ts";

export const LIMITS = {
  googleHeadline: 30,
  googleDescription: 90,
  googleHeadlinesMax: 15,
  googleDescriptionsMax: 4,
  googlePath: 15,
  /** Meta shows about this much primary text before "See more". */
  metaPrimary: 125,
  metaHeadline: 40,
  metaDescription: 30,
  tiktokText: 100,
} as const;

export function charCount(text: string): number {
  // Count user-perceived characters, so emoji count once.
  return Array.from(text ?? "").length;
}

export function isOver(text: string, max: number): boolean {
  return charCount(text) > max;
}

/** Shorten to max characters at a word boundary, without a trailing comma. */
export function fitTo(text: string, max: number): string {
  const chars = Array.from(text.trim());
  if (chars.length <= max) return text.trim();
  const cut = chars.slice(0, max + 1).join("");
  const lastSpace = cut.lastIndexOf(" ");
  const base = (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : Array.from(cut).slice(0, max).join("")).trim();
  return base.replace(/[,;:\-–—&]+$/, "").trim();
}

export interface LengthIssue {
  where: string;
  text: string;
  len: number;
  max: number;
}

export function campaignIssues(c: Pick<AdCampaign, "google" | "meta">): LengthIssue[] {
  const out: LengthIssue[] = [];
  c.google.headlines.forEach((h, i) => {
    if (isOver(h, LIMITS.googleHeadline)) out.push({ where: `Google headline ${i + 1}`, text: h, len: charCount(h), max: LIMITS.googleHeadline });
  });
  c.google.descriptions.forEach((d, i) => {
    if (isOver(d, LIMITS.googleDescription)) out.push({ where: `Google description ${i + 1}`, text: d, len: charCount(d), max: LIMITS.googleDescription });
  });
  c.meta.forEach((m, i) => {
    if (isOver(m.headline, LIMITS.metaHeadline)) out.push({ where: `Meta ad ${i + 1} headline`, text: m.headline, len: charCount(m.headline), max: LIMITS.metaHeadline });
  });
  return out;
}

/** Apply hard platform limits (Google rejects long assets; Meta truncates). */
export function enforceLimits<T extends Pick<AdCampaign, "google" | "meta">>(c: T): T {
  const dedupe = (arr: string[]) => Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
  return {
    ...c,
    google: {
      ...c.google,
      headlines: dedupe(c.google.headlines.map((h) => fitTo(h, LIMITS.googleHeadline))).slice(0, LIMITS.googleHeadlinesMax),
      descriptions: dedupe(c.google.descriptions.map((d) => fitTo(d, LIMITS.googleDescription))).slice(0, LIMITS.googleDescriptionsMax),
    },
    meta: c.meta.map((m) => ({ ...m, headline: fitTo(m.headline, LIMITS.metaHeadline) })),
  };
}

function csvCell(v: string | undefined): string {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Responsive search ad as a CSV row Google Ads Editor can import. */
export function googleAdsCsv(c: AdCampaign, finalUrl: string): string {
  const headers = ["Campaign", "Ad group", ...Array.from({ length: 15 }, (_, i) => `Headline ${i + 1}`), ...Array.from({ length: 4 }, (_, i) => `Description ${i + 1}`), "Final URL", "Path 1", "Path 2"];
  const name = c.businessName.slice(0, 60);
  const path1 = (c.niche ?? "services").replace(/_/g, "-").slice(0, LIMITS.googlePath);
  const row = [
    `${name} - Search`,
    `${name} - Core`,
    ...Array.from({ length: 15 }, (_, i) => c.google.headlines[i] ?? ""),
    ...Array.from({ length: 4 }, (_, i) => c.google.descriptions[i] ?? ""),
    finalUrl,
    path1,
    "book",
  ];
  const kwHeader = ["Campaign", "Ad group", "Keyword", "Criterion Type"];
  const kwRows = [
    ...c.google.keywords.map((k) => [`${name} - Search`, `${name} - Core`, k, "Phrase"]),
    ...c.google.negativeKeywords.map((k) => [`${name} - Search`, "", k, "Negative Phrase"]),
  ];
  return [
    headers.map(csvCell).join(","),
    row.map(csvCell).join(","),
    "",
    kwHeader.join(","),
    ...kwRows.map((r) => r.map(csvCell).join(",")),
  ].join("\n");
}

/** Plain-text version of a whole campaign, for pasting anywhere. */
export function campaignText(c: AdCampaign): string {
  const lines: string[] = [];
  lines.push(`${c.businessName}: ${c.goal}`);
  if (c.offer) lines.push(`Offer: ${c.offer}`);
  lines.push("", "STRATEGY", c.strategy.summary, `Audience: ${c.strategy.audience}`, `Budget: ${c.strategy.budget}`);
  lines.push("", "META ADS");
  c.meta.forEach((m, i) => lines.push(`#${i + 1} (${m.angle})`, m.primaryText, `Headline: ${m.headline}`, `Description: ${m.description}`, `CTA: ${m.cta}`, ""));
  lines.push("GOOGLE SEARCH", "Headlines:", ...c.google.headlines.map((h) => `- ${h}`), "Descriptions:", ...c.google.descriptions.map((d) => `- ${d}`));
  lines.push("Keywords: " + c.google.keywords.join(", "), "Negatives: " + c.google.negativeKeywords.join(", "));
  lines.push("", "SHORT VIDEO");
  c.video.forEach((v) => lines.push(v.title, `Hook: ${v.hook}`, v.script, `Shots: ${v.shots.join(" | ")}`, ""));
  lines.push("LANDING PAGE", c.landing.headline, c.landing.subheadline, ...c.landing.bullets.map((b) => `- ${b}`), `Button: ${c.landing.cta}`);
  return lines.join("\n");
}
