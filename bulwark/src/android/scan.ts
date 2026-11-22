// Scans every Android phone or TV connected over adb.

import { clearHostCache } from "../core/cache.ts";
import type { AndroidScan, CheckOutcome, Finding, Host, Status } from "../core/types.ts";
import { outcomeToFinding } from "../core/finding.ts";
import { ADB_INSTALL_HINT, adbDevices, adbShell, findAdb } from "./adb.ts";
import { androidContext, auditAndroid, getAndroidCheck } from "./checks.ts";

/** Devices reached through 127.0.0.1 are the phone Bulwark itself runs on (wireless debugging to itself). */
export const isSelfSerial = (serial: string) => /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(serial);

export async function scanAndroid(host: Host, opts: { onProgress?: (p: { phase: string; done: number; total: number; message?: string }) => void } = {}): Promise<AndroidScan> {
  const started = Date.now();
  const adb = await findAdb(host);
  if (!adb) return { adb: false, devices: [], findings: [], notes: [`adb isn't installed, so phones and TVs can't be checked. ${ADB_INSTALL_HINT}`], durationMs: Date.now() - started };
  const listed = await adbDevices(host, adb);
  const notes: string[] = [];
  const devices: AndroidScan["devices"] = [];
  const findings: Finding[] = [];
  let i = 0;
  for (const d of listed) {
    opts.onProgress?.({ phase: "android", done: i++, total: listed.length, message: `Checking ${d.model ?? d.serial}` });
    if (d.state === "unauthorized") {
      notes.push(`${d.serial} is waiting for you to tap "Allow" on its screen. Then scan again.`);
      continue;
    }
    if (d.state !== "device") {
      notes.push(`${d.serial} is ${d.state}. Reconnect it and scan again.`);
      continue;
    }
    const res = await auditAndroid(adbShell(host, adb, d.serial), `adb:${d.serial}`);
    if (!res) {
      notes.push(`Couldn't read ${d.serial}'s settings.`);
      continue;
    }
    devices.push({ ...res.info, serial: d.serial, self: isSelfSerial(d.serial) });
    findings.push(...res.findings);
  }
  if (!listed.length) notes.push("No phone or TV is connected. Turn on debugging on the device, then connect it (bulwark android connect <address>, or \"Connect a phone or TV\" in the dashboard).");
  return { adb: true, devices, findings, notes, durationMs: Date.now() - started };
}

function parseId(f: Finding): { serial: string; subject?: string } | null {
  if (!f.target.startsWith("adb:")) return null;
  const serial = f.target.slice(4);
  const hash = f.id.indexOf("#");
  return { serial, subject: hash === -1 ? undefined : f.id.slice(hash + 1) };
}

async function rerun(host: Host, f: Finding): Promise<CheckOutcome[] | "unreachable" | null> {
  const id = parseId(f);
  const check = getAndroidCheck(f.checkId);
  const adb = await findAdb(host);
  if (!id || !check || !adb) return null;
  const sh = adbShell(host, adb, id.serial);
  const ctx = await androidContext(sh);
  if (!ctx) return "unreachable";
  return check.run(sh, ctx);
}

/** Re-checks findings on adb devices, so fixes use what's true on the device now. */
export async function refreshAndroidFindings(host: Host, findings: Finding[]): Promise<Finding[]> {
  clearHostCache(host);
  const out: Finding[] = [];
  for (const f of findings) {
    const outcomes = await rerun(host, f);
    if (outcomes === null || outcomes === "unreachable") {
      out.push(f);
      continue;
    }
    const subject = parseId(f)?.subject;
    const same = outcomes.find((o) => (subject ? o.subject === subject : !o.subject || outcomes.length === 1));
    if (same?.status === "fail") {
      const check = getAndroidCheck(f.checkId)!;
      const fresh = outcomeToFinding({ ...check, platforms: ["android"], run: async () => [] }, same, f.target);
      fresh.id = f.id;
      out.push(fresh.remedy?.auto ? fresh : f);
    } else if (!same || same.status === "pass") continue;
    else out.push(f);
  }
  return out;
}

export async function verifyAndroid(host: Host, findings: Finding[], fixId: string): Promise<{ status: Status; summary: string }> {
  if (fixId === "android.debugging-off") {
    const adb = await findAdb(host);
    const serial = parseId(findings[0])?.serial;
    const still = adb && serial ? (await adbDevices(host, adb)).find((d) => d.serial === serial && d.state === "device") : undefined;
    return still ? { status: "fail", summary: "The device still accepts debugging connections." } : { status: "pass", summary: "Debugging is off; the device has disconnected from Bulwark, as expected." };
  }
  const problems: string[] = [];
  for (const f of findings) {
    const outcomes = await rerun(host, f);
    if (outcomes === "unreachable") return { status: "error", summary: "The device disconnected before Bulwark could check again." };
    const subject = parseId(f)?.subject;
    const still = outcomes?.find((o) => o.status === "fail" && (subject ? o.subject === subject : !o.subject));
    if (still) problems.push(still.summary);
  }
  return problems.length ? { status: "fail", summary: `The change was made, but the device still reports: ${problems[0]}` } : { status: "pass", summary: "Checked the device again: the problem is gone." };
}
