import type { Word } from "../../lib/types.ts";

// Picks moments without an LLM: loudness spikes, hype words, laughter and
// fast talking, shaped into windows that end just after the payoff.

export interface MomentPick {
  start: number;
  end: number;
  score: number;
  title: string;
  hook: string;
  reason: string;
  description: string;
  hashtags: string[];
  /** Source second to replay in slow motion. */
  replayAt?: number;
}

export interface MomentInput {
  duration: number;
  /** Loudness per second, dBFS (−90 for silence). */
  loudness: number[];
  words: Word[];
  cuts: number[];
  count: number;
  minSec: number;
  maxSec: number;
  sourceTitle: string;
}

const HYPE: [RegExp, number][] = [
  [/\bno+ way\b/, 3],
  [/\boh my (god|gosh)\b|\bomg\b/, 3],
  [/\blet'?s go+\b/, 3],
  [/\bholy\b/, 2.5],
  [/\bwhat the\b|\bwtf\b/, 2.5],
  [/\bgot (him|her|them)\b/, 3],
  [/\b(run|go)( \1)+\b/, 3],
  [/\b(insane|crazy|unreal|clutch|cracked)\b/, 2],
  [/\b(bro|dude|yo)\b/, 0.8],
  [/\bwatch (this|out)\b|\blook at (this|that)\b/, 2],
  [/\b(dead|died|killed|kill)\b/, 1.5],
  [/\b(help|oh no+)\b/, 2],
  [/\b(ha){2,}\b|\blo+l\b|\blmao\b|\[laugh/, 2.5],
  [/\b(yes+|yeah+)!/, 1.5],
  [/\b(cops?|police|crash(ed)?|explod\w*|boom)\b/, 1.2],
  [/\bwait\b/, 1],
  [/\b(money|million|thousand|grand)\b/, 1],
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function zscores(xs: number[]): number[] {
  if (!xs.length) return [];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1;
  return xs.map((x) => (x - mean) / sd);
}

function smooth(xs: number[], radius: number): number[] {
  return xs.map((_, i) => {
    let sum = 0;
    let n = 0;
    for (let k = i - radius; k <= i + radius; k++) {
      if (k < 0 || k >= xs.length) continue;
      sum += xs[k];
      n++;
    }
    return n ? sum / n : 0;
  });
}

export function hypeScore(text: string): number {
  const t = ` ${text.toLowerCase()} `;
  let s = 0;
  for (const [re, w] of HYPE) if (re.test(t)) s += w;
  if (/!/.test(text)) s += 0.6;
  if (/\b[A-Z]{3,}\b/.test(text)) s += 0.6;
  if (/(\w)\1{3,}/i.test(text)) s += 0.8; // "nooooo"
  return s;
}

function wordsIn(words: Word[], a: number, b: number): Word[] {
  return words.filter((w) => w.s >= a && w.e <= b);
}

/** The punchiest 1–3 word phrase near the payoff, as a hook: "NO WAY." */
export function hookFrom(words: Word[], peak: number): string | null {
  let best: { text: string; score: number } | null = null;
  for (let i = 0; i < words.length; i++) {
    for (let len = 1; len <= 3 && i + len <= words.length; len++) {
      const chunk = words.slice(i, i + len);
      if (chunk[chunk.length - 1].s - chunk[0].s > 1.8) continue;
      const text = chunk.map((w) => w.w).join(" ");
      const plain = text.replace(/[^\p{L}\p{N}' ]/gu, "").trim();
      if (!plain || plain.length > 16) continue;
      const near = 1 - clamp(Math.abs(chunk[0].s - peak) / 12, 0, 0.8);
      const score = hypeScore(text) * near - (len === 3 ? 0.3 : 0);
      if (score > 1.5 && (!best || score > best.score)) best = { text: plain, score };
    }
  }
  return best ? `${best.text.toUpperCase()}.` : null;
}

/** The most exciting full sentence in the moment (at least 4 words), as a title. */
function sentenceTitle(words: Word[]): string {
  const text = words.map((w) => w.w).join(" ").replace(/\s+([,.!?])/g, "$1").trim();
  if (!text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const full = sentences.filter((s) => s.split(/\s+/).length >= 4);
  const pool = full.length ? full : sentences;
  const best = pool.reduce((a, b) => (hypeScore(b) > hypeScore(a) ? b : a), pool[0]);
  const t = best.length > 70 ? `${best.slice(0, 67).replace(/\s+\S*$/, "")}…` : best;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function tagsFor(title: string): string[] {
  const tags = ["shorts", "gaming", "clips"];
  const lower = title.toLowerCase();
  for (const [re, tag] of [
    [/\bgta|grand theft/, "gta"],
    [/\bfortnite/, "fortnite"],
    [/\bminecraft/, "minecraft"],
    [/\bvalorant/, "valorant"],
    [/\bwarzone|call of duty|\bcod\b/, "warzone"],
    [/\brp\b|roleplay/, "gtarp"],
  ] as [RegExp, string][]) {
    if (re.test(lower)) tags.push(tag);
  }
  return tags;
}

/** Sentence spans: a word ending in . ! ? or a pause over 0.7 s closes one. */
export function splitSentences(words: Word[]): { s: number; e: number }[] {
  const out: { s: number; e: number }[] = [];
  let first: Word | null = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    first ??= w;
    const next = words[i + 1];
    if (/[.!?…]["')\]]*$/.test(w.w) || !next || next.s - w.e > 0.7) {
      out.push({ s: first.s, e: w.e });
      first = null;
    }
  }
  return out;
}

export function pickMoments(input: MomentInput): MomentPick[] {
  const { duration, words } = input;
  const secs = Math.max(1, Math.ceil(duration));
  const loud = Array.from({ length: secs }, (_, i) => input.loudness[i] ?? -90);
  const speech = new Array<number>(secs).fill(0);
  const hype = new Array<number>(secs).fill(0);
  for (const w of words) {
    const i = Math.min(secs - 1, Math.floor(w.s));
    speech[i] += 1;
  }
  // Hype over a rolling 3-word context, so "no way" scores on both words.
  for (let i = 0; i < words.length; i++) {
    const ctx = words.slice(Math.max(0, i - 1), i + 2).map((w) => w.w).join(" ");
    const s = hypeScore(ctx) / 3;
    hype[Math.min(secs - 1, Math.floor(words[i].s))] += s;
  }
  const zl = zscores(loud.map((d) => clamp(d, -60, 0)));
  const zh = zscores(smooth(hype, 2));
  const zs = zscores(smooth(speech, 2));
  const hasWords = words.length > 20;
  const excite = smooth(
    zl.map((l, i) => (hasWords ? 0.5 * l + 0.35 * (zh[i] ?? 0) + 0.15 * (zs[i] ?? 0) : l)),
    1,
  );

  const target = clamp(Math.round((input.minSec + input.maxSec) / 2), input.minSec, input.maxSec);
  const len = Math.min(target, Math.max(input.minSec, duration * 0.9));
  // Peaks, strongest first.
  const peaks = excite
    .map((v, i) => ({ i, v }))
    .filter(({ i, v }) => v >= (excite[i - 1] ?? -Infinity) && v >= (excite[i + 1] ?? -Infinity))
    .sort((a, b) => b.v - a.v);

  const sentences = splitSentences(words);
  const picks: MomentPick[] = [];
  const taken: [number, number][] = [];
  for (const { i, v } of peaks) {
    if (picks.length >= input.count) break;
    // End ~3 s after the payoff; most of the window is the build-up.
    let end = clamp(i + 3.5, len, duration);
    let start = Math.max(0, end - len);
    // Never start or end mid-sentence: grow to the whole sentence if it fits, else drop it.
    const sIn = sentences.find((x) => x.s < start && x.e > start);
    if (sIn) start = end - sIn.s <= input.maxSec ? Math.max(0, sIn.s - 0.15) : (sentences.find((x) => x.s >= start)?.s ?? start) - 0.15;
    else {
      const cutNear = input.cuts.find((c) => Math.abs(c - start) < 1.2);
      if (cutNear !== undefined) start = cutNear + 0.05;
    }
    const eIn = sentences.find((x) => x.s < end && x.e > end);
    if (eIn) {
      if (eIn.e + 0.35 - start <= input.maxSec) end = eIn.e + 0.35;
      else {
        const prev = [...sentences].reverse().find((x) => x.e <= end);
        if (prev && prev.e - start >= input.minSec) end = prev.e + 0.35;
      }
    }
    start = Math.max(0, start);
    end = Math.min(duration, end);
    if (end - start < input.minSec) end = Math.min(duration, start + input.minSec);
    if (end - start > input.maxSec) start = end - input.maxSec;
    if (taken.some(([a, b]) => start < b + 2 && end > a - 2)) continue;
    taken.push([start, end]);

    const inside = wordsIn(words, start, end);
    // The loudest second inside the window is the replay.
    let replayAt = i;
    let maxL = -Infinity;
    for (let k = Math.floor(start); k < Math.min(secs, Math.ceil(end)); k++) {
      if (loud[k] > maxL) {
        maxL = loud[k];
        replayAt = k + 0.5;
      }
    }
    const hook = hookFrom(inside, i) ?? "WAIT FOR IT.";
    const title = sentenceTitle(inside) || `${input.sourceTitle || "Stream"} highlight`;
    const peakHype = Math.max(0, ...hype.slice(Math.floor(start), Math.ceil(end)));
    const score = Math.round(clamp(55 + 18 * v + 4 * peakHype, 35, 97));
    const reasons: string[] = [];
    if ((zl[i] ?? 0) > 1) reasons.push("audio spike");
    if ((zh[i] ?? 0) > 1) reasons.push("hype words");
    if ((zs[i] ?? 0) > 1) reasons.push("fast talking");
    picks.push({
      start: round(start),
      end: round(end),
      score,
      title,
      hook,
      reason: reasons.length ? `Peak at ${fmt(i)}: ${reasons.join(", ")}.` : `Loudest stretch around ${fmt(i)}.`,
      description: `${title} — from ${input.sourceTitle || "the stream"} at ${fmt(start)}.`,
      hashtags: tagsFor(`${input.sourceTitle} ${title}`),
      replayAt: round(clamp(replayAt, start + 0.8, end - 0.8)),
    });
  }
  return picks.sort((a, b) => b.score - a.score);
}

const round = (v: number) => Math.round(v * 100) / 100;

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
