import crypto from "node:crypto";
import { DEFAULT_ATLAS_AGENT_ID, PUBLIC_URL, eleven as cfg, hasPublicUrl, keys } from "../config.ts";
import { getSettings, kvGet, kvSet } from "../db.ts";
import { log } from "../events.ts";
import { ElevenError, elevenJson } from "../providers/eleven.ts";
import { ATLAS_DYNAMIC_DEFAULTS, ATLAS_FIRST_MESSAGE, ATLAS_PROMPT, atlasToolConfigs, type ToolMode } from "./spec.ts";

// Create or update Atlas in your ElevenLabs workspace from the spec in code.
// Client tools when the app is only on your computer; webhook tools when it
// has a public https address (needed for calling Atlas from a phone).

export interface VoiceAgentState {
  agentId?: string;
  toolIds?: Record<string, string>;
  mode?: ToolMode;
  secretId?: string;
  syncedAt?: string;
}

/** Events the browser SDK needs, including client tool calls. */
const CLIENT_EVENTS = ["conversation_initiation_metadata", "ping", "audio", "interruption", "agent_response", "user_transcript", "agent_response_correction", "agent_tool_response", "client_tool_call"];

export function voiceState(): VoiceAgentState {
  return kvGet<VoiceAgentState>("voice_agent") ?? {};
}

export function atlasAgentId(): string | undefined {
  return cfg.agentId ?? voiceState().agentId ?? DEFAULT_ATLAS_AGENT_ID;
}

export function toolMode(): ToolMode {
  return hasPublicUrl() ? "webhook" : "client";
}

/** The shared secret ElevenLabs sends to this server's webhook tools. */
export function voiceToolSecret(): string {
  if (keys.voiceTools) return keys.voiceTools;
  let s = kvGet<string>("voice_tool_secret");
  if (!s) {
    s = crypto.randomBytes(24).toString("base64url");
    kvSet("voice_tool_secret", s);
  }
  return s;
}

async function ensureSecret(state: VoiceAgentState): Promise<{ secret_id: string } | string> {
  if (state.secretId) return { secret_id: state.secretId };
  try {
    const r = await elevenJson<{ secret_id?: string }>("POST", "/v1/convai/secrets", { type: "new", name: `mainstreet-voice-tools-${Date.now().toString(36)}`, value: voiceToolSecret() });
    if (r.secret_id) {
      state.secretId = r.secret_id;
      return { secret_id: r.secret_id };
    }
  } catch (err) {
    log("system", `Couldn't store the tool key as an ElevenLabs secret (${err instanceof Error ? err.message : err}); using a plain header instead.`, { level: "warn" });
  }
  return voiceToolSecret();
}

async function toolIdsOnAgent(agentId: string): Promise<Record<string, string>> {
  const agent = await elevenJson<{ conversation_config?: { agent?: { prompt?: { tool_ids?: string[] } } } }>("GET", `/v1/convai/agents/${agentId}`);
  const out: Record<string, string> = {};
  for (const id of agent.conversation_config?.agent?.prompt?.tool_ids ?? []) {
    const t = await elevenJson<{ tool_config?: { name?: string } }>("GET", `/v1/convai/tools/${id}`).catch(() => undefined);
    if (t?.tool_config?.name) out[t.tool_config.name] = id;
  }
  return out;
}

export async function syncAtlas(): Promise<{ agentId: string; created: boolean; tools: number; mode: ToolMode }> {
  const s = getSettings();
  const state = voiceState();
  const mode = toolMode();
  const secretRef = mode === "webhook" ? await ensureSecret(state) : undefined;
  const configs = atlasToolConfigs(mode, { baseUrl: PUBLIC_URL, secretRef });

  let agentId = atlasAgentId();
  let known: Record<string, string> = { ...(state.toolIds ?? {}) };
  if (agentId) known = { ...known, ...(await toolIdsOnAgent(agentId).catch(() => ({}))) };

  const toolIds: Record<string, string> = {};
  for (const cfgTool of configs) {
    const tc = cfgTool.tool_config as { name: string; type: string };
    const existing = known[tc.name];
    if (existing) {
      const ok = await elevenJson("PATCH", `/v1/convai/tools/${existing}`, cfgTool).then(
        () => true,
        () => false,
      );
      if (ok) {
        toolIds[tc.name] = existing;
        continue;
      }
    }
    const created = await elevenJson<{ id: string }>("POST", "/v1/convai/tools", cfgTool);
    toolIds[tc.name] = created.id;
  }

  const body = {
    conversation_config: {
      agent: {
        first_message: ATLAS_FIRST_MESSAGE,
        language: "en",
        prompt: { prompt: ATLAS_PROMPT, llm: cfg.agentLlm, tool_ids: Object.values(toolIds) },
        dynamic_variables: { dynamic_variable_placeholders: ATLAS_DYNAMIC_DEFAULTS },
      },
      conversation: { max_duration_seconds: 1800, client_events: CLIENT_EVENTS },
    },
    platform_settings: {
      auth: { enable_auth: true },
      overrides: { conversation_config_override: { conversation: { text_only: true }, agent: { first_message: true } } },
    },
  };

  let created = false;
  if (agentId) {
    await elevenJson("PATCH", `/v1/convai/agents/${agentId}`, body).catch((err) => {
      if (err instanceof ElevenError && err.status === 404 && !cfg.agentId) agentId = undefined;
      else throw err;
    });
  }
  if (!agentId) {
    const make = (model: string) =>
      elevenJson<{ agent_id: string }>("POST", "/v1/convai/agents/create", {
        name: `${s.owner.agencyName} – Atlas`,
        tags: ["mainstreet", "atlas", "operations"],
        ...body,
        conversation_config: { ...body.conversation_config, tts: { voice_id: cfg.agentVoice, model_id: model } },
      });
    const res = await make(cfg.agentTtsModel).catch((err) => {
      if (err instanceof ElevenError && err.status >= 400 && err.status < 500 && cfg.agentTtsModel !== "eleven_flash_v2_5") return make("eleven_flash_v2_5");
      throw err;
    });
    agentId = res.agent_id;
    created = true;
  }
  kvSet("voice_agent", { agentId, toolIds, mode, secretId: state.secretId, syncedAt: new Date().toISOString() } satisfies VoiceAgentState);
  log("system", `${created ? "Created" : "Updated"} Atlas in ElevenLabs with ${configs.length} ${mode} tools.`, { level: "success" });
  return { agentId: agentId!, created, tools: configs.length, mode };
}
