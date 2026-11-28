// FFmpeg and ffprobe, as plain child processes. The Filmer needs only the
// filters every FFmpeg build has (scale, crop, overlay, fade, boxblur, loop,
// apad), so Homebrew, apt, static and Windows builds all work.
//
// FFMPEG_PATH / FFPROBE_PATH override the binaries; otherwise they're found
// on PATH. When only FFMPEG_PATH is set, ffprobe is looked for next to it.

import { spawn } from "node:child_process";
import path from "node:path";

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

export function ffprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  const ff = process.env.FFMPEG_PATH;
  if (ff && /[\\/]/.test(ff)) {
    const base = path.basename(ff).replace(/ffmpeg/i, "ffprobe");
    return path.join(path.dirname(ff), base === path.basename(ff) ? "ffprobe" : base);
  }
  return "ffprobe";
}

const INSTALL_HINT = "Install FFmpeg (macOS: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg · Windows: winget install Gyan.FFmpeg) or set FFMPEG_PATH.";

export class FfmpegError extends Error {}

interface RunOut {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(bin: string, args: string[], timeoutMs: number, keepLines = 40): Promise<RunOut> {
  return new Promise((resolve, reject) => {
    // A synchronous throw from spawn rejects this promise too.
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    const tail: string[] = [];
    let partial = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      if (stdout.length < 1_000_000) stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      const lines = (partial + d.toString("utf8")).split(/\r?\n|\r/);
      partial = lines.pop() ?? "";
      for (const l of lines) {
        if (!l.trim()) continue;
        tail.push(l);
        if (tail.length > keepLines) tail.shift();
      }
    });
    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") reject(new FfmpegError(`${path.basename(bin)} wasn't found. ${INSTALL_HINT}`));
      else reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (partial.trim()) tail.push(partial);
      if (timedOut) {
        reject(new FfmpegError(`${path.basename(bin)} timed out after ${Math.round(timeoutMs / 1000)} s`));
        return;
      }
      resolve({ code, stdout, stderr: tail.join("\n") });
    });
  });
}

let available: Promise<boolean> | null = null;

/** True when `ffmpeg -version` runs. Cached for the life of the process. */
export async function hasFfmpeg(): Promise<boolean> {
  available ??= run(ffmpegPath(), ["-version"], 10_000).then(
    (r) => r.code === 0,
    () => false
  );
  return available;
}

let encoders: Promise<Set<string>> | null = null;

/** Whether this FFmpeg build has an encoder, e.g. "libx264" (cached). */
export async function hasEncoder(name: string): Promise<boolean> {
  encoders ??= run(ffmpegPath(), ["-hide_banner", "-encoders"], 15_000).then(
    (r) => new Set((r.stdout.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/gm) ?? []).map((l) => l.trim().split(/\s+/)[1])),
    () => new Set<string>()
  );
  return (await encoders).has(name);
}

/** Run ffmpeg with `-hide_banner -nostdin -y`. Rejects with the last lines of stderr on failure. */
export async function runFfmpeg(args: string[], opts: { timeoutMs?: number } = {}): Promise<void> {
  const quiet = args.includes("-loglevel") || args.includes("-v") ? [] : ["-loglevel", "error"];
  const r = await run(ffmpegPath(), ["-hide_banner", "-nostdin", "-y", ...quiet, ...args], opts.timeoutMs ?? 180_000);
  if (r.code !== 0) throw new FfmpegError(`ffmpeg failed (exit ${r.code}): ${r.stderr.trim() || "no output"}`);
}

export interface ProbeResult {
  durationSec: number;
  width?: number;
  height?: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
}

/** Streams and duration of a media file (ffprobe; falls back to parsing `ffmpeg -i`). */
export async function probe(file: string): Promise<ProbeResult> {
  const r = await run(ffprobePath(), ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height", "-of", "json", file], 30_000).catch(() => null);
  if (r && r.code === 0) {
    const j = JSON.parse(r.stdout || "{}") as { format?: { duration?: string }; streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[] };
    const streams = j.streams ?? [];
    const v = streams.find((s) => s.codec_type === "video");
    const a = streams.find((s) => s.codec_type === "audio");
    return {
      durationSec: Number(j.format?.duration ?? 0) || 0,
      width: v?.width,
      height: v?.height,
      hasVideo: Boolean(v),
      hasAudio: Boolean(a),
      videoCodec: v?.codec_name,
      audioCodec: a?.codec_name,
    };
  }
  // No ffprobe: `ffmpeg -i file` prints the stream table and exits non-zero.
  const f = await run(ffmpegPath(), ["-hide_banner", "-nostdin", "-i", file], 30_000, 200);
  const text = f.stderr;
  const dm = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
  const vm = /Stream #[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(text);
  return {
    durationSec: dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0,
    width: vm ? Number(vm[1]) : undefined,
    height: vm ? Number(vm[2]) : undefined,
    hasVideo: /Stream #[^\n]*Video:/.test(text),
    hasAudio: /Stream #[^\n]*Audio:/.test(text),
  };
}

/** Duration in seconds (0 when unknown). */
export async function probeDuration(file: string): Promise<number> {
  return (await probe(file)).durationSec;
}
