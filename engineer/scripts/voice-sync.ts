/**
 * Create the engineer voice agent in ElevenLabs, or push its prompt, tools and
 * tests from src/voice/ to the agent that already exists.
 *
 *   ELEVENLABS_API_KEY=... npm run voice:sync
 *
 * The agent, tool and test IDs are saved in voice-agent.json (not secret;
 * commit it). ELEVENLABS_AGENT_ID overrides the saved agent.
 */
import { AGENT_LLM, AGENT_NAME, CLIENT_EVENTS, DYNAMIC_DEFAULTS, FIRST_MESSAGE, PLATFORM_SETTINGS, PROMPT, TOOLS, type ClientToolSpec } from "../src/voice/spec.ts";
import { TESTS, testBody } from "../src/voice/tests.ts";
import { ElevenError, eleven, fail, readSaved, requireKey, writeSaved, type Saved } from "./eleven.ts";

const TTS_MODEL = process.env.ELEVENLABS_AGENT_TTS_MODEL || "eleven_v4_turbo";
const TTS_FALLBACK = "eleven_flash_v2_5";

function toolConfig(t: ClientToolSpec) {
  return {
    tool_config: {
      type: "client",
      name: t.name,
      description: t.description,
      expects_response: true,
      response_timeout_secs: t.timeoutSecs,
      ...(t.preToolSpeech ? { pre_tool_speech: t.preToolSpeech } : {}),
      ...(t.parameters ? { parameters: t.parameters } : {}),
    },
  };
}

async function toolsOnAgent(agentId: string): Promise<Record<string, string>> {
  const agent = await eleven<{ conversation_config?: { agent?: { prompt?: { tool_ids?: string[] } } } }>("GET", `/v1/convai/agents/${agentId}`);
  const out: Record<string, string> = {};
  for (const id of agent.conversation_config?.agent?.prompt?.tool_ids ?? []) {
    const t = await eleven<{ tool_config?: { name?: string; type?: string } }>("GET", `/v1/convai/tools/${id}`).catch(() => undefined);
    if (t?.tool_config?.type === "client" && t.tool_config.name) out[t.tool_config.name] = id;
  }
  return out;
}

function agentBody(toolIds: string[], testIds: string[]) {
  return {
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE,
        language: "en",
        prompt: { prompt: PROMPT, llm: process.env.ELEVENLABS_AGENT_LLM || AGENT_LLM, tool_ids: toolIds },
        dynamic_variables: { dynamic_variable_placeholders: DYNAMIC_DEFAULTS },
      },
      // Working sessions run long; the person ends the conversation when done.
      conversation: { max_duration_seconds: 1800, client_events: CLIENT_EVENTS },
    },
    // The tests show on the agent's Tests tab and run from the dashboard too.
    platform_settings: { ...PLATFORM_SETTINGS, testing: { attached_tests: testIds.map((test_id) => ({ test_id })) } },
  };
}

/** Create or update each conversation test, keeping the IDs that still work. */
async function syncTests(toolIds: Record<string, string>, known: Record<string, string>): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of TESTS) {
    const body = testBody(t, toolIds);
    const existing = known[t.name];
    if (existing) {
      const ok = await eleven("PUT", `/v1/convai/agent-testing/${existing}`, body).then(
        () => true,
        () => false,
      );
      if (ok) {
        out[t.name] = existing;
        continue;
      }
    }
    out[t.name] = (await eleven<{ id: string }>("POST", "/v1/convai/agent-testing/create", body)).id;
  }
  return out;
}

async function main() {
  requireKey();
  const saved: Saved = readSaved();
  let agentId = process.env.ELEVENLABS_AGENT_ID || saved.agent_id;

  let known = { ...(saved.tool_ids ?? {}) };
  if (agentId) known = { ...known, ...(await toolsOnAgent(agentId).catch(() => ({}))) };
  const toolIds: Record<string, string> = {};
  for (const spec of TOOLS) {
    const existing = known[spec.name];
    if (existing) {
      const ok = await eleven("PATCH", `/v1/convai/tools/${existing}`, toolConfig(spec)).then(
        () => true,
        () => false,
      );
      if (ok) {
        toolIds[spec.name] = existing;
        continue;
      }
    }
    toolIds[spec.name] = (await eleven<{ id: string }>("POST", "/v1/convai/tools", toolConfig(spec))).id;
  }
  const ids = TOOLS.map((t) => toolIds[t.name]);

  // Tests don't depend on the agent. Saved tests from another workspace fail to update and are made afresh.
  const testIds = await syncTests(toolIds, saved.test_ids ?? {});
  const testList = TESTS.map((t) => testIds[t.name]);

  let created = false;
  if (agentId) {
    try {
      await eleven("PATCH", `/v1/convai/agents/${agentId}`, agentBody(ids, testList));
    } catch (err) {
      // A saved agent from another workspace: make a fresh one in this one.
      if (err instanceof ElevenError && err.status === 404 && !process.env.ELEVENLABS_AGENT_ID) agentId = undefined;
      else throw err;
    }
  }
  if (!agentId) {
    const body = agentBody(ids, testList);
    const voiceId = process.env.ELEVENLABS_VOICE_ID || saved.voice_id;
    const make = (model: string) =>
      eleven<{ agent_id: string }>("POST", "/v1/convai/agents/create", {
        name: AGENT_NAME,
        tags: ["engineer", "security", "fortigate"],
        ...body,
        conversation_config: { ...body.conversation_config, tts: { model_id: model, ...(voiceId ? { voice_id: voiceId } : {}) } },
      });
    const res = await make(TTS_MODEL).catch((err) => {
      if (err instanceof ElevenError && err.status >= 400 && err.status < 500 && TTS_MODEL !== TTS_FALLBACK) return make(TTS_FALLBACK);
      throw err;
    });
    agentId = res.agent_id;
    created = true;
  }

  writeSaved({ ...saved, agent_id: agentId, tool_ids: toolIds, test_ids: testIds, synced_at: new Date().toISOString() });
  console.log(
    `${created ? "Created" : "Updated"} ${AGENT_NAME} (${agentId}) with ${TOOLS.length} tools and ${TESTS.length} tests. Saved the IDs to voice-agent.json. Run npm run voice:test to check it.`,
  );
}

main().catch(fail);
