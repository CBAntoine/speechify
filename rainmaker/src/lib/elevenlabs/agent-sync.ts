import "server-only";
import { AGENT_TTS_FALLBACK, AGENT_TTS_MODEL, DEFAULT_AGENT_VOICE, ElevenError, eleven } from "./client";

// Create or update an ElevenLabs agent whose tools run in the browser (client
// tools), from a spec in code. Shared by the store's sales assistant and the
// CRM copilot.

export interface ClientToolDef {
  name: string;
  description: string;
  parameters?: unknown;
  timeoutSecs?: number;
  /** "force": the agent always says something first (slow tools), so voice callers aren't left in silence. */
  preToolSpeech?: "auto" | "force" | "off";
}

interface ToolRecord {
  id: string;
  tool_config?: { name?: string; type?: string };
}

/** Every agent Rainmaker makes is private (token-only) and may switch to text chat. */
export const PRIVATE_TEXT_OK = {
  auth: { enable_auth: true },
  overrides: { conversation_config_override: { conversation: { text_only: true } } },
};

function toolConfig(t: ClientToolDef) {
  return {
    tool_config: {
      type: "client",
      name: t.name,
      description: t.description,
      expects_response: true,
      response_timeout_secs: t.timeoutSecs ?? 15,
      ...(t.preToolSpeech ? { pre_tool_speech: t.preToolSpeech } : {}),
      ...(t.parameters ? { parameters: t.parameters } : {}),
    },
  };
}

/** The agent's existing client tool ids by name, so a sync updates them instead of adding copies. */
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

async function upsertTools(tools: ClientToolDef[], known: Record<string, string>): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const spec of tools) {
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

export interface AgentBody {
  conversation_config: Record<string, unknown>;
  platform_settings?: Record<string, unknown>;
}

export async function syncClientAgent(opts: {
  /** The agent to update, if there is one. */
  current?: string;
  /** True when the id comes from an environment variable: a missing agent is then an error, not a reason to make a new one. */
  pinned: boolean;
  knownToolIds?: Record<string, string>;
  tools: ClientToolDef[];
  body: (toolIds: string[]) => AgentBody;
  create: { name: string; tags: string[] };
}): Promise<{ agentId: string; created: boolean; toolIds: Record<string, string> }> {
  let known = { ...(opts.knownToolIds ?? {}) };
  if (opts.current) known = { ...known, ...(await toolsOnAgent(opts.current).catch(() => ({}))) };
  const toolIds = await upsertTools(opts.tools, known);
  const ids = opts.tools.map((t) => toolIds[t.name]);

  let agentId = opts.current;
  let created = false;
  if (agentId) {
    await eleven("PATCH", `/v1/convai/agents/${agentId}`, opts.body(ids)).catch((err) => {
      // The built-in agent (or one saved earlier) lives in another workspace
      // than this key: make a fresh one here. A pinned env id stays an error.
      if (err instanceof ElevenError && err.status === 404 && !opts.pinned) agentId = undefined;
      else throw err;
    });
  }
  if (!agentId) {
    const body = opts.body(ids);
    const make = (model: string) =>
      eleven<{ agent_id: string }>("POST", "/v1/convai/agents/create", {
        name: opts.create.name,
        tags: opts.create.tags,
        ...body,
        conversation_config: { ...body.conversation_config, tts: { voice_id: DEFAULT_AGENT_VOICE, model_id: model } },
      });
    const res = await make(AGENT_TTS_MODEL).catch((err) => {
      if (err instanceof ElevenError && err.status >= 400 && err.status < 500 && AGENT_TTS_MODEL !== AGENT_TTS_FALLBACK) return make(AGENT_TTS_FALLBACK);
      throw err;
    });
    agentId = res.agent_id;
    created = true;
  }
  return { agentId: agentId!, created, toolIds };
}
