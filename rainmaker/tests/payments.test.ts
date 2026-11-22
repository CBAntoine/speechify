import { test } from "node:test";
import assert from "node:assert/strict";
import { formEncode, monthlyEquivalent, paypalAmount, paypalPlanKey, salesStats, signStripePayload, toCents, verifyStripeSignature } from "../src/lib/payments/encode.ts";
import type { Order } from "../src/lib/types.ts";
import { onboardingTasks, plannedSteps } from "../src/lib/payments/steps.ts";
import { OFFERS, getOffer } from "../src/lib/catalog.ts";

test("formEncode nests objects and arrays the way Stripe expects", () => {
  const s = formEncode({
    mode: "subscription",
    line_items: [{ price_data: { currency: "usd", unit_amount: 29700, recurring: { interval: "month" }, product_data: { name: "Launch & more" } }, quantity: 1 }],
    metadata: { order_id: "ord_1" },
    allow_promotion_codes: true,
    skipped: undefined,
    nothing: null,
  });
  assert.equal(
    decodeURIComponent(s),
    "mode=subscription&line_items[0][price_data][currency]=usd&line_items[0][price_data][unit_amount]=29700&line_items[0][price_data][recurring][interval]=month&line_items[0][price_data][product_data][name]=Launch & more&line_items[0][quantity]=1&metadata[order_id]=ord_1&allow_promotion_codes=true"
  );
  assert.ok(s.includes("Launch%20%26%20more"), "values are escaped");
});

test("Stripe signatures verify, and tampering, wrong secrets and replays fail", () => {
  const body = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
  const secret = "whsec_test_123";
  const now = 1_795_000_000;
  const header = signStripePayload(body, secret, now);
  assert.equal(verifyStripeSignature(body, header, secret, now), true);
  assert.equal(verifyStripeSignature(body + " ", header, secret, now), false, "body changed");
  assert.equal(verifyStripeSignature(body, header, "whsec_other", now), false, "wrong secret");
  assert.equal(verifyStripeSignature(body, header, secret, now + 301), false, "too old");
  assert.equal(verifyStripeSignature(body, null, secret, now), false);
  assert.equal(verifyStripeSignature(body, "t=abc,v1=zz", secret, now), false);
  // Stripe sends several v1 signatures while a secret is being rolled.
  const rolled = `${header},v1=${"0".repeat(64)}`;
  assert.equal(verifyStripeSignature(body, rolled, secret, now), true);
});

test("money helpers", () => {
  assert.equal(toCents(297), 29700);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(paypalAmount(5970), "5970.00");
  assert.equal(paypalAmount(19.999), "20.00");
  assert.equal(paypalPlanKey("plan-growth", "year", 5970, 0, "usd"), "plan-growth:year:5970.00:0.00:USD");
  assert.equal(monthlyEquivalent({ amount: 5970, interval: "year" }), 497.5);
});

test("salesStats counts MRR, this month's revenue and churn", () => {
  const now = new Date("2026-11-22T12:00:00Z");
  const o = (patch: Partial<Order>): Order => ({
    id: Math.random().toString(36), provider: "stripe", offerId: "x", offerName: "X", interval: "month", amount: 297, setupFee: 0, currency: "usd",
    status: "active", payments: [], createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...patch,
  });
  const stats = salesStats(
    [
      o({ activatedAt: "2026-11-03T00:00:00Z", payments: [{ at: "2026-11-03T00:00:00Z", amount: 794 }] }),
      o({ interval: "year", amount: 5970, activatedAt: "2026-10-01T00:00:00Z", payments: [{ at: "2026-10-01T00:00:00Z", amount: 5970 }] }),
      o({ status: "canceled", canceledAt: "2026-11-10T00:00:00Z", payments: [{ at: "2026-10-10T00:00:00Z", amount: 297 }] }),
      o({ status: "pending" }),
      o({ status: "past_due", amount: 147 }),
    ],
    now
  );
  assert.deepEqual(stats, { mrr: 297 + 497.5 + 147, active: 3, pending: 1, newThisMonth: 1, churnedThisMonth: 1, revenueThisMonth: 794, lifetimeRevenue: 794 + 5970 + 297 });
});


test("fulfillment plans match what each offer includes", () => {
  assert.deepEqual(plannedSteps(getOffer("plan-launch")!).map((s) => s.id), ["agent", "tasks", "welcome"]);
  assert.deepEqual(plannedSteps(getOffer("plan-growth")!).map((s) => s.id), ["agent", "campaign", "tasks", "welcome"]);
  assert.deepEqual(plannedSteps(getOffer("captions")!).map((s) => s.id), ["tasks", "welcome"]);
  for (const o of OFFERS) assert.ok(onboardingTasks(o).length >= 1, `${o.id} has no onboarding tasks`);
  const scale = onboardingTasks(getOffer("plan-scale")!);
  assert.ok(scale.some((t) => t.includes("WhatsApp")) && scale.some((t) => t.includes("podcast")));
  assert.equal(new Set(scale).size, scale.length);
});
