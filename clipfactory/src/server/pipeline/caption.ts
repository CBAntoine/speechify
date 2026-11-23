import fs from "node:fs";
import path from "node:path";
import { COLORS, type Short } from "../../lib/types.ts";
import { FONTS } from "../paths.ts";
import { ffmpeg, py } from "../proc.ts";
import { buildAss, remapWords } from "./ass.ts";
import type { Ctx } from "./ctx.ts";
import { composeGraph, OUT_H, OUT_W, splitHeights } from "./layout.ts";
import { frameAt } from "./media.ts";
import { readTranscript } from "./moment.ts";
import { sourcePath } from "./reframe.ts";

// Stage 05 · CAPTIONS — word-timed captions, batch.

export const FONT_FILE = "Anton-Regular.ttf";
export const FONT_NAME = "Anton";
export const REPLAY_SPEED = 0.35;
const REPLAY_BEFORE = 0.8;
const REPLAY_AFTER = 0.7;

export async function captionStage(c: Ctx, shorts: Short[] = c.s.shorts) {
  c.stage("caption");
  ensureFonts(c);
  await typeCaptions(c, shorts);
  await batch(c, shorts);
  c.endStage("caption");
}

/** The caption font, copied into the job so FFmpeg can use a short relative path. */
export function ensureFonts(c: Ctx) {
  const dir = c.path("fonts");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, FONT_FILE);
  if (!fs.existsSync(target)) fs.copyFileSync(path.join(FONTS, FONT_FILE), target);
}

/** Where in the output the replay sits, and how long it is (0 = no replay). */
export function replayPlan(c: Ctx, short: Short): { at: number; from: number; to: number; length: number } | null {
  if (!c.s.options.slowmo || short.replayAt === undefined) return null;
  let acc = 0;
  let outAt: number | null = null;
  for (const [a, b] of short.keep) {
    if (short.replayAt >= a && short.replayAt <= b) outAt = acc + (short.replayAt - a);
    acc += b - a;
  }
  if (outAt === null) {
    // The climax fell in cut dead air: use the nearest kept second.
    outAt = Math.min(acc - 0.5, Math.max(0.5, acc * 0.7));
  }
  const from = Math.max(0, outAt - REPLAY_BEFORE);
  const to = Math.min(acc, outAt + REPLAY_AFTER);
  if (to - from < 0.6) return null;
  return { at: outAt, from, to, length: (to - from) / REPLAY_SPEED };
}

/** Caption and hook positions for a layout, in 1080×1920 space. */
function positions(c: Ctx, short: Short): { captionY: number; hookY: number } {
  const kind = short.layout?.kind ?? "crop";
  if (kind === "split") {
    const seam = splitHeights(c.s.options.facecamShare).top;
    return { captionY: seam, hookY: seam };
  }
  if (kind === "cutout") return { captionY: Math.round(OUT_H * 0.36), hookY: Math.round(OUT_H * 0.2) };
  if (kind === "fit") return { captionY: Math.round(OUT_H * 0.78), hookY: Math.round(OUT_H * 0.2) };
  return { captionY: Math.round(OUT_H * 0.68), hookY: Math.round(OUT_H * 0.3) };
}

// ── 12 Type: word-timed captions ──────────────────────────────────────

async function typeCaptions(c: Ctx, shorts: Short[]) {
  const o = c.s.options;
  const libass = c.m.ffmpegHasLibass;
  c.begin("remotion", "builtin", libass ? "libass captions via FFmpeg" : "No captions (FFmpeg lacks libass)", "Same word-timed pop captions, rendered without a browser");
  const transcript = readTranscript(c);
  const speakers = transcript.speakers && transcript.speakers > 1 ? [COLORS.LIME, COLORS.CYAN, COLORS.AMBER, COLORS.PINK] : undefined;
  for (const short of shorts) {
    c.check();
    const sh = c.s.shorts.find((x) => x.id === short.id)!;
    const words = o.captions ? remapWords(transcript.words, sh.keep) : [];
    const main = sh.keep.reduce((a, [x, y]) => a + (y - x), 0);
    const replay = replayPlan(c, sh);
    const { captionY, hookY } = positions(c, sh);
    const ass = buildAss({
      words,
      duration: main + (replay?.length ?? 0),
      style: o.captionStyle,
      width: OUT_W,
      height: OUT_H,
      captionY,
      hookY,
      font: FONT_NAME,
      accent: COLORS.LIME,
      speakerColors: speakers,
      hook: o.hook ? sh.hook : undefined,
      hookUntil: Math.min(2.4, main),
      replay: replay ? { start: main, end: main + replay.length, label: "SLOW-MO REPLAY" } : undefined,
    });
    fs.writeFileSync(c.path("shorts", sh.id, "captions.ass"), ass);
    const mid = words[Math.floor(words.length / 2)];
    c.live({ t: sh.start + (mid ? mid.s : 1), shortId: sh.id, caption: sh.hook });
    c.update((s) => {
      const x = s.shorts.find((y) => y.id === sh.id)!;
      x.duration = Math.round((main + (replay?.length ?? 0)) * 100) / 100;
      x.status = "queued";
    });
  }
  c.end("remotion", { note: o.captions ? `${o.captionStyle} captions${speakers ? ", coloured by speaker" : ""}` : "hook only" });
}

// ── 13 Batch: render every plate, then the covers ───────────────────────

/** Does this short get an AI upscale in SHIP? Then its plate is rendered at half size. */
export function upscalePlan(c: Ctx): { plateW: number; plateH: number; factor: number; outW: number; outH: number; ai: boolean } {
  const o = c.s.options;
  const ai = c.m.report.items.esrgan.available;
  const lowRes = (c.s.source?.height ?? 1080) < 900;
  if (o.upscale === "4k") return { plateW: OUT_W, plateH: OUT_H, factor: 2, outW: OUT_W * 2, outH: OUT_H * 2, ai };
  if (o.upscale === "auto" && lowRes && ai) return { plateW: OUT_W / 2, plateH: OUT_H / 2, factor: 2, outW: OUT_W, outH: OUT_H, ai };
  return { plateW: OUT_W, plateH: OUT_H, factor: 1, outW: OUT_W, outH: OUT_H, ai: false };
}

async function batch(c: Ctx, shorts: Short[]) {
  const moviepy = Boolean(c.m.py.modules?.moviepy);
  c.begin("moviepy", moviepy ? "native" : "builtin", moviepy ? `FFmpeg plates + ${c.m.report.items.moviepy.engine} covers` : "FFmpeg plates + drawtext covers", `batch ×${shorts.length}`);
  const plan = upscalePlan(c);
  const src = c.s.source!;
  // Sharpen when the crop is blown up a lot and no AI upscale follows.
  const sharpen = c.s.options.upscale !== "off" && !plan.ai && src.height < 900;
  const covers: { image: string; text: string; out: string; y: number }[] = [];
  for (const short of shorts) {
    c.check();
    const sh = c.s.shorts.find((x) => x.id === short.id)!;
    const dir = c.path("shorts", sh.id);
    const span = sh.end - sh.start;
    const mix = path.join(dir, "mix.wav");
    const matte = path.join(dir, "matte.mp4");
    const inputs = ["-ss", sh.start.toFixed(3), "-t", span.toFixed(3), "-i", sourcePath(c)];
    let audioIn: string | null = src.hasAudio ? "0:a" : null;
    if (fs.existsSync(mix)) {
      inputs.push("-i", mix);
      audioIn = "1:a";
    }
    let matteIn: string | undefined;
    if (sh.layout?.kind === "cutout" && fs.existsSync(matte)) {
      inputs.push("-i", matte);
      matteIn = `${audioIn === "1:a" ? 2 : 1}:v`;
    }
    const layout = sh.layout ?? { kind: "crop" as const, crop: { w: 0.316, h: 1 }, track: [{ t: 0, cx: 0.5, cy: 0.5 }], why: "" };
    const graph = composeGraph({
      kind: layout.kind,
      srcW: src.width,
      srcH: src.height,
      facecamShare: c.s.options.facecamShare,
      facecam: layout.facecam,
      crop: layout.crop,
      track: layout.track,
      segments: sh.keep.map(([a, b]) => [Math.max(0, a - sh.start), Math.min(span, b - sh.start)]),
      sharpen,
      audioIn,
      matteIn,
      fps: src.fps,
      outW: plan.plateW,
      outH: plan.plateH,
    });
    fs.writeFileSync(path.join(dir, "plate.graph.txt"), graph);
    const main = sh.keep.reduce((a, [x, y]) => a + (y - x), 0);
    c.update((s) => {
      const x = s.shorts.find((y) => y.id === sh.id)!;
      x.status = "rendering";
      x.progress = 0.02;
    });
    c.live({ t: sh.start, shortId: sh.id, caption: sh.hook, tag: undefined });
    const fpsOut = Math.min(60, Math.round(src.fps) || 30);
    await ffmpeg(
      [
        ...inputs,
        "-filter_complex", graph,
        "-map", "[v]", ...(audioIn ? ["-map", "[a]"] : []),
        "-r", String(fpsOut),
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "15", "-pix_fmt", "yuv420p",
        ...(audioIn ? ["-c:a", "flac", "-ar", "48000", "-ac", "2"] : []),
        path.join(dir, "plate.mkv"),
      ],
      {
        duration: main,
        signal: c.signal,
        onProgress: (f) =>
          c.update((s) => {
            const x = s.shorts.find((y) => y.id === sh.id)!;
            x.progress = Math.max(x.progress, Math.round(f * 55) / 100);
          }),
      },
    );
    const replay = replayPlan(c, sh);
    const coverAt = replay ? replay.at : Math.min(main / 2, 3);
    await frameAt(path.join(dir, "plate.mkv"), coverAt, path.join(dir, "frame.jpg"), plan.plateW, c.signal);
    covers.push({ image: path.join(dir, "frame.jpg"), text: sh.hook, out: path.join(dir, "cover.jpg"), y: sh.layout?.kind === "split" ? splitHeights(c.s.options.facecamShare).top / OUT_H : 0.3 });
    c.update((s) => {
      const x = s.shorts.find((y) => y.id === sh.id)!;
      x.progress = 0.56;
      x.status = "queued";
    });
  }

  // Covers: the climax frame with the hook on it.
  let coversDone = false;
  if (moviepy) {
    const jobs = c.path("covers.json");
    fs.writeFileSync(jobs, JSON.stringify(covers));
    try {
      await py("cf_cover", ["--jobs", jobs, "--font", path.join(FONTS, FONT_FILE)], { signal: c.signal, onLog: (l) => c.log(l, "info", "moviepy") });
      coversDone = covers.every((cv) => fs.existsSync(cv.out));
    } catch (err) {
      if (c.signal.aborted) throw err;
      c.log(`MoviePy covers failed (${(err as Error).message}); using drawtext`, "warn", "moviepy");
    }
  }
  if (!coversDone) {
    for (const cv of covers) {
      const textFile = cv.out.replace(/\.jpg$/, ".txt");
      fs.writeFileSync(textFile, cv.text.toUpperCase());
      const size = Math.round(plan.plateH * 0.075);
      const border = Math.max(3, Math.round(plan.plateH * 0.006));
      await ffmpeg(
        [
          "-i", path.basename(cv.image),
          "-vf", `drawtext=fontfile=../../fonts/${FONT_FILE}:textfile=${path.basename(textFile)}:fontsize=${size}:fontcolor=white:borderw=${border}:bordercolor=black:x=(w-text_w)/2:y=h*${cv.y.toFixed(3)}-text_h/2`,
          "-frames:v", "1", "-q:v", "3", path.basename(cv.out),
        ],
        { cwd: path.dirname(cv.out), signal: c.signal },
      );
    }
  }
  c.end("moviepy", { note: `${shorts.length} plates + covers` });
}
