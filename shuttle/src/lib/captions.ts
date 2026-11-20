// Captions and text exports: splits transcript phrases into readable cues,
// moves them onto the edited timeline, and writes WebVTT, SRT and Markdown.

import type { Marker, Segment } from './types.ts';
import { type Range, sourceToOutput, sourceToOutputSnapped } from './timeline.ts';
import { wrapCaption } from './layout.ts';

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export const CAPTION_LINE_CHARS = 42;

/** Breaks long phrases into cues of at most two caption lines, timed by length. */
export function captionCues(segments: Segment[], lineChars = CAPTION_LINE_CHARS): Cue[] {
  const cues: Cue[] = [];
  const sorted = [...segments].filter((s) => s.text.trim()).sort((a, b) => a.start - b.start);
  for (const seg of sorted) {
    const lines = wrapCaption(seg.text, lineChars);
    const groups: string[] = [];
    for (let i = 0; i < lines.length; i += 2) groups.push(lines.slice(i, i + 2).join('\n'));
    const total = groups.reduce((n, g) => n + g.length, 0) || 1;
    let t = seg.start;
    const span = Math.max(0.2, seg.end - seg.start);
    for (const g of groups) {
      const d = (span * g.length) / total;
      cues.push({ start: t, end: t + d, text: g });
      t += d;
    }
  }
  return cues;
}

/** Moves source-time cues onto the output timeline, dropping cut ones. */
export function cuesToOutput(cues: Cue[], segs: Range[]): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const mid = (c.start + c.end) / 2;
    if (sourceToOutput(mid, segs) === null) continue;
    const start = sourceToOutputSnapped(c.start, segs);
    const end = sourceToOutputSnapped(c.end, segs);
    if (end - start < 0.25) continue;
    const prev = out[out.length - 1];
    out.push({ start: prev ? Math.max(start, prev.end) : start, end, text: c.text });
  }
  return out;
}

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');

export function stamp(t: number, sep: '.' | ','): string {
  const ms = Math.round(Math.max(0, t) * 1000);
  const h = ms / 3_600_000;
  const m = (ms / 60_000) % 60;
  const s = (ms / 1000) % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`;
}

export function toVTT(cues: Cue[]): string {
  const body = cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}`).join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

export function toSRT(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}`).join('\n\n') + '\n';
}

/** 0:07, 4:32, 1:02:09 */
export function clock(t: number): string {
  const s = Math.max(0, Math.floor(t));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export interface OutputChapter {
  t: number;
  title: string;
}

/**
 * Chapters on the output timeline. Video platforms expect the first chapter at
 * 0:00, so one is added when the earliest marker starts later.
 */
export function chaptersToOutput(markers: Marker[], segs: Range[]): OutputChapter[] {
  const list = [...markers]
    .sort((a, b) => a.t - b.t)
    .map((m) => ({ t: sourceToOutputSnapped(m.t, segs), title: m.title.trim() || 'Chapter' }));
  const dedup: OutputChapter[] = [];
  for (const c of list) {
    const prev = dedup[dedup.length - 1];
    if (prev && c.t - prev.t < 1) continue;
    dedup.push(c);
  }
  if (dedup.length && dedup[0].t > 0.5) dedup.unshift({ t: 0, title: 'Intro' });
  else if (dedup.length) dedup[0].t = 0;
  return dedup;
}

export function chaptersText(chapters: OutputChapter[]): string {
  return chapters.map((c) => `${clock(c.t)} ${c.title}`).join('\n');
}

export interface TranscriptLine {
  t: number;
  text: string;
}

/** Kept transcript phrases on the output timeline. */
export function transcriptToOutput(segments: Segment[], segs: Range[]): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    const mid = (s.start + s.end) / 2;
    if (sourceToOutput(mid, segs) === null || !s.text.trim()) continue;
    out.push({ t: sourceToOutputSnapped(s.start, segs), text: s.text.trim() });
  }
  return out;
}

export function transcriptMarkdown(opts: {
  title: string;
  date: Date;
  duration: number;
  summary?: string;
  actionItems?: string[];
  chapters: OutputChapter[];
  lines: TranscriptLine[];
}): string {
  const parts = [`# ${opts.title}`, '', `${opts.date.toLocaleString()} · ${clock(opts.duration)}`];
  if (opts.summary) parts.push('', '## Summary', '', opts.summary);
  if (opts.actionItems?.length) parts.push('', '## Action items', '', ...opts.actionItems.map((a) => `- [ ] ${a}`));
  if (opts.chapters.length) parts.push('', '## Chapters', '', ...opts.chapters.map((c) => `- ${clock(c.t)} ${c.title}`));
  if (opts.lines.length) parts.push('', '## Transcript', '', ...opts.lines.map((l) => `**${clock(l.t)}** ${l.text}`).flatMap((l) => [l, '']));
  return parts.join('\n').trimEnd() + '\n';
}
