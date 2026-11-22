// macOS checks. Written against Apple's documented command-line tools (socketfilterfw, fdesetup,
// spctl, csrutil, defaults, softwareupdate).

import type { Check, ExecSpec, Fix, Host } from "../core/types.ts";
import { fail, pass, skip } from "./common.ts";

const FW = "/usr/libexec/ApplicationFirewall/socketfilterfw";
const SU_PLIST = "/Library/Preferences/com.apple.SoftwareUpdate";
const LOGIN_PLIST = "/Library/Preferences/com.apple.loginwindow";

async function defaultsRead(host: Host, domain: string, key: string): Promise<string | null> {
  const r = await host.exec("defaults", ["read", domain, key]);
  return r.code === 0 ? r.stdout.trim() : null;
}

const fw = (...args: string[]): ExecSpec => ({ cmd: FW, args });

export const macFirewall: Check = {
  id: "macos.firewall",
  title: "The macOS firewall is off",
  category: "Firewall",
  severity: "high",
  platforms: ["darwin"],
  why: "The firewall stops other devices from reaching apps and services on your Mac that you never meant to share.",
  steps: ["System Settings → Network → Firewall → turn it on."],
  async run(host) {
    const r = await host.exec(FW, ["--getglobalstate"]);
    if (r.code !== 0) return [skip("Couldn't read the firewall state.")];
    const state = r.stdout.match(/State = (\d)/)?.[1];
    const on = state ? state !== "0" : /enabled/i.test(r.stdout);
    return on ? [pass("The firewall is on.", { evidence: [r.stdout.trim()] })] : [fail("The firewall is off.", { evidence: [r.stdout.trim()], auto: { fixId: "macos.firewall.enable" } })];
  },
};

export const macFirewallFix: Fix = {
  id: "macos.firewall.enable",
  title: () => "Turn on the macOS firewall",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async warnings() {
    return ["Apps you've allowed before keep working. macOS asks the first time a new app wants incoming connections."];
  },
  async apply(tx) {
    await tx.exec(fw("--setglobalstate", "on"), { title: "Turn the firewall on", undo: fw("--setglobalstate", "off") });
  },
};

export const macStealth: Check = {
  id: "macos.firewall.stealth",
  title: "Stealth mode is off",
  category: "Firewall",
  severity: "low",
  platforms: ["darwin"],
  why: "In stealth mode the Mac ignores pings and probes to closed ports, so scanners on the network have a harder time finding it.",
  steps: ["System Settings → Network → Firewall → Options → Enable stealth mode."],
  async run(host) {
    const r = await host.exec(FW, ["--getstealthmode"]);
    if (r.code !== 0) return [skip("Couldn't read stealth mode.")];
    const on = /(enabled|is on)/i.test(r.stdout) && !/disabled|is off/i.test(r.stdout);
    return on ? [pass("Stealth mode is on.")] : [fail("Stealth mode is off.", { auto: { fixId: "macos.firewall.stealth" } })];
  },
};

export const macStealthFix: Fix = {
  id: "macos.firewall.stealth",
  title: () => "Turn on stealth mode",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async apply(tx) {
    await tx.exec(fw("--setstealthmode", "on"), { title: "Turn stealth mode on", undo: fw("--setstealthmode", "off") });
  },
};

export const macFileVault: Check = {
  id: "macos.filevault",
  title: "FileVault disk encryption is off",
  category: "Encryption",
  severity: "high",
  platforms: ["darwin"],
  why: "Without FileVault, anyone who gets your Mac can read every file on it by booting it from another disk.",
  steps: ["System Settings → Privacy & Security → FileVault → Turn On. Keep the recovery key somewhere safe."],
  async run(host) {
    const r = await host.exec("fdesetup", ["status"]);
    if (r.code !== 0) return [skip("Couldn't read FileVault's status.")];
    if (/FileVault is On/i.test(r.stdout)) return [pass("FileVault is on.")];
    if (/will be enabled/i.test(r.stdout)) return [pass("FileVault turns on after the next restart.")];
    return [fail("FileVault is off.", { evidence: [r.stdout.trim()] })];
  },
};

export const macGatekeeper: Check = {
  id: "macos.gatekeeper",
  title: "Gatekeeper is off",
  category: "System",
  severity: "high",
  platforms: ["darwin"],
  why: "Gatekeeper blocks apps that Apple hasn't checked for known malware.",
  steps: ["Run: sudo spctl --master-enable", "Then System Settings → Privacy & Security → allow apps from the App Store and identified developers."],
  async run(host) {
    const r = await host.exec("spctl", ["--status"]);
    if (/assessments enabled/i.test(r.stdout)) return [pass("Gatekeeper is on.")];
    if (/assessments disabled/i.test(r.stdout + r.stderr)) return [fail("Gatekeeper is off, so any downloaded app can run.", { auto: { fixId: "macos.gatekeeper.enable" } })];
    return [skip("Couldn't read Gatekeeper's status.")];
  },
};

export const macGatekeeperFix: Fix = {
  id: "macos.gatekeeper.enable",
  title: () => "Turn Gatekeeper back on",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async apply(tx) {
    await tx.exec({ cmd: "spctl", args: ["--master-enable"] }, { title: "Turn Gatekeeper on", undo: { cmd: "spctl", args: ["--master-disable"] } });
  },
};

export const macSip: Check = {
  id: "macos.sip",
  title: "System Integrity Protection is off",
  category: "System",
  severity: "high",
  platforms: ["darwin"],
  why: "SIP stops anything, even root, from changing macOS itself. Without it, malware can hide inside the system.",
  steps: ["Restart into Recovery (hold the power button on Apple silicon, or Cmd-R on Intel), open Terminal, run: csrutil enable, then restart."],
  async run(host) {
    const r = await host.exec("csrutil", ["status"]);
    if (/status:\s*enabled/i.test(r.stdout)) return [pass("System Integrity Protection is on.")];
    if (/status:\s*disabled/i.test(r.stdout)) return [fail("System Integrity Protection is off.", { evidence: [r.stdout.trim()] })];
    return [skip("Couldn't read SIP's status.")];
  },
};

const AUTO_UPDATE_KEYS = ["AutomaticCheckEnabled", "AutomaticDownload", "CriticalUpdateInstall", "ConfigDataInstall"];

export const macAutoUpdates: Check = {
  id: "macos.updates.automatic",
  title: "Automatic security updates are off",
  category: "Updates",
  severity: "medium",
  platforms: ["darwin"],
  why: "Apple ships urgent security fixes (Rapid Security Responses and XProtect malware rules) in the background, but only if these settings are on.",
  steps: ["System Settings → General → Software Update → Automatic Updates → turn on everything, especially \"Install Security Responses and system files\"."],
  async run(host) {
    const off: string[] = [];
    for (const k of AUTO_UPDATE_KEYS) {
      const v = await defaultsRead(host, SU_PLIST, k);
      // A missing key means the macOS default, which is on.
      if (v === "0" || v === "false") off.push(k);
    }
    if (!off.length) return [pass("Automatic updates and security responses are on.")];
    return [fail(`These update settings are off: ${off.join(", ")}.`, { auto: { fixId: "macos.updates.automatic", params: { keys: off } } })];
  },
};

export const macAutoUpdatesFix: Fix = {
  id: "macos.updates.automatic",
  title: () => "Turn on automatic security updates",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async apply(tx, { params }) {
    const keys = (Array.isArray(params.keys) ? params.keys : []).map(String).filter((k) => AUTO_UPDATE_KEYS.includes(k));
    for (const k of keys) {
      await tx.exec(
        { cmd: "defaults", args: ["write", SU_PLIST, k, "-bool", "true"] },
        { title: `Turn on ${k}`, undo: { cmd: "defaults", args: ["write", SU_PLIST, k, "-bool", "false"] } },
      );
    }
  },
};

export const macGuest: Check = {
  id: "macos.guest",
  title: "The guest account is on",
  category: "Accounts",
  severity: "low",
  platforms: ["darwin"],
  why: "The guest account lets anyone at the Mac log in without a password.",
  steps: ["System Settings → Users & Groups → Guest User → turn off \"Allow guests to log in\"."],
  async run(host) {
    const v = await defaultsRead(host, LOGIN_PLIST, "GuestEnabled");
    if (v === "1" || v === "true") return [fail("Anyone can log in to this Mac as a guest.", { auto: { fixId: "macos.guest.disable" } })];
    return [pass("The guest account is off.")];
  },
};

export const macGuestFix: Fix = {
  id: "macos.guest.disable",
  title: () => "Turn off the guest account",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async apply(tx) {
    await tx.exec(
      { cmd: "defaults", args: ["write", LOGIN_PLIST, "GuestEnabled", "-bool", "false"] },
      { title: "Turn the guest account off", undo: { cmd: "defaults", args: ["write", LOGIN_PLIST, "GuestEnabled", "-bool", "true"] } },
    );
  },
};

export const macAutoLogin: Check = {
  id: "macos.auto-login",
  title: "The Mac logs in automatically",
  category: "Accounts",
  severity: "medium",
  platforms: ["darwin"],
  why: "With automatic login, anyone who turns the Mac on is in your account without a password.",
  steps: ["System Settings → Users & Groups → Automatically log in as → Off."],
  async run(host) {
    const user = await defaultsRead(host, LOGIN_PLIST, "autoLoginUser");
    if (user) return [fail(`The Mac logs in as "${user}" automatically at startup.`, { auto: { fixId: "macos.auto-login.disable", params: { user } } })];
    return [pass("Automatic login is off.")];
  },
};

export const macAutoLoginFix: Fix = {
  id: "macos.auto-login.disable",
  title: () => "Turn off automatic login",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async apply(tx, { params }) {
    const user = String(params.user ?? "");
    await tx.exec(
      { cmd: "defaults", args: ["delete", LOGIN_PLIST, "autoLoginUser"] },
      { title: "Stop logging in automatically", undo: user ? { cmd: "defaults", args: ["write", LOGIN_PLIST, "autoLoginUser", user] } : null },
    );
    // The saved (lightly obscured) password for automatic login.
    await tx.removeFile("/etc/kcpassword", { title: "Remove the saved automatic-login password (/etc/kcpassword)" });
  },
};

export const macPendingUpdates: Check = {
  id: "macos.updates.pending",
  title: "macOS updates are waiting",
  category: "Updates",
  severity: "high",
  platforms: ["darwin"],
  why: "Most macOS updates fix security holes that are already being used in attacks.",
  steps: ["System Settings → General → Software Update → Update Now.", "Or in Terminal: sudo softwareupdate --install --all --restart"],
  async run(host) {
    const r = await host.exec("softwareupdate", ["--list"], { timeoutMs: 120_000 });
    const text = r.stdout + r.stderr;
    if (/No new software available/i.test(text)) return [pass("macOS is up to date.")];
    const titles = [...text.matchAll(/Title:\s*([^,\n]+)/g)].map((m) => m[1].trim());
    if (titles.length) return [fail(`${titles.length} update${titles.length === 1 ? " is" : "s are"} waiting: ${titles.slice(0, 3).join(", ")}${titles.length > 3 ? "…" : ""}.`, { evidence: titles })];
    return [skip("Couldn't check for updates (no internet connection?).")];
  },
};

export const macChecks: Check[] = [macFirewall, macStealth, macFileVault, macGatekeeper, macSip, macAutoUpdates, macGuest, macAutoLogin, macPendingUpdates];
export const macFixes: Fix[] = [macFirewallFix, macStealthFix, macGatekeeperFix, macAutoUpdatesFix, macGuestFix, macAutoLoginFix];
