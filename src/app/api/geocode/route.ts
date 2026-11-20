import { NextResponse } from "next/server";
import { SITE } from "@/lib/site";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { FLORIDA_BBOX, fromNominatim, type GeocodeHit, type NominatimHit } from "@/lib/geo-utils";

export const dynamic = "force-dynamic";

/**
 * Finds real-world streets, neighbourhoods and landmarks on the stand-in map.
 * Speaks the Nominatim search API (OpenStreetMap). Set GEOCODER_URL to your
 * own Nominatim or a compatible paid host (e.g. LocationIQ) for heavy traffic;
 * the public default allows about one request per second, so requests are
 * spaced out and every answer is cached.
 */
const GEOCODER = (process.env.GEOCODER_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const GEOCODER_KEY = process.env.GEOCODER_KEY; // LocationIQ-style ?key=

const cache = new Map<string, GeocodeHit[]>();
let nextSlot = 0;

async function politeFetch(url: string) {
  // One request per second per server instance, as the public policy asks.
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 1100;
  if (wait > 4000) throw new Error("geocoder busy");
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return fetch(url, {
    headers: { "User-Agent": `${SITE.name}/1.0 (+${SITE.url})`, Referer: SITE.url, "Accept-Language": "en" },
    signal: AbortSignal.timeout(7000),
  });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 120) ?? "";
  if (q.length < 2) return NextResponse.json({ ok: false, error: "q is required" }, { status: 400 });
  if (!rateLimit(`geocode:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many searches. Try again in a minute." }, { status: 429 });
  }
  const key = q.toLowerCase();
  const headers = { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=2592000" };
  const hit = cache.get(key);
  if (hit) return NextResponse.json({ ok: true, results: hit }, { headers });

  const b = FLORIDA_BBOX;
  const params = new URLSearchParams({
    q,
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
    countrycodes: "us",
    viewbox: `${b.west},${b.north},${b.east},${b.south}`,
    bounded: "1",
  });
  if (GEOCODER_KEY) params.set("key", GEOCODER_KEY);
  try {
    const res = await politeFetch(`${GEOCODER}/search?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as NominatimHit[];
    const results: GeocodeHit[] = fromNominatim(raw);
    if (cache.size > 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, results);
    return NextResponse.json({ ok: true, results }, { headers });
  } catch (err) {
    console.warn(`[geocode] ${(err as Error).message}`);
    return NextResponse.json({ ok: false, error: "Place search is unavailable right now.", results: [] }, { status: 503 });
  }
}
