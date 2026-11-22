// North American markets: every country and territory Rainmaker can target,
// with what changes from one to the next (currency, languages, phone codes,
// web domains, time zones, payment support). Pure data and helpers, shared by
// the browser and the server, loadable by Node's type stripping in tests.
//
// US territories (Puerto Rico, US Virgin Islands) are regions of the US here,
// because US law, the US dollar and +1 numbers apply; see regions.ts.

export type Lang = "en" | "es" | "fr" | "nl" | "da";

export type CountryCode =
  | "CA" | "US" | "MX"
  | "GT" | "BZ" | "SV" | "HN" | "NI" | "CR" | "PA"
  | "CU" | "JM" | "HT" | "DO" | "BS" | "BB" | "TT" | "AG" | "DM" | "GD" | "KN" | "LC" | "VC"
  | "KY" | "BM" | "TC" | "VG" | "AI" | "MS" | "AW" | "CW" | "SX" | "BQ" | "GP" | "MQ" | "BL" | "MF" | "PM" | "GL";

export type Area = "north" | "central" | "caribbean";

export interface Country {
  code: CountryCode;
  name: string;
  /** Name in its main language when different ("México"). */
  localName?: string;
  area: Area;
  /** ISO 4217, lowercase. */
  currency: string;
  /** Languages businesses use with customers, most common first. */
  languages: Lang[];
  /** International calling code, e.g. "+1", "+52". */
  dial: string;
  /** Domain endings to try when guessing a business's website, most likely first. */
  tlds: string[];
  /** Nominatim countrycodes filter, e.g. "mx". */
  osm: string;
  /** Default IANA time zone (regions can override it). */
  timezone: string;
  /** Has provinces or states in REGIONS; otherwise one region named after the country. */
  hasRegions: boolean;
  /** Customers mostly message businesses on WhatsApp rather than SMS. */
  whatsappFirst?: boolean;
  /** Why card or PayPal payments may not work there, when they may not. */
  paymentsNote?: string;
}

export const LANG_NAMES: Record<Lang, string> = { en: "English", es: "Spanish", fr: "French", nl: "Dutch", da: "Danish" };

export const AREA_NAMES: Record<Area, string> = { north: "North America", central: "Central America", caribbean: "Caribbean" };

// WhatsApp is how most customers in Mexico, Central America and the
// Caribbean message a business; in Canada, the US, Bermuda, Greenland and
// Saint Pierre and Miquelon texts (SMS) are still the norm.
export const COUNTRIES: Country[] = [
  // ── North America ─────────────────────────────────────────
  { code: "CA", name: "Canada", area: "north", currency: "cad", languages: ["en", "fr"], dial: "+1", tlds: ["ca", "com"], osm: "ca", timezone: "America/Toronto", hasRegions: true },
  { code: "US", name: "United States", area: "north", currency: "usd", languages: ["en", "es"], dial: "+1", tlds: ["com"], osm: "us", timezone: "America/New_York", hasRegions: true },
  { code: "MX", name: "Mexico", localName: "México", area: "north", currency: "mxn", languages: ["es"], dial: "+52", tlds: ["com.mx", "mx", "com"], osm: "mx", timezone: "America/Mexico_City", hasRegions: true, whatsappFirst: true },
  { code: "BM", name: "Bermuda", area: "north", currency: "bmd", languages: ["en"], dial: "+1", tlds: ["bm", "com"], osm: "bm", timezone: "Atlantic/Bermuda", hasRegions: false },
  { code: "GL", name: "Greenland", localName: "Kalaallit Nunaat", area: "north", currency: "dkk", languages: ["da"], dial: "+299", tlds: ["gl", "dk", "com"], osm: "gl", timezone: "America/Nuuk", hasRegions: false },
  { code: "PM", name: "Saint Pierre and Miquelon", localName: "Saint-Pierre-et-Miquelon", area: "north", currency: "eur", languages: ["fr"], dial: "+508", tlds: ["pm", "fr", "com"], osm: "pm", timezone: "America/Miquelon", hasRegions: false },

  // ── Central America ───────────────────────────────────────
  { code: "BZ", name: "Belize", area: "central", currency: "bzd", languages: ["en", "es"], dial: "+501", tlds: ["bz", "com"], osm: "bz", timezone: "America/Belize", hasRegions: false, whatsappFirst: true },
  { code: "CR", name: "Costa Rica", area: "central", currency: "crc", languages: ["es"], dial: "+506", tlds: ["co.cr", "cr", "com"], osm: "cr", timezone: "America/Costa_Rica", hasRegions: false, whatsappFirst: true },
  { code: "SV", name: "El Salvador", area: "central", currency: "usd", languages: ["es"], dial: "+503", tlds: ["com.sv", "sv", "com"], osm: "sv", timezone: "America/El_Salvador", hasRegions: false, whatsappFirst: true },
  { code: "GT", name: "Guatemala", area: "central", currency: "gtq", languages: ["es"], dial: "+502", tlds: ["com.gt", "gt", "com"], osm: "gt", timezone: "America/Guatemala", hasRegions: false, whatsappFirst: true },
  { code: "HN", name: "Honduras", area: "central", currency: "hnl", languages: ["es"], dial: "+504", tlds: ["hn", "com.hn", "com"], osm: "hn", timezone: "America/Tegucigalpa", hasRegions: false, whatsappFirst: true },
  { code: "NI", name: "Nicaragua", area: "central", currency: "nio", languages: ["es"], dial: "+505", tlds: ["com.ni", "ni", "com"], osm: "ni", timezone: "America/Managua", hasRegions: false, whatsappFirst: true },
  { code: "PA", name: "Panama", localName: "Panamá", area: "central", currency: "usd", languages: ["es"], dial: "+507", tlds: ["com.pa", "pa", "com"], osm: "pa", timezone: "America/Panama", hasRegions: false, whatsappFirst: true },

  // ── Caribbean ─────────────────────────────────────────────
  { code: "AI", name: "Anguilla", area: "caribbean", currency: "xcd", languages: ["en"], dial: "+1", tlds: ["ai", "com"], osm: "ai", timezone: "America/Anguilla", hasRegions: false, whatsappFirst: true },
  { code: "AG", name: "Antigua and Barbuda", area: "caribbean", currency: "xcd", languages: ["en"], dial: "+1", tlds: ["ag", "com"], osm: "ag", timezone: "America/Antigua", hasRegions: false, whatsappFirst: true },
  { code: "AW", name: "Aruba", area: "caribbean", currency: "awg", languages: ["nl", "en", "es"], dial: "+297", tlds: ["aw", "com"], osm: "aw", timezone: "America/Aruba", hasRegions: false, whatsappFirst: true },
  { code: "BS", name: "Bahamas", localName: "The Bahamas", area: "caribbean", currency: "bsd", languages: ["en"], dial: "+1", tlds: ["bs", "com"], osm: "bs", timezone: "America/Nassau", hasRegions: false, whatsappFirst: true },
  { code: "BB", name: "Barbados", area: "caribbean", currency: "bbd", languages: ["en"], dial: "+1", tlds: ["com.bb", "bb", "com"], osm: "bb", timezone: "America/Barbados", hasRegions: false, whatsappFirst: true },
  { code: "VG", name: "British Virgin Islands", area: "caribbean", currency: "usd", languages: ["en"], dial: "+1", tlds: ["vg", "com"], osm: "vg", timezone: "America/Tortola", hasRegions: false, whatsappFirst: true },
  { code: "BQ", name: "Caribbean Netherlands", localName: "Caribisch Nederland", area: "caribbean", currency: "usd", languages: ["nl", "en"], dial: "+599", tlds: ["bq", "com"], osm: "bq", timezone: "America/Kralendijk", hasRegions: false, whatsappFirst: true },
  { code: "KY", name: "Cayman Islands", area: "caribbean", currency: "kyd", languages: ["en"], dial: "+1", tlds: ["ky", "com"], osm: "ky", timezone: "America/Cayman", hasRegions: false, whatsappFirst: true },
  {
    code: "CU", name: "Cuba", area: "caribbean", currency: "cup", languages: ["es"], dial: "+53", tlds: ["cu", "com"], osm: "cu", timezone: "America/Havana", hasRegions: false, whatsappFirst: true,
    paymentsNote: "Stripe and PayPal don't take payments from Cuba because of US sanctions, so a client there would need another way to pay.",
  },
  { code: "CW", name: "Curaçao", localName: "Kòrsou", area: "caribbean", currency: "xcg", languages: ["nl", "en", "es"], dial: "+599", tlds: ["cw", "com"], osm: "cw", timezone: "America/Curacao", hasRegions: false, whatsappFirst: true },
  { code: "DM", name: "Dominica", area: "caribbean", currency: "xcd", languages: ["en"], dial: "+1", tlds: ["dm", "com"], osm: "dm", timezone: "America/Dominica", hasRegions: false, whatsappFirst: true },
  { code: "DO", name: "Dominican Republic", localName: "República Dominicana", area: "caribbean", currency: "dop", languages: ["es"], dial: "+1", tlds: ["com.do", "do", "com"], osm: "do", timezone: "America/Santo_Domingo", hasRegions: false, whatsappFirst: true },
  { code: "GD", name: "Grenada", area: "caribbean", currency: "xcd", languages: ["en"], dial: "+1", tlds: ["gd", "com"], osm: "gd", timezone: "America/Grenada", hasRegions: false, whatsappFirst: true },
  { code: "GP", name: "Guadeloupe", area: "caribbean", currency: "eur", languages: ["fr"], dial: "+590", tlds: ["gp", "fr", "com"], osm: "gp", timezone: "America/Guadeloupe", hasRegions: false, whatsappFirst: true },
  { code: "HT", name: "Haiti", localName: "Haïti", area: "caribbean", currency: "htg", languages: ["fr"], dial: "+509", tlds: ["ht", "com.ht", "com"], osm: "ht", timezone: "America/Port-au-Prince", hasRegions: false, whatsappFirst: true },
  { code: "JM", name: "Jamaica", area: "caribbean", currency: "jmd", languages: ["en"], dial: "+1", tlds: ["com.jm", "jm", "com"], osm: "jm", timezone: "America/Jamaica", hasRegions: false, whatsappFirst: true },
  { code: "MQ", name: "Martinique", area: "caribbean", currency: "eur", languages: ["fr"], dial: "+596", tlds: ["mq", "fr", "com"], osm: "mq", timezone: "America/Martinique", hasRegions: false, whatsappFirst: true },
  { code: "MS", name: "Montserrat", area: "caribbean", currency: "xcd", languages: ["en"], dial: "+1", tlds: ["ms", "com"], osm: "ms", timezone: "America/Montserrat", hasRegions: false, whatsappFirst: true },
  { code: "BL", name: "Saint Barthélemy", localName: "Saint-Barthélemy", area: "caribbean", currency: "eur", languages: ["fr", "en"], dial: "+590", tlds: ["bl", "fr", "com"], osm: "bl", timezone: "America/St_Barthelemy", hasRegions: false, whatsappFirst: true },
  { code: "KN", name: "Saint Kitts and Nevis", area: "caribbean", currency: "xcd", languages: ["en"], dial: "+1", tlds: ["kn", "com"], osm: "kn", timezone: "America/St_Kitts", hasRegions: false, whatsappFirst: true },
  { code: "LC", name: "Saint Lucia", area: "caribbean", currency: "xcd", languages: ["en"], dial: "+1", tlds: ["lc", "com"], osm: "lc", timezone: "America/St_Lucia", hasRegions: false, whatsappFirst: true },
  { code: "MF", name: "Saint Martin", localName: "Saint-Martin", area: "caribbean", currency: "eur", languages: ["fr", "en"], dial: "+590", tlds: ["mf", "fr", "com"], osm: "mf", timezone: "America/Marigot", hasRegions: false, whatsappFirst: true },
  { code: "VC", name: "Saint Vincent and the Grenadines", area: "caribbean", currency: "xcd", languages: ["en"], dial: "+1", tlds: ["vc", "com"], osm: "vc", timezone: "America/St_Vincent", hasRegions: false, whatsappFirst: true },
  { code: "SX", name: "Sint Maarten", area: "caribbean", currency: "xcg", languages: ["en", "nl"], dial: "+1", tlds: ["sx", "com"], osm: "sx", timezone: "America/Lower_Princes", hasRegions: false, whatsappFirst: true },
  { code: "TT", name: "Trinidad and Tobago", area: "caribbean", currency: "ttd", languages: ["en"], dial: "+1", tlds: ["co.tt", "tt", "com"], osm: "tt", timezone: "America/Port_of_Spain", hasRegions: false, whatsappFirst: true },
  { code: "TC", name: "Turks and Caicos Islands", area: "caribbean", currency: "usd", languages: ["en"], dial: "+1", tlds: ["tc", "com"], osm: "tc", timezone: "America/Grand_Turk", hasRegions: false, whatsappFirst: true },
];

export function countryByCode(code: string | undefined): Country | undefined {
  if (!code) return undefined;
  const c = code.trim().toUpperCase();
  return COUNTRIES.find((x) => x.code === c);
}

/** The first language businesses in a country use, English when unknown. */
export function defaultLang(code: string | undefined): Lang {
  return countryByCode(code)?.languages[0] ?? "en";
}
