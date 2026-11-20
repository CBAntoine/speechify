import { test } from "node:test";
import assert from "node:assert/strict";
import { campaignIssues, charCount, enforceLimits, fitTo, googleAdsCsv, LIMITS } from "../src/lib/ads/limits.ts";
import type { AdCampaign } from "../src/lib/types.ts";

test("fitTo cuts at a word boundary and drops dangling punctuation", () => {
  assert.equal(fitTo("Botox in Scottsdale", 30), "Botox in Scottsdale");
  const cut = fitTo("Same-Day Emergency Dental Appointments Available Now", 30);
  assert.ok(charCount(cut) <= 30, cut);
  assert.ok(!cut.endsWith(" "));
  assert.equal(fitTo("Fast, friendly, local, trusted", 23), "Fast, friendly, local");
});

test("emoji count as one character", () => {
  assert.equal(charCount("⭐⭐⭐"), 3);
});

function campaign(): AdCampaign {
  return {
    id: "c1",
    businessName: 'Brightside "Family" Dental, Austin',
    niche: "dentist",
    goal: "Book appointments",
    createdAt: "",
    createdBy: "user",
    strategy: { summary: "", audience: "", angles: [], budget: "", kpis: [] },
    meta: [{ angle: "a", primaryText: "p", headline: "A headline that is definitely longer than forty characters", description: "d", cta: "Book Now", creativeIdea: "" }],
    google: {
      headlines: ["Dentist in Austin", "Dentist in Austin", "A really long headline that exceeds the limit", ...Array.from({ length: 16 }, (_, i) => `Headline ${i}`)],
      descriptions: ["x".repeat(95), "ok"],
      keywords: ["dentist austin"],
      negativeKeywords: ["jobs"],
    },
    video: [],
    landing: { headline: "", subheadline: "", bullets: [], cta: "" },
    creative: { headline: "", subline: "", badge: "", cta: "", palette: { bg: "#000000", fg: "#ffffff", accent: "#ff0000" } },
  };
}

test("campaignIssues lists every asset over its limit", () => {
  const where = campaignIssues(campaign()).map((i) => i.where);
  assert.ok(where.includes("Google headline 3"));
  assert.ok(where.includes("Google description 1"));
  assert.ok(where.includes("Meta ad 1 headline"));
});

test("enforceLimits makes a campaign valid for upload", () => {
  const c = enforceLimits(campaign());
  assert.equal(campaignIssues(c).length, 0);
  assert.ok(c.google.headlines.length <= LIMITS.googleHeadlinesMax);
  assert.equal(new Set(c.google.headlines).size, c.google.headlines.length, "duplicates removed");
});

test("Google Ads CSV quotes cells with commas and quotes", () => {
  const csv = googleAdsCsv(enforceLimits(campaign()), "https://brightside.example");
  const [header, row] = csv.split("\n");
  assert.ok(header.startsWith("Campaign,Ad group,Headline 1"));
  assert.ok(row.startsWith('"Brightside ""Family"" Dental, Austin - Search"'));
  assert.ok(csv.includes("Negative Phrase"));
});
