import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSignals, scoreProspect, tierOf, topSignals } from "../src/lib/prospecting/score.ts";
import type { AuditResult } from "../src/lib/types.ts";

const base: AuditResult = {
  fetchedAt: "2026-11-20T00:00:00Z",
  reachable: true,
  https: true,
  responseMs: 900,
  mobileViewport: true,
  analytics: ["Google Analytics 4"],
  pixels: ["Meta Pixel"],
  booking: ["Zocdoc"],
  chat: ["Podium"],
  reviewsWidgets: [],
  hasContactForm: true,
  hasClickToCall: true,
  hasSchema: true,
  hasOgImage: true,
  copyrightYear: 2026,
  socials: ["Facebook"],
  emails: [],
  phones: [],
  title: "t",
  description: "d",
};
const NOW = new Date("2026-11-20T12:00:00Z");

test("a business with no website is a high-severity lead", () => {
  const s = deriveSignals({ phone: "1", booking: true, now: NOW });
  assert.equal(s[0].id, "no_website");
  assert.equal(s[0].severity, "high");
});

test("OpenStreetMap listings without a website get a verify-first warning", () => {
  const s = deriveSignals({ source: "openstreetmap", now: NOW });
  assert.match(s[0].detail ?? "", /Confirm before you pitch/);
});

test("a polished site has no sellable gaps, only positives", () => {
  const s = deriveSignals({ website: "https://x", audit: base, booking: true, reviewCount: 150, rating: 4.8, now: NOW });
  assert.deepEqual(topSignals(s), []);
  assert.ok(s.some((x) => x.id === "runs_ads" && x.positive));
  assert.ok(s.some((x) => x.id === "established" && x.positive));
});

test("each gap is detected", () => {
  const audit: AuditResult = { ...base, https: false, mobileViewport: false, responseMs: 7000, pixels: [], analytics: [], booking: [], chat: [], hasContactForm: false, hasClickToCall: false, hasSchema: false, copyrightYear: 2019, socials: [], title: undefined };
  const ids = deriveSignals({ website: "http://x", audit, booking: true, reviewCount: 8, rating: 3.9, now: NOW }).map((x) => x.id);
  for (const id of ["few_reviews", "low_rating", "no_https", "not_mobile", "slow", "no_booking", "no_pixel", "no_analytics", "no_chat", "stale_site", "no_form", "no_click_to_call", "weak_seo", "no_schema", "no_social"]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test("booking only matters for appointment-based niches", () => {
  const audit = { ...base, booking: [] };
  assert.ok(!deriveSignals({ website: "https://x", audit, booking: false, now: NOW }).some((x) => x.id === "no_booking"));
});

test("unreachable sites are flagged and not audited further", () => {
  const s = deriveSignals({ website: "https://x", audit: { ...base, reachable: false, error: "timed out" }, now: NOW });
  assert.deepEqual(s.map((x) => x.id), ["site_down"]);
});

test("need plus ability to pay ranks the right business first", () => {
  const weak = { website: "http://x", audit: { ...base, https: false, mobileViewport: false, booking: [], pixels: [] }, booking: true, reviewCount: 120, rating: 4.6, retainerMid: 2500, phone: "1", now: NOW };
  const strong = { website: "https://y", audit: base, booking: true, reviewCount: 120, rating: 4.6, retainerMid: 2500, phone: "1", now: NOW };
  assert.ok(scoreProspect(weak) > scoreProspect(strong));
  assert.ok(scoreProspect(weak) <= 100 && scoreProspect(strong) >= 0);
});

test("tiers", () => {
  assert.equal(tierOf(85).id, "hot");
  assert.equal(tierOf(50).id, "warm");
  assert.equal(tierOf(20).id, "cool");
  assert.equal(tierOf(undefined).label, "Unscored");
});
