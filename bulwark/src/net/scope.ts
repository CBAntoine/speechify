// What the network scanner may touch.
//
// Bulwark only scans what you point it at, and keeps that small:
// - private addresses (home and office networks) are fine once you confirm the network is yours;
// - public addresses need an explicit "I own these or have permission" and are capped at 256;
// - nothing larger than 4096 addresses per scan, and never multicast or broadcast addresses.

import { lookup } from "node:dns/promises";

export const MAX_ADDRESSES = 4096;
export const MAX_PUBLIC_ADDRESSES = 256;

export function parseIPv4(s: string): number | null {
  const m = s.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

export function ipToString(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

function inCidr(ip: number, base: string, bits: number): boolean {
  const b = parseIPv4(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((b & mask) >>> 0);
}

/** RFC 1918, loopback and link-local. Carrier-grade NAT (100.64/10) is not "yours". */
export function isPrivate(ip: string): boolean {
  const n = parseIPv4(ip);
  if (n === null) return false;
  return inCidr(n, "10.0.0.0", 8) || inCidr(n, "172.16.0.0", 12) || inCidr(n, "192.168.0.0", 16) || inCidr(n, "127.0.0.0", 8) || inCidr(n, "169.254.0.0", 16);
}

export function isCgnat(ip: string): boolean {
  const n = parseIPv4(ip);
  return n !== null && inCidr(n, "100.64.0.0", 10);
}

/** Never a valid scan target: this-network, multicast, reserved, broadcast. */
export function isScannable(ip: string): boolean {
  const n = parseIPv4(ip);
  if (n === null) return false;
  if (inCidr(n, "0.0.0.0", 8) || inCidr(n, "224.0.0.0", 4) || inCidr(n, "240.0.0.0", 4)) return false;
  return true;
}

export function prefixFromNetmask(mask: string): number {
  const n = parseIPv4(mask);
  if (n === null) return 32;
  let bits = 0;
  for (let i = 31; i >= 0; i--) {
    if ((n >>> i) & 1) bits++;
    else break;
  }
  return bits;
}

export function networkOf(ip: string, prefix: number): string {
  const n = parseIPv4(ip)!;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return `${ipToString((n & mask) >>> 0)}/${prefix}`;
}

/** Expands "192.168.1.0/24", "192.168.1.10-20", "192.168.1.10-192.168.1.20" or a single address. */
export function expandTarget(input: string): string[] {
  const s = input.trim();
  const cidr = s.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/);
  if (cidr) {
    const base = parseIPv4(cidr[1]);
    const bits = Number(cidr[2]);
    if (base === null || bits > 32) throw new Error(`"${s}" isn't a valid network.`);
    if (bits < 16) throw new Error(`"${s}" is too big. Scan at most a /16 (65,536 addresses) at a time, and preferably your /24.`);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    const start = (base & mask) >>> 0;
    const size = 2 ** (32 - bits);
    const out: string[] = [];
    // Skip the network and broadcast addresses of normal subnets.
    const first = bits <= 30 ? 1 : 0;
    const last = bits <= 30 ? size - 2 : size - 1;
    for (let i = first; i <= last && out.length <= MAX_ADDRESSES; i++) out.push(ipToString(start + i));
    return out;
  }
  const range = s.match(/^(\d+\.\d+\.\d+\.\d+)-(\d+(?:\.\d+\.\d+\.\d+)?)$/);
  if (range) {
    const a = parseIPv4(range[1]);
    const b = range[2].includes(".") ? parseIPv4(range[2]) : a === null ? null : ((a & 0xffffff00) >>> 0) + Number(range[2]);
    if (a === null || b === null || b < a || (!range[2].includes(".") && Number(range[2]) > 255)) throw new Error(`"${s}" isn't a valid range.`);
    if (b - a >= MAX_ADDRESSES) throw new Error(`"${s}" is more than ${MAX_ADDRESSES} addresses.`);
    const out: string[] = [];
    for (let n = a; n <= b; n++) out.push(ipToString(n));
    return out;
  }
  if (parseIPv4(s) !== null) return [s];
  throw new Error(`"${s}" isn't an IPv4 address, range or network.`);
}

export interface ResolvedTargets {
  addresses: string[];
  publicAddresses: string[];
  errors: string[];
}

/**
 * Turns what the person typed into addresses, applying the rules above.
 * Host names are looked up, then checked like any other address.
 */
export async function resolveTargets(inputs: string[], opts: { authorized: boolean }): Promise<ResolvedTargets> {
  const set = new Set<string>();
  const errors: string[] = [];
  for (const raw of inputs.flatMap((i) => i.split(/[\s,]+/)).filter(Boolean)) {
    try {
      if (/^[a-z0-9.-]+$/i.test(raw) && !/^[\d.\-/]+$/.test(raw)) {
        const found = await lookup(raw, { all: true, family: 4 });
        if (!found.length) throw new Error(`Couldn't find "${raw}".`);
        for (const f of found) set.add(f.address);
        continue;
      }
      for (const a of expandTarget(raw)) set.add(a);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    if (set.size > MAX_ADDRESSES) {
      errors.push(`That's more than ${MAX_ADDRESSES} addresses. Scan a smaller range.`);
      return { addresses: [], publicAddresses: [], errors };
    }
  }
  const addresses: string[] = [];
  const publicAddresses: string[] = [];
  for (const a of set) {
    if (!isScannable(a)) {
      errors.push(`${a} is a multicast, broadcast or reserved address; skipped.`);
      continue;
    }
    if (isPrivate(a)) addresses.push(a);
    else publicAddresses.push(a);
  }
  if (publicAddresses.length) {
    if (!opts.authorized) {
      errors.push(
        `${publicAddresses.length} address${publicAddresses.length === 1 ? " is" : "es are"} on the public internet (${publicAddresses.slice(0, 3).join(", ")}${publicAddresses.length > 3 ? "…" : ""}). ` +
          "Only scan machines you own or have written permission to test. If that's the case, confirm it (--authorized in the terminal, or the checkbox in the dashboard).",
      );
      return { addresses: addresses.sort(byIp), publicAddresses: [], errors };
    }
    if (publicAddresses.length > MAX_PUBLIC_ADDRESSES) {
      errors.push(`Bulwark scans at most ${MAX_PUBLIC_ADDRESSES} public addresses at a time.`);
      return { addresses: addresses.sort(byIp), publicAddresses: [], errors };
    }
  }
  return { addresses: [...addresses, ...publicAddresses].sort(byIp), publicAddresses, errors };
}

export function byIp(a: string, b: string): number {
  return (parseIPv4(a) ?? 0) - (parseIPv4(b) ?? 0);
}
