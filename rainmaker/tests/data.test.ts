import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverpassQuery, parseOverpass, type OsmElement } from "../src/lib/prospecting/osm-parse.ts";
import { getNiche, matchNiche, NICHES } from "../src/lib/niches.ts";
import { sampleDb } from "./fixtures/samples.ts";
import { OLD_PLACEHOLDERS, seedDb } from "../src/lib/seed.ts";
import { removeDemoData } from "../src/lib/fresh.ts";
import { PLAYBOOKS, COMPLAINTS } from "../src/lib/playbooks.ts";
import { dueLabel, money, timeAgo } from "../src/lib/format.ts";

test("Overpass query covers tags and business-only name matches", () => {
  const q = buildOverpassQuery(getNiche("roofer")!, 39.7392, -104.9903, 12000);
  assert.ok(q.startsWith("[out:json]"));
  assert.ok(q.includes('nwr["craft"="roofer"]["name"](around:12000,39.73920,-104.99030);'));
  assert.ok(
    q.includes('nwr["name"~"roof",i][~"^(shop|office|craft|amenity|healthcare|leisure)$"~"."](around:12000,39.73920,-104.99030);'),
    "name matches run once, limited to business keys",
  );
  assert.equal(q.split('["name"~').length - 1, 1, "a single name-regex statement");
  assert.ok(!q.includes('nwr["name"~"roof",i](around'), "never matches names without a business key");
  assert.ok(q.endsWith("out center 250;"), "body verbosity, so nodes keep their coordinates");
});

test("Overpass results become prospects, nearest first, deduped", () => {
  const center = { lat: 30.2672, lon: -97.7431 };
  const els: OsmElement[] = [
    { type: "way" as const, id: 2, center: { lat: 30.3, lon: -97.7 }, tags: { name: "Far Dental", amenity: "dentist", website: "fardental.example" } },
    { type: "node" as const, id: 1, lat: 30.268, lon: -97.743, tags: { name: "Near Dental", amenity: "dentist", "contact:phone": "+1 512", "addr:housenumber": "12", "addr:street": "Main St", "addr:city": "Austin" } },
    { type: "node" as const, id: 3, lat: 30.268, lon: -97.743, tags: { name: "near dental", amenity: "dentist" } },
    { type: "node" as const, id: 4, lat: 30.27, lon: -97.74, tags: { amenity: "dentist" } },
  ];
  const ps = parseOverpass(els, { id: "dentist", label: "Dentist" }, center, 10);
  assert.deepEqual(ps.map((p) => p.name), ["Near Dental", "Far Dental"]);
  assert.equal(ps[0].address, "12 Main St, Austin");
  assert.equal(ps[0].phone, "+1 512");
  assert.equal(ps[1].website, "https://fardental.example");
  assert.equal(ps[1].mapsUrl, "https://www.openstreetmap.org/way/2");
});

test("niche matching from plain words", () => {
  assert.equal(matchNiche("dental offices")?.id, "dentist");
  assert.equal(matchNiche("Med Spa")?.id, "med_spa");
  assert.equal(matchNiche("roofers in Denver")?.id, "roofer");
  assert.equal(matchNiche("car accident attorney")?.id, "law_pi");
  assert.equal(matchNiche("quantum widgets"), undefined);
});

test("every niche has what the UI and prompts need", () => {
  const ids = new Set<string>();
  for (const n of NICHES) {
    assert.ok(!ids.has(n.id), `duplicate ${n.id}`);
    ids.add(n.id);
    assert.ok(n.osmTags.length || n.osmName, `${n.id} has no map query`);
    assert.ok(n.offers.length >= 2 && n.painPoints.length >= 2 && n.keywords.length >= 3, n.id);
    assert.ok(n.retainerMid > 0);
    for (const e of n.evidence ?? []) assert.match(e.url, /^https:\/\//);
  }
});

test("the test fixture is consistent and clearly fictional", () => {
  const db = sampleDb();
  assert.ok(db.leads.length >= 5);
  assert.ok(db.leads.every((l) => l.sample && l.source === "sample"));
  assert.ok(db.leads.every((l) => !l.website || l.website.includes(".example")), "fictional domains only");
  const ids = new Set(db.leads.map((l) => l.id));
  assert.ok(db.drafts.every((d) => !d.leadId || ids.has(d.leadId)));
  assert.ok(db.tasks.every((t) => !t.leadId || ids.has(t.leadId)));
});

test("the app starts with no demo data and no made-up offer", () => {
  const db = seedDb();
  for (const list of [db.leads, db.drafts, db.campaigns, db.tasks, db.activity, db.orders]) assert.equal(list.length, 0);
  assert.equal(db.profile.coreOffer, "");
  assert.equal(db.profile.pricing, "");
});

test("demo data is removed from existing databases, and nothing real goes with it", () => {
  const db = sampleDb();
  db.profile.coreOffer = OLD_PLACEHOLDERS.coreOffer;
  db.profile.pricing = "My own price: $900/mo";
  const sampleLead = db.leads[0].id;
  const real = { ...db.leads[0], id: "lead_real", name: "Real Plumbing", sample: false, source: "openstreetmap" as const, createdBy: "user" };
  db.leads.push(real);
  db.drafts.push({ ...db.drafts[0], id: "draft_real", sample: false, leadId: "lead_real" });
  db.drafts.push({ ...db.drafts[0], id: "draft_for_sample", sample: false, leadId: sampleLead });
  db.tasks.push({ id: "task_real", title: "Call Real Plumbing", leadId: "lead_real", done: false, createdBy: "user", createdAt: "2026-11-24T00:00:00Z" });
  db.activity.push({ id: "act_sxyz", at: "2026-11-24T00:00:00Z", kind: "system", text: "Real activity whose id happens to start with s" });

  assert.ok(removeDemoData(db) > 0);
  assert.deepEqual(db.leads.map((l) => l.id), ["lead_real"]);
  assert.deepEqual(db.drafts.map((d) => d.id), ["draft_real"], "drafts made for a sample business go too");
  assert.deepEqual(db.tasks.map((t) => t.id), ["task_real"]);
  assert.deepEqual(db.campaigns, []);
  assert.deepEqual(db.activity.map((a) => a.id), ["act_sxyz"]);
  assert.equal(db.profile.coreOffer, "", "the untouched placeholder offer is cleared");
  assert.equal(db.profile.pricing, "My own price: $900/mo", "an edited price stays");
  assert.equal(removeDemoData(db), 0, "nothing left to remove");
});

test("playbooks and complaints all cite https sources", () => {
  for (const p of PLAYBOOKS) {
    // Research plays cite their sources; the owner's own plays say that's what they are.
    assert.ok(p.own ? p.sources.length === 0 : p.sources.length > 0, p.id);
    for (const s of p.sources) assert.match(s.url, /^https:\/\//);
    assert.ok(p.action.href.startsWith("/"));
  }
  for (const c of COMPLAINTS) assert.match(c.url, /^https:\/\//);
});

test("formatting helpers", () => {
  assert.equal(money(2500), "$2,500");
  assert.equal(money(125000, { compact: true }), "$125k");
  assert.equal(money(undefined), "—");
  const now = Date.parse("2026-11-20T12:00:00Z");
  assert.equal(timeAgo("2026-11-20T11:30:00Z", now), "30m ago");
  assert.equal(timeAgo("2026-11-18T12:00:00Z", now), "2d ago");
  assert.equal(dueLabel("2026-11-19T17:00:00", new Date("2026-11-20T09:00:00")).overdue, true);
  assert.equal(dueLabel("2026-11-20T17:00:00", new Date("2026-11-20T09:00:00")).text, "Today");
});
