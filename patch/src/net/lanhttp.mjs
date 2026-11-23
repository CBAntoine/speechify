// HTTP client for devices on the home network.
// Uses node:http/https directly (not fetch) so it can talk to devices with self-signed
// certificates, read binary bodies (IPP), and answer HTTP Digest challenges (Shelly Gen2+).
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";

const MAX_BODY = 6 * 1024 * 1024;
const agentHttp = new http.Agent({ keepAlive: false });
const agentHttps = new https.Agent({ keepAlive: false, rejectUnauthorized: false });

export class LanHttpError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function once(opts) {
  const u = new URL(opts.url);
  const isHttps = u.protocol === "https:";
  const body = opts.body == null ? null : Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body));
  const headers = { "user-agent": "Patch/1.0 (home network assistant)", accept: "*/*", ...opts.headers };
  if (body) headers["content-length"] = String(body.length);
  if (opts.body != null && typeof opts.body === "object" && !Buffer.isBuffer(opts.body) && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(
      {
        method: opts.method || (body ? "POST" : "GET"),
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        headers,
        agent: isHttps ? agentHttps : agentHttp,
        timeout: opts.timeout ?? 3000,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (c) => {
          size += c.length;
          if (size > MAX_BODY) {
            req.destroy(new LanHttpError("Response too large", { code: "ETOOBIG" }));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: buf,
            text: () => buf.toString("utf8"),
            json: () => JSON.parse(buf.toString("utf8")),
          });
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new LanHttpError(`Timed out talking to ${u.host}`, { code: "ETIMEDOUT" })));
    req.on("error", (err) => reject(err instanceof LanHttpError ? err : new LanHttpError(err.message, { code: err.code })));
    if (body) req.write(body);
    req.end();
  });
}

function parseChallenge(header) {
  const h = Array.isArray(header) ? header.find((x) => /^digest/i.test(x)) : header;
  if (!h || !/^digest/i.test(h)) return null;
  const out = {};
  for (const m of h.slice(6).matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3];
  return out;
}

function digestHeader(ch, { method, url, username, password }) {
  const algo = (ch.algorithm || "MD5").toUpperCase();
  const hashName = algo.startsWith("SHA-256") ? "sha256" : "md5";
  const H = (s) => crypto.createHash(hashName).update(s).digest("hex");
  const u = new URL(url);
  const uri = u.pathname + u.search;
  const cnonce = crypto.randomBytes(8).toString("hex");
  const nc = "00000001";
  const qop = ch.qop ? ch.qop.split(",").map((s) => s.trim()).find((q) => q === "auth") || ch.qop.split(",")[0].trim() : null;
  const ha1 = H(`${username}:${ch.realm}:${password}`);
  const ha2 = H(`${method}:${uri}`);
  const response = qop ? H(`${ha1}:${ch.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${ch.nonce}:${ha2}`);
  const parts = [
    `username="${username}"`,
    `realm="${ch.realm}"`,
    `nonce="${ch.nonce}"`,
    `uri="${uri}"`,
    `algorithm=${ch.algorithm || "MD5"}`,
    `response="${response}"`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (ch.opaque) parts.push(`opaque="${ch.opaque}"`);
  return "Digest " + parts.join(", ");
}

/**
 * request({ url, method, headers, body, timeout, auth: { username, password } })
 * Basic auth is sent up front when `auth.basic` is true; otherwise credentials are only used to
 * answer a Digest challenge.
 */
export async function request(opts) {
  const o = typeof opts === "string" ? { url: opts } : { ...opts };
  const method = o.method || (o.body != null ? "POST" : "GET");
  if (o.auth?.basic) {
    o.headers = { ...o.headers, authorization: "Basic " + Buffer.from(`${o.auth.username}:${o.auth.password}`).toString("base64") };
  }
  const res = await once({ ...o, method });
  if (res.status === 401 && o.auth?.password != null && !o.auth.basic) {
    const ch = parseChallenge(res.headers["www-authenticate"]);
    if (ch) {
      const authorization = digestHeader(ch, { method, url: o.url, username: o.auth.username || "admin", password: o.auth.password });
      return once({ ...o, method, headers: { ...o.headers, authorization } });
    }
  }
  return res;
}

export async function getJson(url, opts = {}) {
  const res = await request({ ...opts, url });
  if (res.status === 401 || res.status === 403) throw new LanHttpError("The device asked for a password.", { code: "EAUTH", status: res.status });
  if (res.status >= 400) throw new LanHttpError(`HTTP ${res.status} from ${new URL(url).host}`, { status: res.status });
  try {
    return res.json();
  } catch {
    throw new LanHttpError(`Unexpected reply from ${new URL(url).host}`, { code: "EBADJSON" });
  }
}

export async function getText(url, opts = {}) {
  const res = await request({ ...opts, url });
  if (res.status >= 400) throw new LanHttpError(`HTTP ${res.status} from ${new URL(url).host}`, { status: res.status });
  return res.text();
}

/** Page title and server banner of a device's web page, for identifying it and linking to it. */
export async function fingerprint(url, timeout = 2500) {
  try {
    const res = await request({ url, timeout });
    let text = res.body.subarray(0, 64 * 1024).toString("utf8");
    const title = text.match(/<title[^>]*>([^<]{0,140})<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || null;
    let location = res.headers.location || null;
    if (location) {
      try {
        location = new URL(location, url).toString();
      } catch {
        location = null;
      }
    }
    return { url, status: res.status, title, server: res.headers.server || null, location, auth: res.status === 401 ? res.headers["www-authenticate"] || "required" : null, body: text };
  } catch {
    return null;
  }
}

export { parseChallenge, digestHeader };
