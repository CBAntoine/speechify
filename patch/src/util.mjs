// Small shared helpers: timing, concurrency, IPv4 math, MAC addresses, colours, text.

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Resolve with the promise's value, or with `fallback` once `ms` pass. Never rejects. */
export function settleWithin(promise, ms, fallback = null) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((r) => (timer = setTimeout(() => r(fallback), ms))),
  ]).finally(() => clearTimeout(timer));
}

/** Run `fn` over `items` with at most `limit` in flight. Results keep input order. */
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        out[i] = undefined;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ── IPv4 ────────────────────────────────────────────────────

export function ipToInt(ip) {
  const p = String(ip).split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return NaN;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export const intToIp = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");

export const isIPv4 = (s) => typeof s === "string" && !Number.isNaN(ipToInt(s));

export function prefixFromNetmask(mask) {
  const n = ipToInt(mask);
  let bits = 0;
  for (let i = 31; i >= 0; i--) if ((n >>> i) & 1) bits++;
  return bits;
}

export function parseCidr(cidr) {
  const [ip, p] = String(cidr).split("/");
  const prefix = p === undefined ? 32 : Number(p);
  const base = ipToInt(ip);
  if (Number.isNaN(base) || !(prefix >= 0 && prefix <= 32)) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return { prefix, network, broadcast, mask, cidr: `${intToIp(network)}/${prefix}` };
}

export function inCidr(ip, cidr) {
  const c = typeof cidr === "string" ? parseCidr(cidr) : cidr;
  const n = ipToInt(ip);
  return !!c && !Number.isNaN(n) && ((n & c.mask) >>> 0) === c.network;
}

/** Usable host addresses of a subnet. Large subnets are trimmed to the `max` addresses nearest `around`. */
export function subnetHosts(cidr, { max = 1024, around } = {}) {
  const c = parseCidr(cidr);
  if (!c) return [];
  let first = c.prefix >= 31 ? c.network : c.network + 1;
  let last = c.prefix >= 31 ? c.broadcast : c.broadcast - 1;
  if (last - first + 1 > max) {
    const center = around ? ipToInt(around) : first;
    first = Math.max(first, center - Math.floor(max / 2));
    last = Math.min(last, first + max - 1);
  }
  const out = [];
  for (let n = first; n <= last; n++) out.push(intToIp(n >>> 0));
  return out;
}

const PRIVATE_RANGES = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "169.254.0.0/16", "100.64.0.0/10", "127.0.0.0/8"].map(parseCidr);

/** True for addresses that can only exist inside a home or carrier network (RFC 1918, link-local, CGNAT, loopback). */
export const isPrivateIPv4 = (ip) => PRIVATE_RANGES.some((r) => inCidr(ip, r));
export const isCgnat = (ip) => inCidr(ip, "100.64.0.0/10");

export const sortIps = (a, b) => ipToInt(a) - ipToInt(b);

// ── MAC addresses ───────────────────────────────────────────

/** "0:17:88:a:b:c", "00-17-88-0A-0B-0C" → "00:17:88:0a:0b:0c". Returns null for empty/broadcast/invalid. */
export function normalizeMac(mac) {
  if (!mac) return null;
  const parts = String(mac).trim().toLowerCase().split(/[:\-.]/);
  let hex;
  if (parts.length === 6) hex = parts.map((p) => p.padStart(2, "0"));
  else if (parts.length === 3 && parts.every((p) => p.length === 4)) hex = parts.join("").match(/../g);
  else if (parts.length === 1 && /^[0-9a-f]{12}$/.test(parts[0])) hex = parts[0].match(/../g);
  else return null;
  if (!hex || hex.some((h) => !/^[0-9a-f]{2}$/.test(h))) return null;
  const m = hex.join(":");
  if (m === "00:00:00:00:00:00" || m === "ff:ff:ff:ff:ff:ff") return null;
  return m;
}

/** Phones, tablets and laptops use per-network random ("private") addresses: the locally-administered bit is set. */
export function isRandomizedMac(mac) {
  const m = normalizeMac(mac);
  return !!m && (parseInt(m.slice(0, 2), 16) & 0b10) !== 0;
}

export const macToBytes = (mac) => Buffer.from(normalizeMac(mac).split(":").map((h) => parseInt(h, 16)));

// ── Text ────────────────────────────────────────────────────

export const normalizeText = (s) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export const slug = (s) => normalizeText(s).replace(/ /g, "-").slice(0, 48) || "device";

/** "Living-Room-TV.lan" → "Living Room TV", "DESKTOP-4F2K9.localdomain" → "DESKTOP-4F2K9" */
export function prettyHostname(h) {
  if (!h) return null;
  let s = String(h).replace(/\.$/, "");
  s = s.replace(/\.(local|lan|home|localdomain|home\.arpa|domain|router|gateway|attlocal\.net|fritz\.box|station|internal)$/i, "");
  s = s.split(".")[0];
  if (!s || /^\d+$/.test(s)) return null;
  if (/^[A-Z0-9]+-[A-Z0-9]{4,}$/.test(s)) return s; // Windows-style machine name
  return s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Best fuzzy match of `query` among `options` (strings or {name}). Returns the option or null. */
export function fuzzyPick(query, options, key = (o) => (typeof o === "string" ? o : o.name)) {
  const q = normalizeText(query);
  if (!q) return null;
  let best = null;
  let bestScore = 0;
  for (const o of options) {
    const n = normalizeText(key(o));
    if (!n) continue;
    let score = 0;
    if (n === q) score = 100;
    else if (n.startsWith(q) || q.startsWith(n)) score = 80 - Math.abs(n.length - q.length) / 10;
    else if (n.includes(q) || q.includes(n)) score = 65 - Math.abs(n.length - q.length) / 10;
    else {
      const qt = q.split(" ");
      const nt = n.split(" ");
      const hits = qt.filter((t) => nt.some((x) => x === t || (t.length > 3 && levenshtein(t, x) <= 1))).length;
      if (hits) score = 40 * (hits / Math.max(qt.length, nt.length));
      else if (q.length > 3 && levenshtein(q, n) <= 2) score = 45;
    }
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return bestScore >= 30 ? best : null;
}

// ── Colours ─────────────────────────────────────────────────

const NAMED = {
  red: [255, 0, 0], orange: [255, 120, 0], amber: [255, 170, 0], yellow: [255, 220, 0], gold: [255, 190, 40],
  lime: [160, 255, 0], green: [0, 220, 60], mint: [60, 255, 170], teal: [0, 180, 160], cyan: [0, 230, 255],
  turquoise: [64, 224, 208], aqua: [0, 255, 255], blue: [0, 70, 255], "sky blue": [90, 180, 255], navy: [0, 30, 140],
  indigo: [75, 0, 200], purple: [150, 0, 255], violet: [180, 80, 255], lavender: [190, 160, 255], magenta: [255, 0, 200],
  pink: [255, 90, 170], "hot pink": [255, 30, 140], rose: [255, 60, 110], coral: [255, 110, 80], salmon: [255, 140, 110],
  peach: [255, 180, 130], white: [255, 255, 255], "warm white": [255, 200, 140], "cool white": [220, 235, 255],
};

/** Parse "red", "#ff8800", "ff8800", "rgb(1,2,3)" or "1,2,3" → [r,g,b] or null. */
export function parseColor(value) {
  if (Array.isArray(value) && value.length === 3) return value.map((n) => clamp(Math.round(Number(n)) || 0, 0, 255));
  const s = String(value ?? "").trim().toLowerCase();
  if (Object.hasOwn(NAMED, s)) return NAMED[s];
  const named = Object.keys(NAMED).sort((a, b) => b.length - a.length).find((k) => s.includes(k));
  let m = s.match(/^#?([0-9a-f]{6})$/);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = s.match(/^#?([0-9a-f]{3})$/);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = s.match(/(\d{1,3})\D+(\d{1,3})\D+(\d{1,3})/);
  if (m) return [m[1], m[2], m[3]].map((n) => clamp(Number(n), 0, 255));
  return named ? NAMED[named] : null;
}

export const rgbToHex = ([r, g, b]) => "#" + [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("");

/** [r,g,b] 0-255 → { h: 0-360, s: 0-1, v: 0-1 } */
export function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((n) => Math.round((n + m) * 255));
}

/** "warm", "cool", "daylight", "3000K", "3000" → kelvin. */
export function parseKelvin(value) {
  const s = String(value ?? "").trim().toLowerCase();
  const words = {
    candle: 2000, candlelight: 2000, "extra warm": 2200, warmest: 2200, cozy: 2500, cosy: 2500, warm: 2700,
    "warm white": 2700, soft: 2700, "soft white": 2700, relax: 2700, neutral: 4000, white: 4000, "natural": 4000,
    read: 4000, reading: 4000, cool: 5000, "cool white": 5000, bright: 5000, focus: 5000, concentrate: 5000,
    daylight: 6500, coolest: 6500, energize: 6500,
  };
  if (Object.hasOwn(words, s)) return words[s];
  const k = Object.keys(words).sort((a, b) => b.length - a.length).find((w) => s.includes(w));
  const m = s.match(/(\d{3,5})/);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1000 && n <= 10000) return n;
    if (n >= 100 && n <= 600) return Math.round(1e6 / n); // mireds
  }
  return k ? words[k] : null;
}

export const kelvinToMired = (k) => Math.round(1e6 / k);
export const miredToKelvin = (m) => Math.round(1e6 / m);

/** Percent from "50", "50%", "half", "max", "dim"; relative words return { delta }. */
export function parsePercent(value, current) {
  const s = String(value ?? "").trim().toLowerCase();
  const words = { max: 100, maximum: 100, full: 100, all: 100, bright: 100, half: 50, medium: 50, mid: 50, low: 20, dim: 20, minimum: 1, min: 1, off: 0, quarter: 25 };
  if (Object.hasOwn(words, s)) return words[s];
  if (/^(up|higher|louder|brighter|more|increase|raise)/.test(s)) return clamp((current ?? 50) + 15, 0, 100);
  if (/^(down|lower|quieter|softer|dimmer|less|decrease|reduce)/.test(s)) return clamp((current ?? 50) - 15, 0, 100);
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = Number(m[0]);
  if (!s.includes("%") && n > 0 && n <= 1 && m[0].includes(".")) n *= 100; // 0.5 → 50%
  return clamp(Math.round(n), 0, 100);
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec)) return null;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d} day${d === 1 ? "" : "s"}${h ? `, ${h} hour${h === 1 ? "" : "s"}` : ""}`;
  if (h) return `${h} hour${h === 1 ? "" : "s"}${m ? `, ${m} min` : ""}`;
  return `${m} min`;
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

export function safeJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
