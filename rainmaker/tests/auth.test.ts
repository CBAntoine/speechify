import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicPath, makeSession, verifySession } from "../src/lib/auth.ts";

test("the storefront, demos, webhooks and cron are public", () => {
  for (const p of ["/store", "/store/launch", "/store/thanks", "/demo/abc123def456", "/api/store/checkout", "/api/store/voice", "/api/store/lead", "/api/payments/stripe/webhook", "/api/payments/paypal/webhook", "/api/cron/autopilot", "/robots.txt", "/login"]) {
    assert.equal(isPublicPath(p), true, p);
  }
});

test("the CRM and its APIs stay behind the sign-in", () => {
  for (const p of ["/", "/pipeline", "/sales", "/sell", "/autopilot", "/settings", "/storefront", "/stores", "/api/orders", "/api/orders/ord_1", "/api/payments/setup", "/api/leads", "/api/assets/asset_1", "/api/elevenlabs/agent", "/api/ads/generate", "/api/autopilot", "/api/storex", "/demo", "/api/copilot/tool", "/api/copilot/session", "/api/copilot/state", "/api/copilot/agent"]) {
    assert.equal(isPublicPath(p), false, p);
  }
});

test("sessions verify with the right password only", async () => {
  const { value } = await makeSession("hunter2", 1);
  assert.equal(await verifySession(value, "hunter2"), true);
  assert.equal(await verifySession(value, "other"), false);
  assert.equal(await verifySession(undefined, "hunter2"), false);
  assert.equal(await verifySession("1.abc", "hunter2"), false);
});
