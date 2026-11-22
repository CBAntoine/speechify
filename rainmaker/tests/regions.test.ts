import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTRIES } from "../src/lib/markets.ts";
import {
  REGIONS, expandPlace, formatPlace, marketOf, parsePlace, placeInText, placeWords, regionByCode, regionByKey, regionKey, regionsOf,
} from "../src/lib/regions.ts";

test("every Canadian province and territory, every US state plus DC, Puerto Rico and the US Virgin Islands", () => {
  const ca = REGIONS.filter((r) => r.country === "CA").map((r) => r.code).sort();
  assert.deepEqual(ca, ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
  assert.equal(REGIONS.filter((r) => r.country === "US").length, 53);
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

// ── All of North America ──────────────────────────────────────

const MX_CODES = ["AGU", "BCN", "BCS", "CAM", "CHH", "CHP", "CMX", "COA", "COL", "DUR", "GRO", "GUA", "HID", "JAL", "MEX", "MIC", "MOR", "NAY", "NLE", "OAX", "PUE", "QUE", "ROO", "SIN", "SLP", "SON", "TAB", "TAM", "TLA", "VER", "YUC", "ZAC"];

test("Mexico's 32 states by ISO 3166-2 code, with Spanish names", () => {
  const mx = regionsOf("MX");
  assert.deepEqual(mx.map((r) => r.code).sort(), MX_CODES);
  assert.equal(regionByCode("NLE")?.name, "Nuevo León");
  assert.equal(regionByCode("CMX")?.name, "Ciudad de México");
  assert.equal(regionByCode("MEX")?.name, "Estado de México");
  assert.equal(regionByCode("YUC")?.cities[0], "Mérida");
  assert.equal(regionByCode("ROO")?.cities[0], "Cancún");
  for (const r of mx) assert.ok(r.cities.length >= 6 && r.cities.length <= 25, `${r.name} has 6–25 cities`);
});

test("every other country and territory is one region named after it", () => {
  for (const c of COUNTRIES) {
    const rs = regionsOf(c.code);
    if (c.hasRegions) {
      assert.ok(rs.length > 1, `${c.name} has provinces or states`);
      continue;
    }
    assert.equal(rs.length, 1, `${c.name} is one region`);
    assert.equal(rs[0].code, c.code);
    assert.equal(rs[0].name, c.name);
  }
  assert.deepEqual(COUNTRIES.filter((c) => c.hasRegions).map((c) => c.code), ["CA", "US", "MX"]);
});

test("every region has a real IANA time zone, and Canada, the US and Mexico set one per region", () => {
  for (const r of REGIONS) {
    if (r.country === "CA" || r.country === "US" || r.country === "MX") assert.ok(r.timezone, `${r.name} has a time zone`);
    const tz = r.timezone ?? COUNTRIES.find((c) => c.code === r.country)!.timezone;
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: tz }), `${tz} (${r.name}) is a real zone`);
  }
  assert.equal(regionByCode("BC")?.timezone, "America/Vancouver");
  assert.equal(regionByCode("SK")?.timezone, "America/Regina");
  assert.equal(regionByCode("NL")?.timezone, "America/St_Johns");
  assert.equal(regionByCode("AZ")?.timezone, "America/Phoenix");
  assert.equal(regionByCode("HI")?.timezone, "Pacific/Honolulu");
  assert.equal(regionByCode("BCN")?.timezone, "America/Tijuana");
  assert.equal(regionByCode("SON")?.timezone, "America/Hermosillo");
  assert.equal(regionByCode("ROO")?.timezone, "America/Cancun");
  assert.equal(regionByCode("QC")?.lang, "fr");
});

test("Mexican places: ISO codes, names with or without accents, and local abbreviations", () => {
  const nle = regionByCode("NLE");
  assert.deepEqual(parsePlace("Monterrey, NLE"), { city: "Monterrey", region: nle });
  assert.equal(parsePlace("monterrey, nle").region, nle, "codes in any case");
  assert.equal(parsePlace("Monterrey, Nuevo León").region, nle);
  assert.equal(parsePlace("Monterrey, Nuevo Leon").region, nle, "no accent");
  assert.equal(parsePlace("Monterrey, Nuevo León, México").region, nle);
  assert.equal(parsePlace("Monterrey, NL, Mexico").region, nle, "NL is Nuevo León when Mexico is named");
  assert.equal(parsePlace("Monterrey, N.L., México").region, nle);
  assert.equal(parsePlace("Tijuana, BC, Mexico").region?.code, "BCN");
  assert.equal(parsePlace("La Paz, B.C.S., Mexico").region?.code, "BCS");
  assert.equal(parsePlace("Polanco, CDMX").region?.code, "CMX");
  assert.equal(parsePlace("Coyoacán, Mexico City").region?.code, "CMX");
  assert.equal(parsePlace("Toluca, Edomex").region?.code, "MEX");
  assert.equal(parsePlace("Toluca, Edo. Méx.").region?.code, "MEX");
  assert.equal(parsePlace("Cancún, Q. Roo").region?.code, "ROO");
  assert.equal(parsePlace("Querétaro, QUE").region?.code, "QUE", "the exact ISO code");
  assert.equal(parsePlace("Querétaro, Qro.").region?.code, "QUE");
  assert.equal(parsePlace("Querétaro, Que., Mexico").region?.code, "QUE", "Que. is Querétaro when Mexico is named");
  assert.equal(formatPlace("Monterrey", nle), "Monterrey, NLE");
  assert.deepEqual(expandPlace("Monterrey, NLE"), { query: "Monterrey, Nuevo León, Mexico", city: "Monterrey", state: "Nuevo León", country: "Mexico", countryCode: "mx" });
});

test("two-letter clashes: without a country, Canada and the US keep their codes", () => {
  assert.equal(parsePlace("St. John's, NL").region?.code, "NL");
  assert.equal(parsePlace("St. John's, NL").region?.country, "CA");
  assert.equal(parsePlace("Monterrey, NL").region?.country, "CA", "no country named: Newfoundland, as before");
  assert.equal(parsePlace("Vancouver, BC").region?.country, "CA");
  assert.equal(parsePlace("Montreal, Que.").region?.code, "QC", "Que. stays Quebec");
  assert.equal(parsePlace("Pittsburgh, PA").region?.name, "Pennsylvania");
  assert.equal(parsePlace("Panama City, FL").region?.code, "FL");
  assert.equal(parsePlace("Panama City, Panama").region?.country, "PA");
  assert.equal(parsePlace("Jackson, MS").region?.name, "Mississippi");
  assert.equal(parsePlace("Brades, Montserrat").region?.country, "MS");
  assert.equal(regionByCode("PA")?.name, "Pennsylvania");
  assert.equal(regionByCode("PA", "PA")?.name, "Panama");
  assert.equal(regionByCode("MS", "MS")?.name, "Montserrat");
  assert.equal(regionByCode("NLE", "MX")?.name, "Nuevo León");
  assert.equal(regionByCode("NLE", "CA"), undefined);
  assert.equal(regionByKey("US:PA")?.name, "Pennsylvania");
  assert.equal(regionByKey("PA:PA")?.name, "Panama");
  assert.equal(regionByKey("nope"), undefined);
  for (const r of REGIONS) assert.equal(regionByKey(regionKey(r)), r, `${regionKey(r)} is unique`);
});

test("Puerto Rico and the US Virgin Islands are US regions with their own map code", () => {
  const pr = parsePlace("San Juan, Puerto Rico").region;
  assert.equal(pr?.code, "PR");
  assert.equal(pr?.country, "US");
  assert.equal(parsePlace("San Juan, PR").region, pr);
  assert.equal(parsePlace("Ponce, Puerto Rico, USA").region, pr);
  assert.equal(parsePlace("Charlotte Amalie, USVI").region?.code, "VI");
  assert.equal(parsePlace("Christiansted, St. Croix").region?.code, "VI");
  assert.equal(parsePlace("Charlotte Amalie, U.S. Virgin Islands").region?.code, "VI");
  assert.equal(formatPlace("San Juan", pr), "San Juan, PR");
  assert.deepEqual(expandPlace("San Juan, PR"), { query: "San Juan, Puerto Rico", city: "San Juan", country: "Puerto Rico", countryCode: "pr" });
  assert.equal(expandPlace("Charlotte Amalie, VI").countryCode, "vi");
});

test("other countries: City, Country, in English or the local name", () => {
  const cases: [string, string, string][] = [
    ["Kingston, Jamaica", "JM", "Kingston"],
    ["Santo Domingo, República Dominicana", "DO", "Santo Domingo"],
    ["Santo Domingo, Dominican Republic", "DO", "Santo Domingo"],
    ["Port-au-Prince, Haïti", "HT", "Port-au-Prince"],
    ["Port-au-Prince, Haiti", "HT", "Port-au-Prince"],
    ["Willemstad, Curaçao", "CW", "Willemstad"],
    ["Willemstad, Curacao", "CW", "Willemstad"],
    ["Castries, St. Lucia", "LC", "Castries"],
    ["Castries, Saint Lucia", "LC", "Castries"],
    ["Basseterre, St Kitts & Nevis", "KN", "Basseterre"],
    ["Providenciales, Turks & Caicos", "TC", "Providenciales"],
    ["Road Town, BVI", "VG", "Road Town"],
    ["Nuuk, Kalaallit Nunaat", "GL", "Nuuk"],
    ["Gustavia, St. Barts", "BL", "Gustavia"],
    ["Philipsburg, St. Maarten", "SX", "Philipsburg"],
    ["Marigot, Saint-Martin", "MF", "Marigot"],
    ["Marigot, Dominica", "DM", "Marigot"],
    ["Kralendijk, Bonaire", "BQ", "Kralendijk"],
    ["San José, Costa Rica", "CR", "San José"],
    ["Ciudad de Panamá, Panamá", "PA", "Ciudad de Panamá"],
    ["Havana, Cuba", "CU", "Havana"],
    ["Hamilton, Bermuda", "BM", "Hamilton"],
    ["Saint-Pierre, Saint-Pierre-et-Miquelon", "PM", "Saint-Pierre"],
  ];
  for (const [text, country, city] of cases) {
    const p = parsePlace(text);
    assert.equal(p.region?.country, country, text);
    assert.equal(p.city, city, text);
  }
  const jm = regionByCode("JM", "JM")!;
  assert.equal(formatPlace("Kingston", jm), "Kingston, Jamaica");
  assert.deepEqual(expandPlace("Kingston, Jamaica"), { query: "Kingston, Jamaica", city: "Kingston", country: "Jamaica", countryCode: "jm" });
  assert.equal(parsePlace("Kingston, ON").region?.code, "ON", "Kingston, Ontario is still Ontario");
  assert.deepEqual(parsePlace("Jamaica"), { city: "Jamaica" }, "a country on its own isn't a city");
});

test("a country named without its state is kept as text, inside the country", () => {
  assert.deepEqual(parsePlace("Toluca, Mexico"), { city: "Toluca, Mexico" });
  assert.deepEqual(expandPlace("Toluca, Mexico"), { query: "Toluca, Mexico", country: "Mexico", countryCode: "mx" });
  assert.equal(expandPlace("Ontario, Canada").countryCode, "ca");
});

test("marketOf: language, currency, time zone and web domains for a place", () => {
  const to = marketOf("Toronto, ON");
  assert.equal(to.country.code, "CA");
  assert.equal(to.region?.code, "ON");
  assert.deepEqual([to.lang, to.currency, to.timezone, to.osm], ["en", "cad", "America/Toronto", "ca"]);
  assert.deepEqual(to.tlds, ["ca", "com"]);
  assert.equal(marketOf("Montréal, QC").lang, "fr");
  const mty = marketOf("Monterrey, NLE");
  assert.deepEqual([mty.country.code, mty.lang, mty.currency, mty.timezone], ["MX", "es", "mxn", "America/Monterrey"]);
  assert.equal(mty.tlds[0], "com.mx");
  assert.equal(marketOf("Tijuana, BCN").timezone, "America/Tijuana");
  const sj = marketOf("San Juan, PR");
  assert.deepEqual([sj.country.code, sj.lang, sj.currency, sj.timezone, sj.osm], ["US", "es", "usd", "America/Puerto_Rico", "pr"]);
  const kgn = marketOf("Kingston, Jamaica");
  assert.deepEqual([kgn.country.code, kgn.lang, kgn.currency, kgn.timezone], ["JM", "en", "jmd", "America/Jamaica"]);
  assert.equal(marketOf("Pointe-à-Pitre, Guadeloupe").lang, "fr");
  assert.equal(marketOf("Pointe-à-Pitre, Guadeloupe").currency, "eur");
  const tol = marketOf("Toluca, Mexico");
  assert.equal(tol.country.code, "MX");
  assert.equal(tol.region, undefined);
  assert.equal(marketOf("Lyon, France").country.code, "US", "unknown places fall back");
  assert.equal(marketOf("Lyon, France", "CA").country.code, "CA");
  assert.equal(marketOf("").country.code, "US");
});

test("place words a business's own site would mention", () => {
  assert.deepEqual(placeWords("Toronto, ON"), ["Toronto", "Ontario", "ON"]);
  assert.deepEqual(placeWords("Monterrey, NLE"), ["Monterrey", "Nuevo León", "Nuevo Leon"]);
  assert.deepEqual(placeWords("Querétaro, QUE"), ["Querétaro", "Queretaro"]);
  assert.deepEqual(placeWords("Kingston, Jamaica"), ["Kingston", "Jamaica"]);
  assert.deepEqual(placeWords("Ciudad de Panamá, Panama"), ["Ciudad de Panamá", "Panama", "Panamá", "Ciudad de Panama"]);
  assert.deepEqual(placeWords("San Juan, PR"), ["San Juan", "Puerto Rico", "PR"]);
  assert.deepEqual(placeWords("Toluca, Mexico"), ["Toluca", "Mexico", "México"]);
  assert.deepEqual(placeWords("Lyon, France"), ["Lyon, France"], "unknown places as typed");
});

test("agents' goals anywhere in North America", () => {
  assert.equal(placeInText("Find dentists in Monterrey, Nuevo León that need a website"), "Monterrey, NLE");
  assert.equal(placeInText("Find dentists in Monterrey, Nuevo Leon"), "Monterrey, NLE", "no accent");
  assert.equal(placeInText("Find 10 roofers near Guadalajara, JAL with slow sites"), "Guadalajara, JAL");
  assert.equal(placeInText("Find gyms in Kingston, Jamaica."), "Kingston, Jamaica");
  assert.equal(placeInText("Find salons around San Juan, Puerto Rico"), "San Juan, PR");
  assert.equal(placeInText("Find salons in Ciudad de Panamá, Panamá"), "Ciudad de Panamá, Panama", "a country name ending in an accent");
  assert.equal(placeInText("Find roofers in San Luis Potosí, San Luis Potosí"), "San Luis Potosí, SLP");
  assert.equal(placeInText("Find vets in Toluca, Mexico"), "Toluca, Mexico");
  assert.equal(placeInText("Find spas in Gustavia, St. Barts"), "Gustavia, Saint Barthélemy");
});
