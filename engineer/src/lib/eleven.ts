import "server-only";
import { elevenEnabled } from "./config";
import { HttpError } from "./http";

// ElevenLabs REST API with the server's key. The key never reaches the
// browser: it gets a one-conversation credential instead.

const API = process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io";

async function eleven<T>(route: string): Promise<T> {
  if (!elevenEnabled()) throw new HttpError(503, "Add ELEVENLABS_API_KEY to talk to the engineer.");
  const res = await fetch(`${API}${route}`, {
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY! },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { detail?: { message?: string } | string };
  if (!res.ok) {
    if (res.status === 401) throw new HttpError(502, "ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY.");
    if (res.status === 404) throw new HttpError(502, "The engineer agent isn't in this ElevenLabs workspace. Run npm run voice:sync.");
    const detail = typeof data.detail === "string" ? data.detail : data.detail?.message;
    throw new HttpError(502, detail ? `ElevenLabs: ${detail}` : `ElevenLabs error ${res.status}`);
  }
  return data;
}

/** A WebRTC token for voice, or a signed URL for text chat. */
export async function conversationCredential(agentId: string, mode: "voice" | "text"): Promise<{ conversationToken: string } | { signedUrl: string }> {
  const q = `agent_id=${encodeURIComponent(agentId)}`;
  if (mode === "voice") {
    const r = await eleven<{ token?: string }>(`/v1/convai/conversation/token?${q}`);
    if (!r.token) throw new HttpError(502, "ElevenLabs didn't return a conversation token.");
    return { conversationToken: r.token };
  }
  const r = await eleven<{ signed_url?: string }>(`/v1/convai/conversation/get-signed-url?${q}`);
  if (!r.signed_url) throw new HttpError(502, "ElevenLabs didn't return a signed URL.");
  return { signedUrl: r.signed_url };
}
