import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOverpassQuery, parseOverpass, type OsmElement } from "../src/lib/prospecting/osm-parse.ts";
import { getNiche, matchNiche, NICHES } from "../src/lib/niches.ts";
import { seedDb } from "../src/lib/seed.ts";
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

test("seed data is consistent and clearly sample", () => {
  const db = seedDb({ withSamples: true });
  assert.ok(db.leads.length >= 5);
  assert.ok(db.leads.every((l) => l.sample && l.source === "sample"));
  assert.ok(db.leads.every((l) => !l.website || l.website.includes(".example")), "fictional domains only");
  const ids = new Set(db.leads.map((l) => l.id));
  assert.ok(db.drafts.every((d) => !d.leadId || ids.has(d.leadId)));
  assert.ok(db.tasks.every((t) => !t.leadId || ids.has(t.leadId)));
  assert.equal(seedDb({ withSamples: false }).leads.length, 0);
});

test("playbooks and complaints all cite https sources", () => {
  for (const p of PLAYBOOKS) {
    assert.ok(p.sources.length > 0, p.id);
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

test("map results sent back by the browser are checked before use", async () => {
  const { sanitizeElements, parseCenter } = await import("../src/lib/prospecting/osm-parse.ts");
  const els = sanitizeElements([
    { type: "node", id: 1, lat: 30.1, lon: -97.7, tags: { name: "Good Roofing", phone: "+1 512", junk: 42, nested: { a: 1 } } },
    { type: "way", id: 2, center: { lat: 30.2, lon: -97.8 }, tags: { name: "Way Roofing" } },
    { type: "bogus", id: 3, lat: 1, lon: 1 },
    { type: "node", id: "4", lat: 1, lon: 1 },
    null,
    "text",
    { type: "node", id: 5, lat: "30", lon: Infinity, tags: { name: "x".repeat(2000) } },
  ]);
  assert.deepEqual(els.map((e) => e.id), [1, 2, 5]);
  assert.deepEqual(els[0].tags, { name: "Good Roofing", phone: "+1 512" }, "only string tags survive");
  assert.deepEqual(els[1].center, { lat: 30.2, lon: -97.8 });
  assert.equal(els[2].lat, undefined, "non-numeric coordinates are dropped (the parser then skips it)");
  assert.equal(els[2].tags?.name.length, 600, "long values are capped");
  assert.deepEqual(sanitizeElements({ elements: [] }), []);
  assert.equal(sanitizeElements(Array.from({ length: 900 }, (_, i) => ({ type: "node", id: i, lat: 0, lon: 0 }))).length, 800);

  assert.deepEqual(parseCenter({ lat: 30.26, lon: -97.74, label: "Austin" }), { lat: 30.26, lon: -97.74, label: "Austin" });
  assert.equal(parseCenter({ lat: 91, lon: 0 }), undefined);
  assert.equal(parseCenter({ lat: "30", lon: -97 }), undefined);
  assert.equal(parseCenter(null), undefined);
});
