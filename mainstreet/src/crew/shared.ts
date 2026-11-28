import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, DEMO, publicBase } from "../config.ts";
import { getSettings } from "../db.ts";
import { getNiche } from "../niches.ts";
import type { BusinessFacts, Lead, LeadSummary, Settings } from "../types.ts";
import { clip, money } from "../util.ts";

// Helpers every crew role shares: where a lead's files live, its public
// links, and the fact sheet the models are allowed to use.

export function leadDir(lead: Pick<Lead, "id">, ...sub: string[]): string {
  const dir = path.join(DATA_DIR, "leads", lead.id, ...sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const rel = (abs: string) => path.relative(DATA_DIR, abs).split(path.sep).join("/");
export const abs = (relPath: string) => path.join(DATA_DIR, relPath);

export function proposalUrl(lead: Pick<Lead, "proposalToken">): string | undefined {
  return lead.proposalToken ? `${publicBase()}/p/${lead.proposalToken}` : undefined;
}

export function unsubscribeUrl(lead: Pick<Lead, "proposalToken">): string {
  return `${publicBase()}/u/${lead.proposalToken}`;
}

export function priceLabel(cents: number, s: Settings = getSettings()): string {
  return money(cents, s.offer.currency);
}

export function facts(lead: Lead): BusinessFacts {
  const niche = getNiche(lead.niche);
  return {
    name: lead.name,
    niche: niche.id,
    nicheLabel: niche.label,
    city: lead.city,
    region: lead.region,
    phone: lead.phone,
    email: lead.email,
    address: lead.address,
    hours: lead.hours,
    mapsUrl: lead.mapsUrl,
    rating: lead.reviewCount && lead.reviewCount >= 3 ? lead.rating : undefined,
    reviewCount: lead.reviewCount && lead.reviewCount >= 3 ? lead.reviewCount : undefined,
  };
}

const STATE_WORDS: Record<string, string> = {
  none: "no website listed on Google",
  social_only: "only a social media page instead of a website",
  dead: "a website link that's broken or expired",
  outdated: "a website that looks many years out of date",
  weak: "a basic website missing important features",
  modern: "a reasonably modern website",
};

/** The only facts a model may use about a business, as plain text. */
export function factSheet(lead: Lead, opts: { reviews?: boolean } = {}): string {
  const niche = getNiche(lead.niche);
  const lines = [
    `Business: ${lead.name}`,
    `Type: ${niche.label}`,
    `Location: ${lead.city}${lead.region ? `, ${lead.region}` : ""}${lead.address ? ` (address: ${lead.address})` : ""}`,
    lead.phone ? `Phone: ${lead.phone}` : "Phone: not listed",
    lead.rating && lead.reviewCount ? `Google rating: ${lead.rating.toFixed(1)} from ${lead.reviewCount} reviews` : `Google reviews: ${lead.reviewCount ?? 0}`,
    lead.hours?.length ? `Hours: ${lead.hours.join("; ")}` : "Hours: not listed",
    `Website situation: ${STATE_WORDS[lead.websiteState ?? "none"]}${lead.website ? ` (${lead.website})` : ""}`,
  ];
  if (lead.audit?.findings.length) lines.push(`What we found on the current site:\n${lead.audit.findings.map((f) => `- ${f}`).join("\n")}`);
  if (opts.reviews && lead.reviews?.length) {
    lines.push(`Recent Google reviews (quote only these, word for word, if you quote at all):\n${lead.reviews.map((r, i) => `${i + 1}. ${r.author} (${r.rating}★): "${clip(r.text, 400)}"`).join("\n")}`);
  }
  return lines.join("\n");
}

export function summarize(lead: Lead): LeadSummary {
  const shot = lead.variants?.find((v) => v.screenshot)?.screenshot;
  return {
    id: lead.id,
    name: lead.name,
    niche: lead.niche,
    city: lead.city,
    region: lead.region,
    status: lead.status,
    websiteState: lead.websiteState,
    score: lead.score,
    rating: lead.rating,
    reviewCount: lead.reviewCount,
    priceCents: lead.priceCents,
    dealValueCents: lead.dealValueCents,
    thumb: shot ? `/files/${shot}` : undefined,
    proposalUrl: proposalUrl(lead),
    hasEmail: Boolean(lead.email),
    hasPhone: Boolean(lead.phone),
    lastContactAt: lead.lastContactAt,
    updatedAt: lead.updatedAt,
    error: lead.error,
  };
}

/** Your postal address. Demo mode fills in an obviously fake one, at render time only, so nothing fake is ever saved. */
export function postalAddress(s: Settings = getSettings()): string {
  return s.owner.postalAddress.trim() || (DEMO ? "123 Demo Street, Your Town (demo address: add yours in Settings)" : "");
}

/** The compliance footer every commercial email carries (CAN-SPAM and CASL). */
export function emailFooter(lead: Lead, s: Settings = getSettings()): string {
  const where = lead.emailSource ? ` because your email is published on ${lead.emailSource.replace(/^https?:\/\//, "").replace(/\/$/, "")}` : "";
  return [
    "—",
    `${s.owner.name || s.owner.agencyName}`,
    `${s.owner.agencyName} · ${postalAddress(s)}`,
    `You're receiving this one-time note${where}. Not interested? Reply "no" or unsubscribe here: ${unsubscribeUrl(lead)}`,
  ].join("\n");
}
