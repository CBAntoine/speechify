// JSON over HTTPS that also works behind a corporate proxy (HTTPS_PROXY / NO_PROXY), which
// Node's built-in fetch ignores.

import * as http from "node:http";
import * as https from "node:https";
import * as tls from "node:tls";

export interface JsonResponse<T> {
  status: number;
  data: T | null;
  error?: string;
}

export function proxyFor(url: URL, env: Record<string, string | undefined> = process.env): URL | null {
  const raw = url.protocol === "https:" ? env.HTTPS_PROXY ?? env.https_proxy : env.HTTP_PROXY ?? env.http_proxy;
  if (!raw) return null;
  const host = url.hostname.toLowerCase();
  for (const entry of (env.NO_PROXY ?? env.no_proxy ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    if (entry === "*") return null;
    const bare = entry.replace(/^\*?\./, "").replace(/:\d+$/, "");
    if (host === bare || host.endsWith(`.${bare}`)) return null;
  }
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    return null;
  }
}

export function requestJson<T>(method: "GET" | "POST", url: string, body?: unknown, opts: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<JsonResponse<T>> {
  const u = new URL(url);
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = {
    "User-Agent": "Bulwark/0.2 (security scanner)",
    Accept: "application/json",
    ...(payload ? { "Content-Type": "application/json", "Content-Length": String(payload.length) } : {}),
    ...opts.headers,
  };
  const secure = u.protocol === "https:";
  const port = Number(u.port) || (secure ? 443 : 80);
  const proxy = proxyFor(u);

  return new Promise((resolve) => {
    let settled = false;
    const done = (r: JsonResponse<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => done({ status: 0, data: null, error: "timed out" }), opts.timeoutMs ?? 30_000);

    const onResponse = (res: http.IncomingMessage) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size <= 64 * 1024 * 1024) chunks.push(c);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let data: T | null = null;
        try {
          data = JSON.parse(text) as T;
        } catch {
          /* not JSON */
        }
        done({ status: res.statusCode ?? 0, data, error: data === null ? text.slice(0, 200) || `HTTP ${res.statusCode}` : undefined });
      });
      res.on("error", (e) => done({ status: 0, data: null, error: e.message }));
    };
    const fail = (e: Error) => done({ status: 0, data: null, error: e.message });

    if (!proxy || !secure) {
      const req = (secure ? https : http).request({ method, hostname: u.hostname, port, path: u.pathname + u.search, headers }, onResponse);
      req.on("error", fail);
      req.end(payload);
      return;
    }

    // HTTPS through the proxy: open a CONNECT tunnel, do TLS inside it, then send the request.
    const auth = proxy.username ? { "Proxy-Authorization": `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString("base64")}` } : {};
    const connect = http.request({ method: "CONNECT", hostname: proxy.hostname, port: Number(proxy.port) || 80, path: `${u.hostname}:${port}`, headers: { Host: `${u.hostname}:${port}`, ...auth } });
    connect.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        done({ status: 0, data: null, error: `The proxy refused to connect to ${u.hostname} (${res.statusCode}).` });
        return;
      }
      const secureSocket = tls.connect({ socket, servername: u.hostname });
      secureSocket.on("error", fail);
      secureSocket.once("secureConnect", () => {
        // No `agent` option: with one, Node opens its own connection instead of using the tunnel.
        const req = http.request({ method, hostname: u.hostname, port, path: u.pathname + u.search, headers, createConnection: () => secureSocket }, onResponse);
        req.on("error", fail);
        req.end(payload);
      });
    });
    connect.on("error", fail);
    connect.end();
  });
}
