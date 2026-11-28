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
const { saveLead, getSettings, getLead } = await import("../src/db.ts");

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
