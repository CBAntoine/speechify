// Android Debug Bridge: how Bulwark checks and changes Android phones and TVs. Android only lets an
// app read a little about the system; through `adb shell`, which the device owner has to approve
// on the device's screen, it can read settings and change them.

import { lookup } from "node:dns/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecResult, ExecSpec, Host } from "../core/types.ts";
import { isPrivate } from "../net/scope.ts";

export async function findAdb(host: Host): Promise<string | null> {
  // BULWARK_ADB names the adb to use, and no other (the demo points it at a pretend one).
  const forced = host.env.BULWARK_ADB;
  if (forced !== undefined) return forced && (await host.stat(forced)) ? forced : null;
  const found = await host.which(host.platform === "win32" ? "adb.exe" : "adb");
  if (found) return found;
  const exe = host.platform === "win32" ? "adb.exe" : "adb";
  const home = host.env.HOME ?? os.homedir();
  const candidates = [
    host.env.ANDROID_HOME && path.join(host.env.ANDROID_HOME, "platform-tools", exe),
    host.env.ANDROID_SDK_ROOT && path.join(host.env.ANDROID_SDK_ROOT, "platform-tools", exe),
    host.platform === "darwin" && path.join(home, "Library", "Android", "sdk", "platform-tools", exe),
    host.platform === "linux" && path.join(home, "Android", "Sdk", "platform-tools", exe),
    host.platform === "win32" && host.env.LOCALAPPDATA && path.join(host.env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", exe),
  ].filter((c): c is string => !!c);
  for (const c of candidates) if (await host.stat(c)) return c;
  return null;
}

export const ADB_INSTALL_HINT =
  "Install Android's platform tools: in Termux, pkg install android-tools; on a Mac, brew install android-platform-tools; on Debian/Ubuntu, sudo apt install adb; on Windows, winget install Google.PlatformTools.";

export interface AdbDevice {
  serial: string;
  /** "device" when ready; "unauthorized" until someone taps Allow on the device. */
  state: string;
  model?: string;
  product?: string;
}

export function parseAdbDevices(text: string): AdbDevice[] {
  const out: AdbDevice[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\S+)\s+(device|unauthorized|offline|authorizing|connecting|no permissions|recovery|sideload|bootloader)\b(.*)$/);
    if (!m) continue;
    const extra = Object.fromEntries([...m[3].matchAll(/(\w+):(\S+)/g)].map((x) => [x[1], x[2]]));
    out.push({ serial: m[1], state: m[2], model: extra.model?.replace(/_/g, " "), product: extra.product });
  }
  return out;
}

export async function adbDevices(host: Host, adb: string): Promise<AdbDevice[]> {
  const r = await host.exec(adb, ["devices", "-l"], { timeoutMs: 20_000 });
  return r.code === 0 ? parseAdbDevices(r.stdout) : [];
}

/**
 * Phones and TVs have to be on this network: a private address (or 127.0.0.1, for the phone Bulwark
 * runs on), or a name that resolves to one. Returns what's wrong, or null.
 */
export async function checkDeviceAddress(address: string, opts: { needPort?: boolean } = {}): Promise<string | null> {
  const m = address.match(/^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/);
  if (!m) return "That doesn't look like an address (for example 192.168.1.50 or 192.168.1.50:5555).";
  if (opts.needPort && !m[2]) return "Include the port, as shown on the device (for example 192.168.1.20:37123).";
  if (m[2] && (Number(m[2]) < 1 || Number(m[2]) > 65535)) return "The port must be a number from 1 to 65535.";
  let ips: string[];
  if (/^[\d.]+$/.test(m[1])) ips = [m[1]];
  else {
    try {
      ips = (await lookup(m[1], { all: true, family: 4 })).map((a) => a.address);
    } catch {
      return `Couldn't find "${m[1]}" on the network. Use the device's IP address instead.`;
    }
  }
  if (!ips.length || !ips.every(isPrivate)) return "Bulwark only connects to phones and TVs on your own network (an address like 192.168.x.x or 10.x.x.x).";
  return null;
}

/** Connects to a phone or TV that has network (wireless) debugging on. The device asks its owner to allow it. */
export async function adbConnect(host: Host, adb: string, address: string): Promise<{ ok: boolean; message: string }> {
  address = address.trim();
  const bad = await checkDeviceAddress(address);
  if (bad) return { ok: false, message: bad };
  const target = address.includes(":") ? address : `${address}:5555`;
  const r = await host.exec(adb, ["connect", target], { timeoutMs: 20_000 });
  const text = (r.stdout + r.stderr).trim();
  if (/connected to/i.test(text) && !/failed|cannot|unable/i.test(text)) return { ok: true, message: `Connected to ${target}. If the device asks "Allow debugging?", choose Allow.` };
  if (/authenticate/i.test(text)) return { ok: false, message: `${target} is waiting for you to allow this computer on its screen. Then try again.` };
  return { ok: false, message: text || `Couldn't connect to ${target}.` };
}

/** Pairs with Android 11+ wireless debugging, using the 6-digit code from "Pair device with pairing code". */
export async function adbPair(host: Host, adb: string, address: string, code: string): Promise<{ ok: boolean; message: string }> {
  address = address.trim();
  code = code.replace(/\s+/g, "");
  const bad = await checkDeviceAddress(address, { needPort: true });
  if (bad) return { ok: false, message: bad.replace("as shown on the device", "shown under \"Pair device with pairing code\"") };
  if (!/^\d{6}$/.test(code)) return { ok: false, message: "The pairing code is the 6 digits shown on the phone." };
  const r = await host.exec(adb, ["pair", address, code], { timeoutMs: 30_000 });
  const text = (r.stdout + r.stderr).trim();
  if (/successfully paired/i.test(text)) return { ok: true, message: "Paired. Now connect using the IP address and port shown on the Wireless debugging screen (not the pairing port)." };
  return { ok: false, message: text || "Pairing failed." };
}

const quote = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

// ── a shell on an Android device, local or over adb ──

export interface AndroidShell {
  kind: "local" | "adb";
  serial?: string;
  /** True for `adb shell` (shell user rights); false for an app like Termux. */
  privileged: boolean;
  run(cmd: string, args?: string[]): Promise<ExecResult>;
  /** The command a fix runs, so the change journal can replay and undo it. */
  spec(cmd: string, args: string[]): ExecSpec;
}

export function localShell(host: Host): AndroidShell {
  return {
    kind: "local",
    privileged: false,
    run: (cmd, args = []) => host.exec(cmd, args, { timeoutMs: 20_000 }),
    spec: (cmd, args) => ({ cmd, args }),
  };
}

export function adbShell(host: Host, adb: string, serial: string): AndroidShell {
  const spec = (cmd: string, args: string[]): ExecSpec => ({
    cmd: adb,
    args: ["-s", serial, "shell", [cmd, ...args].map(quote).join(" ")],
    timeoutMs: 30_000,
    display: `${[cmd, ...args].map(quote).join(" ")}   (on ${serial}, over adb)`,
  });
  return {
    kind: "adb",
    serial,
    privileged: true,
    spec,
    run: (cmd, args = []) => {
      const s = spec(cmd, args);
      return host.exec(s.cmd, s.args, { timeoutMs: s.timeoutMs });
    },
  };
}

export function parseGetprop(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/^\[([^\]]+)\]: \[([^\]]*)\]$/gm)) out.set(m[1], m[2]);
  return out;
}
