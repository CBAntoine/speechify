// Short on-screen caption phrases for the Filmer's vertical videos.
//
// With ElevenLabs' /v1/text-to-speech/{voice}/with-timestamps we get the
// start and end of every character, so captions land exactly on the words.
// Without timestamps (system voice, silent demo videos) the script is spread
// over the duration by word length, with pauses at punctuation.

export interface Caption {
  text: string;
  start: number;
  end: number;
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

interface Word {
  text: string;
  start: number;
  end: number;
}

const BREAK_AFTER = /[.,!?;:…—–]["'”’)]*$/;
const MAX_CHARS = 22;
const ORPHAN_MAX_CHARS = 28;
const GAP_BREAK = 0.35;

/** Speakable word, or "" for audio tags like [excited] and stray symbols. */
function cleanWord(w: string): string {
  if (/^\[[^\]]*\]$/.test(w)) return "";
  return w.replace(/\[[^\]]*\]/g, "").trim();
}

function hasLetterOrDigit(w: string): boolean {
  return /[\p{L}\p{N}]/u.test(w);
}

/** How a phrase is shown: no trailing commas or full stops, single spaces. */
function display(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .replace(/[,.;:…—–]+(["'”’)]*)$/u, "$1")
    .trim();
}

function pushWord(words: Word[], raw: string, start: number, end: number) {
  const text = cleanWord(raw);
  if (!text) return;
  const prev = words[words.length - 1];
  if (!hasLetterOrDigit(text)) {
    // A lone dash or ellipsis belongs to the word before it.
    if (prev) {
      prev.text += text;
      prev.end = Math.max(prev.end, end);
    }
    return;
  }
  words.push({ text, start, end: Math.max(end, start) });
}

function wordsFromAlignment(a: Alignment): Word[] {
  const words: Word[] = [];
  const n = Math.min(a.characters?.length ?? 0, a.character_start_times_seconds?.length ?? 0, a.character_end_times_seconds?.length ?? 0);
  let cur = "";
  let start = 0;
  let end = 0;
  let inTag = false;
  for (let i = 0; i < n; i++) {
    const ch = a.characters[i];
    const s = Number(a.character_start_times_seconds[i]) || 0;
    const e = Number(a.character_end_times_seconds[i]) || s;
    if (ch === "[") inTag = true;
    if (inTag) {
      if (ch === "]") inTag = false;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) pushWord(words, cur, start, end);
      cur = "";
      continue;
    }
    if (!cur) start = s;
    cur += ch;
    end = e;
  }
  if (cur) pushWord(words, cur, start, end);
  return words;
}

function group(words: Word[], maxWords: number): Caption[] {
  const out: Caption[] = [];
  let buf: Word[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = display(buf.map((w) => w.text).join(" "));
    if (text) out.push({ text, start: buf[0].start, end: buf[buf.length - 1].end });
    buf = [];
  };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    const limit = buf.length >= maxWords ? ORPHAN_MAX_CHARS : MAX_CHARS;
    if (buf.length && [...buf, w].map((x) => x.text).join(" ").length > limit) flush();
    buf.push(w);
    const gap = next ? next.start - w.end : 0;
    if (buf.length >= maxWords || BREAK_AFTER.test(w.text) || gap > GAP_BREAK) {
      // Don't strand one word before a pause: "Hey Bright Smile | Dental." reads badly.
      const orphan =
        buf.length >= maxWords &&
        !BREAK_AFTER.test(w.text) &&
        gap <= GAP_BREAK &&
        next !== undefined &&
        BREAK_AFTER.test(next.text) &&
        [...buf, next].map((x) => x.text).join(" ").length <= ORPHAN_MAX_CHARS;
      if (!orphan) flush();
    }
  }
  flush();

  // Keep a phrase on screen until the next one starts (short gaps only), give
  // every phrase time to be read, and never let two overlap.
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const n = out[i + 1];
    if (n && n.start - c.end < 0.45) c.end = n.start;
    if (!n) c.end += 0.25;
    if (c.end - c.start < 0.3) c.end = c.start + 0.3;
    if (n && c.end > n.start) c.end = Math.max(c.start + 0.15, n.start);
    c.start = round(c.start);
    c.end = round(c.end);
  }
  return out;
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Group ElevenLabs character timings into phrases of at most maxWords words. */
export function captionsFromAlignment(a: Alignment, maxWords = 3): Caption[] {
  return group(wordsFromAlignment(a), Math.max(1, maxWords));
}

/** Spread a script over durationSec (no timestamps available). */
export function captionsFromText(script: string, durationSec: number, maxWords = 3): Caption[] {
  const tokens = script
    .split(/\s+/)
    .map(cleanWord)
    .filter(Boolean);
  const words: { text: string; speak: number; pause: number }[] = [];
  for (const t of tokens) {
    if (!hasLetterOrDigit(t)) {
      const prev = words[words.length - 1];
      if (prev) {
        prev.text += t;
        prev.pause += 1.5;
      }
      continue;
    }
    const letters = (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
    const pause = /[.!?…]["'”’)]*$/.test(t) ? 3.5 : /[,;:—–]["'”’)]*$/.test(t) ? 1.8 : 0;
    words.push({ text: t, speak: 1.2 + letters, pause });
  }
  if (!words.length || !(durationSec > 0)) return [];
  const lead = Math.min(0.2, durationSec * 0.03);
  const tail = Math.min(0.3, durationSec * 0.04);
  const usable = Math.max(0.1, durationSec - lead - tail);
  // The last word's pause is not spoken.
  const total = words.reduce((s, w, i) => s + w.speak + (i < words.length - 1 ? w.pause : 0), 0);
  const unit = usable / total;
  const timed: Word[] = [];
  let t = lead;
  words.forEach((w, i) => {
    const start = t;
    const end = start + w.speak * unit;
    timed.push({ text: w.text, start, end });
    t = end + (i < words.length - 1 ? w.pause * unit : 0);
  });
  const caps = group(timed, Math.max(1, maxWords));
  for (const c of caps) c.end = Math.min(c.end, round(durationSec));
  return caps.filter((c) => c.end > c.start);
}
