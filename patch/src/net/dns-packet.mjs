// Minimal DNS message codec for multicast DNS (RFC 6762) and DNS-SD (RFC 6763).
// Names are strings of labels joined by "."; a literal "." or "\" inside a label is escaped
// ("Kitchen\.Speaker._airplay._tcp.local"), which matters for DNS-SD instance names.

export const TYPE = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33, NSEC: 47, ANY: 255 };
const TYPE_NAME = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]));

export function splitName(name) {
  const labels = [];
  let cur = "";
  const s = String(name).replace(/\.$/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && i + 1 < s.length) cur += s[++i];
    else if (c === ".") {
      labels.push(cur);
      cur = "";
    } else cur += c;
  }
  labels.push(cur);
  return labels.filter((l) => l !== "");
}

const escapeLabel = (l) => l.replace(/\\/g, "\\\\").replace(/\./g, "\\.");
export const joinName = (labels) => labels.map(escapeLabel).join(".");
/** First label of a DNS-SD instance name, unescaped: "Living Room" */
export const instanceLabel = (name) => splitName(name)[0] ?? name;

export function encodeName(name) {
  const parts = [];
  for (const label of splitName(name)) {
    const b = Buffer.from(label, "utf8").subarray(0, 63);
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

export function decodeName(buf, offset) {
  const labels = [];
  let o = offset;
  let jumped = false;
  let end = offset;
  for (let guard = 0; guard < 64; guard++) {
    if (o >= buf.length) throw new Error("name out of range");
    const len = buf[o];
    if (len === 0) {
      if (!jumped) end = o + 1;
      return { name: joinName(labels), end };
    }
    if ((len & 0xc0) === 0xc0) {
      if (!jumped) end = o + 2;
      o = ((len & 0x3f) << 8) | buf[o + 1];
      jumped = true;
      continue;
    }
    labels.push(buf.subarray(o + 1, o + 1 + len).toString("utf8"));
    o += 1 + len;
  }
  throw new Error("name too long");
}

function ip6(b) {
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(b.readUInt16BE(i).toString(16));
  return groups.join(":").replace(/(^|:)0(:0)+(:|$)/, "::");
}

export function parseTxt(strings) {
  const kv = {};
  for (const s of strings) {
    const eq = s.indexOf("=");
    const key = (eq === -1 ? s : s.slice(0, eq)).toLowerCase();
    if (!key || key in kv) continue;
    kv[key] = eq === -1 ? true : s.slice(eq + 1);
  }
  return kv;
}

function decodeRecord(buf, o) {
  const { name, end } = decodeName(buf, o);
  o = end;
  const type = buf.readUInt16BE(o);
  const klass = buf.readUInt16BE(o + 2);
  const ttl = buf.readUInt32BE(o + 4);
  const rdlen = buf.readUInt16BE(o + 8);
  o += 10;
  const rd = buf.subarray(o, o + rdlen);
  let data;
  switch (type) {
    case TYPE.A:
      data = [...rd].join(".");
      break;
    case TYPE.AAAA:
      data = rd.length === 16 ? ip6(rd) : null;
      break;
    case TYPE.PTR:
      data = decodeName(buf, o).name;
      break;
    case TYPE.SRV:
      data = { priority: rd.readUInt16BE(0), weight: rd.readUInt16BE(2), port: rd.readUInt16BE(4), target: decodeName(buf, o + 6).name };
      break;
    case TYPE.TXT: {
      const strings = [];
      for (let i = 0; i < rd.length; ) {
        const l = rd[i];
        strings.push(rd.subarray(i + 1, i + 1 + l).toString("utf8"));
        i += 1 + l;
      }
      data = { strings, kv: parseTxt(strings) };
      break;
    }
    default:
      data = rd;
  }
  return { record: { name, type, typeName: TYPE_NAME[type] || String(type), class: klass & 0x7fff, flush: !!(klass & 0x8000), ttl, data }, end: o + rdlen };
}

export function decode(buf) {
  const id = buf.readUInt16BE(0);
  const flags = buf.readUInt16BE(2);
  const counts = [4, 6, 8, 10].map((i) => buf.readUInt16BE(i));
  let o = 12;
  const questions = [];
  for (let i = 0; i < counts[0]; i++) {
    const { name, end } = decodeName(buf, o);
    questions.push({ name, type: buf.readUInt16BE(end), qu: !!(buf.readUInt16BE(end + 2) & 0x8000) });
    o = end + 4;
  }
  const sections = [[], [], []];
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < counts[s + 1]; i++) {
      const { record, end } = decodeRecord(buf, o);
      sections[s].push(record);
      o = end;
    }
  }
  return { id, flags, response: !!(flags & 0x8000), questions, answers: sections[0], authorities: sections[1], additionals: sections[2] };
}

/** questions: [{ name, type, qu }] */
export function encodeQuery(questions, { id = 0 } = {}) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(questions.length, 4);
  const body = questions.map((q) => {
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(q.type, 0);
    tail.writeUInt16BE(1 | (q.qu ? 0x8000 : 0), 2);
    return Buffer.concat([encodeName(q.name), tail]);
  });
  return Buffer.concat([head, ...body]);
}

function encodeRdata(r) {
  switch (r.type) {
    case TYPE.A:
      return Buffer.from(r.data.split(".").map(Number));
    case TYPE.PTR:
      return encodeName(r.data);
    case TYPE.SRV: {
      const h = Buffer.alloc(6);
      h.writeUInt16BE(r.data.priority ?? 0, 0);
      h.writeUInt16BE(r.data.weight ?? 0, 2);
      h.writeUInt16BE(r.data.port, 4);
      return Buffer.concat([h, encodeName(r.data.target)]);
    }
    case TYPE.TXT: {
      const strings = Array.isArray(r.data) ? r.data : Object.entries(r.data).map(([k, v]) => (v === true ? k : `${k}=${v}`));
      const parts = strings.length ? strings.map((s) => Buffer.from(s, "utf8")) : [Buffer.alloc(0)];
      return Buffer.concat(parts.flatMap((b) => [Buffer.from([b.length]), b]));
    }
    default:
      return Buffer.isBuffer(r.data) ? r.data : Buffer.alloc(0);
  }
}

/** records: [{ name, type, data, ttl?, flush? }] — used by the device simulator. */
export function encodeResponse({ id = 0, answers = [], additionals = [] }) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(0x8400, 2); // response, authoritative
  head.writeUInt16BE(answers.length, 6);
  head.writeUInt16BE(additionals.length, 10);
  const enc = (r) => {
    const rd = encodeRdata(r);
    const meta = Buffer.alloc(10);
    meta.writeUInt16BE(r.type, 0);
    meta.writeUInt16BE(1 | (r.flush ? 0x8000 : 0), 2);
    meta.writeUInt32BE(r.ttl ?? 120, 4);
    meta.writeUInt16BE(rd.length, 8);
    return Buffer.concat([encodeName(r.name), meta, rd]);
  };
  return Buffer.concat([head, ...answers.map(enc), ...additionals.map(enc)]);
}

export const reverseName = (ip) => ip.split(".").reverse().join(".") + ".in-addr.arpa";
