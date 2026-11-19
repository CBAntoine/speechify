import regionsJson from "@data/regions.json";
import locationsJson from "@data/locations.json";
import tipsJson from "@data/tips.json";
import newsJson from "@data/news.json";
import gearJson from "@data/gear.json";
import geoMetaJson from "@data/geo-meta.json";
import type {
  CategoryId,
  Confidence,
  GearItem,
  MapLocation,
  NewsFile,
  NewsItem,
  Region,
  RegionId,
  Tip,
  TipTopic,
} from "./types";

export const REGIONS = regionsJson as Region[];
export const LOCATIONS = locationsJson as MapLocation[];
export const TIPS = tipsJson as Tip[];
export const NEWS = newsJson as NewsFile;
export const GEAR = gearJson as GearItem[];

export const GEO = geoMetaJson as unknown as {
  bbox: [number, number, number, number];
  imageBounds: { west: number; east: number; north: number; south: number };
  preview: { width: number; height: number };
  grid: { west: number; east: number; north: number; south: number; cols: number; rows: number };
  regionBounds: Record<string, [number, number, number, number]>;
  home: { west: number; south: number; east: number; north: number };
  attribution: string[];
};

export const CATEGORIES: Record<CategoryId, { label: string; plural: string; color: string }> = {
  "easter-egg": { label: "Easter egg", plural: "Easter eggs", color: "#b18cff" },
  secret: { label: "Secret", plural: "Secrets & encounters", color: "#ff4f9a" },
  collectible: { label: "Loot", plural: "Collectibles & loot", color: "#ffd166" },
  wildlife: { label: "Wildlife", plural: "Wildlife", color: "#6dfc9b" },
  story: { label: "Story", plural: "Story & safehouses", color: "#e9ecff" },
  service: { label: "Service", plural: "Shops & services", color: "#4db2ff" },
  tip: { label: "Tip", plural: "Tips on the map", color: "#25e2d0" },
};

export const CONFIDENCE: Record<Confidence, { label: string; short: string; color: string; help: string }> = {
  confirmed: {
    label: "Confirmed",
    short: "Confirmed",
    color: "#5cffb0",
    help: "Verified in-game by a reputable outlet or official source.",
  },
  reported: {
    label: "Reported",
    short: "Reported",
    color: "#ffc24d",
    help: "Reported by players or guides; not yet independently verified.",
  },
  theory: {
    label: "Theory",
    short: "Theory",
    color: "#9aa8d6",
    help: "Our informed inference from series history and geography. Where to look, not a find.",
  },
};

export const TIP_TOPICS: Record<TipTopic, string> = {
  money: "Money",
  police: "Heat & police",
  combat: "Combat & Focus",
  exploration: "Exploration",
  vehicles: "Vehicles",
  settings: "Setup",
  story: "Story & saves",
};

export const regionById = (id: string | null | undefined): Region | undefined =>
  REGIONS.find((r) => r.id === id);

export const locationById = (id: string | null | undefined): MapLocation | undefined =>
  LOCATIONS.find((l) => l.id === id);

export const isPlaced = (l: MapLocation): l is MapLocation & { lng: number; lat: number } =>
  l.placement !== "unplaced" && typeof l.lng === "number" && typeof l.lat === "number";

/** Chart-style grid reference over the state, e.g. "H8" (columns A–J west→east, rows 1–10 north→south). */
export function gridRef(lng?: number, lat?: number): string | null {
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  const g = GEO.grid;
  const c = Math.floor(((lng - g.west) / (g.east - g.west)) * g.cols);
  const r = Math.floor(((g.north - lat) / (g.north - g.south)) * g.rows);
  const col = String.fromCharCode(65 + Math.min(g.cols - 1, Math.max(0, c)));
  return `${col}${Math.min(g.rows, Math.max(1, r + 1))}`;
}

/** [west, south, east, north] for a region, from the build-time geodata. */
export function regionBounds(r: Region): [number, number, number, number] {
  return GEO.regionBounds[r.id] ?? [GEO.home.west, GEO.home.south, GEO.home.east, GEO.home.north];
}

/** Web Mercator helpers shared by the static previews. */
export const mercX = (lng: number) => (lng + 180) / 360;
export const mercY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
};

/** Position of a coordinate inside the preview image, as fractions 0–1. */
export function previewFraction(lng: number, lat: number): { fx: number; fy: number } {
  const b = GEO.imageBounds;
  return {
    fx: (mercX(lng) - mercX(b.west)) / (mercX(b.east) - mercX(b.west)),
    fy: (mercY(lat) - mercY(b.north)) / (mercY(b.south) - mercY(b.north)),
  };
}

/** Approximate geodesic circle as a GeoJSON ring (for search zones). */
export function circleRing(lng: number, lat: number, km: number, steps = 72): [number, number][] {
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return ring;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function score(haystack: string, query: string): number {
  const h = norm(haystack);
  const q = norm(query);
  if (!q) return 1;
  if (h.includes(q)) return 10 + q.length / Math.max(1, h.length);
  const words = q.split(" ").filter((w) => w.length > 1);
  let s = 0;
  for (const w of words) if (h.includes(w)) s += 1;
  return words.length ? s / words.length : 0;
}

export interface LocationQuery {
  query?: string;
  categories?: CategoryId[];
  regions?: RegionId[];
  confidence?: Confidence | "all";
  includeUnplaced?: boolean;
}

export function searchLocations(q: LocationQuery): MapLocation[] {
  const results = LOCATIONS.filter((l) => {
    if (q.categories?.length && !q.categories.includes(l.category)) return false;
    if (q.regions?.length && (!l.region || !q.regions.includes(l.region))) return false;
    if (q.confidence && q.confidence !== "all" && l.confidence !== q.confidence) return false;
    if (q.includeUnplaced === false && !isPlaced(l)) return false;
    return true;
  });
  if (!q.query?.trim()) return results;
  return results
    .map((l) => ({
      l,
      s:
        score(l.name, q.query!) * 3 +
        score(`${l.summary} ${l.area ?? ""} ${(l.tags ?? []).join(" ")}`, q.query!) +
        score(regionById(l.region)?.name ?? "", q.query!),
    }))
    .filter((r) => r.s > 0.34)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.l);
}

/** Resolve a location from an id or a spoken name ("the egg tower"). */
export function resolveLocation(idOrName: string): MapLocation | undefined {
  const direct = locationById(idOrName);
  if (direct) return direct;
  return searchLocations({ query: idOrName.replace(/[-_]/g, " ") })[0];
}

export function resolveRegion(idOrName: string): Region | undefined {
  const q = norm(idOrName.replace(/[-_]/g, " "));
  return (
    REGIONS.find((r) => r.id === idOrName) ||
    REGIONS.find((r) => norm(r.name) === q) ||
    REGIONS.find((r) => norm(r.name).includes(q) || q.includes(norm(r.name).split(" ")[0]))
  );
}

export function searchTips(opts: { topic?: string; query?: string }): Tip[] {
  let list = TIPS;
  if (opts.topic) {
    const t = norm(opts.topic);
    const topicKey = (Object.keys(TIP_TOPICS) as TipTopic[]).find(
      (k) => k === t || norm(TIP_TOPICS[k]).includes(t),
    );
    if (topicKey) list = list.filter((tip) => tip.topic === topicKey);
  }
  if (opts.query?.trim()) {
    list = list
      .map((tip) => ({ tip, s: score(`${tip.title} ${tip.body}`, opts.query!) }))
      .filter((r) => r.s > 0.3)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.tip);
  }
  const rank: Record<Confidence, number> = { confirmed: 0, reported: 1, theory: 2 };
  return [...list].sort((a, b) => rank[a.confidence] - rank[b.confidence]);
}

export function latestNews(limit = 8, topic?: string): NewsItem[] {
  let items = [...NEWS.items].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  if (topic) {
    const t = norm(topic);
    const filtered = items.filter(
      (i) => i.tags.some((tag) => norm(tag).includes(t)) || norm(`${i.title} ${i.summary ?? ""}`).includes(t),
    );
    if (filtered.length) items = filtered;
  }
  return items.slice(0, limit);
}

export const STATS = (() => {
  const placed = LOCATIONS.filter(isPlaced).length;
  return {
    total: LOCATIONS.length,
    placed,
    unplaced: LOCATIONS.length - placed,
    confirmed: LOCATIONS.filter((l) => l.confidence === "confirmed").length,
    reported: LOCATIONS.filter((l) => l.confidence === "reported").length,
    theory: LOCATIONS.filter((l) => l.confidence === "theory").length,
    tips: TIPS.length,
  };
})();
