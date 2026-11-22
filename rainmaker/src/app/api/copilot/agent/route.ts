import { elevenEnabled } from "@/lib/config";
import { eleven } from "@/lib/elevenlabs/client";
import { resolveCopilotAgentId, syncCopilot } from "@/lib/elevenlabs/copilot-agent";
import { HttpError, route } from "@/lib/http";
import { getProfile } from "@/lib/repo";
import { readDb } from "@/lib/store";

export const maxDuration = 60;

/** Is the copilot's ElevenLabs agent reachable with this API key? */
export const GET = route(async () => {
  const agentId = await resolveCopilotAgentId();
  if (!elevenEnabled()) return Response.json({ connected: false, agentId, reason: "Add your ElevenLabs API key in API keys" });
  if (!agentId) return Response.json({ connected: false, reason: "No copilot yet: press Sync copilot to create it" });
  try {
    const a = await eleven<{ name?: string }>("GET", `/v1/convai/agents/${agentId}`);
    return Response.json({ connected: true, agentId, name: a.name, syncedAt: (await readDb()).copilot?.syncedAt });
  } catch (err) {
    return Response.json({ connected: false, agentId, reason: err instanceof Error ? err.message : String(err) });
  }
});

/** Create the copilot, or push its prompt and tools from the code. */
export const POST = route(async () => {
  if (!elevenEnabled()) throw new HttpError(400, "Add your ElevenLabs API key in Settings → API keys first");
  return Response.json(await syncCopilot((await getProfile()).agencyName));
});
