import "server-only";
import { putAsset } from "@/lib/assets";
import { DEFAULT_VOICEOVER_VOICE, ElevenError, eleven, elevenBytes } from "./client";

// Voiceovers and audio ads with ElevenLabs text to speech (Eleven v4, with
// Multilingual v2 as the fallback model).

export const TTS_MODEL = process.env.ELEVENLABS_TTS_MODEL || "eleven_v4";
const FALLBACK = "eleven_multilingual_v2";

export async function synthesize(text: string, voiceId = DEFAULT_VOICEOVER_VOICE): Promise<{ assetId: string; mime: string; model: string }> {
  const clean = text.replace(/\[(show|cut|b-roll|shot|music)[^\]]*\]/gi, "").replace(/\s+/g, " ").trim();
  if (!clean) throw new ElevenError("Nothing to read out", 400);
  if (clean.length > 5000) throw new ElevenError("Voiceovers are limited to 5,000 characters", 400);
  const path = `/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
  const run = (model: string) => elevenBytes("POST", path, { text: clean, model_id: model });
  let model = TTS_MODEL;
  const out = await run(model).catch((err) => {
    if (err instanceof ElevenError && err.status >= 400 && err.status < 500 && err.status !== 401 && model !== FALLBACK) {
      model = FALLBACK;
      return run(model);
    }
    throw err;
  });
  const mime = out.mime.startsWith("audio/") ? out.mime : "audio/mpeg";
  return { assetId: await putAsset(out.bytes, mime), mime, model };
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/**
 * A voiceover with the time each character is spoken, so a video can cut
 * from scene to scene on the words. The text is used exactly as given.
 */
export async function synthesizeTimed(text: string, voiceId = DEFAULT_VOICEOVER_VOICE): Promise<{ assetId: string; model: string; alignment: Alignment }> {
  if (!text.trim()) throw new ElevenError("Nothing to read out", 400);
  if (text.length > 5000) throw new ElevenError("Voiceovers are limited to 5,000 characters", 400);
  const path = `/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  const run = (model: string) => eleven<{ audio_base64?: string; alignment?: Alignment | null }>("POST", path, { text, model_id: model }, 120_000);
  let model = TTS_MODEL;
  const out = await run(model).catch((err) => {
    if (err instanceof ElevenError && err.status >= 400 && err.status < 500 && err.status !== 401 && model !== FALLBACK) {
      model = FALLBACK;
      return run(model);
    }
    throw err;
  });
  if (!out.audio_base64 || !out.alignment?.characters?.length) throw new ElevenError("ElevenLabs didn't return the voiceover's timing", 502);
  return { assetId: await putAsset(Buffer.from(out.audio_base64, "base64"), "audio/mpeg"), model, alignment: out.alignment };
}
