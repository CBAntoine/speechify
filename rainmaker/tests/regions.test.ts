import { test } from "node:test";
import assert from "node:assert/strict";
import { REGIONS, expandPlace, formatPlace, parsePlace, placeInText, regionByCode } from "../src/lib/regions.ts";

test("every Canadian province and territory, every US state plus DC", () => {
  const ca = REGIONS.filter((r) => r.country === "CA").map((r) => r.code).sort();
  assert.deepEqual(ca, ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
  assert.equal(REGIONS.filter((r) => r.country === "US").length, 51);
  assert.equal(new Set(REGIONS.map((r) => `${r.country}-${r.code}`)).size, REGIONS.length, "codes are unique");
  for (const r of REGIONS) {
    assert.ok(r.cities.length >= (r.code === "DC" ? 1 : 3), `${r.name} has cities`);
    assert.equal(new Set(r.cities).size, r.cities.length, `${r.name} has no duplicate cities`);
    assert.ok(r.cities.every((c) => c.trim() === c && !c.includes(",")), `${r.name} city names are clean`);
  }
});

test("places read as city + province or state, by code or by name", () => {
  const on = regionByCode("ON");
  assert.deepEqual(parsePlace("Toronto, ON"), { city: "Toronto", region: on });
  assert.deepEqual(parsePlace("toronto, on"), { city: "toronto", region: on });
  assert.deepEqual(parsePlace("Toronto, Ontario, Canada"), { city: "Toronto", region: on });
  assert.equal(parsePlace("Montréal, Québec").region?.code, "QC", "accents don't matter");
  assert.equal(parsePlace("Montreal, Que.").region?.code, "QC");
  assert.equal(parsePlace("Charlottetown, PEI").region?.code, "PE");
  assert.equal(parsePlace("St. John's, Newfoundland").region?.code, "NL");
  assert.equal(parsePlace("Austin, TX").region?.code, "TX");
  assert.equal(parsePlace("Austin, Texas, USA").region?.code, "TX");
  assert.equal(parsePlace("Vancouver, BC").region?.country, "CA");
  assert.equal(parsePlace("Vancouver, WA").region?.country, "US");
  assert.equal(parsePlace("Ontario, Canada").region, undefined, "a province on its own isn't a city");
  assert.equal(parsePlace("Toronto, TX, Canada").region, undefined, "country and region must agree");
  assert.deepEqual(parsePlace("Lyon, France"), { city: "Lyon, France" });
  assert.deepEqual(parsePlace("Washington"), { city: "Washington" }, "one word stays as typed");
  assert.deepEqual(parsePlace("  "), { city: "" });
});

test("formatting and expanding for the map lookup and Google", () => {
  const on = regionByCode("on")!;
  assert.equal(formatPlace("London", on), "London, ON");
  assert.equal(formatPlace("  ", on), "");
  assert.equal(formatPlace("Lyon, France"), "Lyon, France");
  assert.deepEqual(expandPlace("London, ON"), { query: "London, Ontario, Canada", city: "London", state: "Ontario", country: "Canada", countryCode: "ca" });
  assert.equal(expandPlace("Portland, ME").query, "Portland, Maine, United States");
  assert.equal(expandPlace("Portland, ME").countryCode, "us");
  assert.deepEqual(expandPlace("Lyon, France"), { query: "Lyon, France" });
  for (const r of REGIONS) for (const c of r.cities) assert.equal(parsePlace(formatPlace(c, r)).region, r, `${c}, ${r.code} reads back`);
});

test("agents' goals: the place they name", () => {
  assert.equal(placeInText("Find 15 dentists in Toronto, ON that have no online booking"), "Toronto, ON");
  assert.equal(placeInText("Find roofers near Halifax, Nova Scotia with weak websites"), "Halifax, NS");
  assert.equal(placeInText("Find plumbers around Montréal, QC."), "Montréal, QC");
  assert.equal(placeInText("Find gyms in St. John's, NL"), "St. John's, NL");
  assert.equal(placeInText("Find 15 dentists in Austin, TX that have no online booking"), "Austin, TX");
  assert.equal(placeInText("Find salons in Calgary that need booking"), "Calgary");
  assert.equal(placeInText("Find salons in Ottawa, on the east side"), undefined, "lowercase 'on' is a word, not Ontario");
  assert.equal(placeInText("Write three ads for a roofer"), undefined);
});
