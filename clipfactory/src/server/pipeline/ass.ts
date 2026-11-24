import type { CaptionStyle, Word } from "../../lib/types.ts";

// Word-timed captions as an Advanced SubStation (.ass) file, burned in by
// FFmpeg's libass. One event per spoken word: the whole caption "page" stays
// on screen and the word being said pops in the accent colour.

export interface CaptionPlan {
  /** Words on the output timeline (after dead air was cut). */
  words: Word[];
  duration: number;
  style: CaptionStyle;
  width: number;
  height: number;
  /** Centre line for captions and the hook, in pixels. */
  captionY: number;
  hookY: number;
  font: string;
  accent: string;
  /** Highlight colour per speaker ("who's talking"); speaker 0 uses the first. */
  speakerColors?: string[];
  /** Colour of stressed words (Word.em), which stay lit for the whole page. */
  stress?: string;
  hook?: string;
  hookUntil?: number;
  /** Output-time span of the slow-motion replay, which gets a tag instead of captions. */
  replay?: { start: number; end: number; label: string };
  /** A headline in a white box across the top. */
  title?: { text: string; from: number; to: number; y: number };
  /** A thin bar along the top edge that fills up over the short. */
  progress?: { color: string };
  /** Your handle, small and see-through, for the whole short. */
  watermark?: string;
  /** Paid-promotion disclosure ("#ad"), top left for the whole short. */
  disclosure?: string;
}

export interface Page {
  words: Word[];
  s: number;
  e: number;
}

export function assColor(hex: string, alpha = 0): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H${alpha.toString(16).padStart(2, "0")}${b}${g}${r}`.toUpperCase();
}

export function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** Strip what libass would read as override tags or line breaks. */
export function assText(text: string): string {
  return text.replace(/[{}]/g, "").replace(/\\/g, "/").replace(/\s+/g, " ").trim();
}

/** Group words into short caption pages: ≤3 words, ≤16 characters, broken at pauses and sentence ends. */
export function paginate(words: Word[], maxWords = 3, maxChars = 16): Page[] {
  const pages: Page[] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) pages.push({ words: cur, s: cur[0].s, e: cur[cur.length - 1].e });
    cur = [];
  };
  for (const w of words) {
    const chars = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    const prev = cur[cur.length - 1];
    if (cur.length && (cur.length >= maxWords || chars > maxChars || (prev && w.s - prev.e > 0.45))) flush();
    cur.push(w);
    if (/[.!?…]["')\]]*$/.test(w.w)) flush();
  }
  flush();
  // Hold each page until the next one starts (up to 0.6 s) so text doesn't flicker.
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    pages[i].e = Math.round((next ? Math.min(next.s, pages[i].e + 0.6) : pages[i].e + 0.6) * 1000) / 1000;
  }
  return pages;
}

function lineBreak(tokens: string[], maxChars = 11): string {
  const total = tokens.join(" ").length;
  if (tokens.length < 2 || total <= maxChars) return tokens.join(" ");
  // Two lines, split where the halves are most even.
  let best = 1;
  let bestDiff = Infinity;
  for (let i = 1; i < tokens.length; i++) {
    const diff = Math.abs(tokens.slice(0, i).join(" ").length - tokens.slice(i).join(" ").length);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return `${tokens.slice(0, best).join(" ")}\\N${tokens.slice(best).join(" ")}`;
}

export function buildAss(plan: CaptionPlan): string {
  const { width: W, height: H, font, style } = plan;
  const upper = style !== "clean";
  // Anton's em box is tall, so these read about half as big as the number suggests.
  const size = style === "clean" ? Math.round(W * 0.095) : Math.round(W * 0.15);
  const hookSize = Math.round(W * 0.2);
  const outline = style === "clean" ? 5 : 8;
  const white = assColor("#ffffff");
  const black = assColor("#000000");
  const shadow = assColor("#000000", 0x60);
  const accent = assColor(plan.accent);
  const speakerAccent = (w: Word) => (w.sp !== undefined && plan.speakerColors?.length ? assColor(plan.speakerColors[w.sp % plan.speakerColors.length]) : accent);
  const cx = Math.round(W / 2);

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Word,${font},${size},${white},${accent},${black},${shadow},0,0,0,0,100,100,1,0,1,${outline},3,5,60,60,0,1`,
    `Style: Hook,${font},${hookSize},${white},${accent},${black},${shadow},0,0,0,0,100,100,1,0,1,10,4,5,50,50,0,1`,
    `Style: Tag,${font},${Math.round(W * 0.05)},${black},${black},${accent},${shadow},0,0,0,0,100,100,2,0,3,14,0,5,40,40,0,1`,
    `Style: Title,${font},${Math.round(W * 0.074)},${black},${black},${white},${assColor("#000000", 0xa0)},0,0,0,0,100,100,1,0,3,${Math.round(W * 0.02)},0,8,60,60,0,1`,
    `Style: Bar,${font},20,${white},${white},${black},${black},0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    `Style: Mark,${font},${Math.round(W * 0.036)},${assColor("#ffffff", 0x70)},${white},${assColor("#000000", 0x90)},${black},0,0,0,0,100,100,2,0,1,2,0,5,40,40,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const events: string[] = [];
  const ev = (layer: number, s: number, e: number, styleName: string, text: string) => {
    if (e - s < 0.02) return;
    events.push(`Dialogue: ${layer},${assTime(s)},${assTime(e)},${styleName},,0,0,0,,${text}`);
  };

  const hookUntil = plan.hook ? Math.min(plan.hookUntil ?? 2.2, plan.duration) : 0;
  if (plan.hook && hookUntil > 0) {
    const text = assText(plan.hook).toUpperCase();
    const ms = Math.round(hookUntil * 1000);
    ev(2, 0, hookUntil, "Hook", `{\\pos(${cx},${plan.hookY})\\fscx60\\fscy60\\t(0,140,\\fscx108\\fscy108)\\t(140,240,\\fscx100\\fscy100)\\fad(0,160)\\t(${ms - 300},${ms},\\fscx104\\fscy104)}${lineBreak(text.split(" "), 8)}`);
  }

  if (plan.replay) {
    ev(3, plan.replay.start, plan.replay.end, "Tag", `{\\pos(${cx},${Math.round(H * (plan.title ? 0.2 : 0.07))})}${assText(plan.replay.label)}`);
  }

  if (plan.title && plan.title.text.trim()) {
    const text = assText(plan.title.text).toUpperCase();
    ev(4, plan.title.from, plan.title.to, "Title", `{\\pos(${cx},${plan.title.y})\\fad(180,0)}${lineBreak(text.split(" "), 22)}`);
  }

  if (plan.watermark?.trim()) {
    // Low on the frame, clear of the captions and of the apps' own buttons along the bottom.
    ev(0, 0, plan.duration, "Mark", `{\\pos(${cx},${Math.round(H * 0.8)})}${assText(plan.watermark)}`);
  }

  if (plan.disclosure?.trim()) {
    ev(5, 0, plan.duration, "Tag", `{\\an7\\pos(${Math.round(W * 0.04)},${Math.round(H * (plan.title ? 0.135 : 0.03))})\\fscx70\\fscy70}${assText(plan.disclosure)}`);
  }

  if (plan.progress && plan.duration > 1) {
    const h = Math.max(6, Math.round(H * 0.0055));
    const bar = `m 0 0 l ${W} 0 ${W} ${h} 0 ${h}`;
    ev(5, 0, plan.duration, "Bar", `{\\an7\\pos(0,0)\\1c${black}\\1a&H80&\\p1}${bar}{\\p0}`);
    ev(6, 0, plan.duration, "Bar", `{\\an7\\pos(0,0)\\1c${assColor(plan.progress.color)}\\fscx0\\t(0,${Math.round(plan.duration * 1000)},\\fscx100)\\p1}${bar}{\\p0}`);
  }

  const words = plan.words.filter((w) => w.s >= hookUntil - 0.05 && w.e <= plan.duration + 0.05 && !(plan.replay && w.s >= plan.replay.start));
  const stress = plan.stress ? assColor(plan.stress) : null;
  const lit = (t: string, w: Word) => (stress && w.em ? `{\\c${stress}}${t}{\\c${white}}` : t);
  for (const page of paginate(words)) {
    const tokens = page.words.map((w) => assText(upper ? w.w.toUpperCase() : w.w));
    const end = plan.replay ? Math.min(page.e, plan.replay.start) : page.e;
    if (style === "clean") {
      ev(1, page.s, end, "Word", `{\\pos(${cx},${plan.captionY})}${joinWithBreak(tokens.map((t, k) => lit(t, page.words[k])), tokens)}`);
      continue;
    }
    page.words.forEach((w, i) => {
      const s = i === 0 ? page.s : w.s;
      const e = i === page.words.length - 1 ? end : page.words[i + 1].s;
      const parts = tokens.map((t, k) => {
        const color = speakerAccent(page.words[k]);
        if (style === "karaoke") return k <= i ? `{\\c${color}}${t}{\\c${white}}` : lit(t, page.words[k]);
        if (k !== i) return lit(t, page.words[k]);
        // The word being said pops; a stressed one pops harder.
        const pop = page.words[k].em ? 124 : 112;
        return `{\\c${color}\\fscx${pop}\\fscy${pop}\\t(0,${page.words[k].em ? 150 : 110},\\fscx100\\fscy100)}${t}{\\c${white}\\fscx100\\fscy100}`;
      });
      // First word of a page slides up a touch as the page appears.
      const enter = i === 0 ? `\\move(${cx},${plan.captionY + 18},${cx},${plan.captionY},0,90)` : `\\pos(${cx},${plan.captionY})`;
      ev(1, s, Math.min(e, end), "Word", `{${enter}}${joinWithBreak(parts, tokens)}`);
    });
  }
  return [...header, ...events, ""].join("\n");
}

/** Join styled tokens, inserting the same line break lineBreak() would choose for the plain text. */
function joinWithBreak(parts: string[], plain: string[]): string {
  const broken = lineBreak(plain);
  if (!broken.includes("\\N")) return parts.join(" ");
  const firstLine = broken.split("\\N")[0].split(" ").length;
  return `${parts.slice(0, firstLine).join(" ")}\\N${parts.slice(firstLine).join(" ")}`;
}

/** Map source-time words into output time, given the source ranges in output order (a cold open first, then the kept ranges). */
export function remapWords(words: Word[], keep: [number, number][]): Word[] {
  const out: Word[] = [];
  let offset = 0;
  for (const [a, b] of keep) {
    for (const w of words) {
      if (w.e <= a || w.s >= b) continue;
      const s = Math.max(w.s, a);
      const e = Math.min(w.e, b);
      // Words chopped mostly away by a cut are dropped.
      if (e - s < Math.min(0.08, (w.e - w.s) * 0.5)) continue;
      out.push({ w: w.w, s: Math.round((s - a + offset) * 1000) / 1000, e: Math.round((e - a + offset) * 1000) / 1000, ...(w.sp !== undefined ? { sp: w.sp } : {}), ...(w.em ? { em: true } : {}) });
    }
    offset += b - a;
  }
  return out;
}
