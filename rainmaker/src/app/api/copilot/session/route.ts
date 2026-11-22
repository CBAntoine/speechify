import { elevenEnabled } from "@/lib/config";
import { ElevenError, conversationCredential } from "@/lib/elevenlabs/client";
import { resolveCopilotAgentId } from "@/lib/elevenlabs/copilot-agent";
import { HttpError, readBody, route } from "@/lib/http";

// A one-conversation ElevenLabs credential for the copilot: a WebRTC token
// for voice, a signed URL for text. Signed-in owner only.

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const b = await readBody<{ mode?: string }>(req);
  const mode = b.mode === "text" ? "text" : "voice";
  if (!elevenEnabled()) throw new HttpError(503, "Add ELEVENLABS_API_KEY to talk to the copilot. Until then I can open screens and explain features.");
  const agentId = await resolveCopilotAgentId();
  if (!agentId) throw new HttpError(503, "The copilot isn't set up yet. Press Sync copilot in Settings.");
  try {
    return Response.json({ ok: true, auth: await conversationCredential(agentId, mode) });
  } catch (err) {
    console.error("[rainmaker] copilot credential", err);
    if (err instanceof ElevenError && err.status === 404) throw new HttpError(502, "The copilot agent isn't in this ElevenLabs workspace. Press Sync copilot in Settings.");
    throw new HttpError(502, err instanceof Error ? err.message : "ElevenLabs didn't answer. Try again in a moment.");
  }
});
