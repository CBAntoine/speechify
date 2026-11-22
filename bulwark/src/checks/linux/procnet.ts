// Reads listening sockets straight from /proc, so no extra tools are needed.

import { memo } from "../../core/cache.ts";
import type { Host } from "../../core/types.ts";

export interface Listener {
  proto: "tcp" | "udp";
  family: 4 | 6;
  address: string;
  port: number;
  inode: number;
  uid: number;
  pid?: number;
  process?: string;
  unit?: string;
}

function hexToIPv4(hex: string): string {
  // /proc stores the address as a little-endian 32-bit word.
  const n = parseInt(hex, 16);
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff].join(".");
}

function hexToIPv6(hex: string): string {
  const words: string[] = [];
  for (let i = 0; i < 4; i++) {
    const w = hex.slice(i * 8, i * 8 + 8);
    // Each 32-bit word is little-endian.
    const bytes = [w.slice(6, 8), w.slice(4, 6), w.slice(2, 4), w.slice(0, 2)].join("");
    words.push(bytes.slice(0, 4), bytes.slice(4, 8));
  }
  const groups = words.map((g) => parseInt(g, 16).toString(16));
  // IPv4-mapped (::ffff:a.b.c.d)
  if (groups.slice(0, 5).every((g) => g === "0") && groups[5] === "ffff") {
    const a = parseInt(words[6], 16);
    const b = parseInt(words[7], 16);
    return `::ffff:${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`;
  }
  // Compress the longest run of zeros.
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== "0") {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === "0") j++;
    if (j - i > bestLen && j - i > 1) {
      bestStart = i;
      bestLen = j - i;
    }
    i = j;
  }
  if (bestStart === -1) return groups.join(":");
  const left = groups.slice(0, bestStart).join(":");
  const right = groups.slice(bestStart + bestLen).join(":");
  return `${left}::${right}`;
}

export function parseProcNet(text: string, proto: "tcp" | "udp", family: 4 | 6): Listener[] {
  const out: Listener[] = [];
  for (const line of text.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 10) continue;
    const [addrHex, portHex] = f[1].split(":");
    const state = f[3];
    // TCP: 0A = LISTEN. UDP: 07 = unconnected (bound and waiting).
    if (proto === "tcp" && state !== "0A") continue;
    if (proto === "udp" && state !== "07") continue;
    if (proto === "udp" && f[2] && !/^0+:0000$/.test(f[2])) continue;
    out.push({
      proto,
      family,
      address: family === 4 ? hexToIPv4(addrHex) : hexToIPv6(addrHex),
      port: parseInt(portHex, 16),
      uid: Number(f[7]),
      inode: Number(f[9]),
    });
  }
  return out;
}

export function isLoopback(address: string): boolean {
  return address.startsWith("127.") || address === "::1" || address.startsWith("::ffff:127.");
}

export function isWildcard(address: string): boolean {
  return address === "0.0.0.0" || address === "::";
}

/** Reachable from other devices (ignoring firewalls): bound to all interfaces or a non-loopback address. */
export function isExposed(l: { address: string }): boolean {
  return !isLoopback(l.address);
}

export function unitFromCgroup(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const path = line.split(":").slice(2).join(":");
    const m = path.match(/\/([^/]+\.(?:service|socket))(?:\/|$)/);
    if (m) return m[1];
  }
  return undefined;
}

/** All listening TCP and UDP sockets, with the owning process where we can see it (root sees all). */
export function linuxListeners(host: Host): Promise<Listener[]> {
  return memo(host, "listeners", 5000, () => readListeners(host));
}

async function readListeners(host: Host): Promise<Listener[]> {
  const files: [string, "tcp" | "udp", 4 | 6][] = [
    ["/proc/net/tcp", "tcp", 4],
    ["/proc/net/tcp6", "tcp", 6],
    ["/proc/net/udp", "udp", 4],
    ["/proc/net/udp6", "udp", 6],
  ];
  const listeners: Listener[] = [];
  for (const [file, proto, family] of files) {
    const text = await host.readFile(file);
    if (text) listeners.push(...parseProcNet(text, proto, family));
  }
  const byInode = new Map<number, Listener[]>();
  for (const l of listeners) {
    if (!l.inode) continue;
    const list = byInode.get(l.inode) ?? [];
    list.push(l);
    byInode.set(l.inode, list);
  }
  const pids = ((await host.readDir("/proc")) ?? []).filter((d) => /^\d+$/.test(d));
  for (const pid of pids) {
    if (byInode.size === 0) break;
    const fds = await host.readDir(`/proc/${pid}/fd`);
    if (!fds) continue;
    let owned: Listener[] | null = null;
    for (const fd of fds) {
      const link = await host.readlink(`/proc/${pid}/fd/${fd}`);
      const m = link?.match(/^socket:\[(\d+)\]$/);
      if (!m) continue;
      const hits = byInode.get(Number(m[1]));
      if (!hits) continue;
      owned = owned ?? [];
      owned.push(...hits);
      byInode.delete(Number(m[1]));
    }
    if (!owned) continue;
    const comm = (await host.readFile(`/proc/${pid}/comm`))?.trim();
    const cgroup = await host.readFile(`/proc/${pid}/cgroup`);
    const unit = cgroup ? unitFromCgroup(cgroup) : undefined;
    for (const l of owned) {
      l.pid = Number(pid);
      l.process = comm;
      l.unit = unit;
    }
  }
  // The same socket can show up in tcp and tcp6 (dual-stack); keep one per inode.
  const seen = new Set<string>();
  return listeners.filter((l) => {
    const key = `${l.proto}:${l.inode}:${l.address}:${l.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Processes by name, from /proc. */
export async function linuxProcesses(host: Host): Promise<{ pid: number; comm: string; cmdline: string }[]> {
  const out: { pid: number; comm: string; cmdline: string }[] = [];
  for (const pid of ((await host.readDir("/proc")) ?? []).filter((d) => /^\d+$/.test(d))) {
    const comm = (await host.readFile(`/proc/${pid}/comm`))?.trim();
    if (!comm) continue;
    const cmdline = ((await host.readFile(`/proc/${pid}/cmdline`)) ?? "").split("\0").join(" ").trim();
    out.push({ pid: Number(pid), comm, cmdline });
  }
  return out;
}
