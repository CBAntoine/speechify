import crypto from "node:crypto";

// Small helpers shared across the server.

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;
}

/** URL-safe random token, e.g. for proposal links. */
export function token(bytes = 9): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export const nowIso = () => new Date().toISOString();

export function addDays(iso: string | Date, days: number): string {
  const d = typeof iso === "string" ? new Date(iso) : new Date(iso.getTime());
  return new Date(d.getTime() + days * 86_400_000).toISOString();
}

export function addMinutes(iso: string | Date, minutes: number): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Date(d.getTime() + minutes * 60_000).toISOString();
}

/** Minutes east of UTC for a time zone at an instant (e.g. -300 for Toronto in winter). */
export function tzOffsetMinutes(tz: string, at = new Date()): number {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(part);
    if (!m) return 0;
    const sign = m[1] === "-" ? -1 : 1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  } catch {
    return 0;
  }
}

/** Calendar parts of an instant in a time zone. */
export function localParts(tz: string, at = new Date()): { y: number; m: number; d: number; hour: number; weekday: number } {
  const off = tzOffsetMinutes(tz, at);
  const local = new Date(at.getTime() + off * 60_000);
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate(), hour: local.getUTCHours(), weekday: local.getUTCDay() };
}

/** The UTC instant of local midnight `daysBack` days ago in a time zone. */
export function localDayStart(tz: string, daysBack = 0, at = new Date()): string {
  const p = localParts(tz, at);
  const midnightLocalAsUtc = Date.UTC(p.y, p.m, p.d - daysBack);
  const off = tzOffsetMinutes(tz, new Date(midnightLocalAsUtc));
  return new Date(midnightLocalAsUtc - off * 60_000).toISOString();
}

export function localMonthStart(tz: string, at = new Date()): string {
  const p = localParts(tz, at);
  const t = Date.UTC(p.y, p.m, 1);
  return new Date(t - tzOffsetMinutes(tz, new Date(t)) * 60_000).toISOString();
}

/** "2026-11-27" in a time zone. */
export function localDate(tz: string, at = new Date()): string {
  const p = localParts(tz, at);
  return `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function money(cents: number | undefined, currency = "USD", opts: { cents?: boolean } = {}): string {
  const v = (cents ?? 0) / 100;
  const s = v.toLocaleString("en-US", { minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 });
  return currency === "CAD" ? `$${s} CAD` : `$${s}`;
}

/** Spoken money for Atlas: "$1,500" or "three thousand four hundred dollars" isn't needed; numbers read fine. */
export function moneyShort(cents: number | undefined): string {
  const v = (cents ?? 0) / 100;
  if (v >= 10_000) return `$${Math.round(v / 1000)}k`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function pct(x: number, digits = 0): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function slugify(s: string, max = 48): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, max)
      .replace(/-+$/g, "") || "site"
  );
}

export function clip(s: string | undefined, n: number): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
}

export function hmac(secret: string, data: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init;
  return fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
}

/** One readable line for logs and voice: the first line of the message, clipped. */
export function errorMessage(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? (err as Error & { cause?: { code?: string } }).cause : undefined;
  msg = msg.split("\n").map((l) => l.trim()).find(Boolean) ?? msg;
  if (cause?.code) msg = `${msg} (${cause.code})`;
  return msg.length > 300 ? `${msg.slice(0, 297)}…` : msg;
}

/** Deep-merge plain objects; arrays and scalars in `patch` replace. */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = isPlain(out[k]) && isPlain(v) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Loose name matching for voice: "bright smile" finds "Bright Smile Family Dentistry". */
export function nameScore(query: string, name: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const q = norm(query);
  const n = norm(name);
  if (!q) return 0;
  if (n === q) return 1;
  if (n.startsWith(q)) return 0.9;
  if (n.includes(q)) return 0.8;
  const qw = q.split(" ").filter((w) => w.length > 1);
  const nw = new Set(n.split(" "));
  if (!qw.length) return 0;
  const hits = qw.filter((w) => nw.has(w) || [...nw].some((x) => x.startsWith(w))).length;
  return (hits / qw.length) * 0.7;
}

export function digits(s: string | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}
