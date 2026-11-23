import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { SourceInfo } from "../../lib/types.ts";
import { projectSlug } from "../../lib/format.ts";
import { rel } from "../paths.ts";
import { ffmpeg, ffprobe, fps, py, run, ToolError } from "../proc.ts";
import type { Ctx } from "./ctx.ts";
import { audioLevels, envelope, thumbStrip } from "./media.ts";

// Stage 01 · SOURCE — pull the VOD, find every cut.

const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|webm|avi|flv|ts)$/i;

export async function sourceStage(c: Ctx) {
  c.stage("source");
  const file = await download(c);
  await ingest(c, file);
  await cuts(c);
  c.endStage("source");
}

// ── 01 Download ──────────────────────────────────────────────────────

async function download(c: Ctx): Promise<string> {
  const o = c.s.options;
  // A restarted job reuses what it already downloaded.
  const prev = c.s.source?.file;
  if (prev) {
    const p = path.isAbsolute(prev) ? prev : c.path(prev);
    if (fs.existsSync(p)) {
      c.begin("ytdlp", o.url ? "native" : "off", o.url ? c.m.report.items.ytdlp.engine : "Local file");
      c.end("ytdlp", { note: "Using the earlier download" });
      return p;
    }
  }
  if (!o.url) {
    c.skip("ytdlp", "off", "Local file", "The VOD was uploaded, nothing to download");
    const title = (o.sourceName || path.basename(o.file!)).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
    c.update((s) => {
      s.source = { ...(s.source as SourceInfo), title };
      if (!s.options.name && s.name === "NEW_PROJECT") s.name = projectSlug(title);
    });
    return linkLocal(c, o.file!);
  }
  if (c.m.ytdlp) return ytdlp(c, o.url, c.m.ytdlp);
  if (VIDEO_EXT.test(new URL(o.url).pathname)) return direct(c, o.url);
  throw new ToolError("yt-dlp isn't installed, and this isn't a direct video link. Run `npm run setup`.", null, "");
}

function linkLocal(c: Ctx, file: string): string {
  const abs = path.isAbsolute(file) ? file : c.path(file);
  if (!fs.existsSync(abs)) throw new Error(`File not found: ${file}`);
  if (abs.startsWith(c.dir + path.sep)) return abs;
  const target = c.path(`source${path.extname(abs).toLowerCase() || ".mp4"}`);
  fs.rmSync(target, { force: true });
  try {
    fs.linkSync(abs, target);
  } catch {
    try {
      fs.symlinkSync(abs, target);
    } catch {
      return abs;
    }
  }
  return target;
}

async function ytdlp(c: Ctx, url: string, cmd: string[]): Promise<string> {
  c.begin("ytdlp", "native", c.m.report.items.ytdlp.engine);
  c.log(`Downloading ${url}`, "info", "ytdlp");
  let phase = 0;
  let lastPct = 0;
  const twoParts = { value: false };
  await run(
    cmd[0],
    [
      ...cmd.slice(1),
      "--no-playlist",
      "--newline",
      "--no-colors",
      "--no-part",
      // H.264 + AAC up to 1080p plays in every browser and decodes fast.
      "-f",
      "bv*[height<=1080][vcodec^=avc1]+ba[acodec^=mp4a]/bv*[height<=1080]+ba/b[height<=1080]/b",
      "--merge-output-format",
      "mp4",
      "--write-info-json",
      "-o",
      "source.%(ext)s",
      "--progress-template",
      "download:[cf]%(progress._percent_str)s|%(progress._speed_str)s|%(progress._total_bytes_str)s|%(progress._total_bytes_estimate_str)s|%(info.format_id)s|%(info.height)s",
      url,
    ],
    {
      cwd: c.dir,
      signal: c.signal,
      onLine: (line) => {
        if (line.startsWith("[cf]")) {
          const [pctS, speed, total, estimate, formatId, height] = line.slice(4).split("|").map((s) => s.trim());
          const pct = parseFloat(pctS) || 0;
          if (formatId?.includes("+")) twoParts.value = true;
          if (pct + 20 < lastPct) phase++;
          lastPct = pct;
          const parts = twoParts.value ? 2 : 1;
          const overall = Math.min(100, (Math.min(phase, parts - 1) * 100 + pct) / parts);
          c.live({ download: { pct: overall, speed: speed === "NA" ? undefined : speed, size: total !== "NA" ? total : estimate !== "NA" ? estimate : undefined, format: height && height !== "NA" ? `${height}p` : undefined } });
          return;
        }
        if (/^\[(download|Merger|youtube|twitch|info)/i.test(line) && !/ETA|%/.test(line)) c.log(line, "info", "ytdlp");
        if (/^ERROR/.test(line)) c.log(line, "error", "ytdlp");
      },
    },
  );
  const out = fs.readdirSync(c.dir).find((f) => f.startsWith("source.") && VIDEO_EXT.test(f));
  if (!out) throw new Error("yt-dlp finished but no video file was written");
  try {
    const info = JSON.parse(fs.readFileSync(c.path("source.info.json"), "utf8")) as { title?: string; uploader?: string; channel?: string; webpage_url?: string };
    c.update((s) => {
      s.name = s.options.name || projectSlug(info.title || "VOD");
      s.source = { ...(s.source as SourceInfo), title: info.title || "VOD", uploader: info.uploader || info.channel, url: info.webpage_url || url };
    });
  } catch {
    /* no info json */
  }
  c.end("ytdlp", { note: "Downloaded" });
  return c.path(out);
}

async function direct(c: Ctx, url: string): Promise<string> {
  c.begin("ytdlp", "builtin", "Direct HTTP download", "yt-dlp isn't installed; plain video links still work");
  const ext = path.extname(new URL(url).pathname).toLowerCase() || ".mp4";
  const target = c.path(`source${ext}`);
  const res = await fetch(url, { signal: c.signal });
  if (!res.ok || !res.body) throw new Error(`Download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0);
  let got = 0;
  let last = 0;
  const started = Date.now();
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      got += chunk.byteLength;
      if (Date.now() - last > 300) {
        last = Date.now();
        const mbps = got / 1048576 / Math.max(0.001, (Date.now() - started) / 1000);
        c.live({ download: { pct: total ? (got / total) * 100 : 0, speed: `${mbps.toFixed(1)}MiB/s`, size: total ? `${(total / 1048576).toFixed(1)}MiB` : undefined } });
      }
      ctl.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as import("node:stream/web").ReadableStream), fs.createWriteStream(target));
  c.update((s) => {
    s.source = { ...(s.source as SourceInfo), title: decodeURIComponent(path.basename(new URL(url).pathname)), url };
  });
  c.end("ytdlp", { note: "Downloaded" });
  return target;
}

// ── Ingest: probe, analysis proxy, audio, thumbnails ────────────────────

async function ingest(c: Ctx, file: string) {
  c.log("Reading the VOD", "info");
  const probe = await ffprobe(file, c.signal);
  const v = probe.streams.find((s) => s.codec_type === "video");
  if (!v?.width || !v.height) throw new Error("That file has no video stream.");
  const a = probe.streams.find((s) => s.codec_type === "audio");
  const duration = Number(probe.format.duration || v.duration || 0);
  if (!duration) throw new Error("Couldn't read the video's length.");
  const frameRate = fps(v.avg_frame_rate) || fps(v.r_frame_rate) || 30;
  const container = (probe.format.format_name || "").split(",");
  const playable = v.codec_name === "h264" && container.some((f) => ["mp4", "mov", "m4a"].includes(f)) && (!a || a.codec_name === "aac" || a.codec_name === "mp3");
  const title = c.s.source?.title || probe.format.tags?.title || path.basename(file).replace(/\.[^.]+$/, "");

  c.update((s) => {
    s.name = s.options.name || (s.name === "NEW_PROJECT" ? projectSlug(title) : s.name);
    s.source = {
      title,
      uploader: s.source?.uploader,
      url: s.source?.url,
      duration,
      width: v.width!,
      height: v.height!,
      fps: Math.round(frameRate * 100) / 100,
      hasAudio: Boolean(a),
      vcodec: v.codec_name,
      file: file.startsWith(c.dir) ? rel(c.id, file) : file,
      media: file.startsWith(c.dir) && playable ? rel(c.id, file) : "preview.mp4",
    };
  });
  c.log(`${v.width}×${v.height} ${frameRate.toFixed(0)} fps, ${(duration / 60).toFixed(1)} min${a ? "" : ", no audio"}`, "info");

  // One decode pass: a small 10 fps proxy for analysis, 16 kHz audio for
  // speech, and (if the browser can't play the source) a 540p preview.
  const args = ["-hwaccel", "auto", "-i", file, "-map", "0:v:0", "-vf", "fps=10,scale=640:-2", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30", "-g", "10", "-an", c.path("analysis.mp4")];
  if (a) args.push("-map", "0:a:0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", c.path("audio16k.wav"));
  if (!playable || !file.startsWith(c.dir)) {
    args.push("-map", "0:v:0", "-vf", "scale=-2:540", "-c:v", "libx264", "-preset", "veryfast", "-crf", "27", "-g", "48");
    if (a) args.push("-map", "0:a:0", "-c:a", "aac", "-b:a", "96k", "-ac", "2");
    args.push("-movflags", "+faststart", c.path("preview.mp4"));
  }
  c.live({ tag: "ingest · analysis proxy" });
  await ffmpeg(args, {
    duration,
    signal: c.signal,
    onProgress: (f) => c.live({ download: { pct: 100, size: undefined, speed: undefined, format: `ingest ${Math.round(f * 100)}%` } }),
  });

  if (a) {
    const levels = await audioLevels(c.path("audio16k.wav"), { signal: c.signal, duration });
    fs.writeFileSync(c.path("levels.json"), JSON.stringify(levels));
    const peaks = envelope(levels.tenths, 1200);
    c.update((s) => {
      s.analysis.peaks = peaks;
      s.analysis.voice = [];
      s.analysis.game = [];
    });
  }
  const sprite = await thumbStrip(c.path("analysis.mp4"), duration, 48, c.path("sprite.jpg"), c.signal);
  c.update((s) => {
    s.analysis.sprite = { file: "sprite.jpg", ...sprite };
  });
  c.live({ download: undefined, tag: undefined, t: Math.min(duration * 0.1, 30) });
}

// ── 02 Cuts ──────────────────────────────────────────────────────────

async function cuts(c: Ctx) {
  const proxy = c.path("analysis.mp4");
  const duration = c.s.source!.duration;
  let found: number[] = [];
  let lastLive = 0;
  const onCut = (t: number) => {
    found.push(t);
    if (Date.now() - lastLive > 250) {
      lastLive = Date.now();
      const snapshot = found.slice(0, 3000);
      c.update((s) => {
        s.analysis.cuts = snapshot;
        s.live = { ...s.live, t, cut: { index: found.length, t } };
      });
    }
  };

  const native = c.m.report.items.scenedetect.available;
  if (native) {
    c.begin("scenedetect", "native", c.m.report.items.scenedetect.engine);
    try {
      await py("cf_scenes", ["--video", proxy, "--out", c.path("scenes.json")], {
        signal: c.signal,
        onEvent: (e) => {
          if (e.type === "cut" && typeof e.t === "number") onCut(e.t);
        },
        onLog: (l) => c.log(l, "info", "scenedetect"),
      });
      found = (JSON.parse(fs.readFileSync(c.path("scenes.json"), "utf8")) as { cuts: number[] }).cuts;
    } catch (err) {
      if (c.signal.aborted) throw err;
      c.log(`PySceneDetect failed (${(err as Error).message}); using FFmpeg's scene filter`, "warn", "scenedetect");
      found = [];
      await ffmpegCuts(c, proxy, duration, onCut);
    }
  } else {
    c.begin("scenedetect", "builtin", "FFmpeg scene filter");
    await ffmpegCuts(c, proxy, duration, onCut);
  }
  const final = [...found].sort((a, b) => a - b);
  fs.writeFileSync(c.path("scenes.json"), JSON.stringify({ cuts: final }));
  c.update((s) => {
    s.analysis.cuts = final.slice(0, 3000);
    s.live = { ...s.live, cut: final.length ? { index: final.length, t: final[final.length - 1] } : undefined };
  });
  c.log(`${final.length} scene cuts`, "info", "scenedetect");
  c.end("scenedetect", { note: `${final.length} cuts` });
}

async function ffmpegCuts(c: Ctx, proxy: string, duration: number, onCut: (t: number) => void) {
  await ffmpeg(["-i", proxy, "-vf", "select='gt(scene,0.32)',showinfo", "-f", "null", "-"], {
    duration,
    signal: c.signal,
    onLine: (line) => {
      const m = /pts_time:([\d.]+)/.exec(line);
      if (m && line.includes("Parsed_showinfo")) onCut(Number(m[1]));
    },
  });
}
