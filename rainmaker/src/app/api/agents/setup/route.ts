import { ensureManagedAgent } from "@/lib/agents/runner";
import { AGENTS } from "@/lib/agents/roster";
import { agentRuntime } from "@/lib/config";
import { HttpError, route } from "@/lib/http";

export const maxDuration = 120;

// Creates the Managed Agents environment and one agent per role (or updates
// them to a new version when their prompt or tools changed). Runs also do
// this lazily, so this is only a convenience for checking your key.
export const POST = route(async () => {
  if (agentRuntime() !== "managed") throw new HttpError(400, "Managed Agents is off: set ANTHROPIC_API_KEY and leave AGENT_RUNTIME unset or 'managed'.");
  const out: Record<string, { agentId: string; version: number }> = {};
  let environmentId = "";
  for (const def of AGENTS) {
    const r = await ensureManagedAgent(def);
    out[def.id] = { agentId: r.agentId, version: r.version };
    environmentId = r.environmentId;
  }
  return Response.json({ environmentId, agents: out });
});
