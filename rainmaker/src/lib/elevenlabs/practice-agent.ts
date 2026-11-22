import "server-only";
import { readDb, update } from "@/lib/store";
import { syncClientAgent } from "./agent-sync";
import { AGENT_LLM, CLIENT_EVENTS } from "./client";

// The sales-practice partner: one ElevenLabs agent that plays a realistic
// customer for any client, scenario and language, set per call with dynamic
// variables. Private (one-conversation tokens only). Created the first time
// someone starts a practice call.

export const PRACTICE_PROMPT = `# Personality
You are {{customer_name}}, a customer contacting {{business}}, a {{niche}}. You are role-playing so a staff member of {{business}} can practise sales conversations. Sound like a real person: everyday words, short answers, a little hesitation now and then.

# Environment
A staff member of {{business}} is practising with you on a call or chat. They know it's practice. Everything you say is part of the role-play.

# Scenario
{{scenario_brief}}

# Goal
Make them earn the booking:
1. Answer their questions honestly within the scenario.
2. Share details (your situation, timing, budget, worries) only when they ask good questions.
3. Raise the scenario's concern at a natural moment.
4. Agree to book only if they clearly ask for the booking and handle your concern. If they never ask, end politely without booking.

# Guardrails
- Stay in character as the customer the whole time. Never coach, score or give feedback during the call. This step is important.
- Speak {{language}}.
- Keep each turn to one to three sentences.
- If they say "end practice" or "stop the role-play", say goodbye in one sentence.
- Use only a made-up first name and the scenario's details; never ask for or give real personal data.`;

export const PRACTICE_DEFAULTS = {
  business: "the business",
  niche: "local business",
  scenario_brief: "You're comparing a few businesses and want to know the price.",
  customer_name: "Jordan",
  language: "English",
  opening_line: "Hi, how much do you charge?",
};

function body(toolIds: string[]) {
  return {
    conversation_config: {
      agent: {
        first_message: "{{opening_line}}",
        language: "en",
        prompt: { prompt: PRACTICE_PROMPT, llm: AGENT_LLM, tool_ids: toolIds },
        dynamic_variables: { dynamic_variable_placeholders: PRACTICE_DEFAULTS },
      },
      conversation: { max_duration_seconds: 900, client_events: CLIENT_EVENTS },
    },
    platform_settings: {
      auth: { enable_auth: true },
      overrides: { conversation_config_override: { agent: { language: true }, conversation: { text_only: true } } },
    },
  };
}

export async function practiceAgentId(): Promise<string | undefined> {
  return process.env.ELEVENLABS_PRACTICE_AGENT_ID || (await readDb()).practiceAgent?.agentId;
}

/** The practice agent's id, creating (or updating) it in ElevenLabs when needed. */
export async function ensurePracticeAgent(agencyName: string, force = false): Promise<string> {
  const current = await practiceAgentId();
  if (current && !force) return current;
  const res = await syncClientAgent({
    current,
    pinned: Boolean(process.env.ELEVENLABS_PRACTICE_AGENT_ID),
    tools: [],
    body,
    create: { name: `${agencyName} – Sales practice partner`, tags: ["rainmaker", "practice", "coaching"] },
  });
  await update((db) => {
    db.practiceAgent = { agentId: res.agentId, syncedAt: new Date().toISOString() };
  });
  return res.agentId;
}
