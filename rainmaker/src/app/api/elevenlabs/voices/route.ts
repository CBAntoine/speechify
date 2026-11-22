import { elevenEnabled } from "@/lib/config";
import { DEFAULT_VOICEOVER_VOICE, listVoices } from "@/lib/elevenlabs/client";
import { route } from "@/lib/http";

export const GET = route(async () => {
  if (!elevenEnabled()) return Response.json({ voices: [], defaultVoiceId: DEFAULT_VOICEOVER_VOICE });
  return Response.json({ voices: await listVoices(), defaultVoiceId: DEFAULT_VOICEOVER_VOICE });
});
