import { voiceAgentId } from "@/lib/config";
import { conversationCredential } from "@/lib/eleven";
import { HttpError, readJson, route } from "@/lib/http";

// A one-conversation ElevenLabs credential: a WebRTC token for voice, a
// signed URL for typed chat.

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const body = await readJson<{ mode?: string }>(req, 1_000);
  const agentId = voiceAgentId();
  if (!agentId) throw new HttpError(503, "The engineer agent isn't set up yet. Run npm run voice:sync.");
  return Response.json({ ok: true, auth: await conversationCredential(agentId, body.mode === "text" ? "text" : "voice") });
});
