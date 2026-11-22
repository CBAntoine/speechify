// Password sign-in with a signed cookie. Uses Web Crypto only, so it runs in
// the proxy as well as in route handlers. The cookie holds an expiry and an
// HMAC of it keyed by APP_PASSWORD: changing the password signs everyone out.

export const SESSION_COOKIE = "rm_session";
export const SESSION_DAYS = 180;

const enc = new TextEncoder();

function base64url(buf: ArrayBuffer): string {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeSession(password: string, days = SESSION_DAYS): Promise<{ value: string; maxAge: number }> {
  const exp = Date.now() + days * 86_400_000;
  return { value: `${exp}.${await sign(password, `rm1.${exp}`)}`, maxAge: days * 86_400 };
}

export async function verifySession(value: string | undefined, password: string): Promise<boolean> {
  if (!value) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const exp = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  return safeEqual(sig, await sign(password, `rm1.${exp}`));
}

/**
 * Paths anyone may load: the sign-in page, what installing the app needs,
 * the public storefront and prospect demo pages, and the endpoints those
 * call. Each public API protects itself (rate limits, webhook signatures,
 * CRON_SECRET); everything else needs the sign-in.
 */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/api/login" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/offline.html" ||
    pathname === "/icon.svg" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname.startsWith("/icons/") ||
    pathname === "/store" ||
    pathname.startsWith("/store/") ||
    pathname.startsWith("/demo/") ||
    pathname.startsWith("/api/store/") ||
    pathname === "/api/payments/stripe/webhook" ||
    pathname === "/api/payments/paypal/webhook" ||
    pathname.startsWith("/api/cron/")
  );
}
