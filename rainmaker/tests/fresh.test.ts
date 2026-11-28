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

test("starting fresh deletes the leads' video ads and lists their files to delete", () => {
  const { db, a, b } = fixture();
  const base = { token: "tok_video_xxxxx", business: "x", createdAt: AT, createdBy: "user", format: "vertical" as const, products: [], facts: [], scenes: [], timing: { starts: [], total: 0 }, email: { subject: "", body: "" }, writtenBy: "template" as const };
  db.videos = [
    { ...base, id: "video_a", leadId: a.id, brand: { color: "#000", ink: "#fff", logo: "asset_logo" }, voiceover: { assetId: "asset_voice", model: "m" } },
    { ...base, id: "video_b", leadId: b.id, brand: { color: "#000", ink: "#fff", photo: "asset_keep" } },
  ];
  const plan = planFresh(db);
  assert.equal(plan.videos, 1);
  assert.deepEqual([...plan.assets].sort(), ["asset_logo", "asset_voice"]);
  startFresh(db);
  assert.deepEqual(db.videos.map((v) => v.id), ["video_b"], "a paying client's video stays");
});

test("starting fresh deletes the leads' motion ads and their files, and keeps ads not made for a lead", () => {
  const { db, a } = fixture();
  const base = {
    business: "x",
    createdAt: AT,
    updatedAt: AT,
    createdBy: "user",
    format: "vertical" as const,
    brief: { goal: "g" },
    facts: [],
    concept: "",
    brand: { primary: "#000000", accent: "#ffffff", ink: "#ffffff", light: "#ffffff", dark: "#000000" },
    shots: [],
    status: "storyboard" as const,
    revisions: [],
    sound: { sfx: true, bed: "pulse" as const, music: 0.6, voice: true },
    writtenBy: "template" as const,
  };
  db.motion = [
    { ...base, id: "motion_a", leadId: a.id, assets: { logo: { id: "asset_mlogo", from: "website" as const }, photos: [{ id: "asset_mp1", from: "upload" as const }], music: { id: "asset_mtrack", name: "t" } }, voiceover: { assetId: "asset_mvoice", model: "m", text: "", segments: [] } },
    { ...base, id: "motion_typed", assets: { photos: [{ id: "asset_keep2", from: "upload" as const }] } },
  ];
  const plan = planFresh(db);
  assert.equal(plan.motion, 1);
  assert.ok(["asset_mlogo", "asset_mp1", "asset_mtrack", "asset_mvoice"].every((x) => plan.assets.includes(x)));
  assert.ok(!plan.assets.includes("asset_keep2"));
  startFresh(db);
  assert.deepEqual(db.motion.map((m) => m.id), ["motion_typed"]);
});
