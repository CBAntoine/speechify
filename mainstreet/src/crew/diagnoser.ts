import { z } from "zod";
import { features } from "../config.ts";
import { getSettings, updateLead } from "../db.ts";
import { leadChanged, log, working } from "../events.ts";
import { getNiche } from "../niches.ts";
import { askStructured } from "../providers/claude.ts";
import type { Diagnosis, Lead } from "../types.ts";
import { money } from "../util.ts";
import { ESTIMATE, preflight } from "./checker.ts";
import { DIAGNOSER_PROMPT } from "./prompts.ts";
import { HeldError } from "./scout.ts";
import { factSheet } from "./shared.ts";

// Diagnoser: what's wrong, why it costs them, and the angle for the pitch.

const DiagnosisSchema = z.object({
  headline: z.string().describe("One plain sentence naming the problem in the owner's terms"),
  evidence: z.array(z.string()).describe("2-4 facts taken from the input"),
  impact: z.string(),
  angle: z.enum(["no_site", "dead_link", "social_only", "outdated", "mobile", "booking", "trust"]),
  hooks: z.array(z.string()).describe("1-3 true, specific, flattering details"),
  corePitch: z.string().describe("2-3 sentences; mentions we already built them a new site; no price"),
  tone: z.enum(["friendly", "professional", "premium"]),
  fit: z.enum(["pursue", "skip"]),
  skipReason: z.string().describe("Empty unless fit is skip"),
  suggestedPriceUsd: z.number(),
});

export async function diagnose(lead: Lead): Promise<Lead | undefined> {
  return working("diagnoser", `Diagnosing ${lead.name}`, async () => {
    const s = getSettings();
    let d: Diagnosis;
    if (features.claude) {
      const v = preflight(ESTIMATE.diagnose(), { agent: "diagnoser", what: "a diagnosis", lead });
      if (!v.ok) throw new HeldError(v.reason);
      const out = await askStructured({
        agent: "diagnoser",
        leadId: lead.id,
        system: DIAGNOSER_PROMPT,
        prompt: `${factSheet(lead, { reviews: true })}\n\nStandard price: ${money(s.offer.priceCents, s.offer.currency)} for a one-page site, live in ${s.offer.deliveryDays} days.`,
        schema: DiagnosisSchema,
        effort: "low",
        maxTokens: 6000,
        label: "diagnosis",
      });
      d = {
        ...out,
        skipReason: out.skipReason || undefined,
        suggestedPriceCents: Math.max(s.offer.priceCents, Math.round(out.suggestedPriceUsd * 100)),
      };
    } else {
      d = demoDiagnosis(lead, s.offer.priceCents);
    }
    const updated = updateLead(lead.id, (l) => {
      l.diagnosis = d;
      if (d.fit === "skip") {
        l.status = "skipped";
        l.skipReason = d.skipReason ?? "Diagnoser says it's not a fit";
      } else {
        l.status = "diagnosed";
        l.dealValueCents = d.suggestedPriceCents > l.priceCents ? d.suggestedPriceCents : undefined;
      }
    });
    if (updated) {
      leadChanged(updated);
      log("diagnoser", d.fit === "skip" ? `Skipped: ${updated.skipReason}` : d.headline, { lead: updated, level: d.fit === "skip" ? "info" : "success" });
    }
    return updated;
  });
}

/** Demo mode: a template diagnosis from the facts. */
export function demoDiagnosis(lead: Lead, priceCents: number): Diagnosis {
  const niche = getNiche(lead.niche);
  const reviews = lead.reviewCount ?? 0;
  const rated = lead.rating && reviews >= 3 ? `${lead.rating.toFixed(1)} stars from ${reviews} Google reviews` : undefined;
  const where = `${lead.city}${lead.region ? `, ${lead.region}` : ""}`;
  const byState: Record<string, { headline: string; angle: Diagnosis["angle"]; impact: string }> = {
    none: {
      headline: `People searching for a ${niche.label.toLowerCase()} in ${lead.city} can't find a website for ${lead.name}.`,
      angle: "no_site",
      impact: "Customers who want to check services or hours before calling go to a competitor that has a site.",
    },
    social_only: {
      headline: `${lead.name}'s Google listing sends people to a social media page instead of a website.`,
      angle: "social_only",
      impact: "A social page buries hours, services and contact details, and many people don't have an account to see it.",
    },
    dead: {
      headline: `The website link on ${lead.name}'s Google listing is broken.`,
      angle: "dead_link",
      impact: "Everyone who taps 'Website' on Google hits an error page, which looks like the business might be closed.",
    },
    outdated: {
      headline: `${lead.name}'s website looks like it was built over a decade ago and is hard to use on a phone.`,
      angle: lead.audit?.mobileViewport === false ? "mobile" : "outdated",
      impact: "Most local searches happen on phones; a shrunken desktop page makes people give up and call someone else.",
    },
    weak: {
      headline: `${lead.name}'s website is missing the basics customers look for.`,
      angle: niche.booking ? "booking" : "trust",
      impact: "Without online booking and a tappable phone number, people who are ready to act have to work too hard.",
    },
  };
  const b = byState[lead.websiteState ?? "none"] ?? byState.none;
  const evidence = [
    lead.websiteState === "none" ? "No website on their Google listing" : (lead.audit?.findings[0] ?? "Website has problems"),
    ...(lead.audit?.findings.slice(1, 3) ?? []),
    rated ? `${rated}` : `${reviews} Google reviews`,
  ].slice(0, 4);
  const hooks = [rated, lead.hours?.some((h) => /saturday: (?!closed)/i.test(h)) ? "open on Saturdays" : undefined, `a local ${niche.label.toLowerCase()} in ${where}`].filter((x): x is string => Boolean(x)).slice(0, 3);
  return {
    headline: b.headline,
    evidence,
    impact: b.impact,
    angle: b.angle,
    hooks,
    corePitch: `${rated ? `You've earned ${rated}, but ` : ""}${b.headline.charAt(0).toLowerCase()}${b.headline.slice(1).replace(/\.$/, "")}. So we went ahead and built ${lead.name} a new website, with your real hours, phone number and reviews, and it's ready to look at now.`,
    tone: niche.value === "high" && ["law", "med_spa", "dentist"].includes(niche.id) ? "professional" : "friendly",
    fit: "pursue",
    suggestedPriceCents: priceCents,
  };
}
