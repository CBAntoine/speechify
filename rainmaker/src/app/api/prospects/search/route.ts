import { findBusinesses } from "@/lib/prospecting/search";
import { HttpError, readBody, route } from "@/lib/http";

// Up to 20 sites crawled, plus Claude's web research when it runs.
export const maxDuration = 300;

export const POST = route(async (req: Request) => {
  const b = await readBody<{ niche?: string; location?: string; limit?: number; radiusKm?: number; audit?: number; source?: "auto" | "google" | "osm" | "sample"; lat?: number; lon?: number }>(req);
  if (!b.niche?.trim()) throw new HttpError(400, "Pick a niche");
  const near = typeof b.lat === "number" && typeof b.lon === "number" ? { lat: b.lat, lon: b.lon } : undefined;
  if (!b.location?.trim() && !near) throw new HttpError(400, "Add a city or area");
  try {
    const result = await findBusinesses({
      niche: b.niche,
      location: b.location ?? "",
      near,
      limit: b.limit,
      radiusKm: b.radiusKm,
      audit: b.audit ?? 8,
      source: b.source,
    });
    return Response.json(result);
  } catch (err) {
    throw new HttpError(502, err instanceof Error ? err.message : "Search failed");
  }
});
