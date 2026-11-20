import { NextResponse } from "next/server";
import { SITE } from "@/lib/site";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";
import { directRoute, fromOsrm, inFlorida, parseLngLat, type OsrmResponse, type RouteResult, type TravelMode } from "@/lib/geo-utils";

export const dynamic = "force-dynamic";

/**
 * Street routing on the stand-in map (real-world Florida roads, © OpenStreetMap).
 * Proxies any OSRM-compatible server so the browser never depends on one host:
 * set ROUTING_URL_DRIVING / _WALKING / _CYCLING to your own OSRM or a paid
 * provider. The defaults are the FOSSGIS public servers, which are meant for
 * light use; cache hits (CDN + memory) keep repeated pin-to-pin routes free.
 * If routing fails, the answer is a clearly flagged straight line.
 */
const ROUTERS: Record<TravelMode, string> = {
  driving: process.env.ROUTING_URL_DRIVING || "https://routing.openstreetmap.de/routed-car",
  walking: process.env.ROUTING_URL_WALKING || "https://routing.openstreetmap.de/routed-foot",
  cycling: process.env.ROUTING_URL_CYCLING || "https://routing.openstreetmap.de/routed-bike",
};

const cache = new Map<string, RouteResult>();
const CACHE_MAX = 500;

function remember(key: string, value: RouteResult) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const from = parseLngLat(url.searchParams.get("from"));
  const to = parseLngLat(url.searchParams.get("to"));
  const modeParam = url.searchParams.get("mode");
  const mode: TravelMode = modeParam === "walking" || modeParam === "cycling" ? modeParam : "driving";
  if (!from || !to) return NextResponse.json({ ok: false, error: "from and to must be lng,lat" }, { status: 400 });
  if (!inFlorida(from) || !inFlorida(to)) {
    return NextResponse.json({ ok: false, error: "Routes are limited to the Leonida map area." }, { status: 400 });
  }
  if (!rateLimit(`route:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many route requests. Try again in a minute." }, { status: 429 });
  }

  const key = `${mode}:${from.join(",")};${to.join(",")}`;
  const hit = cache.get(key);
  const headers = { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" };
  if (hit) return NextResponse.json(hit, { headers });

  let result: RouteResult | null = null;
  try {
    const ctrl = AbortSignal.timeout(8000);
    const res = await fetch(
      `${ROUTERS[mode]}/route/v1/driving/${from.join(",")};${to.join(",")}?overview=full&geometries=geojson&steps=true&alternatives=false`,
      { headers: { "User-Agent": `${SITE.name}/1.0 (+${SITE.url})`, Referer: SITE.url }, signal: ctrl },
    );
    if (res.ok) result = fromOsrm((await res.json()) as OsrmResponse, mode);
    else console.warn(`[route] router answered ${res.status}`);
  } catch (err) {
    console.warn(`[route] router unreachable: ${(err as Error).message}`);
  }

  if (result) {
    remember(key, result);
    return NextResponse.json(result, { headers });
  }
  // Don't let the CDN pin a fallback: the router may be back in a minute.
  return NextResponse.json(directRoute(from, to, mode), { headers: { "Cache-Control": "no-store" } });
}
