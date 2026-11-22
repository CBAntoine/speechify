import { test } from "node:test";
import assert from "node:assert/strict";
import { AREA_NAMES, COUNTRIES, LANG_NAMES, countryByCode, defaultLang } from "../src/lib/markets.ts";

const ALL = [
  "CA", "US", "MX", "GT", "BZ", "SV", "HN", "NI", "CR", "PA", "CU", "JM", "HT", "DO", "BS", "BB", "TT", "AG", "DM", "GD", "KN", "LC", "VC",
  "KY", "BM", "TC", "VG", "AI", "MS", "AW", "CW", "SX", "BQ", "GP", "MQ", "BL", "MF", "PM", "GL",
];
const NANP = ["CA", "US", "JM", "BS", "BB", "TT", "AG", "DM", "GD", "KN", "LC", "VC", "KY", "BM", "TC", "VG", "AI", "MS", "SX", "DO"];

test("every country and territory of North America, once", () => {
  assert.equal(COUNTRIES.length, 39);
  assert.deepEqual(COUNTRIES.map((c) => c.code).sort(), [...ALL].sort());
  assert.equal(new Set(COUNTRIES.map((c) => c.name)).size, COUNTRIES.length, "names are unique");
});

test("each country has what the app needs to work there", () => {
  for (const c of COUNTRIES) {
    assert.match(c.currency, /^[a-z]{3}$/, `${c.name} currency`);
    assert.ok(c.languages.length >= 1 && c.languages.every((l) => l in LANG_NAMES), `${c.name} languages`);
    assert.match(c.dial, /^\+\d{1,3}$/, `${c.name} dial code`);
    assert.ok(c.tlds.length >= 1 && c.tlds.every((t) => /^[a-z]{2,3}(\.[a-z]{2,3})?$/.test(t)), `${c.name} domain endings`);
    assert.equal(c.tlds[c.tlds.length - 1], "com", `${c.name} tries .com last`);
    assert.equal(c.osm, c.code.toLowerCase(), `${c.name} map code`);
    assert.ok(c.area in AREA_NAMES, `${c.name} area`);
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-US", { timeZone: c.timezone }), `${c.timezone} is a real zone`);
    assert.equal(c.hasRegions, ["CA", "US", "MX"].includes(c.code), `${c.name} regions`);
  }
});

test("calling codes: the +1 plan, Mexico and the rest", () => {
  for (const c of COUNTRIES) assert.equal(c.dial === "+1", NANP.includes(c.code), `${c.name} is ${NANP.includes(c.code) ? "" : "not "}on +1`);
  const dial = (code: string) => countryByCode(code)!.dial;
  assert.equal(dial("MX"), "+52");
  assert.equal(dial("GT"), "+502");
  assert.equal(dial("CW"), "+599");
  assert.equal(dial("BQ"), "+599");
  assert.equal(dial("GP"), "+590");
  assert.equal(dial("MQ"), "+596");
  assert.equal(dial("PM"), "+508");
  assert.equal(dial("GL"), "+299");
});

test("currencies, including the dollarized and pegged ones", () => {
  const cur = (code: string) => countryByCode(code)!.currency;
  assert.equal(cur("CA"), "cad");
  assert.equal(cur("MX"), "mxn");
  assert.equal(cur("SV"), "usd");
  assert.equal(cur("PA"), "usd");
  assert.equal(cur("BQ"), "usd");
  assert.equal(cur("CW"), "xcg", "Caribbean guilder since 2025");
  assert.equal(cur("SX"), "xcg");
  assert.equal(cur("AG"), "xcd");
  assert.equal(cur("GP"), "eur");
  assert.equal(cur("GL"), "dkk");
  assert.equal(cur("BM"), "bmd");
  assert.equal(cur("KY"), "kyd");
});

test("languages, WhatsApp and payment notes", () => {
  assert.equal(defaultLang("MX"), "es");
  assert.equal(defaultLang("HT"), "fr");
  assert.equal(defaultLang("CA"), "en");
  assert.equal(defaultLang("GL"), "da");
  assert.equal(defaultLang("AW"), "nl");
  assert.equal(defaultLang("XX"), "en", "unknown country");
  assert.equal(defaultLang(undefined), "en");
  for (const c of COUNTRIES) {
    if (c.area === "central" || c.area === "caribbean" || c.code === "MX") assert.equal(c.whatsappFirst, true, `${c.name} messages on WhatsApp`);
    else assert.ok(!c.whatsappFirst, `${c.name} texts`);
  }
  assert.ok(countryByCode("CU")!.paymentsNote);
  assert.equal(countryByCode("CA")!.paymentsNote, undefined);
});

test("countryByCode is forgiving about case and space", () => {
  assert.equal(countryByCode("mx")?.name, "Mexico");
  assert.equal(countryByCode(" JM ")?.name, "Jamaica");
  assert.equal(countryByCode("FR"), undefined, "not North America");
  assert.equal(countryByCode(undefined), undefined);
  assert.equal(countryByCode(""), undefined);
});
