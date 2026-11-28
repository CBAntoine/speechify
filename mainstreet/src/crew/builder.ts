import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DEMO, features } from "../config.ts";
import { FONT_PAIR_IDS, ICON_NAMES, PALETTE_IDS } from "../design-ids.ts";
import { getSettings, updateLead } from "../db.ts";
import { leadChanged, log, working } from "../events.ts";
import { getNiche } from "../niches.ts";
import { browserAvailable, screenshotFile } from "../providers/browser.ts";
import { askStructured } from "../providers/claude.ts";
import { elevenEnabled, generateImage } from "../providers/eleven.ts";
import { hasFfmpeg, runFfmpeg } from "../providers/ffmpeg.ts";
import { googleReviews } from "../providers/places/google.ts";
import { renderSite, VARIANTS } from "../site/render.ts";
import type { Lead, SiteSpec, Variant } from "../types.ts";
import { clip, errorMessage, token } from "../util.ts";
import { ESTIMATE, checkHtml, preflight, validateSpec } from "./checker.ts";
import { BUILDER_PROMPT } from "./prompts.ts";
import { HeldError } from "./scout.ts";
import { abs, factSheet, facts, leadDir, priceLabel, rel } from "./shared.ts";

// Builder: plans the content, gets a hero photo from ElevenLabs, renders three
// designs with the business's real details, and takes phone screenshots.

const str = (d: string) => z.string().describe(d);

const SpecSchema = z.object({
  businessName: z.string(),
  tagline: str("≤ 60 characters"),
  heroHeadline: str("≤ 70 characters, about the customer"),
  heroSubheadline: str("≤ 170 characters"),
  primaryCta: z.string(),
  secondaryCta: z.string(),
  services: z.array(z.object({ name: z.string(), blurb: z.string(), icon: z.enum(ICON_NAMES) })).describe("3-6 services"),
  about: z.object({ heading: z.string(), body: z.string() }),
  highlights: z.array(z.object({ label: z.string(), detail: z.string() })).describe("exactly 3, from facts only"),
  testimonials: z.array(z.object({ quote: z.string(), author: z.string(), rating: z.number() })).describe("verbatim from the given reviews, or empty"),
  faq: z.array(z.object({ q: z.string(), a: z.string() })).describe("3-4"),
  ctaBand: z.object({ heading: z.string(), body: z.string(), button: z.string() }),
  seo: z.object({ title: z.string(), description: z.string() }),
  palette: z.enum(PALETTE_IDS),
  fontPair: z.enum(FONT_PAIR_IDS),
  mood: z.enum(["warm", "clinical", "bold", "earthy", "luxury", "playful"]),
  imagePrompt: z.string(),
});

export async function build(input: Lead): Promise<Lead | undefined> {
  return working("builder", `Building mockups for ${input.name}`, async () => {
    const s = getSettings();
    let lead = updateLead(input.id, (l) => {
      l.proposalToken ??= token(9);
      if (!l.reviews?.length && l.demo?.reviews?.length) l.reviews = l.demo.reviews;
    })!;

    if (!lead.reviews?.length && lead.source === "google" && features.places && (lead.reviewCount ?? 0) > 0 && preflight(ESTIMATE.reviews(), { agent: "builder", what: "fetching reviews", lead }).ok) {
      const reviews = await googleReviews(lead.sourceId, lead.id).catch(() => []);
      lead = updateLead(lead.id, (l) => (l.reviews = reviews))!;
    }

    let spec: SiteSpec;
    if (features.claude) {
      const v = preflight(ESTIMATE.spec(), { agent: "builder", what: "planning the site", lead });
      if (!v.ok) throw new HeldError(v.reason);
      spec = await askStructured({
        agent: "builder",
        leadId: lead.id,
        system: BUILDER_PROMPT,
        prompt: specPrompt(lead),
        schema: SpecSchema,
        effort: "medium",
        maxTokens: 12000,
        label: "site plan",
      });
    } else {
      spec = demoSpec(lead);
    }
    const checked = validateSpec(spec, lead);
    spec = checked.spec;
    for (const p of checked.problems) log("checker", p, { lead });

    let hero = lead.heroImage;
    if (!hero && s.media.heroImages && elevenEnabled() && !DEMO_SKIP_IMAGES()) {
      const v = preflight(ESTIMATE.heroImage(), { agent: "builder", what: "a hero image", lead });
      if (v.ok) {
        try {
          const img = await generateImage(`${spec.imagePrompt}. Photorealistic, natural light, wide composition with calm space on one side. Absolutely no text, letters, logos, watermarks or signage.`, {
            aspect: "16:9",
            agent: "builder",
            leadId: lead.id,
          });
          hero = await saveHero(lead, img.bytes, img.mime);
          log("builder", "Got a hero photo from ElevenLabs.", { lead });
        } catch (err) {
          log("builder", `No hero image (${errorMessage(err)}); using a designed background instead.`, { lead, level: "warn" });
        }
      }
    }

    const niche = getNiche(lead.niche);
    const order = [...VARIANTS].sort((a, b) => (a.id === niche.variant ? -1 : b.id === niche.variant ? 1 : 0));
    const variants: Variant[] = [];
    for (const v of order) {
      const html = renderSite({
        spec,
        facts: facts(lead),
        variant: v.id,
        heroImageUrl: hero ? `../../${path.basename(hero)}` : undefined,
        mode: "preview",
        preview: { agencyName: s.owner.agencyName, claimUrl: `/p/${lead.proposalToken}`, priceLabel: priceLabel(lead.dealValueCents ?? lead.priceCents, s) },
      });
      for (const p of checkHtml(html)) log("checker", `${v.label} design: ${p}`, { lead, level: "warn" });
      const file = path.join(leadDir(lead, "sites", v.id), "index.html");
      fs.writeFileSync(file, html);
      variants.push({ id: v.id, label: v.label, path: rel(file) });
    }

    if ((await browserAvailable()).ok) {
      for (const v of variants) {
        try {
          const shot = await screenshotFile(abs(v.path), { width: 390, height: 844, scale: 2, type: "jpeg", quality: 80, hide: [".ms-preview-bar"] });
          const file = path.join(path.dirname(abs(v.path)), "shot.jpg");
          fs.writeFileSync(file, shot);
          v.screenshot = rel(file);
        } catch (err) {
          log("builder", `Couldn't screenshot the ${v.label} design: ${errorMessage(err)}`, { lead, level: "warn" });
        }
      }
    }

    const updated = updateLead(lead.id, (l) => {
      l.spec = spec;
      l.heroImage = hero;
      l.variants = variants;
      l.status = "built";
    });
    if (updated) {
      leadChanged(updated);
      log("builder", `Built 3 designs: ${variants.map((v) => v.label).join(", ")}. Headline: "${clip(spec.heroHeadline, 70)}"`, { lead: updated, level: "success" });
    }
    return updated;
  });
}

/** Demo mode makes no paid images unless you ask for them (DEMO_IMAGES=1). */
function DEMO_SKIP_IMAGES(): boolean {
  return DEMO && process.env.DEMO_IMAGES !== "1";
}

async function saveHero(lead: Lead, bytes: Buffer, mime: string): Promise<string> {
  const dir = leadDir(lead);
  const ext = /png/.test(mime) ? "png" : /webp/.test(mime) ? "webp" : "jpg";
  const raw = path.join(dir, `hero-original.${ext}`);
  fs.writeFileSync(raw, bytes);
  const jpg = path.join(dir, "hero.jpg");
  if (ext !== "jpg" && (await hasFfmpeg())) {
    try {
      await runFfmpeg(["-i", raw, "-vf", "scale='min(1920,iw)':-2", "-q:v", "3", jpg], { timeoutMs: 30_000 });
      return rel(jpg);
    } catch {
      /* keep the original */
    }
  }
  if (ext === "jpg") {
    fs.renameSync(raw, jpg);
    return rel(jpg);
  }
  const kept = path.join(dir, `hero.${ext}`);
  fs.renameSync(raw, kept);
  return rel(kept);
}

function specPrompt(lead: Lead): string {
  const niche = getNiche(lead.niche);
  return [
    factSheet(lead, { reviews: true }),
    "",
    lead.diagnosis ? `Diagnosis: ${lead.diagnosis.headline}\nHooks: ${lead.diagnosis.hooks.join("; ")}\nTone: ${lead.diagnosis.tone}` : "",
    `Typical services for a ${niche.label.toLowerCase()}: ${niche.services.map((x) => x.name).join(", ")}.`,
    `Suggested palettes: ${niche.palette.join(", ")}. Suggested font pairs: ${niche.fonts.join(", ")}.`,
    `Hero photo idea: ${niche.scene}.`,
    `Primary call to action suggestion: "${niche.cta}".`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Demo writer ──────────────────────────────────────────────────────────

const HEADLINES: Record<string, (city: string) => string> = {
  dentist: (c) => `Gentle, modern dentistry in ${c}`,
  chiropractor: (c) => `Move better, feel better in ${c}`,
  physio: (c) => `Get back to what you love in ${c}`,
  vet: (c) => `Caring vets for ${c}'s pets`,
  med_spa: (c) => `Skin care that feels like you, in ${c}`,
  salon: (c) => `Hair you'll love, right here in ${c}`,
  barber: (c) => `Sharp cuts and good company in ${c}`,
  roofer: (c) => `Roofs done right in ${c}`,
  plumber: (c) => `Fast, honest plumbing in ${c}`,
  hvac: (c) => `Comfort all year round in ${c}`,
  electrician: (c) => `Safe, tidy electrical work in ${c}`,
  landscaper: (c) => `Yards you'll be proud of in ${c}`,
  auto_repair: (c) => `Honest car repair in ${c}`,
  cleaning: (c) => `Come home to a spotless place in ${c}`,
  painter: (c) => `Clean lines and fresh colour in ${c}`,
  restaurant: (c) => `Good food and good company in ${c}`,
  cafe: (c) => `Your daily coffee spot in ${c}`,
  gym: (c) => `Get stronger in ${c}`,
  law: (c) => `Clear legal advice in ${c}`,
  accountant: (c) => `Taxes and books, handled, in ${c}`,
  pest_control: (c) => `Pest-free homes in ${c}`,
  florist: (c) => `Fresh flowers for every moment in ${c}`,
};

const FAQ: Record<string, { q: string; a: string }[]> = {
  booking: [
    { q: "How do I book?", a: "Call us or use the booking button on this page and we'll find a time that works." },
    { q: "Are you taking new customers?", a: "Yes. Give us a call and we'll get you set up." },
    { q: "What should I bring to my first visit?", a: "Just yourself and any questions. We'll walk you through everything." },
  ],
  quote: [
    { q: "Do you give free estimates?", a: "Call us and describe the job. We'll tell you how we can help and what the next step is." },
    { q: "What areas do you serve?", a: "We're local and serve the surrounding area. Call to check your address." },
    { q: "How soon can you come out?", a: "It depends on the job and the season. Call us and we'll give you the earliest time we have." },
  ],
};

export function demoSpec(lead: Lead): SiteSpec {
  const niche = getNiche(lead.niche);
  const city = lead.city;
  const rated = lead.rating && (lead.reviewCount ?? 0) >= 3 ? `${lead.rating.toFixed(1)}★ on Google` : undefined;
  const saturday = lead.hours?.find((h) => /^saturday:/i.test(h) && !/closed/i.test(h));
  const pick = (n: number) => niche.palette[n % niche.palette.length];
  const seed = [...lead.name].reduce((a, c) => a + c.charCodeAt(0), 0);
  const highlights = [
    rated ? { label: rated, detail: `From ${lead.reviewCount} reviews` } : { label: "Local and independent", detail: `Proudly serving ${city}` },
    saturday ? { label: "Open Saturdays", detail: saturday.replace(/^saturday:\s*/i, "") } : { label: "Easy to reach", detail: lead.phone ? `Call ${lead.phone}` : "Send us a message" },
    { label: `Local to ${city}`, detail: lead.region ? `${city}, ${lead.region}` : city },
  ];
  const testimonials = (lead.reviews ?? []).slice(0, 3).map((r) => ({ quote: r.text.length > 220 ? `${r.text.slice(0, 200).replace(/\s+\S*$/, "")}…` : r.text, author: r.author, rating: r.rating }));
  return {
    businessName: lead.name,
    tagline: `${niche.label} in ${city}`,
    heroHeadline: (HEADLINES[niche.id] ?? ((c: string) => `${city}'s local ${niche.label.toLowerCase()}`))(city),
    heroSubheadline: `${lead.name} is a local ${niche.label.toLowerCase()} in ${city}. ${niche.booking ? "Book online or give us a call." : "Call for a quick, honest answer."}`,
    primaryCta: niche.cta,
    secondaryCta: "Call us",
    services: niche.services.slice(0, 5).map((x) => ({ name: x.name, blurb: `Ask us about ${x.name.toLowerCase()}. We'll explain your options in plain words before any work starts.`, icon: x.icon })),
    about: { heading: `About ${lead.name}`, body: `${lead.name} is a local ${niche.label.toLowerCase()} serving ${city}${lead.region ? `, ${lead.region}` : ""} and the surrounding area. We keep things simple: clear answers, fair prices and work we're proud to put our name on.` },
    highlights,
    testimonials,
    faq: niche.booking ? FAQ.booking : FAQ.quote,
    ctaBand: { heading: niche.booking ? "Ready when you are" : "Need a hand?", body: lead.phone ? `Call ${lead.phone} and talk to a real person.` : "Send us a message and we'll get right back to you.", button: niche.cta },
    seo: { title: clip(`${lead.name} | ${niche.label} in ${city}`, 60), description: clip(`${lead.name} is a local ${niche.label.toLowerCase()} in ${city}. ${niche.services.slice(0, 3).map((x) => x.name).join(", ")}.`, 155) },
    palette: pick(seed),
    fontPair: niche.fonts[0],
    mood: niche.value === "low" ? "warm" : ["dentist", "physio", "chiropractor", "vet"].includes(niche.id) ? "clinical" : ["med_spa", "law"].includes(niche.id) ? "luxury" : "bold",
    imagePrompt: `${niche.scene}, photorealistic, natural light, no text, no logos, no signage`,
  };
}
