// Android Debug Bridge over the network (TCP 5555), the way Fire TV and Android/Google TV devices
// accept remote commands once "ADB debugging" / "Network debugging" is switched on in their
// developer options. The first connection makes the TV ask "Allow USB debugging?"; it remembers
// Patch's key after "Always allow".
//
// Wire format: 24-byte little-endian header { command, arg0, arg1, length, checksum, magic } + data.
import net from "node:net";
import crypto from "node:crypto";
import os from "node:os";
import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";

export const CMD = { CNXN: 0x4e584e43, AUTH: 0x48545541, OPEN: 0x4e45504f, OKAY: 0x59414b4f, CLSE: 0x45534c43, WRTE: 0x45545257, STLS: 0x534c5453 };
export const AUTH = { TOKEN: 1, SIGNATURE: 2, RSAPUBLICKEY: 3 };
export const VERSION = 0x01000001;
export const MAX_DATA = 256 * 1024;
// DER prefix of a SHA-1 DigestInfo: ADB signs its 20-byte token as if it were a SHA-1 digest.
export const SHA1_PREFIX = Buffer.from("3021300906052b0e03021a05000414", "hex");

const checksum = (b) => {
  let s = 0;
  for (const x of b) s = (s + x) >>> 0;
  return s;
};

export function encodeMessage(command, arg0, arg1, data = Buffer.alloc(0)) {
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const h = Buffer.alloc(24);
  h.writeUInt32LE(command >>> 0, 0);
  h.writeUInt32LE(arg0 >>> 0, 4);
  h.writeUInt32LE(arg1 >>> 0, 8);
  h.writeUInt32LE(payload.length, 12);
  h.writeUInt32LE(checksum(payload), 16);
  h.writeUInt32LE((command ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, payload]);
}

/** Splits a byte stream into ADB messages. */
export class MessageParser {
  constructor(onMessage) {
    this.buf = Buffer.alloc(0);
    this.onMessage = onMessage;
  }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 24) {
      const command = this.buf.readUInt32LE(0);
      const len = this.buf.readUInt32LE(12);
      if (this.buf.readUInt32LE(20) !== (command ^ 0xffffffff) >>> 0) throw new Error("Not an ADB message");
      if (len > 16 * 1024 * 1024) throw new Error("ADB message too large");
      if (this.buf.length < 24 + len) return;
      const msg = { command, arg0: this.buf.readUInt32LE(4), arg1: this.buf.readUInt32LE(8), data: Buffer.from(this.buf.subarray(24, 24 + len)) };
      this.buf = this.buf.subarray(24 + len);
      this.onMessage(msg);
    }
  }
}

const b64urlToBig = (s) => BigInt(`0x${Buffer.from(s, "base64url").toString("hex") || "0"}`);
const bigToB64url = (n) => {
  let hex = n.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  return Buffer.from(hex, "hex").toString("base64url");
};

/**
 * ADB's public-key format: base64 of Android's RSAPublicKey struct (little-endian words:
 * len, n0inv, n[64], rr[64], exponent), then " user@host".
 */
export function androidPublicKey(key, comment = `patch@${os.hostname().replace(/\..*$/, "") || "computer"}`) {
  const pub = crypto.createPublicKey(key);
  const { n: nB64, e: eB64 } = pub.export({ format: "jwk" });
  const n = b64urlToBig(nB64);
  const e = Number(b64urlToBig(eB64));
  const words = 64;
  if (n >> BigInt(words * 32) !== 0n || n >> BigInt(words * 32 - 1) === 0n) throw new Error("ADB keys must be 2048-bit RSA");
  const M = 1n << 32n;
  const n0 = n % M;
  let inv = n0;
  for (let i = 0; i < 5; i++) inv = (inv * (2n - ((n0 * inv) % M))) % M;
  inv = (inv + M) % M;
  const n0inv = (M - inv) % M;
  const rr = (1n << BigInt(words * 64)) % n;
  const buf = Buffer.alloc(4 + 4 + words * 4 * 2 + 4);
  let o = 0;
  buf.writeUInt32LE(words, o);
  o += 4;
  buf.writeUInt32LE(Number(n0inv), o);
  o += 4;
  for (const big of [n, rr]) {
    for (let i = 0; i < words; i++) {
      buf.writeUInt32LE(Number((big >> BigInt(32 * i)) & 0xffffffffn), o);
      o += 4;
    }
  }
  buf.writeUInt32LE(e, o);
  return `${buf.toString("base64")} ${comment}\0`;
}

/** The reverse, for the device simulator: an ADB public key back into a Node KeyObject. */
export function parseAndroidPublicKey(text) {
  const b64 = String(text).replace(/\0$/, "").split(" ")[0];
  const buf = Buffer.from(b64, "base64");
  const words = buf.readUInt32LE(0);
  let n = 0n;
  for (let i = 0; i < words; i++) n |= BigInt(buf.readUInt32LE(8 + i * 4)) << BigInt(32 * i);
  const e = buf.readUInt32LE(8 + words * 8);
  const n0inv = BigInt(buf.readUInt32LE(4));
  const rr = (() => {
    let r = 0n;
    for (let i = 0; i < words; i++) r |= BigInt(buf.readUInt32LE(8 + words * 4 + i * 4)) << BigInt(32 * i);
    return r;
  })();
  const ok = ((n % (1n << 32n)) * n0inv) % (1n << 32n) === (1n << 32n) - 1n && rr === (1n << BigInt(words * 64)) % n;
  return { key: crypto.createPublicKey({ key: { kty: "RSA", n: bigToB64url(n), e: bigToB64url(BigInt(e)) }, format: "jwk" }), valid: ok };
}

export const signToken = (privateKey, token) => crypto.privateEncrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.concat([SHA1_PREFIX, token]));

export function newAdbKey() {
  return crypto.generateKeyPairSync("rsa", { modulusLength: 2048, publicExponent: 65537 }).privateKey.export({ type: "pkcs8", format: "pem" });
}

/** "device::ro.product.name=sheldon;ro.product.model=AFTMM;…" → { state: "device", props: {…} } */
export function parseBanner(text) {
  const s = String(text || "").replace(/\0+$/, "");
  const at = s.indexOf("::");
  const state = at >= 0 ? s.slice(0, at) : s;
  const props = {};
  for (const kv of (at >= 0 ? s.slice(at + 2) : "").split(";")) {
    const i = kv.indexOf("=");
    if (i > 0) props[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return { state, props };
}

const err = (message, code) => Object.assign(new Error(message), { code });

export class AdbClient extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.nextId = 1;
    this.queue = Promise.resolve();
    this.open = true;
    this.maxData = 4096;
    this.banner = null;
    this.parser = new MessageParser((m) => this.emit("message", m));
    // A shell command, a file transfer and a few open streams each listen for their own messages.
    this.setMaxListeners(40);
    socket.on("data", (d) => {
      try {
        this.parser.push(d);
      } catch (e) {
        this.emit("error", e);
        socket.destroy();
      }
    });
    socket.on("close", () => {
      this.open = false;
      this.emit("close");
    });
    socket.on("error", () => {});
  }

  send(command, arg0, arg1, data) {
    if (this.socket.writable) this.socket.write(encodeMessage(command, arg0, arg1, data));
  }

  /**
   * Connect and authenticate. With allowPrompt, an unknown key is offered to the device, which shows
   * the "Allow USB debugging?" question; otherwise an unknown key fails with code ESETUP.
   */
  static connect(host, { port = 5555, privateKey, allowPrompt = false, timeout = 5000, promptTimeout = 45_000, onPrompt } = {}) {
    return new Promise((resolve, reject) => {
      const socket = net.connect({ host, port });
      const client = new AdbClient(socket);
      let signed = false;
      let offered = false;
      let finished = false;
      let timer = setTimeout(() => fail(err("The device didn't answer.", "ETIMEDOUT")), timeout);
      const fail = (e) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.destroy();
        reject(e);
      };
      socket.once("error", (e) => fail(e));
      socket.once("close", () => fail(err(offered ? "The device closed the connection before Patch was allowed." : "The device closed the connection.", offered ? "ESETUP" : "ECONNRESET")));
      socket.once("connect", () => client.send(CMD.CNXN, VERSION, MAX_DATA, "host::\0"));
      client.on("message", function onMsg(m) {
        if (m.command === CMD.CNXN) {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          client.off("message", onMsg);
          socket.removeAllListeners("close");
          socket.on("close", () => {
            client.open = false;
            client.emit("close");
          });
          client.maxData = Math.min(m.arg1 || 4096, MAX_DATA);
          client.banner = parseBanner(m.data.toString("utf8"));
          resolve(client);
        } else if (m.command === CMD.STLS) {
          fail(err("This device only offers encrypted wireless debugging, which Patch doesn't support. Use its Network/ADB debugging option instead.", "EUNSUPPORTED"));
        } else if (m.command === CMD.AUTH && m.arg0 === AUTH.TOKEN) {
          if (!signed && privateKey) {
            signed = true;
            client.send(CMD.AUTH, AUTH.SIGNATURE, 0, signToken(privateKey, m.data));
          } else if (!offered) {
            if (!allowPrompt || !privateKey) return fail(err("The device hasn't allowed Patch yet.", "ESETUP"));
            offered = true;
            client.send(CMD.AUTH, AUTH.RSAPUBLICKEY, 0, androidPublicKey(privateKey));
            clearTimeout(timer);
            timer = setTimeout(() => fail(err("Nobody allowed Patch on the device's screen.", "ESETUP")), promptTimeout);
            onPrompt?.();
          }
        }
      });
    });
  }

  /** Run a shell command; resolves with its output. Commands run one at a time. */
  shell(command, { timeout = 8000 } = {}) {
    return this.#run(`shell:${command}`, timeout).then((out) => out.toString("utf8"));
  }

  /**
   * Run a command and resolve with exactly the bytes it wrote (ADB's "exec" service: no terminal in
   * between to change line endings), which is what a picture of the screen needs.
   */
  exec(command, { timeout = 20_000 } = {}) {
    return this.#run(`exec:${command}`, timeout);
  }

  #run(service, timeout) {
    const run = () =>
      new Promise((resolve, reject) => {
        if (!this.open) return reject(err("The connection to the device closed.", "ECONNRESET"));
        const local = this.nextId++;
        let remote = 0;
        const out = [];
        const finish = (e, v) => {
          clearTimeout(timer);
          this.off("message", onMsg);
          this.off("close", onClose);
          e ? reject(e) : resolve(v);
        };
        const onClose = () => finish(null, Buffer.concat(out));
        const timer = setTimeout(() => {
          this.send(CMD.CLSE, local, remote);
          finish(err("The device took too long to answer.", "ETIMEDOUT"));
        }, timeout);
        const onMsg = (m) => {
          if (m.arg1 !== local) return;
          if (m.command === CMD.OKAY) remote = m.arg0;
          else if (m.command === CMD.WRTE) {
            remote = m.arg0;
            out.push(m.data);
            this.send(CMD.OKAY, local, remote);
          } else if (m.command === CMD.CLSE) {
            if (remote) this.send(CMD.CLSE, local, remote);
            finish(null, Buffer.concat(out));
          }
        };
        this.on("message", onMsg);
        this.on("close", onClose);
        this.send(CMD.OPEN, local, 0, `${service}\0`);
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /**
   * Opens a two-way stream to something on the device and resolves with it once the device accepts:
   * "localabstract:<name>" is a program's own socket (a browser's debugging socket, say) and
   * "tcp:<port>" a port on the device itself. Streams stay open alongside shell commands. If nothing
   * is listening there, it rejects with code EREFUSED.
   */
  openStream(service, { timeout = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.open) return reject(err("The connection to the device closed.", "ECONNRESET"));
      const local = this.nextId++;
      const stream = new AdbStream(this, local);
      let settled = false;
      const settle = (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stream.off("ready", onReady);
        stream.off("close", onRefused);
        e ? reject(e) : resolve(stream);
      };
      const onReady = () => settle(null);
      const onRefused = () => settle(err("Nothing on the device answered there.", "EREFUSED"));
      const timer = setTimeout(() => {
        stream.destroy();
        settle(err("The device took too long to answer.", "ETIMEDOUT"));
      }, timeout);
      stream.once("ready", onReady);
      stream.once("close", onRefused);
      this.send(CMD.OPEN, local, 0, `${service}\0`);
    });
  }

  /**
   * Copies a file onto the device (ADB's "sync" service: SEND path,mode → DATA… → DONE, answered by
   * OKAY or FAIL). Used to hand the TV an app file before installing it.
   */
  push(data, remotePath, { mode = 0o644, timeout = 180_000 } = {}) {
    const run = () =>
      new Promise((resolve, reject) => {
        if (!this.open) return reject(err("The connection to the device closed.", "ECONNRESET"));
        const local = this.nextId++;
        let remote = 0;
        const stream = syncStream(data, remotePath, mode);
        const size = Math.max(1024, this.maxData);
        let offset = 0;
        let reply = Buffer.alloc(0);
        let finished = false;
        const finish = (e, v) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          this.off("message", onMsg);
          this.off("close", onClose);
          if (remote) this.send(CMD.CLSE, local, remote);
          e ? reject(e) : resolve(v);
        };
        const timer = setTimeout(() => finish(err("Sending the file to the device took too long.", "ETIMEDOUT")), timeout);
        const onClose = () => finish(err("The connection to the device closed.", "ECONNRESET"));
        const onMsg = (m) => {
          if (m.arg1 !== local) return;
          if (m.command === CMD.OKAY) {
            // The device took the last piece (or opened the stream): send the next one.
            remote = m.arg0;
            if (offset < stream.length) {
              const chunk = stream.subarray(offset, offset + size);
              offset += chunk.length;
              this.send(CMD.WRTE, local, remote, chunk);
            }
          } else if (m.command === CMD.WRTE) {
            this.send(CMD.OKAY, local, remote);
            reply = Buffer.concat([reply, m.data]);
            if (reply.length < 8) return;
            const id = reply.toString("latin1", 0, 4);
            if (id === "OKAY") {
              this.send(CMD.WRTE, local, remote, syncHead("QUIT", 0));
              finish(null, true);
            } else if (id === "FAIL") {
              const n = reply.readUInt32LE(4);
              if (reply.length >= 8 + n) finish(err(`The device refused the file: ${reply.toString("utf8", 8, 8 + n)}`, "EPUSH"));
            } else finish(err("The device answered the file transfer with something unexpected.", "EPUSH"));
          } else if (m.command === CMD.CLSE) {
            remote = 0;
            finish(err("The device stopped the file transfer.", "EPUSH"));
          }
        };
        this.on("message", onMsg);
        this.on("close", onClose);
        this.send(CMD.OPEN, local, 0, "sync:\0");
      });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  close() {
    this.open = false;
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 200).unref?.();
  }
}

/**
 * One open ADB stream, as a Node stream. ADB lets each side send one piece at a time: the next
 * goes out when the other side has said OKAY to the last.
 */
export class AdbStream extends Duplex {
  constructor(client, local) {
    super();
    this.client = client;
    this.local = local;
    this.remote = 0;
    this.waiting = null; // called when the device takes the piece just sent
    this.onMessage = (m) => {
      if (m.arg1 !== this.local) return;
      if (m.command === CMD.OKAY) {
        const first = !this.remote;
        this.remote = m.arg0;
        if (first) return this.emit("ready");
        const next = this.waiting;
        this.waiting = null;
        next?.();
      } else if (m.command === CMD.WRTE) {
        this.remote = m.arg0;
        client.send(CMD.OKAY, this.local, this.remote);
        this.push(m.data);
      } else if (m.command === CMD.CLSE) {
        // The device closed it (or never opened it): nothing more to say to it.
        this.remote = 0;
        this.destroy();
      }
    };
    this.onClientClose = () => {
      this.remote = 0;
      this.destroy();
    };
    client.on("message", this.onMessage);
    client.on("close", this.onClientClose);
  }

  _read() {}

  _write(chunk, encoding, callback) {
    const size = Math.max(1024, this.client.maxData);
    let offset = 0;
    const next = () => {
      if (this.destroyed || !this.remote) return callback(err("The connection to the device closed.", "ECONNRESET"));
      if (offset >= chunk.length) return callback();
      const piece = chunk.subarray(offset, offset + size);
      offset += piece.length;
      this.waiting = next;
      this.client.send(CMD.WRTE, this.local, this.remote, piece);
    };
    next();
  }

  _final(callback) {
    callback();
    this.destroy();
  }

  _destroy(error, callback) {
    this.client.off("message", this.onMessage);
    this.client.off("close", this.onClientClose);
    if (this.remote) this.client.send(CMD.CLSE, this.local, this.remote);
    this.remote = 0;
    const stuck = this.waiting;
    this.waiting = null;
    stuck?.();
    callback(error);
  }
}

/** One sync request header: four ASCII letters and a little-endian number. */
export function syncHead(id, n) {
  const b = Buffer.alloc(8);
  b.write(id, 0, "latin1");
  b.writeUInt32LE(n >>> 0, 4);
  return b;
}

export const SYNC_DATA_MAX = 64 * 1024;

/** The whole sync conversation for sending one file, before the device's answer. */
export function syncStream(data, remotePath, mode = 0o644, mtime = Math.floor(Date.now() / 1000)) {
  const spec = Buffer.from(`${remotePath},${0o100000 | mode}`, "utf8");
  const parts = [syncHead("SEND", spec.length), spec];
  for (let o = 0; o < data.length; o += SYNC_DATA_MAX) {
    const c = data.subarray(o, o + SYNC_DATA_MAX);
    parts.push(syncHead("DATA", c.length), c);
  }
  parts.push(syncHead("DONE", mtime));
  return Buffer.concat(parts);
}

/** Quote a value for the device's shell. */
export const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
