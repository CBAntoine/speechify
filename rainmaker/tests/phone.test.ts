import { test } from "node:test";
import assert from "node:assert/strict";
import { countryOfPhone, displayPhone, samePhone, toE164 } from "../src/lib/phone.ts";

test("Canada and the US: every way people write a number", () => {
  for (const raw of ["(416) 555-0123", "416-555-0123", "416.555.0123", "4165550123", "1 (416) 555-0123", "+1 416 555 0123", "1-416-555-0123", "tel:+14165550123", "416-555-0123 ext. 22", "(416) 555-0123 x4"]) {
    assert.equal(toE164(raw, "CA"), "+14165550123", raw);
  }
  assert.equal(toE164("(212) 555-0199"), "+12125550199", "US by default");
  assert.equal(toE164("555-0123", "US"), undefined, "7 digits need an area code here");
  assert.equal(toE164("(123) 555-0123", "US"), undefined, "area codes don't start with 1");
  assert.equal(toE164("(416) 155-0123", "CA"), undefined, "exchanges don't start with 1");
  assert.equal(toE164("12", "US"), undefined);
  assert.equal(toE164("", "US"), undefined);
  assert.equal(toE164(undefined), undefined);
  assert.equal(toE164("011 52 81 1234 5678", "US"), "+528112345678", "011 dials out of the +1 plan");
});

test("Caribbean countries on +1: local 7-digit numbers get their area code", () => {
  assert.equal(toE164("876-555-1234", "JM"), "+18765551234");
  assert.equal(toE164("555-1234", "JM"), "+18765551234");
  assert.equal(toE164("1 (876) 555-1234", "JM"), "+18765551234");
  assert.equal(toE164("555-1234", "DO"), "+18095551234");
  assert.equal(toE164("829 555 1234", "DO"), "+18295551234");
  assert.equal(toE164("555-1234", "BS"), "+12425551234");
  assert.equal(toE164("555-1234", "TT"), "+18685551234");
  assert.equal(toE164("555-1234", "KY"), "+13455551234");
  assert.equal(toE164("(787) 555-1234", "US"), "+17875551234", "Puerto Rico is on the US plan");
});

test("Mexico: 10 digits, old prefixes dropped", () => {
  assert.equal(toE164("81 1234 5678", "MX"), "+528112345678");
  assert.equal(toE164("(55) 1234-5678", "MX"), "+525512345678");
  assert.equal(toE164("999 123 4567", "MX"), "+529991234567");
  assert.equal(toE164("044 55 1234 5678", "MX"), "+525512345678", "old mobile prefix");
  assert.equal(toE164("045 33 1234 5678", "MX"), "+523312345678");
  assert.equal(toE164("01 999 123 4567", "MX"), "+529991234567", "old long-distance prefix");
  assert.equal(toE164("52 55 1234 5678", "MX"), "+525512345678");
  assert.equal(toE164("+52 1 55 1234 5678", "MX"), "+525512345678", "old +52 1 mobile form");
  assert.equal(toE164("+52 1 55 1234 5678", "US"), "+525512345678", "whatever the client's country");
  assert.equal(toE164("0052 55 1234 5678", "MX"), "+525512345678", "00 dials out");
  assert.equal(toE164("1234 5678", "MX"), undefined);
  assert.equal(toE164("+52 81 1234 567", "MX"), undefined, "too short");
});

test("Central America, the Caribbean and the North Atlantic by national number length", () => {
  const cases: [string, string, string | undefined][] = [
    ["2345 6789", "GT", "+50223456789"],
    ["502 2345 6789", "GT", "+50223456789"],
    ["+502 2345 6789", "US", "+50223456789"],
    ["234 5678", "GT", undefined],
    ["2222-3333", "SV", "+50322223333"],
    ["9876-5432", "HN", "+50498765432"],
    ["8888-1234", "NI", "+50588881234"],
    ["8888-1234", "CR", "+50688881234"],
    ["223-4567", "BZ", "+5012234567"],
    ["223-4567", "PA", "+5072234567"],
    ["6123-4567", "PA", "+50761234567"],
    ["5 123 4567", "CU", "+5351234567"],
    ["3712 3456", "HT", "+50937123456"],
    ["582 1234", "AW", "+2975821234"],
    ["9 461 2345", "CW", "+59994612345"],
    ["461 2345", "CW", "+59994612345"],
    ["717 1234", "BQ", "+5997171234"],
    ["0590 12 34 56", "GP", "+590590123456"],
    ["0690 12 34 56", "GP", "+590690123456"],
    ["0590 27 12 34", "BL", "+590590271234"],
    ["0596 12 34 56", "MQ", "+596596123456"],
    ["41 23 45", "PM", "+508412345"],
    ["32 12 34", "GL", "+299321234"],
    ["+44 20 7946 0958", "US", "+442079460958"],
    ["+502 1234", "US", undefined],
  ];
  for (const [raw, country, want] of cases) assert.equal(toE164(raw, country), want, `${raw} in ${country}`);
});

test("display: +1 numbers as (area) exchange-line, others with their country code", () => {
  assert.equal(displayPhone("+14165550123"), "(416) 555-0123");
  assert.equal(displayPhone("+18765551234"), "(876) 555-1234");
  assert.equal(displayPhone("+528112345678"), "+52 81 1234 5678");
  assert.equal(displayPhone("+529991234567"), "+52 999 123 4567");
  assert.equal(displayPhone("+50223456789"), "+502 2345 6789");
  assert.equal(displayPhone("+5072234567"), "+507 223 4567");
  assert.equal(displayPhone("+59994612345"), "+599 9 461 2345");
  assert.equal(displayPhone("+5997171234"), "+599 717 1234");
  assert.equal(displayPhone("+590590123456"), "+590 590 12 34 56");
  assert.equal(displayPhone("+508412345"), "+508 41 23 45");
  assert.equal(displayPhone("+442079460958"), "+442079460958", "outside North America: as given");
  assert.equal(displayPhone("(416) 555-0123"), "(416) 555-0123", "not E.164: as given");
  assert.equal(displayPhone(undefined), "");
  assert.equal(displayPhone(""), "");
});

test("the country a number belongs to", () => {
  assert.equal(countryOfPhone("+14165550123"), "CA");
  assert.equal(countryOfPhone("+15145550123"), "CA");
  assert.equal(countryOfPhone("+18675550123"), "CA", "the territories' 867");
  assert.equal(countryOfPhone("+12125550123"), "US");
  assert.equal(countryOfPhone("+18005550123"), "US", "toll-free counts as US");
  assert.equal(countryOfPhone("+17875551234"), "US", "Puerto Rico");
  assert.equal(countryOfPhone("+13405551234"), "US", "US Virgin Islands");
  assert.equal(countryOfPhone("+18765551234"), "JM");
  assert.equal(countryOfPhone("+16585551234"), "JM");
  assert.equal(countryOfPhone("+18095551234"), "DO");
  assert.equal(countryOfPhone("+18495551234"), "DO");
  assert.equal(countryOfPhone("+12425551234"), "BS");
  assert.equal(countryOfPhone("+14415551234"), "BM");
  assert.equal(countryOfPhone("+17215551234"), "SX");
  assert.equal(countryOfPhone("+528112345678"), "MX");
  assert.equal(countryOfPhone("+5351234567"), "CU");
  assert.equal(countryOfPhone("+50223456789"), "GT");
  assert.equal(countryOfPhone("+50937123456"), "HT");
  assert.equal(countryOfPhone("+59994612345"), "CW");
  assert.equal(countryOfPhone("+5997171234"), "BQ");
  assert.equal(countryOfPhone("+590590123456"), "GP");
  assert.equal(countryOfPhone("+590590271234"), "BL");
  assert.equal(countryOfPhone("+590590871234"), "MF");
  assert.equal(countryOfPhone("+596596123456"), "MQ");
  assert.equal(countryOfPhone("+299321234"), "GL");
  assert.equal(countryOfPhone("+442079460958"), undefined, "outside North America");
  assert.equal(countryOfPhone("4165550123"), undefined, "not E.164");
  assert.equal(countryOfPhone("+1416555"), undefined, "too short for +1");
});

test("the same line however it's written", () => {
  assert.ok(samePhone("(416) 555-0123", "+1 416-555-0123", "CA"));
  assert.ok(samePhone("81 1234 5678", "+52 1 81 1234 5678", "MX"));
  assert.ok(samePhone("555-1234", "+1 876 555 1234", "JM"));
  assert.ok(!samePhone("(416) 555-0123", "(416) 555-0124", "CA"));
  assert.ok(!samePhone(undefined, "+14165550123"));
  assert.ok(!samePhone("12", "12"), "two invalid numbers aren't the same line");
});
