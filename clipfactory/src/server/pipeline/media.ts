import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { childEnv } from "../paths.ts";
import { CancelledError, ffmpeg, run } from "../proc.ts";

export interface AudioLevels {
  /** dBFS per 100 ms. */
  tenths: number[];
  /** dBFS per second. */
  seconds: number[];
}

const db = (rms: number) => (rms > 0 ? Math.max(-90, 20 * Math.log10(rms)) : -90);

/** Loudness of a whole file in one pass: FFmpeg decodes to 16 kHz mono PCM and we measure it here. */
export function audioLevels(file: string, opts: { signal?: AbortSignal; duration?: number; onProgress?: (f: number) => void; start?: number; length?: number } = {}): Promise<AudioLevels> {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
    if (opts.start) args.push("-ss", String(opts.start));
    args.push("-i", file);
    if (opts.length) args.push("-t", String(opts.length));
    args.push("-map", "0:a:0", "-ac", "1", "-ar", "16000", "-f", "s16le", "-");
    const child = spawn("ffmpeg", args, { env: childEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const tenths: number[] = [];
    const per = 1600; // samples in 100 ms
    let acc = 0;
    let n = 0;
    let carry: Buffer | null = null;
    let samples = 0;
    let lastReport = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      let buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      carry = usable < buf.length ? buf.subarray(usable) : null;
      buf = buf.subarray(0, usable);
      for (let i = 0; i < buf.length; i += 2) {
        const v = buf.readInt16LE(i) / 32768;
        acc += v * v;
        n++;
        if (n === per) {
          tenths.push(db(Math.sqrt(acc / n)));
          acc = 0;
          n = 0;
        }
      }
      samples += buf.length / 2;
      if (opts.onProgress && opts.duration && samples - lastReport > 16000 * 60) {
        lastReport = samples;
        opts.onProgress(Math.min(1, samples / 16000 / opts.duration));
      }
    });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c));
    const onAbort = () => child.kill("SIGTERM");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", reject);
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) return reject(new CancelledError());
      if (code !== 0) return reject(new Error(`ffmpeg couldn't read the audio: ${stderr.trim().split("\n").pop()}`));
      if (n > 0) tenths.push(db(Math.sqrt(acc / n)));
      const seconds: number[] = [];
      for (let i = 0; i < tenths.length; i += 10) {
        const chunk = tenths.slice(i, i + 10);
        const power = chunk.reduce((a, d) => a + 10 ** (d / 10), 0) / chunk.length;
        seconds.push(Math.max(-90, 10 * Math.log10(power || 1e-9)));
      }
      resolve({ tenths, seconds });
    });
  });
}

/** Down-sample dB levels to a 0..1 envelope with `points` values (for waveforms). */
export function envelope(levels: number[], points: number, floor = -50): number[] {
  if (!levels.length) return [];
  const out: number[] = [];
  const step = levels.length / points;
  for (let i = 0; i < points; i++) {
    const a = Math.floor(i * step);
    const b = Math.max(a + 1, Math.floor((i + 1) * step));
    let peak = -90;
    for (let k = a; k < b && k < levels.length; k++) peak = Math.max(peak, levels[k]);
    out.push(Math.round(Math.max(0, Math.min(1, (peak - floor) / -floor)) * 1000) / 1000);
  }
  return out;
}

/** Louder-than-usual seconds, for the orchestrator. */
export function spikes(seconds: number[], max = 60): { t: number; db: number }[] {
  if (!seconds.length) return [];
  const sorted = [...seconds].filter((d) => d > -80).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? -40;
  const out: { t: number; db: number }[] = [];
  seconds.forEach((d, i) => {
    if (d - median >= 8 && d >= (seconds[i - 1] ?? -90) && d >= (seconds[i + 1] ?? -90)) out.push({ t: i + 0.5, db: d - median });
  });
  return out.sort((a, b) => b.db - a.db).slice(0, max).sort((a, b) => a.t - b.t);
}

/** One JPEG frame. */
export async function frameAt(file: string, t: number, out: string, width = 640, signal?: AbortSignal): Promise<void> {
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", Math.max(0, t).toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "3", out], { signal });
}

/** A strip of thumbnails across the whole video, for the timeline. */
export async function thumbStrip(file: string, duration: number, count: number, out: string, signal?: AbortSignal): Promise<{ count: number; w: number; h: number }> {
  const dir = path.join(path.dirname(out), ".thumbs");
  fs.mkdirSync(dir, { recursive: true });
  const w = 160;
  const times = Array.from({ length: count }, (_, i) => (duration * (i + 0.5)) / count);
  let next = 0;
  const worker = async () => {
    while (next < times.length) {
      const i = next++;
      await frameAt(file, times[i], path.join(dir, `t${String(i).padStart(3, "0")}.jpg`), w, signal).catch(() => {});
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  // Frames that failed to decode are filled with black so the strip stays aligned.
  for (let i = 0; i < count; i++) {
    const f = path.join(dir, `t${String(i).padStart(3, "0")}.jpg`);
    if (!fs.existsSync(f)) await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=black:s=${w}x90`, "-frames:v", "1", f]);
  }
  await ffmpeg(["-i", path.join(dir, "t%03d.jpg"), "-vf", `scale=${w}:90:force_original_aspect_ratio=increase,crop=${w}:90,tile=${count}x1`, "-frames:v", "1", "-q:v", "4", out], { signal });
  fs.rmSync(dir, { recursive: true, force: true });
  return { count, w, h: 90 };
}

/** Integrated loudness and peak, for QA. */
export async function loudness(file: string, signal?: AbortSignal): Promise<{ lufs: number; peak: number } | null> {
  const r = await run("ffmpeg", ["-hide_banner", "-nostdin", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { signal, allowFail: true });
  const lufs = /I:\s+(-?[\d.]+) LUFS/.exec(r.stderr.split("Summary:").pop() ?? "");
  const peak = /Peak:\s+(-?[\d.]+) dBFS/.exec(r.stderr.split("Summary:").pop() ?? "");
  if (!lufs) return null;
  return { lufs: Number(lufs[1]), peak: peak ? Number(peak[1]) : 0 };
}
