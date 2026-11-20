import { findBusinesses, finishOsmSearch, planSearch } from "@/lib/prospecting/search";
import { parseCenter, sanitizeElements } from "@/lib/prospecting/osm-parse";
import { HttpError, readBody, route } from "@/lib/http";

export const maxDuration = 120;

// Three ways in:
// - default: the server runs the whole search (agents, scripts).
// - mode "plan": for map searches, return where to search and the Overpass
//   query, so the phone can ask OpenStreetMap itself. Other sources finish.
// - with `elements`: the phone ran that query; score what it got back.
export const POST = route(async (req: Request) => {
  const b = await readBody<{
    niche?: string;
    location?: string;
    limit?: number;
    radiusKm?: number;
    audit?: number;
    source?: "auto" | "google" | "osm" | "sample";
    lat?: number;
    lon?: number;
    mode?: "plan";
    center?: unknown;
    elements?: unknown;
  }>(req);
  if (!b.niche?.trim()) throw new HttpError(400, "Pick a niche");
  const near = typeof b.lat === "number" && typeof b.lon === "number" ? { lat: b.lat, lon: b.lon } : undefined;
  if (!b.location?.trim() && !near) throw new HttpError(400, "Add a city or area");
  const input = {
    niche: b.niche,
    location: b.location ?? "",
    near,
    limit: b.limit,
    radiusKm: b.radiusKm,
    audit: b.audit ?? 8,
    source: b.source,
  };

  let center: ReturnType<typeof parseCenter>;
  if (b.elements !== undefined) {
    center = parseCenter(b.center);
    if (!center || !Array.isArray(b.elements)) throw new HttpError(400, "Send the search center and the map results");
  }
  try {
    if (b.elements !== undefined) return Response.json(await finishOsmSearch(input, center!, sanitizeElements(b.elements)));
    return Response.json(b.mode === "plan" ? await planSearch(input) : await findBusinesses(input));
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : "Search failed");
  }
});
