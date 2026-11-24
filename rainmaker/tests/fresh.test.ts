import { test } from "node:test";
import assert from "node:assert/strict";
import { elevenResourcesOf, isClient, planFresh, startFresh } from "../src/lib/fresh.ts";
import { sampleDb } from "./fixtures/samples.ts";
import type { Order } from "../src/lib/types.ts";

const AT = "2026-11-24T10:00:00Z";

function fixture() {
  const db = sampleDb();
  const [a, b] = db.leads;
  // a: an ordinary lead with a demo receptionist and an AI guide.
  a.sample = false;
  a.demo = { agentId: "agent_demo_a", token: "tok_aaaaaaaaaa", createdAt: AT, knowledgeBaseId: "kb_demo_a" };
  a.guide = { agentId: "agent_guide_a", token: "tok_bbbbbbbbbb", createdAt: AT, name: "Ava", knowledge: [{ id: "kb_guide_a", name: "site" }], pages: [], faqs: 0, questions: [] };
  // b: a paying client whose demo became their live receptionist.
  b.sample = false;
  b.clientAgentId = "agent_live_b";
  b.demo = { agentId: "agent_live_b", token: "tok_cccccccccc", createdAt: AT };
  db.orders = [{ id: "ord_1", leadId: b.id, status: "active" } as Order];
  db.drafts.push({ ...db.drafts[0], id: "draft_a", sample: false, leadId: a.id, status: "sent" });
  db.drafts.push({ ...db.drafts[0], id: "draft_b", sample: false, leadId: b.id });
  db.tasks.push({ id: "task_a", title: "Follow up", leadId: a.id, done: false, createdBy: "user", createdAt: AT });
  db.tasks.push({ id: "task_mine", title: "Call the accountant", done: false, createdBy: "user", createdAt: AT });
  db.activity.push({ id: "act_b", at: AT, kind: "stage", text: "b signed", leadId: b.id });
  return { db, a, b };
}

test("start fresh deletes every lead and what hangs off it; paying clients, orders and settings stay", () => {
  const { db, a, b } = fixture();
  assert.ok(isClient(db, b) && !isClient(db, a));
  const plan = planFresh(db);
  assert.equal(plan.leads, db.leads.length - 1);
  assert.deepEqual(plan.keptClients, [b.name]);
  assert.deepEqual([...plan.agents].sort(), ["agent_demo_a", "agent_guide_a"]);
  assert.deepEqual([...plan.knowledge].sort(), ["kb_demo_a", "kb_guide_a"]);
  const profile = JSON.stringify(db.profile);
  const store = JSON.stringify(db.store);

  assert.deepEqual(startFresh(db), plan, "does what it planned");
  assert.deepEqual(db.leads.map((l) => l.id), [b.id]);
  assert.deepEqual(db.drafts.map((d) => d.id), ["draft_b"], "sample drafts and the deleted lead's drafts (sent too) are gone");
  assert.deepEqual(db.tasks.map((t) => t.id), ["task_mine"], "tasks of no lead stay");
  assert.ok(db.campaigns.every((c) => !c.sample));
  assert.ok(db.activity.some((x) => x.id === "act_b") && !db.activity.some((x) => x.id.startsWith("act_s")));
  assert.equal(db.orders.length, 1);
  assert.equal(JSON.stringify(db.profile), profile);
  assert.equal(JSON.stringify(db.store), store);
  assert.equal(planFresh(db).leads, 0, "nothing left to delete");
});

test("a client's live receptionist is never deleted", () => {
  const { b } = fixture();
  assert.deepEqual(elevenResourcesOf(b), { agents: [], knowledge: [] });
  assert.deepEqual(elevenResourcesOf({ ...b, clientAgentId: undefined }).agents, ["agent_live_b"], "a demo that never went live is just a demo");
});

test("leads whose order was cancelled or never paid are not clients", () => {
  const { db, b } = fixture();
  db.orders = [{ id: "o", leadId: b.id, status: "canceled" } as Order, { id: "p", leadId: b.id, status: "pending" } as Order];
  b.clientAgentId = undefined;
  assert.equal(isClient(db, b), false);
  assert.equal(planFresh(db).keptClients.length, 0);
});
