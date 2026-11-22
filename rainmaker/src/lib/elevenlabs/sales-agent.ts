import "server-only";
import { DEFAULT_SALES_AGENT_ID } from "@/lib/config";
import { readDb, update } from "@/lib/store";
import { AGENT_LLM, AGENT_TTS_FALLBACK, AGENT_TTS_MODEL, CLIENT_TOOL_EVENTS, DEFAULT_AGENT_VOICE, ElevenError, eleven } from "./client";
import { SALES_DYNAMIC_DEFAULTS, SALES_FIRST_MESSAGE, SALES_PROMPT, SALES_TOOLS, type ToolSpec } from "./sales-spec";

// Create or update the storefront's sales assistant in ElevenLabs so it
// matches sales-spec.ts: prompt, first message, client tools and dynamic
// variables. The agent is private: browsers get short-lived tokens from
// /api/store/voice.

export async function resolveSalesAgentId(): Promise<string | undefined> {
  if (process.env.ELEVENLABS_SALES_AGENT_ID) return process.env.ELEVENLABS_SALES_AGENT_ID;
  const db = await readDb();
  return db.store.salesAgent?.agentId || DEFAULT_SALES_AGENT_ID || undefined;
}

function toolConfig(t: ToolSpec) {
  return {
    tool_config: {
      type: "client",
      name: t.name,
      description: t.description,
      expects_response: true,
      response_timeout_secs: 15,
      ...(t.parameters ? { parameters: t.parameters } : {}),
    },
  };
}

interface ToolRecord {
  id: string;
  tool_config?: { name?: string; type?: string };
}

/** The agent's existing tool ids by name (an agent made in the dashboard or by Claude reuses its tools). */
async function toolsOnAgent(agentId: string): Promise<Record<string, string>> {
  const agent = await eleven<{ conversation_config?: { agent?: { prompt?: { tool_ids?: string[] } } } }>("GET", `/v1/convai/agents/${agentId}`);
  const ids = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];
  const out: Record<string, string> = {};
  for (const id of ids) {
    const t = await eleven<ToolRecord>("GET", `/v1/convai/tools/${id}`).catch(() => undefined);
    if (t?.tool_config?.type === "client" && t.tool_config.name) out[t.tool_config.name] = id;
  }
  return out;
}

async function upsertTools(known: Record<string, string>): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const spec of SALES_TOOLS) {
    const existing = known[spec.name];
    if (existing) {
      const ok = await eleven("PATCH", `/v1/convai/tools/${existing}`, toolConfig(spec)).then(() => true, () => false);
      if (ok) {
        ids[spec.name] = existing;
        continue;
      }
    }
    const created = await eleven<ToolRecord>("POST", "/v1/convai/tools", toolConfig(spec));
    ids[spec.name] = created.id;
  }
  return ids;
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
    platform_settings: { auth: { enable_auth: true } },
  };
}

export async function syncSalesAgent(agencyName: string): Promise<{ agentId: string; created: boolean; tools: number }> {
  const db = await readDb();
  const current = await resolveSalesAgentId();
  let known: Record<string, string> = { ...(db.store.salesAgent?.toolIds ?? {}) };
  if (current) known = { ...known, ...(await toolsOnAgent(current).catch(() => ({}))) };
  const toolIds = await upsertTools(known);
  const ids = SALES_TOOLS.map((t) => toolIds[t.name]);

  let agentId = current;
  let created = false;
  if (agentId) {
    await eleven("PATCH", `/v1/convai/agents/${agentId}`, agentBody(ids)).catch((err) => {
      // The built-in agent (or one saved earlier) lives in another workspace
      // than this key: make a fresh one here. A pinned env id stays an error.
      if (err instanceof ElevenError && err.status === 404 && !process.env.ELEVENLABS_SALES_AGENT_ID) agentId = undefined;
      else throw err;
    });
  }
  if (!agentId) {
    const make = (model: string) =>
      eleven<{ agent_id: string }>("POST", "/v1/convai/agents/create", {
        name: `${agencyName} – Store Sales Assistant`,
        tags: ["rainmaker", "store", "sales"],
        ...agentBody(ids),
        conversation_config: { ...agentBody(ids).conversation_config, tts: { voice_id: DEFAULT_AGENT_VOICE, model_id: model } },
      });
    const res = await make(AGENT_TTS_MODEL).catch((err) => {
      if (err instanceof ElevenError && err.status >= 400 && err.status < 500 && AGENT_TTS_MODEL !== AGENT_TTS_FALLBACK) return make(AGENT_TTS_FALLBACK);
      throw err;
    });
    agentId = res.agent_id;
    created = true;
  }
  await update((d) => {
    d.store.salesAgent = { agentId: agentId!, toolIds, syncedAt: new Date().toISOString() };
  });
  return { agentId: agentId!, created, tools: ids.length };
}
