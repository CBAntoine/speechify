// A small WebSocket client (RFC 6455) for talking to TVs on the home network. Samsung and LG TVs use
// WebSockets for their remote-control APIs, often over TLS with self-signed certificates, which is
// why this exists instead of Node's built-in WebSocket (that one can't skip certificate checks).
// The frame codec is shared with the device simulator, which plays the TV side.
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
export const OP = { continuation: 0, text: 1, binary: 2, close: 8, ping: 9, pong: 10 };

export const acceptKey = (key) => crypto.createHash("sha1").update(key + GUID).digest("base64");

/** One frame. Clients must mask what they send; servers must not. */
export function encodeFrame(opcode, payload = Buffer.alloc(0), { mask = true, fin = true } = {}) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const len = data.length;
  const head = [((fin ? 0x80 : 0) | opcode) & 0xff];
  let ext = Buffer.alloc(0);
  if (len < 126) head.push((mask ? 0x80 : 0) | len);
  else if (len < 65536) {
    head.push((mask ? 0x80 : 0) | 126);
    ext = Buffer.alloc(2);
    ext.writeUInt16BE(len);
  } else {
    head.push((mask ? 0x80 : 0) | 127);
    ext = Buffer.alloc(8);
    ext.writeBigUInt64BE(BigInt(len));
  }
  if (!mask) return Buffer.concat([Buffer.from(head), ext, data]);
  const key = crypto.randomBytes(4);
  const body = Buffer.alloc(len);
  for (let i = 0; i < len; i++) body[i] = data[i] ^ key[i & 3];
  return Buffer.concat([Buffer.from(head), ext, key, body]);
}

/** Feed it bytes; it calls onFrame({ fin, opcode, payload }) for every complete frame. */
export class FrameParser {
  constructor(onFrame, { maxSize = 16 * 1024 * 1024 } = {}) {
    this.buf = Buffer.alloc(0);
    this.onFrame = onFrame;
    this.maxSize = maxSize;
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0];
      const b1 = this.buf[1];
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buf.length < 4) return;
        len = this.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (this.buf.length < 10) return;
        const big = this.buf.readBigUInt64BE(2);
        if (big > BigInt(this.maxSize)) throw new Error("WebSocket frame too large");
        len = Number(big);
        off = 10;
      }
      const masked = !!(b1 & 0x80);
      const need = off + (masked ? 4 : 0) + len;
      if (this.buf.length < need) return;
      let payload = this.buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const key = this.buf.subarray(off, off + 4);
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ key[i & 3];
        payload = out;
      } else payload = Buffer.from(payload);
      this.buf = this.buf.subarray(need);
      this.onFrame({ fin: !!(b0 & 0x80), opcode: b0 & 0x0f, payload });
    }
  }
}

/**
 * Wraps a connected socket (after the HTTP upgrade) as a message stream. Used for both ends:
 * `masking` is true for clients and false for the simulator's server side.
 */
export class WebSocketConnection extends EventEmitter {
  constructor(socket, { masking = true, head } = {}) {
    super();
    this.socket = socket;
    this.masking = masking;
    this.open = true;
    this.fragments = null;
    this.inbox = []; // recent messages, so a reply that lands before anyone waits for it isn't lost
    this.parser = new FrameParser((f) => this.#frame(f));
    socket.on("data", (d) => {
      try {
        this.parser.push(d);
      } catch (err) {
        this.emit("error", err);
        socket.destroy();
      }
    });
    socket.on("close", () => this.#closed());
    socket.on("error", (err) => this.emit("error", err));
    if (head?.length) setImmediate(() => this.parser.push(head));
  }

  #frame({ fin, opcode, payload }) {
    if (opcode === OP.ping) return this.#write(OP.pong, payload);
    if (opcode === OP.pong) return;
    if (opcode === OP.close) {
      if (this.open) this.#write(OP.close, payload.subarray(0, 2));
      this.open = false;
      this.socket.end();
      return;
    }
    if (opcode === OP.continuation) {
      if (!this.fragments) return;
      this.fragments.parts.push(payload);
    } else this.fragments = { opcode, parts: [payload] };
    if (!fin) return;
    const { opcode: op, parts } = this.fragments;
    this.fragments = null;
    const data = Buffer.concat(parts);
    const msg = op === OP.text ? data.toString("utf8") : data;
    this.inbox.push(msg);
    if (this.inbox.length > 100) this.inbox.shift();
    this.emit("message", msg, op === OP.binary);
  }

  #write(opcode, payload) {
    if (!this.socket.writable) return;
    this.socket.write(encodeFrame(opcode, payload, { mask: this.masking }));
  }

  #closed() {
    if (this.closedOnce) return;
    this.closedOnce = true;
    this.open = false;
    this.emit("close");
  }

  send(data) {
    if (!this.open) throw Object.assign(new Error("The connection to the TV closed."), { code: "ECONNRESET" });
    if (typeof data === "object" && !Buffer.isBuffer(data)) data = JSON.stringify(data);
    this.#write(Buffer.isBuffer(data) ? OP.binary : OP.text, data);
  }

  /**
   * Resolves with the first message (parsed as JSON when possible) that `match` accepts, including
   * one that arrived moments earlier. Each message is handed to one waiter only.
   */
  waitFor(match = () => true, timeout = 5000) {
    const parse = (m) => {
      if (typeof m !== "string") return m;
      try {
        return JSON.parse(m);
      } catch {
        return m;
      }
    };
    const accepts = (v) => {
      try {
        return !!match(v);
      } catch {
        return false;
      }
    };
    for (let i = 0; i < this.inbox.length; i++) {
      const v = parse(this.inbox[i]);
      if (accepts(v)) {
        this.inbox.splice(i, 1);
        return Promise.resolve(v);
      }
    }
    return new Promise((resolve, reject) => {
      const done = (err, v) => {
        clearTimeout(timer);
        this.off("message", onMsg);
        this.off("close", onClose);
        err ? reject(err) : resolve(v);
      };
      const onMsg = (m) => {
        const v = parse(m);
        if (!accepts(v)) return;
        const i = this.inbox.lastIndexOf(m);
        if (i !== -1) this.inbox.splice(i, 1);
        done(null, v);
      };
      const onClose = () => done(Object.assign(new Error("The TV closed the connection."), { code: "ECONNRESET" }));
      const timer = setTimeout(() => done(Object.assign(new Error("The TV didn't answer in time."), { code: "ETIMEDOUT" })), timeout);
      this.on("message", onMsg);
      this.on("close", onClose);
    });
  }

  close() {
    if (this.open) {
      try {
        const code = Buffer.alloc(2);
        code.writeUInt16BE(1000);
        this.#write(OP.close, code);
      } catch {
        /* socket gone */
      }
    }
    this.open = false;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 300).unref?.();
  }
}

/**
 * Connect to ws:// or wss:// (certificates aren't checked: TVs use self-signed ones).
 * Resolves with a WebSocketConnection once the server has accepted the upgrade.
 */
export function wsConnect(url, { timeout = 5000, headers = {} } = {}) {
  const u = new URL(url);
  const secure = u.protocol === "wss:";
  const port = Number(u.port) || (secure ? 443 : 80);
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString("base64");
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    const opts = { host: u.hostname, port, servername: net.isIP(u.hostname) ? undefined : u.hostname, rejectUnauthorized: false };
    const socket = secure ? tls.connect(opts) : net.connect(opts);
    const timer = setTimeout(() => fail(Object.assign(new Error("The TV didn't answer."), { code: "ETIMEDOUT" })), timeout);
    socket.once("error", fail);
    socket.once(secure ? "secureConnect" : "connect", () => {
      const lines = [
        `GET ${u.pathname || "/"}${u.search} HTTP/1.1`,
        `Host: ${u.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
    });
    let buf = Buffer.alloc(0);
    const onData = (d) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) {
        if (buf.length > 16384) fail(new Error("Bad WebSocket handshake"));
        return;
      }
      socket.off("data", onData);
      const head = buf.subarray(0, end).toString("latin1").split("\r\n");
      const status = Number(head[0].split(" ")[1]);
      const hdrs = {};
      for (const line of head.slice(1)) {
        const i = line.indexOf(":");
        if (i > 0) hdrs[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
      if (status !== 101) return fail(Object.assign(new Error(`The TV refused the connection (HTTP ${status}).`), { code: status === 401 || status === 403 ? "EAUTH" : "EREFUSED", status }));
      if (hdrs["sec-websocket-accept"] !== acceptKey(key)) return fail(new Error("Bad WebSocket handshake"));
      settled = true;
      clearTimeout(timer);
      socket.off("error", fail);
      resolve(new WebSocketConnection(socket, { masking: true, head: buf.subarray(end + 4) }));
    };
    socket.on("data", onData);
  });
}

/** Server side of the handshake, for the device simulator (http.Server "upgrade" event). */
export function acceptUpgrade(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return null;
  }
  socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${acceptKey(key)}`, "", ""].join("\r\n"));
  return new WebSocketConnection(socket, { masking: false, head });
}
