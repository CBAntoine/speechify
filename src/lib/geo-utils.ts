/**
 * Pure geo helpers shared by the browser and the API routes. Keep this file
 * free of imports and non-erasable TypeScript so Node's test runner can load it.
 */

export type LngLat = [number, number];

export interface RouteStep {
  text: string;
  distanceM: number;
  location: LngLat;
}

export interface RouteResult {
  ok: true;
  provider: "osrm" | "direct";
  /** True when no road router answered and the line is drawn as the crow flies. */
  approximate: boolean;
  mode: TravelMode;
  distanceM: number;
  durationS: number | null;
  coords: LngLat[];
  steps: RouteStep[];
  via: string[];
}

export type TravelMode = "driving" | "walking" | "cycling";

export interface GeocodeHit {
  name: string;
  label: string;
  lng: number;
  lat: number;
  kind: string;
  bbox: [number, number, number, number] | null;
}

/** Leonida's stand-in (Florida) with a little sea around it. */
export const FLORIDA_BBOX = { west: -88.2, south: 24.2, east: -79.6, north: 31.2 } as const;

export function inFlorida([lng, lat]: LngLat): boolean {
  return lng >= FLORIDA_BBOX.west && lng <= FLORIDA_BBOX.east && lat >= FLORIDA_BBOX.south && lat <= FLORIDA_BBOX.north;
}

export function haversineM(a: LngLat, b: LngLat): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bboxOf(coords: LngLat[]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

/** Parse "lng,lat" with range checks. */
export function parseLngLat(v: string | null): LngLat | null {
  if (!v) return null;
  const [a, b] = v.split(",").map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 180 || Math.abs(b) > 90) return null;
  return [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5];
}

export function formatDistance(m: number): string {
  const miles = m / 1609.344;
  if (miles < 0.1) return `${Math.max(10, Math.round((m * 3.28084) / 10) * 10)} ft`;
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export function formatDuration(s: number | null): string {
  if (s == null) return "";
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

const SPEED_MPS: Record<TravelMode, number> = { driving: 15, walking: 1.35, cycling: 4.5 };

/** Straight-line fallback, densified so it can curve with the globe and animate smoothly. */
export function directRoute(from: LngLat, to: LngLat, mode: TravelMode): RouteResult {
  const d = haversineM(from, to);
  const n = Math.min(64, Math.max(2, Math.round(d / 2000)));
  const coords: LngLat[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    coords.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  // Roads are rarely straight: estimate time on ~1.3x the crow-flies distance.
  return {
    ok: true,
    provider: "direct",
    approximate: true,
    mode,
    distanceM: Math.round(d),
    durationS: Math.round((d * 1.3) / SPEED_MPS[mode]),
    coords,
    steps: [],
    via: [],
  };
}

interface OsrmManeuver {
  type: string;
  modifier?: string;
  location: LngLat;
  exit?: number;
}
interface OsrmStep {
  name?: string;
  ref?: string;
  destinations?: string;
  distance: number;
  duration: number;
  maneuver: OsrmManeuver;
  mode?: string;
}
export interface OsrmResponse {
  code: string;
  routes?: { distance: number; duration: number; geometry: { coordinates: LngLat[] }; legs: { steps?: OsrmStep[] }[] }[];
}

function roadName(step: OsrmStep): string {
  const ref = step.ref?.split(";")[0]?.trim();
  const name = step.name?.trim();
  if (name && ref && !name.includes(ref)) return `${name} (${ref})`;
  return name || ref || "";
}

/** Human instruction for one OSRM step (English, compact enough to speak). */
export function instruction(step: OsrmStep): string {
  const m = step.maneuver;
  const road = roadName(step);
  const onto = road ? ` onto ${road}` : "";
  const dir = m.modifier ?? "";
  switch (m.type) {
    case "depart":
      return road ? `Head out on ${road}` : "Head out";
    case "arrive":
      return "Arrive at your destination";
    case "turn":
    case "end of road":
      return dir === "uturn" ? `Make a U-turn${onto}` : `Turn ${dir || "ahead"}${onto}`;
    case "continue":
    case "new name":
      return dir === "uturn" ? `Make a U-turn${onto}` : road ? `Continue on ${road}` : "Continue straight";
    case "merge":
      return `Merge${dir ? ` ${dir}` : ""}${onto}`;
    case "on ramp":
      return `Take the ramp${onto}`;
    case "off ramp":
      return `Take the exit${step.destinations ? ` toward ${step.destinations.split(":").pop()?.trim()}` : onto}`;
    case "fork":
      return `Keep ${dir.replace("slight ", "") || "ahead"} at the fork${onto}`;
    case "roundabout":
    case "rotary":
      return `At the roundabout, take exit ${m.exit ?? 1}${onto}`;
    case "exit roundabout":
    case "exit rotary":
      return `Exit the roundabout${onto}`;
    default:
      return road ? `Continue on ${road}` : "Continue";
  }
}

const MAX_COORDS = 1500;

/** Convert an OSRM /route response into our compact shape. */
export function fromOsrm(res: OsrmResponse, mode: TravelMode): RouteResult | null {
  const r = res.code === "Ok" ? res.routes?.[0] : undefined;
  if (!r || r.geometry.coordinates.length < 2) return null;
  let coords = r.geometry.coordinates.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5] as LngLat);
  if (coords.length > MAX_COORDS) {
    const step = coords.length / MAX_COORDS;
    const thin: LngLat[] = [];
    for (let i = 0; i < MAX_COORDS; i++) thin.push(coords[Math.floor(i * step)]);
    thin.push(coords[coords.length - 1]);
    coords = thin;
  }
  const raw = r.legs.flatMap((l) => l.steps ?? []);
  const steps: RouteStep[] = raw
    .filter((s) => !(s.maneuver.type === "new name" && s.distance < 1))
    .map((s) => ({ text: instruction(s), distanceM: Math.round(s.distance), location: s.maneuver.location }));
  // The roads you spend the longest on, for "via I-95 and US-1".
  const byRoad = new Map<string, number>();
  for (const s of raw) {
    const road = roadName(s);
    if (road) byRoad.set(road, (byRoad.get(road) ?? 0) + s.distance);
  }
  const via = [...byRoad.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([, d]) => d > r.distance * 0.08)
    .map(([name]) => name);
  return {
    ok: true,
    provider: "osrm",
    approximate: false,
    mode,
    distanceM: Math.round(r.distance),
    durationS: Math.round(r.duration),
    coords,
    steps,
    via,
  };
}
