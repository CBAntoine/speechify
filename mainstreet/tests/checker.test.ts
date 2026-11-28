import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ms-check-"));
process.env.QUIET = "1";

const { validateSpec, checkHtml, emailProblems } = await import("../src/crew/checker.ts");
const { demoSpec } = await import("../src/crew/builder.ts");
const { patchSettings } = await import("../src/db.ts");
const { verifyStripeSignature } = await import("../src/providers/stripe.ts");
const { stripQuoted } = await import("../src/api/webhooks.ts");
const { PALETTE_IDS, FONT_PAIR_IDS, ICON_NAMES, VARIANT_IDS } = await import("../src/design-ids.ts");
const { PALETTES, FONT_PAIRS, ICONS } = await import("../src/site/design.ts");
const { VARIANTS } = await import("../src/site/render.ts");
import crypto from "node:crypto";
import type { Lead } from "../src/types.ts";

const now = new Date().toISOString();
const lead: Lead = {
  id: "ld_x", source: "demo", sourceId: "x", name: "Cascade Dental", niche: "dentist", city: "Bend", region: "OR", country: "US", status: "diagnosed",
  priceCents: 50000, followupsSent: 0, createdAt: now, updatedAt: now, phone: "(541) 555-0134", rating: 4.9, reviewCount: 212,
  reviews: [{ author: "Sarah K.", rating: 5, text: "The team made my daughter's first cleaning easy. Friendly, on time and they explained everything." }],
};

test("invented testimonials and claims are removed; real ones stay", () => {
  const spec = demoSpec(lead);
  spec.testimonials = [
    { quote: "Friendly, on time and they explained everything.", author: "someone", rating: 5 },
    { quote: "Best dentist in the whole state, 30 years of excellence!", author: "Fake Person", rating: 5 },
  ];
  spec.about.body = "Cascade Dental cares for families in Bend. Established in 1985, we have won many awards.";
  spec.highlights = [{ label: "30 years experience", detail: "since 1995" }];
  const { spec: safe, problems } = validateSpec(spec, lead);
  assert.equal(safe.testimonials.length, 1);
  assert.equal(safe.testimonials[0].author, "Sarah K.");
  assert.ok(!/1985|award/i.test(safe.about.body));
  assert.ok(!safe.highlights.some((h) => /30 years/.test(h.label)));
  assert.equal(safe.highlights.length, 3);
  assert.ok(problems.length >= 3);
});

test("rendered pages with empty values are caught", () => {
  assert.deepEqual(checkHtml("<p>Call us</p>"), []);
  assert.equal(checkHtml("<p>Open undefined</p>").length, 1);
  assert.equal(checkHtml("<a href='{proposal_link}'>x</a>").length, 1);
});

test("emails need the postal address and an unsubscribe link", () => {
  patchSettings({ owner: { postalAddress: "10 King St, Kingston, ON", name: "Alex" } });
  assert.ok(emailProblems("Hi there").length >= 2);
  assert.deepEqual(emailProblems("Hi\n—\nAlex\n10 King St, Kingston, ON\nUnsubscribe: https://x.com/u/abc123"), []);
  assert.ok(emailProblems("Hi {proposal_link}\n10 King St, Kingston, ON\nhttps://x.com/u/abc123").some((p) => /placeholder/.test(p)));
});

test("stripe signatures are verified", () => {
  const secret = "whsec_test";
  const body = '{"id":"evt_1"}';
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret), true);
  assert.equal(verifyStripeSignature(body, `t=${t},v1=${"0".repeat(64)}`, secret), false);
  assert.equal(verifyStripeSignature(body, `t=${t - 3600},v1=${sig}`, secret), false);
});

test("quoted email history is stripped", () => {
  assert.equal(stripQuoted("Sounds good, how do I pay?\n\nOn Tue, Nov 25, 2026 at 9:00 AM Sam wrote:\n> Hi there\n> ..."), "Sounds good, how do I pay?");
});

test("design ids match the renderer", () => {
  assert.deepEqual([...PALETTE_IDS].sort(), Object.keys(PALETTES).sort());
  assert.deepEqual([...FONT_PAIR_IDS].sort(), Object.keys(FONT_PAIRS).sort());
  assert.deepEqual([...ICON_NAMES].sort(), Object.keys(ICONS).sort());
  assert.deepEqual([...VARIANT_IDS].sort(), VARIANTS.map((v) => v.id).sort());
});
