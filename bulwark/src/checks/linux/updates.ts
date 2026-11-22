import type { Check, CheckOutcome, Fix, Host } from "../../core/types.ts";
import { aptInstall, enableUnit, fail, hasSystemd, isDebianLike, isRedHatLike, pass, skip, unitState } from "../common.ts";

export interface PendingUpdate {
  name: string;
  from?: string;
  to: string;
  security: boolean;
}

/** Parses `apt-get -s upgrade` output ("Inst pkg [old] (new origins [arch])"). */
export function parseAptSimulation(text: string): PendingUpdate[] {
  const out: PendingUpdate[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^Inst (\S+) (?:\[([^\]]+)\] )?\((\S+) ([^)]*)\)/);
    if (!m) continue;
    const origins = m[4].replace(/\s*\[[^\]]*\]\s*$/, "");
    out.push({ name: m[1], from: m[2], to: m[3], security: /security/i.test(origins) });
  }
  return out;
}

async function aptListsAgeDays(host: Host): Promise<number | null> {
  const stamp = await host.stat("/var/lib/apt/periodic/update-success-stamp");
  let newest = stamp?.mtimeMs ?? 0;
  for (const f of (await host.readDir("/var/lib/apt/lists")) ?? []) {
    if (!f.endsWith("Release")) continue;
    const st = await host.stat(`/var/lib/apt/lists/${f}`);
    if (st && st.mtimeMs > newest) newest = st.mtimeMs;
  }
  if (!newest) return null;
  return Math.floor((Date.now() - newest) / 86_400_000);
}

export async function aptPending(host: Host): Promise<PendingUpdate[] | null> {
  const r = await host.exec("apt-get", ["-s", "-o", "Debug::NoLocking=1", "upgrade", "--with-new-pkgs"], { timeoutMs: 120_000 });
  if (r.code !== 0) return null;
  return parseAptSimulation(r.stdout);
}

async function dnfPendingSecurity(host: Host): Promise<string[] | null> {
  const r = await host.exec("dnf", ["-q", "check-update", "--security"], { timeoutMs: 300_000 });
  if (r.code !== 0 && r.code !== 100) return null;
  return r.stdout
    .split("\n")
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f.length === 3 && /\.\w+$/.test(f[0]) && !/^(Obsoleting|Security:)/.test(f[0]))
    .map((f) => f[0]);
}

export const linuxSecurityUpdates: Check = {
  id: "linux.updates.security",
  title: "Security updates are waiting",
  category: "Updates",
  severity: "high",
  platforms: ["linux"],
  why: "Most break-ins use bugs that already have a fix. Each waiting security update is a known hole that stays open until it's installed.",
  steps: ["Debian, Ubuntu, Raspberry Pi OS: sudo apt update && sudo apt upgrade", "Fedora and RHEL: sudo dnf upgrade --security"],
  async run(host) {
    if (await isDebianLike(host)) {
      const pending = await aptPending(host);
      if (!pending) return [skip("Couldn't ask apt which updates are waiting.")];
      const age = await aptListsAgeDays(host);
      const stale = age !== null && age > 7 ? ` The package lists are ${age} days old, so there may be more.` : "";
      const sec = pending.filter((p) => p.security);
      const evidence = sec.slice(0, 40).map((p) => `${p.name} ${p.from ?? "?"} → ${p.to}`);
      if (sec.length) {
        return [
          fail(`${sec.length} security update${sec.length === 1 ? " is" : "s are"} waiting (${sec.slice(0, 4).map((p) => p.name).join(", ")}${sec.length > 4 ? "…" : ""}).${stale}`, {
            evidence,
            auto: { fixId: "linux.updates.install-security" },
          }),
        ];
      }
      if (age !== null && age > 14) {
        return [
          fail(`The package lists haven't been refreshed in ${age} days, so Bulwark can't tell which security updates are out.`, {
            severity: "medium",
            auto: { fixId: "linux.updates.install-security" },
          }),
        ];
      }
      const other = pending.length ? ` (${pending.length} non-security update${pending.length === 1 ? " is" : "s are"} available too.)` : "";
      return [pass(`No security updates are waiting.${other}`)];
    }
    if (await isRedHatLike(host)) {
      const sec = await dnfPendingSecurity(host);
      if (!sec) return [skip("Couldn't ask dnf which updates are waiting.")];
      if (sec.length) {
        return [fail(`${sec.length} security update${sec.length === 1 ? " is" : "s are"} waiting.`, { evidence: sec.slice(0, 40), auto: { fixId: "linux.updates.install-security" } })];
      }
      return [pass("No security updates are waiting.")];
    }
    return [skip("Bulwark doesn't know this Linux distribution's package manager yet.")];
  },
};

const APT_ENV = { DEBIAN_FRONTEND: "noninteractive", NEEDRESTART_MODE: "a" };

export const installSecurityUpdatesFix: Fix = {
  id: "linux.updates.install-security",
  title: () => "Install the waiting security updates",
  needsRoot: true,
  risk: "caution",
  reversible: false,
  async warnings({ host }) {
    const w = ["Updates can't be uninstalled automatically.", "Services that use updated libraries are restarted, which briefly interrupts them."];
    if (await isDebianLike(host)) w.push("Your own changes to configuration files are kept when a package ships a new version of them.");
    return w;
  },
  async apply(tx, { host }) {
    if (await isRedHatLike(host)) {
      await tx.exec({ cmd: "dnf", args: ["-y", "upgrade", "--security"], timeoutMs: 1_800_000 }, { title: "Install security updates with dnf", undo: null });
      return;
    }
    await tx.exec({ cmd: "apt-get", args: ["update"], env: APT_ENV, timeoutMs: 600_000 }, { title: "Refresh the package lists", readOnly: true });
    const pending = (await aptPending(host)) ?? [];
    const names = pending.filter((p) => p.security).map((p) => p.name);
    if (tx.dryRun && names.length === 0) tx.note("The list of updates is worked out again after refreshing.");
    if (!tx.dryRun && names.length === 0) {
      tx.note("No security updates are waiting after refreshing the lists.");
      return;
    }
    await tx.exec(
      {
        cmd: "apt-get",
        args: ["install", "-y", "--only-upgrade", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold", ...names],
        env: APT_ENV,
        timeoutMs: 1_800_000,
        display: `apt-get install --only-upgrade ${names.length ? names.join(" ") : "<security updates>"}`,
      },
      { title: `Install ${names.length || "the"} security update${names.length === 1 ? "" : "s"}`, undo: null },
    );
  },
};

// ── automatic updates ──

const AUTO_FILE = "/etc/apt/apt.conf.d/20auto-upgrades";
const AUTO_KEYS = ["APT::Periodic::Update-Package-Lists", "APT::Periodic::Unattended-Upgrade"];

export function parseAptConfig(text: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`^${esc}\\s+"([^"]*)";`, "m"));
  return m ? m[1] : null;
}

async function dpkgInstalled(host: Host, pkg: string): Promise<boolean> {
  const r = await host.exec("dpkg-query", ["-W", "-f", "${Status}", pkg]);
  return r.code === 0 && /install ok installed/.test(r.stdout);
}

export const linuxAutoUpdates: Check = {
  id: "linux.updates.automatic",
  title: "Security updates aren't installed automatically",
  category: "Updates",
  severity: "medium",
  platforms: ["linux"],
  why: "Devices nobody logs into, like a Raspberry Pi in a cupboard, only get fixes if they install them on their own.",
  steps: [
    "Debian, Ubuntu, Raspberry Pi OS: sudo apt install unattended-upgrades && sudo dpkg-reconfigure -plow unattended-upgrades",
    "Fedora and RHEL: sudo dnf install dnf-automatic, set apply_updates = yes in /etc/dnf/automatic.conf, then sudo systemctl enable --now dnf-automatic.timer",
  ],
  async run(host) {
    if (await isDebianLike(host)) {
      const installed = await dpkgInstalled(host, "unattended-upgrades");
      const dump = (await host.exec("apt-config", ["dump"])).stdout;
      const values = AUTO_KEYS.map((k) => [k, parseAptConfig(dump, k)] as const);
      const off = values.filter(([, v]) => !v || v === "0");
      const timersOff: string[] = [];
      if (await hasSystemd(host)) {
        for (const t of ["apt-daily.timer", "apt-daily-upgrade.timer"]) {
          const st = await unitState(host, t);
          if (st.exists && !st.enabled) timersOff.push(t);
        }
      }
      const evidence = [
        `unattended-upgrades ${installed ? "installed" : "not installed"}`,
        ...values.map(([k, v]) => `${k} "${v ?? "unset"}"`),
        ...timersOff.map((t) => `${t} is disabled`),
      ];
      if (!installed || off.length || timersOff.length) {
        const why = !installed ? "unattended-upgrades isn't installed" : off.length ? "automatic upgrades are switched off in apt's settings" : "the timers that run them are disabled";
        return [fail(`Security updates only get installed when someone runs them by hand (${why}).`, { evidence, auto: { fixId: "linux.updates.enable-automatic" } })];
      }
      return [pass("Security updates install automatically (unattended-upgrades).", { evidence })];
    }
    if (await isRedHatLike(host)) {
      for (const t of ["dnf-automatic-install.timer", "dnf-automatic.timer", "dnf5-automatic.timer"]) {
        const st = await unitState(host, t);
        if (st.exists && st.enabled) return [pass(`${t} is on.`)];
      }
      return [fail("No dnf-automatic timer is turned on.")];
    }
    return [skip("Bulwark doesn't know how this distribution installs updates automatically.")];
  },
};

function setAptKeys(content: string, values: Record<string, string>): string {
  const lines = content === "" ? [] : content.split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const seen = new Set<string>();
  const out = lines.map((l) => {
    for (const [k, v] of Object.entries(values)) {
      if (l.trim().startsWith(k + " ") || l.trim().startsWith(k + "\t")) {
        seen.add(k);
        return `${k} "${v}";`;
      }
    }
    return l;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k} "${v}";`);
  return out.join("\n") + "\n";
}

export const enableAutoUpdatesFix: Fix = {
  id: "linux.updates.enable-automatic",
  title: () => "Install security updates automatically every day",
  needsRoot: true,
  // Not part of "fix everything": it installs a package and changes what the machine does every day.
  risk: "caution",
  reversible: true,
  async warnings() {
    return ["From now on the device installs security updates by itself once a day, and restarts the services they affect. It doesn't restart the machine."];
  },
  async preconditions({ host }) {
    return (await isDebianLike(host)) ? [] : [{ ok: false, message: "Bulwark can only set this up on Debian-based systems so far." }];
  },
  async apply(tx, { host }) {
    await aptInstall(tx, host, "unattended-upgrades", "Install unattended-upgrades");
    const wanted = Object.fromEntries(AUTO_KEYS.map((k) => [k, "1"]));
    const current = (await host.readFile(AUTO_FILE)) ?? "";
    await tx.writeFile(AUTO_FILE, setAptKeys(current, wanted), { mode: 0o644 });
    // Files read later override earlier ones, so a later "0" would switch it off again.
    const dir = "/etc/apt/apt.conf.d";
    for (const f of ((await host.readDir(dir)) ?? []).filter((f) => f > "20auto-upgrades")) {
      const path = `${dir}/${f}`;
      const text = await host.readFile(path);
      if (!text) continue;
      let changed = false;
      const lines = text.split("\n").map((l) => {
        if (AUTO_KEYS.some((k) => l.trim().startsWith(k)) && /"0"/.test(l)) {
          changed = true;
          return `// ${l}  // turned off by Bulwark, see ${AUTO_FILE}`;
        }
        return l;
      });
      if (changed) await tx.writeFile(path, lines.join("\n"));
    }
    if (await hasSystemd(host)) {
      for (const t of ["apt-daily.timer", "apt-daily-upgrade.timer"]) {
        const st = await unitState(host, t);
        if (st.exists && !(st.enabled && st.active)) await enableUnit(tx, host, t);
      }
    }
  },
};

// ── restart needed ──

export const linuxRebootRequired: Check = {
  id: "linux.reboot-required",
  title: "Installed updates need a restart",
  category: "Updates",
  severity: "medium",
  platforms: ["linux"],
  why: "Kernel and core library fixes only take effect after a restart. Until then the device still runs the old, vulnerable code.",
  steps: ["Restart when it suits you: sudo reboot"],
  async run(host): Promise<CheckOutcome[]> {
    for (const p of ["/run/reboot-required", "/var/run/reboot-required"]) {
      if (await host.stat(p)) {
        const pkgs = ((await host.readFile(`${p}.pkgs`)) ?? "").split("\n").filter(Boolean);
        return [fail(`A restart is needed to finish installing updates${pkgs.length ? ` (${[...new Set(pkgs)].slice(0, 5).join(", ")})` : ""}.`, { evidence: pkgs })];
      }
    }
    if (await isRedHatLike(host)) {
      const r = await host.exec("needs-restarting", ["-r"]);
      if (r.code === 1) return [fail("A restart is needed to finish installing updates.", { evidence: r.stdout.split("\n").filter(Boolean) })];
      if (r.code === 0) return [pass("No restart is needed.")];
      return [skip("needs-restarting isn't installed.")];
    }
    if (await isDebianLike(host)) return [pass("No restart is needed.")];
    return [skip("Can't tell on this distribution.")];
  },
};
