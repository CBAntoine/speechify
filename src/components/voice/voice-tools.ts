/**
 * Client tools the ElevenLabs agent can call. Names and parameters must match
 * the tool definitions on the agent (see scripts/agent/tools.json).
 * Each handler acts on the map and returns compact JSON for the agent to speak from.
 */
import {
  CATEGORIES,
  CONFIDENCE,
  NEWS,
  REGIONS,
  gridRef,
  isPlaced,
  latestNews,
  locationById,
  regionById,
  resolveLocation,
  resolveRegion,
  searchLocations,
  searchTips,
} from "@/lib/data";
import { mapStore } from "@/lib/map-store";
import { formatDistance, haversineM, type TravelMode } from "@/lib/geo-utils";
import { planRoute, resolveSpot, showSpot, type Spot } from "@/lib/spots";
import type { CategoryId, Confidence, MapLocation } from "@/lib/types";

export type ToolLog = (text: string) => void;

const CATEGORY_IDS = Object.keys(CATEGORIES) as CategoryId[];

function asCategory(v: unknown): CategoryId | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.toLowerCase().trim().replace(/s$/, "");
  return CATEGORY_IDS.find(
    (c) => c === s || c.replace("-", " ") === s || CATEGORIES[c].label.toLowerCase() === s || CATEGORIES[c].plural.toLowerCase().startsWith(s),
  );
}

function asConfidence(v: unknown): Confidence | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.toLowerCase().trim();
  return (Object.keys(CONFIDENCE) as Confidence[]).find((c) => c === s);
}

function brief(l: MapLocation) {
  return {
    id: l.id,
    name: l.name,
    category: CATEGORIES[l.category].label,
    region: regionById(l.region)?.name ?? "not yet placed",
    confidence: l.confidence,
    on_map: isPlaced(l),
    grid: gridRef(l.lng, l.lat),
    summary: l.summary,
  };
}

const json = (v: unknown) => JSON.stringify(v);

function problem(p: Exclude<Spot, { ok: true }>) {
  if (p.reason === "unplaced") {
    return { found: true, ...brief(p.loc), on_map: false, message: `${p.loc.name} isn't placed on the map yet, so there's nothing to fly to.` };
  }
  if (p.reason === "unavailable") return { found: false, message: "Street search is offline right now. Try a pin or region name." };
  return { found: false, message: `Couldn't find "${p.query}" on the map.` };
}

const asMode = (v: unknown): TravelMode => (v === "walking" || v === "cycling" ? v : "driving");

export function makeVoiceTools(log: ToolLog) {
  return {
    show_location: (params: { location?: string; id?: string; name?: string }) => {
      const key = params.location || params.id || params.name || "";
      const loc = resolveLocation(String(key));
      if (!loc) {
        const near = searchLocations({ query: String(key) }).slice(0, 3).map((l) => l.name);
        return json({ found: false, message: `No pin matches "${key}".`, suggestions: near });
      }
      mapStore.selectLocation(loc.id);
      log(isPlaced(loc) ? `📍 Showing ${loc.name}` : `📌 Opened ${loc.name} (not on the map yet)`);
      return json({
        found: true,
        ...brief(loc),
        area: loc.area,
        placement: loc.placement,
        steps: loc.steps ?? [],
        requirements: loc.requirements ?? [],
        spoiler: !!loc.spoiler,
        sources: loc.sources.map((s) => s.label),
        note: CONFIDENCE[loc.confidence].help,
      });
    },

    search_map: (params: { query?: string; category?: string; region?: string; confidence?: string; limit?: number }) => {
      const category = asCategory(params.category);
      const region = params.region ? resolveRegion(params.region) : undefined;
      const confidence = asConfidence(params.confidence);
      const results = searchLocations({
        query: params.query,
        categories: category ? [category] : undefined,
        regions: region ? [region.id] : undefined,
        confidence: confidence ?? "all",
      });
      const limit = Math.min(Math.max(Number(params.limit) || 8, 1), 15);
      const top = results.slice(0, limit);
      mapStore.setFilters({ categories: category ? [category] : [], confidence: confidence ?? "all" });
      mapStore.highlight(
        top.filter(isPlaced).map((l) => l.id),
        { fit: !region },
      );
      if (region) mapStore.selectRegion(region.id);
      log(`🔎 Found ${results.length} ${results.length === 1 ? "match" : "matches"}`);
      return json({ total: results.length, results: top.map(brief) });
    },

    focus_region: (params: { region?: string; name?: string }) => {
      const r = resolveRegion(String(params.region || params.name || ""));
      if (!r) return json({ found: false, regions: REGIONS.map((x) => x.name) });
      mapStore.selectRegion(r.id);
      log(`🗺️ Flying to ${r.name}`);
      const pins = searchLocations({ regions: [r.id] });
      return json({
        found: true,
        name: r.name,
        tagline: r.tagline,
        description: r.description.join(" "),
        pins: pins.map((l) => ({ id: l.id, name: l.name, category: CATEGORIES[l.category].label, confidence: l.confidence })),
      });
    },

    get_latest_news: (params: { topic?: string; limit?: number }) => {
      const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 10);
      const items = latestNews(limit, params.topic);
      log("📰 Pulled today's intel");
      return json({
        updated_at: NEWS.updatedAt,
        brief: NEWS.brief ? { headline: NEWS.brief.headline, points: NEWS.brief.bullets.map((b) => b.text) } : null,
        items: items.map((i) => ({ title: i.title, source: i.source, date: i.publishedAt.slice(0, 10), summary: i.summary })),
      });
    },

    get_tips: (params: { topic?: string; query?: string; limit?: number }) => {
      const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 10);
      const tips = searchTips({ topic: params.topic, query: params.query }).slice(0, limit);
      log("💡 Pulled tips");
      return json({
        tips: tips.map((t) => ({ title: t.title, advice: t.body, confidence: t.confidence })),
      });
    },

    go_to_place: async (params: { place?: string; query?: string; name?: string }) => {
      const q = String(params.place || params.query || params.name || "");
      const spot = await resolveSpot(q);
      if (!spot.ok) return json(problem(spot));
      showSpot(spot);
      if (spot.kind === "pin") {
        log(`📍 Showing ${spot.loc.name}`);
        return json({ found: true, type: "pin", ...brief(spot.loc), steps: spot.loc.steps ?? [], note: CONFIDENCE[spot.loc.confidence].help });
      }
      if (spot.kind === "region") {
        log(`🗺️ Flying to ${spot.region.name}`);
        return json({ found: true, type: "region", name: spot.region.name, tagline: spot.region.tagline });
      }
      if (spot.kind === "place") {
        const p = spot.place;
        log(`📍 ${p.name}`);
        return json({
          found: true,
          type: "real_world_place",
          name: p.name,
          where: p.label,
          kind: p.kind,
          leonida_region: regionById(p.region)?.name ?? null,
          nearby_pins: p.nearby.slice(0, 5).map((id) => {
            const l = locationById(id)!;
            return { id, name: l.name, distance: isPlaced(l) ? formatDistance(haversineM([p.lng, p.lat], [l.lng, l.lat])) : null };
          }),
          note: "A real-world spot on the stand-in map; the in-game layout differs.",
        });
      }
      return json({ found: true, type: "current_view", name: spot.end.name });
    },

    plan_route: async (params: { destination?: string; to?: string; origin?: string; from?: string; mode?: string }) => {
      const dest = String(params.destination || params.to || "");
      if (!dest) return json({ ok: false, message: "Which destination?" });
      log("🧭 Planning a route…");
      const res = await planRoute(dest, params.origin || params.from, asMode(params.mode));
      if (!res.ok) {
        if ("needOrigin" in res) return json({ ok: false, message: `Ask where they're starting from; the map is already on ${res.to}.` });
        return json({ ok: false, ...problem(res.problem) });
      }
      log(`🧭 ${res.summary.distance} to ${res.summary.to}`);
      return json({ ok: true, ...res.summary });
    },

    reset_map: () => {
      mapStore.resetFilters();
      mapStore.back();
      mapStore.clearRoute();
      mapStore.home();
      log("↺ Reset the map");
      return json({ ok: true });
    },
  };
}

export type VoiceTools = ReturnType<typeof makeVoiceTools>;
