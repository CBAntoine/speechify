// The devices Bulwark has seen on each network, so it can point out new ones and remember the names
// people give them. The first scan of a network is the baseline: everything on it counts as known.
// A device that turns up later is flagged until someone says it's theirs.

import { score, sortFindings } from "../core/score.ts";
import type { Finding, NetDevice, NetworkScan, Scan } from "../core/types.ts";

export interface KnownDevice {
  key: string;
  firstSeen: string;
  lastSeen: string;
  lastIp: string;
  name?: string;
  kind?: string;
  vendor?: string;
  /** Seen in the network's first scan. */
  baseline?: boolean;
  /** The name the person gave it. */
  label?: string;
  /** The person said it's theirs (or a guest's they know). */
  mine?: boolean;
}

export type Inventory = Record<string, KnownDevice[]>;

/** Phones keep the same private address on a network, so the hardware address is a good key. */
export function deviceKey(d: Pick<NetDevice, "mac" | "name" | "ip">): string {
  if (d.mac) return `mac:${d.mac.toLowerCase()}`;
  if (d.name) return `name:${d.name.toLowerCase()}`;
  return `ip:${d.ip}`;
}

/** Which network this is: the router's hardware address when known, else what was scanned. */
export function networkId(net: NetworkScan): string {
  const gw = net.devices.find((d) => d.isGateway);
  return gw?.mac ? `router:${gw.mac.toLowerCase()}` : `targets:${[...net.targets].sort().join(",")}`;
}

function newDeviceFinding(d: NetDevice, firstSeen: string): Finding {
  const what = d.label ?? d.name ?? (d.vendor ? `A ${d.vendor} device` : `A device (${d.kind.toLowerCase()})`);
  const when = new Date(firstSeen).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });
  return {
    id: `inventory.new-device@${d.ip}`,
    checkId: "inventory.new-device",
    target: d.ip,
    title: "New device on your network",
    category: "Network device",
    severity: "low",
    status: "fail",
    confidence: "confirmed",
    summary: `${what} at ${d.ip}${d.vendor && !what.includes(d.vendor) ? ` (made by ${d.vendor})` : ""} first showed up on ${when}. If you don't recognise it, someone else may be on your Wi-Fi.`,
    why: "Anyone who has your Wi-Fi password can join and reach every device on it: shared folders, printers, cameras, smart plugs. A device you don't recognise is the first sign of that.",
    evidence: [d.mac ? `hardware address ${d.mac}${d.randomMac ? " (a private address, as phones and laptops use)" : ""}` : `address ${d.ip}`],
    remedy: {
      steps: [
        "If it's yours, or a guest's you know, mark it as known: in the dashboard, Network → the device → \"It's mine\", or bulwark devices name " + d.ip + " \"its name\".",
        "If you don't recognise it, change your Wi-Fi password in the router's settings, and look for it in the router's list of connected devices.",
        "Give visitors your router's guest network instead of the main one.",
      ],
    },
    references: [],
    cves: [],
  };
}

/**
 * Records the scan's devices in the inventory, copies names people gave them onto the scan, and
 * adds a finding for each device that joined after the baseline and isn't known yet.
 */
export function applyInventory(scan: Scan, inventory: Inventory, now = new Date()): Inventory {
  const net = scan.network;
  if (!net || !net.devices.length) return inventory;
  const id = networkId(net);
  net.networkId = id;
  const list = inventory[id] ?? [];
  const baseline = list.length === 0;
  const byKey = new Map(list.map((d) => [d.key, d]));
  const stamp = now.toISOString();
  for (const d of net.devices) {
    const key = deviceKey(d);
    let rec = byKey.get(key);
    if (!rec) {
      rec = { key, firstSeen: stamp, lastSeen: stamp, lastIp: d.ip, baseline: baseline || undefined };
      byKey.set(key, rec);
      list.push(rec);
    }
    Object.assign(rec, { lastSeen: stamp, lastIp: d.ip, name: d.name ?? rec.name, kind: d.kind, vendor: d.vendor ?? rec.vendor });
    d.key = key;
    d.firstSeen = rec.firstSeen;
    if (rec.label) d.label = rec.label;
    if (rec.mine) d.mine = true;
    if (!rec.baseline && !rec.mine && !d.isSelf && !d.isGateway) {
      d.isNew = true;
      net.findings.push(newDeviceFinding(d, rec.firstSeen));
    }
  }
  net.findings = sortFindings(net.findings);
  for (const d of net.devices) scan.scores.devices[d.ip] = score(net.findings.filter((f) => f.target === d.ip));
  inventory[id] = list;
  return inventory;
}

/** Names a device and marks it as known, in the inventory and in a saved scan. */
export function labelDevice(inventory: Inventory, scan: Scan | null, network: string, key: string, change: { label?: string; mine?: boolean }): boolean {
  const rec = inventory[network]?.find((d) => d.key === key);
  if (!rec) return false;
  if (change.label !== undefined) rec.label = change.label.trim() || undefined;
  if (change.mine !== undefined) rec.mine = change.mine || undefined;
  const net = scan?.network;
  if (net && net.networkId === network) {
    for (const d of net.devices) {
      if (d.key !== key) continue;
      d.label = rec.label;
      d.mine = rec.mine;
      if (rec.mine) {
        d.isNew = undefined;
        net.findings = net.findings.filter((f) => !(f.checkId === "inventory.new-device" && f.target === d.ip));
        scan!.scores.devices[d.ip] = score(net.findings.filter((f) => f.target === d.ip));
      }
    }
  }
  return true;
}
