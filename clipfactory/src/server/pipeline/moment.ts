import fs from "node:fs";
import path from "node:path";
import type { Short, Transcript, Word } from "../../lib/types.ts";
import { ffmpeg, py, run } from "../proc.ts";
import { claudeEnabled, claudeMoments, claudeModel, claudeWatch, describeError, modelLabel } from "./claude.ts";
import type { Ctx } from "./ctx.ts";
import { TEASER_MAX, TEASER_MIN } from "./edit.ts";
import { pickMoments, refineBounds, type MomentPick } from "./heuristics.ts";
import { envelope, frameAt, spikes, type AudioLevels } from "./media.ts";
import { audienceScore, describeSignals, type Signals } from "./signals.ts";
import { transcriptFromSubs } from "./subs.ts";

// Stage 02 · FIND THE MOMENT — transcript, viral score, kill dead air.

export async function momentStage(c: Ctx) {
  c.stage("moment");
  const transcript = await transcribe(c);
  await score(c, transcript);
  await refineCaptions(c);
  await deadAir(c);
  c.endStage("moment");
}

export function readLevels(c: Ctx): AudioLevels {
  try {
    return JSON.parse(fs.readFileSync(c.path("levels.json"), "utf8")) as AudioLevels;
  } catch {
    return { tenths: [], seconds: [] };
  }
}

export function readTranscript(c: Ctx): Transcript {
  try {
    return JSON.parse(fs.readFileSync(c.path("transcript.json"), "utf8")) as Transcript;
  } catch {
    return { engine: "none", words: [], segments: [] };
  }
}

// ── 03 Transcribe ────────────────────────────────────────────────────

/** Whisper spells names it was primed with: the streamer's name, friends, games, slang. */
function glossaryOf(c: Ctx): string | undefined {
  const words = [...new Set([...(c.s.options.vocabulary ?? []), c.s.source?.uploader].filter((w): w is string => Boolean(w && w.trim())))];
  return words.length ? `Glossary: ${words.join(", ")}.` : undefined;
}

async function transcribe(c: Ctx): Promise<Transcript> {
  const src = c.s.source!;
  const empty: Transcript = { engine: "none", words: [], segments: [] };
  if (!src.hasAudio) {
    c.skip("whisperx", "off", "No audio track", "The VOD has no audio");
    return save(c, empty);
  }
  const mods = c.m.py.modules ?? {};
  const engines = ["whisperx", "faster_whisper", "whisper"].filter((m) => mods[m]);
  let whisperError: string | undefined;
  if (engines.length) {
    const native = Boolean(mods.whisperx);
    c.begin("whisperx", native ? "native" : "builtin", c.m.report.items.whisperx.engine, native ? undefined : "WhisperX isn't installed");
    try {
      const args = ["--audio", c.path("audio16k.wav"), "--out", c.path("transcript.json"), "--duration", String(src.duration)];
      if (c.s.options.language) args.push("--language", c.s.options.language);
      const glossary = glossaryOf(c);
      if (glossary) args.push("--prompt", glossary);
      let lastLive = 0;
      const { result } = await py("cf_transcribe", args, {
        signal: c.signal,
        onEvent: (e) => {
          if (e.type === "segment" && Date.now() - lastLive > 400) {
            lastLive = Date.now();
            c.live({ t: Number(e.s), caption: String(e.text).slice(0, 80) });
          }
        },
        onLog: (l) => c.log(l, "info", "whisperx"),
      });
      const t = readTranscript(c);
      const engine = String(result?.engine ?? t.engine);
      c.update((s) => {
        s.analysis.transcript = { engine, language: t.language, words: t.words.length, speakers: t.speakers };
      });
      c.end("whisperx", { engine, mode: result?.native ? "native" : "builtin", note: `${t.words.length} words${t.speakers ? `, ${t.speakers} speakers` : ""}` });
      c.live({ caption: undefined });
      return t;
    } catch (err) {
      if (c.signal.aborted) throw err;
      whisperError = (err as Error).message.split("\n")[0].replace(/^python exited with code \d+: /, "");
      c.log(`Transcription failed: ${(err as Error).message}`, "warn", "whisperx");
    }
  }

  // No Whisper: the platform's own captions, or subtitles that came with the file.
  const subs = await platformCaptions(c);
  if (subs && subs.words.length) {
    c.begin("whisperx", "builtin", subs.engine, whisperError ? "Whisper failed; using the subtitles" : "No Whisper engine installed");
    save(c, subs);
    c.update((s) => {
      s.analysis.transcript = { engine: subs.engine, language: subs.language, words: subs.words.length, whisperError };
    });
    c.end("whisperx", { note: `${subs.words.length} words` });
    return subs;
  }
  c.skip("whisperx", "missing", "No transcript", "Install WhisperX (npm run setup -- --full) for word captions");
  c.log("No transcript: shorts get the hook but no word captions. Install WhisperX for captions.", "warn", "whisperx");
  return save(c, empty);
}

function save(c: Ctx, t: Transcript): Transcript {
  fs.writeFileSync(c.path("transcript.json"), JSON.stringify(t));
  return t;
}

async function platformCaptions(c: Ctx): Promise<Transcript | null> {
  const o = c.s.options;
  const lang = o.language || "en";
  // A sidecar subtitle file that came with the upload or sits next to the CLI's file.
  const candidates = ["subs.srt", "subs.vtt"].map((f) => c.path(f));
  if (o.file && path.isAbsolute(o.file)) {
    const base = o.file.replace(/\.[^.]+$/, "");
    candidates.push(`${base}.srt`, `${base}.vtt`, `${base}.${lang}.srt`, `${base}.${lang}.vtt`);
  }
  for (const f of candidates) {
    if (fs.existsSync(f)) return transcriptFromSubs(fs.readFileSync(f, "utf8"), f.endsWith(".vtt") ? "vtt" : "srt", `Subtitles (${path.basename(f)})`, lang);
  }
  if (!o.url || !c.m.ytdlp) return null;
  try {
    await run(
      c.m.ytdlp[0],
      [...c.m.ytdlp.slice(1), "--skip-download", "--no-playlist", "--write-subs", "--write-auto-subs", "--sub-langs", `${lang}.*,${lang}`, "--sub-format", "json3/vtt/best", "-o", "subs.%(ext)s", o.url],
      { cwd: c.dir, signal: c.signal, allowFail: true },
    );
  } catch {
    return null;
  }
  const files = fs.readdirSync(c.dir).filter((f) => f.startsWith("subs.") && /\.(json3|vtt|srt)$/.test(f));
  const pick = files.find((f) => f.endsWith(".json3")) ?? files.find((f) => f.endsWith(".vtt")) ?? files[0];
  if (!pick) return null;
  const kind = pick.endsWith(".json3") ? "json3" : pick.endsWith(".vtt") ? "vtt" : "srt";
  return transcriptFromSubs(fs.readFileSync(c.path(pick), "utf8"), kind, "Platform captions (yt-dlp)", lang);
}

// ── 04 Score ─────────────────────────────────────────────────────────

/** Timeline rows before any stems exist: the mix for GAME, the mix where someone is talking for VOICE. */
function paintVoiceActivity(c: Ctx, transcript: Transcript) {
  const peaks = c.s.analysis.peaks;
  const dur = c.s.source!.duration;
  if (!peaks.length) return;
  const n = peaks.length;
  const talking = new Array<boolean>(n).fill(false);
  for (const w of transcript.words) {
    const a = Math.floor((w.s / dur) * n);
    const b = Math.min(n - 1, Math.floor((w.e / dur) * n));
    for (let i = a; i <= b; i++) talking[i] = true;
  }
  const voice = transcript.words.length ? peaks.map((p, i) => (talking[i] ? p : p * 0.12)) : [...peaks];
  c.update((s) => {
    s.analysis.voice = voice;
    s.analysis.game = [...peaks];
  });
}

/** A cold open has to sit inside the final clip, be long enough to land, and come from late in it (it's the payoff). */
export function coldOpen(t: [number, number] | undefined, start: number, end: number): [number, number] | undefined {
  if (!t) return undefined;
  const a = Math.max(start, Math.min(t[0], t[1]));
  const b = Math.min(end, Math.max(t[0], t[1]), a + TEASER_MAX);
  if (b - a < TEASER_MIN || a < start + 0.35 * (end - start)) return undefined;
  return [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000];
}

function readSignals(c: Ctx): Signals | null {
  try {
    return JSON.parse(fs.readFileSync(c.path("signals.json"), "utf8")) as Signals;
  } catch {
    return null;
  }
}

/** Six frames across a moment, tiled 3×2, from the small analysis proxy. */
async function contactSheet(c: Ctx, id: string, start: number, end: number): Promise<string> {
  const dir = c.path("moments");
  fs.mkdirSync(dir, { recursive: true });
  const span = Math.max(0.5, end - start);
  for (let i = 0; i < 6; i++) await frameAt(c.path("analysis.mp4"), start + span * ((i + 0.5) / 6), path.join(dir, `${id}_${i}.jpg`), 320, c.signal);
  const out = path.join(dir, `${id}.jpg`);
  await ffmpeg(["-i", path.join(dir, `${id}_%d.jpg`), "-vf", "tile=3x2:padding=4:color=black", "-frames:v", "1", "-q:v", "4", out], { signal: c.signal });
  for (let i = 0; i < 6; i++) fs.rmSync(path.join(dir, `${id}_${i}.jpg`), { force: true });
  return out;
}

async function score(c: Ctx, transcript: Transcript) {
  paintVoiceActivity(c, transcript);
  const o = c.s.options;
  const src = c.s.source!;
  const levels = readLevels(c);
  const signals = o.audience ? readSignals(c) : null;
  const audience = signals ? audienceScore(signals, src.duration) : undefined;
  let picks: MomentPick[] = [];
  const useClaude = claudeEnabled() && transcript.words.length >= 30;
  if (useClaude) {
    const model = claudeModel();
    const label = modelLabel(model);
    c.begin("shortsgen", "native", `Claude ${label}`, "LLM highlight picking over the transcript, audience signals and the pictures");
    c.update((s) => {
      s.orchestrator = { engine: "claude", model };
    });
    c.live({ tag: `${label} · reading ${transcript.words.length.toLocaleString()} words` });
    try {
      // Stage 1: read everything, propose about twice as many moments as needed.
      const want = Math.max(o.count, Math.min(o.count * 2, o.count + 8));
      const out = await claudeMoments({
        sourceTitle: src.title,
        uploader: src.uploader,
        duration: src.duration,
        words: transcript.words,
        segments: transcript.segments,
        spikes: spikes(levels.seconds),
        audience: signals?.sources.length ? describeSignals(signals) : undefined,
        count: o.count,
        candidates: want,
        minSec: o.minSec,
        maxSec: o.maxSec,
        instructions: o.instructions,
        signal: c.signal,
        onProgress: (phase, chars) => c.live({ tag: phase === "thinking" ? `${label} · thinking` : `${label} · writing ${chars} chars` }),
      });
      picks = out.picks.map((p) => ({ ...p, ...refineBounds(p.start, p.end, { words: transcript.words, cuts: c.s.analysis.cuts, duration: src.duration, minSec: o.minSec, maxSec: o.maxSec }) }));
      let usd = out.usd;
      c.log(`Claude proposed ${picks.length} moments ($${out.usd.toFixed(3)})`, "info", "shortsgen");
      // Stage 2: watch each candidate and keep the ones that look as good as they read.
      if (picks.length) {
        c.live({ tag: `${label} · watching ${picks.length} moments` });
        const sheets: string[] = new Array(picks.length);
        let next = 0;
        const worker = async () => {
          while (next < picks.length) {
            const i = next++;
            sheets[i] = await contactSheet(c, `cand_${String(i + 1).padStart(2, "0")}`, picks[i].start, picks[i].end);
            c.live({ t: picks[i].start, sheet: path.relative(c.dir, sheets[i]) });
          }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        const cands = picks.map((p, i) => ({
          id: i + 1,
          title: p.title,
          start: p.start,
          end: p.end,
          transcript: transcript.words.filter((w) => w.s >= p.start && w.e <= p.end).map((w) => w.w).join(" "),
          sheet: fs.readFileSync(sheets[i]),
        }));
        try {
          const watched = await claudeWatch(cands, c.signal);
          usd += watched.usd;
          const rejected = new Set<number>();
          picks = picks.map((p, i) => {
            const r = watched.ratings.get(i + 1);
            if (!r) return p;
            if (!r.keep) rejected.add(i);
            return { ...p, watched: r.score, score: Math.round(0.4 * p.score + 0.6 * r.score), reason: r.keep ? p.reason : `${p.reason} (On screen: ${r.note})` };
          });
          const kept = picks.filter((_, i) => !rejected.has(i));
          if (rejected.size) c.log(`Claude watched the candidates and dropped ${rejected.size} that don't hold up on screen`, "info", "shortsgen");
          // Rejected ones only come back to make up the count, and only if they still looked decent.
          picks = kept.length >= Math.min(o.count, picks.length) ? kept : [...kept, ...picks.filter((p, i) => rejected.has(i) && (p.watched ?? 0) >= 50)];
        } catch (err) {
          if (c.signal.aborted) throw err;
          c.log(`Claude couldn't watch the candidates (${describeError(err)}); using its reading only`, "warn", "shortsgen");
        }
      }
      c.update((s) => {
        s.orchestrator = { engine: "claude", model: out.model, usd: (s.orchestrator.usd ?? 0) + usd };
      });
    } catch (err) {
      if (c.signal.aborted) throw err;
      c.log(`Claude couldn't pick moments: ${describeError(err)}. Using the built-in scorer.`, "warn", "shortsgen");
      picks = [];
      c.update((s) => {
        s.orchestrator = { engine: "heuristic", note: describeError(err) };
        s.tools.shortsgen = { ...s.tools.shortsgen, mode: "builtin", engine: "Loudness + hype-word scorer" };
      });
    }
  } else {
    c.begin("shortsgen", "builtin", signals?.sources.length ? "Audience + loudness + hype-word scorer" : "Loudness + hype-word scorer", claudeEnabled() ? "Not enough transcript for Claude" : "Add ANTHROPIC_API_KEY to let Claude pick");
  }
  if (!picks.length) {
    picks = pickMoments({
      duration: src.duration,
      loudness: levels.seconds,
      words: transcript.words,
      cuts: c.s.analysis.cuts,
      count: o.count,
      minSec: o.minSec,
      maxSec: o.maxSec,
      sourceTitle: src.title,
      audience,
    });
  }
  if (!picks.length) throw new Error("Couldn't find any moments in this VOD (is it silent?).");
  picks.sort((a, b) => b.score - a.score);
  // Refined edges can make two picks touch; keep the better one.
  const chosen: MomentPick[] = [];
  for (const p of picks) {
    if (chosen.length >= o.count) break;
    if (chosen.some((q) => p.start < q.end + 1 && p.end > q.start - 1)) continue;
    chosen.push(p);
  }
  const shorts: Short[] = chosen.map((p, i) => ({
    id: `short_${String(i + 1).padStart(2, "0")}`,
    n: i + 1,
    title: p.title,
    hook: p.hook,
    reason: p.reason,
    score: p.score,
    description: p.description,
    hashtags: p.hashtags,
    start: p.start,
    end: p.end,
    keep: [[p.start, p.end]],
    deadAir: 0,
    duration: p.end - p.start,
    replayAt: p.replayAt,
    teaser: o.teaser ? coldOpen(p.teaser, p.start, p.end) : undefined,
    emphasis: p.emphasis,
    headline: p.headline,
    category: p.category,
    watched: p.watched,
    status: "planned",
    progress: 0,
    dubs: [],
  }));
  for (const s of shorts) fs.mkdirSync(c.path("shorts", s.id), { recursive: true });
  c.update((s) => {
    s.shorts = shorts;
  });
  c.live({ t: shorts[0].start, shortId: shorts[0].id, tag: `viral score ${shorts[0].score}`, sheet: undefined });
  c.end("shortsgen", { note: `${shorts.length} moments, best ${shorts[0].score}${signals?.sources.length ? " · audience signals" : ""}` });
}

// ── Second pass: the best Whisper model on just the chosen moments ───────────

/** The model for the caption pass: CF_WHISPER_CAPTION_MODEL, or the most accurate one that runs well here. */
export function captionModel(cuda: boolean): string | null {
  const env = process.env.CF_WHISPER_CAPTION_MODEL?.trim();
  if (env) return /^(off|none|0|false)$/i.test(env) ? null : env;
  return cuda ? "large-v3" : "large-v3-turbo";
}

/** Windows of the source glued together with silence between them, and the way back. */
export interface Splice {
  src: number;
  out: number;
  len: number;
}

export function spliceWindows(ranges: [number, number][], gap = 1.5): Splice[] {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + gap) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  let out = 0;
  return merged.map(([a, b]) => {
    const s = { src: a, out, len: b - a };
    out += b - a + gap;
    return s;
  });
}

/** Words from the spliced file back onto the source timeline; speaker labels from the first pass. */
export function unsplice(fresh: Word[], splices: Splice[], old: Word[]): { words: Word[]; spans: [number, number][] } {
  const mapped: Word[] = [];
  const spans: [number, number][] = [];
  for (const sp of splices) {
    const inside = fresh.filter((w) => w.s >= sp.out - 0.05 && w.s < sp.out + sp.len);
    if (!inside.length) continue;
    const words = inside.map((w) => {
      const s = sp.src + Math.max(0, w.s - sp.out);
      const e = Math.min(sp.src + sp.len, sp.src + Math.max(0, w.e - sp.out));
      const word: Word = { w: w.w, s: Math.round(s * 1000) / 1000, e: Math.round(Math.max(s, e) * 1000) / 1000 };
      const mid = (word.s + word.e) / 2;
      let best: Word | undefined;
      let dist = 0.6;
      for (const o of old) {
        if (o.sp === undefined) continue;
        const d = mid < o.s ? o.s - mid : mid > o.e ? mid - o.e : 0;
        if (d < dist) {
          dist = d;
          best = o;
        }
      }
      if (best) word.sp = best.sp;
      return word;
    });
    mapped.push(...words);
    spans.push([words[0].s, words[words.length - 1].e]);
  }
  // Old words inside a re-transcribed span give way; the rest stay.
  const kept = old.filter((w) => !spans.some(([a, b]) => (w.s + w.e) / 2 >= a - 0.05 && (w.s + w.e) / 2 <= b + 0.05));
  return { words: [...kept, ...mapped].sort((x, y) => x.s - y.s), spans };
}

/** Captions deserve the most accurate model, but only the chosen minutes need it: one more pass over just those. */
export async function refineCaptions(c: Ctx) {
  const mods = c.m.py.modules ?? {};
  if (!mods.whisperx && !mods.faster_whisper && !mods.whisper) return;
  const t = readTranscript(c);
  const best = captionModel(Boolean(c.m.cuda));
  if (!best || !t.words.length || !c.s.shorts.length || t.engine.endsWith(` ${best}`) || c.s.analysis.transcript?.refined) return;
  const failed = c.s.analysis.transcript?.whisperError;
  if (failed) {
    c.log(`No second caption pass: Whisper couldn't run here (${failed})`, "info", "whisperx");
    return;
  }
  const splices = spliceWindows(c.s.shorts.map((s) => [Math.max(0, s.start - 0.75), Math.min(c.s.source!.duration, s.end + 0.75)]));
  const total = splices.reduce((n, s) => n + s.len + 1.5, 0);
  c.again("whisperx");
  c.log(`Second caption pass: ${Math.round(total)} s of chosen moments with Whisper ${best}`, "info", "whisperx");
  c.live({ tag: `whisper ${best} · exact captions` });
  const wav = c.path("caption16k.wav");
  const out = c.path("caption-words.json");
  try {
    const parts = splices.map((s, i) => `[0:a]atrim=${s.src.toFixed(3)}:${(s.src + s.len).toFixed(3)},asetpts=PTS-STARTPTS,apad=pad_dur=1.5[a${i}]`);
    const graph = `${parts.join(";")};${splices.map((_, i) => `[a${i}]`).join("")}concat=n=${splices.length}:v=0:a=1[out]`;
    await ffmpeg(["-i", c.path("audio16k.wav"), "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { signal: c.signal });
    const args = ["--audio", wav, "--out", out, "--model", best, "--no-diarize", "--duration", total.toFixed(1)];
    const lang = c.s.options.language || t.language;
    if (lang) args.push("--language", lang);
    const glossary = glossaryOf(c);
    if (glossary) args.push("--prompt", glossary);
    await py("cf_transcribe", args, { signal: c.signal, onLog: (l) => c.log(l, "info", "whisperx") });
    const fresh = (JSON.parse(fs.readFileSync(out, "utf8")) as Transcript).words;
    const { words, spans } = unsplice(fresh, splices, t.words);
    if (!spans.length) throw new Error("no words came back");
    fs.writeFileSync(c.path("transcript.json"), JSON.stringify({ ...t, words }));
    c.update((s) => {
      if (s.analysis.transcript) s.analysis.transcript.refined = best;
    });
    c.end("whisperx", { note: `${t.words.length} words · captions re-transcribed with ${best}` });
  } catch (err) {
    if (c.signal.aborted) throw err;
    c.log(`Second caption pass failed (${(err as Error).message.split("\n")[0]}); keeping the first pass`, "warn", "whisperx");
    c.end("whisperx");
  } finally {
    fs.rmSync(wav, { force: true });
  }
}

// ── 05 Silence ───────────────────────────────────────────────────────

async function deadAir(c: Ctx) {
  const o = c.s.options;
  if (!o.removeSilence || !c.s.source?.hasAudio) {
    c.skip("autoeditor", "off", "Off", o.removeSilence ? "No audio track" : "Dead-air removal is off");
    return;
  }
  const native = Boolean(c.m.autoEditor);
  c.begin("autoeditor", native ? "native" : "builtin", c.m.report.items.autoeditor.engine);
  const levels = readLevels(c);
  let total = 0;
  for (const short of c.s.shorts) {
    c.check();
    const span = short.end - short.start;
    const wav = c.path("shorts", short.id, "window16k.wav");
    await ffmpeg(["-ss", short.start.toFixed(3), "-t", span.toFixed(3), "-i", c.path("audio16k.wav"), "-c:a", "pcm_s16le", wav], { signal: c.signal });
    let silent: [number, number][] = [];
    if (native) {
      try {
        silent = await autoEditorSilences(c, wav, span, short.id);
      } catch (err) {
        if (c.signal.aborted) throw err;
        c.log(`auto-editor failed (${(err as Error).message}); using silencedetect`, "warn", "autoeditor");
        silent = await silenceDetect(c, wav, span);
      }
    } else {
      silent = await silenceDetect(c, wav, span);
    }
    const keep = keepRanges(silent, span, o.minSec);
    const kept = keep.reduce((a, [x, y]) => a + (y - x), 0);
    const removed = Math.max(0, span - kept);
    total += removed;
    const abs = keep.map(([a, b]) => [round(short.start + a), round(short.start + b)] as [number, number]);
    c.update((s) => {
      const sh = s.shorts.find((x) => x.id === short.id)!;
      sh.keep = abs;
      sh.deadAir = round(removed);
      sh.duration = round(kept);
    });
    const a = Math.floor(short.start * 10);
    const b = Math.ceil(short.end * 10);
    c.live({
      t: short.start,
      shortId: short.id,
      deadAir: round(removed),
      silence: {
        peaks: envelope(levels.tenths.slice(a, b), 160),
        regions: gaps(keep, span),
        span: [short.start, short.end],
      },
    });
  }
  c.log(`Cut ${total.toFixed(1)} s of dead air across ${c.s.shorts.length} shorts`, "info", "autoeditor");
  c.end("autoeditor", { note: `−${total.toFixed(1)} s dead air` });
}

async function autoEditorSilences(c: Ctx, wav: string, span: number, id: string): Promise<[number, number][]> {
  const out = c.path("shorts", id, "auto-editor.json");
  const cmd = c.m.autoEditor!;
  await run(cmd[0], [...cmd.slice(1), wav, "--edit", "audio:threshold=0.04", "-m", "0.2s", "-tb", "100", "--export", "v1", "-o", out, "--no-open", "-q"], { signal: c.signal, cwd: path.dirname(out) });
  const data = JSON.parse(fs.readFileSync(out, "utf8")) as { chunks: [number, number, number][] };
  return data.chunks.filter(([, , speed]) => speed >= 99999 || speed <= 0).map(([a, b]) => [a / 100, Math.min(span, b / 100)] as [number, number]);
}

async function silenceDetect(c: Ctx, wav: string, span: number): Promise<[number, number][]> {
  const silent: [number, number][] = [];
  let open: number | null = null;
  await ffmpeg(["-i", wav, "-af", "silencedetect=noise=-34dB:d=0.5", "-f", "null", "-"], {
    signal: c.signal,
    onLine: (line) => {
      const s = /silence_start: (-?[\d.]+)/.exec(line);
      const e = /silence_end: (-?[\d.]+)/.exec(line);
      if (s) open = Math.max(0, Number(s[1]));
      if (e && open !== null) {
        silent.push([open, Number(e[1])]);
        open = null;
      }
    },
  });
  if (open !== null) silent.push([open, span]);
  // silencedetect reports the whole quiet stretch; leave 0.15 s of air on each side, like auto-editor's margin.
  return silent.map(([a, b]) => [a + 0.15, b - 0.15] as [number, number]).filter(([a, b]) => b - a > 0.2);
}

/**
 * Turn silent stretches into kept ranges (relative to the window). Only
 * pauses ≥ 0.45 s are cut; if that would leave the short under minSec, the
 * shortest cuts are put back.
 */
export function keepRanges(silent: [number, number][], span: number, minSec: number): [number, number][] {
  let cuts = silent
    .map(([a, b]) => [Math.max(0, a), Math.min(span, b)] as [number, number])
    .filter(([a, b]) => b - a >= 0.45)
    .sort((x, y) => x[0] - y[0]);
  const lengthWith = (cs: [number, number][]) => span - cs.reduce((n, [a, b]) => n + (b - a), 0);
  while (cuts.length && lengthWith(cuts) < Math.min(minSec, span)) {
    const shortest = cuts.reduce((m, x) => (x[1] - x[0] < m[1] - m[0] ? x : m));
    cuts = cuts.filter((x) => x !== shortest);
  }
  const keep: [number, number][] = [];
  let at = 0;
  for (const [a, b] of cuts) {
    if (a - at > 0.05) keep.push([at, a]);
    at = Math.max(at, b);
  }
  if (span - at > 0.05) keep.push([at, span]);
  // Drop crumbs shorter than 0.3 s; they look like glitches.
  const tidy = keep.filter(([a, b]) => b - a >= 0.3);
  return tidy.length ? tidy.map(([a, b]) => [round(a), round(b)] as [number, number]) : [[0, round(span)]];
}

function gaps(keep: [number, number][], span: number): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const [a, b] of keep) {
    if (a > at) out.push([round(at), round(a)]);
    at = b;
  }
  if (span > at + 0.05) out.push([round(at), round(span)]);
  return out;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Words inside a short, on its output timeline. */
export function shortWords(words: Word[], keep: [number, number][]): Word[] {
  const lo = keep[0]?.[0] ?? 0;
  const hi = keep[keep.length - 1]?.[1] ?? 0;
  return words.filter((w) => w.e > lo && w.s < hi);
}
