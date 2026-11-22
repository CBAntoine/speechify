import "server-only";
import { friendlyNetError } from "@/lib/net";
import { expandPlace } from "@/lib/regions";
import type { Niche } from "@/lib/niches";
import type { Prospect } from "@/lib/types";
import { nominatimTerms, nominatimToElements, viewboxAround, type NominatimRow } from "./nominatim-parse";
import { namePattern } from "./opendata-parse";
import { buildOverpassQuery, parseOverpass, type OsmElement } from "./osm-parse";
import { overpassUrls, queryOverpass } from "./overpass";

// OpenStreetMap: free, no key. Nominatim, OpenStreetMap's search server,
// turns "London, ON" into coordinates and finds the businesses around them.
// The public Overpass servers turn away requests from cloud hosts like
// Vercel, so Overpass is used only when OVERPASS_URL points at a server you
// run or pay for. Both ask for an identifying User-Agent and light use:
// Nominatim allows one request per second.

const UA = "Rainmaker/0.1 (self-hosted agency CRM)";
const NOMINATIM = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const OVERPASS_URL = process.env.OVERPASS_URL;

export interface Place {
  lat: number;
  lon: number;
  label: string;
}

type Caches = { __rmGeoCache?: Map<string, Place>; __rmPoiCache?: Map<string, { at: number; elements: OsmElement[] }> };
const geoCache = ((globalThis as Caches).__rmGeoCache ??= new Map());
const poiCache = ((globalThis as Caches).__rmPoiCache ??= new Map());
const POI_TTL_MS = 10 * 60_000;

// Every Nominatim request from this server waits its turn, at least 1.1s
// after the previous one.
let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();
function nominatimTurn(): Promise<void> {
  const turn = queue.then(async () => {
    const wait = lastCall + 1_100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
  });
  queue = turn.catch(() => {});
  return turn;
}

async function nominatim<T>(what: string, params: Record<string, string>): Promise<T[]> {
  await nominatimTurn();
  const url = `${NOMINATIM}/search?${new URLSearchParams({ format: "jsonv2", limit: "1", ...params })}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en" }, signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new Error(`Couldn't reach OpenStreetMap to look up ${what} (${friendlyNetError(err, 15_000)}). Try again in a minute, or try sample data.`);
  }
  if (!res.ok) throw new Error(`OpenStreetMap search failed (HTTP ${res.status}). Try again in a minute.`);
  return (await res.json()) as T[];
}

/**
 * "London, ON" → coordinates. A known province or state is looked up as a
 * city in that province, kept inside its country (so not London, England).
 * Anything else is looked up as typed.
 */
export async function geocode(location: string): Promise<Place | null> {
  const p = expandPlace(location);
  const key = `${p.query.toLowerCase()}|${p.countryCode ?? ""}`;
  if (geoCache.has(key)) return geoCache.get(key)!;
  type Row = { lat: string; lon: string; display_name: string };
  const within: Record<string, string> = p.countryCode ? { countrycodes: p.countryCode } : {};
  const what = `"${location}"`;
  let rows =
    p.city && p.state && p.country
      ? await nominatim<Row>(what, { city: p.city, state: p.state, country: p.country, ...within })
      : await nominatim<Row>(what, { q: p.query, ...within });
  if (!rows.length && p.city && p.state) {
    // Not filed as a city (a neighbourhood, say): try plain text, still
    // inside the country.
    rows = await nominatim<Row>(what, { q: p.query, ...within });
  }
  if (!rows.length && p.countryCode && !p.state) {
    // Outside Canada, the US and Mexico some territories are filed under
    // another country's code (the query still names the place's country).
    rows = await nominatim<Row>(what, { q: p.query });
  }
  if (!rows.length) return null;
  const place = { lat: Number(rows[0].lat), lon: Number(rows[0].lon), label: rows[0].display_name };
  geoCache.set(key, place);
  return place;
}

/**
 * Name searches also find "Royal Lawn Bowling Club" for landscapers. Keep a
 * place when it carries one of the niche's map tags, or its name passes the
 * niche's name check.
 */
function fitsNiche(el: OsmElement, niche: Niche): boolean {
  const tags = el.tags ?? {};
  if (niche.osmTags.some((t) => {
    const [k, v] = t.split("=");
    return tags[k] === v;
  })) return true;
  const pattern = namePattern(niche);
  return !!pattern && !!tags.name && pattern.re.test(tags.name);
}

/**
 * Businesses of a niche around a point, from Nominatim: its OSM categories
 * first, then words from business names, until there are plenty.
 */
async function nominatimBusinesses(niche: Niche, center: Place, radiusKm: number, limit: number): Promise<OsmElement[]> {
  const key = `${niche.id}|${niche.label}|${center.lat.toFixed(3)},${center.lon.toFixed(3)}|${radiusKm}`;
  const hit = poiCache.get(key);
  if (hit && Date.now() - hit.at < POI_TTL_MS) return hit.elements;

  const viewbox = viewboxAround(center.lat, center.lon, radiusKm);
  const terms = nominatimTerms(niche);
  if (!terms.length) throw new Error("Pick a niche from the list for map search");
  const want = Math.max(limit * 2, 30);
  const found = new Map<string, OsmElement>();
  const started = Date.now();
  let failed = 0;
  let lastError: unknown;
  for (const q of terms) {
    if (Date.now() - started > 25_000) break;
    try {
      const rows = await nominatim<NominatimRow>(`${niche.plural}`, { q, viewbox, bounded: "1", limit: "40", addressdetails: "1", extratags: "1" });
      for (const el of nominatimToElements(rows)) if (fitsNiche(el, niche)) found.set(`${el.type}/${el.id}`, el);
    } catch (err) {
      failed++;
      lastError = err;
    }
    if (found.size >= want) break;
  }
  if (failed && failed === terms.length) throw lastError;
  const elements = [...found.values()];
  poiCache.set(key, { at: Date.now(), elements });
  return elements;
}

export async function searchOsm(params: {
  niche: Niche;
  center: Place;
  radiusKm: number;
  limit: number;
}): Promise<Prospect[]> {
  const { niche, center, radiusKm, limit } = params;
  if (OVERPASS_URL) {
    try {
      const query = buildOverpassQuery(niche, center.lat, center.lon, radiusKm * 1000);
      const { elements } = await queryOverpass(overpassUrls(OVERPASS_URL), query, {
        userAgent: UA,
        describeError: friendlyNetError,
        onAttempt: (a) =>
          (a.ok ? console.info : console.warn)(`[overpass] ${a.host} ${a.ok ? `ok, ${a.elements} elements` : `failed: ${a.problem}`} in ${a.ms}ms`),
      });
      return parseOverpass(elements, niche, center, limit);
    } catch (err) {
      console.warn("[overpass] no answer, using Nominatim:", err instanceof Error ? err.message : err);
    }
  }
  const elements = await nominatimBusinesses(niche, center, radiusKm, limit);
  return parseOverpass(elements, niche, center, limit);
}
