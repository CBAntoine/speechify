import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC-signed, tamper-proof cookie payloads (quota counters, Crew Pass claims).
 * Secret, in order: SESSION_SECRET; else one derived from ELEVENLABS_API_KEY, which
 * every server instance shares (rotating that key then resets cookies, and Crew Pass
 * members restore by email); else a random per-process secret for local dev.
 */
let fallback: string | null = null;
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (!fallback) {
    const key = process.env.ELEVENLABS_API_KEY;
    if (key && key.length >= 16) {
      fallback = createHmac("sha256", key).update("neon-atlas/session-secret/v1").digest("hex");
      console.warn("[neon-atlas] SESSION_SECRET is not set; deriving it from ELEVENLABS_API_KEY. Set SESSION_SECRET to keep cookies valid across key rotations.");
    } else {
      fallback = randomBytes(32).toString("hex");
      console.warn("[neon-atlas] SESSION_SECRET is missing or short; using a temporary secret. Set it in production.");
    }
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
