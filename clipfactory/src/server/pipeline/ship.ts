import fs from "node:fs";
import path from "node:path";
import type { Short } from "../../lib/types.ts";
import { ffmpeg, ffprobe, run } from "../proc.ts";
import { REPLAY_SPEED, replayPlan, upscalePlan } from "./caption.ts";
import type { Ctx } from "./ctx.ts";
import { atempoChain } from "./layout.ts";
import { loudness } from "./media.ts";
import { sourcePath } from "./reframe.ts";

// Stage 06 · CUT & SHIP — trim, arrange, upscale, render.

const exp = (c: Ctx, ...f: string[]) => c.path("export", ...f);
const sdir = (c: Ctx, s: Short, ...f: string[]) => c.path("shorts", s.id, ...f);
const fileName = (s: Short) => `SHORT_${String(s.order ?? s.n).padStart(2, "0")}`;

export async function shipStage(c: Ctx, shorts: Short[] = c.s.shorts) {
  c.stage("ship");
  fs.mkdirSync(exp(c, "raw"), { recursive: true });
  const ordered = arrange(c, shorts);
  for (const short of ordered) {
    c.check();
    await trim(c, short);
    const plate = await upscale(c, short);
    const replay = await slowmo(c, short, plate);
    await exportShort(c, short, plate, replay);
  }
  writeManifest(c);
  c.endStage("ship");
}

// ── 15 Arrange: posting order, sequence files ───────────────────────────

function arrange(c: Ctx, shorts: Short[]): Short[] {
  c.begin("opencut", "builtin", "Posting order + EDL sequence", "Open the EDL in Resolve or Premiere, or the shorts in OpenCut, to keep editing");
  const order = [...c.s.shorts].sort((a, b) => b.score - a.score);
  c.update((s) => {
    order.forEach((o, i) => {
      const x = s.shorts.find((y) => y.id === o.id)!;
      x.order = i + 1;
    });
  });
  fs.mkdirSync(exp(c), { recursive: true });
  fs.writeFileSync(exp(c, "selects.edl"), edl(c, order));
  writeManifest(c);
  c.live({ shortId: order[0]?.id, t: order[0]?.start, tag: "arrange · posting order" });
  c.end("opencut", { note: `${order.length} in posting order, EDL written` });
  return order.filter((o) => shorts.some((s) => s.id === o.id)).map((o) => c.s.shorts.find((x) => x.id === o.id)!);
}

function tcode(sec: number, fps: number): string {
  const f = Math.round(sec * fps);
  const r = Math.round(fps);
  const ff = f % r;
  const s = Math.floor(f / r);
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60, ff].map((n) => String(n).padStart(2, "0")).join(":");
}

/** CMX 3600 EDL of every kept range, in posting order, pointing at the source VOD. */
export function edl(c: Ctx, order: Short[]): string {
  const fps = Math.round(c.s.source?.fps || 30) || 30;
  const reel = "AX";
  const name = path.basename(c.s.source?.file || "source.mp4");
  const lines = [`TITLE: ${c.s.name}`, "FCM: NON-DROP FRAME", ""];
  let rec = 3600; // 01:00:00:00
  let n = 1;
  for (const s of order) {
    for (const [a, b] of s.keep) {
      lines.push(`${String(n).padStart(3, "0")}  ${reel}       AA/V  C        ${tcode(a, fps)} ${tcode(b, fps)} ${tcode(rec, fps)} ${tcode(rec + (b - a), fps)}`);
      lines.push(`* FROM CLIP NAME: ${name}`);
      lines.push(`* COMMENT: ${fileName(s)} ${s.hook}`);
      lines.push("");
      rec += b - a;
      n++;
    }
    rec += 1; // a second of gap between shorts
  }
  return lines.join("\n");
}

function writeManifest(c: Ctx) {
  const rows = [...c.s.shorts].sort((a, b) => (a.order ?? a.n) - (b.order ?? b.n));
  const manifest = rows.map((s) => ({
    order: s.order,
    file: s.file ? path.basename(s.file) : null,
    title: s.title,
    hook: s.hook,
    description: s.description,
    hashtags: s.hashtags,
    score: s.score,
    duration: s.duration,
    sourceStart: s.start,
    sourceEnd: s.end,
    deadAirRemoved: s.deadAir,
    layout: s.layout?.kind,
    dubs: s.dubs.filter((d) => d.file).map((d) => path.basename(d.file!)),
    qa: s.qa,
  }));
  fs.writeFileSync(exp(c, "shorts.json"), JSON.stringify({ project: c.s.name, source: c.s.source?.title, url: c.s.source?.url, shorts: manifest }, null, 2));
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = ["order,file,title,description,hashtags,score,duration", ...manifest.map((m) => [m.order, m.file, m.title, m.description, m.hashtags.map((h) => `#${h}`).join(" "), m.score, m.duration].map(esc).join(","))];
  fs.writeFileSync(exp(c, "shorts.csv"), csv.join("\n"));
}

// ── 14 Trim: lossless raw cut + LosslessCut project ───────────────────────

/** Start a tool the first time a short reaches it, re-activate it for the next ones. */
function step(c: Ctx, tool: "losslesscut" | "esrgan" | "rife" | "ffmpeg", mode: "native" | "builtin", engine: string, note?: string): boolean {
  const st = c.s.tools[tool].state;
  if (st === "idle" || st === "skipped") {
    c.begin(tool, mode, engine, note);
    return true;
  }
  c.again(tool);
  return false;
}

async function trim(c: Ctx, short: Short) {
  if (step(c, "losslesscut", c.m.losslessCut ? "native" : "builtin", c.m.report.items.losslesscut.engine, "Stream copy: zero re-encode")) writeLlc(c);
  const src = sourcePath(c);
  const ext = path.extname(src).toLowerCase() === ".webm" ? ".mkv" : path.extname(src) || ".mp4";
  const out = exp(c, "raw", `${fileName(short)}_raw${ext}`);
  c.live({ t: short.start, shortId: short.id, tag: "trim · 0 re-encode", boxes: undefined, faces: undefined, crop: undefined, caption: undefined });
  await ffmpeg(["-ss", short.start.toFixed(3), "-to", short.end.toFixed(3), "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-avoid_negative_ts", "make_zero", out], { signal: c.signal });
  c.update((s) => {
    const x = s.shorts.find((y) => y.id === short.id)!;
    x.raw = path.relative(c.dir, out).split(path.sep).join("/");
    x.progress = Math.max(x.progress, 0.6);
  });
  c.end("losslesscut", { note: "raw cuts + project.llc" });
}

/** LosslessCut opens <video>-proj.llc automatically when you open the video. */
function writeLlc(c: Ctx) {
  const src = sourcePath(c);
  const name = path.basename(src);
  const segments = [...c.s.shorts]
    .sort((a, b) => a.start - b.start)
    .map((s) => `    { start: ${s.start.toFixed(3)}, end: ${s.end.toFixed(3)}, name: ${JSON.stringify(`${s.hook} (${s.score})`)} },`);
  const body = `{\n  version: 1,\n  mediaFileName: ${JSON.stringify(name)},\n  cutSegments: [\n${segments.join("\n")}\n  ],\n}\n`;
  fs.writeFileSync(exp(c, "project.llc"), body);
  try {
    fs.writeFileSync(path.join(path.dirname(src), `${name.replace(/\.[^.]+$/, "")}-proj.llc`), body);
  } catch {
    /* source folder may be read-only */
  }
}

// ── 16 Upscale: Real-ESRGAN ─────────────────────────────────────────────

async function upscale(c: Ctx, short: Short): Promise<string> {
  const plate = sdir(c, short, "plate.mkv");
  const plan = upscalePlan(c);
  const src = c.s.source!;
  if (plan.factor === 1) {
    if (c.s.tools.esrgan.state === "idle") {
      const why = c.s.options.upscale === "off" ? "Upscaling is off" : src.height < 900 ? "Lanczos + sharpen in the plate (Real-ESRGAN isn't installed)" : `Source is ${src.height}p, no upscale needed`;
      c.skip("esrgan", c.s.options.upscale === "off" ? "off" : "builtin", c.m.report.items.esrgan.engine, why);
    }
    return plate;
  }
  step(c, "esrgan", plan.ai ? "native" : "builtin", plan.ai ? c.m.report.items.esrgan.engine : "Lanczos + sharpen", `×${plan.factor} to ${plan.outW}×${plan.outH}`);
  c.live({ t: short.start, shortId: short.id, upscale: { from: plan.plateH, to: plan.outH, factor: plan.factor }, tag: `${plan.outH >= 3840 ? "4K" : `${plan.outH}p`} ×${plan.factor}` });
  if (!plan.ai) {
    // Lanczos happens in the export pass.
    c.end("esrgan", { note: `×${plan.factor} Lanczos` });
    return plate;
  }
  const work = sdir(c, short, "esrgan");
  const inDir = path.join(work, "in");
  const outDir = path.join(work, "out");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(inDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const fps = Math.min(60, Math.round(src.fps) || 30);
  try {
    await ffmpeg(["-i", plate, "-map", "0:v:0", path.join(inDir, "f%06d.png")], { signal: c.signal });
    const total = fs.readdirSync(inDir).length;
    const tool = c.m.esrgan!;
    await run(tool.bin, ["-i", inDir, "-o", outDir, "-m", tool.models, "-n", "realesr-animevideov3", "-s", String(plan.factor), "-f", "png"], {
      signal: c.signal,
      onLine: () => {
        const done = fs.readdirSync(outDir).length;
        c.update((s) => {
          const x = s.shorts.find((y) => y.id === short.id)!;
          x.progress = Math.max(x.progress, 0.6 + 0.12 * (done / Math.max(1, total)));
        });
      },
    });
    const up = sdir(c, short, "plate_up.mkv");
    await ffmpeg(["-framerate", String(fps), "-i", path.join(outDir, "f%06d.png"), "-i", plate, "-map", "0:v", "-map", "1:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "15", "-pix_fmt", "yuv420p", "-c:a", "copy", up], { signal: c.signal });
    c.end("esrgan", { note: `×${plan.factor} AI upscale` });
    return up;
  } catch (err) {
    if (c.signal.aborted) throw err;
    c.log(`Real-ESRGAN failed (${(err as Error).message}); using Lanczos`, "warn", "esrgan");
    c.end("esrgan", { mode: "builtin", engine: "Lanczos + sharpen", note: "AI upscale failed" });
    return plate;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ── 17 Slow-mo: RIFE replay ─────────────────────────────────────────────

async function slowmo(c: Ctx, short: Short, plate: string): Promise<string | null> {
  const plan = replayPlan(c, short);
  if (!plan) {
    if (c.s.tools.rife.state === "idle") c.skip("rife", "off", c.m.report.items.rife.engine, c.s.options.slowmo ? "No clear climax" : "Slow-motion replay is off");
    return null;
  }
  const native = c.m.report.items.rife.available;
  step(c, "rife", native ? "native" : "builtin", c.m.report.items.rife.engine);
  const fps = Math.min(60, Math.round(c.s.source!.fps) || 30);
  const effective = Math.round(fps / REPLAY_SPEED);
  c.live({ t: short.replayAt, shortId: short.id, tag: `${fps} → ${effective} fps · ×${REPLAY_SPEED}`, upscale: undefined });
  const out = sdir(c, short, "replay.mkv");
  const len = plan.to - plan.from;
  const audio = `atrim=0:${len.toFixed(3)},asetpts=PTS-STARTPTS,${atempoChain(REPLAY_SPEED)},lowpass=f=5000`;
  if (native) {
    const work = sdir(c, short, "rife");
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(path.join(work, "in"), { recursive: true });
    fs.mkdirSync(path.join(work, "out"), { recursive: true });
    try {
      await ffmpeg(["-ss", plan.from.toFixed(3), "-t", len.toFixed(3), "-i", plate, "-map", "0:v:0", path.join(work, "in", "f%06d.png")], { signal: c.signal });
      const frames = fs.readdirSync(path.join(work, "in")).length;
      await run(c.m.rife!.bin, ["-i", path.join(work, "in"), "-o", path.join(work, "out"), "-m", c.m.rife!.model, "-n", String(Math.round(frames / REPLAY_SPEED))], { signal: c.signal });
      await ffmpeg(
        ["-framerate", String(fps), "-i", path.join(work, "out", "%08d.png"), "-ss", plan.from.toFixed(3), "-i", plate, "-filter_complex", `[1:a]${audio}[a]`, "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "15", "-pix_fmt", "yuv420p", "-c:a", "flac", "-shortest", out],
        { signal: c.signal },
      );
      c.end("rife", { note: `×${REPLAY_SPEED} replay` });
      return out;
    } catch (err) {
      if (c.signal.aborted) throw err;
      c.log(`RIFE failed (${(err as Error).message}); using minterpolate`, "warn", "rife");
      c.update((s) => (s.tools.rife = { ...s.tools.rife, mode: "builtin", engine: "FFmpeg minterpolate" }));
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
  // Motion-compensated interpolation at half size keeps this quick on a CPU.
  const [W, H] = [540, 960];
  const probe = await ffprobe(plate, c.signal);
  const pv = probe.streams.find((s) => s.codec_type === "video");
  const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
  const graph = [
    `[0:v]scale=${W}:${H},setpts=PTS/${REPLAY_SPEED},minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,scale=${pv?.width ?? 1080}:${pv?.height ?? 1920}:flags=lanczos,format=yuv420p[v]`,
    ...(hasAudio ? [`[0:a]${audio}[a]`] : []),
  ].join(";");
  await ffmpeg(
    ["-ss", plan.from.toFixed(3), "-t", len.toFixed(3), "-i", plate, "-filter_complex", graph, "-map", "[v]", ...(hasAudio ? ["-map", "[a]", "-c:a", "flac"] : []), "-c:v", "libx264", "-preset", "veryfast", "-crf", "15", out],
    { signal: c.signal, duration: plan.length },
  );
  c.end("rife", { note: `×${REPLAY_SPEED} replay` });
  return out;
}

// ── 18 Export: captions, loudness, platform-ready MP4 ─────────────────────

async function exportShort(c: Ctx, short: Short, plate: string, replay: string | null) {
  step(c, "ffmpeg", "native", c.m.report.items.ffmpeg.engine, "H.264 + AAC, −14 LUFS, faststart");
  const sh = c.s.shorts.find((x) => x.id === short.id)!;
  const plan = upscalePlan(c);
  const dir = sdir(c, sh);
  const name = fileName(sh);
  const out = exp(c, `${name}.mp4`);
  c.update((s) => {
    const x = s.shorts.find((y) => y.id === sh.id)!;
    x.status = "rendering";
  });
  c.live({ t: sh.start, shortId: sh.id, tag: undefined, caption: sh.hook });

  const probe = await ffprobe(plate, c.signal);
  const hasAudio = probe.streams.some((s) => s.codec_type === "audio");
  const pv = probe.streams.find((s) => s.codec_type === "video")!;
  const inputs = ["-i", path.basename(plate)];
  if (replay) inputs.push("-i", path.basename(replay));
  const parts: string[] = [];
  let v = "[0:v]";
  let a = hasAudio ? "[0:a]" : "";
  if (replay) {
    parts.push(`[0:v]${hasAudio ? "[0:a]" : ""}[1:v]${hasAudio ? "[1:a]" : ""}concat=n=2:v=1:a=${hasAudio ? 1 : 0}[cv]${hasAudio ? "[ca]" : ""}`);
    v = "[cv]";
    a = hasAudio ? "[ca]" : "";
  }
  const needScale = (pv.width ?? plan.outW) !== plan.outW;
  const scale = needScale ? `scale=${plan.outW}:${plan.outH}:flags=lanczos,unsharp=5:5:0.5:5:5:0,` : "";
  const subs = c.m.ffmpegHasLibass ? `subtitles=captions.ass:fontsdir=../../fonts,` : "";
  parts.push(`${v}${scale}${subs}format=yuv420p[vo]`);
  if (a) parts.push(`${a}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[ao]`);
  const total = sh.duration;
  await ffmpeg(
    [
      ...inputs,
      "-filter_complex", parts.join(";"),
      "-map", "[vo]", ...(a ? ["-map", "[ao]"] : []),
      "-c:v", "libx264", "-preset", "medium", "-crf", plan.outH > 1920 ? "20" : "19", "-profile:v", "high", "-pix_fmt", "yuv420p",
      ...(a ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-movflags", "+faststart",
      "-metadata", `title=${sh.title}`,
      "-metadata", `comment=${sh.description}`,
      path.relative(dir, out),
    ],
    {
      cwd: dir,
      duration: total,
      signal: c.signal,
      onProgress: (f) =>
        c.update((s) => {
          const x = s.shorts.find((y) => y.id === sh.id)!;
          x.progress = Math.max(x.progress, 0.72 + f * 0.24);
        }),
    },
  );
  if (fs.existsSync(path.join(dir, "cover.jpg"))) fs.copyFileSync(path.join(dir, "cover.jpg"), exp(c, `${name}.jpg`));

  // Dubbed versions: same picture, the dub on the main part, the replay's slowed game audio after it.
  const dubs = [...sh.dubs];
  for (const d of dubs) {
    const wav = path.join(dir, `dub_${d.lang}.wav`);
    if (d.error || !fs.existsSync(wav)) continue;
    const dubOut = exp(c, `${name}.${d.lang}.mp4`);
    const audioGraph = replay && hasAudio ? `[1:a][2:a]concat=n=2:v=0:a=1,loudnorm=I=-14:TP=-1.5:LRA=11[a]` : `[1:a]loudnorm=I=-14:TP=-1.5:LRA=11[a]`;
    await ffmpeg(["-i", out, "-i", wav, ...(replay && hasAudio ? ["-i", replay] : []), "-filter_complex", audioGraph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dubOut], { signal: c.signal });
    d.file = path.relative(c.dir, dubOut).split(path.sep).join("/");
  }

  const qa = await qaCheck(c, out, total, plan.outW, plan.outH, hasAudio);
  c.update((s) => {
    const x = s.shorts.find((y) => y.id === sh.id)!;
    x.status = "done";
    x.progress = 1;
    x.file = path.relative(c.dir, out).split(path.sep).join("/");
    x.cover = fs.existsSync(exp(c, `${name}.jpg`)) ? `export/${name}.jpg` : undefined;
    x.dubs = dubs;
    x.qa = qa;
    s.shipped = s.shorts.filter((y) => y.status === "done").length;
  });
  c.log(`${name}.mp4 shipped (${total.toFixed(1)} s${qa.ok ? "" : `, QA: ${qa.notes.join("; ")}`})`, qa.ok ? "info" : "warn", "ffmpeg");
  c.end("ffmpeg", { note: `${c.s.shipped} shipped` });
}

/** The qa-agent: checks every short before it counts as shipped. */
async function qaCheck(c: Ctx, file: string, expected: number, w: number, h: number, wantAudio: boolean): Promise<{ ok: boolean; notes: string[] }> {
  const notes: string[] = [];
  const p = await ffprobe(file, c.signal);
  const v = p.streams.find((s) => s.codec_type === "video");
  const dur = Number(p.format.duration || 0);
  if (!v) notes.push("no video stream");
  else if (v.width !== w || v.height !== h) notes.push(`size ${v.width}×${v.height}, expected ${w}×${h}`);
  if (Math.abs(dur - expected) > 0.6) notes.push(`length ${dur.toFixed(1)} s, expected ${expected.toFixed(1)} s`);
  if (wantAudio) {
    if (!p.streams.some((s) => s.codec_type === "audio")) notes.push("no audio");
    else {
      const l = await loudness(file, c.signal);
      if (l && Math.abs(l.lufs + 14) > 2.5) notes.push(`loudness ${l.lufs.toFixed(1)} LUFS`);
      if (l && l.lufs < -40) notes.push("audio is near silent");
    }
  }
  if (dur > 180) notes.push("over 3 minutes: too long for Shorts");
  return { ok: notes.length === 0, notes };
}

