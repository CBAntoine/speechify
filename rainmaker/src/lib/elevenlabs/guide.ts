import "server-only";
import { GUIDE_DATA_COLLECTION, answerLooksUnsure, guideFirstMessage, guidePrompt, type GuideFacts } from "@/lib/offers/guide-content";
import { PRIVATE_TEXT_OK } from "./agent-sync";
import { AGENT_LLM, AGENT_TTS_FALLBACK, AGENT_TTS_MODEL, CLIENT_EVENTS, DEFAULT_AGENT_VOICE, ElevenError, eleven } from "./client";

// ElevenLabs side of the AI Website Guide offer: the knowledge base, the
// agent (chat and voice, says it's an AI, collects visitors' details), test
// questions run as simulated conversations, the conversations it has had,
// and putting it on the business's real website.

export interface KbRef {
  id: string;
  name: string;
}

const kbList = (kb: KbRef[]) => kb.map((k) => ({ type: "text", name: k.name, id: k.id, usage_mode: "auto" }));

export async function createKnowledgeText(name: string, text: string): Promise<KbRef> {
  const doc = await eleven<{ id: string }>("POST", "/v1/convai/knowledge-base/text", { name, text }, 60_000);
  if (!doc.id) throw new ElevenError("ElevenLabs didn't return the knowledge base", 502);
  return { id: doc.id, name };
}

export async function deleteKnowledge(id: string): Promise<void> {
  await eleven("DELETE", `/v1/convai/knowledge-base/${id}?force=true`).catch((err) => {
    if (!(err instanceof ElevenError && err.status === 404)) throw err;
  });
}

/** Website settings for the live widget: near the top of the page, with the playbook's call to action. */
const LIVE_WIDGET = {
  placement: "top-right",
  action_text: "👋 Click here for a quick answer",
  text_input_enabled: true,
  supports_text_only: true,
  transcript_enabled: true,
};

/** A demo guide: private (the demo page gets one-conversation credentials), typing allowed, 5-minute chats. */
export async function createGuideAgent(f: GuideFacts, kb: KbRef[], tags: string[] = []): Promise<string> {
  const body = (model: string) => ({
    name: `${f.business} – ${f.name}, AI Guide (demo)`,
    tags: ["rainmaker", "guide", "demo", ...tags].filter(Boolean).slice(0, 10),
    conversation_config: {
      agent: {
        first_message: guideFirstMessage(f.name, f.business),
        language: "en",
        prompt: { prompt: guidePrompt(f, "demo"), llm: AGENT_LLM, knowledge_base: kbList(kb) },
      },
      tts: { voice_id: DEFAULT_AGENT_VOICE, model_id: model },
      conversation: { client_events: CLIENT_EVENTS, max_duration_seconds: 300 },
    },
    platform_settings: { ...PRIVATE_TEXT_OK, data_collection: GUIDE_DATA_COLLECTION },
  });
  const create = (model: string) => eleven<{ agent_id: string }>("POST", "/v1/convai/agents/create", body(model), 60_000);
  const res = await create(AGENT_TTS_MODEL).catch((err) => {
    if (err instanceof ElevenError && err.status >= 400 && err.status < 500 && AGENT_TTS_MODEL !== AGENT_TTS_FALLBACK) return create(AGENT_TTS_FALLBACK);
    throw err;
  });
  return res.agent_id;
}

type Turn = { role?: string; message?: string | null };

/** How ElevenLabs grades each test answer. */
const GOOD_ANSWER =
  "The agent answers the visitor's question with specific, concrete information about the business (services, prices, hours, areas, policies), in a few sentences. When the visitor asks for a callback, a quote or a booking, it acknowledges their details and says the team will follow up. Saying it doesn't know, deferring the question to the team, or telling the visitor to call or check the website instead of answering counts as a failure.";

export interface QuestionResult {
  q: string;
  answer?: string;
  passed: boolean;
  /** The grader's reason, when it has one. */
  note?: string;
}

type TestRun = {
  test_id: string;
  status: "pending" | "passed" | "failed" | "cancelled";
  agent_responses?: Turn[] | null;
  condition_result?: { result?: string; rationale?: { summary?: string; messages?: string[] } | null } | null;
};

/**
 * Ask the guide each question the way a visitor would, as ElevenLabs agent
 * tests (one per question, run together and graded), and return its
 * answers. The tests are deleted afterwards.
 */
export async function testGuideQuestions(agentId: string, opener: string, questions: string[], label: string): Promise<QuestionResult[]> {
  const tests = await Promise.all(
    questions.map(async (q, i) => {
      const t = await eleven<{ id: string }>("POST", "/v1/convai/agent-testing/create", {
        type: "llm",
        name: `${label} · Q${i + 1}`.slice(0, 120),
        chat_history: [
          { role: "agent", message: opener, time_in_call_secs: 0 },
          { role: "user", message: q, time_in_call_secs: 5 },
        ],
        success_condition: GOOD_ANSWER,
        success_examples: [{ type: "success", response: "Yes, we do. A tune-up is $149 and takes about an hour. Would you like to book one? I can take your name and number." }],
        failure_examples: [{ type: "failure", response: "I'm not sure about that. Please call the office or check the website." }],
      });
      return { q, id: t.id };
    })
  );
  try {
    const inv = await eleven<{ id: string; test_runs: TestRun[] }>("POST", `/v1/convai/agents/${agentId}/run-tests`, { name: label.slice(0, 120), tests: tests.map((t) => ({ test_id: t.id })) }, 60_000);
    let runs = inv.test_runs ?? [];
    const deadline = Date.now() + 150_000;
    while ((!runs.length || runs.some((r) => r.status === "pending")) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2500));
      runs = (await eleven<{ test_runs: TestRun[] }>("GET", `/v1/convai/test-invocations/${inv.id}`, undefined, 20_000)).test_runs ?? runs;
    }
    return tests.map(({ q, id }) => {
      const run = runs.find((r) => r.test_id === id);
      const answer = run?.agent_responses?.find((t) => t.role === "agent" && t.message?.trim())?.message?.trim();
      const why = run?.condition_result?.rationale;
      const note = run?.status === "pending" ? "Still running when time ran out. Test again." : why?.summary || why?.messages?.[0] || undefined;
      return { q, answer, passed: run?.status === "passed", note };
    });
  } finally {
    await Promise.all(tests.map((t) => eleven("DELETE", `/v1/convai/agent-testing/${t.id}`).catch(() => undefined)));
  }
}

export interface GuideConversation {
  id: string;
  at: string;
  durationSecs: number;
  title?: string;
  summary?: string;
  contact: { name?: string; phone?: string; email?: string; need?: string };
}

type Collected = Record<string, { value?: unknown } | undefined> | null | undefined;
const pick = (d: Collected, key: string) => {
  const v = d?.[key]?.value;
  return typeof v === "string" && v.trim() && !/^(none|n\/a|unknown|empty|null)$/i.test(v.trim()) ? v.trim().slice(0, 200) : undefined;
};

/** The guide's recent conversations, newest first, with the contact details each one captured. */
export async function guideConversations(agentId: string, max = 50): Promise<GuideConversation[]> {
  const r = await eleven<{
    conversations?: {
      conversation_id: string;
      start_time_unix_secs: number;
      call_duration_secs: number;
      call_summary_title?: string | null;
      transcript_summary?: string | null;
      data_collection_results?: Collected;
    }[];
  }>("GET", `/v1/convai/conversations?agent_id=${encodeURIComponent(agentId)}&page_size=${max}`, undefined, 20_000);
  return (r.conversations ?? []).map((c) => ({
    id: c.conversation_id,
    at: new Date(c.start_time_unix_secs * 1000).toISOString(),
    durationSecs: c.call_duration_secs,
    title: c.call_summary_title ?? undefined,
    summary: c.transcript_summary ?? undefined,
    contact: {
      name: pick(c.data_collection_results, "visitor_name"),
      phone: pick(c.data_collection_results, "phone"),
      email: pick(c.data_collection_results, "email"),
      need: pick(c.data_collection_results, "need"),
    },
  }));
}

/** Visitors' questions the guide couldn't answer, from a few recent conversations: gaps in its knowledge base. */
export async function unansweredQuestions(conversationIds: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of conversationIds.slice(0, 10)) {
    const c = await eleven<{ transcript?: Turn[] }>("GET", `/v1/convai/conversations/${id}`, undefined, 20_000).catch(() => undefined);
    const t = c?.transcript ?? [];
    t.forEach((turn, i) => {
      const next = t.slice(i + 1).find((x) => x.role === "agent" && x.message?.trim());
      const q = turn.message?.trim();
      if (turn.role === "user" && q && next?.message && answerLooksUnsure(next.message) && !out.some((x) => x.toLowerCase() === q.toLowerCase())) {
        out.push(q.slice(0, 300));
      }
    });
  }
  return out.slice(0, 20);
}

/** Add an answer document to the guide's knowledge base. */
export async function addGuideKnowledge(agentId: string, kb: KbRef[], name: string, text: string): Promise<KbRef[]> {
  const doc = await createKnowledgeText(name, text);
  const next = [...kb, doc];
  await eleven("PATCH", `/v1/convai/agents/${agentId}`, { conversation_config: { agent: { prompt: { knowledge_base: kbList(next) } } } });
  return next;
}

/**
 * Put the guide on the business's real website for the trial: public, but
 * only on the hosts given (their domain, and this app so the demo page keeps
 * working), with the live instructions and widget settings.
 */
export async function putGuideOnSite(agentId: string, f: GuideFacts, kb: KbRef[], hosts: string[]): Promise<void> {
  const allowlist = [...new Set(hosts.map((h) => h.toLowerCase()).filter(Boolean))].map((hostname) => ({ hostname }));
  await eleven("PATCH", `/v1/convai/agents/${agentId}`, {
    name: `${f.business} – ${f.name}, AI Guide`,
    tags: ["rainmaker", "guide", "live"],
    conversation_config: {
      agent: { prompt: { prompt: guidePrompt(f, "live"), llm: AGENT_LLM, knowledge_base: kbList(kb) } },
      conversation: { client_events: CLIENT_EVENTS, max_duration_seconds: 900 },
    },
    platform_settings: {
      auth: { enable_auth: false, allowlist },
      overrides: PRIVATE_TEXT_OK.overrides,
      data_collection: GUIDE_DATA_COLLECTION,
      // Links it shares in chat are clickable only for these hosts: their own site.
      widget: { ...LIVE_WIDGET, markdown_link_allowed_hosts: allowlist },
    },
  });
}

/** The two lines that put the guide on any website. */
export function embedSnippet(agentId: string): string {
  return `<elevenlabs-convai agent-id="${agentId}"></elevenlabs-convai>\n<script src="https://unpkg.com/@elevenlabs/convai-widget-embed" async type="text/javascript"></script>`;
}
