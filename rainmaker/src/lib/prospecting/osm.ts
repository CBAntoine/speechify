import "server-only";
import { friendlyNetError } from "@/lib/net";
import type { Niche } from "@/lib/niches";
import type { Prospect } from "@/lib/types";
import { buildOverpassQuery, parseOverpass } from "./osm-parse";
import { OverpassUnavailableError, overpassUrls, queryOverpass } from "./overpass";

// OpenStreetMap: free, no key. Nominatim turns "Austin, TX" into coordinates,
// Overpass finds tagged businesses around them. Both public servers ask for an
// identifying User-Agent and light use.

const UA = "Rainmaker/0.1 (self-hosted agency CRM)";
const NOMINATIM = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
/** Overpass servers to try, in order (`OVERPASS_URL`, comma-separated). */
export const OVERPASS_URLS = overpassUrls(process.env.OVERPASS_URL);

export interface Place {
  lat: number;
  lon: number;
  label: string;
}

const geoCache = ((globalThis as { __rmGeoCache?: Map<string, Place> }).__rmGeoCache ??= new Map());

export async function geocode(location: string): Promise<Place | null> {
  const key = location.trim().toLowerCase();
  if (geoCache.has(key)) return geoCache.get(key)!;
  const url = `${NOMINATIM}/search?${new URLSearchParams({ q: location, format: "jsonv2", limit: "1" })}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": UA, "accept-language": "en" }, signal: AbortSignal.timeout(12_000) });
  } catch (err) {
    throw new Error(`Couldn't reach OpenStreetMap to look up "${location}" (${friendlyNetError(err, 12_000)}). Check this server's internet connection, or try sample data.`);
  }
  if (!res.ok) throw new Error(`Location lookup failed (HTTP ${res.status})`);
  const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!rows.length) return null;
  const place = { lat: Number(rows[0].lat), lon: Number(rows[0].lon), label: rows[0].display_name };
  geoCache.set(key, place);
  return place;
}

export async function searchOsm(params: {
  niche: Niche;
  center: Place;
  radiusKm: number;
  limit: number;
}): Promise<Prospect[]> {
  const { niche, center, radiusKm, limit } = params;
  const query = buildOverpassQuery(niche, center.lat, center.lon, radiusKm * 1000);
  try {
    const { elements } = await queryOverpass(OVERPASS_URLS, query, {
      userAgent: UA,
      describeError: friendlyNetError,
      // One line per server tried, so the host's logs show which one answered.
      onAttempt: (a) =>
        (a.ok ? console.info : console.warn)(
          `[overpass] ${a.host} ${a.ok ? `ok, ${a.elements} elements` : `failed: ${a.problem}`} in ${a.ms}ms`,
        ),
    });
    return parseOverpass(elements, niche, center, limit);
  } catch (err) {
    if (err instanceof OverpassUnavailableError) {
      throw new Error(
        `OpenStreetMap's free search servers are overloaded right now (tried ${err.attempts.length}). Try again in a few minutes, or search sample data. A Google Places key (GOOGLE_PLACES_API_KEY) makes search faster and steadier.`,
      );
    }
    throw err;
  }
}
