import { getNiche } from "../../niches.ts";
import type { Country, Review } from "../../types.ts";
import { slugify } from "../../util.ts";
import type { DemoSite, FoundBusiness } from "./google.ts";

// Fictional businesses for demo mode, so the whole crew can run end to end
// without a Google key. Phone numbers use the 555-01xx block reserved for
// fiction and emails use the reserved .example domain, so nothing can ever
// reach a real person.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SURNAMES = ["Miller", "Carter", "Hayes", "Morales", "Bennett", "Nguyen", "Patel", "O'Brien", "Kowalski", "Rivera", "Foster", "Brooks", "Sullivan", "Reyes", "Hughes", "Ward", "Delgado", "Fischer", "Grant", "Okafor", "Romano", "Sato", "Duarte", "Price", "Holloway", "Lindgren", "Castillo", "Brennan", "Albright", "Whitfield"];
const PLACES = ["Riverside", "Main Street", "Northside", "Oakwood", "Pinecrest", "Summit", "Valley", "Lakeside", "Old Town", "Westside", "Maple", "Cedar", "Union", "Liberty", "Heritage", "Hillcrest", "Meadow", "Ironwood", "Harbor", "Bridgeway", "Southgate", "Parkside"];
const STREETS = ["Main St", "Oak Ave", "2nd St", "Riverside Dr", "Market St", "Elm St", "Broadway", "Franklin Blvd", "Mill Rd", "Wall St", "Union Ave", "Lake Rd"];

const NAMES: Record<string, string[]> = {
  dentist: ["{S} Family Dental", "{P} Smiles Dentistry", "Bright Smile Dental of {C}", "{S} & {S2} Dental Care", "{P} Dental Studio"],
  chiropractor: ["{P} Chiropractic", "{S} Spine & Wellness", "Align Chiropractic {C}"],
  physio: ["{P} Physiotherapy", "{S} Sports Physio", "Motion Physio {C}"],
  vet: ["{P} Animal Hospital", "{S} Veterinary Clinic", "Paws & Claws Vet {C}"],
  med_spa: ["{P} Aesthetics", "Glow Med Spa {C}", "{S} Skin Studio"],
  salon: ["{P} Hair Studio", "Salon {S}", "The {P} Salon"],
  barber: ["{S}'s Barbershop", "{P} Barber Co.", "Main Street Barbers {C}"],
  roofer: ["{S} Roofing", "{P} Roofing & Exteriors", "{S} & Sons Roofing"],
  plumber: ["{S} Plumbing", "{P} Plumbing & Drain", "{S} Brothers Plumbing"],
  hvac: ["{P} Heating & Cooling", "{S} HVAC", "Comfort Air {C}"],
  electrician: ["{S} Electric", "{P} Electrical Services", "Bright Spark Electric {C}"],
  landscaper: ["{P} Landscaping", "{S} Lawn & Garden", "Greenline Landscapes {C}"],
  auto_repair: ["{S}'s Auto Repair", "{P} Auto Care", "{C} Car Clinic"],
  cleaning: ["{P} Cleaning Co.", "Sparkle Clean {C}", "{S} Home Cleaning"],
  painter: ["{S} Painting", "{P} Painters", "Fresh Coat {C}"],
  restaurant: ["{S}'s Kitchen", "The {P} Table", "{P} Bistro"],
  cafe: ["{P} Coffee House", "{S}'s Café", "Morning Ritual Café {C}"],
  gym: ["{P} Fitness", "{C} Strength Club", "{S} Training Studio"],
  law: ["{S} & {S2} Law", "{S} Legal", "{P} Law Group"],
  accountant: ["{S} Accounting", "{P} Tax & Bookkeeping", "{S} CPA"],
  pest_control: ["{P} Pest Control", "{S} Pest Solutions"],
  florist: ["{P} Flowers", "{S}'s Florist", "Petal & Stem {C}"],
};

const AREA: Record<string, string> = { bend: "541", boise: "208", "fort collins": "970", chattanooga: "423", kingston: "613", guelph: "519", brampton: "905", austin: "512", denver: "303", miami: "305" };

const HOURS: Record<string, string[]> = {
  clinic: ["Monday: 8:00 AM – 5:00 PM", "Tuesday: 8:00 AM – 5:00 PM", "Wednesday: 8:00 AM – 6:00 PM", "Thursday: 8:00 AM – 5:00 PM", "Friday: 8:00 AM – 2:00 PM", "Saturday: Closed", "Sunday: Closed"],
  trade: ["Monday: 7:00 AM – 6:00 PM", "Tuesday: 7:00 AM – 6:00 PM", "Wednesday: 7:00 AM – 6:00 PM", "Thursday: 7:00 AM – 6:00 PM", "Friday: 7:00 AM – 6:00 PM", "Saturday: 8:00 AM – 2:00 PM", "Sunday: Closed"],
  shop: ["Monday: Closed", "Tuesday: 9:00 AM – 7:00 PM", "Wednesday: 9:00 AM – 7:00 PM", "Thursday: 9:00 AM – 8:00 PM", "Friday: 9:00 AM – 8:00 PM", "Saturday: 9:00 AM – 5:00 PM", "Sunday: Closed"],
  food: ["Monday: 7:00 AM – 3:00 PM", "Tuesday: 7:00 AM – 3:00 PM", "Wednesday: 7:00 AM – 3:00 PM", "Thursday: 7:00 AM – 9:00 PM", "Friday: 7:00 AM – 10:00 PM", "Saturday: 8:00 AM – 10:00 PM", "Sunday: 8:00 AM – 2:00 PM"],
};

const HOURS_FOR: Record<string, keyof typeof HOURS> = {
  dentist: "clinic", chiropractor: "clinic", physio: "clinic", vet: "clinic", med_spa: "shop", salon: "shop", barber: "shop",
  roofer: "trade", plumber: "trade", hvac: "trade", electrician: "trade", landscaper: "trade", auto_repair: "trade", cleaning: "trade",
  painter: "trade", restaurant: "food", cafe: "food", gym: "shop", law: "clinic", accountant: "clinic", pest_control: "trade", florist: "shop",
};

const FIRST = ["Sarah", "Mike", "Priya", "Dave", "Jen", "Carlos", "Amanda", "Tom", "Linh", "Rachel", "Marcus", "Erin", "Kevin", "Olivia", "Sam", "Nadia"];

function reviewsFor(nicheId: string, r: () => number): Review[] {
  const niche = getNiche(nicheId);
  const svc = niche.services.map((s) => s.name.toLowerCase());
  const lines = [
    `Called on a Monday and they fit me in the same week. Friendly, on time and they explained everything before starting on the ${svc[0]}.`,
    `Honest, fair and they actually picked up the phone. We've used them for ${svc[1] ?? svc[0]} twice now and would not go anywhere else.`,
    `The whole team is great. Clean, professional and no upselling. Highly recommend to anyone in town.`,
    `Best experience I've had in years. They took the time to walk me through my options and the price was exactly what they quoted.`,
    `Booking was the only hard part, I had to call a few times. Once I got in, the service was excellent.`,
  ];
  const n = 3 + Math.floor(r() * 3);
  return lines.slice(0, n).map((text, i) => ({
    author: `${FIRST[Math.floor(r() * FIRST.length)]} ${String.fromCharCode(65 + Math.floor(r() * 26))}.`,
    rating: i === 4 ? 4 : 5,
    text,
    when: ["a week ago", "2 weeks ago", "a month ago", "3 months ago", "5 months ago"][i],
  }));
}

function pick<T>(r: () => number, list: T[]): T {
  return list[Math.floor(r() * list.length)];
}

function siteState(r: () => number): DemoSite["state"] {
  const x = r();
  if (x < 0.32) return "none";
  if (x < 0.46) return "social_only";
  if (x < 0.56) return "dead";
  if (x < 0.8) return "outdated";
  if (x < 0.9) return "weak";
  return "modern";
}

export function demoSearch(opts: { niche: string; city: string; region?: string; country: Country; max: number; seed?: string }): FoundBusiness[] {
  const niche = getNiche(opts.niche);
  const r = rng(`${opts.seed ?? ""}|${opts.city}|${opts.niche}`);
  const area = AREA[opts.city.toLowerCase()] ?? "555";
  const templates = NAMES[niche.id] ?? ["{S} " + niche.label];
  const seen = new Set<string>();
  const out: FoundBusiness[] = [];
  const count = Math.min(opts.max, 14 + Math.floor(r() * 12));
  for (let i = 0; i < count * 3 && out.length < count; i++) {
    const name = pick(r, templates)
      .replace("{S2}", pick(r, SURNAMES))
      .replace("{S}", pick(r, SURNAMES))
      .replace("{P}", pick(r, PLACES))
      .replace("{C}", opts.city);
    if (seen.has(name)) continue;
    seen.add(name);
    const state = siteState(r);
    const slug = slugify(name, 30);
    const reviewCount = Math.round(Math.pow(r(), 1.7) * 320);
    const rating = Math.round((3.4 + Math.pow(r(), 0.45) * 1.6) * 10) / 10;
    const year = 2009 + Math.floor(r() * 9);
    const website =
      state === "none"
        ? undefined
        : state === "social_only"
          ? `https://www.facebook.com/${slug.replace(/-/g, "")}`
          : state === "dead"
            ? `http://${slug}.example`
            : `http://www.${slug}.example`;
    out.push({
      sourceId: `demo:${slugify(opts.city)}:${niche.id}:${slug}`,
      name,
      address: `${100 + Math.floor(r() * 2800)} ${pick(r, STREETS)}, ${opts.city}, ${opts.region ?? ""}`.replace(/, $/, ""),
      city: opts.city,
      region: opts.region,
      country: opts.country,
      phone: `(${area}) 555-01${String(Math.floor(r() * 100)).padStart(2, "0")}`,
      website,
      mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${opts.city}`)}`,
      rating: reviewCount ? rating : undefined,
      reviewCount,
      hours: r() < 0.85 ? HOURS[HOURS_FOR[niche.id] ?? "trade"] : undefined,
      primaryType: niche.id,
      businessStatus: r() < 0.03 ? "CLOSED_PERMANENTLY" : "OPERATIONAL",
      demo: {
        state,
        copyrightYear: state === "outdated" ? year : state === "weak" ? 2019 + Math.floor(r() * 3) : state === "modern" ? 2026 : undefined,
        email: ["outdated", "weak", "modern"].includes(state) && r() < 0.8 ? `hello@${slug}.example` : undefined,
        reviews: reviewCount > 2 ? reviewsFor(niche.id, r) : [],
      },
    });
  }
  return out;
}
