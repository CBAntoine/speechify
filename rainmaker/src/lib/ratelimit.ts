import "server-only";

// Best-effort, in-memory rate limits for the public endpoints (checkout,
// lead capture, voice tokens). Each server instance counts on its own, so
// this slows abuse down rather than stopping it; the hard limits are the
// daily caps stored in the database and the providers' own limits.

const g = globalThis as { __rmRate?: Map<string, number[]> };
const hits: Map<string, number[]> = (g.__rmRate ??= new Map());

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return true;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
