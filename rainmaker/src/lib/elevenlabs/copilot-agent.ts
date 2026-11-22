import "server-only";
import { DEFAULT_COPILOT_AGENT_ID } from "@/lib/config";
import { COPILOT_DYNAMIC_DEFAULTS, COPILOT_FIRST_MESSAGE, COPILOT_PROMPT, COPILOT_TOOLS } from "@/lib/copilot/spec";
import { readDb, update } from "@/lib/store";
import { PRIVATE_TEXT_OK, syncClientAgent } from "./agent-sync";
import { AGENT_LLM, CLIENT_TOOL_EVENTS } from "./client";

// The CRM copilot in ElevenLabs, kept in step with src/lib/copilot/spec.ts.
// Private: the signed-in owner's browser gets a one-conversation token from
// /api/copilot/session.

export async function resolveCopilotAgentId(): Promise<string | undefined> {
  if (process.env.ELEVENLABS_COPILOT_AGENT_ID) return process.env.ELEVENLABS_COPILOT_AGENT_ID;
  const db = await readDb();
  return db.copilot?.agentId || DEFAULT_COPILOT_AGENT_ID || undefined;
}

function agentBody(toolIds: string[]) {
  return {
    conversation_config: {
      agent: {
        first_message: COPILOT_FIRST_MESSAGE,
        language: "en",
        prompt: { prompt: COPILOT_PROMPT, llm: AGENT_LLM, tool_ids: toolIds },
        dynamic_variables: { dynamic_variable_placeholders: COPILOT_DYNAMIC_DEFAULTS },
      },
      // Working sessions run long; the owner ends the call when done.
      conversation: { max_duration_seconds: 1800, client_events: CLIENT_TOOL_EVENTS },
    },
    platform_settings: PRIVATE_TEXT_OK,
  };
}

export async function syncCopilot(agencyName: string): Promise<{ agentId: string; created: boolean; tools: number }> {
  const db = await readDb();
  const res = await syncClientAgent({
    current: await resolveCopilotAgentId(),
    pinned: Boolean(process.env.ELEVENLABS_COPILOT_AGENT_ID),
    knownToolIds: db.copilot?.toolIds,
    tools: COPILOT_TOOLS,
    body: agentBody,
    create: { name: `${agencyName} – Rainmaker Copilot`, tags: ["rainmaker", "copilot", "crm"] },
  });
  await update((d) => {
    d.copilot = { agentId: res.agentId, toolIds: res.toolIds, syncedAt: new Date().toISOString() };
  });
  return { agentId: res.agentId, created: res.created, tools: COPILOT_TOOLS.length };
}
