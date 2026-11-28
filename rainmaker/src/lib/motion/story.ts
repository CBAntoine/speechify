// Motion ads made in code (Level 1, no AI video): a numbered storyboard of
// shots around one centre shape that morphs from shot to shot, never a
// cross dissolve. This file: shapes, timing, sound cues, the palette, a
// template storyboard, and the checks every storyboard passes. Pure, unit
// tested; the Three.js engine draws what it describes.

import type { MotionFill, MotionShape, MotionSfx, MotionShot } from "../types.ts";

export const SHAPES = ["circle", "ring", "rounded", "square", "pill", "card", "phone", "bar"] as const satisfies readonly MotionShape[];
export const FILLS = ["brand", "accent", "light", "dark", "logo", "photo"] as const satisfies readonly MotionFill[];
export const CAMERAS = ["still", "push", "pull", "tilt", "orbit"] as const satisfies readonly MotionShot["camera"][];
export const ACCENTS = ["none", "orbit", "burst", "rings", "lines"] as const satisfies readonly MotionShot["accent"][];
export const SFX = ["whoosh", "hit", "pullback", "riser", "ding"] as const satisfies readonly MotionSfx[];

export const FORMATS = {
  vertical: { w: 1080, h: 1920, label: "Vertical 9:16" },
  square: { w: 1080, h: 1080, label: "Square 1:1" },
  landscape: { w: 1920, h: 1080, label: "Landscape 16:9" },
} as const;

/** The morph's length at the start of each shot: the old shape becomes the new one. */
export const MORPH = 0.6;

/**
 * A shape as a rounded box: width, height and corner radius (and a ring's
 * thickness), in pixels for a frame whose short side is `unit`. Every shape
 * is a rounded box, so any shape can morph into any other by interpolation.
 */
export function shapeBox(shape: MotionShape, size: number, unit: number): { w: number; h: number; r: number; ring: number } {
  const s = Math.max(0.15, Math.min(1, size)) * unit;
  switch (shape) {
    case "circle":
      return { w: s, h: s, r: s / 2, ring: 0 };
    case "ring":
      return { w: s, h: s, r: s / 2, ring: s * 0.09 };
    case "rounded":
      return { w: s, h: s, r: s * 0.2, ring: 0 };
    case "square":
      return { w: s, h: s, r: s * 0.04, ring: 0 };
    case "pill":
      return { w: s * 1.5, h: s * 0.56, r: s * 0.28, ring: 0 };
    case "card":
      return { w: s * 0.82, h: s * 1.08, r: s * 0.06, ring: 0 };
    case "phone":
      return { w: s * 0.56, h: s * 1.14, r: s * 0.09, ring: 0 };
    case "bar":
      return { w: s * 1.6, h: s * 0.2, r: s * 0.1, ring: 0 };
  }
}

/** When each shot starts, and the length. */
export function timeline(shots: Pick<MotionShot, "seconds">[]): { starts: number[]; total: number } {
  const starts: number[] = [];
  let t = 0;
  for (const s of shots) {
    starts.push(Math.round(t * 100) / 100);
    t += s.seconds;
  }
  return { starts, total: Math.round(t * 100) / 100 };
}

export interface Cue {
  t: number;
  kind: MotionSfx;
  /** How long it builds (a riser runs through the first shot). */
  dur?: number;
}

/**
 * Where the sound effects go: a whoosh under each morph, a soft hit as the
 * headline lands, a pullback when the camera pulls back, a riser into the
 * first shot and a ding on the last. Each shot lists which of its own it wants.
 */
export function sfxCues(shots: Pick<MotionShot, "sfx" | "camera">[], starts: number[]): Cue[] {
  const cues: Cue[] = [];
  shots.forEach((s, i) => {
    const t0 = starts[i] ?? 0;
    for (const kind of s.sfx) {
      if (kind === "whoosh" && i > 0) cues.push({ t: Math.max(0, t0 - 0.12), kind });
      if (kind === "hit") cues.push({ t: t0 + 0.42, kind });
      if (kind === "pullback") cues.push({ t: t0 + 0.05, kind });
      if (kind === "riser" && i === 0) cues.push({ t: 0, kind, dur: Math.max(0.8, Math.min(2.6, (starts[1] ?? t0 + 2) - 0.1)) });
      if (kind === "ding") cues.push({ t: t0 + 0.5, kind });
    }
    if (s.camera === "pull" && !s.sfx.includes("pullback")) cues.push({ t: t0 + 0.05, kind: "pullback" });
  });
  return cues.sort((a, b) => a.t - b.t);
}

// ── Colour ───────────────────────────────────────────────────

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? [...h].map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) || 0) as [number, number, number];
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
}

function hsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return hex(f(0) * 255, f(8) * 255, f(4) * 255);
}

const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Black or white, whichever reads better on the colour. */
export function inkFor(color: string): string {
  const l = lum(color);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.06 ? "#ffffff" : "#111111";
}

/** A palette from their brand colour: an accent that sets it off, readable text, a light and a dark. */
export function palette(primary: string): { primary: string; accent: string; ink: string; light: string; dark: string } {
  const valid = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(primary) ? primary.toLowerCase() : "#1c1917";
  const [h, s, l] = hsl(rgb(valid));
  // Neutral brands (black, grey) get a warm highlight; colourful ones a lighter, livelier version of themselves.
  const accent = s < 0.15 ? "#f5b83d" : fromHsl((h + 28) % 360, Math.min(1, s + 0.15), l < 0.45 ? Math.min(0.68, l + 0.32) : Math.max(0.32, l - 0.22));
  return { primary: valid, accent, ink: inkFor(valid), light: "#f6f3ee", dark: "#121212" };
}

// ── Checks and the template ──────────────────────────────────

const cut = (s: string | undefined, words: number, chars: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  const w = t.split(" ").slice(0, words).join(" ");
  return w.length > chars ? `${w.slice(0, chars - 1).trim()}…` : w;
};

const NUMBER = /\d[\d,.]*\d|\d/g;
const norm = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "");

/** Numbers in on-screen text that the brief, offer and facts don't contain. */
export function madeUpNumbers(text: string, corpus: string): string[] {
  const known = new Set((corpus.match(NUMBER) ?? []).map(norm));
  return (text.match(NUMBER) ?? []).map(norm).filter((n) => !known.has(n));
}

export interface MotionInput {
  business: string;
  goal: string;
  offer?: string;
  audience?: string;
  notes?: string;
  /** True things about the business (website check, rating, services). */
  facts: string[];
  /** Their phone, website or booking line for the last shot. */
  cta?: string;
  hasLogo: boolean;
  photos: number;
  format: "vertical" | "square" | "landscape";
}

/**
 * Make a storyboard safe to animate: known shapes and fills, photos that
 * exist, short words, sane timing, numbers only from the brief and facts,
 * and the directing rules every shot follows.
 */
export function cleanShots(raw: Partial<MotionShot>[], input: MotionInput): { shots: MotionShot[]; dropped: string[] } {
  const corpus = [input.offer ?? "", input.notes ?? "", input.cta ?? "", input.audience ?? "", ...input.facts].join(" \n ");
  const dropped: string[] = [];
  const shots: MotionShot[] = [];
  for (const r of raw.slice(0, 14)) {
    let fill: MotionFill = (FILLS as readonly string[]).includes(r.fill ?? "") ? (r.fill as MotionFill) : "brand";
    let photo = typeof r.photo === "number" ? Math.floor(r.photo) : undefined;
    if (fill === "logo" && !input.hasLogo) fill = "brand";
    if (fill === "photo" && (!input.photos || photo === undefined || photo < 0 || photo >= input.photos)) {
      if (input.photos) photo = 0;
      else fill = "accent";
    }
    const shot: MotionShot = {
      note: cut(r.note, 60, 320) || "The shape morphs into the next shot.",
      seconds: Math.round(Math.max(1.4, Math.min(5, Number(r.seconds) || 2.6)) * 10) / 10,
      shape: (SHAPES as readonly string[]).includes(r.shape ?? "") ? (r.shape as MotionShape) : "circle",
      fill,
      photo: fill === "photo" ? photo : undefined,
      size: Math.round(Math.max(0.2, Math.min(1, Number(r.size) || 0.55)) * 100) / 100,
      headline: cut(r.headline, 6, 42),
      sub: cut(r.sub, 10, 70) || undefined,
      stat: r.stat?.value ? { value: cut(r.stat.value, 1, 8), label: cut(r.stat.label, 4, 28) } : undefined,
      camera: (CAMERAS as readonly string[]).includes(r.camera ?? "") ? (r.camera as MotionShot["camera"]) : "still",
      accent: (ACCENTS as readonly string[]).includes(r.accent ?? "") ? (r.accent as MotionShot["accent"]) : "none",
      sfx: [...new Set((r.sfx ?? []).filter((x): x is MotionSfx => (SFX as readonly string[]).includes(x)))],
      voice: cut(r.voice, 30, 200) || undefined,
    };
    const onScreen = `${shot.headline} ${shot.sub ?? ""} ${shot.stat ? `${shot.stat.value} ${shot.stat.label}` : ""} ${shot.voice ?? ""}`;
    const bad = madeUpNumbers(onScreen, corpus);
    if (bad.length) {
      if (shot.stat && madeUpNumbers(`${shot.stat.value} ${shot.stat.label}`, corpus).length) shot.stat = undefined;
      if (madeUpNumbers(`${shot.headline} ${shot.sub ?? ""} ${shot.voice ?? ""}`, corpus).length) {
        dropped.push(`shot "${shot.headline}" (numbers that aren't in your brief or their facts: ${bad.join(", ")})`);
        continue;
      }
    }
    if (!shot.headline && !shot.stat) continue;
    shots.push(shot);
  }
  if (shots.length) {
    if (!shots[0].sfx.includes("riser")) shots[0].sfx.unshift("riser");
    const last = shots[shots.length - 1];
    if (!last.sfx.includes("ding")) last.sfx.push("ding");
  }
  // Keep it tight: about 15 to 40 seconds.
  let total = shots.reduce((a, s) => a + s.seconds, 0);
  while (total > 42 && shots.length > 5) {
    const i = shots.length - 2;
    total -= shots[i].seconds;
    dropped.push(`shot "${shots[i].headline}" (the ad was over 40 seconds)`);
    shots.splice(i, 1);
  }
  return { shots, dropped };
}

const HOOK = { book: "Book your visit", calls: "Get your free quote", sell: "New in store", brand: "Meet the team" } as const;
const CTA = { book: "Book today", calls: "Call today", sell: "Shop now", brand: "Come see us" } as const;

export function goalKey(goal: string): keyof typeof HOOK {
  return /book|appoint|consult|schedul/i.test(goal) ? "book" : /call|quote|estimate|lead/i.test(goal) ? "calls" : /sell|shop|product|order|buy/i.test(goal) ? "sell" : "brand";
}

/** Short true lines for the screen: the agency's notes first, then their website's services and headline. Nothing made up. */
export function proofLines(input: Pick<MotionInput, "notes" | "facts">): string[] {
  const out: string[] = [];
  const add = (raw?: string) => {
    const t = (raw ?? "").replace(/[“”"]/g, "").replace(/[.!?;:]+$/, "").replace(/\s+/g, " ").trim();
    if (!t || t.split(" ").length > 6 || t.length > 42) return;
    if (!out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const sentence of (input.notes ?? "").split(/(?<=[.!?;])\s+|\n+/)) add(sentence);
  for (const f of input.facts) f.match(/^Services on their website: (.+)\.$/)?.[1].split(/,\s*/).slice(0, 3).forEach(add);
  add(input.facts.map((f) => f.match(/^Their website's headline: "(.+)"$/)?.[1]).find(Boolean));
  return out;
}

/**
 * A storyboard without AI, each shape morphing into the next: the offer,
 * their logo, their photos with lines from your notes and their website,
 * their rating, the offer again and the call to action. It never makes a
 * claim of its own.
 */
export function templateShots(input: MotionInput): MotionShot[] {
  const g = goalKey(input.goal);
  const proof = proofLines(input);
  const rating = input.facts.map((f) => f.match(/rated ([\d.]+) stars from (\d+)/i)).find(Boolean);
  const forWho = input.audience ? cut(`For ${input.audience}`, 10, 70) : undefined;
  const shots: Partial<MotionShot>[] = [
    { note: "A small brand-colour circle drops into the centre and the background starts drifting. The headline slides up word by word.", seconds: 2.4, shape: "circle", fill: "brand", size: 0.32, headline: input.offer ? cut(input.offer, 6, 42) : HOOK[g], camera: "push", accent: "rings", sfx: ["riser", "hit"] },
    { note: "The circle stretches into a rounded plate and the logo is revealed from the centre.", seconds: 2.6, shape: "rounded", fill: input.hasLogo ? "logo" : "light", size: 0.42, headline: input.business, camera: "still", accent: "orbit", sfx: ["whoosh", "hit"] },
    { note: "The plate opens into a tall card and the first photo is revealed inside it.", seconds: 2.8, shape: "card", fill: input.photos ? "photo" : "accent", photo: 0, size: 0.62, headline: proof[0] ?? forWho ?? input.business, sub: proof[0] ? forWho : undefined, camera: "push", accent: "lines", sfx: ["whoosh"] },
  ];
  if (rating) shots.push({ note: "The card folds into a square and the rating counts up in the middle.", seconds: 2.6, shape: "square", fill: "dark", size: 0.5, headline: "Rated by locals", stat: { value: `${rating[1]}★`, label: `${rating[2]} reviews` }, camera: "tilt", accent: "burst", sfx: ["whoosh", "hit"] });
  if (input.photos > 1) shots.push({ note: "The shape becomes a phone and the second photo slides into view.", seconds: 2.6, shape: "phone", fill: "photo", photo: 1, size: 0.62, headline: proof[1] ?? "See our work", camera: "orbit", accent: "none", sfx: ["whoosh"] });
  else if (proof[1]) shots.push({ note: "The card folds into a ring with the next line inside it.", seconds: 2.4, shape: "ring", fill: "accent", size: 0.46, headline: proof[1], camera: "orbit", accent: "none", sfx: ["whoosh", "hit"] });
  if (input.offer) shots.push({ note: "Everything pulls into a wide pill with the offer on it.", seconds: 2.6, shape: "pill", fill: "accent", size: 0.5, headline: cut(input.offer, 6, 42), camera: "still", accent: "burst", sfx: ["whoosh", "hit"] });
  shots.push({ note: "The camera pulls back as the shape rounds into the logo plate for the call to action.", seconds: 3, shape: "rounded", fill: input.hasLogo ? "logo" : "brand", size: 0.38, headline: CTA[g], sub: input.cta ? cut(input.cta, 10, 70) : input.business, camera: "pull", accent: "rings", sfx: ["pullback", "ding"] });
  return cleanShots(shots, input).shots;
}

// ── Voiceover ────────────────────────────────────────────────

/** The narration read in one take, and where each shot's line starts in it. */
export function narrationOf(shots: Pick<MotionShot, "voice">[]): { text: string; lines: { shot: number; start: number; end: number }[] } {
  let text = "";
  const lines: { shot: number; start: number; end: number }[] = [];
  shots.forEach((s, i) => {
    const line = s.voice?.replace(/\s+/g, " ").trim();
    if (!line) return;
    if (text) text += " ";
    const start = text.length;
    text += /[.!?…]$/.test(line) ? line : `${line}.`;
    lines.push({ shot: i, start, end: text.length });
  });
  return { text, lines };
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** Where each line is in the recording, from the per-character timing (cut between lines, in the pauses). */
export function voiceSegments(lines: { shot: number; start: number; end: number }[], a: Alignment): { shot: number; from: number; to: number }[] {
  const n = a.characters.length;
  const startAt = (i: number) => a.character_start_times_seconds[Math.max(0, Math.min(n - 1, i))] ?? 0;
  const endAt = (i: number) => a.character_end_times_seconds[Math.max(0, Math.min(n - 1, i))] ?? 0;
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return lines.map((l, k) => {
    const from = k === 0 ? 0 : (endAt(lines[k - 1].end - 1) + startAt(l.start)) / 2;
    const to = k === lines.length - 1 ? endAt(n - 1) + 0.05 : (endAt(l.end - 1) + startAt(lines[k + 1].start)) / 2;
    return { shot: l.shot, from: round(Math.max(0, from)), to: round(Math.max(from, to)) };
  });
}

/** When a shot's line starts: just after the morph, so the words and the picture land together. */
export const VOICE_IN = 0.25;

/** Lengthen any shot whose line runs longer than the shot (never past 6 seconds). */
export function fitShotsToVoice<T extends Pick<MotionShot, "seconds">>(shots: T[], segments: { shot: number; from: number; to: number }[]): T[] {
  const out = shots.map((s) => ({ ...s }));
  for (const g of segments) {
    const s = out[g.shot];
    if (!s) continue;
    const need = Math.ceil((g.to - g.from + VOICE_IN + 0.3) * 10) / 10;
    if (need > s.seconds) s.seconds = Math.min(6, need);
  }
  return out;
}
