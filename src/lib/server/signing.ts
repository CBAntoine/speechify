import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed, tamper-proof cookie payloads (quota counters, Crew Pass claims).
 * Without SESSION_SECRET we fall back to a random per-process secret: cookies then
 * reset on restart (harmless for quotas), but can never be forged.
 */
let fallback: string | null = null;
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (!fallback) {
    fallback = randomBytes(32).toString("hex");
    console.warn("[neon-atlas] SESSION_SECRET is missing or short; using a temporary secret. Set it in production.");
  }
  return fallback;
}

export function sign(payload: unknown): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export const secureCookie = process.env.NODE_ENV === "production";
