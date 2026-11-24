import { test } from "node:test";
import assert from "node:assert/strict";
import { getNiche } from "../src/lib/niches.ts";
import type { Lead, VideoFact } from "../src/lib/types.ts";
import { businessFacts, researchBullets, type ProductBrief } from "../src/lib/video/facts.ts";
import { LINK, productLine, alignedTiming, estimateTiming, groundStory, narration, templateStory, ungroundedNumbers, withFooter, type StoryInput } from "../src/lib/video/storyboard.ts";

const AT = "2026-11-24T12:00:00Z";

const lead: Lead = {
  id: "lead_1",
  name: "Northwind Heating",
  niche: "hvac",
  city: "Calgary, AB",
  website: "https://northwind.example",
  rating: 4.6,
  reviewCount: 128,
  source: "openstreetmap",
  stage: "new",
  createdBy: "user",
  createdAt: AT,
  updatedAt: AT,
  signals: [
    { id: "no_booking", label: "No online booking", detail: "Customers can only call to book", severity: "high" },
    { id: "established", label: "Established", detail: "128 Google reviews", severity: "low", positive: true },
  ],
  audit: {
    url: "https://northwind.example",
    fetchedAt: AT,
    reachable: true,
    https: true,
    status: 200,
    responseMs: 4200,
    mobileViewport: true,
    analytics: [],
    pixels: [],
    booking: [],
    chat: [],
    reviewsWidgets: [],
    hasContactForm: true,
    hasClickToCall: true,
    hasSchema: false,
    hasOgImage: true,
    socials: [],
    emails: [],
    phones: [],
  },
} as Lead;

const products: ProductBrief[] = [
  { id: "ai-receptionist", name: "AI receptionist", tagline: "Answers every call, day and night", features: ["Books appointments", "Takes messages"], why: "No easy way to book online.", fixes: "No online booking" },
  { id: "website-agent", name: "Website assistant", tagline: "Answers visitors' questions in chat and voice", features: ["Captures leads"] },
];

function input(facts: VideoFact[]): StoryInput {
  return {
    business: lead.name,
    city: "Calgary",
    kind: "HVAC company",
    facts,
    products,
    agency: { name: "Rain Co", owner: "Craig", phone: "(403) 555-0199", mailingAddress: "1 Main St, Calgary AB" },
    hasLogo: true,
    hasPhoto: false,
  };
}

test("facts come from the business's real data, each with its source", () => {
  const facts = businessFacts({
    lead,
    niche: getNiche("hvac"),
    site: { headline: "Calgary's same-day furnace repair", tagline: "Family-owned since 2004.", services: ["Furnace Repair", "AC Installation", "Heat Pumps"] },
  });
  const text = facts.map((f) => f.text);
  assert.ok(text.includes("Northwind Heating: HVAC in Calgary, AB."));
  assert.ok(text.includes("Northwind Heating is rated 4.6 stars from 128 Google reviews."));
  assert.ok(text.includes('Their website\'s headline: "Calgary\'s same-day furnace repair"'));
  assert.ok(text.includes("Services on their website: Furnace Repair, AC Installation and Heat Pumps."));
  assert.ok(facts.some((f) => f.kind === "gap" && f.text === "Slow website: their homepage took 4.2 seconds to respond in our check."), "a slow site is a gap");
  assert.ok(facts.some((f) => f.kind === "gap" && f.text.startsWith("No online booking: Customers can only call")));
  assert.ok(facts.some((f) => f.kind === "strength" && f.text.startsWith("Established")));
  assert.ok(facts.some((f) => f.kind === "industry" && /^What one new customer is worth to HVAC companies, as an industry estimate: about \$/.test(f.text)));
  assert.ok(facts.every((f) => f.source && f.id), "every fact says where it came from");
  assert.equal(new Set(facts.map((f) => f.id)).size, facts.length);
});

test("research answers become separate facts, without links or hedges", () => {
  const bullets = researchBullets(
    "- Reviews often praise their **same-day** service and tidy technicians (https://g.co/x)\n- They run a $79 furnace tune-up special this fall\n- Couldn't confirm their hours\nSources: ...\n- short"
  );
  assert.deepEqual(bullets, ["Reviews often praise their same-day service and tidy technicians", "They run a $79 furnace tune-up special this fall"]);
});

test("the template video: hook, a real fact, the gaps, one scene per product, a call to action", () => {
  const facts = businessFacts({ lead, niche: getNiche("hvac") });
  const story = templateStory(input(facts));
  const kinds = story.scenes.map((s) => s.kind);
  assert.equal(kinds[0], "hook");
  assert.equal(kinds.at(-1), "cta");
  assert.deepEqual(story.scenes.filter((s) => s.kind === "solution").map((s) => s.productId), ["ai-receptionist", "website-agent"]);
  const stat = story.scenes.find((s) => s.visual === "stat");
  assert.deepEqual(stat?.stat, { value: "4.6★", label: "128 Google reviews" });
  assert.ok(story.scenes.some((s) => s.kind === "problem"));
  assert.ok(story.email.body.includes(LINK));
  assert.match(story.email.body, /Not interested\?/);
  assert.match(story.email.body, /1 Main St, Calgary AB/);
  assert.equal(groundStory(story, input(facts)).dropped.length, 0, "the template only says true things");
});

test("made-up numbers, facts and products are removed from Claude's script", () => {
  const facts = businessFacts({ lead, niche: getNiche("hvac") });
  const raw = {
    scenes: [
      { kind: "hook" as const, headline: "Northwind Heating", sub: "A quick idea", voiceover: "Hi!", visual: "logo" as const, factIds: ["f1", "f999"] },
      { kind: "fact" as const, headline: "4.6 stars", sub: "from 128 reviews", voiceover: "You're rated 4.6 from 128 reviews.", visual: "stat" as const, stat: { value: "4.6★", label: "128 reviews" }, factIds: ["f2"] },
      { kind: "problem" as const, headline: "You lose 37% of calls", sub: "Industry data", voiceover: "You're losing 37 percent of callers.", visual: "website" as const, factIds: [] },
      { kind: "fact" as const, headline: "Big claim", sub: "x", voiceover: "y", visual: "stat" as const, stat: { value: "3x", label: "more bookings" }, factIds: [] },
      { kind: "solution" as const, headline: "Mystery product", sub: "x", voiceover: "y", visual: "product" as const, productId: "not-selected", factIds: [] },
      { kind: "cta" as const, headline: "Call us", sub: "(403) 555-0199", voiceover: "Call (403) 555-0199.", visual: "plain" as const, factIds: [] },
    ],
    email: { subject: "A video for you", body: "Hi,\n\nI made you a video." },
  };
  const { story, dropped } = groundStory(raw, input(facts));
  assert.ok(!story.scenes.some((s) => s.headline.includes("37%")), "the invented statistic is gone");
  assert.ok(dropped.some((d) => d.includes("37")));
  assert.equal(story.scenes.find((s) => s.headline === "Big claim")?.stat, undefined, "an invented stat is removed");
  assert.equal(story.scenes.find((s) => s.headline === "Mystery product")?.visual, "plain", "a product that wasn't picked isn't shown");
  assert.deepEqual(story.scenes[0].factIds, ["f1"], "unknown fact ids are dropped");
  assert.deepEqual(story.scenes[1].stat, { value: "4.6★", label: "128 reviews" }, "real numbers stay");
  assert.ok(story.email.body.includes(LINK) && /Not interested\?/.test(story.email.body), "the email gets the link and the footer");
  assert.deepEqual(ungroundedNumbers("Save 20% on 3 visits", "3 visits a year"), ["20"]);
});

test("scenes are timed to the voiceover, or to reading time without one", () => {
  const facts = businessFacts({ lead, niche: getNiche("hvac") });
  const { scenes } = templateStory(input(facts));
  const est = estimateTiming(scenes);
  assert.equal(est.starts.length, scenes.length);
  assert.equal(est.starts[0], 0);
  assert.ok(est.starts.every((t, i) => i === 0 || t > est.starts[i - 1]));
  assert.ok(est.total >= scenes.length * 3 && est.total <= scenes.length * 7);

  const { text, offsets } = narration(scenes);
  assert.equal(offsets[0], 0);
  assert.equal(text.slice(offsets[1], offsets[1] + 10), scenes[1].voiceover.slice(0, 10));
  const chars = [...text];
  const alignment = { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.05), character_end_times_seconds: chars.map((_, i) => i * 0.05 + 0.05) };
  const t = alignedTiming(offsets, alignment);
  assert.equal(t.starts[0], 0);
  assert.equal(t.starts[1], Math.round((offsets[1] * 0.05 - 0.15) * 100) / 100);
  assert.ok(t.total > alignment.character_end_times_seconds.at(-1)!);
});

test("the email footer is added once", () => {
  const a = { name: "Rain Co", owner: "Craig" };
  const once = withFooter("Hi,\n\nWatch it: {{video_link}}", a);
  assert.equal(withFooter(once, a), once);
  assert.match(once, /Craig\nRain Co\n\[agency postal address\]/);
});

test("the template script ties each product to the gap it fixes, and stays short", () => {
  const facts = businessFacts({ lead, niche: getNiche("hvac") });
  const story = templateStory(input(facts));
  const receptionist = story.scenes.find((s) => s.productId === "ai-receptionist")!;
  assert.equal(receptionist.voiceover, "No online booking? AI receptionist answers every call, day and night.");
  assert.equal(productLine("Voiceovers", "Radio-quality voiceovers without the studio."), "Voiceovers: Radio-quality voiceovers without the studio.");
  assert.equal(productLine("Website agent", "Turns website visitors into booked customers."), "Website agent turns website visitors into booked customers.");
  assert.equal(receptionist.sub, "Fixes: no online booking");
  const problem = story.scenes.find((s) => s.kind === "problem")!;
  assert.equal(problem.headline, "Slow website");
  assert.equal(problem.voiceover, "One thing we noticed: slow website. Your homepage took 4.2 seconds to respond in our check.");
  assert.equal(story.scenes.at(-1)!.headline, "Ready when you are");
  const words = story.scenes.map((s) => s.voiceover).join(" ").split(/\s+/).length;
  assert.ok(words <= 130, `about 45 seconds of narration at most (${words} words)`);
});

test("the template email opens with a real finding, spoken to them", () => {
  const facts = businessFacts({ lead, niche: getNiche("hvac") });
  const { email } = templateStory(input(facts));
  assert.match(email.body, /It starts with something we noticed: your homepage took 4\.2 seconds to respond in our check\. Then it shows how AI receptionist and Website assistant would help\./);
});
