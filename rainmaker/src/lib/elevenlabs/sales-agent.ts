import "server-only";
import { DEFAULT_SALES_AGENT_ID } from "@/lib/config";
import { readDb, update } from "@/lib/store";
import { PRIVATE_TEXT_OK, syncClientAgent } from "./agent-sync";
import { AGENT_LLM, CLIENT_TOOL_EVENTS } from "./client";
import { SALES_DYNAMIC_DEFAULTS, SALES_FIRST_MESSAGE, SALES_PROMPT, SALES_TOOLS } from "./sales-spec";

// Create or update the storefront's sales assistant in ElevenLabs so it
// matches sales-spec.ts: prompt, first message, client tools and dynamic
// variables. The agent is private: browsers get short-lived tokens from
// /api/store/voice.

export async function resolveSalesAgentId(): Promise<string | undefined> {
  if (process.env.ELEVENLABS_SALES_AGENT_ID) return process.env.ELEVENLABS_SALES_AGENT_ID;
  const db = await readDb();
  return db.store.salesAgent?.agentId || DEFAULT_SALES_AGENT_ID || undefined;
}

function agentBody(toolIds: string[]) {
  return {
    conversation_config: {
      agent: {
        first_message: SALES_FIRST_MESSAGE,
        language: "en",
        prompt: { prompt: SALES_PROMPT, llm: AGENT_LLM, tool_ids: toolIds },
        dynamic_variables: { dynamic_variable_placeholders: SALES_DYNAMIC_DEFAULTS },
      },
      conversation: { max_duration_seconds: 900, client_events: CLIENT_TOOL_EVENTS },
    },
    platform_settings: PRIVATE_TEXT_OK,
  };
}

export async function syncSalesAgent(agencyName: string): Promise<{ agentId: string; created: boolean; tools: number }> {
  const db = await readDb();
  const res = await syncClientAgent({
    current: await resolveSalesAgentId(),
    pinned: Boolean(process.env.ELEVENLABS_SALES_AGENT_ID),
    knownToolIds: db.store.salesAgent?.toolIds,
    tools: SALES_TOOLS,
    body: agentBody,
    create: { name: `${agencyName} – Store Sales Assistant`, tags: ["rainmaker", "store", "sales"] },
  });
  await update((d) => {
    d.store.salesAgent = { agentId: res.agentId, toolIds: res.toolIds, syncedAt: new Date().toISOString() };
  });
  return { agentId: res.agentId, created: res.created, tools: SALES_TOOLS.length };
}
