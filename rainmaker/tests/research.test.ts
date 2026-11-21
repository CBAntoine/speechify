import { test } from "node:test";
import assert from "node:assert/strict";
import { crawlOrder, mergeProspects, researchToProspects, WEB_RESEARCH } from "../src/lib/prospecting/research-parse.ts";
import type { Prospect } from "../src/lib/types.ts";

const niche = { id: "roofer", label: "Roofer" };

test("Claude's saved list becomes prospects; directory links aren't websites", () => {
  const ps = researchToProspects(
    {
      businesses: [
        { name: "Coverall Roofing", website: "coverallroofing.ca", phone: "780.555.0101", address: "12 Main St", source_url: "https://www.yelp.ca/biz/x" },
        { name: "Hiebert Roofing", website: "https://www.yelp.ca/biz/hiebert-roofing", phone: "", address: "", source_url: "https://www.yelp.ca/" },
        { name: "COVERALL ROOFING LTD", website: "", phone: "", address: "", source_url: "" },
        { name: "", website: "https://x.ca", phone: "", address: "", source_url: "" },
        "not an object",
      ],
    },
    niche,
  );
  assert.deepEqual(ps.map((p) => p.name), ["Coverall Roofing", "Hiebert Roofing"], "duplicates and blanks dropped");
  assert.equal(ps[0].website, "https://coverallroofing.ca/");
  assert.equal(ps[0].phone, "(780) 555-0101");
  assert.equal(ps[1].website, undefined, "a Yelp page is a source, not their site");
  assert.equal(ps[0].source, "web");
  assert.deepEqual(ps[0].foundIn, [WEB_RESEARCH]);
  assert.deepEqual(researchToProspects(null, niche), []);
  assert.deepEqual(researchToProspects({ businesses: "nope" }, niche), []);
});

const p = (over: Partial<Prospect>): Prospect => ({ key: over.name ?? "k", name: "x", niche: "roofer", source: "openstreetmap", ...over });

test("the same business from several sources becomes one, with the best details", () => {
  const merged = mergeProspects([
    [p({ key: "osm:1", name: "Coverall Roofing", lat: 53.54, lon: -113.49, foundIn: ["OpenStreetMap"] })],
    [
      p({ key: "od:1", name: "COVERALL ROOFING LTD", source: "open_data", address: "12 Main St, Edmonton, AB", lat: 53.541, lon: -113.491, foundIn: ["City of Edmonton business licences"] }),
      p({ key: "od:2", name: "Coverall Roofing", source: "open_data", lat: 51.04, lon: -114.07, foundIn: ["City of Calgary business licences"] }),
    ],
    [p({ key: "web:1", name: "Coverall Roofing Ltd.", source: "web", website: "https://coverallroofing.ca/", foundIn: [WEB_RESEARCH] })],
  ]);
  assert.equal(merged.length, 2, "same name 300 km apart stays separate");
  assert.equal(merged[0].key, "osm:1");
  assert.equal(merged[0].address, "12 Main St, Edmonton, AB");
  assert.equal(merged[0].website, "https://coverallroofing.ca/");
  assert.deepEqual(merged[0].foundIn, ["OpenStreetMap", "City of Edmonton business licences", WEB_RESEARCH]);
});

test("crawl order: nearest first, taking turns between sources", () => {
  const c = { lat: 0, lon: 0 };
  const order = crawlOrder(
    [
      p({ key: "a-far", lat: 0.2, lon: 0, foundIn: ["A"] }),
      p({ key: "a-near", lat: 0.01, lon: 0, foundIn: ["A"] }),
      p({ key: "a-mid", lat: 0.1, lon: 0, foundIn: ["A"] }),
      p({ key: "b-unknown", foundIn: ["B"] }),
      p({ key: "b-near", lat: 0.02, lon: 0, foundIn: ["B"] }),
    ],
    c,
  );
  assert.deepEqual(order.map((x) => x.key), ["a-near", "b-near", "a-mid", "b-unknown", "a-far"]);
});
