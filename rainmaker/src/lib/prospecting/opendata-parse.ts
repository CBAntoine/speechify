// City business-licence lists, published as open data under each city's
// open government licence. They list registered businesses, contractors
// included, which OpenStreetMap mostly lacks: Edmonton has 136 licensed
// roofing businesses. They give names and addresses (Toronto sometimes a
// phone) but no websites; the crawler finds those. Pure helpers, unit tested.

import type { Niche } from "../niches.ts";

/** How a niche shows up in business names: coarse API filter, precise check. */
export interface NamePattern {
  /** Uppercase substrings for the city APIs (fast, loose). */
  like: string[];
  /** The precise test on the name. */
  re: RegExp;
}

const PATTERNS: Record<string, NamePattern> = {
  dentist: { like: ["DENT", "ORTHODONT"], re: /\b(dental|dentist|dentistry|dentures?|orthodont|endodont|periodont)/i },
  med_spa: { like: ["SPA", "AESTHETIC", "LASER", "BOTOX", "SKIN", "COSMETIC"], re: /\b(med ?spa|medi ?spa|aesthetics?|laser|botox|injectables?|skin (clinic|care)|cosmetic (clinic|surgery))/i },
  roofer: { like: ["ROOF"], re: /\broof(s|ing|er|ers)?\b/i },
  hvac: { like: ["HEATING", "HVAC", "AIR CONDITION", "FURNACE", "COOLING", "REFRIGERATION"], re: /\b(hvac|heating|air condition|cooling|furnaces?|refrigeration)/i },
  plumber: { like: ["PLUMB", "DRAIN", "ROOTER", "SEWER"], re: /\b(plumb|drains?\b|drain (cleaning|services?)|rooter|sewer)/i },
  chiropractor: { like: ["CHIRO"], re: /\bchiro/i },
  law_pi: {
    like: ["LAW", "LEGAL", "INJURY", "BARRISTER", "ATTORNEY"],
    re: /\b(injury|accident|lawyers?|law (office|offices|firm|group|corporation|professional|chambers)|legal|barristers?|attorneys?)\b/i,
  },
  real_estate: { like: ["REALTY", "REAL ESTATE", "REALTOR"], re: /\b(realty|real estate|realtors?)\b/i },
  gym: { like: ["FITNESS", "GYM", "CROSSFIT", "PILATES", "YOGA", "BOOTCAMP", "BOOT CAMP"], re: /\b(fitness|gym|crossfit|pilates|yoga|boot ?camp)/i },
  restaurant: {
    like: ["RESTAURANT", "BISTRO", "GRILL", "KITCHEN", "PIZZ", "SUSHI", "DINER", "EATERY", "CAFE", "TAVERN"],
    re: /\b(restaurant|bistro|grill|kitchen|pizz|sushi|diner|eatery|caf[eé]|tavern|ramen|pho|taqueria)/i,
  },
  salon: { like: ["SALON", "BARBER", "HAIR"], re: /\b(salon|barbers?|barbershop|hair)/i },
  auto_repair: {
    like: ["AUTO", "MOTOR", "MECHANIC", "TIRE", "COLLISION", "BRAKE", "TRANSMISSION", "MUFFLER", "LUBE"],
    re: /\b(automotive|auto (repair|service|services|care|body|centre|center|clinic|shop|works)|mechanic|tires?\b|tyres?\b|collision|brakes?\b|transmission|muffler|lube)/i,
  },
  cleaning: { like: ["CLEAN", "MAID", "JANITOR"], re: /\b(clean|maids?\b|janitor)/i },
  landscaping: {
    like: ["LANDSCAP", "LAWN", "GARDEN", "TREE", "YARD", "HARDSCAP"],
    re: /\b(landscap|hardscap|lawn (care|services?|maintenance|cutting|mowing|pros?)|garden(ing)? (care|services?|design|maintenance)|tree (service|care|removal|experts?)|yard (care|works?))/i,
  },
  pest_control: { like: ["PEST", "EXTERMIN", "TERMITE"], re: /\b(pest|extermin|termite)/i },
  veterinarian: { like: ["VETERINAR", "ANIMAL HOSPITAL", "PET HOSPITAL", "VET "], re: /\b(veterinar|animal (hospital|clinic)|pet (hospital|clinic)|vet (clinic|hospital|services?))/i },
  physical_therapy: { like: ["PHYSIO", "REHAB", "PHYSICAL THERAP", "KINESIO"], re: /\b(physio|rehab|physical therap|kinesio|sports medicine)/i },
  accountant: { like: ["ACCOUNT", "CPA", "BOOKKEEP", "TAX"], re: /\b(accountants?|accounting|cpa\b|bookkeep|tax (services?|prep|preparation|returns?|consult))/i },
};

/** Letters, digits and spaces only, so a pattern is safe inside any API's query. */
export function cleanWord(w: string): string {
  return w.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
}

export function namePattern(niche: Pick<Niche, "id" | "nameWords">): NamePattern | undefined {
  if (PATTERNS[niche.id]) return PATTERNS[niche.id];
  const words = (niche.nameWords ?? []).map(cleanWord).filter((w) => w.length >= 4);
  if (!words.length) return undefined;
  const alt = words.map((w) => w.toLowerCase().replace(/ /g, "\\s+")).join("|");
  return { like: [...new Set(words)].slice(0, 4), re: new RegExp(`\\b(${alt})`, "i") };
}

// Categories that never belong to a service business a niche search wants
// (unless the niche is food). Toronto files a rooftop bar under "roof".
const NOT_A_SERVICE = /(eating|drinking|food|restaurant|taxi|limousine|transportation|sign\b|tobacco|vape|cannabis|liquor|alcohol|rental accommodation|short-term rental|long-term rental|apartment|body rub|erotic)/i;
const FOOD = /(eating|food|restaurant|caf[eé])/i;

export function categoryFits(nicheId: string, category: string | undefined): boolean {
  if (!category) return true;
  if (nicheId === "restaurant") return FOOD.test(category);
  return !NOT_A_SERVICE.test(category);
}

const SUFFIX: Record<string, string> = { LTD: "Ltd.", "LTD.": "Ltd.", INC: "Inc.", "INC.": "Inc.", CORP: "Corp.", "CORP.": "Corp.", CO: "Co.", "CO.": "Co.", LLP: "LLP", LLC: "LLC" };
const KEEP_UPPER = new Set(["HVAC", "BBQ", "CPA", "RMT", "GTA", "USA", "TV", "AC", "DJ", "PT", "MD", "DDS", "II", "III", "IV"]);
const SMALL = new Set(["AND", "OF", "THE", "FOR", "IN", "ON", "AT", "BY", "&"]);

/** "MT PLUMBING AND HEATING LTD" → "MT Plumbing and Heating Ltd.". Mixed-case names stay as they are. */
export function tidyName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  if (/[a-z]/.test(name)) return name;
  return name
    .split(" ")
    .map((tok, i) => {
      if (SUFFIX[tok]) return SUFFIX[tok];
      if (KEEP_UPPER.has(tok)) return tok;
      if (i > 0 && SMALL.has(tok)) return tok.toLowerCase();
      // Each part of "E-NRG": initialisms without vowels ("NRG", "MT", "JTM")
      // stay in capitals, other words get a capital first letter.
      return tok
        .split("-")
        .map((part) =>
          /^[A-Z]{1,4}$/.test(part) && !/[AEIOUY]/.test(part)
            ? part
            : part.toLowerCase().replace(/(^|['’(/])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase())
        )
        .join("-");
    })
    .join(" ");
}

/** Names compared across sources: "Coverall Roofing Ltd." = "COVERALL ROOFING". */
export function nameKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|ltd|limited|inc|incorporated|corp|corporation|co|company|llc|llp|lp|professional corporation|pc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One business from a licence list, before scoring. */
export interface LicenceRecord {
  city: string;
  id: string;
  name: string;
  category?: string;
  address?: string;
  /** The city in the address, uppercase, when the record gives one. */
  addressCity?: string;
  postalCode?: string;
  phone?: string;
  lat?: number;
  lon?: number;
}

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n !== 0 ? n : undefined;
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function fromEdmonton(r: Record<string, unknown>): LicenceRecord | undefined {
  const name = str(r.business_name);
  if (!name) return undefined;
  const addr = str(r.business_address);
  return {
    city: "edmonton",
    id: str(r.externalid) ?? name,
    name,
    category: str(r.business_licence_category),
    // "<Home Based Business>" and "<Non-Resident Business>" hide the address.
    address: addr && !addr.startsWith("<") ? `${addr}, Edmonton, AB` : undefined,
    lat: num(r.latitude),
    lon: num(r.longitude),
  };
}

export function fromCalgary(r: Record<string, unknown>): LicenceRecord | undefined {
  const name = str(r.tradename);
  if (!name) return undefined;
  const coords = (r.point as { coordinates?: unknown[] } | undefined)?.coordinates;
  const addr = str(r.address);
  return {
    city: "calgary",
    id: str(r.getbusid) ?? name,
    name,
    category: str(r.licencetypes)?.replace(/\s*,\s*/g, ", "),
    address: addr ? `${addr}, Calgary, AB` : undefined,
    lat: num(coords?.[1]),
    lon: num(coords?.[0]),
  };
}

export function fromVancouver(r: Record<string, unknown>): LicenceRecord | undefined {
  // businessname is often a person ("(Sally Ng)"); the trade name is the business.
  const trade = str(r.businesstradename);
  const legal = str(r.businessname);
  const name = trade ?? (legal && !legal.startsWith("(") ? legal : undefined);
  if (!name) return undefined;
  const street = [str(r.unit) ? `${str(r.unit)}-` : "", [str(r.house), str(r.street)].filter(Boolean).join(" ")].join("");
  const geo = r.geo_point_2d as { lat?: unknown; lon?: unknown } | undefined;
  return {
    city: "vancouver",
    id: str(r.licencenumber) ?? name,
    name,
    category: str(r.businesstype),
    address: street ? [street, `${str(r.city) ?? "Vancouver"}, BC`, str(r.postalcode)].filter(Boolean).join(", ") : undefined,
    // Out-of-town businesses licensed to work in Vancouver ("Langley") carry their own city.
    addressCity: str(r.city)?.toUpperCase(),
    postalCode: str(r.postalcode),
    lat: num(geo?.lat),
    lon: num(geo?.lon),
  };
}

export function fromToronto(r: Record<string, unknown>): LicenceRecord | undefined {
  if (str(r["Cancel Date"])) return undefined;
  const name = str(r["Operating Name"]) ?? str(r["Client Name"]);
  if (!name) return undefined;
  const cityLine = str(r["Licence Address Line 2"]);
  const digits = str(r["Business Phone"])?.replace(/\D/g, "");
  const ext = str(r["Business Phone Ext."]);
  return {
    city: "toronto",
    id: str(r["Licence No."]) ?? name,
    name,
    category: str(r.Category),
    address: [str(r["Licence Address Line 1"]), cityLine, str(r["Licence Address Line 3"])].filter(Boolean).join(", ") || undefined,
    addressCity: cityLine?.replace(/,.*$/, "").trim().toUpperCase(),
    postalCode: str(r["Licence Address Line 3"]),
    phone: digits && digits.length >= 10 ? `(${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}${ext ? ` ext. ${ext}` : ""}` : undefined,
  };
}

/** Socrata (Edmonton, Calgary): name LIKE any word, plus the active-licence clause. */
export function socrataWhere(field: string, like: string[], active: string): string {
  const ors = like.map(cleanWord).filter(Boolean).map((w) => `upper(${field}) like '%${w}%'`);
  return `(${ors.join(" OR ")}) AND ${active}`;
}

/** Vancouver's ODSQL: trade or legal name LIKE any word, issued this year or last. */
export function vancouverWhere(like: string[], year: number): string {
  const yy = (y: number) => `"${String(y % 100).padStart(2, "0")}"`;
  const ors = like
    .map(cleanWord)
    .filter(Boolean)
    .flatMap((w) => [`businesstradename like "%${w}%"`, `businessname like "%${w}%"`]);
  return `status="Issued" and folderyear in (${yy(year)}, ${yy(year - 1)}) and (${ors.join(" or ")})`;
}

/** Toronto's CKAN full-text query: word prefixes, OR'ed ("plumb:* | drain:*"). */
export function torontoQuery(like: string[]): string {
  return like
    .map(cleanWord)
    .filter(Boolean)
    .map((w) => w.toLowerCase().split(" ").filter(Boolean).map((p) => `${p}:*`).join(" & "))
    .map((t) => (t.includes("&") ? `(${t})` : t))
    .join(" | ");
}
