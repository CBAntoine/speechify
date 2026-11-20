import "server-only";
import { friendlyNetError } from "@/lib/net";
import type { Niche } from "@/lib/niches";
import type { Prospect } from "@/lib/types";
import { buildOverpassQuery, parseOverpass, type OsmElement } from "./osm-parse";

// OpenStreetMap: free, no key. Nominatim turns "Austin, TX" into coordinates,
// Overpass finds tagged businesses around them. Both public servers ask for an
// identifying User-Agent and light use.

const UA = "Rainmaker/0.1 (self-hosted agency CRM)";
const NOMINATIM = (process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const OVERPASS = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";

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
  const body = new URLSearchParams({ data: buildOverpassQuery(niche, center.lat, center.lon, radiusKm * 1000) });
  let res: Response;
  try {
    res = await fetch(OVERPASS, {
      method: "POST",
      headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(35_000),
    });
  } catch (err) {
    throw new Error(`Couldn't reach OpenStreetMap (${friendlyNetError(err, 35_000)}). Check this server's internet connection, or try sample data.`);
  }
  if (!res.ok) throw new Error(`OpenStreetMap search failed (HTTP ${res.status}). The public server may be busy; try again in a minute.`);
  const data = (await res.json()) as { elements?: OsmElement[] };
  return parseOverpass(data.elements ?? [], niche, center, limit);
}
