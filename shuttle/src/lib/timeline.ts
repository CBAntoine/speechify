// Pure timeline math: trims and cuts, source/output time mapping, silence
// detection on an RMS envelope, transcript boundary refinement and zoom curves.
// No DOM access, so it runs under `node --test` as well as in the browser.

import type { Cut, Edits, Segment, Zoom } from './types.ts';

export type Range = [number, number];

const EPS = 1e-6;

export function uid(prefix = ''): string {
  const r = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${r}`;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Sorts and merges overlapping or touching ranges. */
export function mergeRanges(ranges: Range[], gap = 0): Range[] {
  const sorted = ranges
    .filter(([a, b]) => b - a > EPS)
    .map(([a, b]) => [a, b] as Range)
    .sort((x, y) => x[0] - y[0]);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1] + gap) last[1] = Math.max(last[1], r[1]);
    else out.push(r);
  }
  return out;
}

/** Shortest piece of video worth keeping between two cuts (one frame at 30 fps). */
const MIN_KEEP = 1 / 30;

/** The parts of the source that survive the trim and every cut, in order. */
export function keptSegments(duration: number, edits: Pick<Edits, 'trimStart' | 'trimEnd' | 'cuts'>): Range[] {
  const start = clamp(edits.trimStart || 0, 0, duration);
  const end = clamp(edits.trimEnd ?? duration, start, duration);
  const cuts = mergeRanges(
    edits.cuts.map((c): Range => [Math.max(c.start, start), Math.min(c.end, end)]),
  );
  const out: Range[] = [];
  let cursor = start;
  for (const [a, b] of cuts) {
    if (a - cursor >= MIN_KEEP) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (end - cursor >= MIN_KEEP) out.push([cursor, end]);
  return out;
}

export function outputDuration(segs: Range[]): number {
  let d = 0;
  for (const [a, b] of segs) d += b - a;
  return d;
}

/** Maps a source time to output time, or null when the moment was cut. */
export function sourceToOutput(t: number, segs: Range[]): number | null {
  let acc = 0;
  for (const [a, b] of segs) {
    if (t < a - EPS) return null;
    if (t <= b + EPS) return acc + clamp(t - a, 0, b - a);
    acc += b - a;
  }
  return null;
}

/** Like sourceToOutput, but a cut moment snaps to the next kept moment. */
export function sourceToOutputSnapped(t: number, segs: Range[]): number {
  let acc = 0;
  for (const [a, b] of segs) {
    if (t <= b + EPS) return acc + clamp(t - a, 0, b - a);
    acc += b - a;
  }
  return acc;
}

export function outputToSource(t: number, segs: Range[]): number {
  let acc = 0;
  for (const [a, b] of segs) {
    const len = b - a;
    if (t <= acc + len + EPS) return a + clamp(t - acc, 0, len);
    acc += len;
  }
  const last = segs[segs.length - 1];
  return last ? last[1] : 0;
}

/**
 * If `t` falls inside removed material (before the trim, inside a cut, after
 * the trim end), returns where playback should continue. Returns `t` when the
 * moment is kept and `null` when nothing is kept after it.
 */
export function nextKept(t: number, segs: Range[]): number | null {
  for (const [a, b] of segs) {
    if (t < a - EPS) return a;
    if (t < b - EPS) return t;
  }
  return null;
}

// ---------------------------------------------------------------- silences

export interface SilenceOptions {
  /** Only pauses at least this long are removed. */
  minSilence?: number;
  /** Breathing room kept on each side of speech. */
  padding?: number;
}

function percentile(sorted: Float32Array | number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = clamp(Math.round((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[i];
}

const toDb = (v: number) => 20 * Math.log10(Math.max(v, 1e-6));

/**
 * Picks a level that separates speech from room noise, in linear RMS.
 * Returns null when the recording has no clear speech/noise contrast, in which
 * case nothing should be cut automatically.
 */
export function speechThreshold(envelope: Float32Array): number | null {
  if (envelope.length < 10) return null;
  const db = Float32Array.from(envelope, toDb).sort();
  const floor = percentile(db, 0.1);
  const speech = percentile(db, 0.9);
  if (speech - floor < 10 || speech < -55) return null;
  const thrDb = Math.max(floor + 6, floor + (speech - floor) * 0.3);
  return Math.pow(10, thrDb / 20);
}

/** Finds pauses in the envelope. Returned ranges already exclude the padding. */
export function detectSilences(
  envelope: Float32Array,
  rate: number,
  opts: SilenceOptions = {},
  threshold: number | null = speechThreshold(envelope),
): Range[] {
  const minSilence = opts.minSilence ?? 0.8;
  const padding = opts.padding ?? 0.2;
  if (threshold === null) return [];
  // Light smoothing (about 60 ms) so single noisy windows do not split a pause.
  const smooth = new Float32Array(envelope.length);
  const k = Math.max(1, Math.round(rate * 0.03));
  for (let i = 0; i < envelope.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = i - k; j <= i + k; j++) {
      if (j >= 0 && j < envelope.length) {
        s += envelope[j];
        n++;
      }
    }
    smooth[i] = s / n;
  }
  const out: Range[] = [];
  let runStart = -1;
  const flush = (endIdx: number) => {
    const a = runStart / rate;
    const b = endIdx / rate;
    const isLeading = runStart === 0;
    const isTrailing = endIdx === envelope.length;
    const ca = isLeading ? a : a + padding;
    const cb = isTrailing ? b : b - padding;
    if (b - a >= minSilence && cb - ca > 0.1) out.push([ca, cb]);
  };
  for (let i = 0; i < smooth.length; i++) {
    const quiet = smooth[i] < threshold;
    if (quiet && runStart < 0) runStart = i;
    if (!quiet && runStart >= 0) {
      flush(i);
      runStart = -1;
    }
  }
  if (runStart >= 0) flush(smooth.length);
  return out;
}

/**
 * Live speech recognition only knows roughly when a phrase started and ended.
 * This moves each boundary to the nearest speech onset/offset in the audio so
 * cutting a sentence does not clip its first or last word.
 */
export function refineSegments(segments: Segment[], envelope: Float32Array, rate: number): Segment[] {
  const thr = speechThreshold(envelope);
  if (thr === null || segments.length === 0) return segments;
  const n = envelope.length;
  const loud = (i: number) => i >= 0 && i < n && envelope[i] >= thr;
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  for (let s = 0; s < sorted.length; s++) {
    const seg = sorted[s];
    const prevEnd = out.length ? out[out.length - 1].end : 0;
    const nextStart = s + 1 < sorted.length ? sorted[s + 1].start : n / rate;
    // Onset: search from 1.2 s before to 0.6 s after the rough start for the
    // first loud window that follows a quiet one.
    let start = seg.start;
    const lo = Math.max(Math.floor((seg.start - 1.2) * rate), Math.ceil(prevEnd * rate));
    const hi = Math.min(Math.ceil((seg.start + 0.6) * rate), n - 1);
    for (let i = Math.max(lo, 1); i <= hi; i++) {
      if (loud(i) && !loud(i - 1)) {
        start = i / rate - 0.08;
        break;
      }
    }
    // Offset: where speech near the rough end gives way to a quiet stretch.
    // Recognition reports the end late, so when the rough end is already quiet
    // walk back to the last loud window; otherwise walk forward to the next
    // quiet run of at least 250 ms.
    let end = seg.end;
    const startIdx = Math.ceil(start * rate);
    const ehi = Math.min(Math.ceil((seg.end + 1.2) * rate), Math.floor(nextStart * rate), n - 1);
    const from = clamp(Math.floor(seg.end * rate), startIdx, Math.max(startIdx, ehi));
    const quietRun = Math.max(1, Math.round(rate * 0.25));
    if (!loud(from)) {
      const floor = Math.max(startIdx, Math.floor((seg.end - 1.5) * rate));
      for (let i = from; i >= floor; i--) {
        if (loud(i)) {
          end = (i + 1) / rate + 0.12;
          break;
        }
      }
    } else {
      let run = 0;
      for (let i = from; i <= ehi; i++) {
        run = loud(i) ? 0 : run + 1;
        if (run >= quietRun) {
          end = (i - run + 1) / rate + 0.12;
          break;
        }
      }
    }
    start = clamp(start, prevEnd, seg.end);
    end = Math.max(end, start + 0.2);
    if (s + 1 < sorted.length) end = Math.min(end, Math.max(sorted[s + 1].start, start + 0.2));
    out.push({ ...seg, start, end });
  }
  return out;
}

// ---------------------------------------------------------------- zoom

export const ZOOM_RAMP = 0.45;

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

/** Camera move at source time t: eases in, holds, eases out. */
export function zoomAt(t: number, zooms: Zoom[]): ZoomState {
  for (const z of zooms) {
    if (t < z.start || t > z.end) continue;
    const ramp = Math.min(ZOOM_RAMP, (z.end - z.start) / 3);
    let e = 1;
    if (ramp > 0) {
      if (t < z.start + ramp) e = easeInOut((t - z.start) / ramp);
      else if (t > z.end - ramp) e = easeInOut((z.end - t) / ramp);
    }
    return { scale: 1 + (z.scale - 1) * e, x: z.x, y: z.y };
  }
  return { scale: 1, x: 0.5, y: 0.5 };
}

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Visible part of the frame for a zoom state, normalized and kept in bounds. */
export function cropFor(z: ZoomState): NormRect {
  const w = 1 / Math.max(1, z.scale);
  const h = w;
  return {
    x: clamp(z.x - w / 2, 0, 1 - w),
    y: clamp(z.y - h / 2, 0, 1 - h),
    w,
    h,
  };
}

// ---------------------------------------------------------------- lookup

/** Index of the segment covering t, or -1. Segments must be sorted by start. */
export function findSegmentAt<T extends { start: number; end: number }>(list: T[], t: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = list[mid];
    if (t < s.start) hi = mid - 1;
    else if (t >= s.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Source-time cuts covering each transcript segment that the user struck out. */
export function transcriptCutId(segmentId: string): string {
  return `seg:${segmentId}`;
}

/** True when the phrase was struck out, or at least 80% of it sits inside cuts or trims. */
export function isSegmentCut(seg: Segment, segs: Range[], cuts: Cut[]): boolean {
  if (cuts.some((c) => c.id === transcriptCutId(seg.id))) return true;
  const len = seg.end - seg.start;
  if (len <= 0) return false;
  let kept = 0;
  for (const [a, b] of segs) kept += Math.max(0, Math.min(b, seg.end) - Math.max(a, seg.start));
  return kept / len < 0.2;
}

/** Seconds removed by cuts and trims. */
export function removedSeconds(duration: number, segs: Range[]): number {
  return Math.max(0, duration - outputDuration(segs));
}
