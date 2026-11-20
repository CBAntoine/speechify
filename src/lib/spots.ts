"use client";

/**
 * Turns what a player says ("the egg nest", "Ocean Drive", "Grassrivers",
 * "here") into a spot on the map, and plans routes between spots.
 * Order: exact pin/region id → clear pin-name match → region name →
 * real-world street or landmark (geocoder) → loose pin match.
 */
import { LOCATIONS, REGIONS, isPlaced, locationById, searchLocations } from "./data";
import { directRoute, formatDistance, formatDuration, haversineM, type GeocodeHit, type LngLat, type RouteResult, type TravelMode } from "./geo-utils";
import { mapStore, type MapState, type PlaceFocus, type RouteEnd } from "./map-store";
import type { MapLocation, Region, RegionId } from "./types";

export type Spot =
  | { ok: true; kind: "pin"; loc: MapLocation & { lng: number; lat: number }; end: RouteEnd }
  | { ok: true; kind: "region"; region: Region; end: RouteEnd }
  | { ok: true; kind: "place"; place: PlaceFocus; end: RouteEnd }
  | { ok: true; kind: "here"; end: RouteEnd }
  | { ok: false; reason: "unplaced"; loc: MapLocation }
  | { ok: false; reason: "not_found" | "unavailable"; query: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const STOP = new Set(["the", "a", "an", "at", "on", "in", "of", "and", "to", "near", "by", "spot", "place", "pin", "location", "one", "that"]);
const words = (s: string) => norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
const HERE = /^(here|this( spot| place| pin)?|current( spot| location| view)?|where i am|my (spot|location|position)|the map|map cent(er|re))$/;

function strongPinMatch(q: string): MapLocation | undefined {
  const qw = words(q);
  if (!qw.length) return undefined;
  let best: MapLocation | undefined;
  let bestScore = 0;
  for (const l of LOCATIONS) {
    const hay = norm(`${l.name} ${l.id.replace(/-/g, " ")} ${(l.tags ?? []).join(" ")}`);
    const score = qw.filter((w) => hay.includes(w)).length / qw.length;
    if (score > bestScore) {
      best = l;
      bestScore = score;
    }
  }
  return bestScore >= 0.99 || (bestScore >= 0.66 && qw.length >= 3) ? best : undefined;
}

function strictRegion(q: string): Region | undefined {
  const n = norm(q);
  return REGIONS.find((r) => {
    const name = norm(r.name);
    const short = norm(r.name.replace(/national park/i, ""));
    return r.id === q || n === name || n === short || n === norm(r.id) || n.includes(name);
  });
}

// ---------- Regions (point in polygon) and nearby pins ----------

type Ring = LngLat[];
let regionShapes: Promise<{ id: RegionId; polys: Ring[][] }[]> | null = null;

function loadRegionShapes() {
  regionShapes ??= fetch("/geo/regions.geojson")
    .then((r) => r.json())
    .then((fc: { features: { properties: { id: RegionId }; geometry: { type: string; coordinates: unknown } }[] }) =>
      fc.features.map((f) => ({
        id: f.properties.id,
        polys: (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][],
      })),
    )
    .catch(() => []);
  return regionShapes;
}

function inRing([x, y]: LngLat, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export async function regionAt(p: LngLat): Promise<RegionId | null> {
  for (const r of await loadRegionShapes()) {
    if (r.polys.some(([outer, ...holes]) => inRing(p, outer) && !holes.some((h) => inRing(p, h)))) return r.id;
  }
  return null;
}

export function pinsNear(p: LngLat, km = 12): string[] {
  return LOCATIONS.filter(isPlaced)
    .map((l) => ({ id: l.id, d: haversineM(p, [l.lng, l.lat]) }))
    .filter((x) => x.d <= km * 1000)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.id);
}

// ---------- Focus history (for "route from where I was") ----------

let current: RouteEnd | null = null;
let previous: RouteEnd | null = null;

function focusOf(s: MapState): RouteEnd | null {
  if (s.place) return { name: s.place.name, lng: s.place.lng, lat: s.place.lat };
  const loc = s.selectedId ? locationById(s.selectedId) : undefined;
  return loc && isPlaced(loc) ? { name: loc.name, lng: loc.lng, lat: loc.lat, locationId: loc.id } : null;
}

/** Called by the map whenever the selection changes. */
export function trackFocus(s: MapState) {
  const next = focusOf(s);
  if (!next) return;
  if (current && haversineM([current.lng, current.lat], [next.lng, next.lat]) > 60) previous = current;
  current = next;
}

export const previousFocus = () => previous;

// ---------- Resolution ----------

async function geocode(q: string): Promise<GeocodeHit | null | "unavailable"> {
  try {
    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    const data = (await res.json()) as { ok: boolean; results?: GeocodeHit[] };
    if (!data.ok) return "unavailable";
    return data.results?.[0] ?? null;
  } catch {
    return "unavailable";
  }
}

const pinSpot = (loc: MapLocation & { lng: number; lat: number }): Spot => ({
  ok: true,
  kind: "pin",
  loc,
  end: { name: loc.name, lng: loc.lng, lat: loc.lat, locationId: loc.id },
});

export async function resolveSpot(raw: string): Promise<Spot> {
  const q = raw.trim();
  const v = mapStore.view();
  if (!q || HERE.test(norm(q))) {
    const here = focusOf(mapStore.get()) ?? { name: "the middle of your map", lng: v.center[0], lat: v.center[1] };
    return { ok: true, kind: "here", end: here };
  }

  const byId = locationById(q) ?? strongPinMatch(q);
  if (byId) return isPlaced(byId) ? pinSpot(byId) : { ok: false, reason: "unplaced", loc: byId };

  const region = strictRegion(q);
  if (region) return { ok: true, kind: "region", region, end: { name: region.name, lng: region.label[0], lat: region.label[1] } };

  const hit = await geocode(q);
  if (hit && hit !== "unavailable") {
    const p: LngLat = [hit.lng, hit.lat];
    const place: PlaceFocus = {
      name: hit.name,
      label: hit.label,
      lng: hit.lng,
      lat: hit.lat,
      kind: hit.kind,
      bbox: hit.bbox,
      region: await regionAt(p),
      nearby: pinsNear(p),
    };
    return { ok: true, kind: "place", place, end: { name: hit.name, lng: hit.lng, lat: hit.lat } };
  }

  const loose = searchLocations({ query: q })[0];
  if (loose) return isPlaced(loose) ? pinSpot(loose) : { ok: false, reason: "unplaced", loc: loose };
  return { ok: false, reason: hit === "unavailable" ? "unavailable" : "not_found", query: q };
}

/** Fly to a spot and open its popup. */
export function showSpot(spot: Spot & { ok: true }, opts: { fly?: boolean } = {}) {
  if (spot.kind === "pin") mapStore.selectLocation(spot.loc.id, opts);
  else if (spot.kind === "region") mapStore.selectRegion(spot.region.id, opts);
  else if (spot.kind === "place") mapStore.focusPlace(spot.place, opts);
}

// ---------- Routing ----------

export async function fetchRoute(from: RouteEnd, to: RouteEnd, mode: TravelMode): Promise<RouteResult> {
  try {
    const res = await fetch(`/api/route?from=${from.lng},${from.lat}&to=${to.lng},${to.lat}&mode=${mode}`);
    if (res.ok) return (await res.json()) as RouteResult;
  } catch {
    /* fall through to a straight line */
  }
  return directRoute([from.lng, from.lat], [to.lng, to.lat], mode);
}

export async function drawRoute(from: RouteEnd, to: RouteEnd, mode: TravelMode = "driving") {
  const route = await fetchRoute(from, to, mode);
  mapStore.setRoute({ ...route, from, to });
  return route;
}

export function describeRoute(route: RouteResult, from: RouteEnd, to: RouteEnd) {
  return {
    from: from.name,
    to: to.name,
    distance: formatDistance(route.distanceM),
    time: route.durationS != null ? `${route.approximate ? "about " : ""}${formatDuration(route.durationS)}` : null,
    mode: route.mode,
    via: route.via,
    first_steps: route.steps.slice(0, 4).map((s) => `${s.text}${s.distanceM > 30 ? ` (${formatDistance(s.distanceM)})` : ""}`),
    straight_line_only: route.approximate,
    note: route.approximate
      ? "Live street routing didn't answer, so the map shows a straight line. Say so."
      : "Route follows real-world roads on the stand-in map; the in-game streets differ, so treat it as a guide.",
  };
}

/** Plan a route from origin (or the best guess at where the player is) to destination. */
export async function planRoute(destination: string, origin: string | undefined, mode: TravelMode) {
  const dest = await resolveSpot(destination);
  if (!dest.ok) return { ok: false as const, problem: dest };
  if (dest.kind === "here") return { ok: false as const, problem: { ok: false as const, reason: "not_found" as const, query: destination } };

  let from: RouteEnd | null = null;
  let originNote: string | undefined;
  if (origin?.trim()) {
    const o = await resolveSpot(origin);
    if (!o.ok) return { ok: false as const, problem: o };
    from = o.end;
  } else {
    const candidates = [previousFocus(), focusOf(mapStore.get())].filter((c): c is RouteEnd => !!c);
    from = candidates.find((c) => haversineM([c.lng, c.lat], [dest.end.lng, dest.end.lat]) > 60) ?? null;
    originNote = from ? `No start point given, so the route starts at ${from.name}, the last spot they looked at.` : undefined;
  }
  if (!from || haversineM([from.lng, from.lat], [dest.end.lng, dest.end.lat]) < 60) {
    return { ok: false as const, needOrigin: true as const, to: dest.end.name };
  }

  const route = await drawRoute(from, dest.end, mode);
  return { ok: true as const, route, summary: { ...describeRoute(route, from, dest.end), origin_note: originNote } };
}
