// Small TCP/TLS helpers for talking to devices. Every operation has a timeout.

import * as net from "node:net";
import * as tls from "node:tls";

export type PortState = "open" | "closed" | "filtered" | "unreachable";

/** Opens and immediately closes a connection. "closed" (refused) still proves the device is there. */
export function tcpProbe(ip: string, port: number, timeoutMs: number): Promise<PortState> {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const finish = (st: PortState) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.destroy();
      resolve(st);
    };
    const timer = setTimeout(() => finish("filtered"), timeoutMs);
    s.once("connect", () => finish("open"));
    s.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED" || err.code === "ECONNRESET") finish("closed");
      else if (err.code === "EHOSTUNREACH" || err.code === "ENETUNREACH" || err.code === "EHOSTDOWN") finish("unreachable");
      else finish("filtered");
    });
    s.connect({ host: ip, port });
  });
}

/** A connection we can write to and read from in steps, for protocols that take turns (SSH, VNC). */
export class Conversation {
  private buf = Buffer.alloc(0);
  private closed = false;
  private waiter: (() => void) | null = null;
  readonly socket: net.Socket;

  private constructor(socket: net.Socket) {
    this.socket = socket;
    socket.on("data", (d: Buffer) => {
      if (this.buf.length < 1_048_576) this.buf = Buffer.concat([this.buf, d]);
      this.waiter?.();
    });
    const end = () => {
      this.closed = true;
      this.waiter?.();
    };
    socket.on("end", end);
    socket.on("close", end);
    socket.on("error", end);
  }

  static open(ip: string, port: number, timeoutMs: number, tlsOptions?: tls.ConnectionOptions): Promise<Conversation | null> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (c: Conversation | null, s?: net.Socket) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!c) s?.destroy();
        resolve(c);
      };
      let socket: net.Socket;
      if (tlsOptions) {
        socket = tls.connect({ host: ip, port, servername: net.isIP(ip) ? undefined : ip, rejectUnauthorized: false, ...tlsOptions });
        socket.once("secureConnect", () => finish(new Conversation(socket)));
      } else {
        socket = net.connect({ host: ip, port });
        socket.once("connect", () => finish(new Conversation(socket)));
      }
      const timer = setTimeout(() => finish(null, socket), timeoutMs);
      socket.on("error", () => finish(null, socket));
    });
  }

  write(data: Buffer | string): void {
    if (!this.closed) this.socket.write(data);
  }

  /** Waits until `enough(buffer)` is true, the peer closes, or the timeout passes; returns and clears what arrived. */
  async read(enough: (b: Buffer) => boolean, timeoutMs: number): Promise<Buffer> {
    const deadline = Date.now() + timeoutMs;
    while (!enough(this.buf) && !this.closed && Date.now() < deadline) {
      await new Promise<void>((r) => {
        const t = setTimeout(r, Math.max(1, deadline - Date.now()));
        this.waiter = () => {
          clearTimeout(t);
          r();
        };
      });
      this.waiter = null;
    }
    const out = this.buf;
    this.buf = Buffer.alloc(0);
    return out;
  }

  /** Reads at least `n` bytes (or whatever arrived before the timeout). */
  readBytes(n: number, timeoutMs: number): Promise<Buffer> {
    return this.read((b) => b.length >= n, timeoutMs);
  }

  /** Reads one line ending in \n. */
  readLine(timeoutMs: number): Promise<Buffer> {
    return this.read((b) => b.includes(0x0a), timeoutMs);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  close(): void {
    this.closed = true;
    this.socket.destroy();
  }
}

/** Connects, optionally sends something, and collects the reply. Null if the connection failed. */
export async function exchange(
  ip: string,
  port: number,
  opts: { send?: Buffer | string; timeoutMs?: number; maxBytes?: number; until?: (b: Buffer) => boolean; tls?: tls.ConnectionOptions } = {},
): Promise<Buffer | null> {
  const timeout = opts.timeoutMs ?? 3000;
  const c = await Conversation.open(ip, port, timeout, opts.tls);
  if (!c) return null;
  try {
    if (opts.send !== undefined) c.write(opts.send);
    const max = opts.maxBytes ?? 65_536;
    return await c.read((b) => b.length >= max || (opts.until ? opts.until(b) : false), timeout);
  } finally {
    c.close();
  }
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  raw: string;
}

export function parseHttpResponse(buf: Buffer): HttpResponse | null {
  const text = buf.toString("latin1");
  const headEnd = text.indexOf("\r\n\r\n");
  const head = headEnd === -1 ? text : text.slice(0, headEnd);
  const m = head.match(/^(?:HTTP|RTSP)\/\d(?:\.\d)?\s+(\d{3})\s*([^\r\n]*)/);
  if (!m) return null;
  const headers: Record<string, string> = {};
  for (const line of head.split("\r\n").slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase();
      const v = line.slice(i + 1).trim();
      headers[k] = headers[k] ? `${headers[k]}, ${v}` : v;
    }
  }
  let body = headEnd === -1 ? "" : text.slice(headEnd + 4);
  if (/chunked/i.test(headers["transfer-encoding"] ?? "")) body = dechunk(body);
  return { status: Number(m[1]), statusText: m[2], headers, body, raw: text };
}

function dechunk(body: string): string {
  let out = "";
  let i = 0;
  while (i < body.length) {
    const lineEnd = body.indexOf("\r\n", i);
    if (lineEnd === -1) break;
    const size = parseInt(body.slice(i, lineEnd), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    out += body.slice(lineEnd + 2, lineEnd + 2 + size);
    i = lineEnd + 2 + size + 2;
  }
  return out || body;
}

/** A minimal HTTP/1.1 GET over a raw socket, so we see exactly what the device says. */
export async function httpGet(
  ip: string,
  port: number,
  path: string,
  opts: { tls?: boolean; timeoutMs?: number; headers?: Record<string, string>; hostHeader?: string } = {},
): Promise<HttpResponse | null> {
  const hostHeader = opts.hostHeader ?? (port === 80 || port === 443 ? ip : `${ip}:${port}`);
  const extra = Object.entries(opts.headers ?? {}).map(([k, v]) => `${k}: ${v}\r\n`).join("");
  const req = `GET ${path} HTTP/1.1\r\nHost: ${hostHeader}\r\nUser-Agent: Bulwark-Scanner/0.1 (security check of your own network)\r\nAccept: */*\r\nConnection: close\r\n${extra}\r\n`;
  const buf = await exchange(ip, port, {
    send: req,
    timeoutMs: opts.timeoutMs ?? 4000,
    maxBytes: 262_144,
    tls: opts.tls ? { minVersion: "TLSv1", ciphers: "DEFAULT:@SECLEVEL=0" } : undefined,
  });
  return buf ? parseHttpResponse(buf) : null;
}

export async function httpPost(
  url: URL,
  body: string,
  headers: Record<string, string>,
  timeoutMs = 5000,
): Promise<HttpResponse | null> {
  const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  const head =
    `POST ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUser-Agent: Bulwark-Scanner/0.1\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n` +
    Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("") +
    "\r\n";
  const buf = await exchange(url.hostname, port, { send: head + body, timeoutMs, maxBytes: 262_144, tls: url.protocol === "https:" ? {} : undefined });
  return buf ? parseHttpResponse(buf) : null;
}
