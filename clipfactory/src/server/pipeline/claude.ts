import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Word } from "../../lib/types.ts";
import type { MomentPick } from "./heuristics.ts";

// The orchestrator: Claude reads the transcript and the loudness spikes and
// picks the moments worth a short, with a hook, a title and the climax.

export function claudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function claudeModel(): string {
  return process.env.CLAUDE_MODEL || "claude-opus-5-5";
}

/** "claude-opus-5-5" → "OPUS 5.5" */
export function modelLabel(model = claudeModel()): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return model.toUpperCase();
  return `${m[1].toUpperCase()} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

let client: Anthropic | null = null;
function claude(): Anthropic {
  client ??= new Anthropic();
  return client;
}

/** Server-side refusal fallback: if the model declines, the API retries on a fallback model inside the same call. */
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

// Per million tokens, for the cost shown in the dashboard.
const PRICE: Record<string, { input: number; output: number }> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export class RefusalError extends Error {}

export function describeError(err: unknown): string {
  if (err instanceof RefusalError) return err.message;
  if (err instanceof Anthropic.AuthenticationError) return "Claude rejected the API key. Check ANTHROPIC_API_KEY.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that model.";
  if (err instanceof Anthropic.NotFoundError) return `Claude couldn't find the model ${claudeModel()}. Check CLAUDE_MODEL.`;
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate limiting this key. Try again in a minute.";
  if (err instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${err.message}`;
  if (err instanceof Anthropic.InternalServerError) return "Claude had a server error.";
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "The request to Claude timed out.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude. Check the internet connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status ?? ""}: ${err.message}`.trim();
  return err instanceof Error ? err.message : String(err);
}

function cost(model: string, usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null } | undefined): number {
  const p = PRICE[model] ?? PRICE["claude-opus-5-5"];
  if (!usage) return 0;
  const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * p.input + (usage.output_tokens ?? 0) * p.output) / 1e6;
}

// No numeric limits in the schema: structured outputs can't enforce them, so
// they're stated in the prompt and checked after parsing.
const MomentsSchema = z.object({
  moments: z.array(
    z.object({
      start: z.number(),
      end: z.number(),
      replay_at: z.number(),
      score: z.number(),
      category: z.string(),
      hook: z.string(),
      headline: z.string(),
      title: z.string(),
      reason: z.string(),
      description: z.string(),
      hashtags: z.array(z.string()),
      emphasis: z.array(z.string()),
      use_teaser: z.boolean(),
      teaser_start: z.number(),
      teaser_end: z.number(),
    }),
  ),
});

const SYSTEM = `You are the orchestrator of a clip factory that turns long gameplay livestream VODs into vertical shorts for YouTube Shorts, TikTok and Reels.

You get a timestamped transcript of the stream and the moments where the audio spikes (screams, laughter, explosions). Pick the moments that will hold a stranger's attention on a phone with the sound on.

What makes a moment:
- A clear setup and a payoff inside the clip: a fail, a clutch play, a chase, a reveal, a big reaction, a joke that lands.
- The streamer's reaction matters as much as the gameplay. Audio spikes with excited speech are strong signals.
- It must make sense without the rest of the stream.

How to cut it:
- Start a second or two before the setup, on the start of a sentence. Never start mid-word.
- End right after the payoff and the reaction; don't trail off.
- replay_at is the second of the climax, the frame worth replaying in slow motion.

Audience signals, when given, are the strongest evidence you have: chat spikes (laughs, hype, people typing "clip it"), the parts viewers replayed most, and comments that cite a time. Chat reacts a few seconds after the moment, so the moment itself starts earlier. Prefer moments the audience reacted to, and make sure the clip includes the cause of the reaction, not just the aftermath.

Cold open: if the payoff is a sudden, visual or loud beat (a crash, a kill, a scream, a reveal) and the build-up is longer than a few seconds, set use_teaser and give teaser_start/teaser_end: 1–2.5 s of the payoff, inside the clip. The short opens on it, then rewinds to the setup. Don't tease conversations, slow reveals or jokes whose punch line needs the setup.

Writing:
- hook: 1 to 3 words in capitals ending in "." or "!" — the punch line on screen, like "FULL SEND." or "GOT HIM." It must describe what really happens or what is really said.
- headline: up to 6 words for a title bar across the top, a curiosity gap that the clip pays off ("He trusted the wrong driver"). Honest, no emojis.
- emphasis: 3–8 words that carry the moment, copied exactly as they appear in the transcript (names, numbers, the reaction words). They get highlighted in the captions.
- category: one word: fail, clutch, funny, reaction, rage, skill, chaos, story or wholesome.
- title: up to 70 characters, plain and specific, no clickbait the clip doesn't deliver.
- description: one or two sentences for the post.
- hashtags: 3 to 6, lowercase, no "#".
- reason: one sentence on why this moment works, citing what is said or heard.

Only use what the transcript and the signals support. Never invent events, names or quotes.`;

export interface ClaudeMomentInput {
  sourceTitle: string;
  uploader?: string;
  duration: number;
  words: Word[];
  segments: { s: number; e: number; text: string }[];
  spikes: { t: number; db: number }[];
  /** Chat spikes, most replayed, timestamped comments (describeSignals). */
  audience?: string;
  count: number;
  /** How many candidates to return (more than count when they'll be watched and narrowed). */
  candidates?: number;
  minSec: number;
  maxSec: number;
  instructions?: string;
  onProgress?: (phase: "thinking" | "writing", chars: number) => void;
  signal?: AbortSignal;
}

function stamp(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = (s % 60).toFixed(1).padStart(4, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

export async function claudeMoments(input: ClaudeMomentInput): Promise<{ picks: MomentPick[]; usd: number; model: string }> {
  const model = claudeModel();
  const transcript = input.segments.map((s) => `[${stamp(s.s)}–${stamp(s.e)}] ${s.text}`).join("\n");
  const spikes = input.spikes.map((s) => `${stamp(s.t)} (+${s.db.toFixed(0)} dB)`).join(", ");
  const user = [
    `Stream: ${input.sourceTitle || "untitled"}${input.uploader ? ` by ${input.uploader}` : ""}`,
    `Length: ${stamp(input.duration)} (${Math.round(input.duration)} s)`,
    `Pick the ${input.candidates ?? input.count} best moments, best first. Each must be ${input.minSec}–${input.maxSec} seconds long, and they must not overlap.`,
    "Give start, end and replay_at in seconds from the start of the stream.",
    input.instructions ? `Direction from the creator: ${input.instructions}` : "",
    "",
    `<audio_spikes>\n${spikes || "none detected"}\n</audio_spikes>`,
    input.audience ? `\n<audience_signals>\n${input.audience}\n</audience_signals>` : "",
    "",
    `<transcript>\n${transcript}\n</transcript>`,
  ]
    .filter((l) => l !== "")
    .join("\n");

  const stream = claude().beta.messages.stream(
    {
      model,
      max_tokens: 32000,
      ...FALLBACK,
      output_config: { effort: "high", format: betaZodOutputFormat(MomentsSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    },
    { signal: input.signal },
  );
  let chars = 0;
  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "thinking") input.onProgress?.("thinking", chars);
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      chars += event.delta.text.length;
      input.onProgress?.("writing", chars);
    }
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new RefusalError("Claude declined to pick moments from this transcript.");
  if (final.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off.");
  const parsed = final.parsed_output;
  if (!parsed) throw new Error("Claude's answer didn't match the moments format.");

  const picks: MomentPick[] = [];
  for (const m of parsed.moments) {
    let start = Math.max(0, Math.min(m.start, input.duration));
    let end = Math.max(0, Math.min(m.end, input.duration));
    if (end < start) [start, end] = [end, start];
    if (end - start < input.minSec) end = Math.min(input.duration, start + input.minSec);
    if (end - start > input.maxSec) end = start + input.maxSec;
    if (end - start < 3) continue;
    if (picks.some((p) => start < p.end && end > p.start)) continue;
    const hook = m.hook.trim().toUpperCase().split(/\s+/).slice(0, 3).join(" ");
    const ts = Math.max(start, Math.min(m.teaser_start, m.teaser_end));
    const te = Math.min(end, Math.max(m.teaser_start, m.teaser_end));
    picks.push({
      start,
      end,
      score: Math.round(Math.min(100, Math.max(0, m.score))),
      hook: /[.!?]$/.test(hook) ? hook : `${hook}.`,
      title: m.title.trim().slice(0, 100),
      reason: m.reason.trim(),
      description: m.description.trim(),
      hashtags: m.hashtags.map((h) => h.replace(/^#/, "").trim().toLowerCase()).filter(Boolean).slice(0, 8),
      replayAt: Math.min(end - 0.5, Math.max(start + 0.5, m.replay_at)),
      teaser: m.use_teaser && te - ts >= 0.6 && te - ts <= 3.5 ? [ts, te] : undefined,
      emphasis: m.emphasis.map((w) => w.trim()).filter(Boolean).slice(0, 10),
      headline: m.headline.trim().replace(/[.]+$/, "").slice(0, 60) || undefined,
      category: m.category.trim().toLowerCase().slice(0, 20) || undefined,
    });
    if (picks.length >= (input.candidates ?? input.count)) break;
  }
  return { picks, usd: cost(model, final.usage), model };
}

const WatchSchema = z.object({
  ratings: z.array(z.object({ id: z.number(), score: z.number(), keep: z.boolean(), note: z.string() })),
});

export interface WatchCandidate {
  id: number;
  title: string;
  start: number;
  end: number;
  transcript: string;
  /** JPEG contact sheet: frames across the clip, left to right, top to bottom. */
  sheet: Buffer;
}

/**
 * Claude looks at every candidate (a contact sheet of frames plus what is
 * said) and rates how well it would hold a viewer, so the final picks are
 * judged on the picture too, not only the transcript.
 */
export async function claudeWatch(cands: WatchCandidate[], signal?: AbortSignal): Promise<{ ratings: Map<number, { score: number; keep: boolean; note: string }>; usd: number }> {
  const model = claudeModel();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const cand of cands) {
    content.push({ type: "text", text: `Candidate ${cand.id}: "${cand.title}" (${stamp(cand.start)}–${stamp(cand.end)})\nSaid: ${cand.transcript.slice(0, 600) || "(nothing)"}` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: cand.sheet.toString("base64") } });
  }
  content.push({
    type: "text",
    text: "Rate every candidate 0–100 for how well it would stop a viewer scrolling on a phone and hold them to the end. Judge the pictures and what is said together: visible action or a clear reaction, gameplay you can read on a small screen, a story that makes sense on its own. Set keep=false for clips that are mostly menus, loading screens, black or frozen frames, a static screen with nothing happening, or that make no sense without context. note: one short sentence on what you see.",
  });
  const stream = claude().beta.messages.stream(
    {
      model,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: "medium", format: betaZodOutputFormat(WatchSchema) },
      system: "You are the quality editor of a clip factory that makes vertical gaming shorts. Each image is a contact sheet of six frames across one candidate clip, left to right, top to bottom.",
      messages: [{ role: "user", content }],
    },
    { signal },
  );
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new RefusalError("Claude declined to rate these clips.");
  if (!final.parsed_output) throw new Error("Claude's ratings didn't match the expected format.");
  const ratings = new Map<number, { score: number; keep: boolean; note: string }>();
  for (const r of final.parsed_output.ratings) ratings.set(r.id, { score: Math.round(Math.min(100, Math.max(0, r.score))), keep: r.keep, note: r.note.trim() });
  return { ratings, usd: cost(model, final.usage) };
}

const TranslationSchema = z.object({ lines: z.array(z.object({ i: z.number(), text: z.string() })) });

const LANG_NAMES: Record<string, string> = { es: "Spanish", de: "German", ja: "Japanese", fr: "French", pt: "Portuguese", it: "Italian", ko: "Korean", zh: "Chinese", en: "English", hi: "Hindi", ru: "Russian", tr: "Turkish" };

export function languageName(code: string): string {
  return LANG_NAMES[code] ?? code;
}

/** Translate caption lines for a dub, keeping each line about as long to say as the original. */
export async function translateLines(lines: { i: number; text: string; seconds: number }[], lang: string, signal?: AbortSignal): Promise<{ lines: { i: number; text: string }[]; usd: number }> {
  const model = claudeModel();
  const stream = claude().beta.messages.stream(
    {
      model,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: "low", format: betaZodOutputFormat(TranslationSchema) },
      system:
        "You translate gaming livestream speech for dubbing. Keep the meaning, the energy and the slang natural for gamers in the target language. Each translated line must take about as long to say as the original (the seconds are given), so prefer short wording. Keep names and game terms. Return every line with its i.",
      messages: [
        {
          role: "user",
          content: `Translate into ${languageName(lang)}.\n\n${lines.map((l) => `${l.i}\t(${l.seconds.toFixed(1)} s)\t${l.text}`).join("\n")}`,
        },
      ],
    },
    { signal },
  );
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new RefusalError("Claude declined to translate these lines.");
  if (!final.parsed_output) throw new Error("Claude's translation didn't match the expected format.");
  return { lines: final.parsed_output.lines, usd: cost(model, final.usage) };
}
