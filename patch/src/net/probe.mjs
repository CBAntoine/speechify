// Finding hosts and their open services: TCP port checks, NetBIOS name queries (which also make the
// OS fill its ARP table for every address), latency tests and Wake-on-LAN.
import net from "node:net";
import dgram from "node:dgram";
import crypto from "node:crypto";
import { run } from "./interfaces.mjs";
import { macToBytes, mapLimit, normalizeMac, sleep } from "../util.mjs";

/** One TCP connect. A refusal still proves the host exists (it answered with RST). */
export function tcpProbe(ip, port, timeout = 800) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const sock = net.connect({ host: ip, port });
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve({ port, ms: Number(process.hrtime.bigint() - start) / 1e6, ...r });
    };
    sock.setTimeout(timeout, () => finish({ open: false, alive: false, code: "TIMEOUT" }));
    sock.once("connect", () => finish({ open: true, alive: true }));
    sock.once("error", (err) => finish({ open: false, alive: err.code === "ECONNREFUSED" || err.code === "ECONNRESET", code: err.code }));
  });
}

export async function probePorts(ip, ports, { timeout = 800, concurrency = 32 } = {}) {
  const results = await mapLimit(ports, concurrency, (p) => tcpProbe(ip, p, timeout));
  const open = results.filter((r) => r?.open).map((r) => r.port).sort((a, b) => a - b);
  const replies = results.filter((r) => r?.alive);
  return { ip, alive: replies.length > 0, open, rtt: replies.length ? Math.min(...replies.map((r) => r.ms)) : null };
}

/** Which of `ips` answer on any of `ports`. Calls onAlive as hosts turn up. */
export async function tcpSweep(ips, { ports = [80, 443, 22, 62078], timeout = 700, concurrency = 192, onAlive } = {}) {
  const found = new Map();
  // Port-major order: once a host has answered on one port, its remaining probes are skipped.
  const jobs = ports.flatMap((port) => ips.map((ip) => ({ ip, port })));
  await mapLimit(jobs, concurrency, async ({ ip, port }) => {
    if (found.has(ip)) return;
    const r = await tcpProbe(ip, port, timeout);
    if (!r.alive || found.has(ip)) return;
    found.set(ip, { ip, open: r.open ? [port] : [] });
    onAlive?.(ip);
  });
  return found;
}

// ── NetBIOS name service (UDP 137) ─────────────────────────

const NB_WILDCARD = Buffer.from([0x20, ..."CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"].map((c) => (typeof c === "number" ? c : c.charCodeAt(0))).concat([0x00]));

export function encodeNbstatQuery(id = crypto.randomInt(0, 0xffff)) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(0x0000, 2); // flags: query
  head.writeUInt16BE(1, 4); // qdcount
  const tail = Buffer.from([0x00, 0x21, 0x00, 0x01]); // NBSTAT, IN
  return Buffer.concat([head, NB_WILDCARD, tail]);
}

export function parseNbstatResponse(buf) {
  try {
    if (buf.length < 57 || !(buf[2] & 0x80)) return null;
    let o = 12;
    if ((buf[o] & 0xc0) === 0xc0) o += 2;
    else {
      while (o < buf.length && buf[o] !== 0) o += buf[o] + 1;
      o += 1;
    }
    const type = buf.readUInt16BE(o);
    if (type !== 0x21) return null;
    o += 2 + 2 + 4 + 2; // type, class, ttl, rdlength
    const count = buf[o++];
    const names = [];
    for (let i = 0; i < count && o + 18 <= buf.length; i++, o += 18) {
      const name = buf.subarray(o, o + 15).toString("latin1").replace(/[\0 ]+$/, "");
      names.push({ name, suffix: buf[o + 15], group: (buf.readUInt16BE(o + 16) & 0x8000) !== 0 });
    }
    const mac = o + 6 <= buf.length ? normalizeMac([...buf.subarray(o, o + 6)].map((b) => b.toString(16).padStart(2, "0")).join(":")) : null;
    const machine = names.find((n) => n.suffix === 0x00 && !n.group)?.name || names.find((n) => n.suffix === 0x20)?.name || null;
    const workgroup = names.find((n) => n.suffix === 0x00 && n.group)?.name || null;
    return { name: machine, workgroup, mac, names };
  } catch {
    return null;
  }
}

/**
 * Sends a NetBIOS status query to every address. Windows PCs and NAS boxes answer with their
 * computer name; every live host is also added to the ARP table as a side effect.
 */
export function nbstatSweep(ips, { timeout = 1800, bindAddress } = {}) {
  return new Promise((resolve) => {
    const names = new Map();
    const sock = dgram.createSocket("udp4");
    const finish = () => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(names);
    };
    sock.on("error", finish);
    sock.on("message", (msg, rinfo) => {
      const r = parseNbstatResponse(msg);
      if (r) names.set(rinfo.address, r);
    });
    sock.bind(0, bindAddress, async () => {
      const q = encodeNbstatQuery();
      for (let i = 0; i < ips.length; i++) {
        sock.send(q, 137, ips[i], () => {});
        if (i % 64 === 63) await sleep(15);
      }
      setTimeout(finish, timeout);
    });
  });
}

// ── Latency ─────────────────────────────────────────────────

export function parsePingTimes(text) {
  return [...String(text).matchAll(/time[=<]\s*([\d.]+)\s*ms/gi)].map((m) => Number(m[1]));
}

function stats(times, sent, method) {
  const received = times.length;
  const avg = received ? times.reduce((a, b) => a + b, 0) / received : null;
  const jitter = received > 1 ? times.slice(1).reduce((a, t, i) => a + Math.abs(t - times[i]), 0) / (received - 1) : 0;
  const r = (n) => (n == null ? null : Math.round(n * 10) / 10);
  return { method, sent, received, loss: sent ? Math.round(((sent - received) / sent) * 100) : 100, min: r(received ? Math.min(...times) : null), avg: r(avg), max: r(received ? Math.max(...times) : null), jitter: r(jitter) };
}

/**
 * Round-trip stats. Uses the system ping, or timed TCP handshakes when ping is missing, blocked,
 * or `preferTcp` is set (much faster for checking many devices).
 */
export async function ping(ip, { count = 5, ports = [], preferTcp = false } = {}) {
  if (!preferTcp || !ports.length) {
    const args =
      process.platform === "win32" ? ["-n", String(count), "-w", "1000", ip] : process.platform === "darwin" ? ["-c", String(count), "-W", "1000", ip] : ["-c", String(count), "-W", "1", "-i", "0.2", ip];
    const out = await run("ping", args, count * 1500 + 2000);
    if (out) {
      const times = parsePingTimes(out);
      if (times.length || /100(\.0)?% (packet )?loss|\(100% loss\)/i.test(out)) {
        const s = stats(times, count, "icmp");
        if (s.received || !ports.length) return s;
      }
    }
  }
  const candidates = [...new Set([...ports, 80, 443, 22, 7000, 62078, 8080, 9])].slice(0, 6);
  let port = null;
  for (const p of candidates) {
    const r = await tcpProbe(ip, p, 900);
    if (r.alive) {
      port = p;
      break;
    }
  }
  if (port == null) return stats([], count, "tcp");
  const times = [];
  for (let i = 0; i < count; i++) {
    const r = await tcpProbe(ip, port, 1000);
    if (r.alive) times.push(r.ms);
    await sleep(120);
  }
  return { ...stats(times, count, "tcp"), port };
}

// ── Wake-on-LAN ─────────────────────────────────────────────

export function magicPacket(mac) {
  const m = macToBytes(mac);
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(m)]);
}

export function wakeOnLan(mac, { broadcasts = ["255.255.255.255"], ip } = {}) {
  const pkt = magicPacket(mac);
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    sock.on("error", (e) => {
      sock.close();
      reject(e);
    });
    sock.bind(0, () => {
      sock.setBroadcast(true);
      const targets = [...new Set([...broadcasts, ...(ip ? [ip] : [])])];
      let pending = targets.length * 2;
      for (const t of targets)
        for (const port of [9, 7])
          sock.send(pkt, port, t, () => {
            if (--pending === 0) {
              sock.close();
              resolve(targets);
            }
          });
    });
  });
}
