// Android's binary XML (the AndroidManifest.xml inside an APK) and enough of its resource table
// (resources.arsc) to look up an app's name. Patch reads these to say what an app file is, and
// rewrites the manifest of its own TV app template: the app's id, name and version.

const STRING_POOL = 0x0001;
const XML = 0x0003;
const XML_START_ELEMENT = 0x0102;
const XML_RESOURCE_MAP = 0x0180;
const TABLE = 0x0002;
const TABLE_PACKAGE = 0x0200;
const TABLE_TYPE = 0x0201;
const UTF8_FLAG = 1 << 8;
const SORTED_FLAG = 1 << 0;
const NONE = 0xffffffff;

export const TYPE = { REFERENCE: 0x01, STRING: 0x03, INT_DEC: 0x10, INT_HEX: 0x11, BOOLEAN: 0x12 };
export const ATTR = { label: 0x01010001, icon: 0x01010002, name: 0x01010003, versionCode: 0x0101021b, versionName: 0x0101021c, minSdkVersion: 0x0101020c, banner: 0x010103f2 };

// ── String pools ───────────────────────────────────────────────────────────

function readLength8(buf, o) {
  const a = buf[o];
  return a & 0x80 ? [((a & 0x7f) << 8) | buf[o + 1], 2] : [a, 1];
}

function readLength16(buf, o) {
  const a = buf.readUInt16LE(o);
  return a & 0x8000 ? [((a & 0x7fff) << 16) | buf.readUInt16LE(o + 2), 4] : [a, 2];
}

/** A string pool chunk at `start`: { strings, utf8, flags, styleOffsets, styleData, size }. */
export function readStringPool(buf, start) {
  const headerSize = buf.readUInt16LE(start + 2);
  const size = buf.readUInt32LE(start + 4);
  const count = buf.readUInt32LE(start + 8);
  const styleCount = buf.readUInt32LE(start + 12);
  const flags = buf.readUInt32LE(start + 16);
  const stringsStart = buf.readUInt32LE(start + 20);
  const stylesStart = buf.readUInt32LE(start + 24);
  const utf8 = !!(flags & UTF8_FLAG);
  const strings = [];
  for (let i = 0; i < count; i++) {
    let o = start + stringsStart + buf.readUInt32LE(start + headerSize + i * 4);
    if (utf8) {
      const [, n1] = readLength8(buf, o);
      o += n1;
      const [bytes, n2] = readLength8(buf, o);
      o += n2;
      strings.push(buf.toString("utf8", o, o + bytes));
    } else {
      const [chars, n] = readLength16(buf, o);
      o += n;
      strings.push(buf.toString("utf16le", o, o + chars * 2));
    }
  }
  const styleOffsets = [];
  for (let i = 0; i < styleCount; i++) styleOffsets.push(buf.readUInt32LE(start + headerSize + count * 4 + i * 4));
  const styleData = styleCount ? buf.subarray(start + stylesStart, start + size) : Buffer.alloc(0);
  return { strings, utf8, flags, styleOffsets, styleData, size, headerSize };
}

function encodeString(s, utf8) {
  if (utf8) {
    const bytes = Buffer.from(s, "utf8");
    const len = (n) => (n < 0x80 ? [n] : [0x80 | (n >> 8), n & 0xff]);
    return Buffer.concat([Buffer.from([...len(s.length), ...len(bytes.length)]), bytes, Buffer.from([0])]);
  }
  const chars = Buffer.from(s, "utf16le");
  const n = s.length;
  const head = n < 0x8000 ? Buffer.alloc(2) : Buffer.alloc(4);
  if (n < 0x8000) head.writeUInt16LE(n, 0);
  else {
    head.writeUInt16LE(0x8000 | (n >> 16), 0);
    head.writeUInt16LE(n & 0xffff, 2);
  }
  return Buffer.concat([head, chars, Buffer.alloc(2)]);
}

/** A string pool chunk again, from readStringPool's result with changed strings. */
export function writeStringPool(pool) {
  const data = [];
  const offsets = Buffer.alloc(pool.strings.length * 4);
  let at = 0;
  pool.strings.forEach((s, i) => {
    const b = encodeString(s, pool.utf8);
    offsets.writeUInt32LE(at, i * 4);
    data.push(b);
    at += b.length;
  });
  let strings = Buffer.concat(data);
  if (strings.length % 4) strings = Buffer.concat([strings, Buffer.alloc(4 - (strings.length % 4))]);
  const styleOffsets = Buffer.alloc(pool.styleOffsets.length * 4);
  pool.styleOffsets.forEach((o, i) => styleOffsets.writeUInt32LE(o, i * 4));
  const headerSize = 28;
  const stringsStart = headerSize + offsets.length + styleOffsets.length;
  const stylesStart = pool.styleOffsets.length ? stringsStart + strings.length : 0;
  const size = stringsStart + strings.length + (pool.styleOffsets.length ? pool.styleData.length : 0);
  const head = Buffer.alloc(headerSize);
  head.writeUInt16LE(STRING_POOL, 0);
  head.writeUInt16LE(headerSize, 2);
  head.writeUInt32LE(size, 4);
  head.writeUInt32LE(pool.strings.length, 8);
  head.writeUInt32LE(pool.styleOffsets.length, 12);
  head.writeUInt32LE(pool.flags & ~SORTED_FLAG, 16);
  head.writeUInt32LE(stringsStart, 20);
  head.writeUInt32LE(stylesStart, 24);
  return Buffer.concat([head, offsets, styleOffsets, strings, pool.styleOffsets.length ? pool.styleData : Buffer.alloc(0)]);
}

// ── Binary XML ─────────────────────────────────────────────────────────────

/**
 * Parse binary XML: { pool, poolStart, resourceIds, elements: [{ name, attrs }] } where each
 * attribute is { name, resId, type, data, string, at } (at = byte offset of its typed value).
 */
export function readAxml(buf) {
  if (buf.length < 8 || buf.readUInt16LE(0) !== XML) throw new Error("That isn't an Android manifest.");
  let p = buf.readUInt16LE(2);
  let pool = null;
  let poolStart = -1;
  let resourceIds = [];
  const elements = [];
  while (p + 8 <= buf.length) {
    const type = buf.readUInt16LE(p);
    const headerSize = buf.readUInt16LE(p + 2);
    const size = buf.readUInt32LE(p + 4);
    if (size < 8 || p + size > buf.length) break;
    if (type === STRING_POOL && !pool) {
      pool = readStringPool(buf, p);
      poolStart = p;
    } else if (type === XML_RESOURCE_MAP) {
      resourceIds = [];
      for (let o = p + headerSize; o + 4 <= p + size; o += 4) resourceIds.push(buf.readUInt32LE(o));
    } else if (type === XML_START_ELEMENT && pool) {
      const e = p + headerSize;
      const str = (i) => (i === NONE ? null : pool.strings[i] ?? null);
      const attrStart = buf.readUInt16LE(e + 8);
      const attrSize = buf.readUInt16LE(e + 10);
      const attrCount = buf.readUInt16LE(e + 12);
      const attrs = [];
      for (let i = 0; i < attrCount; i++) {
        const a = e + attrStart + i * attrSize;
        const nameIdx = buf.readUInt32LE(a + 4);
        const raw = buf.readUInt32LE(a + 8);
        const valueType = buf[a + 15];
        const data = buf.readUInt32LE(a + 16);
        attrs.push({
          name: str(nameIdx),
          resId: resourceIds[nameIdx] ?? null,
          type: valueType,
          data,
          string: raw !== NONE ? str(raw) : valueType === TYPE.STRING ? str(data) : null,
          at: a + 12,
        });
      }
      elements.push({ name: str(buf.readUInt32LE(e + 4)), attrs });
    }
    p += size;
  }
  if (!pool) throw new Error("The manifest has no strings.");
  return { pool, poolStart, resourceIds, elements };
}

/** The attribute of an element by resource id (android:…) or plain name. */
export function attrOf(el, nameOrId) {
  if (!el) return null;
  return el.attrs.find((a) => (typeof nameOrId === "number" ? a.resId === nameOrId : a.name === nameOrId && a.resId == null)) || null;
}

/**
 * Rewrite a manifest: replace whole strings ({ "old": "new" }) and set integer attributes of the
 * <manifest> element ({ [ATTR.versionCode]: 7 }). Returns new bytes; the input is untouched.
 */
export function patchAxml(buf, { strings = {}, ints = {} } = {}) {
  const doc = readAxml(buf);
  const out = Buffer.from(buf);
  const manifest = doc.elements.find((e) => e.name === "manifest");
  for (const [id, value] of Object.entries(ints)) {
    const a = attrOf(manifest, Number(id));
    if (!a) throw new Error(`The manifest has no attribute 0x${Number(id).toString(16)}.`);
    out.writeUInt32LE(value >>> 0, a.at + 4);
  }
  let changed = false;
  const pool = { ...doc.pool, strings: doc.pool.strings.map((s) => (Object.hasOwn(strings, s) ? ((changed = true), strings[s]) : s)) };
  for (const s of Object.keys(strings)) if (!doc.pool.strings.includes(s)) throw new Error(`The manifest doesn't contain “${s}”.`);
  if (!changed) return out;
  const newPool = writeStringPool(pool);
  const before = out.subarray(0, doc.poolStart);
  const after = out.subarray(doc.poolStart + doc.pool.size);
  const result = Buffer.concat([before, newPool, after]);
  result.writeUInt32LE(result.length, 4);
  return result;
}

// ── Resource table (just string values) ───────────────────────────────────

function entryOffset(arsc, q, headerSize, flags, entryCount, entryId) {
  const offs = q + headerSize;
  if (flags & 0x01) {
    // Sparse: (index, offset/4) pairs.
    for (let i = 0; i < entryCount; i++) if (arsc.readUInt16LE(offs + i * 4) === entryId) return arsc.readUInt16LE(offs + i * 4 + 2) * 4;
    return -1;
  }
  if (entryId >= entryCount) return -1;
  if (flags & 0x02) {
    const v = arsc.readUInt16LE(offs + entryId * 2);
    return v === 0xffff ? -1 : v * 4;
  }
  const v = arsc.readUInt32LE(offs + entryId * 4);
  return v === NONE ? -1 : v;
}

/** The string a resource id points at (e.g. an app's @string/app_name), in the default language. */
export function arscString(arsc, resId, depth = 0) {
  if (!arsc || arsc.length < 12 || arsc.readUInt16LE(0) !== TABLE || depth > 4) return null;
  const pkgId = resId >>> 24;
  const typeId = (resId >>> 16) & 0xff;
  const entryId = resId & 0xffff;
  let p = arsc.readUInt16LE(2);
  let global = null;
  const found = [];
  while (p + 8 <= arsc.length) {
    const type = arsc.readUInt16LE(p);
    const size = arsc.readUInt32LE(p + 4);
    if (size < 8) break;
    if (type === STRING_POOL && !global) global = readStringPool(arsc, p);
    else if (type === TABLE_PACKAGE && arsc.readUInt32LE(p + 8) === pkgId) {
      let q = p + arsc.readUInt16LE(p + 2);
      while (q + 8 <= p + size) {
        const t = arsc.readUInt16LE(q);
        const hs = arsc.readUInt16LE(q + 2);
        const sz = arsc.readUInt32LE(q + 4);
        if (sz < 8) break;
        if (t === TABLE_TYPE && arsc[q + 8] === typeId) {
          const flags = arsc[q + 9];
          const entryCount = arsc.readUInt32LE(q + 12);
          const entriesStart = arsc.readUInt32LE(q + 16);
          const configSize = arsc.readUInt32LE(q + 20);
          const isDefault = arsc.subarray(q + 24, q + 20 + configSize).every((b) => b === 0);
          const off = entryOffset(arsc, q, hs, flags, entryCount, entryId);
          if (off >= 0) {
            const e = q + entriesStart + off;
            const eflags = arsc.readUInt16LE(e + 2);
            let dataType;
            let data;
            if (eflags & 0x0008) {
              // Compact entry: the value lives in the entry itself.
              dataType = eflags >>> 8;
              data = arsc.readUInt32LE(e + 4);
            } else if (!(eflags & 0x0001)) {
              const v = e + arsc.readUInt16LE(e);
              dataType = arsc[v + 3];
              data = arsc.readUInt32LE(v + 4);
            }
            if (dataType != null) found.push({ isDefault, dataType, data });
          }
        }
        q += sz;
      }
    }
    p += size;
  }
  const pick = found.find((f) => f.isDefault) || found[0];
  if (!pick) return null;
  if (pick.dataType === TYPE.STRING) return global?.strings[pick.data] ?? null;
  if (pick.dataType === TYPE.REFERENCE) return arscString(arsc, pick.data, depth + 1);
  return null;
}
