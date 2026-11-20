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
  const city = [t["addr:city"], t["addr:state"], t["addr:postcode"]].filter(Boolean).join(", ");
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

/**
 * Elements the browser fetched from Overpass come back to the server as
 * untrusted JSON. Keep only well-formed businesses: known types, numeric ids
 * and coordinates, string tags, with sizes capped.
 */
export function sanitizeElements(raw: unknown, max = 800): OsmElement[] {
  if (!Array.isArray(raw)) return [];
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const out: OsmElement[] = [];
  for (const el of raw.slice(0, max)) {
    if (!el || typeof el !== "object") continue;
    const e = el as Record<string, unknown>;
    if (e.type !== "node" && e.type !== "way" && e.type !== "relation") continue;
    const id = num(e.id);
    if (id === undefined) continue;
    const c = e.center && typeof e.center === "object" ? (e.center as Record<string, unknown>) : undefined;
    const center = c && num(c.lat) !== undefined && num(c.lon) !== undefined ? { lat: c.lat as number, lon: c.lon as number } : undefined;
    const tags: Record<string, string> = {};
    if (e.tags && typeof e.tags === "object") {
      for (const [k, v] of Object.entries(e.tags as Record<string, unknown>).slice(0, 120)) {
        if (typeof v === "string" && k.length <= 80) tags[k] = v.slice(0, 600);
      }
    }
    out.push({ type: e.type, id, lat: num(e.lat), lon: num(e.lon), center, tags });
  }
  return out;
}

/** A search center sent back by the browser. */
export function parseCenter(raw: unknown): { lat: number; lon: number; label: string } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const lat = typeof r.lat === "number" ? r.lat : NaN;
  const lon = typeof r.lon === "number" ? r.lon : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon, label: typeof r.label === "string" ? r.label.slice(0, 200) : "" };
}
