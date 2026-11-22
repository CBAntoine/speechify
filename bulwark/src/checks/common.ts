// Helpers shared by checks and fixes.

import type { CheckOutcome, ExecSpec, Host, TxApi } from "../core/types.ts";

export const pass = (summary: string, extra: Partial<CheckOutcome> = {}): CheckOutcome => ({ status: "pass", summary, ...extra });
export const fail = (summary: string, extra: Partial<CheckOutcome> = {}): CheckOutcome => ({ status: "fail", summary, ...extra });
export const skip = (summary: string, extra: Partial<CheckOutcome> = {}): CheckOutcome => ({ status: "skipped", summary, ...extra });
export const needsAdmin = (what: string): CheckOutcome =>
  skip(`Bulwark needs admin rights to check ${what}. Run it with sudo (or as Administrator) to include this.`);

// ── OS details ──

export interface OsRelease {
  id: string;
  idLike: string[];
  versionId: string;
  codename: string;
  pretty: string;
}

export async function osRelease(host: Host): Promise<OsRelease> {
  const text = (await host.readFile("/etc/os-release")) ?? "";
  const get = (k: string) => text.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1] ?? "";
  return {
    id: get("ID").toLowerCase(),
    idLike: get("ID_LIKE").toLowerCase().split(/\s+/).filter(Boolean),
    versionId: get("VERSION_ID"),
    codename: get("VERSION_CODENAME"),
    pretty: get("PRETTY_NAME"),
  };
}

export async function isDebianLike(host: Host): Promise<boolean> {
  const r = await osRelease(host);
  return r.id === "debian" || r.id === "ubuntu" || r.idLike.includes("debian") || r.idLike.includes("ubuntu") || (await host.stat("/usr/bin/dpkg")) !== null;
}

export async function isRedHatLike(host: Host): Promise<boolean> {
  const r = await osRelease(host);
  return ["fedora", "rhel", "centos", "rocky", "almalinux"].includes(r.id) || r.idLike.some((x) => ["fedora", "rhel", "centos"].includes(x));
}

// ── systemd ──

export async function hasSystemd(host: Host): Promise<boolean> {
  return (await host.stat("/run/systemd/system")) !== null;
}

export interface UnitState {
  exists: boolean;
  active: boolean;
  enabled: boolean;
  unitFileState: string;
  activeState: string;
}

export async function unitState(host: Host, unit: string): Promise<UnitState> {
  const r = await host.exec("systemctl", ["show", "--no-pager", "-p", "LoadState", "-p", "ActiveState", "-p", "UnitFileState", unit]);
  const get = (k: string) => r.stdout.match(new RegExp(`^${k}=(.*)$`, "m"))?.[1]?.trim() ?? "";
  const load = get("LoadState");
  const activeState = get("ActiveState");
  const unitFileState = get("UnitFileState");
  return {
    exists: r.code === 0 && load !== "" && load !== "not-found",
    active: activeState === "active" || activeState === "activating" || activeState === "reloading",
    enabled: unitFileState === "enabled" || unitFileState === "enabled-runtime" || unitFileState === "static" || unitFileState === "alias",
    unitFileState,
    activeState,
  };
}

const systemctl = (...args: string[]): ExecSpec => ({ cmd: "systemctl", args });

/** Stops and disables a unit, recording how to bring it back exactly as it was. */
export async function disableUnit(tx: TxApi, host: Host, unit: string): Promise<void> {
  const st = await unitState(host, unit);
  const undoArgs: string[] = [];
  if (st.enabled && st.unitFileState !== "static") undoArgs.push("enable");
  if (st.active) undoArgs.push(undoArgs.length ? "--now" : "start");
  const undo = undoArgs.length === 0 ? null : undoArgs[0] === "start" ? systemctl("start", unit) : systemctl(...undoArgs, unit);
  if (st.unitFileState === "static") {
    await tx.exec(systemctl("stop", unit), { title: `Stop ${unit}`, undo: st.active ? systemctl("start", unit) : null });
    await tx.exec(systemctl("mask", unit), { title: `Keep ${unit} from starting again`, undo: systemctl("unmask", unit) });
    return;
  }
  await tx.exec(systemctl("disable", "--now", unit), { title: `Stop ${unit} and keep it from starting at boot`, undo });
}

export async function enableUnit(tx: TxApi, host: Host, unit: string, title?: string): Promise<void> {
  const st = await unitState(host, unit);
  if (st.enabled && st.active) return;
  const undo: ExecSpec | null = !st.enabled && !st.active ? systemctl("disable", "--now", unit) : !st.enabled ? systemctl("disable", unit) : systemctl("stop", unit);
  await tx.exec(systemctl("enable", "--now", unit), { title: title ?? `Start ${unit} and turn it on at boot`, undo });
}

// ── accounts ──

export interface PasswdEntry {
  name: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
}

export function parsePasswd(text: string): PasswdEntry[] {
  return text
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(":"))
    .filter((f) => f.length >= 7)
    .map((f) => ({ name: f[0], uid: Number(f[2]), gid: Number(f[3]), home: f[5], shell: f[6] }));
}

export interface ShadowEntry {
  name: string;
  hash: string;
  lastChange: string;
}

export function parseShadow(text: string): ShadowEntry[] {
  return text
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(":"))
    .filter((f) => f.length >= 3)
    .map((f) => ({ name: f[0], hash: f[1], lastChange: f[2] }));
}

const NOLOGIN = /(nologin|\/false|\/sync|\/shutdown|\/halt)$/;

export function canLogIn(e: PasswdEntry): boolean {
  return !!e.shell && !NOLOGIN.test(e.shell);
}

/** A password hash that can actually be used to log in (not locked, not empty). */
export function usableHash(hash: string): boolean {
  return hash.length > 0 && !hash.startsWith("!") && !hash.startsWith("*");
}

/** People who can log in, with their home directories. */
export async function loginAccounts(host: Host): Promise<PasswdEntry[]> {
  if (host.platform === "darwin") {
    const users = ((await host.readDir("/Users")) ?? []).filter((u) => !u.startsWith(".") && u !== "Shared" && u !== "Guest");
    return [{ name: "root", uid: 0, gid: 0, home: "/var/root", shell: "/bin/sh" }, ...users.map((u) => ({ name: u, uid: -1, gid: -1, home: `/Users/${u}`, shell: "/bin/zsh" }))];
  }
  const text = await host.readFile("/etc/passwd");
  return text ? parsePasswd(text).filter(canLogIn) : [];
}

// ── packages ──

/**
 * Installs a Debian package as one step of a fix. Undo returns to exactly what was there before:
 * a purge when the package was never on the machine, a plain remove when its old settings were.
 */
export async function aptInstall(tx: TxApi, host: Host, pkg: string, title: string): Promise<void> {
  const st = await host.exec("dpkg-query", ["-W", "-f", "${Status}", pkg]);
  if (st.code === 0 && /install ok installed/.test(st.stdout)) return;
  const leftovers = st.code === 0 && /config-files/.test(st.stdout);
  const env = { DEBIAN_FRONTEND: "noninteractive" };
  await tx.exec(
    { cmd: "apt-get", args: ["install", "-y", pkg], env, timeoutMs: 600_000 },
    { title, undo: { cmd: "apt-get", args: [leftovers ? "remove" : "purge", "-y", pkg], env, timeoutMs: 600_000 } },
  );
}
