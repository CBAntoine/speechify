// Checks for Android phones, tablets and TVs (including Google TV and Fire TV).
//
// Run from Termux on the phone itself, Bulwark can read what any app can (system properties). Over
// adb, which the owner approves on the device, it can also read settings, the lock screen state and
// the app list, and change settings. Each check says which it needs.

import { outcomeToFinding } from "../core/finding.ts";
import type { Category, Check, CheckOutcome, Finding, Fix, FixContext, Host, Severity } from "../core/types.ts";
import { fail, pass, skip } from "../checks/common.ts";
import { supportStatus } from "../software/installed.ts";
import { adbShell, findAdb, localShell, parseGetprop, type AndroidShell } from "./adb.ts";

export interface AndroidContext {
  props: Map<string, string>;
  kind: "phone" | "tablet" | "tv";
  sdk: number;
  fireOS: boolean;
  /** The device's own name ("Living Room TV"), when Bulwark can read it. */
  name?: string;
}

export interface AndroidCheck {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  why: string;
  steps?: string[];
  references?: string[];
  /** Needs `adb shell` rights. From an app (Termux) it's reported as not checked. */
  privileged?: boolean;
  run(sh: AndroidShell, ctx: AndroidContext): Promise<CheckOutcome[]>;
}

const DAY = 86_400_000;

function monthYear(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export async function androidContext(sh: AndroidShell): Promise<AndroidContext | null> {
  const r = await sh.run("getprop");
  if (r.code !== 0 || !r.stdout.includes("ro.build")) return null;
  const props = parseGetprop(r.stdout);
  const chars = props.get("ro.build.characteristics") ?? "";
  const maker = (props.get("ro.product.manufacturer") ?? "").toLowerCase();
  const model = props.get("ro.product.model") ?? "";
  const fireOS = maker === "amazon" || props.has("ro.build.version.fireos");
  const tv = /\btv\b/.test(chars) || (fireOS && /^AFT/i.test(model)) || props.get("ro.build.type") === "tv";
  let name: string | undefined;
  if (sh.privileged) {
    const n = (await sh.run("settings", ["get", "global", "device_name"])).stdout.trim();
    if (n && n !== "null") name = n;
  }
  return { props, kind: tv ? "tv" : /tablet/.test(chars) ? "tablet" : "phone", sdk: Number(props.get("ro.build.version.sdk") ?? 0), fireOS, name };
}

const settingsPath = (ctx: AndroidContext, phone: string, tv: string, fire: string) => (ctx.fireOS ? fire : ctx.kind === "tv" ? tv : phone);

async function setting(sh: AndroidShell, ns: string, key: string): Promise<string | null> {
  const r = await sh.run("settings", ["get", ns, key]);
  if (r.code !== 0) return null;
  const v = r.stdout.trim();
  return v === "" ? null : v;
}

// ── checks ──

export const patchLevel: AndroidCheck = {
  id: "android.patch-level",
  title: "Android security patches are out of date",
  category: "Updates",
  severity: "high",
  why: "Google publishes fixes for Android's security holes every month. A device whose newest patches are months old is open to every hole fixed since, including ones used to take over devices through a web page or a message.",
  async run(_sh, ctx) {
    const raw = ctx.props.get("ro.build.version.security_patch");
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return [skip("This device doesn't report its security patch level.")];
    const date = new Date(`${raw}T12:00:00Z`);
    const months = Math.floor((Date.now() - date.getTime()) / (30.4 * DAY));
    const steps = [
      settingsPath(ctx, "Settings → System → Software update (or Security & privacy → Updates) → Check for update.", "Settings → Device Preferences → About → System update.", "Settings → My Fire TV → About → Check for Updates."),
      "If no update comes, the maker has stopped updating this model. Keep important accounts off it, or plan to replace it.",
    ];
    const evidence = [`Security patch level: ${raw}`];
    if (months >= 6) return [fail(`The newest security fixes on this ${ctx.kind === "tv" ? "TV" : ctx.kind} are from ${monthYear(date)}, ${months} months ago.`, { evidence, steps })];
    if (months >= 3) return [fail(`The newest security fixes on this ${ctx.kind === "tv" ? "TV" : ctx.kind} are from ${monthYear(date)}, ${months} months ago.`, { evidence, steps, severity: "medium" })];
    return [pass(`Security patches are recent (${monthYear(date)}).`, { evidence })];
  },
};

// When Google stops publishing Android security fixes for each version (approximate; makers may go on longer or stop sooner).
export const ANDROID_SUPPORT: Record<number, [string, string]> = {
  26: ["8.0", "2021-01-01"],
  27: ["8.1", "2021-10-01"],
  28: ["9", "2022-01-01"],
  29: ["10", "2023-02-01"],
  30: ["11", "2024-02-01"],
  31: ["12", "2025-03-01"],
  32: ["12L", "2025-03-01"],
  33: ["13", "2026-03-01"],
  34: ["14", "2027-03-01"],
  35: ["15", "2028-03-01"],
  36: ["16", "2029-03-01"],
  37: ["17", "2030-03-01"],
};

export const androidVersion: AndroidCheck = {
  id: "android.version",
  title: "This Android version no longer gets security fixes",
  category: "Updates",
  severity: "high",
  why: "Once Google stops publishing fixes for an Android version, makers have nothing to send, and new holes in it stay open.",
  async run(_sh, ctx) {
    const release = ctx.props.get("ro.build.version.release") ?? "?";
    if (!ctx.sdk) return [skip("This device doesn't report its Android version.")];
    const row = ANDROID_SUPPORT[ctx.sdk];
    const eol = row?.[1] ?? (ctx.sdk < 26 ? "2020-01-01" : undefined);
    if (!eol) return [pass(`Android ${release} is current.`)];
    const st = supportStatus(eol);
    const os = ctx.fireOS ? `Fire OS (based on Android ${release})` : `Android ${release}`;
    if (st === "ended") {
      return [
        fail(`${os} stopped getting Google's security fixes around ${monthYear(new Date(`${eol}T12:00:00Z`))}.`, {
          confidence: ctx.fireOS ? "possible" : "likely",
          steps: [
            settingsPath(ctx, "Check for a newer Android version in Settings → System → Software update.", "Check Settings → Device Preferences → About → System update for a newer version.", "Check Settings → My Fire TV → About → Check for Updates."),
            ctx.kind === "tv" ? "If there's none, keep the TV on a separate guest network, or use a newer streaming stick for apps." : "If there's none, plan to replace the phone, and keep banking and work accounts off it until then.",
          ],
        }),
      ];
    }
    return [pass(`${os} still gets security fixes.`)];
  },
};

export const bootloader: AndroidCheck = {
  id: "android.bootloader",
  title: "The bootloader is unlocked",
  category: "System",
  severity: "high",
  why: "With an unlocked bootloader, anyone holding the device can start modified software on it, which defeats Android's checks that the system hasn't been tampered with.",
  async run(_sh, ctx) {
    const vb = ctx.props.get("ro.boot.verifiedbootstate");
    const locked = ctx.props.get("ro.boot.flash.locked");
    const state = ctx.props.get("ro.boot.vbmeta.device_state");
    const evidence = [vb && `verified boot: ${vb}`, locked && `flash locked: ${locked}`, state && `device state: ${state}`].filter((x): x is string => !!x);
    if (!evidence.length) return [skip("This device doesn't report its bootloader state.")];
    if (vb === "red") return [fail("Verified boot failed: the system on this device doesn't match what the maker signed.", { severity: "critical", evidence, steps: ["Reinstall the maker's official firmware, or stop using the device for anything sensitive."] })];
    if (vb === "orange" || locked === "0" || state === "unlocked") {
      return [fail("The bootloader is unlocked.", { evidence, steps: ["If you unlocked it on purpose (to root or install another system), keep it that way knowingly.", "Otherwise, back up the device and re-lock the bootloader with the maker's instructions (this erases the device)."] })];
    }
    if (vb === "yellow") return [fail("The device boots a system signed with a custom key.", { severity: "medium", evidence })];
    return [pass("The bootloader is locked and verified boot passes.", { evidence })];
  },
};

export const encryption: AndroidCheck = {
  id: "android.encryption",
  title: "Storage isn't encrypted",
  category: "Encryption",
  severity: "high",
  why: "Without encryption, anyone with the device can read its storage directly, including photos, messages and saved passwords.",
  async run(_sh, ctx) {
    const st = ctx.props.get("ro.crypto.state");
    if (!st) return [skip("This device doesn't report whether its storage is encrypted.")];
    if (st === "encrypted") return [pass(`Storage is encrypted (${ctx.props.get("ro.crypto.type") ?? "yes"}).`)];
    return [
      fail("Storage isn't encrypted.", {
        severity: ctx.kind === "tv" ? "low" : "high",
        steps: [ctx.kind === "tv" ? "Most TVs can't encrypt storage; just avoid storing personal files on it." : "Set a screen lock PIN, then Settings → Security → Encryption (on older Android versions it's an option there)."],
      }),
    ];
  },
};

export const debugging: AndroidCheck = {
  id: "android.debugging",
  title: "Debugging is turned on",
  category: "Remote access",
  severity: "medium",
  why: "Android debugging (ADB) gives a computer a command line on the device. Over the network, anyone who can reach it and get approved, or who finds an old-style open port, controls the device. It's only meant to be on while you use it.",
  async run(sh, ctx) {
    const tcpPort = Number(ctx.props.get("service.adb.tcp.port") ?? 0);
    const adbd = ctx.props.get("init.svc.adbd");
    let usb: boolean | null = adbd ? adbd === "running" : null;
    let wireless: boolean | null = null;
    if (sh.privileged) {
      const a = await setting(sh, "global", "adb_enabled");
      if (a !== null) usb = a === "1";
      const w = await setting(sh, "global", "adb_wifi_enabled");
      if (w !== null) wireless = w === "1";
    }
    const serial = sh.serial;
    const auto = sh.kind === "adb" && serial ? { fixId: "android.debugging-off", params: { serial } } : undefined;
    const where = settingsPath(ctx, "Settings → System → Developer options", "Settings → Device Preferences → Developer options", "Settings → My Fire TV → Developer options");
    const steps = [`${where} → turn off USB debugging, Wireless debugging and Network debugging (or turn Developer options off altogether).`];
    if (tcpPort > 0) {
      return [
        fail(`Network debugging is open on port ${tcpPort}: anyone on the network can try to connect.`, {
          severity: ctx.kind === "tv" ? "critical" : "high",
          evidence: [`service.adb.tcp.port=${tcpPort}`],
          auto,
          steps,
        }),
      ];
    }
    if (wireless) return [fail("Wireless debugging is on.", { evidence: ["adb_wifi_enabled=1"], auto, steps })];
    if (usb) {
      return [
        fail(sh.kind === "adb" ? "Debugging is on (Bulwark is using it right now). Turn it off when you're done." : "USB debugging is on.", {
          severity: "low",
          evidence: [adbd ? `adbd: ${adbd}` : "adb_enabled=1"],
          auto,
          steps,
        }),
      ];
    }
    if (usb === null && wireless === null) return [skip("Couldn't tell whether debugging is on.")];
    return [pass("Debugging is off.")];
  },
};

export const root: AndroidCheck = {
  id: "android.root",
  title: "The device is rooted",
  category: "System",
  severity: "medium",
  why: "Root lets apps go around Android's protections. If an app with root access is malicious or gets hacked, it controls the whole device.",
  async run(sh) {
    const r = await sh.run("sh", ["-c", "command -v su; for p in /system/xbin/su /system/bin/su /sbin/su /su/bin/su /debug_ramdisk/su; do [ -e \"$p\" ] && echo \"$p\"; done; true"]);
    const found = r.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    if (r.code !== 0 && !found.length) return [skip("Couldn't check for root.")];
    if (found.length) return [fail(`A root (su) tool is installed (${found[0]}).`, { evidence: found, steps: ["If you rooted it on purpose, only grant root to apps you trust (check your root manager's list).", "Otherwise, the device may have been tampered with: back it up and restore the maker's firmware."] })];
    return [pass("No root tools found.")];
  },
};

export const selinux: AndroidCheck = {
  id: "android.selinux",
  title: "Android's app sandbox (SELinux) is switched off",
  category: "System",
  severity: "critical",
  why: "SELinux is what keeps each app in its own box. With it in permissive mode, a compromised app can reach other apps' data and the system.",
  async run(sh, ctx) {
    const r = await sh.run("getenforce");
    const mode = (r.code === 0 ? r.stdout.trim() : "") || (ctx.props.get("ro.boot.selinux") ?? "");
    if (!mode) return [skip("Couldn't read the SELinux mode.")];
    if (/permissive|disabled/i.test(mode)) return [fail(`SELinux is ${mode.toLowerCase()}.`, { evidence: [`getenforce: ${mode}`], steps: ["This only happens with custom or tampered firmware. Restore the maker's official firmware."] })];
    return [pass("SELinux is enforcing.")];
  },
};

export const screenLock: AndroidCheck = {
  id: "android.screen-lock",
  title: "There's no screen lock",
  category: "Accounts",
  severity: "high",
  privileged: true,
  why: "Without a PIN, pattern or password, anyone who picks up the phone gets into your email, messages and apps, and the phone's storage encryption doesn't protect anything.",
  steps: ["Settings → Security (or Security & privacy) → Screen lock → choose a PIN of 6 digits or more, or a password."],
  async run(sh, ctx) {
    if (ctx.kind === "tv") return [skip("TVs don't have a screen lock.")];
    const disabled = (await sh.run("cmd", ["lock_settings", "get-disabled"])).stdout.trim();
    const dump = (await sh.run("dumpsys", ["lock_settings"])).stdout;
    const type = dump.match(/CredentialType:\s*(\w+)/i)?.[1];
    if (disabled === "true" || (type && /^none$/i.test(type))) return [fail("This phone has no screen lock (or only swipe).", { evidence: [type ? `CredentialType: ${type}` : "lock screen disabled"] })];
    if (type) return [pass(`A screen lock is set (${type.toLowerCase()}).`)];
    return [skip("Couldn't read the screen lock state on this Android version.")];
  },
};

export const playProtect: AndroidCheck = {
  id: "android.play-protect",
  title: "Play Protect app scanning is off",
  category: "System",
  severity: "high",
  privileged: true,
  why: "Play Protect checks apps for known malware, including apps installed from outside the Play Store. With it off, nothing warns you about a malicious app.",
  steps: ["Play Store → your profile picture → Play Protect → settings (gear) → turn on \"Scan apps with Play Protect\"."],
  async run(sh) {
    const store = await sh.run("pm", ["path", "com.android.vending"]);
    if (!store.stdout.includes("package:")) return [skip("This device doesn't have Google Play.")];
    const out: CheckOutcome[] = [];
    const verifier = await setting(sh, "global", "package_verifier_enable");
    const adbInstalls = await setting(sh, "global", "verifier_verify_adb_installs");
    if (verifier === "0") {
      out.push(fail("Play Protect isn't scanning apps.", { subject: "scanning", auto: { fixId: "android.setting", params: { serial: sh.serial, items: [{ namespace: "global", key: "package_verifier_enable", value: "1", prev: "0", label: "Turn on Play Protect app scanning" }] } } }));
    }
    if (adbInstalls === "0") {
      out.push(
        fail("Apps installed over USB or ADB skip Play Protect's check.", {
          subject: "adb-installs",
          title: "Apps installed with ADB aren't checked",
          severity: "medium",
          auto: { fixId: "android.setting", params: { serial: sh.serial, items: [{ namespace: "global", key: "verifier_verify_adb_installs", value: "1", prev: "0", label: "Have Play Protect check apps installed with ADB" }] } },
        }),
      );
    }
    return out.length ? out : [pass("Play Protect checks apps.")];
  },
};

const STORES = new Set([
  "com.android.vending", "com.google.android.feedback", "com.amazon.venezia", "com.amazon.tv.launcher", "com.sec.android.app.samsungapps", "com.huawei.appmarket",
  "com.xiaomi.market", "com.xiaomi.mipicks", "com.oppo.market", "com.heytap.market", "com.bbk.appstore", "com.vivo.appstore", "org.fdroid.fdroid",
  "com.aurora.store", "com.google.android.apps.tv.launcherx", "com.google.android.tvlauncher", "com.amazon.appmanager",
]);

export function parseInstallers(text: string): { pkg: string; installer: string | null }[] {
  return text
    .split("\n")
    .map((l) => l.trim().match(/^package:(\S+)\s+installer=(\S+)/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ pkg: m[1], installer: m[2] === "null" ? null : m[2] }));
}

export const installSources: AndroidCheck = {
  id: "android.install-sources",
  title: "Apps are allowed to install other apps",
  category: "System",
  severity: "medium",
  privileged: true,
  why: "An app with permission to install apps (a browser, a file manager, a chat app) can be used to slip malware onto the device, for example through a fake update download.",
  async run(sh, ctx) {
    if (ctx.sdk < 26) {
      const v = await setting(sh, "secure", "install_non_market_apps");
      if (v === "1") {
        return [
          fail("Installing apps from unknown sources is allowed.", {
            auto: { fixId: "android.setting", params: { serial: sh.serial, items: [{ namespace: "secure", key: "install_non_market_apps", value: "0", prev: "1", label: "Turn off installing apps from unknown sources" }] } },
            steps: ["Settings → Security → turn off Unknown sources."],
          }),
        ];
      }
      return [pass("Installing apps from unknown sources is off.")];
    }
    const r = await sh.run("cmd", ["appops", "query-op", "REQUEST_INSTALL_PACKAGES", "allow"]);
    if (r.code !== 0) return [skip("Couldn't list which apps may install other apps.")];
    const pkgs = r.stdout.split("\n").map((l) => l.trim()).filter((l) => /^[a-zA-Z][\w.]*$/.test(l) && !STORES.has(l));
    if (!pkgs.length) return [pass("No app besides the app stores may install other apps.")];
    return [
      fail(`${pkgs.length} app${pkgs.length === 1 ? " is" : "s are"} allowed to install other apps: ${pkgs.slice(0, 5).join(", ")}${pkgs.length > 5 ? "…" : ""}.`, {
        evidence: pkgs,
        auto: { fixId: "android.appops", params: { serial: sh.serial, op: "REQUEST_INSTALL_PACKAGES", packages: pkgs } },
        steps: [settingsPath(ctx, "Settings → Apps → Special app access → Install unknown apps → turn it off for apps that don't need it.", "Settings → Apps → Security & restrictions → Unknown sources → turn it off for apps that don't need it.", "Settings → My Fire TV → Developer options → Install unknown apps → turn it off for apps that don't need it.")],
      }),
    ];
  },
};

export const sideloaded: AndroidCheck = {
  id: "android.sideloaded",
  title: "Apps installed from outside an app store",
  category: "System",
  severity: "low",
  privileged: true,
  why: "Most Android malware arrives as an app installed from a download link, not an app store. Apps from outside a store also don't update themselves, so they fall behind on fixes.",
  async run(sh) {
    const r = await sh.run("pm", ["list", "packages", "-3", "-i"]);
    if (r.code !== 0) return [skip("Couldn't list installed apps.")];
    const outside = parseInstallers(r.stdout).filter((p) => !p.installer || !STORES.has(p.installer));
    if (!outside.length) return [pass("Every installed app came from an app store.")];
    return [
      fail(`${outside.length} app${outside.length === 1 ? "" : "s"} came from outside an app store: ${outside.slice(0, 6).map((p) => p.pkg).join(", ")}${outside.length > 6 ? "…" : ""}.`, {
        evidence: outside.map((p) => `${p.pkg} (installed by ${p.installer ?? "a file or adb"})`),
        steps: ["Go through the list. Uninstall anything you don't recognise or no longer use (Settings → Apps → the app → Uninstall).", "Keep the ones you trust up to date yourself, since they don't get store updates."],
      }),
    ];
  },
};

export const webview: AndroidCheck = {
  id: "android.webview",
  title: "Android System WebView hasn't been updated",
  category: "Updates",
  severity: "medium",
  privileged: true,
  why: "WebView shows web pages inside apps. It gets browser security fixes every few weeks; an old WebView carries holes that a page opened in any app can use.",
  steps: ["Play Store → search \"Android System WebView\" → Update (and update Chrome too)."],
  async run(sh) {
    const r = await sh.run("dumpsys", ["package", "com.google.android.webview"]);
    const m = r.stdout.match(/lastUpdateTime=(\d{4}-\d{2}-\d{2})/);
    const version = r.stdout.match(/versionName=(\S+)/)?.[1];
    if (!m) return [skip("Google's WebView isn't installed (or couldn't be read).")];
    const days = Math.floor((Date.now() - Date.parse(`${m[1]}T12:00:00Z`)) / DAY);
    if (days > 120) return [fail(`WebView ${version ?? ""} was last updated ${days} days ago (${m[1]}).`.replace("  ", " "), { evidence: [`versionName=${version}`, `lastUpdateTime=${m[1]}`] })];
    return [pass(`WebView ${version ?? ""} is recent (updated ${m[1]}).`.replace("  ", " "))];
  },
};

export const ANDROID_CHECKS: AndroidCheck[] = [patchLevel, androidVersion, bootloader, encryption, debugging, root, selinux, screenLock, playProtect, installSources, sideloaded, webview];

export function getAndroidCheck(id: string): AndroidCheck | undefined {
  return ANDROID_CHECKS.find((c) => c.id === id);
}

// ── running them ──

export interface AndroidDeviceInfo {
  serial?: string;
  name: string;
  model: string;
  manufacturer: string;
  android: string;
  sdk: number;
  patch?: string;
  kind: AndroidContext["kind"];
  fireOS: boolean;
}

export function describeDevice(ctx: AndroidContext, serial?: string): AndroidDeviceInfo {
  const model = ctx.props.get("ro.product.model") ?? "Android device";
  const manufacturer = ctx.props.get("ro.product.manufacturer") ?? "";
  return {
    serial,
    name: ctx.name ?? model,
    model,
    manufacturer,
    android: ctx.props.get("ro.build.version.release") ?? "?",
    sdk: ctx.sdk,
    patch: ctx.props.get("ro.build.version.security_patch"),
    kind: ctx.kind,
    fireOS: ctx.fireOS,
  };
}

function asCheck(ac: AndroidCheck): Check {
  return { id: ac.id, title: ac.title, category: ac.category, severity: ac.severity, platforms: ["android"], why: ac.why, steps: ac.steps, references: ac.references, run: async () => [] };
}

export async function runAndroidCheck(ac: AndroidCheck, sh: AndroidShell, ctx: AndroidContext, target: string): Promise<Finding[]> {
  let outcomes: CheckOutcome[];
  if (ac.privileged && !sh.privileged) outcomes = [skip("Needs an ADB connection to check (see the Phones & TVs tab in the dashboard, or bulwark android).")];
  else {
    try {
      outcomes = await ac.run(sh, ctx);
    } catch (err) {
      outcomes = [{ status: "error", summary: `The check failed: ${err instanceof Error ? err.message : String(err)}` }];
    }
  }
  return outcomes.map((o) => {
    const f = outcomeToFinding(asCheck(ac), o, target);
    if (target !== "local") f.id = `${ac.id}@${target}${o.subject ? `#${o.subject}` : ""}`;
    return f;
  });
}

export async function auditAndroid(sh: AndroidShell, target: string): Promise<{ info: AndroidDeviceInfo; findings: Finding[] } | null> {
  const ctx = await androidContext(sh);
  if (!ctx) return null;
  const findings: Finding[] = [];
  for (const ac of ANDROID_CHECKS) findings.push(...(await runAndroidCheck(ac, sh, ctx, target)));
  return { info: describeDevice(ctx, sh.serial), findings };
}

/** The same checks, run on the phone Bulwark itself runs on (Termux), as ordinary local checks. */
export const localAndroidChecks: Check[] = ANDROID_CHECKS.map((ac) => ({
  ...asCheck(ac),
  async run(host: Host) {
    const sh = localShell(host);
    const ctx = await androidContext(sh);
    if (!ctx) return [skip("Couldn't read this device's Android properties.")];
    if (ac.privileged) return [skip("Needs an ADB connection to check (see the Phones & TVs tab in the dashboard, or bulwark android).")];
    return ac.run(sh, ctx);
  },
}));

// ── fixes over adb ──

const SERIAL = /^[\w.:-]+$/;

async function shellFor(host: Host, params: Record<string, unknown>): Promise<AndroidShell> {
  const serial = String(params.serial ?? "");
  if (!SERIAL.test(serial)) throw new Error("Unknown device.");
  const adb = await findAdb(host);
  if (!adb) throw new Error("adb isn't installed.");
  return adbShell(host, adb, serial);
}

interface SettingItem {
  namespace: "global" | "secure" | "system";
  key: string;
  value: string;
  prev: string | null;
  /** What the change means, in words ("Turn on Play Protect app scanning"). */
  label?: string;
}

function settingItems(params: Record<string, unknown>): SettingItem[] {
  const list = Array.isArray(params.items) ? (params.items as SettingItem[]) : [];
  return list
    .filter((i) => i && ["global", "secure", "system"].includes(i.namespace) && /^[a-z0-9_]+$/.test(i.key) && /^-?[\w.]*$/.test(String(i.value)) && (i.prev === null || /^-?[\w.]*$/.test(String(i.prev))))
    .map((i) => ({ ...i, label: typeof i.label === "string" && i.label.length <= 100 ? i.label : undefined }));
}

async function deviceReachable(host: Host, params: Record<string, unknown>) {
  const sh = await shellFor(host, params);
  const r = await sh.run("echo", ["ok"]);
  return [{ ok: r.code === 0 && r.stdout.includes("ok"), message: r.code === 0 ? `${params.serial} is connected.` : `${params.serial} isn't connected. Reconnect it (bulwark android connect) and try again.` }];
}

export const androidSettingFix: Fix = {
  id: "android.setting",
  title: (p) => {
    const items = settingItems(p);
    return items.length === 1 ? items[0].label ?? `Set ${items[0].key} to ${items[0].value}` : `Change ${items.length} Android settings`;
  },
  needsRoot: false,
  risk: "safe",
  reversible: true,
  merge: (all) => {
    const serials = new Set(all.map((p) => p.serial));
    if (serials.size !== 1) throw new Error("Fix one device at a time.");
    return { serial: all[0].serial, items: all.flatMap(settingItems) };
  },
  preconditions: ({ host, params }) => deviceReachable(host, params),
  async apply(tx, { host, params }) {
    const sh = await shellFor(host, params);
    for (const i of settingItems(params)) {
      await tx.exec(sh.spec("settings", ["put", i.namespace, i.key, i.value]), {
        title: i.label ?? `Set ${i.namespace}/${i.key} to ${i.value}`,
        undo: i.prev === null || i.prev === "null" ? sh.spec("settings", ["delete", i.namespace, i.key]) : sh.spec("settings", ["put", i.namespace, i.key, i.prev]),
      });
    }
  },
};

const OPS = new Set(["REQUEST_INSTALL_PACKAGES"]);

export const androidAppopsFix: Fix = {
  id: "android.appops",
  title: (p) => {
    const n = Array.isArray(p.packages) ? p.packages.length : 0;
    return `Stop ${n === 1 ? (p.packages as string[])[0] : `${n} apps`} from installing other apps`;
  },
  needsRoot: false,
  risk: "caution",
  reversible: true,
  preconditions: ({ host, params }) => deviceReachable(host, params),
  async warnings() {
    return ["An app that installs its own updates outside a store (F-Droid, some games) will ask for the permission again when it needs it. You can allow it then."];
  },
  async apply(tx, { host, params }) {
    const sh = await shellFor(host, params);
    const op = String(params.op);
    if (!OPS.has(op)) throw new Error("Unexpected permission.");
    const pkgs = (Array.isArray(params.packages) ? params.packages : []).map(String).filter((p) => /^[a-zA-Z][\w.]*$/.test(p));
    for (const pkg of pkgs) {
      await tx.exec(sh.spec("cmd", ["appops", "set", pkg, op, "default"]), { title: `Take back "install unknown apps" from ${pkg}`, undo: sh.spec("cmd", ["appops", "set", pkg, op, "allow"]) });
    }
  },
};

export const androidDebuggingOffFix: Fix = {
  id: "android.debugging-off",
  title: () => "Turn off debugging on the device",
  needsRoot: false,
  risk: "caution",
  reversible: false,
  preconditions: ({ host, params }) => deviceReachable(host, params),
  async warnings() {
    return [
      "This ends Bulwark's connection to the device, so do it last. Bulwark can't undo it remotely; to connect again, turn debugging back on in Developer options.",
      "Apply your other fixes for this device first.",
    ];
  },
  async apply(tx, { host, params }) {
    const sh = await shellFor(host, params);
    const sdk = Number((await sh.run("getprop", ["ro.build.version.sdk"])).stdout.trim() || 0);
    if (sdk >= 30) await tx.exec(sh.spec("settings", ["put", "global", "adb_wifi_enabled", "0"]), { title: "Turn off wireless debugging", undo: null, okCodes: [0, 1, 255] });
    // The device drops the connection as soon as this lands, so a broken pipe counts as success.
    await tx.exec(sh.spec("settings", ["put", "global", "adb_enabled", "0"]), { title: "Turn off USB and network debugging", undo: null, okCodes: [0, 1, 255] });
  },
};

export async function termuxUpgradable(host: Host): Promise<string[] | null> {
  const r = await host.exec("apt", ["list", "--upgradable"], { timeoutMs: 60_000 });
  if (r.code !== 0) return null;
  return r.stdout.split("\n").map((l) => l.match(/^([\w.+-]+)\/\S+\s+(\S+)/)).filter((m): m is RegExpMatchArray => !!m).map((m) => `${m[1]} ${m[2]}`);
}

export const isTermux = (host: Host) => host.platform === "android" && (!!host.env.TERMUX_VERSION || (host.env.PREFIX ?? "").includes("com.termux"));

export const termuxPackages: Check = {
  id: "android.termux-packages",
  title: "Termux packages have updates waiting",
  category: "Software",
  severity: "medium",
  platforms: ["android"],
  why: "Termux's packages (OpenSSL, OpenSSH, Node.js and the rest) get security fixes like any Linux system's. Bulwark itself runs on them.",
  steps: ["In Termux: pkg upgrade"],
  async run(host) {
    if (!isTermux(host)) return [skip("Not running in Termux.")];
    const list = await termuxUpgradable(host);
    if (list === null) return [skip("Couldn't ask apt which updates are waiting.")];
    if (!list.length) return [pass("All Termux packages are up to date.")];
    return [fail(`${list.length} Termux package${list.length === 1 ? " has" : "s have"} updates waiting (${list.slice(0, 4).map((l) => l.split(" ")[0]).join(", ")}${list.length > 4 ? "…" : ""}).`, { evidence: list.slice(0, 40), auto: { fixId: "android.termux-upgrade" } })];
  },
};

export const termuxUpgradeFix: Fix = {
  id: "android.termux-upgrade",
  title: () => "Update Termux's packages",
  needsRoot: false,
  risk: "caution",
  reversible: false,
  async warnings() {
    return ["Updates can't be undone automatically.", "Termux keeps your own changes to configuration files."];
  },
  async apply(tx) {
    const env = { DEBIAN_FRONTEND: "noninteractive" };
    await tx.exec({ cmd: "apt-get", args: ["update"], env, timeoutMs: 600_000 }, { title: "Refresh the package lists", readOnly: true });
    await tx.exec(
      { cmd: "apt-get", args: ["-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold", "upgrade"], env, timeoutMs: 1_800_000 },
      { title: "Install the updates", undo: null },
    );
  },
};

export const androidFixes: Fix[] = [androidSettingFix, androidAppopsFix, androidDebuggingOffFix, termuxUpgradeFix];
