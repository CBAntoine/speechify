import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Fetch helper for URLs that come from search results, users or agents.
// Blocks private and link-local addresses (no requests to your own network
// or cloud metadata), follows redirects by hand so every hop is checked,
// enforces a timeout and caps the body size.

export const USER_AGENT = "Mozilla/5.0 (compatible; RainmakerAudit/0.1; +https://github.com/)";

function isPrivateV4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  const [a, b] = p;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isPrivateV4(ip);
  if (fam === 6) return isPrivateV6(ip);
  return true;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https URLs are allowed");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("Only standard web ports are allowed");
  if (u.username || u.password) throw new Error("URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new Error("Private hosts are not allowed");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Private addresses are not allowed");
  } else {
    const addrs = await lookup(host, { all: true, verbatim: true });
    if (!addrs.length) throw new Error("Host did not resolve");
    if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error("Host resolves to a private address");
  }
  return u;
}

export interface SafeResponse {
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  ms: number;
}

export async function safeFetchText(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {}
): Promise<SafeResponse> {
  const timeoutMs = opts.timeoutMs ?? 9000;
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = (await assertPublicUrl(url)).toString();
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.8",
        },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        const next = new URL(res.headers.get("location")!, current).toString();
        await res.body?.cancel();
        current = (await assertPublicUrl(next)).toString();
        continue;
      }
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      let body = "";
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          body += decoder.decode(value, { stream: true });
          if (received >= maxBytes) {
            await reader.cancel();
            break;
          }
        }
        body += decoder.decode();
      }
      return { url, finalUrl: current, status: res.status, headers, body, ms: Date.now() - started };
    }
    throw new Error("Too many redirects");
  } catch (err) {
    throw new Error(friendlyNetError(err, timeoutMs));
  } finally {
    clearTimeout(timer);
  }
}

/** One short phrase for a failed request, suitable for showing a user. */
export function friendlyNetError(err: unknown, timeoutMs = 9000): string {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = e?.code ?? e?.cause?.code ?? "";
  if (e?.name === "AbortError" || e?.name === "TimeoutError" || code === "UND_ERR_CONNECT_TIMEOUT") return `timed out after ${Math.round(timeoutMs / 1000)}s`;
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || /ENOTFOUND|EAI_AGAIN/.test(e?.message ?? "")) return "domain not found";
  if (code === "ECONNREFUSED") return "connection refused";
  if (code === "ECONNRESET" || code === "UND_ERR_SOCKET") return "connection dropped";
  if (/CERT|SSL|TLS/i.test(code) || /certificate/i.test(e?.cause?.message ?? e?.message ?? "")) return "SSL certificate problem";
  const msg = e?.message ?? String(err);
  return msg === "fetch failed" ? `Network error${e?.cause?.message ? `: ${e.cause.message}` : ""}` : msg;
}

/** Normalize "acme.com" or "www.acme.com/page" into a full https URL. */
export function normalizeUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  const withProto = /^https?:\/\//i.test(t) ? t : `https://${t.replace(/^\/\//, "")}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname.includes(".")) return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

export function domainOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
