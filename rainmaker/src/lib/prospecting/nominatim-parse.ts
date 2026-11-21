// Business search through Nominatim, OpenStreetMap's search server. It
// answers reliably from cloud hosts, where the Overpass servers turn requests
// away. Each query returns at most 40 places, so a search asks for the
// niche's OSM categories ("[amenity=dentist]") and then words from business
// names ("plumbing"), inside a box around the city. Pure helpers, unit tested.

import type { Niche } from "../niches.ts";
import type { OsmElement } from "./osm-parse.ts";

/** What to ask Nominatim, in order: up to two categories, then name words. */
export function nominatimTerms(niche: Pick<Niche, "osmTags" | "nameWords">, max = 5): string[] {
  const categories = niche.osmTags.filter((t) => /^[a-z_]+=[a-z_]+$/.test(t)).slice(0, 2).map((t) => `[${t}]`);
  const words = (niche.nameWords ?? []).map((w) => w.trim()).filter(Boolean).slice(0, 3);
  return [...new Set([...categories, ...words])].slice(0, max);
}

/** Nominatim's viewbox (left,top,right,bottom) for a square around a point. */
export function viewboxAround(lat: number, lon: number, radiusKm: number): string {
  const dLat = radiusKm / 111.32;
  const dLon = radiusKm / (111.32 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return [lon - dLon, lat + dLat, lon + dLon, lat - dLat].map((n) => n.toFixed(5)).join(",");
}

export interface NominatimRow {
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
  extratags?: Record<string, unknown> | null;
}

// Name searches also find roads, campuses and houses ("Dental Circle",
// "Dental Sciences Building"). Keep businesses only.
const NOT_BUSINESS_CATEGORY = new Set([
  "highway", "place", "boundary", "landuse", "natural", "railway", "waterway", "route", "public_transport",
  "aeroway", "historic", "man_made", "power", "bridge", "tunnel", "junction", "barrier", "emergency", "military",
]);
const NOT_BUSINESS_TYPE = new Set([
  "parking", "parking_entrance", "parking_space", "bench", "toilets", "school", "university", "college", "kindergarten",
  "library", "place_of_worship", "bus_station", "townhall", "courthouse", "police", "fire_station", "grave_yard",
  "vacant", "house", "residential", "apartments", "detached", "semidetached_house", "terrace", "garage", "garages",
  "shed", "church", "hospital", "dormitory",
]);
const INSTITUTION = /\b(hospital|universit\w*|school|college|campus|church|plant|library|residence|parking|faculty)\b/i;

/** Nominatim results → the same shape Overpass returns, for parseOverpass. */
export function nominatimToElements(rows: NominatimRow[]): OsmElement[] {
  const out: OsmElement[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const name = r.name?.trim();
    if (!name || !r.category || !r.type) continue;
    if (NOT_BUSINESS_CATEGORY.has(r.category) || NOT_BUSINESS_TYPE.has(r.type)) continue;
    if (r.category === "building" && INSTITUTION.test(name)) continue;
    const type = r.osm_type === "node" || r.osm_type === "way" || r.osm_type === "relation" ? r.osm_type : undefined;
    const id = Number(r.osm_id);
    const lat = Number(r.lat);
    const lon = Number(r.lon);
    if (!type || !Number.isFinite(id) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const key = `${type}/${id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.extratags ?? {})) if (typeof v === "string") tags[k] = v;
    tags.name = name;
    tags[r.category] = r.type;
    const a = r.address ?? {};
    const put = (k: string, v: string | undefined) => {
      if (v && !tags[k]) tags[k] = v;
    };
    put("addr:housenumber", a.house_number);
    put("addr:street", a.road);
    put("addr:city", a.city ?? a.town ?? a.village ?? a.municipality ?? a.suburb);
    put("addr:state", a.state);
    put("addr:postcode", a.postcode);
    out.push({ type, id, lat, lon, tags });
  }
  return out;
}
