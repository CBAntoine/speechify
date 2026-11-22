// Finding the devices that don't answer on any common port: phones, tablets, smart plugs, game
// consoles. Each method is a question devices answer for anyone on the network (ping, "what's your
// name?"), and none of them logs in to anything.

import * as dgram from "node:dgram";
import type { Host } from "../core/types.ts";
import { mapLimit } from "../core/util.ts";
import { absorb, buildQuery, parseResponse, SERVICE_TYPES, type MdnsDevice } from "./mdns.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Loopback addresses are this computer (and every one of them answers), so they're never swept.
const notLoopback = (ip: string) => !ip.startsWith("127.");

/**
 * Ping (ICMP echo) through the system's ping command: Node can't send ICMP without root, but
 * ping can, on Linux, macOS, Windows and Android alike. Most phones answer ping and nothing else.
 */
export async function pingSweep(host: Host, addresses: string[]): Promise<Set<string>> {
  const up = new Set<string>();
  const list = addresses.filter(notLoopback);
  const ping = list.length ? await host.which(host.platform === "win32" ? "ping.exe" : "ping") : null;
  if (!ping) return up;
  const args = (ip: string) =>
    host.platform === "win32" ? ["-n", "1", "-w", "1000", ip] : host.platform === "darwin" ? ["-n", "-c", "1", "-t", "1", ip] : ["-n", "-c", "1", "-W", "1", ip];
  // Windows ping also "succeeds" when the router replies that the address is unreachable; a real reply has a TTL.
  const answered = (r: { code: number; stdout: string }) => r.code === 0 && (host.platform !== "win32" || /ttl=/i.test(r.stdout));
  // If ping isn't allowed here (no ICMP permission), stop after the first try.
  const first = await host.exec(ping, args(list[0]), { timeoutMs: 4000 });
  if (/not permitted|permission denied|socket: |must be root/i.test(first.stderr + first.stdout)) return up;
  if (answered(first)) up.add(list[0]);
  await mapLimit(list.slice(1), 24, async (ip) => {
    if (answered(await host.exec(ping, args(ip), { timeoutMs: 4000 }))) up.add(ip);
  });
  return up;
}

interface SweepOptions {
  port?: number;
  waitMs?: number;
  /** Also ask loopback addresses (tests only: on a real machine they're all this computer). */
  loopback?: boolean;
}

async function udpSweep(addresses: string[], opts: SweepOptions & { port: number; waitMs: number }, packet: Buffer, onReply: (msg: Buffer, from: string) => void): Promise<void> {
  const { port, waitMs } = opts;
  const list = opts.loopback ? addresses : addresses.filter(notLoopback);
  if (!list.length) return;
  const s = dgram.createSocket("udp4");
  const ready = await new Promise<boolean>((resolve) => {
    s.once("error", () => resolve(false));
    s.bind(0, () => resolve(true));
  });
  if (!ready) return;
  s.on("error", () => {});
  s.on("message", (msg, rinfo) => onReply(msg, rinfo.address));
  for (let i = 0; i < list.length; i++) {
    s.send(packet, port, list[i], () => {});
    if (i % 32 === 31) await sleep(20);
  }
  await sleep(waitMs);
  try {
    s.close();
  } catch {
    /* already closed */
  }
}

/**
 * Multicast DNS asked directly, one device at a time. iPhones, Macs, printers and speakers answer
 * with their name and services. Unlike the multicast question, the answers come straight back, so
 * this also works where multicast replies get filtered out (on Android, for example).
 */
export async function mdnsUnicastSweep(addresses: string[], opts: SweepOptions = {}): Promise<Map<string, MdnsDevice>> {
  const found = new Map<string, MdnsDevice>();
  const allowed = new Set(addresses);
  await udpSweep(addresses, { ...opts, port: opts.port ?? 5353, waitMs: opts.waitMs ?? 2000 }, buildQuery(SERVICE_TYPES), (msg, from) => {
    if (allowed.has(from)) absorb(found, from, parseResponse(msg));
  });
  for (const [ip, d] of found) if (!d.services.size && !d.hostnames.size && !d.instances.size) found.delete(ip);
  return found;
}

// ── NetBIOS names (Windows PCs and Samba file servers) ──

/** A NetBIOS "node status" request: what are your names? (What nbtscan and nmblookup -A send.) */
export function nbstatQuery(id = 0x4257): Buffer {
  const b = Buffer.alloc(50);
  b.writeUInt16BE(id, 0);
  b.writeUInt16BE(1, 4); // one question
  b[12] = 0x20;
  // The name "*", padded to 16 bytes and spelled out as letters (each half-byte + 'A').
  const raw = Buffer.alloc(16);
  raw[0] = 0x2a;
  for (let i = 0; i < 16; i++) {
    b[13 + i * 2] = 0x41 + (raw[i] >> 4);
    b[14 + i * 2] = 0x41 + (raw[i] & 0x0f);
  }
  b.writeUInt16BE(0x0021, 46); // NBSTAT
  b.writeUInt16BE(0x0001, 48); // IN
  return b;
}

export interface NetbiosInfo {
  name?: string;
  workgroup?: string;
  mac?: string;
}

export function parseNbstat(buf: Buffer): NetbiosInfo | null {
  if (buf.length < 12 + 2 + 10 + 1) return null;
  let pos = 12;
  if (buf[pos] === 0x20) pos += 34;
  else if ((buf[pos] & 0xc0) === 0xc0) pos += 2;
  else return null;
  if (pos + 11 > buf.length || buf.readUInt16BE(pos) !== 0x0021) return null;
  pos += 10; // type, class, TTL, data length
  const count = buf[pos++];
  const out: NetbiosInfo = {};
  for (let i = 0; i < count && pos + 18 <= buf.length; i++, pos += 18) {
    const name = buf.toString("latin1", pos, pos + 15).replace(/[\x00\s]+$/, "");
    const suffix = buf[pos + 15];
    const group = (buf.readUInt16BE(pos + 16) & 0x8000) !== 0;
    if (suffix === 0x00 && !group && !out.name && name) out.name = name;
    if (suffix === 0x00 && group && !out.workgroup && name) out.workgroup = name;
  }
  if (pos + 6 <= buf.length) {
    const mac = [...buf.subarray(pos, pos + 6)].map((x) => x.toString(16).padStart(2, "0")).join(":");
    if (mac !== "00:00:00:00:00:00") out.mac = mac;
  }
  return out.name || out.workgroup ? out : null;
}

export async function nbnsSweep(addresses: string[], opts: SweepOptions = {}): Promise<Map<string, NetbiosInfo>> {
  const found = new Map<string, NetbiosInfo>();
  const allowed = new Set(addresses);
  await udpSweep(addresses, { ...opts, port: opts.port ?? 137, waitMs: opts.waitMs ?? 2000 }, nbstatQuery(), (msg, from) => {
    const info = allowed.has(from) ? parseNbstat(msg) : null;
    if (info) found.set(from, info);
  });
  return found;
}

/** Adds what one multicast DNS pass found to another's results. */
export function mergeMdns(into: Map<string, MdnsDevice>, more: Map<string, MdnsDevice>): Map<string, MdnsDevice> {
  for (const [ip, d] of more) {
    const cur = into.get(ip);
    if (!cur) {
      into.set(ip, d);
      continue;
    }
    for (const k of ["hostnames", "instances", "services"] as const) for (const v of d[k]) cur[k].add(v);
    for (const [k, v] of d.txt) if (!cur.txt.has(k)) cur.txt.set(k, v);
  }
  return into;
}
