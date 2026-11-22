import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ANNUAL_MONTHS, CATEGORIES, DEFAULT_STORE, OFFERS, PLANS, PRODUCTS, bundleWorth, getOffer, isVisible, margin, monthlyCost, priceOf, recommend,
} from "../src/lib/catalog.ts";

test("every offer has a unique id and slug and complete sales copy", () => {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const o of OFFERS) {
    assert.ok(!ids.has(o.id), `duplicate id ${o.id}`);
    assert.ok(!slugs.has(o.slug), `duplicate slug ${o.slug}`);
    ids.add(o.id);
    slugs.add(o.slug);
    assert.match(o.id, /^[a-z0-9-]+$/);
    assert.match(o.slug, /^[a-z0-9-]+$/);
    assert.ok(o.name && o.tagline && o.summary && o.example && o.timeToLive, `${o.id} copy`);
    assert.ok(o.included.length >= 2, `${o.id} included`);
    assert.ok(o.features.length >= 2, `${o.id} features`);
    assert.ok(o.howItWorks.length >= 2, `${o.id} howItWorks`);
    assert.ok(o.idealFor.length >= 2, `${o.id} idealFor`);
    assert.ok(o.faqs.length >= 1, `${o.id} faqs`);
    assert.ok(o.engine.length >= 1, `${o.id} engine`);
    assert.ok(o.monthly > 0 && Number.isInteger(o.monthly), `${o.id} monthly`);
    assert.ok(o.setup >= 0, `${o.id} setup`);
    assert.ok(o.costs.length >= 1, `${o.id} costs`);
  }
});

test("every product belongs to a known category and every ElevenLabs family is sold", () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  for (const p of PRODUCTS) assert.ok(cats.has(p.category as never), p.id);
  for (const c of CATEGORIES) assert.ok(PRODUCTS.some((p) => p.category === c.id), `nothing in ${c.id}`);
  const engines = PRODUCTS.flatMap((p) => p.engine).join(" ");
  for (const name of ["ElevenAgents", "Batch calling", "WhatsApp", "Realtime Translation", "Eleven v4", "Text to Dialogue", "Voice Design", "Professional Voice Cloning", "Dubbing", "Studio", "Audio Native", "Eleven Music", "Sound Effects", "Image & Video", "Scribe v3", "Forced Alignment", "Voice Isolator", "Voice Changer"]) {
    assert.ok(engines.includes(name), `no product uses ${name}`);
  }
});

test("plans bundle real products and are worth more than they cost", () => {
  for (const plan of PLANS) {
    assert.ok(plan.bundles?.length, plan.id);
    for (const id of plan.bundles!) assert.ok(getOffer(id)?.kind === "product", `${plan.id} bundles unknown ${id}`);
    assert.ok(bundleWorth(plan, DEFAULT_STORE) > plan.monthly, `${plan.id} should be cheaper than its parts`);
  }
  assert.equal(PLANS.filter((p) => p.highlight).length, 1, "exactly one most-popular plan");
  const prices = PLANS.map((p) => p.monthly);
  assert.deepEqual([...prices].sort((a, b) => a - b), prices, "plans are listed cheapest first");
});

test("default prices keep a healthy gross margin at full included usage", () => {
  for (const o of OFFERS) {
    const m = margin(o.monthly, monthlyCost(o));
    assert.ok(m >= 65, `${o.id} margin ${m}% at cost $${monthlyCost(o)}`);
  }
});

test("annual billing charges ten months and can waive setup", () => {
  const growth = getOffer("growth")!;
  const monthly = priceOf(growth, DEFAULT_STORE, "month");
  assert.equal(monthly.recurring, 597);
  assert.equal(monthly.setupCharged, 997);
  const yearly = priceOf(growth, DEFAULT_STORE, "year");
  assert.equal(yearly.recurring, 597 * ANNUAL_MONTHS);
  assert.equal(yearly.setupCharged, 0);
  assert.equal(yearly.annualSaving, 597 * 2);
  assert.equal(priceOf(growth, { ...DEFAULT_STORE, waiveSetupOnAnnual: false }, "year").setupCharged, 997);
});

test("owner price overrides win, bad values fall back, hidden offers hide", () => {
  const settings = { ...DEFAULT_STORE, prices: { "ai-receptionist": { monthly: 199.5, setup: -4, hidden: true } } };
  const offer = getOffer("ai-receptionist")!;
  const p = priceOf(offer, settings);
  assert.equal(p.monthly, 199.5);
  assert.equal(p.setup, offer.setup);
  assert.equal(isVisible(offer, settings), false);
  assert.equal(isVisible(getOffer("plan-launch")!, settings), true);
});

test("getOffer finds by id or slug, case-insensitively", () => {
  assert.equal(getOffer("plan-scale")?.slug, "scale");
  assert.equal(getOffer("SCALE")?.id, "plan-scale");
  assert.equal(getOffer("nope"), undefined);
  assert.equal(getOffer(undefined), undefined);
});

test("recommendations follow the audit findings and niche", () => {
  const recs = recommend({ niche: "dentist", signals: [{ id: "no_booking", label: "No online booking" }, { id: "no_chat", label: "No chat" }] }, 4);
  assert.equal(recs[0].offer.id, "ai-receptionist");
  assert.ok(recs.some((r) => r.offer.id === "website-agent"));
  assert.ok(recs.some((r) => r.offer.id === "multilingual"));
  const roofer = recommend({ niche: "roofer", signals: [{ id: "runs_ads", label: "Runs ads", positive: true }] }, 3).map((r) => r.offer.id);
  assert.deepEqual(roofer, ["ai-receptionist", "plan-growth", "follow-up-calls"]);
  assert.ok(recommend({}, 3).length >= 2, "always has a pitch");
  assert.equal(new Set(recommend({ niche: "roofer", signals: [{ id: "few_reviews", label: "" }] }, 9).map((r) => r.offer.id)).size, recommend({ niche: "roofer", signals: [{ id: "few_reviews", label: "" }] }, 9).length, "no duplicates");
});
