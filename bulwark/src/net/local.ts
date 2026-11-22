// This device's own networks: interfaces, the default gateway and the ARP table.

import * as os from "node:os";
import type { Host } from "../core/types.ts";
import { isPrivate, networkOf, prefixFromNetmask } from "./scope.ts";

export interface LocalNet {
  iface: string;
  address: string;
  prefix: number;
  mac: string;
  /** The network as configured, e.g. 192.168.1.0/24. */
  cidr: string;
  /** What gets scanned by default: the configured network, cut down to the /24 around this device. */
  scanCidr: string;
  private: boolean;
}

// Container bridges, VPNs and virtual adapters aren't the home network. Neither is a phone's mobile
// data connection: those addresses are private too, but they belong to the carrier, and the
// "neighbours" there are other customers' phones.
const VIRTUAL = /^(docker|br-|veth|virbr|vmnet|vboxnet|lxc|lxd|cni|flannel|cali|tun|tap|utun|wg|tailscale|zt|ham|llw|awdl|bridge|anpi|gif|stf|vEthernet|VirtualBox|VMware|Hyper-V|Loopback|rmnet|r_rmnet|ccmni|pdp|seth|v4-|clat|dummy|ifb|ip6tnl|sit|tunl|epdg|p2p|ppp|wwan|usb|ncm|rndis|aware|nan)/i;

export function localNetworks(ifaces = os.networkInterfaces()): LocalNet[] {
  const out: LocalNet[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;
      const prefix = prefixFromNetmask(a.netmask);
      out.push({
        iface: name,
        address: a.address,
        prefix,
        mac: a.mac,
        cidr: networkOf(a.address, prefix),
        scanCidr: networkOf(a.address, Math.max(prefix, 24)),
        private: isPrivate(a.address),
      });
    }
  }
  return out;
}

export function allLocalAddresses(): Set<string> {
  const set = new Set<string>(["127.0.0.1"]);
  for (const addrs of Object.values(os.networkInterfaces())) for (const a of addrs ?? []) if (a.family === "IPv4") set.add(a.address);
  return set;
}

export function parseProcRoute(text: string): string | null {
  for (const line of text.split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 3 || f[1] !== "00000000") continue;
    const g = parseInt(f[2], 16);
    if (!g) continue;
    return [g & 255, (g >>> 8) & 255, (g >>> 16) & 255, (g >>> 24) & 255].join(".");
  }
  return null;
}

export function parseIpRoute(text: string): string | null {
  return text.match(/^default\s+via\s+(\d+\.\d+\.\d+\.\d+)/m)?.[1] ?? text.match(/\bvia\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export async function defaultGateway(host: Host): Promise<string | null> {
  if (host.platform === "linux" || host.platform === "android") {
    const text = await host.readFile("/proc/net/route");
    const gw = text ? parseProcRoute(text) : null;
    if (gw) return gw;
    // Android hides /proc/net/route from apps; `ip route` still answers.
    for (const args of [["route", "show", "default"], ["route", "get", "8.8.8.8"]]) {
      const r = await host.exec("ip", args);
      const found = r.code === 0 ? parseIpRoute(r.stdout) : null;
      if (found) return found;
    }
    return null;
  }
  if (host.platform === "darwin") {
    const r = await host.exec("route", ["-n", "get", "default"]);
    return r.stdout.match(/gateway:\s*(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null;
  }
  const r = await host.exec("route", ["print", "-4", "0.0.0.0"]);
  return r.stdout.match(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/m)?.[1] ?? null;
}

const normMac = (m: string) =>
  m
    .toLowerCase()
    .replace(/-/g, ":")
    .split(":")
    .map((p) => p.padStart(2, "0"))
    .join(":");

export function parseArp(platform: string, text: string): Map<string, string> {
  const out = new Map<string, string>();
  if (platform === "linux") {
    for (const line of text.split("\n").slice(1)) {
      const f = line.trim().split(/\s+/);
      // Flags 0x2 means the entry is complete.
      if (f.length >= 4 && f[2] !== "0x0" && f[3] !== "00:00:00:00:00:00") out.set(f[0], normMac(f[3]));
    }
    return out;
  }
  if (platform === "darwin") {
    for (const m of text.matchAll(/\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]{11,17})/gi)) out.set(m[1], normMac(m[2]));
    return out;
  }
  for (const m of text.matchAll(/^\s*(\d+\.\d+\.\d+\.\d+)\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})\s+(\w+)/gim)) {
    if (m[2].toLowerCase() !== "ff-ff-ff-ff-ff-ff") out.set(m[1], normMac(m[2]));
  }
  return out;
}

export async function arpTable(host: Host): Promise<Map<string, string>> {
  // Android 10+ hides the ARP table from apps, so this is often empty there; the TCP sweep still works.
  if (host.platform === "linux" || host.platform === "android") return parseArp("linux", (await host.readFile("/proc/net/arp")) ?? "");
  const r = await host.exec("arp", host.platform === "darwin" ? ["-an"] : ["-a"]);
  return parseArp(host.platform, r.stdout);
}

/** Phones and laptops make up MAC addresses for privacy; those set the "locally administered" bit. */
export function isRandomMac(mac: string): boolean {
  const first = parseInt(mac.slice(0, 2), 16);
  return Number.isFinite(first) && (first & 0x02) === 0x02;
}
