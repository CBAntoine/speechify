import { PRICES, eleven as cfg, keys } from "../config.ts";
import { addCost } from "../db.ts";
import type { AgentId } from "../types.ts";
import { sleep } from "../util.ts";

// ElevenLabs is the crew's one media provider: the narrator's voice (with
// word timestamps for captions), hero images (Image & Video API), the
// credit balance the Checker reads, and Atlas, the voice agent. The key stays
// on the server; browsers get one-conversation tokens.

export class ElevenError extends Error {
  status: number;
  detail?: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function explain(status: number, detail: unknown): string {
  const d = detail as { detail?: { message?: string } | { msg?: string }[] | string; message?: string } | undefined;
  const raw =
    typeof d?.detail === "string"
      ? d.detail
      : Array.isArray(d?.detail)
        ? d.detail.map((x) => x.msg).filter(Boolean).join("; ")
        : ((d?.detail as { message?: string } | undefined)?.message ?? d?.message);
  if (status === 401) return "ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY and its permissions.";
  if (status === 402) return `Your ElevenLabs plan doesn't include this${raw ? `: ${raw}` : ""}. Images need the Pro plan or above.`;
  if (status === 403) return `The ElevenLabs key isn't allowed to do this${raw ? `: ${raw}` : ""}.`;
  if (status === 429) return "ElevenLabs is rate limiting or out of credits.";
  return raw ? `ElevenLabs: ${raw}` : `ElevenLabs error ${status}`;
}

export function elevenEnabled(): boolean {
  return Boolean(keys.eleven);
}

export async function elevenJson<T = Record<string, unknown>>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  if (!keys.eleven) throw new ElevenError("Add ELEVENLABS_API_KEY to .env to turn on voice, images and Atlas.", 400);
  const res = await fetch(`${cfg.api}${path}`, {
    method,
    headers: { "xi-api-key": keys.eleven, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 204) return {} as T;
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new ElevenError(explain(res.status, data), res.status, data);
  return data;
}

async function elevenBytes(path: string, body: unknown, timeoutMs = 90_000): Promise<Buffer> {
  if (!keys.eleven) throw new ElevenError("Add ELEVENLABS_API_KEY to .env.", 400);
  const res = await fetch(`${cfg.api}${path}`, {
    method: "POST",
    headers: { "xi-api-key": keys.eleven, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => undefined);
    throw new ElevenError(explain(res.status, detail), res.status, detail);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ── Voiceover ────────────────────────────────────────────────────────────

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

const TTS_FALLBACK_MODEL = "eleven_multilingual_v2";

/** Speech plus character timings for captions. Falls back to plain speech when timestamps aren't available. */
export async function speak(text: string, opts: { voiceId?: string; agent: AgentId; leadId?: string }): Promise<{ audio: Buffer; alignment?: Alignment; model: string }> {
  const voice = encodeURIComponent(opts.voiceId || cfg.voiceoverVoice);
  const record = (model: string) =>
    addCost({ provider: "elevenlabs", agent: opts.agent, leadId: opts.leadId, usd: text.length * PRICES.elevenPerChar, units: text.length, unit: "characters", note: `tts ${model}` });
  const withTimestamps = async (model: string) => {
    const r = await elevenJson<{ audio_base64?: string; alignment?: Alignment; normalized_alignment?: Alignment }>(
      "POST",
      `/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
      { text, model_id: model },
      90_000,
    );
    if (!r.audio_base64) throw new ElevenError("ElevenLabs returned no audio", 502);
    return { audio: Buffer.from(r.audio_base64, "base64"), alignment: r.alignment ?? r.normalized_alignment, model };
  };
  const retryable = (err: unknown) => err instanceof ElevenError && err.status >= 400 && err.status < 500 && ![401, 402, 429].includes(err.status);
  try {
    const out = await withTimestamps(cfg.ttsModel).catch((err) => {
      if (retryable(err) && cfg.ttsModel !== TTS_FALLBACK_MODEL) return withTimestamps(TTS_FALLBACK_MODEL);
      throw err;
    });
    record(out.model);
    return out;
  } catch (err) {
    if (!retryable(err)) throw err;
    // Timestamps not available on this plan/model: plain speech, captions spread over the length.
    const audio = await elevenBytes(`/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, { text, model_id: TTS_FALLBACK_MODEL });
    record(TTS_FALLBACK_MODEL);
    return { audio, model: TTS_FALLBACK_MODEL };
  }
}

// ── Images (Image & Video API) ──────────────────────────────────────────

type Generation =
  | { status: "pending" | "generating"; id: string }
  | { status: "completed"; id: string; content_url: string; content_mime_type?: string }
  | { status: "failed"; id: string; error_message?: string; failure_reason?: string };

export async function generateImage(prompt: string, opts: { aspect?: "16:9" | "3:2" | "1:1" | "9:16"; agent: AgentId; leadId?: string; timeoutMs?: number }): Promise<{ bytes: Buffer; mime: string }> {
  const created = await elevenJson<{ id: string }>("POST", "/v1/flows/image", {
    model_id: cfg.imageModel,
    prompt,
    aspect_ratio: opts.aspect ?? "16:9",
    quality: "medium",
    resolution: "1K",
  });
  addCost({ provider: "elevenlabs", agent: opts.agent, leadId: opts.leadId, usd: PRICES.elevenImage, units: 1, unit: "image", note: cfg.imageModel });
  const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
  let wait = 2500;
  for (;;) {
    await sleep(wait);
    wait = Math.min(6000, Math.round(wait * 1.4));
    const g = await elevenJson<Generation>("GET", `/v1/flows/image/${encodeURIComponent(created.id)}`);
    if (g.status === "completed") {
      const res = await fetch(g.content_url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new ElevenError(`Couldn't download the image (HTTP ${res.status})`, 502);
      return { bytes: Buffer.from(await res.arrayBuffer()), mime: g.content_mime_type || res.headers.get("content-type") || "image/png" };
    }
    if (g.status === "failed") {
      throw new ElevenError(g.failure_reason === "moderated" ? "The image was blocked by moderation." : `Image generation failed: ${g.error_message || g.failure_reason}`, 502);
    }
    if (Date.now() > deadline) throw new ElevenError("The image took too long.", 504);
  }
}

// ── Credits ──────────────────────────────────────────────────────────────

export interface ElevenCredits {
  tier?: string;
  used: number;
  limit: number;
  remaining: number;
  resetsAt?: string;
}

let creditCache: { at: number; value: ElevenCredits } | undefined;

export async function elevenCredits(force = false): Promise<ElevenCredits | undefined> {
  if (!keys.eleven) return undefined;
  if (!force && creditCache && Date.now() - creditCache.at < 10 * 60_000) return creditCache.value;
  try {
    const s = await elevenJson<{ tier?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number }>("GET", "/v1/user/subscription", undefined, 10_000);
    const used = s.character_count ?? 0;
    const limit = s.character_limit ?? 0;
    const value = {
      tier: s.tier,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetsAt: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString() : undefined,
    };
    creditCache = { at: Date.now(), value };
    return value;
  } catch {
    return creditCache?.value;
  }
}

/** Keep the cached balance roughly right between refreshes. */
export function spendCredits(n: number): void {
  if (creditCache) creditCache.value.remaining = Math.max(0, creditCache.value.remaining - n);
}

// ── Conversations ────────────────────────────────────────────────────────

export async function conversationCredential(agentId: string, mode: "voice" | "text"): Promise<{ conversationToken: string } | { signedUrl: string }> {
  const q = `agent_id=${encodeURIComponent(agentId)}`;
  if (mode === "voice") {
    const r = await elevenJson<{ token?: string }>("GET", `/v1/convai/conversation/token?${q}`, undefined, 10_000);
    if (!r.token) throw new ElevenError("ElevenLabs didn't return a conversation token", 502);
    return { conversationToken: r.token };
  }
  const r = await elevenJson<{ signed_url?: string }>("GET", `/v1/convai/conversation/get-signed-url?${q}`, undefined, 10_000);
  if (!r.signed_url) throw new ElevenError("ElevenLabs didn't return a signed URL", 502);
  return { signedUrl: r.signed_url };
}

/** Atlas phones the owner (escalations). Needs a number imported into ElevenLabs. */
export async function callOwner(opts: { agentId: string; phoneNumberId: string; to: string; firstMessage: string; dynamicVariables: Record<string, string> }): Promise<string | undefined> {
  const r = await elevenJson<{ conversation_id?: string; success?: boolean; message?: string }>("POST", "/v1/convai/twilio/outbound-call", {
    agent_id: opts.agentId,
    agent_phone_number_id: opts.phoneNumberId,
    to_number: opts.to,
    conversation_initiation_client_data: {
      dynamic_variables: opts.dynamicVariables,
      conversation_config_override: { agent: { first_message: opts.firstMessage } },
    },
  });
  return r.conversation_id;
}
