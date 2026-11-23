// Audience signals: where viewers actually reacted. YouTube's "Most replayed"
// heatmap, live-chat replay (message rate, laughs, hype, "clip it"), and
// comments that cite a timestamp ("12:31 I can't breathe"). Professional
// clippers check exactly these by hand; generic tools that only read the
// transcript can't.

export interface Signals {
  /** Seconds of the VOD covered (array length). */
  duration: number;
  /** 0..1 per second, from YouTube's "Most replayed" graph. */
  replay?: number[];
  /** Chat messages per second. */
  chat?: number[];
  /** Weighted reactions per second: laughs, hype, "clip it", super chats. */
  react?: number[];
  /** A few chat lines per second, for the orchestrator to read. */
  samples?: Record<number, string[]>;
  /** Comments that cite a moment. */
  mentions?: { t: number; likes: number; text: string }[];
  chapters?: { start: number; end: number; title: string }[];
  /** Human summary: what was found. */
  sources: string[];
}

const LAUGH = /\b(lu+l+|lmf?a+o+|kekw|omegalul|lol+|haha+|xd+|icant|i can'?t|dead|crying|ded)\b|😂|🤣|💀|😭/i;
const HYPE = /\b(pog+(gers|champ)?|poggies|let'?s go+|lets go+|no way|omg|wtf|holy|insane|clean|clutch|ez|gg|sheesh|w+|hype|fire)\b|🔥|😱|😳|🤯|‼|!{2,}/i;
const CLIP = /\bclip(ped)? (it|that|this)\b|^clip\b|\bclip!+|\bclippers?\b/i;
const FAIL = /\b(f|rip|l+|oof|unlucky|throw(ing)?|sell(ing)?)\b|🤦/i;

/** Weight of one chat line as a reaction. */
export function reactionWeight(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  let w = 0;
  if (CLIP.test(t)) w += 4;
  if (LAUGH.test(t)) w += 1.5;
  if (HYPE.test(t)) w += 1.2;
  if (FAIL.test(t)) w += 0.8;
  if (t.length >= 4 && t === t.toUpperCase() && /[A-Z]/.test(t)) w += 0.6;
  return w;
}

/** yt-dlp's info.json "heatmap": [{start_time, end_time, value}] → 0..1 per second. */
export function parseHeatmap(info: { heatmap?: { start_time: number; end_time: number; value: number }[] } | null, duration: number): number[] | undefined {
  const marks = info?.heatmap;
  if (!Array.isArray(marks) || !marks.length) return undefined;
  const secs = Math.max(1, Math.ceil(duration));
  const out = new Array<number>(secs).fill(0);
  for (const m of marks) {
    const a = Math.max(0, Math.floor(m.start_time));
    const b = Math.min(secs, Math.ceil(m.end_time));
    for (let i = a; i < b; i++) out[i] = Math.max(out[i], Math.max(0, Math.min(1, Number(m.value) || 0)));
  }
  return out;
}

interface ChatRun {
  text?: string;
  emoji?: { emojiId?: string; shortcuts?: string[] };
}

function runsText(runs: ChatRun[] | undefined): string {
  return (runs ?? []).map((r) => r.text ?? (r.emoji?.emojiId && !r.emoji.emojiId.includes("/") && [...r.emoji.emojiId].length <= 2 ? r.emoji.emojiId : (r.emoji?.shortcuts?.[0] ?? ""))).join("");
}

/**
 * yt-dlp's live_chat.json: one JSON action per line, each with a
 * replayChatItemAction holding the messages and videoOffsetTimeMsec.
 */
export function parseLiveChat(text: string, duration: number): { chat: number[]; react: number[]; samples: Record<number, string[]>; messages: number } {
  const secs = Math.max(1, Math.ceil(duration));
  const chat = new Array<number>(secs).fill(0);
  const react = new Array<number>(secs).fill(0);
  const samples: Record<number, string[]> = {};
  let messages = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: Record<string, any>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const replay = o.replayChatItemAction ?? {};
    const ms = Number(replay.videoOffsetTimeMsec ?? o.videoOffsetTimeMsec);
    if (!Number.isFinite(ms)) continue;
    const sec = Math.floor(ms / 1000);
    if (sec < 0 || sec >= secs) continue;
    for (const a of replay.actions ?? []) {
      const item = a?.addChatItemAction?.item ?? {};
      const msg = item.liveChatTextMessageRenderer ?? item.liveChatPaidMessageRenderer;
      if (!msg) continue;
      const body = runsText(msg.message?.runs);
      messages++;
      chat[sec] += 1;
      react[sec] += reactionWeight(body) + (item.liveChatPaidMessageRenderer ? 3 : 0);
      if (body && (samples[sec]?.length ?? 0) < 4 && body.length <= 80) (samples[sec] ??= []).push(body);
    }
  }
  return { chat, react, samples, messages };
}

/** "12:31", "1:02:03" anywhere in a comment → seconds. */
export function commentMentions(comments: { text?: string; like_count?: number }[] | undefined, duration: number): { t: number; likes: number; text: string }[] {
  const out: { t: number; likes: number; text: string }[] = [];
  for (const c of comments ?? []) {
    const text = c.text ?? "";
    for (const m of text.matchAll(/(?<![\d:])(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?![\d:])/g)) {
      const t = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      if (t > 0 && t < duration) out.push({ t, likes: Math.max(0, c.like_count ?? 0), text: text.replace(/\s+/g, " ").slice(0, 120) });
    }
  }
  return out.sort((a, b) => b.likes - a.likes).slice(0, 200);
}

/** Viewers react a few seconds after the moment (stream delay + typing). */
export const CHAT_DELAY = 5;

function z(xs: number[]): number[] {
  if (!xs.length) return [];
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1;
  return xs.map((x) => (x - mean) / sd);
}

function smooth(xs: number[], r: number): number[] {
  return xs.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - r); k <= Math.min(xs.length - 1, i + r); k++) {
      s += xs[k];
      n++;
    }
    return n ? s / n : 0;
  });
}

/**
 * One audience-interest value per second (a z-score; 0 when there are no
 * signals): chat activity and reactions shifted back to when it happened,
 * replays, and comment mentions.
 */
export function audienceScore(s: Signals | null | undefined, duration: number): number[] {
  const secs = Math.max(1, Math.ceil(duration));
  const total = new Array<number>(secs).fill(0);
  if (!s) return total;
  const add = (values: number[], weight: number, shift = 0) => {
    const zs = z(smooth(values, 3));
    for (let i = 0; i < secs; i++) total[i] += weight * (zs[i + shift] ?? 0);
  };
  if (s.chat?.some((v) => v > 0)) add(s.chat, 0.35, CHAT_DELAY);
  if (s.react?.some((v) => v > 0)) add(s.react, 0.6, CHAT_DELAY);
  if (s.replay?.some((v) => v > 0)) add(s.replay, 0.8);
  if (s.mentions?.length) {
    const m = new Array<number>(secs).fill(0);
    for (const x of s.mentions) for (let k = Math.max(0, Math.floor(x.t) - 2); k <= Math.min(secs - 1, Math.floor(x.t) + 8); k++) m[k] += 1 + Math.log1p(x.likes);
    add(m, 0.5);
  }
  return total;
}

/** The strongest audience moments, as text lines the orchestrator can read. */
export function describeSignals(s: Signals, max = 30): string {
  const lines: string[] = [];
  const stamp = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const ss = String(Math.floor(sec % 60)).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
  };
  if (s.replay?.length) {
    const peaks = s.replay
      .map((v, i) => ({ i, v }))
      .filter(({ i, v }) => v >= 0.55 && v >= (s.replay![i - 1] ?? 0) && v >= (s.replay![i + 1] ?? 0))
      .sort((a, b) => b.v - a.v)
      .filter((p, k, arr) => !arr.slice(0, k).some((q) => Math.abs(q.i - p.i) < 20))
      .slice(0, 12);
    if (peaks.length) lines.push(`Most replayed (YouTube, 0–1): ${peaks.map((p) => `${stamp(p.i)} (${p.v.toFixed(2)})`).join(", ")}`);
  }
  if (s.react?.some((v) => v > 0)) {
    const win = 10;
    const windows: { t: number; score: number; msgs: number }[] = [];
    for (let i = 0; i < s.react.length; i += win) {
      let score = 0;
      let msgs = 0;
      for (let k = i; k < i + win && k < s.react.length; k++) {
        score += s.react[k];
        msgs += s.chat?.[k] ?? 0;
      }
      windows.push({ t: i, score, msgs });
    }
    const top = windows.sort((a, b) => b.score - a.score).slice(0, max).filter((w) => w.score > 0);
    if (top.length) {
      lines.push(`Chat spikes (time = when chat reacted; the moment is usually ${CHAT_DELAY}–10 s earlier):`);
      for (const w of top.sort((a, b) => a.t - b.t)) {
        const said: string[] = [];
        for (let k = w.t; k < w.t + win && said.length < 4; k++) said.push(...(s.samples?.[k] ?? []).slice(0, 2));
        lines.push(`- ${stamp(w.t)}: ${w.msgs} msgs, reaction ${w.score.toFixed(0)}${said.length ? ` — ${said.slice(0, 4).map((x) => JSON.stringify(x)).join(", ")}` : ""}`);
      }
    }
  }
  if (s.mentions?.length) {
    lines.push("Viewer comments citing a time:");
    for (const m of s.mentions.slice(0, 15)) lines.push(`- ${stamp(m.t)} (${m.likes} likes): ${JSON.stringify(m.text)}`);
  }
  if (s.chapters?.length) lines.push(`Chapters: ${s.chapters.map((c) => `${stamp(c.start)} ${c.title}`).join(" | ")}`);
  return lines.join("\n");
}
