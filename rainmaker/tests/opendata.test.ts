import { test } from "node:test";
import assert from "node:assert/strict";
import { NICHES, getNiche } from "../src/lib/niches.ts";
import {
  categoryFits,
  fromCalgary,
  fromEdmonton,
  fromToronto,
  fromVancouver,
  nameKey,
  namePattern,
  socrataWhere,
  tidyName,
  torontoQuery,
  vancouverWhere,
} from "../src/lib/prospecting/opendata-parse.ts";

test("every niche has a name pattern, and the patterns pick the right businesses", () => {
  for (const n of NICHES) assert.ok(namePattern(n), `${n.id} has a pattern`);
  const roofer = namePattern(getNiche("roofer")!)!;
  assert.ok(roofer.re.test("UNITED ROOFING EDMONTON INC."));
  assert.ok(roofer.re.test("Coast Mountain Roof Ltd"));
  assert.ok(!roofer.re.test("KORE ROOFTOP"), "a rooftop bar isn't a roofer");
  const law = namePattern(getNiche("law_pi")!)!;
  assert.ok(law.re.test("SMITH INJURY LAWYERS"));
  assert.ok(!law.re.test("GREEN LAWN CARE"), "lawn care isn't a law firm");
  const plumber = namePattern(getNiche("plumber")!)!;
  assert.ok(plumber.re.test("MR ROOTER PLUMBING OF CALGARY") && plumber.re.test("PEAKFLOW PLUMBING AND DRAINS"));
  const vet = namePattern(getNiche("veterinarian")!)!;
  assert.ok(vet.re.test("Main Street Veterinary Hospital") && !vet.re.test("VETERAN MOVERS"));
  const land = namePattern(getNiche("landscaping")!)!;
  assert.ok(land.re.test("Eagle Maintenance & Landscaping Ltd.") && land.re.test("Green Lawn Care"));
  assert.ok(!land.re.test("Royal Lawn Bowling Club") && !land.re.test("The Garden Acupuncture and Holistic Centre"), "not landscapers");
  const custom = namePattern({ id: "custom", nameWords: ["tattoo studio", "tattoo"] })!;
  assert.ok(custom.re.test("Black Rose Tattoo") && custom.like.includes("TATTOO"));
  assert.equal(namePattern({ id: "custom", nameWords: ["ab"] }), undefined, "too short to search");
});

test("licence categories that never fit a service niche are skipped", () => {
  assert.ok(categoryFits("roofer", "Construction, Contracting, and Labour Service"));
  assert.ok(categoryFits("roofer", undefined));
  assert.ok(!categoryFits("roofer", "EXPANDED EATING/DRINKING ESTABLISHMENT"));
  assert.ok(!categoryFits("plumber", "TORONTO TAXICAB OWNER"));
  assert.ok(categoryFits("restaurant", "Restaurant or Food Service"));
  assert.ok(!categoryFits("restaurant", "BUILDING RENOVATOR"));
});

test("names are tidied and compared across sources", () => {
  assert.equal(tidyName("MT PLUMBING AND HEATING LTD"), "MT Plumbing and Heating Ltd.");
  assert.equal(tidyName("E-NRG ROOFING & EXTERIORS INC."), "E-NRG Roofing & Exteriors Inc.");
  assert.equal(tidyName("HVAC PROS OF CALGARY"), "HVAC Pros of Calgary");
  assert.equal(tidyName("Coast Mountain Roof Ltd"), "Coast Mountain Roof Ltd", "mixed case is left alone");
  assert.equal(nameKey("Coverall Roofing Ltd."), nameKey("COVERALL ROOFING"));
  assert.equal(nameKey("The Smith & Sons Co."), "smith and sons");
});

test("Edmonton, Calgary, Vancouver and Toronto records, as their APIs return them", () => {
  const e = fromEdmonton({
    business_licence_category: "Construction, Contracting, and Labour Service", business_name: "HIEBERT ROOFING",
    business_address: "10123 99 ST NW", externalid: "100234128-002", latitude: "53.54", longitude: "-113.49",
  });
  assert.deepEqual(
    { name: e?.name, address: e?.address, lat: e?.lat, lon: e?.lon },
    { name: "HIEBERT ROOFING", address: "10123 99 ST NW, Edmonton, AB", lat: 53.54, lon: -113.49 },
  );
  assert.equal(fromEdmonton({ business_name: "HOME CO", business_address: "<Home Based Business>" })?.address, undefined, "home addresses are hidden");

  const c = fromCalgary({ getbusid: "16804338", tradename: "STRONGHOLD PLUMBING", address: "4121 23B ST NE", licencetypes: "CONTRACTOR,\nMANUFACTURER", point: { type: "Point", coordinates: [-114.0031964, 51.0897271] } });
  assert.equal(c?.lat, 51.0897271);
  assert.equal(c?.lon, -114.0031964);
  assert.equal(c?.category, "CONTRACTOR, MANUFACTURER");

  const v = fromVancouver({
    businessname: "(Sally Ng)", businesstradename: "Catch Physiotherapy & Wellness", businesstype: "Health Care Professionals and Services",
    unit: "203", house: "1537", street: "W 8TH AV", postalcode: "V6J 1T5", geo_point_2d: { lon: -123.1399, lat: 49.2647 }, licencenumber: "25-115677",
  });
  assert.equal(v?.name, "Catch Physiotherapy & Wellness", "the trade name, not the owner");
  assert.equal(v?.address, "203-1537 W 8TH AV, Vancouver, BC, V6J 1T5");
  assert.equal(fromVancouver({ businessname: "(Carrie Brouwer)" }), undefined, "a person with no trade name");

  const t = fromToronto({
    Category: "PLUMBING CONTRACTOR", "Licence No.": "B12-1", "Operating Name": "QUICKFIX PLUMBING", "Business Phone": "6474551555",
    "Licence Address Line 1": "35 OAK ST", "Licence Address Line 2": "OAKVILLE, ON", "Licence Address Line 3": "L6J 1A1",
  });
  assert.equal(t?.phone, "(647) 455-1555");
  assert.equal(t?.addressCity, "OAKVILLE");
  assert.equal(fromToronto({ "Operating Name": "GONE PLUMBING", "Cancel Date": "2018-12-07" }), undefined, "cancelled licences are skipped");
});

test("queries for each city's API", () => {
  assert.equal(
    socrataWhere("business_name", ["ROOF", "it's"], "expiry_date >= '2026-11-21'"),
    "(upper(business_name) like '%ROOF%' OR upper(business_name) like '%IT S%') AND expiry_date >= '2026-11-21'",
    "only letters, digits and spaces reach the query",
  );
  assert.equal(
    vancouverWhere(["ROOF"], 2026),
    'status="Issued" and folderyear in ("26", "25") and (businesstradename like "%ROOF%" or businessname like "%ROOF%")',
  );
  assert.equal(torontoQuery(["PLUMB", "DRAIN", "AIR CONDITION"]), "plumb:* | drain:* | (air:* & condition:*)");
});
