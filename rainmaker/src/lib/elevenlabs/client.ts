import "server-only";
import { elevenEnabled } from "@/lib/config";

// ElevenLabs REST API with the server's key (ELEVENLABS_API_KEY). The key
// never reaches the browser: the store and demo pages get short-lived
// conversation tokens instead.

export const ELEVEN_API = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";

/** LLM for the agents Rainmaker creates. Fast enough for live voice, strong at tool use. */
export const AGENT_LLM = process.env.ELEVENLABS_AGENT_LLM || "claude-sonnet-5-5";
/** Real-time voice model for agents; falls back to Flash v2.5 if the workspace rejects it. */
export const AGENT_TTS_MODEL = process.env.ELEVENLABS_AGENT_TTS_MODEL || "eleven_v4_turbo";
export const AGENT_TTS_FALLBACK = "eleven_flash_v2_5";
/** "Amber Maria King": a receptionist voice from this workspace. */
export const DEFAULT_AGENT_VOICE = process.env.ELEVENLABS_AGENT_VOICE_ID || "F89WkXaQbUlVyNvtlD3X";
/** "Eric - Smooth, Trustworthy" (premade): default for ad voiceovers. */
export const DEFAULT_VOICEOVER_VOICE = process.env.ELEVENLABS_VOICEOVER_VOICE_ID || "cjVigY5qzO86Huf0OWal";

/**
 * Events an agent streams to the browser SDK. Agents created through the API
 * don't always get the full list, and without the initiation, transcript and
 * tool-call events the in-page chat can't show replies or run client tools.
 */
export const CLIENT_EVENTS = ["conversation_initiation_metadata", "ping", "audio", "interruption", "agent_response", "user_transcript", "agent_response_correction", "agent_tool_response"];
export const CLIENT_TOOL_EVENTS = [...CLIENT_EVENTS, "client_tool_call"];

export class ElevenError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: unknown
  ) {
    super(message);
  }
}

function explain(status: number, detail: unknown): string {
  const d = detail as { detail?: { message?: string; status?: string } | { msg?: string }[] | string; message?: string } | undefined;
  const raw =
    typeof d?.detail === "string"
      ? d.detail
      : Array.isArray(d?.detail)
        ? d.detail.map((x) => x.msg).filter(Boolean).join("; ")
        : (d?.detail as { message?: string } | undefined)?.message ?? d?.message;
  if (status === 401) return "ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY and its permissions.";
  if (status === 402) return `Your ElevenLabs plan doesn't include this${raw ? `: ${raw}` : ""}. Image & Video needs the Pro plan or above.`;
  if (status === 403) return `The ElevenLabs key isn't allowed to do this${raw ? `: ${raw}` : ""}. Give the key the matching permission.`;
  if (status === 429) return "ElevenLabs is rate limiting or out of credits. Wait a minute or top up.";
  return raw ? `ElevenLabs: ${raw}` : `ElevenLabs error ${status}`;
}

export async function eleven<T = Record<string, unknown>>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  if (!elevenEnabled()) throw new ElevenError("Add ELEVENLABS_API_KEY to switch on voice agents, voiceovers and art", 400);
  const res = await fetch(`${ELEVEN_API}${path}`, {
    method,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 204) return {} as T;
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) throw new ElevenError(explain(res.status, data), res.status, data);
  return data;
}

/** For endpoints that return audio or images. */
export async function elevenBytes(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 90_000): Promise<{ bytes: Buffer; mime: string }> {
  if (!elevenEnabled()) throw new ElevenError("Add ELEVENLABS_API_KEY to switch on voiceovers", 400);
  const res = await fetch(`${ELEVEN_API}${path}`, {
    method,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => undefined);
    throw new ElevenError(explain(res.status, detail), res.status, detail);
  }
  return { bytes: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "application/octet-stream" };
}

/** A short-lived credential for one browser conversation with a private agent. */
export async function conversationCredential(agentId: string, mode: "voice" | "text"): Promise<{ conversationToken: string } | { signedUrl: string }> {
  const q = `agent_id=${encodeURIComponent(agentId)}`;
  if (mode === "voice") {
    const r = await eleven<{ token?: string }>("GET", `/v1/convai/conversation/token?${q}`, undefined, 10_000);
    if (!r.token) throw new ElevenError("ElevenLabs didn't return a conversation token", 502);
    return { conversationToken: r.token };
  }
  const r = await eleven<{ signed_url?: string }>("GET", `/v1/convai/conversation/get-signed-url?${q}`, undefined, 10_000);
  if (!r.signed_url) throw new ElevenError("ElevenLabs didn't return a signed URL", 502);
  return { signedUrl: r.signed_url };
}

export interface VoiceSummary {
  voiceId: string;
  name: string;
  category?: string;
  previewUrl?: string;
  labels?: Record<string, string>;
}

export async function listVoices(): Promise<VoiceSummary[]> {
  const r = await eleven<{ voices?: { voice_id: string; name: string; category?: string; preview_url?: string; labels?: Record<string, string> }[] }>("GET", "/v1/voices");
  return (r.voices ?? []).map((v) => ({ voiceId: v.voice_id, name: v.name, category: v.category, previewUrl: v.preview_url, labels: v.labels }));
}
