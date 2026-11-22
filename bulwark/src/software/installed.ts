// Software installed on this device: is the operating system still supported, are the language
// runtimes, which apps have updates waiting, and are any known-exploited versions installed.

import * as path from "node:path";
import { powershellJson } from "../core/host.ts";
import type { Check, CheckOutcome, ExecSpec, Fix, Host, RunAs, Severity } from "../core/types.ts";
import { compareVersions } from "../core/versions.ts";
import { fail, osRelease, pass, skip } from "../checks/common.ts";

const DAY = 86_400_000;

function monthYear(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Ended, ending within six months, or fine. */
export function supportStatus(eol: string, now = new Date()): "ended" | "ending" | "ok" {
  const t = Date.parse(`${eol}T23:59:59Z`);
  if (t < now.getTime()) return "ended";
  if (t - now.getTime() < 183 * DAY) return "ending";
  return "ok";
}

// ── operating systems ──

// Standard security support end dates. Ubuntu LTS and Windows 10 can be extended with paid plans.
export const UBUNTU: Record<string, string> = {
  "16.04": "2021-04-30", "18.04": "2023-05-31", "20.04": "2025-05-29", "22.04": "2027-06-01", "24.04": "2029-05-31", "26.04": "2031-05-31",
  "20.10": "2021-07-22", "21.04": "2022-01-20", "21.10": "2022-07-14", "22.10": "2023-07-20", "23.04": "2024-01-25", "23.10": "2024-07-11",
  "24.10": "2025-07-10", "25.04": "2026-01-15", "25.10": "2026-07-09", "26.10": "2027-07-15",
};
export const DEBIAN: Record<string, string> = { "8": "2020-06-30", "9": "2022-06-30", "10": "2024-06-30", "11": "2026-08-31", "12": "2028-06-30", "13": "2030-06-30" };
const DEBIAN_CODENAMES: Record<string, string> = { jessie: "8", stretch: "9", buster: "10", bullseye: "11", bookworm: "12", trixie: "13" };
export const FEDORA: Record<string, string> = { "38": "2024-05-21", "39": "2024-11-26", "40": "2025-05-13", "41": "2025-12-15", "42": "2026-05-13", "43": "2026-12-09", "44": "2027-05-19" };
export const RHEL: Record<string, string> = { "7": "2024-06-30", "8": "2029-05-31", "9": "2032-05-31", "10": "2035-05-31" };
const CENTOS: Record<string, string> = { "7": "2024-06-30", "8": "2021-12-31" };
export const ALPINE: Record<string, string> = { "3.17": "2024-11-22", "3.18": "2025-05-09", "3.19": "2025-11-01", "3.20": "2026-04-01", "3.21": "2026-11-01", "3.22": "2027-05-01", "3.23": "2027-11-01" };
// Windows 11 by build: [Home/Pro, Enterprise/Education].
export const WINDOWS_11: Record<number, [string, string, string]> = {
  22000: ["21H2", "2023-10-10", "2024-10-08"],
  22621: ["22H2", "2024-10-08", "2025-10-14"],
  22631: ["23H2", "2025-11-11", "2026-11-10"],
  26100: ["24H2", "2026-10-13", "2027-10-12"],
  26200: ["25H2", "2027-10-12", "2028-10-10"],
};
// Apple doesn't publish end dates; in practice it patches the newest three macOS versions.
export const MACOS: Record<string, string> = { "10.15": "2022-09-12", "11": "2023-09-26", "12": "2024-09-16", "13": "2025-09-15", "14": "2026-09-15", "15": "2027-09-15", "26": "2028-09-15" };

interface OsSupport {
  name: string;
  eol?: string;
  extended?: string;
  steps: string[];
  confidence?: "likely";
}

async function osSupport(host: Host): Promise<OsSupport | null> {
  if (host.platform === "linux") {
    const r = await osRelease(host);
    const v = r.versionId;
    if (r.id === "ubuntu") {
      const lts = /\.04$/.test(v) && Number(v.split(".")[0]) % 2 === 0;
      return {
        name: `Ubuntu ${v}${lts ? " LTS" : ""}`,
        eol: UBUNTU[v],
        extended: lts ? "Ubuntu Pro (free for personal use on up to 5 machines) extends security fixes for 5 more years." : undefined,
        steps: lts ? ["Upgrade to the next LTS release: sudo do-release-upgrade", "Or turn on Ubuntu Pro for extended security fixes: sudo pro attach"] : ["Upgrade to a supported release: sudo do-release-upgrade"],
      };
    }
    if (r.id === "debian" || r.id === "raspbian" || (r.idLike.includes("debian") && DEBIAN_CODENAMES[r.codename] && r.id !== "ubuntu")) {
      const major = v.split(".")[0] || DEBIAN_CODENAMES[r.codename] || "";
      const name = r.id === "raspbian" || (await host.stat("/etc/rpi-issue")) ? `Raspberry Pi OS (Debian ${major})` : `Debian ${major}`;
      return { name, eol: DEBIAN[major], steps: ["Upgrade to the current Debian release (on a Raspberry Pi, the simplest way is a fresh Raspberry Pi OS image with your files copied over)."] };
    }
    if (r.id === "fedora") return { name: `Fedora ${v}`, eol: FEDORA[v], steps: ["sudo dnf system-upgrade download --releasever=<next version>, then sudo dnf system-upgrade reboot"] };
    if (["rhel", "rocky", "almalinux", "ol"].includes(r.id)) {
      const major = v.split(".")[0];
      return { name: r.pretty || `${r.id} ${v}`, eol: RHEL[major], steps: ["Move to a supported major release (for example with the Leapp upgrade tool)."] };
    }
    if (r.id === "centos") {
      const major = v.split(".")[0];
      return { name: r.pretty || `CentOS ${v}`, eol: CENTOS[major] ?? (major === "9" ? "2027-05-31" : undefined), steps: ["Move to a supported distribution, such as Rocky Linux, AlmaLinux or CentOS Stream 10."] };
    }
    if (r.id === "alpine") {
      const mm = v.split(".").slice(0, 2).join(".");
      return { name: `Alpine ${v}`, eol: ALPINE[mm], steps: ["Upgrade to a supported Alpine release (update /etc/apk/repositories, then apk upgrade --available)."] };
    }
    return null;
  }
  if (host.platform === "darwin") {
    const r = await host.exec("sw_vers", ["-productVersion"]);
    const v = r.stdout.trim();
    if (!v) return null;
    const major = v.startsWith("10.") ? v.split(".").slice(0, 2).join(".") : v.split(".")[0];
    const eol = MACOS[major] ?? (Number(major) < 10.15 || v.startsWith("10.") ? "2021-09-01" : undefined);
    return { name: `macOS ${v}`, eol, confidence: "likely", steps: ["System Settings → General → Software Update → upgrade to the newest macOS your Mac supports.", "If your Mac can't run a supported macOS, keep it off the internet or replace it."] };
  }
  const info = await powershellJson<{ Caption?: string; BuildNumber?: string }>(host, "Get-CimInstance Win32_OperatingSystem | Select-Object Caption, BuildNumber");
  if (!info?.BuildNumber) return null;
  const build = Number(info.BuildNumber);
  const caption = info.Caption ?? "Windows";
  if (/LTSC|Server/i.test(caption)) return { name: caption, steps: [] };
  const enterprise = /Enterprise|Education/i.test(caption);
  if (build < 22000) {
    return {
      name: caption.replace(/^Microsoft\s+/, ""),
      eol: "2025-10-14",
      extended: "Extended Security Updates (ESU) can cover it for longer, if you enrolled.",
      steps: ["Upgrade to Windows 11 (Settings → Windows Update) if the PC supports it.", "If it doesn't, enroll in Extended Security Updates, or plan to replace the PC."],
    };
  }
  const known = Object.keys(WINDOWS_11).map(Number).filter((b) => b <= build).sort((a, b) => b - a)[0];
  const row = known ? WINDOWS_11[known] : undefined;
  return {
    name: `${caption.replace(/^Microsoft\s+/, "")}${row ? ` ${row[0]}` : ""}`,
    eol: row ? (enterprise ? row[2] : row[1]) : undefined,
    steps: ["Settings → Windows Update → install the latest Windows 11 feature update."],
  };
}

export const osSupportCheck: Check = {
  id: "software.os-support",
  title: "The operating system no longer gets security updates",
  category: "Software",
  severity: "high",
  platforms: ["linux", "darwin", "win32"],
  why: "Once an operating system's support ends, newly found holes in it are never fixed, and attackers know exactly which ones those are.",
  async run(host): Promise<CheckOutcome[]> {
    const os = await osSupport(host);
    if (!os) return [skip("Bulwark doesn't know this operating system's support dates.")];
    if (!os.eol) return [skip(`Bulwark doesn't know the support dates of ${os.name}.`)];
    const st = supportStatus(os.eol);
    if (st === "ended") {
      return [
        fail(`${os.name}'s security support ended in ${monthYear(os.eol)}.${os.extended ? ` ${os.extended}` : ""}`, {
          confidence: os.extended || os.confidence ? "likely" : "confirmed",
          steps: os.steps,
          evidence: [`${os.name}: support ended ${os.eol}`],
        }),
      ];
    }
    if (st === "ending") {
      return [fail(`${os.name}'s security support ends in ${monthYear(os.eol)}. Plan the upgrade now.`, { severity: "low", steps: os.steps, title: "Operating system support ends soon" })];
    }
    return [pass(`${os.name} gets security updates until ${monthYear(os.eol)}.`)];
  },
};

// ── language runtimes ──

export const RUNTIMES: { id: string; name: string; commands: string[]; args: string[]; pattern: RegExp; key: (v: string) => string; eol: Record<string, string>; steps: string[] }[] = [
  {
    id: "node",
    name: "Node.js",
    commands: ["node"],
    args: ["--version"],
    pattern: /v?(\d+\.\d+\.\d+)/,
    key: (v) => v.split(".")[0],
    eol: { "14": "2023-04-30", "16": "2023-09-11", "17": "2022-06-01", "18": "2025-04-30", "19": "2023-06-01", "20": "2026-04-30", "21": "2024-06-01", "22": "2027-04-30", "23": "2025-06-01", "24": "2028-04-30", "25": "2026-06-01", "26": "2029-04-30" },
    steps: ["Install the current LTS from nodejs.org, or with nvm: nvm install --lts"],
  },
  {
    id: "python",
    name: "Python",
    commands: ["python3", "python"],
    args: ["--version"],
    pattern: /Python (\d+\.\d+\.\d+)/,
    key: (v) => v.split(".").slice(0, 2).join("."),
    eol: { "2.7": "2020-01-01", "3.6": "2021-12-23", "3.7": "2023-06-27", "3.8": "2024-10-07", "3.9": "2025-10-31", "3.10": "2026-10-31", "3.11": "2027-10-31", "3.12": "2028-10-31", "3.13": "2029-10-31", "3.14": "2030-10-31" },
    steps: ["Install a supported Python (3.11 or newer) from python.org or your package manager, and recreate your virtual environments with it."],
  },
  {
    id: "go",
    name: "Go",
    commands: ["go"],
    args: ["version"],
    pattern: /go(\d+\.\d+(?:\.\d+)?)/,
    key: (v) => v.split(".").slice(0, 2).join("."),
    eol: { "1.20": "2024-02-06", "1.21": "2024-08-13", "1.22": "2025-02-11", "1.23": "2025-08-12", "1.24": "2026-02-10", "1.25": "2026-08-11", "1.26": "2027-02-09", "1.27": "2027-08-10" },
    steps: ["Install the current Go release from go.dev/dl. Only the two newest Go releases get security fixes."],
  },
  {
    id: "php",
    name: "PHP",
    commands: ["php"],
    args: ["--version"],
    pattern: /PHP (\d+\.\d+\.\d+)/,
    key: (v) => v.split(".").slice(0, 2).join("."),
    eol: { "7.4": "2022-11-28", "8.0": "2023-11-26", "8.1": "2025-12-31", "8.2": "2026-12-31", "8.3": "2027-12-31", "8.4": "2028-12-31", "8.5": "2029-12-31" },
    steps: ["Upgrade to a supported PHP version (8.3 or newer)."],
  },
  {
    id: "ruby",
    name: "Ruby",
    commands: ["ruby"],
    args: ["--version"],
    pattern: /ruby (\d+\.\d+\.\d+)/,
    key: (v) => v.split(".").slice(0, 2).join("."),
    eol: { "2.7": "2023-03-31", "3.0": "2024-04-23", "3.1": "2025-03-26", "3.2": "2026-03-31", "3.3": "2027-03-31", "3.4": "2028-03-31", "4.0": "2029-03-31" },
    steps: ["Install a supported Ruby (with rbenv, asdf or your package manager)."],
  },
];

export const runtimesCheck: Check = {
  id: "software.runtime",
  title: "A programming runtime no longer gets security fixes",
  category: "Software",
  severity: "medium",
  platforms: ["linux", "darwin", "win32", "android"],
  why: "Apps and scripts run with the runtime's bugs. Once a version's support ends, its security holes stay open.",
  async run(host): Promise<CheckOutcome[]> {
    const out: CheckOutcome[] = [];
    for (const rt of RUNTIMES) {
      let found: { bin: string; version: string; raw: string } | null = null;
      for (const cmd of rt.commands) {
        const bin = await host.which(cmd);
        if (!bin) continue;
        const r = await host.exec(bin, rt.args, { timeoutMs: 10_000 });
        const raw = (r.stdout + r.stderr).trim().split("\n")[0];
        const m = raw.match(rt.pattern);
        if (m) {
          found = { bin, version: m[1], raw };
          break;
        }
      }
      if (!found) continue;
      const k = rt.key(found.version);
      const eol = rt.eol[k];
      if (!eol) continue;
      const st = supportStatus(eol);
      // Linux distributions keep patching the runtimes they ship for as long as the release is supported.
      const distro = host.platform === "linux" && (found.bin.startsWith("/usr/bin/") || /ubuntu|deb\d|el\d|fc\d/i.test(found.raw));
      if (st === "ended") {
        out.push(
          fail(`${rt.name} ${found.version} (${found.bin}) stopped getting security fixes in ${monthYear(eol)}.${distro ? " It came with your Linux distribution, which may still patch it." : ""}`, {
            subject: rt.id,
            title: `${rt.name} ${k} no longer gets security fixes`,
            confidence: distro ? "possible" : "confirmed",
            steps: rt.steps,
            evidence: [found.raw],
          }),
        );
      } else if (st === "ending" && !distro) {
        out.push(fail(`${rt.name} ${found.version} stops getting security fixes in ${monthYear(eol)}.`, { subject: rt.id, title: `${rt.name} ${k} support ends soon`, severity: "low", steps: rt.steps }));
      } else {
        out.push(pass(`${rt.name} ${found.version} is supported until ${monthYear(eol)}.`, { subject: rt.id }));
      }
    }
    return out.length ? out : [skip("No Node.js, Python, Go, PHP or Ruby found.")];
  },
};

// ── apps with updates waiting (package managers) ──

const EXPOSED = /chrome|chromium|firefox|edge|brave|opera|vivaldi|safari|thunderbird|outlook|\bmail\b|slack|discord|teams|zoom|skype|telegram|signal|whatsapp|acrobat|reader|foxit|\bpdf|libreoffice|openoffice|\boffice\b|word|excel|powerpoint|vlc|media ?player|itunes|spotify|7-?zip|winrar|peazip|keka|unarchiver|anydesk|teamviewer|rustdesk|vnc|putty|winscp|filezilla|openvpn|wireguard|tailscale|\bvpn\b/i;
const SENSITIVE = /java|\bjre\b|\bjdk\b|openjdk|temurin|corretto|python|^node|nodejs|ruby|\bphp|golang|^go$|^git$|\bgit\b|openssl|openssh|libressl|curl|wget|gnupg|^gpg|sudo|docker|ffmpeg|imagemagick|ghostscript|libxml2|sqlite|nginx|httpd|apache|postgres|mysql|mariadb|redis|\.net|dotnet|powershell/i;

export interface OutdatedApp {
  manager: "brew" | "winget" | "snap" | "flatpak";
  id: string;
  name: string;
  current: string;
  available: string;
  cask?: boolean;
}

export function classifyApp(a: OutdatedApp): Severity {
  const text = `${a.name} ${a.id}`;
  if (EXPOSED.test(text)) return "high";
  if (SENSITIVE.test(text)) return "medium";
  return "low";
}

export function parseBrewOutdated(json: string): OutdatedApp[] {
  const j = JSON.parse(json) as { formulae?: { name: string; installed_versions?: string[]; current_version?: string; pinned?: boolean }[]; casks?: { name: string; installed_versions?: string[] | string; current_version?: string }[] };
  const out: OutdatedApp[] = [];
  for (const f of j.formulae ?? []) {
    if (f.pinned) continue;
    out.push({ manager: "brew", id: f.name, name: f.name, current: (f.installed_versions ?? []).join(", "), available: f.current_version ?? "?" });
  }
  for (const c of j.casks ?? []) {
    const cur = Array.isArray(c.installed_versions) ? c.installed_versions.join(", ") : c.installed_versions ?? "";
    out.push({ manager: "brew", id: c.name, name: c.name, current: cur, available: c.current_version ?? "?", cask: true });
  }
  return out;
}

/** winget's table, whatever language its headers are in: columns start where the header words start. */
export function parseWingetUpgrade(text: string): OutdatedApp[] {
  const lines = text.split(/\r?\n/).map((l) => l.slice(l.lastIndexOf("\r") + 1));
  const dash = lines.findIndex((l) => /^-{10,}\s*$/.test(l.trim()));
  if (dash < 1) return [];
  const header = lines[dash - 1];
  const starts = [...header.matchAll(/\S+/g)].map((m) => m.index!);
  if (starts.length < 4) return [];
  const out: OutdatedApp[] = [];
  for (const line of lines.slice(dash + 1)) {
    if (!line.trim() || line.length < starts[3]) break;
    const col = (i: number) => line.slice(starts[i], starts[i + 1] ?? line.length).trim();
    const id = col(1);
    if (!/^[\w.+-]+$/.test(id)) continue;
    out.push({ manager: "winget", id, name: col(0).replace(/…$/, ""), current: col(2), available: col(3) });
  }
  return out;
}

export function parseSnapRefresh(text: string): OutdatedApp[] {
  const lines = text.split("\n").filter(Boolean);
  if (!lines.length || !/^Name\s+Version/.test(lines[0])) return [];
  return lines.slice(1).map((l) => l.trim().split(/\s+/)).filter((f) => f.length >= 2).map((f) => ({ manager: "snap" as const, id: f[0], name: f[0], current: "installed", available: f[1] }));
}

export function parseFlatpakUpdates(text: string): OutdatedApp[] {
  return text
    .split("\n")
    .map((l) => l.split("\t").map((x) => x.trim()))
    .filter((f) => f[0] && /^[\w-]+(\.[\w-]+){2,}$/.test(f[0]))
    .map((f) => ({ manager: "flatpak" as const, id: f[0], name: f[1] || f[0], current: "installed", available: f[2] || "newer" }));
}

const BREW_PATHS = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew", "/home/linuxbrew/.linuxbrew/bin/brew"];

/** Homebrew refuses to run as root, so as root it runs as the owner of its folder. */
async function brewRunner(host: Host): Promise<{ bin: string; runAs?: RunAs } | null> {
  for (const bin of BREW_PATHS) {
    const st = await host.stat(bin);
    if (!st) continue;
    if (!host.isRoot || host.platform === "win32") return { bin };
    const prefix = await host.stat(path.dirname(path.dirname(bin)));
    const uid = prefix?.uid ?? st.uid;
    if (uid === 0) return null;
    const passwd = (await host.readFile("/etc/passwd")) ?? "";
    const entry = passwd.split("\n").map((l) => l.split(":")).find((f) => Number(f[2]) === uid);
    let user = entry?.[0];
    if (!user && host.platform === "darwin") user = (await host.exec("id", ["-nu", String(uid)])).stdout.trim() || undefined;
    return { bin, runAs: { uid, gid: prefix?.gid ?? st.gid, user, home: entry?.[5] ?? (user ? `/Users/${user}` : undefined) } };
  }
  return null;
}

export async function outdatedApps(host: Host): Promise<{ apps: OutdatedApp[]; managers: string[] }> {
  const apps: OutdatedApp[] = [];
  const managers: string[] = [];
  const brew = host.platform !== "win32" ? await brewRunner(host) : null;
  if (brew) {
    const r = await host.exec(brew.bin, ["outdated", "--json=v2"], { timeoutMs: 120_000, runAs: brew.runAs, env: { HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_ANALYTICS: "1" } });
    if (r.code === 0) {
      managers.push("Homebrew");
      try {
        apps.push(...parseBrewOutdated(r.stdout));
      } catch {
        /* unexpected output */
      }
    }
  }
  if (host.platform === "win32" && (await host.which("winget"))) {
    const r = await host.exec("winget", ["upgrade", "--accept-source-agreements", "--disable-interactivity"], { timeoutMs: 120_000 });
    managers.push("winget");
    apps.push(...parseWingetUpgrade(r.stdout));
  }
  if (host.platform === "linux" && (await host.which("snap"))) {
    const r = await host.exec("snap", ["refresh", "--list"], { timeoutMs: 60_000 });
    if (r.code === 0 || /up to date/i.test(r.stdout + r.stderr)) {
      managers.push("snap");
      apps.push(...parseSnapRefresh(r.stdout));
    }
  }
  if (host.platform === "linux" && (await host.which("flatpak"))) {
    const r = await host.exec("flatpak", ["remote-ls", "--updates", "--app", "--columns=application,name,version"], { timeoutMs: 60_000 });
    if (r.code === 0) {
      managers.push("flatpak");
      apps.push(...parseFlatpakUpdates(r.stdout));
    }
  }
  return { apps, managers };
}

const MANAGER_NAME = { brew: "Homebrew", winget: "winget", snap: "snap", flatpak: "Flatpak" } as const;

function updateRef(apps: OutdatedApp[]) {
  const m = apps[0].manager;
  return { fixId: `software.update.${m}`, params: { apps: apps.map((a) => ({ id: a.id, cask: !!a.cask, name: a.name })) } };
}

function manualUpdate(a: OutdatedApp): string {
  switch (a.manager) {
    case "brew":
      return `brew upgrade ${a.cask ? "--cask " : ""}${a.id}`;
    case "winget":
      return `winget upgrade --id ${a.id} --exact`;
    case "snap":
      return `sudo snap refresh ${a.id}`;
    default:
      return `flatpak update ${a.id}`;
  }
}

export const outdatedAppsCheck: Check = {
  id: "software.outdated",
  title: "Apps have updates waiting",
  category: "Software",
  severity: "high",
  platforms: ["linux", "darwin", "win32"],
  why: "Browsers, chat apps, PDF readers and archivers open files and pages from strangers, so their updates are mostly security fixes. Every day an update waits is a day a known hole stays open.",
  async run(host): Promise<CheckOutcome[]> {
    const { apps, managers } = await outdatedApps(host);
    if (!managers.length) return [skip("No Homebrew, winget, snap or Flatpak found to ask about updates.")];
    if (!apps.length) return [pass(`Everything installed with ${managers.join(", ")} is up to date.`)];
    const out: CheckOutcome[] = [];
    const rest = new Map<string, OutdatedApp[]>();
    for (const a of apps) {
      const sev = classifyApp(a);
      if (sev === "low") {
        rest.set(a.manager, [...(rest.get(a.manager) ?? []), a]);
        continue;
      }
      out.push(
        fail(`${a.name} ${a.current} → ${a.available} is waiting (${MANAGER_NAME[a.manager]}).`, {
          subject: `${a.manager}:${a.id}`,
          title: `${a.name} has an update waiting`,
          severity: sev,
          auto: updateRef([a]),
          steps: [manualUpdate(a)],
        }),
      );
    }
    for (const [m, list] of rest) {
      out.push(
        fail(`${list.length} other ${MANAGER_NAME[list[0].manager]} package${list.length === 1 ? " has an update" : "s have updates"}: ${list.slice(0, 6).map((a) => a.name).join(", ")}${list.length > 6 ? "…" : ""}.`, {
          subject: `${m}:others`,
          title: `${list.length} more update${list.length === 1 ? "" : "s"} waiting (${MANAGER_NAME[list[0].manager]})`,
          severity: "low",
          evidence: list.map((a) => `${a.name} ${a.current} → ${a.available}`),
          auto: updateRef(list),
          steps: list.slice(0, 10).map(manualUpdate),
        }),
      );
    }
    return out;
  },
};

interface AppRef {
  id: string;
  cask: boolean;
  name: string;
}

function appsParam(params: Record<string, unknown>): AppRef[] {
  const list = Array.isArray(params.apps) ? (params.apps as AppRef[]) : [];
  // Ids go on a command line: only plain package identifiers.
  return list.filter((a) => a && typeof a.id === "string" && /^[\w@.+/-]+$/.test(a.id)).map((a) => ({ id: a.id, cask: !!a.cask, name: String(a.name ?? a.id) }));
}

function updateFix(manager: OutdatedApp["manager"]): Fix {
  return {
    id: `software.update.${manager}`,
    title: (p) => {
      const list = appsParam(p);
      return list.length === 1 ? `Update ${list[0].name}` : `Update ${list.length} apps with ${MANAGER_NAME[manager]}`;
    },
    needsRoot: manager === "snap" || manager === "flatpak",
    risk: "caution",
    reversible: false,
    merge: (all) => ({ apps: all.flatMap(appsParam).filter((a, i, arr) => arr.findIndex((b) => b.id === a.id) === i) }),
    async warnings() {
      return ["Updates can't be undone automatically.", "Apps that are open may need to restart (save your work first)."];
    },
    async apply(tx, { host, params }) {
      const list = appsParam(params);
      if (!list.length) throw new Error("Nothing to update.");
      const run = async (spec: ExecSpec, title: string) => {
        await tx.exec({ timeoutMs: 1_800_000, ...spec }, { title, undo: null });
      };
      if (manager === "brew") {
        const brew = await brewRunner(host);
        if (!brew) throw new Error("Couldn't find Homebrew (or it's owned by root).");
        const formulae = list.filter((a) => !a.cask).map((a) => a.id);
        const casks = list.filter((a) => a.cask).map((a) => a.id);
        if (formulae.length) await run({ cmd: brew.bin, args: ["upgrade", ...formulae], runAs: brew.runAs }, `Update ${formulae.join(", ")} with Homebrew`);
        if (casks.length) await run({ cmd: brew.bin, args: ["upgrade", "--cask", ...casks], runAs: brew.runAs }, `Update ${casks.join(", ")} with Homebrew`);
      } else if (manager === "winget") {
        for (const a of list) {
          await run({ cmd: "winget", args: ["upgrade", "--id", a.id, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"] }, `Update ${a.name}`);
        }
      } else if (manager === "snap") {
        await run({ cmd: "snap", args: ["refresh", ...list.map((a) => a.id)] }, `Update ${list.map((a) => a.name).join(", ")}`);
      } else {
        await run({ cmd: "flatpak", args: ["update", "-y", "--noninteractive", ...list.map((a) => a.id)] }, `Update ${list.map((a) => a.name).join(", ")}`);
      }
    },
  };
}

export const updateFixes: Fix[] = (["brew", "winget", "snap", "flatpak"] as const).map(updateFix);

// ── known-exploited versions ──

interface KnownBad {
  match: RegExp;
  product: string;
  vulnerable: (v: string) => boolean;
  cves: string[];
  severity: Severity;
  why: string;
  winget?: string;
  download: string;
}

export const KNOWN_BAD: KnownBad[] = [
  {
    match: /^7-Zip\b/i,
    product: "7-Zip",
    vulnerable: (v) => compareVersions(v, "25.00") < 0,
    cves: ["CVE-2025-0411", "CVE-2025-11001", "CVE-2025-11002"],
    severity: "high",
    why: "Older 7-Zip lets a crafted archive skip Windows' \"downloaded from the internet\" warning (exploited in attacks in 2025) or write files outside the folder you extract to.",
    winget: "7zip.7zip",
    download: "https://www.7-zip.org/download.html",
  },
  {
    match: /^WinRAR\b/i,
    product: "WinRAR",
    vulnerable: (v) => compareVersions(v, "7.13") < 0,
    cves: ["CVE-2025-8088", "CVE-2025-6218", "CVE-2023-38831"],
    severity: "high",
    why: "WinRAR before 7.13 can be made to drop programs into your Startup folder just by extracting an archive. Criminal groups used this against people in 2025. WinRAR doesn't update itself.",
    winget: "RARLab.WinRAR",
    download: "https://www.win-rar.com/download.html",
  },
  {
    match: /^PuTTY\b/i,
    product: "PuTTY",
    vulnerable: (v) => compareVersions(v, "0.68") >= 0 && compareVersions(v, "0.81") < 0,
    cves: ["CVE-2024-31497"],
    severity: "high",
    why: "PuTTY 0.68 to 0.80 leaks enough about NIST P-521 SSH keys that an attacker who sees about 60 signatures can recover the private key.",
    winget: "PuTTY.PuTTY",
    download: "https://www.chiark.greenend.org.uk/~sgtatham/putty/latest.html",
  },
];

function normalizeAppVersion(v: string): string {
  // "24.08.00.0" → "24.08", "7.01.0" → "7.01", "0.80.0.0" → "0.80"
  const parts = v.trim().split(".");
  while (parts.length > 2 && /^0+$/.test(parts[parts.length - 1])) parts.pop();
  return parts.join(".");
}

export const knownVulnerableCheck: Check = {
  id: "software.known-vulnerable",
  title: "A version with a known, exploited flaw is installed",
  category: "Software",
  severity: "high",
  platforms: ["linux", "darwin", "win32", "android"],
  why: "These versions have flaws attackers actively use, and the fixed versions are out.",
  async run(host): Promise<CheckOutcome[]> {
    const out: CheckOutcome[] = [];
    if (host.platform === "win32") {
      const list = await powershellJson<{ DisplayName?: string; DisplayVersion?: string }[] | { DisplayName?: string; DisplayVersion?: string }>(
        host,
        "$p = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'; Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName, DisplayVersion",
      );
      const apps = list === null ? [] : Array.isArray(list) ? list : [list];
      const hasWinget = !!(await host.which("winget"));
      for (const rule of KNOWN_BAD) {
        const app = apps.find((a) => a.DisplayName && rule.match.test(a.DisplayName) && a.DisplayVersion);
        if (!app) continue;
        const v = normalizeAppVersion(app.DisplayVersion!);
        if (!rule.vulnerable(v)) continue;
        out.push(
          fail(`${rule.product} ${v} is installed.`, {
            subject: rule.product,
            title: `${rule.product} ${v} has known, exploited flaws`,
            severity: rule.severity,
            cves: rule.cves,
            evidence: [`${app.DisplayName} (${app.DisplayVersion})`, rule.why],
            auto: hasWinget && rule.winget ? { fixId: "software.update.winget", params: { apps: [{ id: rule.winget, cask: false, name: rule.product }] } } : undefined,
            steps: [`Install the latest ${rule.product} from ${rule.download}${rule.winget ? ` (or: winget upgrade --id ${rule.winget} --exact)` : ""}.`],
          }),
        );
      }
    }
    if (host.platform !== "win32" && (await host.which("xz"))) {
      const r = await host.exec("xz", ["--version"]);
      const v = r.stdout.match(/xz \(XZ Utils\) (\d+\.\d+\.\d+)/)?.[1];
      if (v === "5.6.0" || v === "5.6.1") {
        const brew = await brewRunner(host);
        const viaBrew = brew && (await host.which("xz"))?.startsWith(path.dirname(brew.bin));
        out.push(
          fail(`xz ${v} is installed: the release with the hidden SSH backdoor.`, {
            subject: "xz",
            title: "xz 5.6.0/5.6.1 with the backdoor (CVE-2024-3094)",
            severity: "critical",
            cves: ["CVE-2024-3094"],
            evidence: [r.stdout.split("\n")[0], "These releases were sabotaged to let one attacker log in through SSH on affected Linux systems."],
            auto: viaBrew ? { fixId: "software.update.brew", params: { apps: [{ id: "xz", cask: false, name: "xz" }] } } : undefined,
            steps: ["Update xz-utils/liblzma right away (Debian/Ubuntu: sudo apt update && sudo apt install --only-upgrade xz-utils liblzma5; Fedora: sudo dnf upgrade xz; Homebrew: brew upgrade xz).", "If the machine ran 5.6.0/5.6.1 with SSH open to the internet, treat it as possibly compromised."],
          }),
        );
      }
    }
    return out.length ? out : [pass(host.platform === "win32" ? "No known-exploited versions of 7-Zip, WinRAR or PuTTY found." : "No known-exploited xz version found.")];
  },
};

export const installedChecks: Check[] = [osSupportCheck, runtimesCheck, outdatedAppsCheck, knownVulnerableCheck];

