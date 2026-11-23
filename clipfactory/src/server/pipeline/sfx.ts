import fs from "node:fs";

// Sound design for the edit, synthesised here so there are no sample packs to
// license or ship: a whoosh into the cut after the cold open (and into the
// replay), a low impact under the payoff zoom, and the censor bleep.

export const RATE = 48000;

/** Deterministic noise, so a re-render sounds the same. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 0xffffffff) * 2 - 1;
  };
}

/** Stereo buffer: [left, right]. */
export type Stereo = [Float32Array, Float32Array];

function stereo(seconds: number): Stereo {
  const n = Math.max(1, Math.round(seconds * RATE));
  return [new Float32Array(n), new Float32Array(n)];
}

function normalize(buf: Stereo, peakDb: number): Stereo {
  let peak = 0;
  for (const ch of buf) for (const v of ch) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0 ? 10 ** (peakDb / 20) / peak : 0;
  for (const ch of buf) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return buf;
}

/**
 * Air rushing past: noise through a band-pass that sweeps up and back down,
 * swelling to its loudest at `peak` (0..1 of the length), panned across.
 */
export function whoosh(seconds = 0.6, peak = 0.62, seed = 7): Stereo {
  const out = stereo(seconds);
  const n = out[0].length;
  const noise = rng(seed);
  let low = 0;
  let band = 0;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    // Rise to the peak, then fall faster.
    const env = x < peak ? Math.sin((Math.PI / 2) * (x / peak)) ** 2 : Math.cos((Math.PI / 2) * ((x - peak) / (1 - peak))) ** 3;
    const sweep = x < peak ? x / peak : 1 - 0.6 * ((x - peak) / (1 - peak));
    const freq = 220 * 18 ** sweep;
    // Chamberlin state-variable filter.
    const f = 2 * Math.sin((Math.PI * Math.min(freq, RATE / 6)) / RATE);
    const q = 0.9;
    const high = noise() - low - q * band;
    band += f * high;
    low += f * band;
    const v = band * env;
    const pan = 0.25 + 0.5 * x;
    out[0][i] = v * Math.cos((pan * Math.PI) / 2);
    out[1][i] = v * Math.sin((pan * Math.PI) / 2);
  }
  return normalize(out, -6);
}

/** A cinematic hit: a sub drop with a click on top and a short body of low noise. */
export function impact(seconds = 1.1, seed = 11): Stereo {
  const out = stereo(seconds);
  const n = out[0].length;
  const noise = rng(seed);
  let phase = 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const freq = 38 + 72 * Math.exp(-t / 0.09);
    phase += (2 * Math.PI * freq) / RATE;
    const sub = Math.sin(phase) * Math.exp(-t / 0.32);
    const click = noise() * Math.exp(-t / 0.004) * 0.6;
    lp += 0.06 * (noise() - lp);
    const body = lp * Math.exp(-t / 0.12) * 2.2;
    const v = Math.tanh(1.6 * (sub + click + body));
    out[0][i] = v;
    out[1][i] = v;
  }
  return normalize(out, -4);
}

/** The classic 1 kHz censor tone, with 5 ms edges so it doesn't click. */
export function bleep(seconds: number): Stereo {
  const out = stereo(seconds);
  const n = out[0].length;
  const edge = Math.round(0.005 * RATE);
  for (let i = 0; i < n; i++) {
    const g = Math.min(1, i / edge, (n - 1 - i) / edge);
    const v = Math.sin((2 * Math.PI * 1000 * i) / RATE) * 0.5 * g;
    out[0][i] = v;
    out[1][i] = v;
  }
  return out;
}

export interface Cue {
  /** Output second where the sound's hit lands (whoosh peak, impact onset). */
  at: number;
  kind: "whoosh" | "impact" | "bleep";
  /** Bleep length. */
  length?: number;
  gain?: number;
}

/** Every cue laid onto one track of the given length. */
export function renderCues(cues: Cue[], seconds: number): Stereo {
  const out = stereo(seconds);
  const n = out[0].length;
  const w = whoosh();
  const wPeak = Math.round(0.62 * w[0].length);
  const hit = impact();
  for (const cue of cues) {
    const src = cue.kind === "whoosh" ? w : cue.kind === "impact" ? hit : bleep(cue.length ?? 0.3);
    const offset = Math.round(cue.at * RATE) - (cue.kind === "whoosh" ? wPeak : 0);
    const gain = cue.gain ?? (cue.kind === "whoosh" ? 0.45 : cue.kind === "impact" ? 0.5 : 0.35);
    for (let i = 0; i < src[0].length; i++) {
      const k = offset + i;
      if (k < 0 || k >= n) continue;
      out[0][k] += src[0][i] * gain;
      out[1][k] += src[1][i] * gain;
    }
  }
  return out;
}

/** 16-bit PCM WAV. */
export function writeWav(file: string, buf: Stereo) {
  const n = buf[0].length;
  const data = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[0][i])) * 32767), i * 4);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[1][i])) * 32767), i * 4 + 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVE", 8);
  head.write("fmt ", 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(2, 22);
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 4, 28);
  head.writeUInt16LE(4, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([head, data]));
}
