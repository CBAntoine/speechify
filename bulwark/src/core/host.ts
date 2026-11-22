import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ExecResult, FileStat, Host, Platform } from "./types.ts";

function toStat(s: import("node:fs").Stats): FileStat {
  return {
    mode: s.mode & 0o7777,
    uid: s.uid,
    gid: s.gid,
    size: s.size,
    mtimeMs: s.mtimeMs,
    isFile: s.isFile(),
    isDir: s.isDirectory(),
    isSymlink: s.isSymbolicLink(),
  };
}

const SBIN_DIRS = ["/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin", "/opt/homebrew/bin", "/opt/homebrew/sbin"];

/** Runs a command without a shell. Never throws: a missing program is exit code 127. */
export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; env?: Record<string, string>; input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve) => {
    const env: Record<string, string | undefined> = { ...process.env, ...opts.env };
    if (process.platform !== "win32") {
      // Tools like ufw, apt and systemctl print localized text otherwise, and we parse it.
      env.LC_ALL = "C";
      env.LANG = "C";
      // Non-root shells often lack sbin directories, where most admin tools live.
      const parts = (env.PATH ?? "").split(":").filter(Boolean);
      for (const d of SBIN_DIRS) if (!parts.includes(d)) parts.push(d);
      env.PATH = parts.join(":");
    }
    const child = execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 30_000, maxBuffer: 32 * 1024 * 1024, env, windowsHide: true, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          resolve({ code: 127, stdout: "", stderr: `${cmd}: not found` });
          return;
        }
        const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : err.killed ? 124 : 1) : 0;
        resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
    if (opts.input !== undefined) {
      child.stdin?.end(opts.input);
    }
  });
}

function detectRoot(): boolean {
  if (process.platform === "win32") return false; // filled in by createHost via `net session`
  return typeof process.getuid === "function" && process.getuid() === 0;
}

export async function isWindowsAdmin(): Promise<boolean> {
  const r = await run("net", ["session"], { timeoutMs: 5000 });
  return r.code === 0;
}

/** The real machine this process runs on. */
export async function createHost(): Promise<Host> {
  const platform = process.platform as Platform;
  const isRoot = platform === "win32" ? await isWindowsAdmin() : detectRoot();
  const whichCache = new Map<string, string | null>();

  const host: Host = {
    platform,
    isRoot,
    hostname: os.hostname(),
    env: process.env,
    async readFile(p) {
      try {
        return await fs.readFile(p, "utf8");
      } catch {
        return null;
      }
    },
    async readDir(p) {
      try {
        return (await fs.readdir(p)).sort();
      } catch {
        return null;
      }
    },
    async stat(p) {
      try {
        return toStat(await fs.stat(p));
      } catch {
        return null;
      }
    },
    async lstat(p) {
      try {
        return toStat(await fs.lstat(p));
      } catch {
        return null;
      }
    },
    async readlink(p) {
      try {
        return await fs.readlink(p);
      } catch {
        return null;
      }
    },
    exec: (cmd, args, opts) => run(cmd, args, opts),
    async which(cmd) {
      if (whichCache.has(cmd)) return whichCache.get(cmd)!;
      let found: string | null = null;
      if (platform === "win32") {
        const r = await run("where", [cmd], { timeoutMs: 5000 });
        found = r.code === 0 ? r.stdout.split(/\r?\n/)[0].trim() || null : null;
      } else {
        const dirs = [...(process.env.PATH ?? "").split(":"), ...SBIN_DIRS];
        for (const d of dirs) {
          if (!d) continue;
          const candidate = path.join(d, cmd);
          try {
            await fs.access(candidate, fs.constants.X_OK);
            found = candidate;
            break;
          } catch {
            /* keep looking */
          }
        }
      }
      whichCache.set(cmd, found);
      return found;
    },
    async writeFile(p, content, mode) {
      // Writing in place keeps the owner, group, ACLs and SELinux label of an existing file.
      let existed = true;
      try {
        await fs.access(p);
      } catch {
        existed = false;
      }
      if (!existed) await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content, existed ? undefined : { mode: mode ?? 0o644 });
      if (mode !== undefined) await fs.chmod(p, mode);
    },
    async chmod(p, mode) {
      await fs.chmod(p, mode);
    },
    async remove(p) {
      await fs.rm(p, { force: true });
    },
    async mkdirp(p) {
      await fs.mkdir(p, { recursive: true });
    },
  };
  return host;
}

/** OS name for display, e.g. "Ubuntu 24.04.5 LTS" or "macOS 15.1". */
export async function describeOs(host: Host): Promise<string> {
  if (host.platform === "linux") {
    const rel = await host.readFile("/etc/os-release");
    const m = rel?.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    return m ? m[1] : `Linux ${os.release()}`;
  }
  if (host.platform === "darwin") {
    const r = await host.exec("sw_vers", ["-productVersion"]);
    return r.code === 0 ? `macOS ${r.stdout.trim()}` : "macOS";
  }
  const r = await host.exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-CimInstance Win32_OperatingSystem).Caption"]);
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : `Windows ${os.release()}`;
}

/** Runs a PowerShell snippet and parses its JSON output. Returns null if PowerShell failed. */
export async function powershellJson<T = unknown>(host: Host, script: string, timeoutMs = 60_000): Promise<T | null> {
  const wrapped = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; ${script} | ConvertTo-Json -Depth 5 -Compress`;
  const encoded = Buffer.from(wrapped, "utf16le").toString("base64");
  const r = await host.exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { timeoutMs });
  if (r.code !== 0) return null;
  const text = r.stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** The argv for running a PowerShell command as a fix step, so the journal can replay it. */
export function powershellSpec(script: string): { cmd: string; args: string[]; display: string; timeoutMs: number } {
  const encoded = Buffer.from(`$ErrorActionPreference='Stop'; ${script}`, "utf16le").toString("base64");
  return {
    cmd: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    display: `PowerShell: ${script}`,
    timeoutMs: 120_000,
  };
}
