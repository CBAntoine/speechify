import "server-only";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { claude, FALLBACK, MODEL, RefusalError } from "./client";
import { getNiche, type Niche } from "@/lib/niches";
import { enforceLimits, fitTo, LIMITS } from "@/lib/ads/limits";
import { deriveSignals, topSignals } from "@/lib/prospecting/score";
import type { AdCampaign, AgencyProfile, AuditResult } from "@/lib/types";

export const META_CTAS = ["Book Now", "Learn More", "Get Quote", "Call Now", "Contact Us", "Get Offer", "Sign Up", "Order Now", "Send Message", "Shop Now"] as const;

// No length constraints in the schema: the SDK would strip them and then fail
// the whole parse on a single long headline. Limits are in the prompt and are
// enforced after parsing (enforceLimits), with counters in the UI.
export const CampaignSchema = z.object({
  strategy: z.object({
    summary: z.string(),
    audience: z.string(),
    angles: z.array(z.object({ name: z.string(), hook: z.string(), why: z.string() })),
    budget: z.string(),
    kpis: z.array(z.string()),
  }),
  meta: z.array(
    z.object({
      angle: z.string(),
      primaryText: z.string(),
      headline: z.string(),
      description: z.string(),
      cta: z.enum(META_CTAS),
      creativeIdea: z.string(),
    })
  ),
  google: z.object({
    headlines: z.array(z.string()),
    descriptions: z.array(z.string()),
    keywords: z.array(z.string()),
    negativeKeywords: z.array(z.string()),
  }),
  video: z.array(z.object({ title: z.string(), hook: z.string(), script: z.string(), shots: z.array(z.string()) })),
  landing: z.object({ headline: z.string(), subheadline: z.string(), bullets: z.array(z.string()), cta: z.string() }),
  creative: z.object({
    headline: z.string(),
    subline: z.string(),
    badge: z.string(),
    cta: z.string(),
    palette: z.object({ bg: z.string(), fg: z.string(), accent: z.string() }),
  }),
});

export type CampaignContent = z.infer<typeof CampaignSchema>;

export interface AdBrief {
  leadId?: string;
  businessName: string;
  niche?: string;
  location?: string;
  website?: string;
  goal: string;
  offer?: string;
  notes?: string;
  rating?: number;
  reviewCount?: number;
  audit?: AuditResult;
  /** Business research gathered by an agent or the web tool. */
  research?: string;
}

const SYSTEM = `You are a senior direct-response ad strategist who writes ads for local businesses. A marketing agency uses you to build campaigns for its clients and to make free sample campaigns that win new clients.

How you write:
- Specific beats clever. Name the city, the service, the offer and the next step.
- Lead with the customer's problem or desire, then the offer, then proof, then one call to action.
- Write like a person, not a brand: short sentences, plain words, no hype ("revolutionary", "unlock", "elevate").
- Every ad must make sense on a phone in under three seconds.

Honesty rules (these protect the agency's reputation):
- Use only facts given in the brief. Never invent review counts, star ratings, prices, years in business, awards, credentials, guarantees or testimonials.
- When an ad needs a fact you don't have, write a clearly marked placeholder like [price] or [years in business] so a human fills it in.
- No guaranteed outcomes ("lose 20 lbs", "win your case"). No language that asserts the reader's personal attributes ("Are you overweight?", "Struggling with debt?").
- Health, legal and financial services: no cure or outcome claims; keep it to the service, the process and the offer.
- Real estate, credit and employment ads run under Meta's Special Ad Category: say so in the audience field and don't target by age, gender or narrow zip codes.

Platform rules (hard limits; count characters):
- Google responsive search ads: write 15 headlines of at most ${LIMITS.googleHeadline} characters and 4 descriptions of at most ${LIMITS.googleDescription} characters. Mix: 4 with the service + city, 4 with the offer, 3 with proof or trust, 2 with urgency or convenience, 2 calls to action. No two headlines that say the same thing.
- Keywords: 10 to 15 high-intent local phrases (service + "near me", service + city, problem phrases). Negative keywords: 8 to 12 (jobs, training, DIY, free, cheap where it fits).
- Meta (Facebook/Instagram): write 3 ads, one per strategic angle. The first ${LIMITS.metaPrimary} characters of primary text must stand alone as the hook; total primary text under 450 characters. Headline at most ${LIMITS.metaHeadline} characters. Description at most ${LIMITS.metaDescription} characters.
- Short video (Reels/TikTok/Shorts): write 2 scripts of 15 to 30 seconds. The hook must land in the first 2 seconds. Describe shots a small business can film on a phone.
- Landing page: one headline, one subheadline, 3 to 5 benefit bullets and a button label that matches the goal.
- Creative card (a static image the app renders): headline at most 6 words, subline at most 8 words, badge at most 4 words (a fact from the brief, or a placeholder), CTA at most 4 words. Palette: three hex colors (bg, fg, accent) where fg on bg has strong contrast; fit the niche (calm and clinical for health, bold for trades, warm for food).`;

function brief(b: AdBrief, profile: AgencyProfile, niche: Niche | undefined): string {
  const lines: string[] = [];
  lines.push(`BUSINESS: ${b.businessName}`);
  if (niche) lines.push(`NICHE: ${niche.label}`);
  if (b.location) lines.push(`LOCATION: ${b.location}`);
  if (b.website) lines.push(`WEBSITE: ${b.website}`);
  lines.push(`GOAL: ${b.goal}`);
  lines.push(`OFFER: ${b.offer?.trim() || "(none given: propose 2-3 offer options in strategy.summary, use the strongest in the ads, and mark any price as a placeholder)"}`);
  if (b.rating !== undefined) lines.push(`GOOGLE RATING: ${b.rating}`);
  if (b.reviewCount !== undefined) lines.push(`GOOGLE REVIEWS: ${b.reviewCount}`);
  if (b.audit?.reachable) {
    const a = b.audit;
    lines.push("", "WHAT THEIR WEBSITE SHOWS:");
    if (a.title) lines.push(`- Page title: ${a.title}`);
    if (a.description) lines.push(`- Meta description: ${a.description}`);
    if (a.h1) lines.push(`- Main heading: ${a.h1}`);
    lines.push(`- Online booking: ${a.booking.length ? a.booking.join(", ") : "none found"}`);
    lines.push(`- Ad tracking: ${a.pixels.length ? a.pixels.join(", ") : "none found"}`);
    if (a.socials.length) lines.push(`- Social profiles: ${a.socials.join(", ")}`);
    const gaps = topSignals(deriveSignals({ website: b.website, audit: a, booking: niche?.booking }), 4);
    if (gaps.length) lines.push(`- Gaps: ${gaps.map((g) => g.label).join("; ")}`);
  }
  if (b.research) lines.push("", "RESEARCH NOTES:", b.research.slice(0, 4000));
  if (b.notes) lines.push("", `NOTES FROM THE AGENCY: ${b.notes}`);
  if (niche && niche.id !== "custom") {
    lines.push("", "WHAT USUALLY WORKS IN THIS NICHE (use as inspiration, not facts about this business):");
    lines.push(`- Pain points: ${niche.painPoints.join("; ")}`);
    lines.push(`- Offers that convert: ${niche.offers.join("; ")}`);
    lines.push(`- Angles: ${niche.angles.join("; ")}`);
    lines.push(`- Best channels: ${niche.channels.join(", ")}`);
    lines.push(`- Seed keywords: ${niche.keywords.join(", ")}`);
  }
  lines.push("", `THE AGENCY (for tone only; ads speak as the business, not the agency): ${profile.agencyName}. Voice: ${profile.voice}`);
  lines.push("", "Write the full campaign.");
  return lines.join("\n");
}

export type AdProgress = { type: "phase"; phase: "thinking" | "writing" } | { type: "progress"; chars: number };

/** Stream a campaign from Claude. Calls onProgress while it writes. */
export async function generateCampaign(b: AdBrief, profile: AgencyProfile, onProgress?: (p: AdProgress) => void): Promise<CampaignContent> {
  const niche = getNiche(b.niche);
  const stream = claude().beta.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    ...FALLBACK,
    output_config: { effort: "high", format: betaZodOutputFormat(CampaignSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content: brief(b, profile, niche) }],
  });
  let chars = 0;
  let writing = false;
  let lastSent = 0;
  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "thinking") onProgress?.({ type: "phase", phase: "thinking" });
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      if (!writing) {
        writing = true;
        onProgress?.({ type: "phase", phase: "writing" });
      }
      chars += event.delta.text.length;
      if (chars - lastSent > 200) {
        lastSent = chars;
        onProgress?.({ type: "progress", chars });
      }
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new RefusalError("Claude declined to write ads for this brief. Try rewording the offer or notes.");
  if (final.stop_reason === "max_tokens") throw new Error("The campaign was cut off before it finished. Try again with shorter notes.");
  if (!final.parsed_output) throw new Error("Claude's reply didn't match the campaign format. Try again.");
  return enforceLimits(final.parsed_output);
}

const PALETTES: Record<string, { bg: string; fg: string; accent: string }> = {
  health: { bg: "#0f2a3a", fg: "#f4fbff", accent: "#5fd3c6" },
  beauty: { bg: "#2a1730", fg: "#fff6f1", accent: "#f2b8a2" },
  trades: { bg: "#151a22", fg: "#ffffff", accent: "#ffb020" },
  food: { bg: "#3a1a10", fg: "#fff5e8", accent: "#ffcf5c" },
  pro: { bg: "#11203d", fg: "#f5f8ff", accent: "#7aa7ff" },
  fitness: { bg: "#101010", fg: "#ffffff", accent: "#c6ff3d" },
};

function paletteFor(nicheId?: string) {
  const map: Record<string, keyof typeof PALETTES> = {
    dentist: "health", chiropractor: "health", physical_therapy: "health", veterinarian: "health",
    med_spa: "beauty", salon: "beauty", roofer: "trades", hvac: "trades", plumber: "trades", landscaping: "trades",
    pest_control: "trades", auto_repair: "trades", cleaning: "health", restaurant: "food", gym: "fitness",
    law_pi: "pro", real_estate: "pro", accountant: "pro",
  };
  return PALETTES[map[nicheId ?? ""] ?? "pro"];
}

/** A no-AI starter campaign built from the niche library, for demo mode. */
export function templateCampaign(b: AdBrief): CampaignContent {
  const niche = getNiche(b.niche);
  const city = (b.location ?? "").split(",")[0].trim() || "your area";
  const service = niche?.label ?? "Local service";
  const offer = b.offer?.trim() || niche?.offers[0] || "[your offer]";
  const offers = [offer, ...(niche?.offers ?? []).filter((o) => o !== offer)].slice(0, 3);
  const angles = (niche?.angles ?? ["Local and trusted", "Fast and easy", "Clear pricing"]).slice(0, 3);
  const ctaFor = (goal: string): (typeof META_CTAS)[number] =>
    /call/i.test(goal) ? "Call Now" : /quote|estimate/i.test(goal) ? "Get Quote" : /book|appoint|consult/i.test(goal) ? "Book Now" : "Learn More";
  const cta = ctaFor(b.goal);
  const head = (s: string) => fitTo(s, LIMITS.googleHeadline);
  const headlines = [
    `${service} in ${city}`,
    `${city} ${service}`,
    `Top-Rated ${service}`,
    `${service} Near You`,
    head(offer),
    head(offers[1] ?? "Limited-Time Offer"),
    "New Customers Welcome",
    "Clear, Upfront Pricing",
    "Locally Owned & Trusted",
    "[X]+ Five-Star Reviews",
    "Same-Week Availability",
    "Book Online in 60 Sec",
    "Call Today",
    `Get Your ${cta === "Get Quote" ? "Free Quote" : "Spot"} Now`,
    "Friendly, Expert Team",
  ].map(head);
  return enforceLimits({
    strategy: {
      summary: `Lead with one clear offer (${offer}) and send every click to one action: ${b.goal.toLowerCase()}. ${niche ? `${niche.plural[0].toUpperCase()}${niche.plural.slice(1)} win when they answer the top worry: ${niche.painPoints[0].toLowerCase()}.` : ""} This is a starter template; add a Claude API key for a campaign written around this specific business.`,
      audience: `Adults within 10–15 miles of ${city} who are likely to need a ${service.toLowerCase()} soon. Exclude existing customers. Start broad and let the platform find buyers.`,
      angles: angles.map((a, i) => ({ name: a, hook: i === 0 ? `${a}: ${offer}` : a, why: "A common reason customers in this niche choose one business over another." })),
      budget: "$20–$40/day per platform for 14 days, then move budget to the two best ads.",
      kpis: ["Cost per lead or booking", "Lead-to-appointment rate", "Return on ad spend after 30 days"],
    },
    meta: offers.map((o, i) => ({
      angle: angles[i] ?? angles[0],
      primaryText: `${city}: ${o}. ${angles[i] ?? angles[0]}. [Add one specific proof point here.] Tap below to ${b.goal.toLowerCase()}.`,
      headline: fitTo(o, LIMITS.metaHeadline),
      description: fitTo(`${service} in ${city}`, LIMITS.metaDescription),
      cta,
      creativeIdea: i === 0 ? "Offer card with the price or deal large and a real photo of the team." : i === 1 ? "Before-and-after or customer photo, if allowed for this niche." : "Phone-shot video of the owner explaining the offer in 10 seconds.",
    })),
    google: {
      headlines,
      descriptions: [
        `${offer}. Trusted ${service.toLowerCase()} serving ${city}. ${cta === "Call Now" ? "Call today." : "Book online today."}`,
        `Friendly local team, clear pricing and fast scheduling. See why ${city} chooses us.`,
        `Rated [X] stars by [X]+ local customers. New customers welcome. Limited spots this month.`,
        `Skip the phone tag: ${cta === "Get Quote" ? "get a quote" : "book"} in under a minute. Serving ${city} and nearby.`,
      ],
      keywords: (niche?.keywords ?? [service.toLowerCase()]).flatMap((k) => [k, k.replace("near me", city.toLowerCase())]).slice(0, 12),
      negativeKeywords: ["jobs", "salary", "training", "course", "diy", "free", "how to become", "school"],
    },
    video: [
      {
        title: "Owner offer in 15 seconds",
        hook: `If you live in ${city} and need a ${service.toLowerCase()}, watch this.`,
        script: `Owner on camera at the business. Say who you help, the offer (${offer}), and exactly how to claim it. End on the button.`,
        shots: ["Owner to camera, front of business", "Team at work, quick cuts", "Offer text on screen", "Phone showing the booking page"],
      },
      {
        title: "What to expect",
        hook: "Here's exactly what happens when you book with us.",
        script: "Walk through the visit or job in four quick steps. Keep each shot under 4 seconds. Close with the offer.",
        shots: ["Arrival / greeting", "The service in action", "Happy customer (with permission)", "Offer + call to action"],
      },
    ],
    landing: {
      headline: `${service} in ${city}, made easy`,
      subheadline: `${offer}. ${cta === "Call Now" ? "Call now" : "Book online in 60 seconds"}.`,
      bullets: ["Clear, upfront pricing", "Friendly local team", "Fast scheduling", "[Your best proof point]"],
      cta: cta === "Call Now" ? "Call now" : cta === "Get Quote" ? "Get my free quote" : "Book my visit",
    },
    creative: {
      headline: fitTo(offer, 44),
      subline: `${service} · ${city}`,
      badge: "[Your proof]",
      cta: cta === "Call Now" ? "Call today" : cta === "Get Quote" ? "Get a free quote" : "Book online",
      palette: paletteFor(niche?.id),
    },
  });
}

export function toCampaign(content: CampaignContent, b: AdBrief, createdBy: string): Omit<AdCampaign, "id" | "createdAt"> {
  return {
    ...content,
    leadId: b.leadId,
    businessName: b.businessName,
    niche: b.niche,
    location: b.location,
    goal: b.goal,
    offer: b.offer,
    website: b.website,
    createdBy,
  };
}
