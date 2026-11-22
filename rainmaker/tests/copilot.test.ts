import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIDE, searchGuide } from "../src/lib/copilot/guide.ts";
import { COPILOT_CRM_TOOLS, SCREENS, matchScreen, screenById, screenForPath } from "../src/lib/copilot/screens.ts";
import { buildAppState } from "../src/lib/copilot/state.ts";
import { seedDb } from "../src/lib/seed.ts";
import type { Integrations } from "../src/lib/config.ts";

const NO_KEYS: Integrations = {
  claude: false,
  model: "claude-opus-5-5",
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

test("spoken requests map to the right screen", () => {
  assert.equal(matchScreen("take me to the inbox")?.id, "inbox");
  assert.equal(matchScreen("open store and pricing please")?.id, "store_and_pricing");
  assert.equal(matchScreen("Go to Autopilot")?.id, "autopilot");
  assert.equal(matchScreen("show me the ad studio")?.id, "ad_studio");
  assert.equal(matchScreen("open the public store")?.id, "public_store");
  assert.equal(matchScreen("what's the weather"), undefined);
});

test("every path belongs to one screen", () => {
  assert.equal(screenForPath("/").id, "today");
  assert.equal(screenForPath("/pipeline?lead=lead_1").id, "pipeline");
  assert.equal(screenForPath("/sell").id, "store_and_pricing");
  assert.equal(screenForPath("/prospects?niche=dentist&go=1").id, "find_clients");
  assert.equal(screenForPath("/store/growth").id, "public_store");
  assert.equal(new Set(SCREENS.map((s) => s.path)).size, SCREENS.length);
  assert.equal(screenById("sales")?.path, "/sales");
});

test("the guide answers how-to questions", () => {
  assert.equal(new Set(GUIDE.map((t) => t.id)).size, GUIDE.length);
  assert.equal(searchGuide("How do I connect Stripe?")[0]?.id, "payments");
  assert.equal(searchGuide("autopilot")[0]?.id, "autopilot");
  assert.equal(searchGuide("which key turns on voice")[0]?.id, "keys");
  assert.equal(searchGuide("find_clients")[0]?.id, "find_clients");
  for (const t of GUIDE) assert.ok(t.text.length > 120 && t.text.length < 1600, `${t.id} guide length`);
});

test("the copilot reuses the agents' CRM tools", () => {
  assert.ok(COPILOT_CRM_TOOLS.includes("find_businesses"));
  assert.ok(!(COPILOT_CRM_TOOLS as readonly string[]).includes("send_email"), "no tool sends anything");
});

test("the app snapshot covers everything and stays small", () => {
  const db = seedDb({ withSamples: true });
  const s = buildAppState(db, NO_KEYS, { baseUrl: "https://agency.example", path: "/pipeline", now: new Date("2026-11-22T15:00:00Z") });
  assert.equal(s.screen, "Pipeline");
  assert.ok(s.pipeline.top_open_leads.length > 0);
  assert.equal(Object.keys(s.pipeline.leads_by_stage).length, 7);
  assert.equal(s.store.url, "https://agency.example/store");
  assert.ok(s.store.offers.some((o) => o.id === "plan-growth" && o.monthly === 597));
  assert.ok(s.store.offers.every((o) => o.page.startsWith("https://agency.example/store/")));
  assert.equal(s.connected.claude_ai, false);
  assert.equal(typeof s.autopilot.on, "boolean");
  assert.ok(s.sample_data_present);
  const size = JSON.stringify(s).length;
  assert.ok(size < 20_000, `snapshot is ${size} bytes`);
});
