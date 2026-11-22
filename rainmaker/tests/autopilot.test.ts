import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAY_MS, abandonedCheckouts, canAutoSend, defaultAutopilotConfig, dueFollowUps, nextTarget, ordersToFulfill, pickForOutreach, sanitizeConfig,
} from "../src/lib/autopilot/plan.ts";
import type { Draft, Lead, Order } from "../src/lib/types.ts";

const NOW = Date.parse("2026-11-22T15:00:00Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY_MS).toISOString();

function lead(id: string, patch: Partial<Lead> = {}): Lead {
  return { id, name: id, niche: "dentist", source: "openstreetmap", stage: "new", score: 75, createdAt: iso(1), updatedAt: iso(1), ...patch };
}
function draft(leadId: string, patch: Partial<Draft> = {}): Draft {
  return { id: `d_${leadId}_${Math.random()}`, leadId, channel: "email", body: "hi", status: "pending", createdBy: "agent:autopilot", createdAt: iso(1), ...patch };
}

test("nextTarget rotates through every niche × city pair", () => {
  const config = { ...defaultAutopilotConfig(), cities: ["Toronto, ON", "Ottawa, ON"], niches: [] };
  const seen: string[] = [];
  let cursor = 0;
  for (let i = 0; i < 4; i++) {
    const t = nextTarget(config, ["dentist", "roofer"], cursor)!;
    seen.push(`${t.niche}@${t.city}`);
    cursor = t.nextCursor;
  }
  assert.deepEqual(seen, ["dentist@Toronto, ON", "roofer@Toronto, ON", "dentist@Ottawa, ON", "roofer@Ottawa, ON"]);
  assert.equal(nextTarget(config, ["dentist"], 999)?.city, "Ottawa, ON");
  assert.equal(nextTarget({ ...config, cities: [] }, ["dentist"], 0), null);
  assert.equal(nextTarget(config, [], 0), null);
});

test("pickForOutreach takes the best new leads nobody has written to", () => {
  const leads = [lead("a", { score: 62 }), lead("b", { score: 90 }), lead("c", { score: 40 }), lead("d", { score: 80, stage: "contacted" }), lead("e", { score: 99, sample: true }), lead("f", { score: 85 })];
  const picked = pickForOutreach(leads, [draft("f")], { minScore: 60, personalizePerRun: 2 }).map((l) => l.id);
  assert.deepEqual(picked, ["b", "a"]);
});

test("follow-ups come due by day offset after the first sent email", () => {
  const sequence = [
    { dayOffset: 3, subject: "re", body: "2" },
    { dayOffset: 7, subject: "re", body: "3" },
  ];
  const due = lead("due", { stage: "contacted", sequence });
  const early = lead("early", { stage: "contacted", sequence });
  const replied = lead("replied", { stage: "replied", sequence });
  const waiting = lead("waiting", { stage: "contacted", sequence });
  const second = lead("second", { stage: "contacted", sequence: [{ ...sequence[0], draftedAt: iso(5) }, sequence[1]] });
  const drafts = [
    draft("due", { status: "sent", sentAt: iso(4) }),
    draft("early", { status: "sent", sentAt: iso(1) }),
    draft("replied", { status: "sent", sentAt: iso(9) }),
    draft("waiting", { status: "sent", sentAt: iso(9) }),
    draft("waiting", { status: "pending" }),
    draft("second", { status: "sent", sentAt: iso(8) }),
  ];
  const result = dueFollowUps([due, early, replied, waiting, second], drafts, NOW).map((d) => `${d.lead.id}:${d.step}`);
  assert.deepEqual(result, ["due:0", "second:1"]);
});

test("auto-send only lets compliant emails through", () => {
  const profile = { mailingAddress: "12 Main St, Mississauga, ON L5B 1M2" };
  const config = { autoSend: true, dailySendCap: 5 };
  const body = "Hi Sam,\n...\nSam, Acme Agency\n12 Main St, Mississauga, ON L5B 1M2\nNot interested? Reply 'no' and I won't follow up.";
  const ok = { channel: "email" as const, to: "owner@clinic.example", subject: "your missed calls", body, status: "pending" as const };
  assert.deepEqual(canAutoSend(ok, profile, config, 0, true), { ok: true });
  assert.equal(canAutoSend(ok, profile, { ...config, autoSend: false }, 0, true).ok, false);
  assert.equal(canAutoSend(ok, profile, config, 0, false).ok, false, "needs Resend");
  assert.equal(canAutoSend({ ...ok, channel: "sms" }, profile, config, 0, true).ok, false, "never texts");
  assert.equal(canAutoSend({ ...ok, to: "nope" }, profile, config, 0, true).ok, false);
  assert.equal(canAutoSend(ok, { mailingAddress: "" }, config, 0, true).ok, false, "needs a postal address");
  assert.equal(canAutoSend({ ...ok, body: body.replace("12 Main St", "[agency postal address]") }, profile, config, 0, true).ok, false, "placeholder");
  assert.equal(canAutoSend({ ...ok, body: body.replace(/Not interested.*$/, "") }, profile, config, 0, true).ok, false, "opt-out line");
  assert.equal(canAutoSend(ok, profile, config, 5, true).ok, false, "daily cap");
});

test("sanitizeConfig clamps numbers and drops junk", () => {
  const base = defaultAutopilotConfig();
  const c = sanitizeConfig({ leadsPerRun: 500, minScore: -3, cities: [" Toronto, ON ", "", "Toronto, ON"], autoSend: "yes" as unknown as boolean }, base);
  assert.equal(c.leadsPerRun, 40);
  assert.equal(c.minScore, 0);
  assert.deepEqual(c.cities, ["Toronto, ON"]);
  assert.equal(c.autoSend, false);
});

test("orders to fulfill and abandoned checkouts", () => {
  const o = (id: string, patch: Partial<Order>): Order => ({
    id, provider: "stripe", offerId: "plan-launch", offerName: "Launch", interval: "month", amount: 297, setupFee: 497, currency: "usd",
    status: "active", payments: [], createdAt: iso(2), updatedAt: iso(2), ...patch,
  });
  const orders = [
    o("new", {}),
    o("queued", { fulfillment: { status: "queued", steps: [], updatedAt: iso(1) } }),
    o("done", { fulfillment: { status: "done", steps: [], updatedAt: iso(1) } }),
    o("pending", { status: "pending", email: "a@b.example" }),
    o("fresh", { status: "pending", email: "a@b.example", createdAt: iso(0.2) }),
    o("noemail", { status: "pending" }),
  ];
  assert.deepEqual(ordersToFulfill(orders).map((x) => x.id), ["new", "queued"]);
  assert.deepEqual(abandonedCheckouts(orders, NOW).map((x) => x.id), ["pending"]);
});
