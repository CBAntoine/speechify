// Phone numbers in E.164 ("+14165550123"), the form Twilio and ElevenLabs
// need, from whatever people type or websites show. Pure, shared by browser
// and server.
//
// North America uses three kinds of numbering:
//  - The North American Numbering Plan (+1): Canada, the US and its
//    territories, and 18 Caribbean and Atlantic countries, each with its own
//    area codes.
//  - Mexico (+52): 10-digit numbers since 2019; the old 01, 044, 045 and
//    "+52 1" mobile prefixes are dropped.
//  - Everyone else: their own country code and a fixed-length national
//    number (Guatemala 8 digits, Belize 7, the French Antilles 9 after
//    dropping the leading 0, …).

import { COUNTRIES, countryByCode, type CountryCode } from "./markets.ts";

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** Area code then exchange, each starting 2-9. */
const NANP = /^[2-9]\d{2}[2-9]\d{6}$/;

/** Every area code assigned to Canada; other +1 area codes not listed in NANP_AREA are the US's. */
const CANADA_AREA_CODES = new Set(
  (
    "204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 403 416 418 428 431 437 438 450 468 474 506 514 519 548 579 581 584 587 " +
    "600 604 613 622 633 639 644 647 655 672 677 683 688 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905 942"
  ).split(" ")
);

/** Area codes of the Caribbean and Atlantic countries on +1. Puerto Rico (787, 939) and the US Virgin Islands (340) are US. */
const NANP_AREA: Record<string, CountryCode> = {
  "264": "AI", "268": "AG", "242": "BS", "246": "BB", "441": "BM", "284": "VG", "345": "KY", "767": "DM",
  "809": "DO", "829": "DO", "849": "DO", "473": "GD", "876": "JM", "658": "JM", "664": "MS", "869": "KN",
  "758": "LC", "784": "VC", "721": "SX", "868": "TT", "649": "TC",
};

/** The area code people leave off when they write a 7-digit local number. */
const LOCAL_AREA: Partial<Record<CountryCode, string>> = {
  AI: "264", AG: "268", BS: "242", BB: "246", BM: "441", VG: "284", KY: "345", DM: "767", DO: "809", GD: "473",
  JM: "876", MS: "664", KN: "869", LC: "758", VC: "784", SX: "721", TT: "868", TC: "649",
};

/** National number lengths (after the country code) outside the +1 plan and Mexico. */
interface Plan {
  lengths: number[];
  /** What the national number must start with. */
  starts?: RegExp;
}
const PLANS: Partial<Record<CountryCode, Plan>> = {
  GT: { lengths: [8] },
  SV: { lengths: [8] },
  HN: { lengths: [8] },
  NI: { lengths: [8] },
  CR: { lengths: [8] },
  CU: { lengths: [8] },
  HT: { lengths: [8] },
  BZ: { lengths: [7] },
  PA: { lengths: [7, 8] },
  AW: { lengths: [7] },
  CW: { lengths: [8], starts: /^9/ },
  BQ: { lengths: [7], starts: /^[347]/ },
  GP: { lengths: [9] },
  BL: { lengths: [9] },
  MF: { lengths: [9] },
  MQ: { lengths: [9] },
  PM: { lengths: [6] },
  GL: { lengths: [6] },
};

const fits = (plan: Plan, nsn: string) => plan.lengths.includes(nsn.length) && (!plan.starts || plan.starts.test(nsn));

/** Country calling codes in use here, longest first (they are prefix-free, so the first match is the one). */
const DIALS = [...new Set(COUNTRIES.map((c) => digitsOf(c.dial)))].sort((a, b) => b.length - a.length);

const countriesWithDial = (dial: string) => COUNTRIES.filter((c) => digitsOf(c.dial) === dial);

/** Is this "+…" number (digits only) a real number in the plan its country code belongs to? */
function validInternational(d: string): boolean {
  if (d.length < 8 || d.length > 15) return false;
  const dial = DIALS.find((x) => d.startsWith(x));
  if (!dial) return true; // outside North America: trust the sender
  const nsn = d.slice(dial.length);
  if (dial === "1") return NANP.test(nsn);
  if (dial === "52") return nsn.length === 10 && /^[2-9]/.test(nsn);
  return countriesWithDial(dial).some((c) => {
    const plan = PLANS[c.code];
    return plan ? fits(plan, nsn) : nsn.length >= 6 && nsn.length <= 12;
  });
}

/**
 * "(416) 555-0123" in Canada → "+14165550123"; "81 1234 5678" in Mexico →
 * "+528112345678"; "0590 12 34 56" in Guadeloupe → "+590590123456".
 * Undefined when it can't be a real number.
 */
export function toE164(raw: string | undefined, country: CountryCode | string = "US"): string | undefined {
  if (!raw) return undefined;
  const t = raw
    .trim()
    .replace(/^tel:/i, "")
    .replace(/\s*(?:ext\.?|extension|x|#)\s*\d{1,6}\s*$/i, "")
    .trim();
  if (!t) return undefined;
  const c = countryByCode(country) ?? countryByCode("US")!;
  const dial = digitsOf(c.dial);
  let d = digitsOf(t);

  // International forms: "+…", "00…", and "011…" from +1 countries.
  let intl: string | undefined;
  if (t.startsWith("+")) intl = d;
  else if (d.startsWith("00")) intl = d.slice(2);
  else if (dial === "1" && d.startsWith("011")) intl = d.slice(3);
  if (intl !== undefined) {
    // Mexico's old mobile prefix: +52 1 XX XXXX XXXX → +52 XX XXXX XXXX.
    if (intl.startsWith("521") && intl.length === 13) intl = `52${intl.slice(3)}`;
    return validInternational(intl) ? `+${intl}` : undefined;
  }

  if (dial === "1") {
    if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
    const area = LOCAL_AREA[c.code];
    if (d.length === 7 && area) d = area + d;
    return NANP.test(d) ? `+1${d}` : undefined;
  }

  if (c.code === "MX") {
    if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
    else if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
    else if (d.length === 13 && /^04[45]/.test(d)) d = d.slice(3);
    else if (d.length === 12 && d.startsWith("01")) d = d.slice(2);
    return d.length === 10 && /^[2-9]/.test(d) ? `+52${d}` : undefined;
  }

  const plan = PLANS[c.code];
  // Written with the country code but no "+": "502 2345 6789".
  if (d.startsWith(dial) && (plan ? fits(plan, d.slice(dial.length)) : d.length > dial.length + 5)) return `+${d}`;
  // Drop the trunk prefix the French Antilles and Cuba dial at home ("0590 …").
  let nsn = d.replace(/^0+/, "");
  // Curaçao numbers are 9 + 7 digits; people often leave off the 9.
  if (c.code === "CW" && nsn.length === 7) nsn = `9${nsn}`;
  if (plan) return fits(plan, nsn) ? `+${dial}${nsn}` : undefined;
  return nsn.length >= 6 && nsn.length <= 12 ? `+${dial}${nsn}` : undefined;
}

/** Spaced groups the way each country writes them. */
function groupNational(dial: string, n: string): string {
  if (dial === "599" && n.length === 8) return `${n.slice(0, 1)} ${n.slice(1, 4)} ${n.slice(4)}`;
  if (n.length === 9) return `${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  if (n.length === 8) return `${n.slice(0, 4)} ${n.slice(4)}`;
  if (n.length === 7) return `${n.slice(0, 3)} ${n.slice(3)}`;
  if (n.length === 6) return `${n.slice(0, 2)} ${n.slice(2, 4)} ${n.slice(4)}`;
  return n;
}

/**
 * "+14165550123" → "(416) 555-0123" (every +1 number, the way people on the
 * plan write it); other countries keep their code: "+52 81 1234 5678",
 * "+502 2345 6789". Anything that isn't E.164 comes back as given.
 */
export function displayPhone(value: string | undefined): string {
  if (!value) return "";
  const v = value.trim();
  if (!v.startsWith("+")) return v;
  const d = digitsOf(v);
  if (d.startsWith("1") && d.length === 11) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.startsWith("52") && d.length === 12) {
    const n = d.slice(2);
    // Mexico City, Guadalajara and Monterrey have 2-digit area codes.
    return /^(33|55|56|81)/.test(n) ? `+52 ${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}` : `+52 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  const dial = DIALS.find((x) => x !== "1" && x !== "52" && d.startsWith(x));
  if (!dial) return v;
  return `+${dial} ${groupNational(dial, d.slice(dial.length))}`;
}

/** True when two numbers are the same line, however they were written. */
export function samePhone(a: string | undefined, b: string | undefined, country: CountryCode | string = "US"): boolean {
  const x = toE164(a, country);
  const y = toE164(b, country);
  return Boolean(x && y && x === y);
}

/**
 * The country a "+…" number belongs to: by area code on the +1 plan
 * (Canadian codes → CA, Caribbean codes → their country, the rest → US), by
 * country code elsewhere. Undefined outside North America or for non-E.164.
 */
export function countryOfPhone(e164: string): CountryCode | undefined {
  const t = e164.trim();
  if (!t.startsWith("+")) return undefined;
  const d = digitsOf(t);
  if (d.startsWith("1")) {
    if (d.length !== 11) return undefined;
    const area = d.slice(1, 4);
    return NANP_AREA[area] ?? (CANADA_AREA_CODES.has(area) ? "CA" : "US");
  }
  const dial = DIALS.find((x) => d.startsWith(x));
  if (!dial) return undefined;
  const nsn = d.slice(dial.length);
  // +599 is Curaçao (9…) and the Caribbean Netherlands (3…, 4…, 7…).
  if (dial === "599") return nsn.startsWith("9") ? "CW" : "BQ";
  // +590 is Guadeloupe, plus Saint-Barthélemy (0590 27…) and Saint-Martin (0590 87…) landlines.
  if (dial === "590") return nsn.startsWith("59027") ? "BL" : nsn.startsWith("59087") ? "MF" : "GP";
  return countriesWithDial(dial)[0]?.code;
}
