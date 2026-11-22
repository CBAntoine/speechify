// One scan: this device's checks, the network, or both.

import * as os from "node:os";
import { scanNetwork, type NetScanOptions } from "../net/scan.ts";
import { scanCode } from "../software/deps.ts";
import { scanAndroid } from "../android/scan.ts";
import { applyInventory } from "../net/inventory.ts";
import { scanRemote } from "../remote/scan.ts";
import { parseSshTarget } from "../remote/ssh.ts";
import type { StateStore } from "./state.ts";
import { auditLocal } from "./audit.ts";
import { describeOs } from "./host.ts";
import { score, sortFindings } from "./score.ts";
import type { DeviceInfo, Host, RemoteScan, Scan } from "./types.ts";
import { stamp } from "./util.ts";
import { VERSION } from "../version.ts";

export interface ScanProgress {
  phase: string;
  done: number;
  total: number;
  message?: string;
}

export async function deviceInfo(host: Host): Promise<DeviceInfo> {
  let user = "unknown";
  try {
    user = os.userInfo().username;
  } catch {
    /* no passwd entry */
  }
  return { hostname: host.hostname, platform: host.platform, os: await describeOs(host), arch: os.arch(), isRoot: host.isRoot, user };
}

export async function runScan(
  host: Host,
  opts: {
    local: boolean;
    /** Code projects under these folders. */
    code?: { roots: string[]; cacheDir?: string };
    /** Android phones and TVs connected over adb. */
    android?: boolean;
    /** Other computers to check over SSH (ssh:user@host), using open connections or keys. */
    remote?: string[];
    network?: Omit<NetScanOptions, "onProgress">;
    onProgress?: (p: ScanProgress) => void;
  },
): Promise<Scan> {
  const startedAt = new Date();
  const scan: Scan = {
    id: stamp(startedAt),
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    tool: { name: "Bulwark", version: VERSION },
    device: await deviceInfo(host),
    scores: { devices: {} },
  };
  if (opts.local) {
    const t = Date.now();
    const findings = await auditLocal(host, (p) => opts.onProgress?.({ phase: "local", done: p.done, total: p.total, message: p.current ? `Checking: ${p.current}` : "Checking this device" }));
    scan.local = { findings: sortFindings(findings), durationMs: Date.now() - t };
    scan.scores.local = score(findings);
  }
  if (opts.code) {
    scan.code = await scanCode(host, opts.code.roots, { cacheDir: opts.code.cacheDir, onProgress: (p) => opts.onProgress?.(p) });
    scan.scores.code = score(scan.code.findings);
  }
  if (opts.android) {
    scan.android = await scanAndroid(host, { onProgress: (p) => opts.onProgress?.(p) });
    scan.android.findings = sortFindings(scan.android.findings);
    for (const d of scan.android.devices) scan.scores.devices[`adb:${d.serial}`] = score(scan.android.findings.filter((f) => f.target === `adb:${d.serial}`));
    // When Bulwark reached its own phone over adb, those results replace the less complete ones from Termux.
    if (scan.local && scan.android.devices.some((d) => d.self)) {
      scan.local.findings = scan.local.findings.filter((f) => !f.checkId.startsWith("android.") || f.checkId === "android.termux-packages");
      scan.scores.local = score(scan.local.findings);
    }
  }
  for (const id of opts.remote ?? []) {
    const t = parseSshTarget(id);
    if (t) mergeRemote(scan, await scanRemote(host, t, { onProgress: (p) => opts.onProgress?.(p) }));
  }
  if (opts.network) {
    const net = await scanNetwork(host, { ...opts.network, onProgress: (p) => opts.onProgress?.(p) });
    net.findings = sortFindings(net.findings);
    scan.network = net;
    for (const d of net.devices) scan.scores.devices[d.ip] = score(net.findings.filter((f) => f.target === d.ip));
  }
  scan.finishedAt = new Date().toISOString();
  return scan;
}

/** Adds one computer's SSH results to a scan, replacing earlier ones for the same computer. */
export function mergeRemote(scan: Scan, r: RemoteScan): void {
  scan.remote = [...(scan.remote ?? []).filter((x) => x.target !== r.target), r];
  if (r.error) delete scan.scores.devices[r.target];
  else scan.scores.devices[r.target] = score(r.findings);
}

/** Saves a scan, after noting its devices in the inventory (which flags new ones). */
export async function recordScan(state: StateStore, scan: Scan): Promise<void> {
  if (scan.network?.devices.length) await state.saveInventory(applyInventory(scan, await state.inventory()));
  await state.saveScan(scan);
}

export function allFindings(scan: Scan) {
  return [...(scan.local?.findings ?? []), ...(scan.code?.findings ?? []), ...(scan.android?.findings ?? []), ...(scan.remote ?? []).flatMap((r) => r.findings), ...(scan.network?.findings ?? [])];
}
