import { test } from "node:test";
import assert from "node:assert/strict";
import { brandColor, inkOn } from "../src/lib/offers/brand-color.ts";
import { answerLooksUnsure, demoQuestions, guideFirstMessage, guideNameFor, guidePitch, guidePrompt, questionsPrompt } from "../src/lib/offers/guide-content.ts";
import { estimateGuideRoi, intentFor, leadValueFor, MAX_RETAINER, MIN_RETAINER } from "../src/lib/offers/guide-math.ts";
import {
  buildKbText,
  dominantColor,
  extractBrand,
  extractFaqs,
  faqsFromText,
  luminance,
  pageContent,
  pageLinks,
  rankPages,
  serviceNames,
} from "../src/lib/offers/site-kb-parse.ts";
import { buildAppState } from "../src/lib/copilot/state.ts";
import { COPILOT_CRM_TOOLS } from "../src/lib/copilot/screens.ts";
import { seedDb } from "../src/lib/seed.ts";
import type { Integrations } from "../src/lib/config.ts";

test("ROI: 5% chat, 2.5% become leads, a tenth of their value as the retainer", () => {
  const r = estimateGuideRoi({ monthlyVisitors: 3000, leadValue: 350 });
  assert.equal(r.chats, 150);
  assert.equal(r.leads, 75);
  assert.equal(r.value, 26_250);
  assert.equal(r.price.monthly, 2650, "26,250 × 10%, to the nearest $50");
  assert.equal(r.price.plus, false);
  assert.equal(r.price.setup, 0);
});

test("ROI: the retainer stays between $300 and $4,000+, setup fees follow the site's size", () => {
  assert.equal(estimateGuideRoi({ monthlyVisitors: 200, leadValue: 100 }).price.monthly, MIN_RETAINER);
  const big = estimateGuideRoi({ monthlyVisitors: 40_000, leadValue: 600 });
  assert.equal(big.price.monthly, MAX_RETAINER);
  assert.ok(big.price.plus, "flags that the value supports more");
  assert.equal(estimateGuideRoi({ monthlyVisitors: 1000, leadValue: 100, pages: 40 }).price.setup, 1000);
  assert.equal(estimateGuideRoi({ monthlyVisitors: 1000, leadValue: 100, pages: 120 }).price.setup, 2500);
  assert.equal(estimateGuideRoi({ monthlyVisitors: 0, leadValue: 100 }).leads, 0);
  assert.equal(estimateGuideRoi({ monthlyVisitors: -5, leadValue: Number.NaN }).visitors, 0);
});

test("need-to-have niches first, want-to-have last, sensible defaults", () => {
  assert.equal(intentFor("hvac"), "urgent");
  assert.equal(intentFor("med_spa"), "elective");
  assert.equal(intentFor("unknown_niche"), "considered");
  assert.equal(leadValueFor("roofer"), 600);
  assert.equal(leadValueFor(undefined), 150);
});

const SITE = `<!doctype html><html><head>
  <title>Arctic Air Heating &amp; Cooling | Calgary Furnace Repair</title>
  <meta name="description" content="Same-day furnace and AC repair in Calgary since 1998.">
  <meta property="og:image" content="/img/van.jpg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <style>.btn-primary{background:#d4380d}.hero a{color:#d4380d}.x{color:#eeeeee}</style>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
    {"@type":"Question","name":"Do you offer financing?","acceptedAnswer":{"@type":"Answer","text":"<p>Yes, 0% for 12 months on new systems.</p>"}}]}</script>
  </head><body>
  <header><nav><a href="/">Home</a><a href="/services/furnace-repair">Furnace Repair</a><a href="/services/ac-installation">AC Installation</a>
  <a href="/faq">FAQ</a><a href="/pricing">Pricing</a><a href="/blog/tips">Blog</a><a href="/privacy">Privacy</a><a href="/brochure.pdf">Brochure</a>
  <a href="https://facebook.com/arctic">Facebook</a><a href="/contact#form">Contact us</a></nav>
  <img class="site-logo" src="/img/logo.svg" alt="Arctic Air"></header>
  <main><h1>Calgary's same-day furnace repair</h1>
  <h3>How fast can you come out?</h3><p>Usually within 4 hours, 7 days a week.</p>
  <p>We repair and install furnaces, air conditioners and heat pumps across Calgary.</p></main>
  <footer>© 2026 Arctic Air. Call (403) 555-0101.</footer></body></html>`;

test("site scan: same-site links, the useful pages first", () => {
  const links = pageLinks(SITE, "https://arcticair.ca/");
  assert.ok(links.every((l) => l.url.startsWith("https://arcticair.ca/")), "no off-site links");
  assert.ok(!links.some((l) => l.url.endsWith(".pdf")), "no files");
  assert.ok(links.some((l) => l.url === "https://arcticair.ca/contact"), "anchors dropped");
  const ranked = rankPages(links, "https://arcticair.ca/");
  assert.equal(ranked[0], "https://arcticair.ca/faq");
  assert.ok(ranked.includes("https://arcticair.ca/pricing"));
  assert.ok(!ranked.some((u) => /blog|privacy/.test(u)), "skips blog and legal pages");
  assert.ok(!ranked.includes("https://arcticair.ca/"), "home is read already");
  assert.deepEqual(serviceNames(links), ["Furnace Repair", "AC Installation"]);
});

test("site scan: FAQs from structured data and from question headings", () => {
  const faqs = extractFaqs(SITE);
  assert.deepEqual(faqs[0], { q: "Do you offer financing?", a: "Yes, 0% for 12 months on new systems." });
  assert.ok(faqs.some((f) => f.q === "How fast can you come out?" && f.a.startsWith("Usually within 4 hours")));
});

test("site scan: brand from the page, colour from the styles when there's no theme colour", () => {
  const b = extractBrand(SITE, "https://arcticair.ca/");
  assert.equal(b.name, "Arctic Air Heating & Cooling");
  assert.equal(b.logo, "https://arcticair.ca/img/logo.svg", "the logo image beats the site icon");
  assert.equal(b.image, "https://arcticair.ca/img/van.jpg");
  assert.equal(b.headline, "Calgary's same-day furnace repair");
  assert.equal(b.tagline, "Same-day furnace and AC repair in Calgary since 1998.");
  assert.equal(b.color, "#d4380d");
  const themed = extractBrand(`<meta name="theme-color" content="#0b5394"><link rel="icon" href="/favicon.png">`, "https://x.ca/");
  assert.equal(themed.color, "#0b5394");
  assert.equal(themed.logo, "https://x.ca/favicon.png");
  assert.equal(extractBrand(`<meta name="theme-color" content="#ffffff">`, "https://x.ca/").color, undefined, "white is no brand colour");
  assert.equal(dominantColor(`<div style="color:#333333;background:#fafafa"></div>`), undefined, "greys don't count");
});

test("site scan: page text without menus, knowledge base capped", () => {
  const p = pageContent(SITE, "https://arcticair.ca/");
  assert.ok(p.text.includes("heat pumps across Calgary"));
  assert.ok(!p.text.includes("Brochure"), "no nav");
  assert.ok(!p.text.includes("555-0101"), "no footer");
  const kb = buildKbText({ business: "Arctic Air", facts: ["Phone: (403) 555-0101"], faqs: extractFaqs(SITE), pages: [p] });
  assert.ok(kb.startsWith("# Arctic Air\nPhone: (403) 555-0101"));
  assert.ok(kb.includes("Q: Do you offer financing?"));
  const long = buildKbText({ business: "X", facts: [], faqs: [], pages: [{ url: "u", text: "word ".repeat(50_000) }] }, 1000, 500);
  assert.ok(long.length <= 1000);
});

test("pasted details: questions and their answers", () => {
  const faqs = faqsFromText("We fix furnaces.\n\nQ: Do you work weekends?\nA: Yes, Saturdays 8 to 4.\n\n1. Are you licensed?\nFully licensed and insured.\nNot a question\nWhat?");
  assert.deepEqual(faqs, [
    { q: "Do you work weekends?", a: "Yes, Saturdays 8 to 4." },
    { q: "Are you licensed?", a: "Fully licensed and insured. Not a question" },
  ]);
});

test("brand colours: readable text, a neutral fallback", () => {
  assert.equal(brandColor("#ffffff"), "#1c1917");
  assert.equal(brandColor("red"), "#1c1917");
  assert.equal(brandColor("#0b5394"), "#0b5394");
  assert.equal(inkOn("#0b5394"), "#ffffff");
  assert.equal(inkOn("#ffd400"), "#111111");
  assert.ok(luminance("#000000") < 0.01 && luminance("#ffffff") > 0.99);
});

test("the guide says it's an AI, shares tracked links, never guesses", () => {
  const name = guideNameFor("Arctic Air");
  assert.equal(name, guideNameFor("Arctic Air"), "stable per business");
  assert.match(guideFirstMessage(name, "Arctic Air"), /AI guide with Arctic Air/);
  const p = guidePrompt({ business: "Arctic Air", name, kind: "hvac company", city: "Calgary", bookingUrl: "https://arcticair.ca/book", agencyName: "Rain Co" }, "live");
  assert.match(p, /You are an AI, and you say so/);
  assert.match(p, /utm_source=ai-guide/);
  assert.match(p, /offer to text or email/);
  assert.match(p, /https:\/\/arcticair\.ca\/book/);
  assert.match(p, /Never guess/);
  assert.match(guidePrompt({ business: "A", name, kind: "x", agencyName: "Rain Co" }, "demo"), /This is a demo that Rain Co built/);
});

test("five demo questions: their FAQs, the urgent one, a service, pricing, a callback", () => {
  const qs = demoQuestions({ nicheId: "hvac", faqs: [{ q: "Do you offer financing?", a: "Yes" }], services: ["Furnace Repair"] });
  assert.equal(qs.length, 5);
  assert.equal(new Set(qs.map((q) => q.toLowerCase())).size, 5, "no repeats");
  assert.equal(qs[0], "Do you offer financing?");
  assert.ok(qs.includes("My furnace stopped working tonight. Can someone come out today?"));
  assert.ok(qs.includes("Tell me about your furnace repair."));
  assert.ok(qs.some((q) => /call me back/.test(q)), "shows lead capture");
  assert.equal(demoQuestions({ faqs: [] }).length, 5, "works with nothing known");
  assert.match(questionsPrompt("arcticair.ca"), /^I've just created a voice AI and a chat widget for arcticair\.ca\. What five questions/);
});

test("unsure answers are spotted for the upkeep report", () => {
  assert.ok(answerLooksUnsure("I'm not sure about that, I'll have the team confirm."));
  assert.ok(answerLooksUnsure("I don't have pricing for that."));
  assert.ok(!answerLooksUnsure("Yes, we offer 0% financing for 12 months."));
});

test("the pitch leads with more leads and the free trial, and links the demo", () => {
  const p = guidePitch({ business: "Arctic Air", firstName: "Dana", demoUrl: "https://app.example/guide/abc", agencyName: "Rain Co", senderName: "Craig", guideName: "Ava", monthly: 650, trialWeeks: 3 });
  assert.equal(p.email.subject, "10–20% more website leads for Arctic Air?");
  assert.match(p.email.body, /^Hi Dana,/);
  assert.match(p.email.body, /https:\/\/app\.example\/guide\/abc/);
  assert.match(p.email.body, /free for 3 weeks\. No credit card/);
  assert.ok(p.sms.length < 320);
  assert.match(p.callScript, /\$650 a month/);
  assert.match(p.callScript, /OBJECTIONS/);
});

const NO_KEYS: Integrations = {
  claude: false,
  model: "x",
  agentRuntime: "demo",
  googlePlaces: false,
  resend: false,
  runBudgetUsd: 3,
  elevenlabs: false,
  salesAgent: false,
  stripe: false,
  stripeMode: null,
  paypal: false,
  paypalMode: "sandbox",
  cron: false,
};

test("the copilot sees guides and trials, and has the guide tools", () => {
  const db = seedDb({ withSamples: true });
  const [a, b] = db.leads;
  const base = { agentId: "ag", token: "tok_1234567890", createdAt: "2026-11-01T00:00:00Z", name: "Ava", knowledge: [], pages: [], faqs: 0, questions: [] };
  a.guide = { ...base, trial: { domain: "a.ca", startedAt: "2026-11-10T00:00:00Z", endsAt: "2026-12-08T00:00:00Z" } };
  b.guide = { ...base, token: "tok_abcdefghijk", testedAt: "2026-11-02T00:00:00Z" };
  const s = buildAppState(db, NO_KEYS, { baseUrl: "https://agency.example" });
  assert.equal(s.ai_website_guides.built, 2);
  assert.deepEqual(s.ai_website_guides.live_trials, [{ lead_id: a.id, business: a.name, domain: "a.ca", trial_ends: "2026-12-08" }]);
  assert.equal(s.ai_website_guides.demos_not_yet_pitched_or_live[0].tested, true);
  for (const t of ["estimate_ai_guide", "build_ai_guide", "test_ai_guide", "pitch_ai_guide", "start_ai_guide_trial", "ai_guide_report", "teach_ai_guide"]) {
    assert.ok((COPILOT_CRM_TOOLS as readonly string[]).includes(t), t);
  }
});
