// Every check and fix Bulwark knows about.

import type { Check, Fix, Platform } from "../core/types.ts";
import { macChecks, macFixes } from "./macos.ts";
import { emptyPasswords, defaultPasswords, expirePasswordFix, extraRootAccounts, lockAccountFix, sudoNopasswd, sudoRequirePasswordFix } from "./linux/accounts.ts";
import { chmodFix, sensitiveFiles, worldWritable } from "./linux/files.ts";
import { linuxBlockPortFix, linuxFirewall, linuxFirewallFix } from "./linux/firewall.ts";
import { kernelHardening, sysctlFix } from "./linux/kernel.ts";
import { cupsBrowsed, disableServiceFix, redisBindFix, riskyServices } from "./linux/services.ts";
import { diskEncryption } from "./linux/system.ts";
import { enableAutoUpdatesFix, installSecurityUpdatesFix, linuxAutoUpdates, linuxRebootRequired, linuxSecurityUpdates } from "./linux/updates.ts";
import { sshChecks, sshFixes } from "./ssh.ts";
import { wifiSecurity } from "./wifi.ts";
import { winChecks, winFixes } from "./windows.ts";
import { upnpDeleteFix } from "../net/scan.ts";

export const CHECKS: Check[] = [
  // Linux
  linuxSecurityUpdates,
  linuxAutoUpdates,
  linuxRebootRequired,
  linuxFirewall,
  riskyServices,
  cupsBrowsed,
  ...sshChecks,
  emptyPasswords,
  defaultPasswords,
  extraRootAccounts,
  sudoNopasswd,
  sensitiveFiles,
  worldWritable,
  kernelHardening,
  diskEncryption,
  // macOS and Windows
  ...macChecks,
  ...winChecks,
  // Everywhere
  wifiSecurity,
];

const LOCAL_FIXES: Fix[] = [
  ...sshFixes,
  linuxFirewallFix,
  linuxBlockPortFix,
  installSecurityUpdatesFix,
  enableAutoUpdatesFix,
  lockAccountFix,
  expirePasswordFix,
  sudoRequirePasswordFix,
  chmodFix,
  sysctlFix,
  disableServiceFix,
  redisBindFix,
  ...macFixes,
  ...winFixes,
  // Network devices
  upnpDeleteFix,
];

export const FIXES = new Map<string, Fix>(LOCAL_FIXES.map((f) => [f.id, f]));

export function registerFix(fix: Fix): void {
  FIXES.set(fix.id, fix);
}

export function checksFor(platform: Platform): Check[] {
  return CHECKS.filter((c) => c.platforms.includes(platform));
}

export function getCheck(id: string): Check | undefined {
  return CHECKS.find((c) => c.id === id);
}
