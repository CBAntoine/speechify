import "server-only";
import { NICHES, getNiche, matchNiche, type Niche } from "@/lib/niches";
import { listLeads, findDuplicate } from "@/lib/repo";
import type { LeadSource, Prospect } from "@/lib/types";
import { findBusinessesWithClaude } from "@/lib/claude/find-businesses";
import { describeError as describeClaudeError } from "@/lib/claude/client";
import { claudeEnabled } from "@/lib/config";
import { expandPlace, parsePlace } from "@/lib/regions";
import { auditWebsite, mapLimit } from "./audit";
import { crawlSite, findWebsite } from "./crawler";
import { searchOpenData } from "./opendata";
import { geocode, searchOsm, type Place } from "./osm";
import { placesEnabled, searchPlaces } from "./places";
import { formatPhone } from "./crawl-parse";
import { crawlOrder, mergeProspects, WEB_RESEARCH } from "./research-parse";
import { deriveSignals, scoreProspect } from "./score";

export interface SearchInput {
  niche: string;
  location: string;
  limit?: number;
  radiusKm?: number;
  /** Audit the websites of the first N results. */
  audit?: number;
  source?: "auto" | "google" | "osm";
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
  /** Every source searched, with how many businesses each found. */
  sources?: { label: string; count: number; url?: string }[];
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
    // Map search looks for these words in business names: the whole phrase,
    // then its longer words ("tattoo studio", "tattoo", "studio").
    nameWords: [...new Set([clean, ...clean.split(/\s+/).filter((w) => w.replace(/[^a-z0-9]/gi, "").length > 3)])].slice(0, 3),
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

interface Normalized {
  niche: Niche;
  near?: { lat: number; lon: number };
  location: string;
  limit: number;
  radiusKm: number;
  wanted: NonNullable<SearchInput["source"]>;
}

function normalize(input: SearchInput): Normalized {
  const niche = resolveNiche(input.niche);
  const near =
    input.near && Number.isFinite(input.near.lat) && Number.isFinite(input.near.lon) && Math.abs(input.near.lat) <= 90 && Math.abs(input.near.lon) <= 180
      ? input.near
      : undefined;
  const location = input.location.trim() || (near ? "your location" : "");
  if (!location) throw new Error("Add a city or area to search in");
  return {
    niche,
    near,
    location,
    limit: Math.max(1, Math.min(input.limit ?? 20, 60)),
    radiusKm: Math.max(1, Math.min(input.radiusKm ?? 12, 50)),
    wanted: input.source ?? "auto",
  };
}

/** The in-house finder when asked for, or when there's no Google Places key. */
function inHouse(wanted: Normalized["wanted"]): boolean {
  return wanted === "osm" || (wanted === "auto" && !placesEnabled());
}

async function searchCenter(n: Normalized): Promise<Place> {
  const center = n.near ? { lat: n.near.lat, lon: n.near.lon, label: "your location" } : ((await geocode(n.location)) ?? undefined);
  if (!center) throw new Error(`Couldn't find "${n.location}" on the map. Pick a province or state and a city, or type it as "City, ON".`);
  if (n.niche.id === "custom" && !n.niche.nameWords?.length) throw new Error("Pick a niche from the list for map search");
  return center;
}

/** Audit, score, mark ones already saved, best first. */
async function finish(
  n: Normalized,
  found: { source: LeadSource; prospects: Prospect[]; center?: Place; note?: string; sources?: SearchResult["sources"] },
  audit?: number
): Promise<SearchResult> {
  let prospects = found.prospects;
  if (audit && audit > 0) {
    prospects = await auditProspects(prospects, audit);
  }
  prospects = scoreAll(prospects, n.niche);

  const leads = await listLeads();
  prospects = prospects.map((p) => {
    const dup = findDuplicate(leads, p);
    return dup ? { ...p, savedLeadId: dup.id } : p;
  });
  prospects.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return {
    niche: n.niche,
    location: n.location,
    source: found.source,
    center: found.center,
    prospects: prospects.slice(0, n.limit),
    note: found.note,
    sources: found.sources,
  };
}

/**
 * Rainmaker's crawler on each business: find the website when no source
 * listed one, then read it for the audit and for phone, email and address.
 * Stops starting new sites at the deadline.
 */
async function crawlProspects(prospects: Prospect[], opts: { tlds: string[]; places: string[]; deadline: number; count: number }): Promise<void> {
  await mapLimit(prospects.slice(0, opts.count), 6, async (p) => {
    if (Date.now() > opts.deadline) return;
    if (!p.website && (p.source === "openstreetmap" || p.source === "open_data")) {
      // The site must mention the business's town or province (or its phone),
      // so a same-name business elsewhere isn't taken for it.
      const places = [...new Set([...opts.places, ...(p.city ? [p.city] : [])])];
      const found = await findWebsite(p.name, { tlds: opts.tlds, phone: p.phone, places, deadline: opts.deadline });
      if (found) {
        p.website = found;
        p.websiteFound = true;
      }
    }
    if (!p.website || Date.now() > opts.deadline) return;
    const { audit, contacts } = await crawlSite(p.website);
    if (p.source === "web" && !audit.reachable && /domain not found/i.test(audit.error ?? "")) {
      // A web address from the research that doesn't exist: leave it out
      // rather than report the business's site as down.
      p.website = undefined;
      return;
    }
    p.audit = audit;
    p.phone ??= contacts.phones[0];
    p.email ??= contacts.emails[0];
    p.address ??= contacts.address;
  });
}

const OSM = "OpenStreetMap";

export async function findBusinesses(input: SearchInput): Promise<SearchResult> {
  const n = normalize(input);
  if (!inHouse(n.wanted)) {
    const prospects = await searchPlaces({ niche: n.niche, location: n.location, limit: n.limit, near: n.near ? { ...n.near, radiusKm: n.radiusKm } : undefined });
    return finish(n, { source: "google_places", prospects }, input.audit);
  }

  // In-house: the free sources in parallel, Claude's web research when they
  // come up short, then one list crawled and scored.
  const center = await searchCenter(n);
  const place = n.near ? undefined : expandPlace(n.location);
  const town = n.near ? undefined : parsePlace(n.location).city || undefined;
  const errors: string[] = [];
  const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
  const [osm, open] = await Promise.all([
    searchOsm({ niche: n.niche, center, radiusKm: n.radiusKm, limit: Math.max(n.limit, 30) })
      .then((list) => list.map((p) => ({ ...p, foundIn: [OSM] })))
      .catch((e) => {
        errors.push(`${OSM}: ${reason(e)}`);
        return [] as Prospect[];
      }),
    searchOpenData({ niche: n.niche, center, radiusKm: n.radiusKm, town }).catch((e) => {
      errors.push(`City licence lists: ${reason(e)}`);
      return { prospects: [], used: [], errors: [] } as Awaited<ReturnType<typeof searchOpenData>>;
    }),
  ]);
  errors.push(...open.errors);

  let web: Prospect[] = [];
  const claude = claudeEnabled();
  if (claude && !n.near && mergeProspects([osm, open.prospects]).length < n.limit) {
    try {
      web = await findBusinessesWithClaude(n.niche, n.location, { limit: 25, budgetMs: 80_000 });
    } catch (e) {
      errors.push(`${WEB_RESEARCH}: ${describeClaudeError(e)}`);
    }
  }

  const merged = mergeProspects([osm, open.prospects, web]);
  for (const p of merged) if (p.phone) p.phone = formatPhone(p.phone) ?? p.phone;
  if (!merged.length && errors.length) throw new Error(errors[0]);
  if (errors.length) console.warn("[search] some sources failed:", errors.join(" | "));

  const pool = crawlOrder(merged, center).slice(0, n.limit + 6);
  if (input.audit && input.audit > 0) {
    const region = n.near ? undefined : parsePlace(n.location).region;
    await crawlProspects(pool, {
      tlds: place?.countryCode === "us" ? ["com"] : ["ca", "com"],
      places: [town, place?.state, region?.code].filter((x): x is string => !!x),
      deadline: Date.now() + 40_000,
      count: Math.max(input.audit, pool.length),
    });
  }

  const sources: NonNullable<SearchResult["sources"]> = [
    { label: OSM, count: osm.length, url: "https://www.openstreetmap.org/copyright" },
    ...open.used.map((u) => ({ label: u.label, count: u.count, url: u.url })),
    ...(claude && web.length ? [{ label: WEB_RESEARCH, count: web.length }] : []),
  ];
  const primary: LeadSource = osm.length ? "openstreetmap" : open.prospects.length ? "open_data" : web.length ? "web" : "openstreetmap";
  const note = claude
    ? "Found with OpenStreetMap, city licence lists and Claude's web research. Websites, phones and emails come from Rainmaker's crawler; confirm before you pitch."
    : "Free sources: OpenStreetMap (© OpenStreetMap contributors) and city licence lists (Toronto, Vancouver, Calgary, Edmonton). Websites, phones and emails come from Rainmaker's crawler. Add a Claude API key so it also searches the web, which finds far more tradespeople.";
  return finish(n, { source: primary, prospects: pool, center, note, sources }, 0);
}
