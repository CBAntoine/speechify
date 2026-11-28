// Sound design for motion ads, made in code with the Web Audio API: soft
// hits, whooshes, pullbacks, a riser and a ding placed on the storyboard's
// cues; music made in code (a pad, or a pad with a pulse) or their own
// track; and the narration, with the music ducked under it. The same
// schedule plays live in the preview and renders offline for the export.

import type { MotionAd, MotionShot } from "@/lib/types";
import { sfxCues, VOICE_IN, type Cue } from "@/lib/motion/story";

export interface SoundPlan {
  shots: MotionShot[];
  starts: number[];
  total: number;
  sound: MotionAd["sound"];
  music?: AudioBuffer;
  voice?: AudioBuffer;
  segments: { shot: number; from: number; to: number }[];
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
    noiseCache.set(ctx, b);
  }
  return b;
}

/** Everything is scheduled against the plan's clock: `at(t)` is when plan time t plays. */
interface Clock {
  ctx: BaseAudioContext;
  at: (t: number) => number;
  /** Plan time we start from (when seeking in the preview). */
  from: number;
  /** Every source started, so stopping the preview stops them all. */
  nodes: AudioScheduledSourceNode[];
}

function osc(c: Clock, type: OscillatorType): OscillatorNode {
  const o = c.ctx.createOscillator();
  o.type = type;
  c.nodes.push(o);
  return o;
}

function env(g: GainNode, start: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
}

let noiseOffset = 0;
function noiseSource(c: Clock, start: number, dur: number) {
  const src = c.ctx.createBufferSource();
  src.buffer = noise(c.ctx);
  src.loop = true;
  // Different stretches of the noise for each sound, the same every render.
  noiseOffset = (noiseOffset + 0.377) % 1.5;
  src.start(start, noiseOffset);
  src.stop(start + dur + 0.05);
  c.nodes.push(src);
  return src;
}

function whoosh(c: Clock, out: AudioNode, t: number, level: number) {
  const { ctx } = c;
  const s = c.at(t);
  const src = noiseSource(c, s, 0.7);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(320, s);
  bp.frequency.exponentialRampToValueAtTime(2800, s + 0.3);
  bp.frequency.exponentialRampToValueAtTime(700, s + 0.62);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, s);
  g.gain.exponentialRampToValueAtTime(0.5 * level, s + 0.24);
  g.gain.exponentialRampToValueAtTime(0.0001, s + 0.66);
  const pan = ctx.createStereoPanner();
  pan.pan.setValueAtTime(-0.5, s);
  pan.pan.linearRampToValueAtTime(0.5, s + 0.6);
  src.connect(bp).connect(g).connect(pan).connect(out);
}

function hit(c: Clock, out: AudioNode, t: number, level: number) {
  const { ctx } = c;
  const s = c.at(t);
  const o = osc(c, "sine");
  o.frequency.setValueAtTime(115, s);
  o.frequency.exponentialRampToValueAtTime(44, s + 0.2);
  const g = ctx.createGain();
  env(g, s, 0.85 * level, 0.006, 0.42);
  o.connect(g).connect(out);
  o.start(s);
  o.stop(s + 0.5);
  // A soft knock on top, low-passed so it never clicks.
  const n = noiseSource(c, s, 0.08);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  const ng = ctx.createGain();
  env(ng, s, 0.22 * level, 0.003, 0.06);
  n.connect(lp).connect(ng).connect(out);
}

function pullback(c: Clock, out: AudioNode, t: number, level: number) {
  const { ctx } = c;
  const s = c.at(t);
  const src = noiseSource(c, s, 1);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.Q.value = 2;
  lp.frequency.setValueAtTime(4200, s);
  lp.frequency.exponentialRampToValueAtTime(260, s + 0.85);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, s);
  g.gain.exponentialRampToValueAtTime(0.32 * level, s + 0.18);
  g.gain.exponentialRampToValueAtTime(0.0001, s + 0.95);
  src.connect(lp).connect(g).connect(out);
  const o = osc(c, "sine");
  o.frequency.setValueAtTime(240, s);
  o.frequency.exponentialRampToValueAtTime(62, s + 0.85);
  const og = ctx.createGain();
  env(og, s, 0.28 * level, 0.08, 0.8);
  o.connect(og).connect(out);
  o.start(s);
  o.stop(s + 1);
}

function riser(c: Clock, out: AudioNode, t: number, dur: number, level: number) {
  const { ctx } = c;
  const s = c.at(t);
  const src = noiseSource(c, s, dur);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(400, s);
  bp.frequency.exponentialRampToValueAtTime(6500, s + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, s);
  g.gain.exponentialRampToValueAtTime(0.26 * level, s + dur * 0.96);
  g.gain.exponentialRampToValueAtTime(0.0001, s + dur + 0.05);
  src.connect(bp).connect(g).connect(out);
  const o = osc(c, "sawtooth");
  o.frequency.setValueAtTime(110, s);
  o.frequency.exponentialRampToValueAtTime(440, s + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(300, s);
  lp.frequency.exponentialRampToValueAtTime(3200, s + dur);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, s);
  og.gain.exponentialRampToValueAtTime(0.07 * level, s + dur * 0.96);
  og.gain.exponentialRampToValueAtTime(0.0001, s + dur + 0.05);
  o.connect(lp).connect(og).connect(out);
  o.start(s);
  o.stop(s + dur + 0.1);
}

function ding(c: Clock, out: AudioNode, t: number, level: number) {
  const { ctx } = c;
  const s = c.at(t);
  // A bell: a fundamental and two inharmonic partials, each fading at its own rate.
  for (const [ratio, peak, decay] of [
    [1, 0.24, 1.6],
    [2.76, 0.09, 0.7],
    [5.4, 0.04, 0.35],
  ] as const) {
    const o = osc(c, "sine");
    o.frequency.value = 1046.5 * ratio;
    const g = ctx.createGain();
    env(g, s, peak * level, 0.004, decay);
    o.connect(g).connect(out);
    o.start(s);
    o.stop(s + decay + 0.1);
  }
}

// ── Music made in code ───────────────────────────────────────

const BPM = 96;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
// IV – I – V – vi in C: warm and upbeat.
const CHORDS = [
  [53, 57, 60, 65],
  [48, 55, 60, 64],
  [50, 55, 59, 62],
  [45, 52, 57, 60],
];
const BASS = [41, 36, 43, 45];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

function pad(c: Clock, out: AudioNode, total: number) {
  const { ctx } = c;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1100;
  lp.Q.value = 0.6;
  lp.connect(out);
  for (let bar = 0; bar * BAR < total; bar++) {
    const t0 = bar * BAR;
    const t1 = Math.min(total, t0 + BAR);
    if (t1 + 0.6 < c.from) continue;
    const s = c.at(Math.max(t0, c.from));
    const e = c.at(t1);
    for (const note of CHORDS[bar % 4]) {
      for (const detune of [-7, 7]) {
        const o = osc(c, "sawtooth");
        o.frequency.value = hz(note);
        o.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, s);
        g.gain.linearRampToValueAtTime(0.016, s + 0.35);
        g.gain.setValueAtTime(0.016, Math.max(s + 0.35, e - 0.05));
        g.gain.linearRampToValueAtTime(0.0001, e + 0.55);
        o.connect(g).connect(lp);
        o.start(s);
        o.stop(e + 0.6);
      }
    }
  }
}

function pulse(c: Clock, out: AudioNode, total: number) {
  const { ctx } = c;
  for (let beat = 0; beat * BEAT < total - 0.2; beat++) {
    const t = beat * BEAT;
    if (t < c.from) continue;
    const s = c.at(t);
    // Kick on every beat.
    const k = osc(c, "sine");
    k.frequency.setValueAtTime(130, s);
    k.frequency.exponentialRampToValueAtTime(46, s + 0.12);
    const kg = ctx.createGain();
    env(kg, s, 0.5, 0.004, 0.28);
    k.connect(kg).connect(out);
    k.start(s);
    k.stop(s + 0.35);
    // Hat on the off-beat.
    const hs = c.at(t + BEAT / 2);
    const n = noiseSource(c, hs, 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const hg = ctx.createGain();
    env(hg, hs, 0.07, 0.002, 0.04);
    n.connect(hp).connect(hg).connect(out);
    // Bass on the root in eighths.
    const root = BASS[Math.floor(t / BAR) % 4];
    for (const off of [0, BEAT / 2]) {
      const bs = c.at(t + off);
      const b = osc(c, "triangle");
      b.frequency.value = hz(root + 12);
      const bg = ctx.createGain();
      env(bg, bs, 0.16, 0.01, BEAT / 2 - 0.04);
      b.connect(bg).connect(out);
      b.start(bs);
      b.stop(bs + BEAT / 2);
    }
  }
}

/** A bus's level over time: faded in and out, and ducked under each narration line. */
function busLevel(t: number, total: number, ducks: [number, number][]): number {
  const fade = Math.min(1, t / 0.6, Math.max(0, (total - t) / 1.4));
  let duck = 1;
  for (const [a, b] of ducks) {
    const d = t <= a - 0.12 || t >= b + 0.35 ? 1 : t < a ? 1 - (0.68 * (t - (a - 0.12))) / 0.12 : t <= b ? 0.32 : 0.32 + (0.68 * (t - b)) / 0.35;
    duck = Math.min(duck, d);
  }
  return fade * duck;
}

function shapeBus(c: Clock, g: GainNode, level: number, total: number, ducks: [number, number][]) {
  const marks = new Set([0, 0.6, Math.max(0.6, total - 1.4), total]);
  for (const [a, b] of ducks) [a - 0.12, a, b, b + 0.35].forEach((t) => marks.add(t));
  const times = [...marks].filter((t) => t >= 0 && t <= total).sort((x, y) => x - y);
  const v = (t: number) => Math.max(0.0001, level * busLevel(t, total, ducks));
  g.gain.setValueAtTime(v(c.from), c.at(c.from));
  for (const t of times) if (t > c.from) g.gain.linearRampToValueAtTime(v(t), c.at(t));
}

/** Schedule the whole mix on a context, from plan time `from`, starting at context time `when`. Returns a stop function. */
export function scheduleSound(ctx: BaseAudioContext, dest: AudioNode, plan: SoundPlan, from: number, when: number): () => void {
  const clock: Clock = { ctx, from, at: (t) => when + Math.max(0, t - from), nodes: [] };
  // Glue the mix, bring it up to social-video loudness, and catch the peaks.
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.004;
  comp.release.value = 0.25;
  const makeup = ctx.createGain();
  makeup.gain.value = 1.35;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -3.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;
  master.connect(comp).connect(makeup).connect(limiter).connect(dest);

  const { shots, starts, total, sound } = plan;
  const voiceOn = Boolean(sound.voice && plan.voice && plan.segments.length);
  const ducks: [number, number][] = voiceOn
    ? plan.segments.map((g) => {
        const a = (starts[g.shot] ?? 0) + VOICE_IN;
        return [a, a + (g.to - g.from)];
      })
    : [];

  if (sound.sfx) {
    const sfx = ctx.createGain();
    sfx.gain.value = voiceOn ? 0.8 : 1;
    sfx.connect(master);
    const cues: Cue[] = sfxCues(shots, starts);
    for (const cue of cues) {
      const end = cue.t + (cue.dur ?? 1);
      if (end < from) continue;
      if (cue.t < from && cue.kind !== "riser") continue;
      if (cue.kind === "whoosh") whoosh(clock, sfx, cue.t, 1);
      else if (cue.kind === "hit") hit(clock, sfx, cue.t, 1);
      else if (cue.kind === "pullback") pullback(clock, sfx, cue.t, 1);
      else if (cue.kind === "riser") riser(clock, sfx, Math.max(cue.t, from), Math.max(0.2, end - Math.max(cue.t, from)), 1);
      else if (cue.kind === "ding") ding(clock, sfx, cue.t, 1);
    }
  }

  if (sound.bed === "pad" || sound.bed === "pulse") {
    const bed = ctx.createGain();
    bed.connect(master);
    shapeBus(clock, bed, 1.3 * sound.music, total, ducks);
    pad(clock, bed, total);
    if (sound.bed === "pulse") pulse(clock, bed, total);
  } else if (sound.bed === "track" && plan.music) {
    const bus = ctx.createGain();
    bus.connect(master);
    shapeBus(clock, bus, 1.0 * sound.music, total, ducks);
    const src = ctx.createBufferSource();
    clock.nodes.push(src);
    src.buffer = plan.music;
    src.loop = plan.music.duration < total;
    src.start(clock.at(from), from % plan.music.duration);
    src.stop(clock.at(total) + 0.05);
  }

  if (voiceOn && plan.voice) {
    const vb = ctx.createGain();
    vb.gain.value = 1;
    vb.connect(master);
    for (const g of plan.segments) {
      const a = (starts[g.shot] ?? 0) + VOICE_IN;
      const len = g.to - g.from;
      if (a + len <= from) continue;
      const skip = Math.max(0, from - a);
      const src = ctx.createBufferSource();
      clock.nodes.push(src);
      src.buffer = plan.voice;
      src.connect(vb);
      src.start(clock.at(a + skip), g.from + skip, Math.max(0.01, len - skip));
    }
  }

  return () => {
    for (const n of clock.nodes) {
      try {
        n.stop();
      } catch {
        // not started yet, or already stopped
      }
    }
    try {
      master.disconnect();
    } catch {
      // already disconnected
    }
  };
}

/** The finished mix as one buffer, for the video file. */
export async function renderSound(plan: SoundPlan, sampleRate = 48000): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.max(1, Math.ceil(plan.total * sampleRate)), sampleRate });
  scheduleSound(ctx, ctx.destination, plan, 0, 0);
  return ctx.startRendering();
}

/** Decode a stored audio file (their track or the narration). */
export async function loadAudio(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | undefined> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return undefined;
    return await ctx.decodeAudioData(await res.arrayBuffer());
  } catch {
    return undefined;
  }
}
