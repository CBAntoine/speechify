// Just enough ZIP for Android app files (APKs): read the entries of one, and write a new one with
// uncompressed entries 4-byte aligned (as Android expects for resources.arsc and media), no data
// descriptors and fixed timestamps. Sections come back separately because APK signing needs them.
import zlib from "node:zlib";

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** CRC-32 as ZIP uses it (zlib's when this Node has it). */
export function crc32(buf) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buf) >>> 0;
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
// 1 January 1981, midnight: the same stamp on every entry, so the same app builds the same file.
const DOS_TIME = 0;
const DOS_DATE = (1 << 9) | (1 << 5) | 1;

/** Entries of a ZIP: [{ name, method, crc, size, raw }] (raw = the stored bytes, maybe compressed). */
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That isn't a ZIP or APK file.");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > eocd) throw new Error("The file's directory is broken.");
  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL) throw new Error("The file's directory is broken.");
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (buf.readUInt32LE(local) !== LOCAL) throw new Error(`The entry ${name} is broken.`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    entries.push({ name, method, crc, size, raw: buf.subarray(start, start + csize) });
  }
  return { entries, cdOffset, cdSize, eocdOffset: eocd };
}

/** An entry's real bytes. */
export function entryData(e) {
  if (e.data) return e.data;
  if (e.method === 0) return e.raw;
  if (e.method === 8) return zlib.inflateRawSync(e.raw);
  throw new Error(`${e.name} uses a kind of compression Patch can't read.`);
}

/**
 * Write a ZIP. Each entry is { name, data, store?, align? } (compressed unless store, or when
 * compressing doesn't help) or a copied { name, method, crc, size, raw } from readZip.
 * Returns { body, cd, eocd } (the three parts APK signing works on) and zip, all of it.
 */
export function writeZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    let { method, raw, crc, size } = e;
    if (!raw) {
      const data = e.data;
      size = data.length;
      crc = crc32(data);
      method = 0;
      raw = data;
      if (!e.store && size > 0) {
        const packed = zlib.deflateRawSync(data, { level: 9 });
        if (packed.length < size) {
          method = 8;
          raw = packed;
        }
      }
    }
    const name = Buffer.from(e.name, "utf8");
    let extra = Buffer.alloc(0);
    if (method === 0) {
      // Pad uncompressed entries so their bytes start on a 4-byte boundary (Android maps them directly).
      const align = e.align || 4;
      const pad = (align - ((offset + 30 + name.length + 6) % align)) % align;
      extra = Buffer.alloc(6 + pad);
      extra.writeUInt16LE(0xd935, 0); // the alignment field Android's own tools write
      extra.writeUInt16LE(2 + pad, 2);
      extra.writeUInt16LE(align, 4);
    }
    const flags = /[^\x00-\x7f]/.test(e.name) ? 0x800 : 0;
    const version = method === 8 ? 20 : 10;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(LOCAL, 0);
    lh.writeUInt16LE(version, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(DOS_TIME, 10);
    lh.writeUInt16LE(DOS_DATE, 12);
    lh.writeUInt32LE(crc >>> 0, 14);
    lh.writeUInt32LE(raw.length, 18);
    lh.writeUInt32LE(size, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(extra.length, 28);
    parts.push(lh, name, extra, raw);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(CENTRAL, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(version, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(DOS_TIME, 12);
    ch.writeUInt16LE(DOS_DATE, 14);
    ch.writeUInt32LE(crc >>> 0, 16);
    ch.writeUInt32LE(raw.length, 20);
    ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + extra.length + raw.length;
  }
  const body = Buffer.concat(parts);
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  return {
    body,
    cd,
    eocd,
    get zip() {
      return Buffer.concat([body, cd, eocd]);
    },
  };
}
