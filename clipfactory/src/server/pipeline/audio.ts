import fs from "node:fs";
import path from "node:path";
import type { Short, Transcript } from "../../lib/types.ts";
import { pythonExe } from "../paths.ts";
import { ffmpeg, py, run } from "../proc.ts";
import { claudeEnabled, describeError, translateLines } from "./claude.ts";
import type { Ctx } from "./ctx.ts";
import { atempoChain } from "./layout.ts";
import { audioLevels, envelope } from "./media.ts";
import { readTranscript } from "./moment.ts";
import { sourcePath } from "./reframe.ts";

// Stage 04 · AUDIO — stems, clean voice, dub.

const STEMS = ["vocals", "drums", "bass", "other"] as const;

export async function audioStage(c: Ctx, shorts: Short[] = c.s.shorts) {
  c.stage("audio");
  if (!c.s.source?.hasAudio) {
    for (const t of ["demucs", "deepfilter", "f5tts"] as const) c.skip(t, "off", "Off", "The VOD has no audio");
    c.endStage("audio");
    return;
  }
  for (const short of shorts) {
    c.check();
    // 48 kHz stereo of the whole moment, the base for everything below.
    await ffmpeg(["-ss", short.start.toFixed(3), "-t", (short.end - short.start).toFixed(3), "-i", sourcePath(c), "-map", "0:a:0", "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", sdir(c, short, "window.wav")], { signal: c.signal });
  }
  const split = await stems(c, shorts);
  await denoise(c, shorts, split);
  await mixdown(c, shorts, split);
  await dubs(c, shorts, split);
  c.endStage("audio");
}

const sdir = (c: Ctx, s: Short, ...f: string[]) => c.path("shorts", s.id, ...f);

// ── 09 Stems: Demucs ────────────────────────────────────────────────────

async function stems(c: Ctx, shorts: Short[]): Promise<boolean> {
  if (!c.s.options.stems) {
    c.skip("demucs", "off", "Original mix", "Stem splitting is off");
    return false;
  }
  if (!c.m.py.modules?.demucs) {
    c.skip("demucs", "missing", "Original mix", "Install Demucs (npm run setup -- --full) to duck the game under the voice");
    return false;
  }
  c.begin("demucs", "native", c.m.report.items.demucs.engine, "htdemucs, 4 stems");
  for (const short of shorts) {
    c.check();
    const out = sdir(c, short, "stems");
    const args = ["-m", "demucs", "-n", "htdemucs", "-o", out];
    if (!c.m.cuda) args.push("-d", "cpu", "-j", "2");
    args.push(sdir(c, short, "window.wav"));
    try {
      await run(pythonExe(), args, {
        signal: c.signal,
        onLine: (line) => {
          const m = /(\d+)%\|/.exec(line);
          if (m) c.live({ t: short.start, shortId: short.id, tag: `demucs · ${m[1]}%` });
        },
      });
    } catch (err) {
      if (c.signal.aborted) throw err;
      c.log(`Demucs failed on ${short.id}: ${(err as Error).message}`, "warn", "demucs");
      c.end("demucs", { state: "error", note: "Failed; using the original mix" });
      return false;
    }
    const dir = path.join(out, "htdemucs", "window");
    // Game bed = everything that isn't the voice.
    await ffmpeg(["-i", path.join(dir, "drums.wav"), "-i", path.join(dir, "bass.wav"), "-i", path.join(dir, "other.wav"), "-filter_complex", "amix=inputs=3:normalize=0", sdir(c, short, "game.wav")], { signal: c.signal });
    fs.copyFileSync(path.join(dir, "vocals.wav"), sdir(c, short, "voice.wav"));
    const live: { name: string; peaks: number[] }[] = [];
    for (const name of STEMS) {
      const lv = await audioLevels(path.join(dir, `${name}.wav`), { signal: c.signal });
      live.push({ name: name.toUpperCase(), peaks: envelope(lv.tenths, 140) });
    }
    c.live({ t: short.start, shortId: short.id, stems: live, tag: undefined });
    await paintTimeline(c, short, sdir(c, short, "voice.wav"), sdir(c, short, "game.wav"));
  }
  c.end("demucs", { note: `${shorts.length} × 4 stems` });
  return true;
}

/** Put the real voice/game envelopes into the timeline where this short sits. */
async function paintTimeline(c: Ctx, short: Short, voiceWav: string, gameWav: string) {
  const dur = c.s.source!.duration;
  const n = c.s.analysis.peaks.length || 1200;
  const a = Math.floor((short.start / dur) * n);
  const b = Math.max(a + 1, Math.ceil((short.end / dur) * n));
  const [v, g] = await Promise.all([audioLevels(voiceWav, { signal: c.signal }), audioLevels(gameWav, { signal: c.signal })]);
  const ve = envelope(v.tenths, b - a);
  const ge = envelope(g.tenths, b - a);
  c.update((s) => {
    if (s.analysis.voice.length !== n) s.analysis.voice = [...s.analysis.peaks];
    if (s.analysis.game.length !== n) s.analysis.game = [...s.analysis.peaks];
    for (let i = a; i < b && i < n; i++) {
      s.analysis.voice[i] = ve[i - a] ?? 0;
      s.analysis.game[i] = ge[i - a] ?? 0;
    }
  });
}

// ── 10 Denoise: DeepFilterNet ───────────────────────────────────────────

async function denoise(c: Ctx, shorts: Short[], split: boolean) {
  if (!c.s.options.denoise) {
    c.skip("deepfilter", "off", "Off", "Denoising is off");
    return;
  }
  // DeepFilterNet keeps speech and removes everything else, so it only runs on the voice stem.
  const native = Boolean(c.m.deepFilter) && split;
  c.begin("deepfilter", native ? "native" : "builtin", native ? c.m.report.items.deepfilter.engine : "FFmpeg afftdn", native ? undefined : split ? "DeepFilterNet isn't installed" : "Without Demucs stems, a light FFT denoise keeps the game audio");
  for (const short of shorts) {
    c.check();
    const input = split ? sdir(c, short, "voice.wav") : sdir(c, short, "window.wav");
    const out = sdir(c, short, split ? "voice_clean.wav" : "window_clean.wav");
    if (native) {
      const dir = sdir(c, short, "df");
      fs.mkdirSync(dir, { recursive: true });
      try {
        await run(c.m.deepFilter![0], [...c.m.deepFilter!.slice(1), "-o", dir, input], { signal: c.signal });
        const made = fs.readdirSync(dir).find((f) => f.endsWith(".wav"));
        if (!made) throw new Error("no output");
        fs.renameSync(path.join(dir, made), out);
      } catch (err) {
        if (c.signal.aborted) throw err;
        c.log(`DeepFilterNet failed on ${short.id} (${(err as Error).message}); using afftdn`, "warn", "deepfilter");
        await ffmpeg(["-i", input, "-af", "highpass=f=80,afftdn=nr=14:nf=-40:tn=1", out], { signal: c.signal });
      }
    } else {
      await ffmpeg(["-i", input, "-af", split ? "highpass=f=80,afftdn=nr=14:nf=-40:tn=1" : "afftdn=nr=6:nf=-45", out], { signal: c.signal });
    }
    const [before, after] = await Promise.all([audioLevels(input, { signal: c.signal }), audioLevels(out, { signal: c.signal })]);
    const floor = (l: number[]) => {
      const s = [...l].sort((x, y) => x - y);
      return s[Math.floor(s.length * 0.1)] ?? -90;
    };
    c.live({ t: short.start, shortId: short.id, noise: { before: Math.round(floor(before.tenths)), after: Math.round(floor(after.tenths)) }, wave: envelope(after.tenths, 160) });
  }
  c.end("deepfilter", { note: native ? "voice stem cleaned" : "light FFT denoise" });
}

// ── Mixdown: voice over a ducked game bed ──────────────────────────────

async function mixdown(c: Ctx, shorts: Short[], split: boolean) {
  for (const short of shorts) {
    c.check();
    const out = sdir(c, short, "mix.wav");
    if (split) {
      const voice = fs.existsSync(sdir(c, short, "voice_clean.wav")) ? sdir(c, short, "voice_clean.wav") : sdir(c, short, "voice.wav");
      await ffmpeg(
        [
          "-i", sdir(c, short, "game.wav"),
          "-i", voice,
          "-filter_complex",
          "[1:a]asplit=2[vsc][vmix];[0:a][vsc]sidechaincompress=threshold=0.04:ratio=6:attack=15:release=350[gd];[gd]volume=0.85[g];[vmix]volume=1.2[v];[g][v]amix=inputs=2:normalize=0,alimiter=limit=0.95[out]",
          "-map", "[out]", "-ar", "48000", out,
        ],
        { signal: c.signal },
      );
    } else {
      const src = fs.existsSync(sdir(c, short, "window_clean.wav")) ? sdir(c, short, "window_clean.wav") : sdir(c, short, "window.wav");
      fs.copyFileSync(src, out);
    }
  }
}

// ── 11 Dub: F5-TTS in the streamer's own voice ───────────────────────────

interface Line {
  i: number;
  s: number;
  e: number;
  text: string;
}

/** Transcript lines inside a short, on its output timeline. */
export function shortLines(t: Transcript, keep: [number, number][]): Line[] {
  const lines: Line[] = [];
  const outTime = (src: number): number | null => {
    let acc = 0;
    for (const [a, b] of keep) {
      if (src >= a && src <= b) return acc + (src - a);
      acc += b - a;
    }
    return null;
  };
  for (const seg of t.segments) {
    const words = t.words.filter((w) => w.s >= seg.s - 0.05 && w.e <= seg.e + 0.05 && outTime(w.s) !== null);
    if (!words.length) continue;
    const s = outTime(words[0].s)!;
    const e = outTime(words[words.length - 1].e) ?? s + (words[words.length - 1].e - words[0].s);
    lines.push({ i: lines.length, s, e: Math.max(e, s + 0.3), text: words.map((w) => w.w).join(" ") });
  }
  return lines;
}

async function dubs(c: Ctx, shorts: Short[], split: boolean) {
  const langs = c.s.options.dub;
  if (!langs.length) {
    c.skip("f5tts", "off", c.m.report.items.f5tts.engine, "No dub languages picked");
    return;
  }
  const why = !c.m.py.modules?.f5_tts ? "Install F5-TTS (npm run setup -- --dub)" : !claudeEnabled() ? "Dubbing needs Claude (ANTHROPIC_API_KEY) to translate" : !split ? "Dubbing needs Demucs to take the original voice out" : null;
  if (why) {
    c.skip("f5tts", "missing", c.m.report.items.f5tts.engine, why);
    c.log(`Dubbing skipped: ${why}`, "warn", "f5tts");
    return;
  }
  c.begin("f5tts", "native", c.m.report.items.f5tts.engine);
  const transcript = readTranscript(c);
  const lang0 = transcript.language || "en";
  for (const short of shorts) {
    const lines = shortLines(transcript, c.s.shorts.find((x) => x.id === short.id)!.keep);
    if (!lines.length) continue;
    const done: string[] = [];
    // Voice reference: the first ~8 s of clean speech in this moment.
    const ref = sdir(c, short, "dub_ref.wav");
    const refEnd = Math.min(lines[0].s + 8, lines[lines.length - 1].e);
    const refText = lines.filter((l) => l.e <= refEnd + 0.5).map((l) => l.text).join(" ");
    await ffmpeg(["-i", sdir(c, short, "voice_clean.wav"), "-ss", lines[0].s.toFixed(2), "-to", refEnd.toFixed(2), "-ac", "1", "-ar", "24000", ref], { signal: c.signal });
    // The game bed on the output timeline (dead air cut the same way).
    const keep = c.s.shorts.find((x) => x.id === short.id)!.keep;
    const bed = sdir(c, short, "game_out.wav");
    await cutAudio(c, sdir(c, short, "game.wav"), keep.map(([a, b]) => [a - short.start, b - short.start]), bed);
    for (const lang of langs) {
      c.check();
      c.live({ t: short.start, shortId: short.id, dub: { from: lang0.toUpperCase(), to: langs.map((l) => l.toUpperCase()), done: [...done] } });
      try {
        const tr = await translateLines(lines.map((l) => ({ i: l.i, text: l.text, seconds: l.e - l.s })), lang, c.signal);
        c.update((s) => (s.orchestrator.usd = (s.orchestrator.usd ?? 0) + tr.usd));
        const dir = sdir(c, short, `dub_${lang}`);
        fs.writeFileSync(`${dir}.json`, JSON.stringify(tr.lines));
        const args = ["--ref-audio", ref, "--ref-text", refText, "--lines", dir + ".json", "--out-dir", dir];
        const ck = process.env[`CF_F5_CKPT_${lang.toUpperCase()}`];
        const vocab = process.env[`CF_F5_VOCAB_${lang.toUpperCase()}`];
        if (ck) args.push("--ckpt", ck);
        if (vocab) args.push("--vocab", vocab);
        await py("cf_dub", args, { signal: c.signal, onLog: (l) => c.log(l, "info", "f5tts") });
        await placeLines(c, lines, dir, bed, sdir(c, short, `dub_${lang}.wav`));
        done.push(lang.toUpperCase());
        c.update((s) => {
          const sh = s.shorts.find((x) => x.id === short.id)!;
          sh.dubs = [...sh.dubs.filter((d) => d.lang !== lang), { lang }];
        });
      } catch (err) {
        if (c.signal.aborted) throw err;
        c.log(`Dub ${lang} for ${short.id} failed: ${describeError(err)}`, "warn", "f5tts");
        c.update((s) => {
          const sh = s.shorts.find((x) => x.id === short.id)!;
          sh.dubs = [...sh.dubs.filter((d) => d.lang !== lang), { lang, error: describeError(err) }];
        });
      }
    }
    c.live({ dub: { from: lang0.toUpperCase(), to: langs.map((l) => l.toUpperCase()), done } });
  }
  c.end("f5tts", { note: langs.join(", ").toUpperCase() });
}

/** Cut an audio file to kept ranges (relative seconds) and join them. */
export async function cutAudio(c: Ctx, input: string, ranges: [number, number][], out: string) {
  const parts = ranges.map(([a, b], i) => `[0:a]atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS[p${i}]`);
  const graph = `${parts.join(";")};${ranges.map((_, i) => `[p${i}]`).join("")}concat=n=${ranges.length}:v=0:a=1[out]`;
  await ffmpeg(["-i", input, "-filter_complex", graph, "-map", "[out]", "-ar", "48000", out], { signal: c.signal });
}

/** Lay each spoken line at its original time, squeezing lines that run long, over the game bed. */
async function placeLines(c: Ctx, lines: Line[], dir: string, bed: string, out: string) {
  const inputs: string[] = ["-i", bed];
  const filters: string[] = [];
  const labels: string[] = ["[0:a]"];
  let k = 1;
  for (let i = 0; i < lines.length; i++) {
    const f = path.join(dir, `line_${String(lines[i].i).padStart(3, "0")}.wav`);
    if (!fs.existsSync(f)) continue;
    const slot = (lines[i + 1]?.s ?? lines[i].e + 1.5) - lines[i].s;
    const probe = await audioLevels(f, { signal: c.signal });
    const len = probe.tenths.length / 10;
    const speed = Math.min(1.35, Math.max(1, len / Math.max(0.3, slot)));
    inputs.push("-i", f);
    filters.push(`[${k}:a]aresample=48000,${speed > 1.01 ? `${atempoChain(speed)},` : ""}adelay=${Math.round(lines[i].s * 1000)}:all=1[l${k}]`);
    labels.push(`[l${k}]`);
    k++;
  }
  filters.push(`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=first,alimiter=limit=0.95[out]`);
  await ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", "[out]", out], { signal: c.signal });
}
