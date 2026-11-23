import { elevenEnabled } from "@/lib/config";
import { briefingWindow, buildBriefing } from "@/lib/copilot/briefing";
import { ElevenError, conversationCredential } from "@/lib/elevenlabs/client";
import { ensureCopilotSynced, resolveCopilotAgentId } from "@/lib/elevenlabs/copilot-agent";
import { HttpError, readBody, route } from "@/lib/http";
import { getProfile } from "@/lib/repo";
import { readDb, update } from "@/lib/store";

// A one-conversation ElevenLabs credential for the copilot: a WebRTC token
// for voice, a signed URL for text. Signed-in owner only. Syncs the agent
// first when the code changed, and returns the "since your last visit"
// greeting.

export const dynamic = "force-dynamic";
// A first session after a deploy may sync the agent's tools first.
export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  const b = await readBody<{ mode?: string }>(req);
  const mode = b.mode === "text" ? "text" : "voice";
  if (!elevenEnabled()) throw new HttpError(503, "Add ELEVENLABS_API_KEY to talk to the copilot. Until then I can open screens and explain features.");
  await ensureCopilotSynced((await getProfile()).agencyName);
  const agentId = await resolveCopilotAgentId();
  if (!agentId) throw new HttpError(503, "The copilot isn't set up yet. Press Sync copilot in Settings.");
  let auth: Awaited<ReturnType<typeof conversationCredential>>;
  try {
    auth = await conversationCredential(agentId, mode);
  } catch (err) {
    console.error("[rainmaker] copilot credential", err);
    if (err instanceof ElevenError && err.status === 404) throw new HttpError(502, "The copilot agent isn't in this ElevenLabs workspace. Press Sync copilot in Settings.");
    throw new HttpError(502, err instanceof Error ? err.message : "ElevenLabs didn't answer. Try again in a moment.");
  }
  const db = await readDb();
  const { since, next } = briefingWindow(db.copilotSeen);
  const briefing = buildBriefing(db, since);
  await update((d) => {
    d.copilotSeen = next;
  });
  return Response.json({ ok: true, auth, briefing });
});
