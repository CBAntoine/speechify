// Checking and fixing another computer on the network over SSH, with the same checks and fixes as
// on this one. The connection uses the system's own ssh client: your keys, your known_hosts. A
// password, if one is needed, is used once to open a shared connection and is never stored.

import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { checkDeviceAddress } from "../android/adb.ts";
import { run } from "../core/host.ts";
import type { ExecOptions, ExecResult, FileStat, Host, Platform } from "../core/types.ts";

export interface SshTarget {
  user: string;
  host: string;
  port: number;
}

/** "pi@192.168.1.40", "pi@nas.local:2222" → its parts. The user name is required. */
export function parseSshTarget(text: string): SshTarget | null {
  const m = text.trim().match(/^(?:ssh:)?([a-z_][a-z0-9_.-]{0,31})@([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?$/i);
  if (!m) return null;
  const port = m[3] ? Number(m[3]) : 22;
  if (port < 1 || port > 65535 || m[2].startsWith("-")) return null;
  return { user: m[1], host: m[2], port };
}

/** The id findings and changes carry: ssh:user@host (plus :port when it isn't 22). */
export const targetId = (t: SshTarget) => `ssh:${t.user}@${t.host}${t.port === 22 ? "" : `:${t.port}`}`;
export const targetLabel = (t: SshTarget) => `${t.user}@${t.host}${t.port === 22 ? "" : `:${t.port}`}`;

/** Single-quotes a word for a POSIX shell (bash, zsh, dash and fish all read it the same way). */
export const shq = (a: string) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);

// Admin tools live in sbin folders that non-login shells often leave off PATH; parsed output must be in English.
const PREAMBLE = 'export LC_ALL=C LANG=C PATH="$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/opt/homebrew/bin:/opt/homebrew/sbin";';

export class SshSession {
  readonly target: SshTarget;
  private readonly ssh: string;
  private readonly controlPath: string | null;
  private readonly controlDir: string;

  constructor(target: SshTarget, opts: { ssh: string; controlDir: string; multiplex: boolean }) {
    this.target = target;
    this.ssh = opts.ssh;
    this.controlDir = opts.controlDir;
    // %C is a hash of the connection details, which keeps the socket path short enough.
    this.controlPath = opts.multiplex ? path.join(opts.controlDir, "%C") : null;
  }

  private baseArgs(): string[] {
    return [
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=10",
      "-o", "ServerAliveInterval=15",
      "-p", String(this.target.port),
      "-l", this.target.user,
    ];
  }

  private commandArgs(command: string): string[] {
    const mux = this.controlPath ? ["-o", `ControlPath=${this.controlPath}`, "-o", "ControlMaster=no"] : [];
    return [...this.baseArgs(), ...mux, "-o", "BatchMode=yes", "-T", "--", this.target.host, command];
  }

  /**
   * Opens the shared connection that later commands reuse. With a password, ssh gets it through a
   * small helper (SSH_ASKPASS) in Bulwark's private folder; with `interactive`, ssh asks in this
   * terminal; otherwise only keys are tried.
   */
  async connect(opts: { password?: string; interactive?: boolean; timeoutMs?: number } = {}): Promise<{ ok: boolean; message: string }> {
    const bad = await checkDeviceAddress(this.target.host);
    if (bad) return { ok: false, message: bad };
    await fs.mkdir(this.controlDir, { recursive: true, mode: 0o700 });
    if (!this.controlPath) {
      const r = await this.run("true");
      return r.code === 0 ? { ok: true, message: "Connected." } : { ok: false, message: sshError(r.stderr, this.target) };
    }
    if (await this.alive()) return { ok: true, message: "Already connected." };
    const env: Record<string, string | undefined> = { ...process.env };
    const args = [...this.baseArgs(), "-o", `ControlPath=${this.controlPath}`, "-o", "ControlMaster=yes", "-o", "ControlPersist=900", "-f", "-N"];
    if (opts.password) {
      const helper = path.join(this.controlDir, "askpass.sh");
      await fs.writeFile(helper, "#!/bin/sh\nprintf '%s\\n' \"$BULWARK_SSH_PASSWORD\"\n", { mode: 0o700 });
      Object.assign(env, { SSH_ASKPASS: helper, SSH_ASKPASS_REQUIRE: "force", DISPLAY: env.DISPLAY ?? ":0", BULWARK_SSH_PASSWORD: opts.password });
      args.push("-o", "NumberOfPasswordPrompts=1", "-o", "PreferredAuthentications=publickey,keyboard-interactive,password");
    } else if (!opts.interactive) args.push("-o", "BatchMode=yes");
    args.push("--", this.target.host);
    const r = await new Promise<{ code: number; stderr: string }>((resolve) => {
      // Detached: without a terminal, ssh uses the helper instead of prompting on Bulwark's own screen.
      const child = spawn(this.ssh, args, { env, detached: !opts.interactive, stdio: opts.interactive ? "inherit" : ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr?.on("data", (d) => (stderr += d));
      const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 60_000);
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ code: 127, stderr: String(e.message) });
      });
      // "exit", not "close": the background connection keeps ssh's output open.
      child.on("exit", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stderr });
      });
    });
    if (r.code !== 0) return { ok: false, message: sshError(r.stderr, this.target, !!opts.password) };
    return (await this.alive()) ? { ok: true, message: "Connected." } : { ok: false, message: "ssh connected, but the shared connection didn't stay open." };
  }

  async alive(): Promise<boolean> {
    if (!this.controlPath) return (await this.run("true")).code === 0;
    const r = await run(this.ssh, [...this.baseArgs(), "-o", `ControlPath=${this.controlPath}`, "-O", "check", "--", this.target.host], { timeoutMs: 10_000 });
    return r.code === 0;
  }

  async close(): Promise<void> {
    if (this.controlPath) await run(this.ssh, [...this.baseArgs(), "-o", `ControlPath=${this.controlPath}`, "-O", "exit", "--", this.target.host], { timeoutMs: 10_000 });
  }

  /** Runs a shell command on the other computer. ssh's own failures come back as exit code 255. */
  run(command: string, opts: { input?: string; timeoutMs?: number } = {}): Promise<ExecResult> {
    return run(this.ssh, this.commandArgs(command), { input: opts.input, timeoutMs: (opts.timeoutMs ?? 30_000) + 10_000 });
  }
}

function sshError(stderr: string, t: SshTarget, withPassword = false): string {
  const text = stderr.trim().split("\n").filter((l) => !/^Warning: Permanently added/.test(l)).join(" ");
  if (/Permission denied/i.test(text)) return withPassword ? `${targetLabel(t)} refused that password.` : `${targetLabel(t)} asked for a password or key Bulwark doesn't have. Enter the password, or set up a key (ssh-copy-id ${targetLabel(t)}).`;
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|Host key verification failed/i.test(text)) return `${t.host}'s identity (host key) has changed since you last connected. That can mean someone is intercepting the connection, or the device was reinstalled. Check, then remove the old key with: ssh-keygen -R ${t.host}`;
  if (/Connection refused/i.test(text)) return `${t.host} doesn't accept SSH connections on port ${t.port}. Turn on SSH (Remote Login on a Mac) and try again.`;
  if (/timed out|No route to host|Could not resolve/i.test(text)) return `Couldn't reach ${t.host}. Is it on and on this network?`;
  return text || "ssh failed.";
}

// ── the other computer as a Host, so every check and fix works on it unchanged ──

export interface RemoteHost extends Host {
  readonly remote: { target: string; label: string; user: string; sudo: boolean; arch: string; session: SshSession };
}

const parseStat = (text: string, darwin: boolean): FileStat | null => {
  const f = text.trim().split(/\s+/);
  if (f.length < 5) return null;
  const raw = parseInt(f[0], darwin ? 8 : 16);
  if (!Number.isFinite(raw)) return null;
  const type = raw & 0o170000;
  return { mode: raw & 0o7777, uid: Number(f[1]), gid: Number(f[2]), size: Number(f[3]), mtimeMs: Number(f[4]) * 1000, isFile: type === 0o100000, isDir: type === 0o040000, isSymlink: type === 0o120000 };
};

/** Looks at the other computer (which system, whether Bulwark has admin rights there) and wraps it as a Host. */
export async function remoteHost(session: SshSession): Promise<RemoteHost> {
  const probe = await session.run(`${PREAMBLE} uname -s; id -u; if [ "$(id -u)" != 0 ] && sudo -n true 2>/dev/null; then echo sudo; else echo nosudo; fi; uname -n; uname -m; echo ---; env`);
  if (probe.code !== 0) throw new Error(probe.code === 255 ? sshError(probe.stderr, session.target) : `Couldn't run commands on ${targetLabel(session.target)}: ${probe.stderr.trim()}`);
  const [head, envText = ""] = probe.stdout.split("\n---\n");
  const [kernel, uid, sudo, hostname, arch] = head.split("\n").map((l) => l.trim());
  const platform: Platform | null = kernel === "Linux" ? "linux" : kernel === "Darwin" ? "darwin" : null;
  if (!platform) throw new Error(`${targetLabel(session.target)} runs ${kernel || "an unknown system"}. Bulwark checks Linux and macOS over SSH; on Windows, run Bulwark on the PC itself.`);
  const env: Record<string, string> = {};
  for (const line of envText.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0 && /^\w+$/.test(line.slice(0, i))) env[line.slice(0, i)] = line.slice(i + 1);
  }
  const root = uid === "0";
  const useSudo = !root && sudo === "sudo";
  const darwin = platform === "darwin";

  const sh = (script: string, opts: { input?: string; timeoutMs?: number } = {}) => {
    const cmd = `sh -c ${shq(`${PREAMBLE} ${script}`)}`;
    return session.run(useSudo ? `sudo -n ${cmd}` : cmd, opts);
  };
  const ok = async (r: Promise<ExecResult>, what: string) => {
    const res = await r;
    if (res.code !== 0) throw new Error(`${what} failed on ${targetLabel(session.target)}: ${res.stderr.trim() || `exit code ${res.code}`}`);
  };
  const statCmd = (p: string, follow: boolean) => (darwin ? `stat ${follow ? "-L " : ""}-f '%p %u %g %z %m' ${shq(p)}` : `stat ${follow ? "-L " : ""}-c '%f %u %g %s %Y' -- ${shq(p)}`);

  return {
    platform,
    isRoot: root || useSudo,
    hostname: hostname || session.target.host,
    env,
    remote: { target: targetId(session.target), label: targetLabel(session.target), user: session.target.user, sudo: useSudo, arch: arch || "?", session },
    async readFile(p) {
      const r = await sh(`cat -- ${shq(p)}`);
      return r.code === 0 ? r.stdout : null;
    },
    async readDir(p) {
      const r = await sh(`ls -1A -- ${shq(p)}`);
      return r.code === 0 ? r.stdout.split("\n").filter(Boolean).sort() : null;
    },
    async stat(p) {
      const r = await sh(statCmd(p, true));
      return r.code === 0 ? parseStat(r.stdout, darwin) : null;
    },
    async lstat(p) {
      const r = await sh(statCmd(p, false));
      return r.code === 0 ? parseStat(r.stdout, darwin) : null;
    },
    async readlink(p) {
      const r = await sh(`readlink -- ${shq(p)}`);
      return r.code === 0 ? r.stdout.replace(/\n$/, "") : null;
    },
    async exec(cmd: string, args: string[], opts: ExecOptions = {}) {
      const env = Object.entries(opts.env ?? {}).map(([k, v]) => `${k}=${shq(v)}`);
      const line = [opts.cwd ? `cd ${shq(opts.cwd)} &&` : "", env.length ? `env ${env.join(" ")}` : "", [cmd, ...args].map(shq).join(" ")].filter(Boolean).join(" ");
      const r = await sh(line, { input: opts.input, timeoutMs: opts.timeoutMs });
      // A missing program is 127, as it is locally.
      return r;
    },
    async which(cmd) {
      if (!/^[\w.+-]+$/.test(cmd)) return null;
      const r = await sh(`command -v ${cmd}`);
      const found = r.stdout.trim().split("\n")[0];
      return r.code === 0 && found.startsWith("/") ? found : null;
    },
    async writeFile(p, content, mode) {
      // Like the local writeFile: an existing file is rewritten in place (keeping its owner and
      // permissions); a new one is created with the given mode (0644 by default).
      const m = mode === undefined ? "" : (mode & 0o7777).toString(8);
      const script = `p=${shq(p)}; if [ -e "$p" ]; then cat > "$p"; else mkdir -p "$(dirname "$p")" && (umask 077; cat > "$p") && chmod ${m || "644"} "$p"; fi${m ? ` && chmod ${m} "$p"` : ""}`;
      await ok(sh(script, { input: content }), `Writing ${p}`);
    },
    async chmod(p, mode) {
      await ok(sh(`chmod ${(mode & 0o7777).toString(8)} -- ${shq(p)}`), `Changing permissions of ${p}`);
    },
    async remove(p) {
      await ok(sh(`rm -f -- ${shq(p)}`), `Removing ${p}`);
    },
    async mkdirp(p) {
      await ok(sh(`mkdir -p -- ${shq(p)}`), `Creating ${p}`);
    },
  };
}

export const isRemote = (h: Host): h is RemoteHost => "remote" in h;

/** The system's ssh client. ControlMaster (one shared connection) works everywhere but Windows. */
export async function findSsh(host: Host): Promise<string | null> {
  const forced = host.env.BULWARK_SSH;
  if (forced !== undefined) return forced && (await host.stat(forced)) ? forced : null;
  return host.which(host.platform === "win32" ? "ssh.exe" : "ssh");
}

const sessions = new Map<string, SshSession>();
let controlDir = path.join(os.homedir(), ".bulwark", "ssh");

/** Where shared-connection sockets go: Bulwark's private state folder. */
export function useStateDir(dir: string): void {
  controlDir = path.join(dir, "ssh");
}

export async function sessionFor(host: Host, target: SshTarget): Promise<SshSession> {
  const id = targetId(target);
  let s = sessions.get(id);
  if (!s) {
    const ssh = await findSsh(host);
    if (!ssh) throw new Error(`ssh isn't installed. ${SSH_INSTALL_HINT}`);
    s = new SshSession(target, { ssh, controlDir, multiplex: host.platform !== "win32" });
    sessions.set(id, s);
  }
  return s;
}

/** Forgets open sessions (tests). */
export function resetSessions(): void {
  sessions.clear();
}

export const SSH_INSTALL_HINT = "Install an SSH client: in Termux, pkg install openssh; on Debian/Ubuntu, sudo apt install openssh-client (macOS and Windows 10+ have one).";
