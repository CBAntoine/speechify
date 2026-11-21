// Pure Overpass helpers (query building and response parsing), unit tested.

import type { Niche } from "../niches.ts";
import type { Prospect } from "../types.ts";

export type OsmElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function buildOverpassQuery(niche: Pick<Niche, "osmTags" | "osmName">, lat: number, lon: number, radiusM: number): string {
  const around = `(around:${Math.round(radiusM)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  const parts: string[] = [];
  for (const tag of niche.osmTags) {
    const [k, v] = tag.split("=");
    parts.push(`nwr["${k}"="${v}"]["name"]${around};`);
  }
  if (niche.osmName) {
    // Name matches only count on things that are businesses, never streets.
    // One statement with a key regex instead of six, so the server scans the
    // area once.
    const re = niche.osmName.replace(/["\\]/g, "");
    parts.push(`nwr["name"~"${re}",i][~"^(shop|office|craft|amenity|healthcare|leisure)$"~"."]${around};`);
  }
  // Plain `out center` (body verbosity): Overpass documents coordinates for
  // nodes there and a center for ways. The `tags` level documents "not
  // coordinates", and the parser skips elements without a location.
  return `[out:json][timeout:25];(${parts.join("")});out center 250;`;
}

export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function address(t: Record<string, string>): string | undefined {
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  // Canadian addresses are often tagged addr:province instead of addr:state.
  const city = [t["addr:city"], t["addr:state"] ?? t["addr:province"], t["addr:postcode"]].filter(Boolean).join(", ");
  const full = [street, city].filter(Boolean).join(", ");
  return full || undefined;
}

/** Overpass elements → prospects, deduped, nearest first. */
export function parseOverpass(elements: OsmElement[], niche: Pick<Niche, "id" | "label">, center: { lat: number; lon: number }, limit: number): Prospect[] {
  const seen = new Set<string>();
  const out: (Prospect & { _d: number })[] = [];
  for (const el of elements) {
    const t = el.tags ?? {};
    const name = t.name?.trim();
    if (!name) continue;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const dedupe = `${name.toLowerCase()}|${lat.toFixed(3)}|${lon.toFixed(3)}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const category = t.healthcare || t.craft || t.office || t.shop || t.amenity || t.leisure || niche.label.toLowerCase();
    const website = t.website || t["contact:website"] || t.url || undefined;
    out.push({
      key: `osm:${el.type}/${el.id}`,
      name,
      niche: niche.id,
      category: category.replace(/_/g, " "),
      address: address(t),
      city: t["addr:city"],
      phone: t.phone || t["contact:phone"] || undefined,
      email: t.email || t["contact:email"] || undefined,
      website: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website,
      mapsUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
      lat,
      lon,
      source: "openstreetmap",
      sourceId: `${el.type}/${el.id}`,
      _d: distanceKm(center.lat, center.lon, lat, lon),
    });
  }
  out.sort((a, b) => a._d - b._d);
  return out.slice(0, limit).map(({ _d, ...p }) => p);
}
