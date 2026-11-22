// One scan: this device's checks, the network, or both.

import * as os from "node:os";
import { scanNetwork, type NetScanOptions } from "../net/scan.ts";
import { scanCode } from "../software/deps.ts";
import { scanAndroid } from "../android/scan.ts";
import { auditLocal } from "./audit.ts";
import { describeOs } from "./host.ts";
import { score, sortFindings } from "./score.ts";
import type { DeviceInfo, Host, Scan } from "./types.ts";
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
  if (opts.network) {
    const net = await scanNetwork(host, { ...opts.network, onProgress: (p) => opts.onProgress?.(p) });
    net.findings = sortFindings(net.findings);
    scan.network = net;
    for (const d of net.devices) scan.scores.devices[d.ip] = score(net.findings.filter((f) => f.target === d.ip));
  }
  scan.finishedAt = new Date().toISOString();
  return scan;
}

export function allFindings(scan: Scan) {
  return [...(scan.local?.findings ?? []), ...(scan.code?.findings ?? []), ...(scan.android?.findings ?? []), ...(scan.network?.findings ?? [])];
}
