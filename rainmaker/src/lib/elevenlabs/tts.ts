import "server-only";
import { putAsset } from "@/lib/assets";
import { DEFAULT_VOICEOVER_VOICE, ElevenError, elevenBytes } from "./client";

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
