import { test } from "node:test";
import assert from "node:assert/strict";
import { NICHES, getNiche } from "../src/lib/niches.ts";
import { nominatimTerms, nominatimToElements, viewboxAround, type NominatimRow } from "../src/lib/prospecting/nominatim-parse.ts";
import { parseOverpass } from "../src/lib/prospecting/osm-parse.ts";

test("search terms: OSM categories first, then words from business names", () => {
  assert.deepEqual(nominatimTerms(getNiche("dentist")!), ["[amenity=dentist]", "[healthcare=dentist]", "dental", "dentistry"]);
  assert.deepEqual(nominatimTerms(getNiche("roofer")!), ["[craft=roofer]", "roofing", "roofers", "roof"]);
  assert.deepEqual(nominatimTerms(getNiche("restaurant")!), ["[amenity=restaurant]"]);
  assert.ok(!nominatimTerms(getNiche("chiropractor")!).some((t) => t.includes(":")), "sub-keys like healthcare:speciality aren't searchable");
  assert.ok(nominatimTerms({ osmTags: ["a=b", "c=d", "e=f"], nameWords: ["w1", "w2", "w3", "w4"] }).length <= 5, "at most five requests per search");
  for (const n of NICHES) assert.ok(nominatimTerms(n).length >= 1, `${n.id} has something to search for`);
});

test("the search box around a city", () => {
  const box = viewboxAround(42.9837, -81.2496, 12).split(",").map(Number);
  assert.equal(box.length, 4);
  const [left, top, right, bottom] = box;
  assert.ok(left < -81.2496 && right > -81.2496 && top > 42.9837 && bottom < 42.9837);
  assert.ok(Math.abs(top - bottom - 24 / 111.32) < 1e-3, "12 km each way north and south");
  assert.ok(right - left > top - bottom, "longitude degrees are wider than latitude at this latitude");
});

test("Nominatim results become businesses; roads, campuses and nameless places are dropped", () => {
  const rows: NominatimRow[] = [
    {
      osm_type: "node", osm_id: 11, lat: "42.99", lon: "-81.25", name: "London Bridge Dental", category: "amenity", type: "dentist",
      address: { house_number: "1", road: "Dundas St", city: "London", state: "Ontario", postcode: "N6A 1A1" },
      extratags: { website: "https://lbdental.example", phone: "+1 519 555 0101", wheelchair: "yes" },
    },
    { osm_type: "way", osm_id: 12, lat: "42.98", lon: "-81.26", name: "Zed-Air Heating & Air Conditioning", category: "building", type: "yes", address: { town: "London" } },
    { osm_type: "way", osm_id: 13, lat: "42.98", lon: "-81.27", name: "Dental Circle", category: "highway", type: "service" },
    { osm_type: "way", osm_id: 14, lat: "43.00", lon: "-81.27", name: "Dental Sciences Building", category: "building", type: "university" },
    { osm_type: "way", osm_id: 15, lat: "43.00", lon: "-81.27", name: "Victoria Hospital Heating Plant", category: "building", type: "yes" },
    { osm_type: "node", osm_id: 16, lat: "43.00", lon: "-81.27", name: "", category: "shop", type: "hairdresser" },
    { osm_type: "node", osm_id: 11, lat: "42.99", lon: "-81.25", name: "London Bridge Dental", category: "amenity", type: "dentist" },
    { osm_type: "node", osm_id: 17, lat: "not a number", lon: "-81.25", name: "Broken", category: "shop", type: "x" },
    { osm_type: "relation", osm_id: 18, lat: "43.01", lon: "-81.2", name: "Main St Parking", category: "amenity", type: "parking" },
  ];
  const els = nominatimToElements(rows);
  assert.deepEqual(els.map((e) => e.id), [11, 12], "dentist and the HVAC company stay, once each");
  assert.equal(els[0].tags?.amenity, "dentist");
  assert.equal(els[0].tags?.website, "https://lbdental.example");
  assert.equal(els[0].tags?.["addr:street"], "Dundas St");
  assert.equal(els[0].tags?.["addr:state"], "Ontario");
  assert.equal(els[1].tags?.["addr:city"], "London", "town counts as the city");

  const prospects = parseOverpass(els, { id: "dentist", label: "Dentist" }, { lat: 42.9837, lon: -81.2496 }, 10);
  assert.equal(prospects[0].name, "London Bridge Dental", "nearest first");
  assert.equal(prospects[0].address, "1 Dundas St, London, Ontario, N6A 1A1");
  assert.equal(prospects[0].phone, "+1 519 555 0101");
  assert.equal(prospects[0].source, "openstreetmap");
});
