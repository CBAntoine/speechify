import { elevenEnabled } from "@/lib/config";
import { practiceVariables, scenarioById } from "@/lib/clients/practice";
import { getClient } from "@/lib/clients/repo";
import { l3 } from "@/lib/clients/templates";
import { ElevenError, conversationCredential } from "@/lib/elevenlabs/client";
import { ensurePracticeAgent } from "@/lib/elevenlabs/practice-agent";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { getNiche } from "@/lib/niches";
import { getProfile } from "@/lib/repo";

export const maxDuration = 60;

/** A one-conversation credential for a practice call, plus the scenario's variables. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const client = await getClient((await params).id);
  if (!client) throw new HttpError(404, "Client not found");
  if (!elevenEnabled()) throw new HttpError(503, "Practice calls need ELEVENLABS_API_KEY. You can still paste call transcripts to get them scored.");
  const b = await readBody<{ scenario?: string; mode?: string }>(req);
  const scenario = scenarioById(b.scenario);
  try {
    const agentId = await ensurePracticeAgent((await getProfile()).agencyName);
    const auth = await conversationCredential(agentId, b.mode === "text" ? "text" : "voice");
    return Response.json({
      ok: true,
      auth,
      language: l3(client.lang),
      variables: practiceVariables(scenario, { business: client.name, niche: (getNiche(client.niche)?.label ?? "local business").toLowerCase(), lang: client.lang }),
      scenario: { id: scenario.id, label: scenario.label, tip: scenario.tip },
    });
  } catch (err) {
    console.error("[rainmaker] practice session", err);
    throw new HttpError(502, err instanceof ElevenError ? err.message : "ElevenLabs didn't answer. Try again in a moment.");
  }
});
