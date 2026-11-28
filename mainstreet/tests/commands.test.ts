import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

// Commands run against a throwaway demo database.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ms-cmd-"));
process.env.DEMO = "1";
process.env.QUIET = "1";

const { runCommand, parseArgs, getCommand, listCommands } = await import("../src/commands/registry.ts");
await import("../src/commands/index.ts");
const { saveLead, getSettings, getLead, addMessage, addApproval, getApproval, messagesFor, isSuppressed } = await import("../src/db.ts");
const { patchSettings } = await import("../src/db.ts");

// Keep the crew still: some commands nudge it to start work right away, and
// a background pipeline would race these tests and hold a browser open.
patchSettings({ crew: { paused: true } });

test("voice-style arguments are coerced", () => {
  const def = getCommand("find_leads")!;
  const r = parseArgs(def, { limit: "5", status: "Pitched" });
  assert.ok(r.ok);
  assert.equal(r.ok && r.args.limit, 5);
  assert.equal(r.ok && r.args.status, "pitched");
  const bad = parseArgs(getCommand("decide_approval")!, { decision: "maybe" });
  assert.equal(bad.ok, false);
});

test("risky settings need a yes; harmless ones don't", async () => {
  const ask = await runCommand("update_setting", { path: "price", value: "750" }, { via: "voice" });
  assert.equal(ask.ok, false);
  assert.ok(ask.needsConfirmation?.summary.includes("$750"));
  assert.equal(getSettings().offer.priceCents, 50_000);
  const yes = await runCommand("update_setting", { path: "price", value: "750", confirmed: "yes" }, { via: "voice" });
  assert.equal(yes.ok, true);
  assert.equal(getSettings().offer.priceCents, 75_000);
  const harmless = await runCommand("update_setting", { path: "leads_per_day", value: "20" }, { via: "voice" });
  assert.equal(harmless.ok, true);
  assert.equal(getSettings().quotas.leadsPerDay, 20);
});

test("phone calls need the PIN for confirmed actions", async () => {
  const r = await runCommand("update_setting", { path: "price", value: "800", confirmed: true }, { via: "phone", pinOk: false });
  assert.equal(r.ok, false);
  assert.match(r.say, /PIN/);
  const ok = await runCommand("update_setting", { path: "price", value: "800", confirmed: true }, { via: "phone", pinOk: true });
  assert.equal(ok.ok, true);
});

test("leads are found by spoken name and outcomes are logged", async () => {
  const now = new Date().toISOString();
  saveLead({ id: "ld_test1", source: "manual", sourceId: "m1", name: "Bright Smile Family Dentistry", niche: "dentist", city: "Bend", region: "OR", country: "US", status: "pitched", priceCents: 50000, followupsSent: 0, createdAt: now, updatedAt: now, phone: "(541) 555-0134" });
  const found = await runCommand("get_lead", { lead: "bright smile" }, { via: "voice" });
  assert.equal(found.ok, true);
  assert.match(found.say, /Bright Smile Family Dentistry/);
  const logged = await runCommand("log_outcome", { lead: "bright smile", outcome: "called_interested", note: "call back Friday" }, { via: "voice" });
  assert.equal(logged.ok, true);
  assert.equal(getLead("ld_test1")!.status, "negotiating");
  assert.match(getLead("ld_test1")!.notes ?? "", /call back Friday/);
});

test("targets can be added by voice", async () => {
  const r = await runCommand("add_target", { city: "asheville", region: "nc", niche: "med spas" }, { via: "voice" });
  assert.equal(r.ok, true);
  const s = getSettings();
  assert.ok(s.targets.cities.some((c) => c.city === "Asheville" && c.region === "NC" && c.country === "US"));
  assert.ok(s.targets.niches.includes("med_spa"));
});

test("the briefing speaks plainly", async () => {
  const r = await runCommand("get_briefing", {}, { via: "voice" });
  assert.equal(r.ok, true);
  assert.ok(r.say.length > 20 && !/undefined|NaN|\[object/.test(r.say));
});

test("every command has a description, and confirm commands take confirmed", () => {
  for (const d of listCommands()) {
    assert.ok(d.description.length > 20, d.name);
    assert.match(d.name, /^[a-z_]{3,40}$/);
    if (d.risk === "confirm") assert.ok(d.params.confirmed, d.name);
  }
});

test("do-not-contact drops everything waiting and keeps paying clients won", async () => {
  const now = new Date().toISOString();
  const base = { source: "manual" as const, niche: "dentist", city: "Bend", region: "OR", country: "US" as const, priceCents: 50000, followupsSent: 0, createdAt: now, updatedAt: now };
  saveLead({ ...base, id: "ld_dnc1", sourceId: "m-dnc1", name: "Juniper Ridge Dental", status: "negotiating", email: "hello@juniper-ridge.example", phone: "(541) 555-0177" });
  addMessage({ leadId: "ld_dnc1", channel: "email", direction: "out", kind: "followup", body: "Just checking in.", status: "queued" });
  const draft = addMessage({ leadId: "ld_dnc1", channel: "email", direction: "out", kind: "reply", body: "Happy to help.", status: "pending_approval" });
  const ap = addApproval({ kind: "reply", leadId: "ld_dnc1", leadName: "Juniper Ridge Dental", title: "Reply to Juniper Ridge Dental?", detail: "Happy to help.", payload: { messageId: draft.id } });

  const r = await runCommand("log_outcome", { lead: "juniper ridge", outcome: "dnc" }, { via: "voice" });
  assert.equal(r.ok, true);
  assert.equal(getLead("ld_dnc1")!.status, "dnc");
  assert.deepEqual(messagesFor("ld_dnc1").map((m) => m.status), ["discarded", "discarded"]);
  assert.equal(getApproval(ap.id)!.status, "expired");
  assert.ok(isSuppressed(["hello@juniper-ridge.example"]) && isSuppressed(["(541) 555-0177"]));

  saveLead({ ...base, id: "ld_won1", sourceId: "m-won1", name: "Cascade Kids Dentistry", status: "won", email: "office@cascade-kids.example" });
  await runCommand("log_outcome", { lead: "cascade kids", outcome: "dnc" }, { via: "dashboard" });
  assert.equal(getLead("ld_won1")!.status, "won");
  assert.ok(isSuppressed(["office@cascade-kids.example"]));
});

test("draft_reply says plainly when it couldn't follow instructions", async () => {
  const now = new Date().toISOString();
  saveLead({ id: "ld_rep1", source: "manual", sourceId: "m-rep1", name: "Pine Street Dental", niche: "dentist", city: "Boise", region: "ID", country: "US", status: "negotiating", priceCents: 50000, followupsSent: 0, createdAt: now, updatedAt: now, email: "team@pine-street.example", proposalToken: "tok_rep1" });
  addMessage({ leadId: "ld_rep1", channel: "email", direction: "in", kind: "inbound", subject: "Re: your new website", body: "How much is it, and is there a monthly fee?", status: "received" });

  const first = await runCommand("draft_reply", { lead: "pine street" }, { via: "voice" });
  assert.equal(first.ok, true);
  assert.match(first.say, /Want me to send it\?$/);

  // Without Claude the simple reader can't follow the note, and Atlas says so.
  const second = await runCommand("draft_reply", { lead: "pine street", instructions: "mention we connect their domain for free" }, { via: "voice" });
  assert.equal(second.ok, true);
  assert.match(second.say, /Claude isn't connected/);
  const replies = messagesFor("ld_rep1").filter((m) => m.kind === "reply");
  assert.deepEqual(replies.map((m) => m.status), ["discarded", "pending_approval"]);
  assert.equal(replies[0].error, "Replaced by a newer draft");
});
