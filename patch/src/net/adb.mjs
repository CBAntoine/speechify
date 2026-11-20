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
        const onClose = () => finish(null, Buffer.concat(out).toString("utf8"));
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
            finish(null, Buffer.concat(out).toString("utf8"));
          }
        };
        this.on("message", onMsg);
        this.on("close", onClose);
        this.send(CMD.OPEN, local, 0, `shell:${command}\0`);
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

/** Quote a value for the device's shell. */
export const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
