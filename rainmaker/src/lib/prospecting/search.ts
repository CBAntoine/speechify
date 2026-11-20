import "server-only";
import { NICHES, getNiche, matchNiche, type Niche } from "@/lib/niches";
import { listLeads, findDuplicate } from "@/lib/repo";
import type { LeadSource, Prospect } from "@/lib/types";
import { auditWebsite, mapLimit } from "./audit";
import { geocode, searchOsm, type Place } from "./osm";
import { placesEnabled, searchPlaces } from "./places";
import { deriveSignals, scoreProspect } from "./score";

export interface SearchInput {
  niche: string;
  location: string;
  limit?: number;
  radiusKm?: number;
  /** Audit the websites of the first N results. */
  audit?: number;
  source?: "auto" | "google" | "osm" | "sample";
  /** Search around coordinates (e.g. the phone's GPS) instead of geocoding `location`. */
  near?: { lat: number; lon: number };
}

export interface SearchResult {
  niche: Niche;
  location: string;
  source: LeadSource;
  center?: Place;
  prospects: Prospect[];
  note?: string;
}

function customNiche(text: string): Niche {
  const clean = text.trim().slice(0, 60);
  const base = NICHES[0];
  return {
    ...base,
    id: "custom",
    label: clean,
    plural: clean,
    icon: "Store",
    query: clean,
    osmTags: [],
    osmName: clean.replace(/[^a-z0-9 ]/gi, "").split(/\s+/).filter((w) => w.length > 2).join("|") || clean,
    booking: false,
    customerValue: "Varies",
    retainer: "Varies",
    retainerMid: 1500,
    painPoints: [],
    offers: [],
    angles: [],
    channels: ["Meta (Facebook/Instagram)", "Google Search"],
    keywords: [clean],
  };
}

export function resolveNiche(text: string): Niche {
  return getNiche(text) ?? matchNiche(text) ?? customNiche(text);
}

export function scoreAll(prospects: Prospect[], niche: Niche): Prospect[] {
  return prospects.map((p) => {
    const input = {
      website: p.website,
      phone: p.phone,
      rating: p.rating,
      reviewCount: p.reviewCount,
      source: p.source,
      booking: niche.booking,
      retainerMid: niche.retainerMid,
      audit: p.audit,
    };
    const signals = deriveSignals(input);
    return { ...p, signals, score: scoreProspect(input, signals) };
  });
}

export async function auditProspects(prospects: Prospect[], max: number): Promise<Prospect[]> {
  const targets = prospects.filter((p) => p.website && !p.audit).slice(0, max);
  const audited = await mapLimit(targets, 4, async (p) => ({ key: p.key, audit: await auditWebsite(p.website!) }));
  const byKey = new Map(audited.map((a) => [a.key, a.audit]));
  return prospects.map((p) => {
    const audit = byKey.get(p.key) ?? p.audit;
    return audit ? { ...p, audit, email: p.email ?? audit.emails[0] } : p;
  });
}

const SAMPLE_PREFIX = ["Cedar Ridge", "Lakeside", "Northstar", "Oak & Iron", "Harbor", "Bluebird", "Summit", "Riverbend", "Maple Street", "Golden Hour", "Pinecrest", "Copper Canyon"];

/** Small deterministic PRNG so sample data is stable per city. */
function rng(seedText: string) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fictional businesses for trying the app offline. Always labelled "sample". */
export function sampleProspects(niche: Niche, location: string, n: number): Prospect[] {
  const rand = rng(`${niche.id}|${location.toLowerCase()}`);
  const pick = (p: number) => rand() < p;
  const out: Prospect[] = [];
  const offset = Math.floor(rand() * SAMPLE_PREFIX.length);
  for (let i = 0; i < Math.min(n, SAMPLE_PREFIX.length); i++) {
    const prefix = SAMPLE_PREFIX[(i + offset) % SAMPLE_PREFIX.length];
    const label = niche.label.replace(/ \/.*$/, "").replace(/\b\w/g, (c) => c.toUpperCase());
    const name = `${prefix} ${label}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const hasSite = pick(0.8);
    const reviewCount = Math.floor(3 + rand() * 240);
    out.push({
      key: `sample:${slug}`,
      name,
      niche: niche.id,
      category: niche.label,
      address: `${location} (sample)`,
      city: location,
      phone: `(555) 555-01${String(10 + i).padStart(2, "0")}`,
      website: hasSite ? `https://${slug}.example` : undefined,
      rating: Math.round((3.6 + rand() * 1.35) * 10) / 10,
      reviewCount,
      source: "sample",
      audit: hasSite
        ? {
            url: `https://${slug}.example`,
            fetchedAt: new Date().toISOString(),
            reachable: pick(0.92),
            https: pick(0.8),
            status: 200,
            responseMs: Math.round(600 + rand() * 4200),
            mobileViewport: pick(0.7),
            analytics: pick(0.55) ? ["Google Analytics 4"] : [],
            pixels: pick(0.35) ? ["Meta Pixel"] : [],
            booking: pick(0.35) ? ["Booking link or form"] : [],
            chat: pick(0.2) ? ["Podium"] : [],
            reviewsWidgets: [],
            hasContactForm: pick(0.7),
            hasClickToCall: pick(0.6),
            hasSchema: pick(0.3),
            hasOgImage: true,
            copyrightYear: 2017 + Math.floor(rand() * 10),
            socials: pick(0.65) ? ["Facebook"] : [],
            emails: [],
            phones: [],
            title: name,
            description: pick(0.7) ? `${name} in ${location}` : undefined,
          }
        : undefined,
    });
  }
  return out;
}

export async function findBusinesses(input: SearchInput): Promise<SearchResult> {
  const niche = resolveNiche(input.niche);
  const near =
    input.near && Number.isFinite(input.near.lat) && Number.isFinite(input.near.lon) && Math.abs(input.near.lat) <= 90 && Math.abs(input.near.lon) <= 180
      ? input.near
      : undefined;
  const location = input.location.trim() || (near ? "your location" : "");
  if (!location) throw new Error("Add a city or area to search in");
  const limit = Math.max(1, Math.min(input.limit ?? 20, 60));
  const radiusKm = Math.max(1, Math.min(input.radiusKm ?? 12, 50));
  const wanted = input.source ?? "auto";

  let prospects: Prospect[] = [];
  let source: LeadSource;
  let center: Place | undefined;
  let note: string | undefined;

  if (wanted === "sample") {
    prospects = sampleProspects(niche, location, limit);
    source = "sample";
    note = "Sample businesses (fictional) so you can try the workflow offline.";
  } else if ((wanted === "auto" && placesEnabled()) || wanted === "google") {
    prospects = await searchPlaces({ niche, location, limit, near: near ? { ...near, radiusKm } : undefined });
    source = "google_places";
  } else {
    center = near ? { lat: near.lat, lon: near.lon, label: "your location" } : ((await geocode(location)) ?? undefined);
    if (!center) throw new Error(`Couldn't find "${location}" on the map. Try "City, State".`);
    if (niche.id === "custom" && !niche.osmName) throw new Error("Pick a niche from the list for map search");
    prospects = await searchOsm({ niche, center, radiusKm, limit });
    source = "openstreetmap";
    note = placesEnabled()
      ? undefined
      : "Free OpenStreetMap data: no ratings or review counts, and some listings miss websites. Add a Google Places key for richer results.";
  }

  if (input.audit && input.audit > 0 && source !== "sample") {
    prospects = await auditProspects(prospects, input.audit);
  }
  prospects = scoreAll(prospects, niche);

  const leads = await listLeads();
  prospects = prospects.map((p) => {
    const dup = findDuplicate(leads, p);
    return dup ? { ...p, savedLeadId: dup.id } : p;
  });
  prospects.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { niche, location, source, center, prospects, note };
}
