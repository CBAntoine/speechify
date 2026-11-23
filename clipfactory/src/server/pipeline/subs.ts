import type { Transcript, Word } from "../../lib/types.ts";

// Turn subtitle files into word timings, for when no Whisper engine is
// installed: YouTube's own captions (json3, from yt-dlp) or a sidecar
// .srt/.vtt next to a local file.

interface Json3 {
  events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[];
}

function segmentsFrom(words: Word[]): Transcript["segments"] {
  const segments: Transcript["segments"] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (!cur.length) return;
    segments.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map((w) => w.w).join(" ") });
    cur = [];
  };
  for (const w of words) {
    if (cur.length && (w.s - cur[cur.length - 1].e > 0.8 || cur.length >= 18)) flush();
    cur.push(w);
    if (/[.!?]$/.test(w.w)) flush();
  }
  flush();
  return segments;
}

function tidy(words: Word[]): Word[] {
  const out: Word[] = [];
  for (const w of words.sort((a, b) => a.s - b.s)) {
    const text = w.w.replace(/\s+/g, " ").trim();
    if (!text || /^\[.*\]$/.test(text)) continue; // [Music], [Applause]
    const prev = out[out.length - 1];
    if (prev && prev.e > w.s) prev.e = Math.max(prev.s + 0.05, w.s);
    out.push({ w: text, s: round(w.s), e: round(Math.max(w.e, w.s + 0.05)) });
  }
  return out;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function parseJson3(text: string): Word[] {
  const data = JSON.parse(text) as Json3;
  const words: Word[] = [];
  for (const ev of data.events ?? []) {
    if (!ev.segs || ev.tStartMs === undefined) continue;
    const start = ev.tStartMs / 1000;
    const end = (ev.tStartMs + (ev.dDurationMs ?? 0)) / 1000;
    const segs = ev.segs.filter((s) => (s.utf8 ?? "").trim());
    segs.forEach((s, i) => {
      const s0 = start + (s.tOffsetMs ?? 0) / 1000;
      const next = segs[i + 1];
      const e0 = next ? start + (next.tOffsetMs ?? 0) / 1000 : end;
      for (const part of (s.utf8 ?? "").trim().split(/\s+/)) {
        if (part) words.push({ w: part, s: s0, e: Math.max(s0 + 0.05, e0) });
      }
    });
  }
  return tidy(words);
}

function clockToSec(t: string): number {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/.exec(t.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

/** SRT or WebVTT, including YouTube's inline <00:00:01.240><c> word</c> timings. */
export function parseCues(text: string): Word[] {
  const words: Word[] = [];
  const blocks = text.replace(/\r/g, "").split(/\n\s*\n/);
  let lastLine = "";
  for (const block of blocks) {
    const lines = block.split("\n").filter(Boolean);
    const timing = lines.findIndex((l) => l.includes("-->"));
    if (timing < 0) continue;
    const [a, b] = lines[timing].split("-->");
    const start = clockToSec(a);
    const end = clockToSec(b.trim().split(/\s+/)[0]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const body = lines.slice(timing + 1).join(" ");
    if (/<\d{2}:\d{2}[:.]/.test(body)) {
      // Inline word timings.
      const parts = body.split(/<(\d{2}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})>/);
      let t = start;
      for (let i = 0; i < parts.length; i++) {
        if (i % 2 === 1) {
          t = clockToSec(parts[i]);
          continue;
        }
        const clean = parts[i].replace(/<[^>]+>/g, "").trim();
        if (!clean) continue;
        const nextT = i + 1 < parts.length ? clockToSec(parts[i + 1]) : end;
        const chunk = clean.split(/\s+/);
        const step = (Math.max(nextT, t + 0.05) - t) / chunk.length;
        chunk.forEach((w, k) => words.push({ w, s: t + k * step, e: t + (k + 1) * step }));
      }
      continue;
    }
    const clean = body.replace(/<[^>]+>/g, "").replace(/\{[^}]*\}/g, "").trim();
    // Rolling captions repeat the previous line; only keep what's new.
    const fresh = clean.startsWith(lastLine) && lastLine ? clean.slice(lastLine.length).trim() : clean;
    lastLine = clean;
    const chunk = fresh.split(/\s+/).filter(Boolean);
    if (!chunk.length) continue;
    const step = (end - start) / chunk.length;
    chunk.forEach((w, k) => words.push({ w, s: start + k * step, e: start + (k + 1) * step }));
  }
  return tidy(words);
}

export function transcriptFromSubs(text: string, kind: "json3" | "vtt" | "srt", engine: string, language?: string): Transcript {
  const words = kind === "json3" ? parseJson3(text) : parseCues(text);
  return { engine, language, words, segments: segmentsFrom(words) };
}
