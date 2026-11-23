// The ARP (neighbour) table: every device this computer has exchanged packets with on the local
// network, with its hardware address. Readable without admin rights on all three platforms.
import fs from "node:fs/promises";
import { run } from "./interfaces.mjs";
import { isIPv4, normalizeMac } from "../util.mjs";

export function parseProcArp(text) {
  const out = [];
  for (const line of String(text).split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 6 || !isIPv4(f[0])) continue;
    const flags = parseInt(f[2], 16);
    const mac = normalizeMac(f[3]);
    if (!mac || !(flags & 0x2)) continue; // 0x2 = ATF_COM (complete)
    out.push({ ip: f[0], mac, iface: f[5] });
  }
  return out;
}

export function parseIpNeigh(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(/^([\d.]+)\s+dev\s+(\S+)\s+lladdr\s+([0-9a-f:]+)\s+(\S+)/i);
    if (m && !/FAILED|INCOMPLETE/i.test(m[4])) {
      const mac = normalizeMac(m[3]);
      if (mac) out.push({ ip: m[1], mac, iface: m[2] });
    }
  }
  return out;
}

/** macOS / BSD `arp -a -n`: "? (192.168.1.1) at 0:11:22:33:44:55 on en0 ifscope [ethernet]" */
export function parseBsdArp(text) {
  const out = [];
  for (const m of String(text).matchAll(/\(([\d.]+)\)\s+at\s+([0-9a-f:]+)\s+on\s+(\S+)/gi)) {
    const mac = normalizeMac(m[2]);
    if (mac) out.push({ ip: m[1], mac, iface: m[3] });
  }
  return out;
}

/** Windows `arp -a`: "  192.168.1.1           a0-b1-c2-d3-e4-f5     dynamic" under "Interface: 192.168.1.23 --- 0x7" */
export function parseWindowsArp(text) {
  const out = [];
  let iface = null;
  for (const line of String(text).split(/\r?\n/)) {
    const head = line.match(/^Interface:\s*([\d.]+)/i);
    if (head) {
      iface = head[1];
      continue;
    }
    const m = line.match(/^\s*([\d.]+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\w+)/i);
    if (!m) continue;
    const mac = normalizeMac(m[2]); // null for ff-ff-ff-ff-ff-ff (broadcast)
    if (!mac || mac.startsWith("01:00:5e") || /^(22[4-9]|23\d|255)\./.test(m[1])) continue; // multicast
    if (/static/i.test(m[3]) && m[1].endsWith(".255")) continue; // subnet broadcast
    out.push({ ip: m[1], mac, iface });
  }
  return out;
}

export async function readArpTable() {
  try {
    if (process.platform === "linux") {
      const proc = await fs.readFile("/proc/net/arp", "utf8").catch(() => null);
      if (proc) return parseProcArp(proc);
      return parseIpNeigh((await run("ip", ["neigh"])) || "");
    }
    if (process.platform === "darwin" || process.platform.endsWith("bsd")) return parseBsdArp((await run("arp", ["-a", "-n"], 8000)) || "");
    if (process.platform === "win32") return parseWindowsArp((await run("arp", ["-a"], 8000)) || "");
  } catch {
    /* ignore */
  }
  return [];
}
