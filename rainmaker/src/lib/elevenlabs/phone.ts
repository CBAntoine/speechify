import "server-only";
import { ELEVEN_API, ElevenError, eleven } from "./client";

// Phone calls, recordings and practice calls on ElevenLabs:
//  - hand a live Twilio call to a client's agent (register-call returns the
//    TwiML that connects it), with the μ-law 8 kHz audio phone lines use;
//  - transcribe a sales call recording with who-said-what (Scribe);
//  - read back a finished practice conversation for coaching.

export const STT_MODEL = process.env.ELEVENLABS_STT_MODEL || "scribe_v3";
const STT_FALLBACK = "scribe_v2";

/** Phone lines carry μ-law 8 kHz audio; the agent must speak and listen in it. */
export async function preparePhoneAgent(agentId: string): Promise<void> {
  await eleven("PATCH", `/v1/convai/agents/${agentId}`, {
    conversation_config: {
      tts: { agent_output_audio_format: "ulaw_8000" },
      asr: { user_input_audio_format: "ulaw_8000" },
    },
  });
}

/** TwiML that connects an incoming Twilio call to the agent. */
export async function registerTwilioCall(input: { agentId: string; from: string; to: string; variables?: Record<string, string> }): Promise<string> {
  const res = await fetch(`${ELEVEN_API}/v1/convai/twilio/register-call`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "", "content-type": "application/json" },
    body: JSON.stringify({
      agent_id: input.agentId,
      from_number: input.from,
      to_number: input.to,
      direction: "inbound",
      ...(input.variables ? { conversation_initiation_client_data: { dynamic_variables: input.variables } } : {}),
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const text = await res.text();
  if (!res.ok) throw new ElevenError(`ElevenLabs couldn't take the call (HTTP ${res.status})`, res.status, text.slice(0, 300));
  if (!text.includes("<Response")) {
    // Some API versions wrap the TwiML in JSON.
    try {
      const j = JSON.parse(text) as { twiml?: string };
      if (j.twiml) return j.twiml;
    } catch {
      /* fall through */
    }
    throw new ElevenError("ElevenLabs didn't return TwiML for the call", 502);
  }
  return text;
}

interface SttWord {
  text: string;
  type?: string;
  speaker_id?: string;
}

/** Words grouped into "Rep: …" / "Customer: …" lines. */
export function wordsToTranscript(words: SttWord[]): string {
  const lines: { speaker: string; text: string }[] = [];
  for (const w of words) {
    if (w.type === "audio_event") continue;
    const speaker = w.speaker_id ?? "speaker_0";
    const last = lines[lines.length - 1];
    if (last && last.speaker === speaker) last.text += w.text;
    else lines.push({ speaker, text: w.text });
  }
  const label = (s: string) => (s === "agent" ? "Rep" : s === "customer" ? "Customer" : s.replace(/^speaker_(\d+)$/, (_, n: string) => `Speaker ${Number(n) + 1}`));
  return lines
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text)
    .map((l) => `${label(l.speaker)}: ${l.text}`)
    .join("\n");
}

/** Transcribe a recording with speaker labels; sales calls get "agent"/"customer" roles. */
export async function transcribeCall(bytes: Buffer, mime: string, filename: string, language?: string): Promise<string> {
  const run = async (model: string, roles: boolean) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), filename);
    form.append("model_id", model);
    form.append("diarize", "true");
    form.append("timestamps_granularity", "word");
    if (roles) form.append("detect_speaker_roles", "true");
    if (language) form.append("language_code", language);
    const res = await fetch(`${ELEVEN_API}/v1/speech-to-text`, {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "" },
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(180_000),
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; words?: SttWord[]; detail?: unknown };
    if (!res.ok) throw new ElevenError(`Transcription failed (HTTP ${res.status})`, res.status, data.detail);
    return data.words?.length ? wordsToTranscript(data.words) : (data.text ?? "");
  };
  try {
    return await run(STT_MODEL, true);
  } catch (err) {
    if (!(err instanceof ElevenError) || err.status < 400 || err.status >= 500 || err.status === 401) throw err;
    // An older workspace or model without speaker roles: plain diarization, then the older model.
    return run(STT_MODEL, false).catch(() => run(STT_FALLBACK, false));
  }
}

interface ConversationTurn {
  role: "user" | "agent";
  message?: string | null;
}

/**
 * A finished practice call as "Rep: …" lines. In practice the trainee is the
 * "user" and the agent plays the customer. ElevenLabs finishes processing a
 * conversation a few seconds after it ends, so this waits for it.
 */
export async function practiceTranscript(conversationId: string, waitMs = 20_000): Promise<string> {
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(conversationId)) throw new ElevenError("Not a conversation id", 400);
  const until = Date.now() + waitMs;
  for (;;) {
    const c = await eleven<{ status?: string; transcript?: ConversationTurn[] }>("GET", `/v1/convai/conversations/${conversationId}`);
    const lines = (c.transcript ?? []).filter((t) => t.message?.trim()).map((t) => `${t.role === "user" ? "Rep" : "Customer"}: ${t.message!.trim()}`);
    if ((c.status === "done" || c.status === "failed" || Date.now() > until) && lines.length) return lines.join("\n");
    if (Date.now() > until) throw new ElevenError("The practice call has no transcript yet. Try again in a minute.", 409);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}
