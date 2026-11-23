import type { LayoutKind, Punch, Short, TrackKey, Word } from "../../lib/types.ts";

// The edit of one short, before anything is rendered: which source ranges
// play in which order (a cold open on the payoff, then the story), where the
// punch-in zooms land, which words the captions stress, and which get bleeped.
// Pure functions, so the captions, the picture and the sound always agree.

export const TEASER_MIN = 0.6;
export const TEASER_MAX = 3.5;

export interface Seg {
  /** Source seconds. */
  a: number;
  b: number;
  /** Where it starts in the output. */
  at: number;
  teaser?: boolean;
}

export interface EditPlan {
  segs: Seg[];
  /** Length of the cold open (0 = none). */
  teaser: number;
  /** Length of the story itself (the kept ranges). */
  main: number;
  /** teaser + main: the plate, before any slow-motion replay. */
  body: number;
}

export function editPlan(short: Pick<Short, "keep" | "teaser" | "start" | "end">): EditPlan {
  const segs: Seg[] = [];
  let at = 0;
  const t = short.teaser;
  if (t) {
    const a = Math.max(short.start, t[0]);
    const b = Math.min(short.end, t[1], a + TEASER_MAX);
    if (b - a >= TEASER_MIN) {
      segs.push({ a, b, at: 0, teaser: true });
      at = b - a;
    }
  }
  const teaser = at;
  for (const [a, b] of short.keep) {
    segs.push({ a, b, at });
    at += b - a;
  }
  return { segs, teaser, main: at - teaser, body: at };
}

/** Source second → seconds into the story (the kept ranges), or null if it was cut. */
export function storyTime(keep: [number, number][], src: number): number | null {
  let acc = 0;
  for (const [a, b] of keep) {
    if (src >= a && src <= b) return acc + (src - a);
    acc += b - a;
  }
  return null;
}

/** Like storyTime, but a cut second snaps to the nearest kept one. */
function nearestStoryTime(keep: [number, number][], src: number): number {
  const exact = storyTime(keep, src);
  if (exact !== null) return exact;
  let acc = 0;
  let best = 0;
  let dist = Infinity;
  for (const [a, b] of keep) {
    for (const [edge, out] of [
      [a, acc],
      [b, acc + (b - a)],
    ]) {
      if (Math.abs(src - edge) < dist) {
        dist = Math.abs(src - edge);
        best = out;
      }
    }
    acc += b - a;
  }
  return best;
}

function sample(track: TrackKey[], t: number): { cx: number; cy: number } {
  if (!track.length) return { cx: 0.5, cy: 0.5 };
  if (t <= track[0].t) return { cx: track[0].cx, cy: track[0].cy };
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i];
    const b = track[i + 1];
    if (t <= b.t) {
      const f = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return { cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f };
    }
  }
  const last = track[track.length - 1];
  return { cx: last.cx, cy: last.cy };
}

const r4 = (v: number) => Math.round(v * 10000) / 10000;

/**
 * The virtual camera for the whole output: during the cold open it does what
 * it does when the story reaches that moment, then it hard-cuts back to the start.
 */
export function teaserTrack(track: TrackKey[], plan: EditPlan, keep: [number, number][]): TrackKey[] {
  if (!plan.teaser) return track;
  const seg = plan.segs[0];
  const m0 = nearestStoryTime(keep, seg.a);
  const len = plan.teaser;
  const keys: TrackKey[] = [{ t: 0, ...sample(track, m0) }];
  for (const k of track) if (k.t > m0 + 0.01 && k.t < m0 + len - 0.01) keys.push({ t: r4(k.t - m0), cx: k.cx, cy: k.cy });
  keys.push({ t: r4(len - 0.001), ...sample(track, m0 + len) });
  for (const k of track) keys.push({ t: r4(k.t + len), cx: k.cx, cy: k.cy });
  return keys.map((k) => ({ t: k.t, cx: r4(k.cx), cy: r4(k.cy) }));
}

// ── Punch-ins ─────────────────────────────────────────────────────────

export const ZOOM = { cam: 1.22, game: 1.15, all: 1.14 } as const;

export interface PunchInput {
  plan: EditPlan;
  keep: [number, number][];
  layout: LayoutKind;
  /** Source second of the payoff. */
  climax?: number;
  /** Loudness of the source, ten values per second (dBFS). */
  tenths: number[];
  /** Source-time words. */
  words: Word[];
  /** Indexes into words that the captions stress. */
  stressed?: Set<number>;
}

/**
 * Hard zoom-ins, the way an editor cuts them: on the payoff (the gameplay),
 * on the loudest reactions (the facecam), and on stressed words when it's
 * just someone talking. Never in the first 1.5 s, never across a cut, at
 * least 3 s apart, about one every 6 s at most. Output-time spans.
 */
export function planPunches(p: PunchInput): Punch[] {
  if (p.layout === "fit" || p.plan.main < 6) return [];
  const split = p.layout === "split";
  const ranges: [number, number][] = [];
  let acc = 0;
  for (const [a, b] of p.keep) {
    ranges.push([acc, acc + (b - a)]);
    acc += b - a;
  }
  const rangeEnd = (m: number) => ranges.find(([a, b]) => m >= a && m < b)?.[1] ?? acc;
  type Cand = { s: number; e: number; panel: Punch["panel"]; score: number; why: string };
  const cands: Cand[] = [];

  const climax = p.climax !== undefined ? storyTime(p.keep, p.climax) : null;
  if (climax !== null) {
    const s = Math.max(0, climax - 0.15);
    cands.push({ s, e: Math.min(s + 1.7, rangeEnd(s)), panel: split ? "game" : "all", score: 10, why: "payoff" });
  }

  // Loud reactions: peaks of the kept audio that someone is talking over.
  const story: { m: number; db: number; src: number }[] = [];
  p.keep.forEach(([a, b], i) => {
    for (let k = Math.ceil(a * 10); k < Math.floor(b * 10); k++) {
      const db = p.tenths[k];
      if (db === undefined) continue;
      story.push({ m: ranges[i][0] + (k / 10 - a), db, src: k / 10 });
    }
  });
  if (story.length > 20) {
    const mean = story.reduce((n, x) => n + x.db, 0) / story.length;
    const sd = Math.sqrt(story.reduce((n, x) => n + (x.db - mean) ** 2, 0) / story.length) || 1;
    for (let i = 0; i < story.length; i++) {
      const x = story[i];
      const z = (x.db - mean) / sd;
      if (z < 1.1 || x.db < -32) continue;
      let peak = true;
      for (let k = Math.max(0, i - 10); k <= Math.min(story.length - 1, i + 10); k++) if (story[k].db > x.db) peak = false;
      if (!peak) continue;
      const talking = p.words.some((w) => w.s <= x.src + 0.4 && w.e >= x.src - 0.4);
      if (!talking) continue;
      const s = Math.max(0, x.m - 0.2);
      cands.push({ s, e: Math.min(s + 1.4, rangeEnd(s)), panel: split ? "cam" : "all", score: 2 + z, why: "reaction" });
    }
  }

  // Stressed words, for talking without much happening on screen.
  if (p.stressed?.size) {
    for (const i of p.stressed) {
      const w = p.words[i];
      const m = w ? storyTime(p.keep, w.s) : null;
      if (m === null || m === undefined) continue;
      const s = Math.max(0, m - 0.05);
      cands.push({ s, e: Math.min(s + 1.5, rangeEnd(s)), panel: split ? "cam" : "all", score: 1.5, why: "stress" });
    }
  }

  const max = Math.max(1, Math.floor(p.plan.main / 6));
  const chosen: Cand[] = [];
  for (const cnd of cands.sort((a, b) => b.score - a.score)) {
    if (chosen.length >= max) break;
    if (cnd.s < 1.5 || cnd.e - cnd.s < 0.6) continue;
    if (chosen.some((q) => Math.abs(q.s - cnd.s) < 3 || (cnd.s < q.e && cnd.e > q.s))) continue;
    chosen.push(cnd);
  }
  const t0 = p.plan.teaser;
  return chosen
    .sort((a, b) => a.s - b.s)
    .map((cnd) => ({ s: r3(cnd.s + t0), e: r3(cnd.e + t0), panel: cnd.panel, zoom: ZOOM[cnd.panel], why: cnd.why }));
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

// ── Stressed words ───────────────────────────────────────────────────

export function normWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[^\p{L}\p{N}$%']+/gu, "")
    .replace(/^'+|'+$/g, "");
}

const POWER = new Set(
  "insane crazy unreal impossible unbelievable clutch cracked legendary broken never always million millions thousand hundred billion free secret biggest best worst first last fastest dead died killed wtf omg wow huge massive nuke ace win won lost lose winning perfect".split(" "),
);

/**
 * Indexes of the words the captions should stress: the orchestrator's
 * phrases where it gave some (matched in order, so "no way" only lights up
 * as a pair), else numbers and power words.
 */
export function stressedWords(words: Word[], phrases?: string[]): Set<number> {
  const out = new Set<number>();
  const norm = words.map((w) => normWord(w.w));
  const lists = (phrases ?? []).map((p) => p.split(/\s+/).map(normWord).filter(Boolean)).filter((p) => p.length && p.length <= 4);
  if (lists.length) {
    for (let i = 0; i < norm.length; i++) {
      for (const p of lists) {
        if (p.every((tok, k) => norm[i + k] === tok)) for (let k = 0; k < p.length; k++) out.add(i + k);
      }
    }
    return out;
  }
  norm.forEach((n, i) => {
    if (!n) return;
    if (/\d/.test(n) || POWER.has(n.replace(/'s$/, ""))) out.add(i);
  });
  return out;
}

// ── Swearing ─────────────────────────────────────────────────────────

const PROFANE = /^(f+u+c+k+\w*|f+u+k+\w*|motherf\w*|sh+i+t+\w*|bullsh\w*|b+i+t+c+h+\w*|c+u+n+t+s?|d+i+c+k+s?|dickheads?|puss(y|ies)|ass(holes?)?|arseholes?|bastards?|whores?|sluts?|cocks?|cocksuckers?|wank\w*|twats?|n+i+g+g+\w*|fag+(s|ots?)?|retard(s|ed)?)$/;

export function isProfane(word: string): boolean {
  const n = normWord(word).replace(/'/g, "");
  return Boolean(n) && PROFANE.test(n);
}

/** "fucking" → "F******" (first letter kept, punctuation kept). */
export function maskWord(word: string): string {
  let seen = false;
  return word.replace(/[\p{L}\p{N}]/gu, (ch) => {
    if (!seen) {
      seen = true;
      return ch;
    }
    return "*";
  });
}

/** Output-time spans to bleep, from output-time words. */
export function bleepSpans(words: Word[]): [number, number][] {
  const spans: [number, number][] = [];
  for (const w of words) {
    if (!isProfane(w.w)) continue;
    const a = Math.max(0, w.s - 0.03);
    const b = w.e + 0.03;
    const last = spans[spans.length - 1];
    if (last && a <= last[1] + 0.05) last[1] = Math.max(last[1], b);
    else spans.push([r3(a), r3(b)]);
  }
  return spans;
}
