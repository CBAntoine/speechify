import fs from "node:fs";
import path from "node:path";
import { COLORS, type Short, type Word } from "../../lib/types.ts";
import { FONTS } from "../paths.ts";
import { ffmpeg, ffprobe, py } from "../proc.ts";
import { buildAss, remapWords } from "./ass.ts";
import type { Ctx } from "./ctx.ts";
import { bleepSpans, editPlan, isProfane, maskWord, planPunches, storyTime, stressedWords, teaserTrack } from "./edit.ts";
import { composeGraph, OUT_H, OUT_W, sourceColor, splitHeights, type SourceColor } from "./layout.ts";
import { frameAt } from "./media.ts";
import { readLevels, readTranscript } from "./moment.ts";
import { sourcePath } from "./reframe.ts";
import type { Cue } from "./sfx.ts";

// Stage 05 · CAPTIONS — word-timed captions, batch.

export const FONT_FILE = "Anton-Regular.ttf";
export const FONT_NAME = "Anton";
export const REPLAY_SPEED = 0.35;
const REPLAY_BEFORE = 0.8;
const REPLAY_AFTER = 0.7;
/** Stressed caption words: a warm yellow next to the lime of the word being said. */
export const STRESS = "#ffd426";

export async function captionStage(c: Ctx, shorts: Short[] = c.s.shorts) {
  c.stage("caption");
  ensureFonts(c);
  planEdits(c, shorts);
  await typeCaptions(c, shorts);
  await batch(c, shorts);
  c.endStage("caption");
}

/** What the export pass needs to finish the sound: where the effects land and what gets bleeped. */
export interface EditNotes {
  body: number;
  teaser: number;
  total: number;
  cues: Cue[];
  bleeps: [number, number][];
}

export function readEditNotes(c: Ctx, short: Short): EditNotes | null {
  try {
    return JSON.parse(fs.readFileSync(c.path("shorts", short.id, "edit.json"), "utf8")) as EditNotes;
  } catch {
    return null;
  }
}

/** "what the fuck" → "what the f***". */
export function maskText(text: string): string {
  return text
    .split(/(\s+)/)
    .map((tok) => (isProfane(tok) ? maskWord(tok) : tok))
    .join("");
}

/** Source-time words of a short, with the ones that carry the moment marked. */
function markedWords(words: Word[], short: Short): Word[] {
  const inside = words.filter((w) => w.e > short.start - 0.5 && w.s < short.end + 0.5);
  const stressed = stressedWords(inside, short.emphasis);
  return inside.map((w, i) => (stressed.has(i) ? { ...w, em: true } : w));
}

// ── The edit: punch-ins, and clean titles when censoring ───────────────────

function planEdits(c: Ctx, shorts: Short[]) {
  const o = c.s.options;
  const transcript = readTranscript(c);
  const levels = readLevels(c);
  for (const short of shorts) {
    const sh = c.s.shorts.find((x) => x.id === short.id)!;
    const plan = editPlan(sh);
    const words = markedWords(transcript.words, sh);
    const stressed = new Set(words.flatMap((w, i) => (w.em ? [i] : [])));
    const punches = o.punchIns ? planPunches({ plan, keep: sh.keep, layout: sh.layout?.kind ?? "crop", climax: sh.replayAt, tenths: levels.tenths, words, stressed }) : [];
    c.update((s) => {
      const x = s.shorts.find((y) => y.id === sh.id)!;
      x.punches = punches;
      if (o.censor) {
        x.title = maskText(x.title);
        x.hook = maskText(x.hook);
        x.description = maskText(x.description);
        if (x.headline) x.headline = maskText(x.headline);
      }
    });
    if (plan.teaser || punches.length) {
      const bits = [plan.teaser ? `cold open ${plan.teaser.toFixed(1)} s` : "", punches.length ? `${punches.length} punch-in${punches.length === 1 ? "" : "s"}` : ""].filter(Boolean);
      c.log(`${sh.id}: ${bits.join(", ")}`, "info", "remotion");
    }
  }
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
  // A cold open already shows the payoff; showing it a third time drags.
  if (editPlan(short).teaser) return null;
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
    const plan = editPlan(sh);
    const replay = replayPlan(c, sh);
    const total = plan.body + (replay?.length ?? 0);
    // Words on the output timeline: the cold open's, then the story's.
    const spoken = remapWords(markedWords(transcript.words, sh), plan.segs.map((g) => [g.a, g.b]));
    const replayWords = replay
      ? spoken.filter((w) => w.s >= replay.from && w.e <= replay.to).map((w) => ({ ...w, s: plan.body + (w.s - replay.from) / REPLAY_SPEED, e: plan.body + (w.e - replay.from) / REPLAY_SPEED }))
      : [];
    const bleeps = o.censor ? bleepSpans([...spoken, ...replayWords]) : [];
    const shown = o.censor ? spoken.map((w) => (isProfane(w.w) ? { ...w, w: maskWord(w.w) } : w)) : spoken;
    // The hook rides the cold open (and stays up long enough to read).
    const hookUntil = plan.teaser >= 1.2 ? plan.teaser : Math.min(2.4, plan.body);
    const { captionY, hookY } = positions(c, sh);
    const ass = buildAss({
      words: o.captions ? shown : [],
      duration: total,
      style: o.captionStyle,
      width: OUT_W,
      height: OUT_H,
      captionY,
      hookY,
      font: FONT_NAME,
      accent: COLORS.LIME,
      stress: STRESS,
      speakerColors: speakers,
      hook: o.hook ? sh.hook : undefined,
      hookUntil,
      replay: replay ? { start: plan.body, end: total, label: "SLOW-MO REPLAY" } : undefined,
      title: o.titleBar ? { text: sh.headline || sh.title, from: 0, to: total, y: Math.round(OUT_H * 0.055) } : undefined,
      progress: o.progressBar ? { color: COLORS.LIME } : undefined,
    });
    fs.writeFileSync(c.path("shorts", sh.id, "captions.ass"), ass);

    // Sound design cues: a whoosh into each cut of the edit, a hit under the payoff zoom.
    const cues: Cue[] = [];
    if (o.sfx) {
      if (plan.teaser) cues.push({ at: plan.teaser, kind: "whoosh" });
      else if (replay) cues.push({ at: plan.body, kind: "whoosh" });
      const pay = (sh.punches ?? []).find((p) => p.why === "payoff");
      if (pay) cues.push({ at: pay.s + 0.15, kind: "impact" });
    }
    const notes: EditNotes = { body: plan.body, teaser: plan.teaser, total, cues, bleeps };
    fs.writeFileSync(c.path("shorts", sh.id, "edit.json"), JSON.stringify(notes));

    const mid = shown[Math.floor(shown.length / 2)];
    c.live({ t: sh.start + (mid ? mid.s : 1), shortId: sh.id, caption: sh.hook });
    c.update((s) => {
      const x = s.shorts.find((y) => y.id === sh.id)!;
      x.duration = Math.round(total * 100) / 100;
      x.status = "queued";
    });
  }
  const extras = [o.titleBar && "title bar", o.progressBar && "progress bar", o.censor && "censored"].filter(Boolean).join(", ");
  c.end("remotion", { note: `${o.captions ? `${o.captionStyle} captions${speakers ? ", coloured by speaker" : ""}` : "hook only"}${extras ? `, ${extras}` : ""}` });
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

/** How the source's colour gets to BT.709 SDR (probed once per job). */
async function colorOf(c: Ctx): Promise<SourceColor> {
  try {
    const p = await ffprobe(sourcePath(c), c.signal);
    const v = p.streams.find((st) => st.codec_type === "video");
    return v ? sourceColor(v, c.m.ffmpegToneMap) : "bt709";
  } catch {
    return "bt709";
  }
}

/** Every encode of ours says what it is, so players and YouTube don't guess. */
export const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];

async function batch(c: Ctx, shorts: Short[]) {
  const moviepy = Boolean(c.m.py.modules?.moviepy);
  c.begin("moviepy", moviepy ? "native" : "builtin", moviepy ? `FFmpeg plates + ${c.m.report.items.moviepy.engine} covers` : "FFmpeg plates + drawtext covers", `batch ×${shorts.length}`);
  const plan = upscalePlan(c);
  const src = c.s.source!;
  const color = await colorOf(c);
  if (color !== "bt709") c.log(color === "hdr" ? "HDR source: tone-mapping to SDR (BT.709)" : "SD source: converting BT.601 colour to BT.709", "info", "moviepy");
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
    const edit = editPlan(sh);
    const graph = composeGraph({
      kind: layout.kind,
      srcW: src.width,
      srcH: src.height,
      facecamShare: c.s.options.facecamShare,
      facecam: layout.facecam,
      crop: layout.crop,
      track: teaserTrack(layout.track, edit, sh.keep),
      segments: edit.segs.map((g) => [Math.max(0, g.a - sh.start), Math.min(span, g.b - sh.start)]),
      sharpen,
      audioIn,
      matteIn,
      fps: src.fps,
      outW: plan.plateW,
      outH: plan.plateH,
      zooms: sh.punches,
      flashAt: edit.teaser || undefined,
      color,
    });
    fs.writeFileSync(path.join(dir, "plate.graph.txt"), graph);
    const main = edit.body;
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
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", ...BT709,
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
    // The cover is the payoff frame: in the cold open, or where the story reaches it.
    const climax = sh.replayAt !== undefined ? storyTime(sh.keep, sh.replayAt) : null;
    const coverAt = edit.teaser ? edit.teaser * 0.55 : climax !== null ? Math.min(main - 0.1, climax + 0.1) : Math.min(main / 2, 3);
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
