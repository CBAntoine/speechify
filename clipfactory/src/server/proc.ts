import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { childEnv, pythonExe, PY_DIR } from "./paths.ts";

export class CancelledError extends Error {
  constructor() {
    super("Canceled");
  }
}

export class ToolError extends Error {
  code: number | null;
  stderr: string;
  constructor(message: string, code: number | null, stderr: string) {
    super(message);
    this.code = code;
    this.stderr = stderr;
  }
}

export interface RunOpts {
  cwd?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  /** Called for each complete line on stdout and stderr (\r also ends a line, for progress bars). */
  onLine?: (line: string, stream: "stdout" | "stderr") => void;
  /** Don't throw on a non-zero exit. */
  allowFail?: boolean;
  timeoutMs?: number;
  /** Keep the whole stdout (default) or only its tail. */
  keepStdout?: boolean;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const TAIL = 64 * 1024;

export function run(cmd: string, args: string[], opts: RunOpts = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new CancelledError());
    // A synchronous throw here rejects the promise.
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: childEnv(opts.env),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const keepAll = opts.keepStdout !== false;
    const buffers = { stdout: "", stderr: "" };

    const feed = (stream: "stdout" | "stderr", chunk: string) => {
      if (stream === "stdout") {
        stdout += chunk;
        if (!keepAll && stdout.length > TAIL * 2) stdout = stdout.slice(-TAIL);
      } else {
        stderr += chunk;
        if (stderr.length > TAIL * 2) stderr = stderr.slice(-TAIL);
      }
      if (!opts.onLine) return;
      buffers[stream] += chunk;
      const parts = buffers[stream].split(/\r\n|\n|\r/);
      buffers[stream] = parts.pop() ?? "";
      for (const line of parts) if (line.trim()) opts.onLine(line, stream);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => feed("stdout", c));
    child.stderr.on("data", (c: string) => feed("stderr", c));

    let killed = false;
    const kill = () => {
      if (killed || child.exitCode !== null) return;
      killed = true;
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 3000).unref();
    };
    const onAbort = () => kill();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = opts.timeoutMs ? setTimeout(kill, opts.timeoutMs) : null;

    child.on("error", (err: NodeJS.ErrnoException) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
      if (err.code === "ENOENT") reject(new ToolError(`${path.basename(cmd)} isn't installed or isn't on PATH`, null, ""));
      else reject(err);
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (timer) clearTimeout(timer);
      for (const s of ["stdout", "stderr"] as const) if (buffers[s].trim() && opts.onLine) opts.onLine(buffers[s], s);
      if (opts.signal?.aborted) return reject(new CancelledError());
      if (code !== 0 && !opts.allowFail) {
        const last = stderr.trim().split(/\r?\n/).slice(-6).join("\n");
        return reject(new ToolError(`${path.basename(cmd)} exited with code ${code}${last ? `: ${last}` : ""}`, code, stderr));
      }
      resolve({ code, stdout, stderr });
    });
  });
}

/** Look a command up on the app's PATH (venv and tools first). */
export function which(cmd: string): string | null {
  const env = childEnv();
  const exts = process.platform === "win32" ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";") : [""];
  for (const dir of (env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, cmd + ext);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        if (fs.statSync(full).isFile()) return full;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

// ── FFmpeg ───────────────────────────────────────────────────────────

export interface FfOpts extends RunOpts {
  /** Output duration in seconds, for progress. */
  duration?: number;
  onProgress?: (fraction: number) => void;
}

export async function ffmpeg(args: string[], opts: FfOpts = {}): Promise<RunResult> {
  const { duration, onProgress, onLine, ...rest } = opts;
  return run("ffmpeg", ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", ...args], {
    ...rest,
    keepStdout: false,
    onLine: (line, stream) => {
      if (stream === "stdout") {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
        if (m && duration && onProgress) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
        if (line === "progress=end" && onProgress) onProgress(1);
        return;
      }
      onLine?.(line, stream);
    },
  });
}

export interface ProbeStream {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  tags?: Record<string, string>;
}

export interface Probe {
  format: { duration?: string; format_name?: string; tags?: Record<string, string>; size?: string };
  streams: ProbeStream[];
}

export async function ffprobe(file: string, signal?: AbortSignal): Promise<Probe> {
  const { stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { signal });
  return JSON.parse(stdout) as Probe;
}

export function fps(rate?: string): number {
  if (!rate) return 0;
  const [a, b] = rate.split("/").map(Number);
  return b ? a / b : a || 0;
}

// ── Python helpers (py/*.py) ─────────────────────────────────────────

export type PyEvent = { type: string; [k: string]: unknown };

/** Run py/<script>.py. Lines that are JSON objects are events; anything else is log output. */
export async function py(
  script: string,
  args: string[],
  opts: RunOpts & { onEvent?: (e: PyEvent) => void; onLog?: (line: string) => void } = {},
): Promise<{ result: PyEvent | null; stderr: string }> {
  const { onEvent, onLog, ...rest } = opts;
  let result: PyEvent | null = null;
  const out = await run(pythonExe(), [path.join(PY_DIR, `${script}.py`), ...args], {
    ...rest,
    keepStdout: false,
    onLine: (line, stream) => {
      const trimmed = line.trim();
      if (stream === "stdout" && trimmed.startsWith("{")) {
        try {
          const e = JSON.parse(trimmed) as PyEvent;
          if (e.type === "result") result = e;
          else onEvent?.(e);
          return;
        } catch {
          /* not JSON after all */
        }
      }
      onLog?.(trimmed);
    },
  });
  return { result, stderr: out.stderr };
}
