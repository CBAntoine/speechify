import crypto from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { APP_PASSWORD } from "../config.ts";
import { kvGet, kvSet } from "../db.ts";
import { hmac, safeEqual } from "../util.ts";

// One password for the owner (APP_PASSWORD). Sessions are signed cookies.
// Without a password the app only listens on localhost by default.

const COOKIE = "ms_session";

export function secret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) return fromEnv;
  let s = kvGet<string>("session_secret");
  if (!s) {
    s = crypto.randomBytes(32).toString("base64url");
    kvSet("session_secret", s);
  }
  return s;
}

export function signToken(purpose: string, ttlSec: number): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = `${purpose}.${exp}`;
  return `${body}.${hmac(secret(), body)}`;
}

export function verifyToken(token: string | undefined, purpose: string): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== purpose) return false;
  if (Number(parts[1]) < Date.now() / 1000) return false;
  return safeEqual(parts[2], hmac(secret(), `${parts[0]}.${parts[1]}`));
}

export function isAuthed(c: Context): boolean {
  if (!APP_PASSWORD) return true;
  return verifyToken(getCookie(c, COOKIE), "owner");
}

export function login(c: Context, password: string): boolean {
  if (!APP_PASSWORD) return true;
  const ok = safeEqual(crypto.createHash("sha256").update(password).digest("hex"), crypto.createHash("sha256").update(APP_PASSWORD).digest("hex"));
  if (ok) {
    const secure = c.req.url.startsWith("https://") || c.req.header("x-forwarded-proto") === "https";
    setCookie(c, COOKIE, signToken("owner", 180 * 86_400), { httpOnly: true, sameSite: "Lax", secure, path: "/", maxAge: 180 * 86_400 });
  }
  return ok;
}

export function logout(c: Context): void {
  deleteCookie(c, COOKIE, { path: "/" });
}

export const requireOwner: MiddlewareHandler = async (c, next) => {
  if (!isAuthed(c)) return c.json({ error: "Sign in first." }, 401);
  await next();
};
