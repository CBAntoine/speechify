import type { Check, CheckOutcome, Fix, Host, Severity } from "../../core/types.ts";
import { fail, pass, skip } from "../common.ts";

interface Setting {
  key: string;
  ok: (v: string) => boolean;
  set: string;
  severity: Severity;
  /** What's wrong, as a sentence fragment. */
  problem: string;
  why: string;
}

const atLeast = (n: number) => (v: string) => Number(v) >= n;
const equals = (s: string) => (v: string) => v === s;

export const SETTINGS: Setting[] = [
  { key: "kernel.randomize_va_space", ok: equals("2"), set: "2", severity: "high", problem: "Memory layout randomization (ASLR) is weakened or off", why: "Randomizing where programs live in memory makes most memory-corruption bugs much harder to exploit." },
  { key: "fs.protected_symlinks", ok: equals("1"), set: "1", severity: "medium", problem: "Symlink protection is off", why: "Stops a classic trick where a user plants a symlink in /tmp to make a root program overwrite system files." },
  { key: "fs.protected_hardlinks", ok: equals("1"), set: "1", severity: "medium", problem: "Hardlink protection is off", why: "Stops users from hardlinking to files they don't own, a common step in privilege escalation." },
  { key: "fs.suid_dumpable", ok: (v) => v !== "1", set: "0", severity: "low", problem: "Privileged programs can leave readable memory dumps", why: "With this at 1, crashes of programs that run with extra privileges write memory dumps, with any passwords and keys in them, that users can read." },
  { key: "kernel.kptr_restrict", ok: atLeast(1), set: "1", severity: "low", problem: "Kernel memory addresses are visible to every user", why: "Kernel exploits need to know where things are in kernel memory; this hides those addresses from regular users." },
  { key: "kernel.dmesg_restrict", ok: equals("1"), set: "1", severity: "low", problem: "Every user can read the kernel log", why: "The kernel log can leak memory addresses and hardware details to any user." },
  { key: "kernel.yama.ptrace_scope", ok: atLeast(1), set: "1", severity: "low", problem: "Programs can read the memory of other programs (ptrace)", why: "Stops a compromised program from reading the memory of your other programs, like a browser or SSH agent." },
  { key: "kernel.unprivileged_bpf_disabled", ok: atLeast(1), set: "2", severity: "low", problem: "Every user can load BPF programs into the kernel", why: "Unprivileged BPF has been the entry point for many kernel exploits." },
  { key: "net.ipv4.tcp_syncookies", ok: equals("1"), set: "1", severity: "low", problem: "SYN flood protection is off", why: "SYN cookies keep the device reachable during a SYN flood." },
  { key: "net.ipv4.conf.all.accept_redirects", ok: equals("0"), set: "0", severity: "low", problem: "The device follows ICMP redirects", why: "ICMP redirects let another device on the network reroute this device's traffic through itself." },
  { key: "net.ipv4.conf.default.accept_redirects", ok: equals("0"), set: "0", severity: "low", problem: "New network interfaces follow ICMP redirects", why: "ICMP redirects let another device on the network reroute this device's traffic through itself." },
  { key: "net.ipv6.conf.all.accept_redirects", ok: equals("0"), set: "0", severity: "low", problem: "The device follows IPv6 redirects", why: "IPv6 redirects let another device on the network reroute this device's traffic through itself." },
  { key: "net.ipv4.conf.all.accept_source_route", ok: equals("0"), set: "0", severity: "low", problem: "The device accepts source-routed packets", why: "Source routing lets the sender choose the path a packet takes, which helps get around firewalls." },
  { key: "net.ipv4.conf.all.send_redirects", ok: equals("0"), set: "0", severity: "low", problem: "The device sends ICMP redirects like a router", why: "Only routers should send redirects; on other devices they help an attacker map and misdirect the network." },
];

export const SYSCTL_FILE = "/etc/sysctl.d/99-zz-bulwark.conf";

const procPath = (key: string) => `/proc/sys/${key.replace(/\./g, "/")}`;

export async function readSysctl(host: Host, key: string): Promise<string | null> {
  const v = await host.readFile(procPath(key));
  return v === null ? null : v.trim().split(/\s+/).join(" ");
}

export const kernelHardening: Check = {
  id: "linux.kernel.sysctl",
  title: "Kernel hardening setting is off",
  category: "Kernel",
  severity: "low",
  platforms: ["linux"],
  why: "These kernel settings close off whole classes of attacks. Most distributions turn them on; some devices and older images don't.",
  async run(host) {
    const out: CheckOutcome[] = [];
    let checked = 0;
    for (const s of SETTINGS) {
      const v = await readSysctl(host, s.key);
      if (v === null) continue;
      checked++;
      if (s.ok(v)) continue;
      out.push(
        fail(`${s.problem} (${s.key} = ${v}).`, {
          subject: s.key,
          title: s.problem,
          severity: s.severity,
          evidence: [`${s.key} = ${v} (should be ${s.set})`, s.why],
          auto: { fixId: "linux.sysctl.set", params: { settings: { [s.key]: s.set } } },
          steps: [`echo '${s.key} = ${s.set}' | sudo tee -a /etc/sysctl.d/99-hardening.conf && sudo sysctl -w ${s.key}=${s.set}`],
        }),
      );
    }
    if (!checked) return [skip("Couldn't read kernel settings.")];
    return out.length ? out : [pass(`All ${checked} kernel hardening settings Bulwark checks are on.`)];
  },
};

function mergeSysctlFile(content: string, settings: Record<string, string>): string {
  const lines = content === "" ? ["# Managed by Bulwark. Undo with `bulwark rollback`, or delete this file."] : content.split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const seen = new Set<string>();
  const out = lines.map((l) => {
    const m = l.match(/^\s*([\w.\-/]+)\s*=/);
    if (m && m[1] in settings) {
      seen.add(m[1]);
      return `${m[1]} = ${settings[m[1]]}`;
    }
    return l;
  });
  for (const [k, v] of Object.entries(settings)) if (!seen.has(k)) out.push(`${k} = ${v}`);
  return out.join("\n") + "\n";
}

function settingsParam(params: Record<string, unknown>): Record<string, string> {
  const raw = (params.settings ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    // Only the settings Bulwark knows about, with the values it would set.
    const known = SETTINGS.find((s) => s.key === k);
    if (known && String(v) === known.set) out[k] = known.set;
  }
  return out;
}

export const sysctlFix: Fix = {
  id: "linux.sysctl.set",
  title: (p) => {
    const keys = Object.keys(settingsParam(p));
    return keys.length === 1 ? `Set ${keys[0]} = ${settingsParam(p)[keys[0]]}` : `Apply ${keys.length} kernel hardening settings`;
  },
  needsRoot: true,
  risk: "safe",
  reversible: true,
  merge: (all) => ({ settings: Object.assign({}, ...all.map((p) => settingsParam(p))) }),
  async apply(tx, { host, params }) {
    const settings = settingsParam(params);
    if (!Object.keys(settings).length) throw new Error("No known settings to change.");
    const current = (await host.readFile(SYSCTL_FILE)) ?? "";
    await tx.writeFile(SYSCTL_FILE, mergeSysctlFile(current, settings), { mode: 0o644, title: `Keep the settings after restarts (${SYSCTL_FILE})` });
    for (const [k, v] of Object.entries(settings)) {
      const prev = await readSysctl(host, k);
      await tx.exec(
        { cmd: "sysctl", args: ["-w", `${k}=${v}`] },
        { title: `Apply ${k} = ${v} now`, undo: prev === null ? null : { cmd: "sysctl", args: ["-w", `${k}=${prev}`] } },
      );
    }
  },
};
