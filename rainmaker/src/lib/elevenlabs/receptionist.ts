import "server-only";
import { getNiche } from "@/lib/niches";
import { domainOf } from "@/lib/net";
import type { AuditResult } from "@/lib/types";
import { AGENT_LLM, AGENT_TTS_FALLBACK, AGENT_TTS_MODEL, CLIENT_EVENTS, DEFAULT_AGENT_VOICE, ElevenError, eleven } from "./client";

// An AI receptionist for one business, trained on its website. "demo" agents
// are what the agency shows a prospect (private link, 5-minute calls);
// "client" agents answer a paying customer's real calls.

export interface BusinessFacts {
  business: string;
  niche?: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  audit?: AuditResult;
  agencyName: string;
  /** The language callers speak most (ISO 639-1); default English. */
  lang?: string;
}

const LANGUAGE_NAMES: Record<string, string> = { en: "English", es: "Spanish", fr: "French", nl: "Dutch", da: "Danish" };

export function receptionistPrompt(f: BusinessFacts, mode: "demo" | "client"): string {
  const niche = getNiche(f.niche);
  const kind = niche && niche.id !== "custom" ? niche.label.toLowerCase() : "local business";
  const facts = [
    `- Business name: ${f.business}`,
    `- Type: ${kind}`,
    f.city || f.address ? `- Location: ${f.address ?? f.city}` : "",
    f.phone ? `- Main phone: ${f.phone}` : "",
    f.email ? `- Email: ${f.email}` : "",
    f.website ? `- Website: ${domainOf(f.website)}` : "",
    f.audit?.title ? `- Website title: ${f.audit.title}` : "",
    f.audit?.description ? `- Website description: ${f.audit.description}` : "",
    f.audit?.h1 ? `- Website headline: ${f.audit.h1}` : "",
    f.audit?.booking?.length ? `- Online booking tool on their site: ${f.audit.booking.join(", ")}` : "",
  ].filter(Boolean);
  const env =
    mode === "demo"
      ? `This is a demo that ${f.agencyName} built from ${f.business}'s public website, to show the owner how an AI receptionist would handle their calls. The person talking to you is probably the owner or a staff member trying it out. Behave exactly as you would with a real caller. If they ask what this is, explain that it's a demo ${f.agencyName} built from their public website, and that the real version would answer their phone line around the clock, connect to their booking system and send them a summary of every call.`
      : `You answer phone calls and website chats for ${f.business}. Callers are customers, prospective customers, suppliers and sometimes spam.`;
  return `# Personality
You are the virtual receptionist for ${f.business}, a ${kind}${f.city ? ` in ${f.city}` : ""}. You are friendly, calm and efficient, like the best front-desk person a caller has ever spoken to.

# Environment
${env}

# Tone
Short, natural sentences. One question at a time. Warm but quick: callers are often busy or stressed.
Speak ${LANGUAGE_NAMES[f.lang ?? "en"] ?? "English"} by default; if the caller speaks another language, answer in theirs.

# Goal
1. Greet the caller and find out what they need.
2. Answer questions using only the knowledge base (the business's website) and the facts below.
3. For bookings, collect the service, preferred day and time, name and phone number, and say the team will confirm the appointment.
4. For anything you can't answer (prices not listed, availability, policies), say you'll have the team get back to them and take a message: name, phone number (read it back), and the reason for the call.
5. If someone describes an emergency that puts a person in danger, tell them to call emergency services right away.
6. Before ending, sum up what happens next.

# Facts
${facts.join("\n")}

# Guardrails
- Never invent prices, availability, staff names, promotions or policies. If it isn't in the knowledge base or the facts, say you'll check with the team. This step is important.
- No medical, legal or financial advice: offer to have the right person call back.
- If asked whether you are a person, say you're ${f.business}'s virtual assistant.
- Ask only for the details needed to help.
- Stay on the topic of ${f.business}; politely steer back if the caller drifts.`;
}

export function receptionistFirstMessage(f: Pick<BusinessFacts, "business" | "lang">, mode: "demo" | "client"): string {
  if (f.lang === "es") return mode === "demo" ? `¡Gracias por llamar a ${f.business}! Le atiende la recepcionista virtual. ¿En qué le puedo ayudar?` : `¡Gracias por llamar a ${f.business}! ¿En qué le puedo ayudar?`;
  if (f.lang === "fr") return mode === "demo" ? `Merci d'appeler ${f.business}! Ici la réceptionniste virtuelle. Comment puis-je vous aider?` : `Merci d'appeler ${f.business}! Comment puis-je vous aider?`;
  return mode === "demo" ? `Thanks for calling ${f.business}! This is the virtual receptionist. How can I help you today?` : `Thanks for calling ${f.business}! How can I help you today?`;
}

async function knowledgeFromWebsite(f: BusinessFacts): Promise<{ id: string; name: string; type: "url" | "text" } | undefined> {
  if (f.website) {
    const name = `${f.business} website`;
    const doc = await eleven<{ id: string }>("POST", "/v1/convai/knowledge-base/url", { url: f.website, name }, 60_000).catch(() => undefined);
    if (doc?.id) return { id: doc.id, name, type: "url" };
  }
  const a = f.audit;
  const text = [
    `${f.business}`,
    a?.title,
    a?.description,
    a?.h1,
    f.address ?? f.city ? `Location: ${f.address ?? f.city}` : "",
    f.phone ? `Phone: ${f.phone}` : "",
    a?.emails?.length ? `Email: ${a.emails.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  if (text.length < 40) return undefined;
  const name = `${f.business} facts`;
  const doc = await eleven<{ id: string }>("POST", "/v1/convai/knowledge-base/text", { text, name }).catch(() => undefined);
  return doc?.id ? { id: doc.id, name, type: "text" } : undefined;
}

export async function createReceptionist(f: BusinessFacts, mode: "demo" | "client", tags: string[] = []): Promise<{ agentId: string; knowledgeBaseId?: string }> {
  const kb = await knowledgeFromWebsite(f);
  const body = (model: string) => ({
    name: `${f.business} – AI Receptionist${mode === "demo" ? " (demo)" : ""}`,
    tags: ["rainmaker", mode, ...tags].slice(0, 10),
    conversation_config: {
      agent: {
        first_message: receptionistFirstMessage(f, mode),
        language: f.lang && LANGUAGE_NAMES[f.lang] ? f.lang : "en",
        prompt: {
          prompt: receptionistPrompt(f, mode),
          llm: AGENT_LLM,
          ...(kb ? { knowledge_base: [{ type: kb.type, name: kb.name, id: kb.id, usage_mode: "auto" }] } : {}),
        },
      },
      tts: { voice_id: DEFAULT_AGENT_VOICE, model_id: model },
      conversation: { client_events: CLIENT_EVENTS, ...(mode === "demo" ? { max_duration_seconds: 300 } : {}) },
    },
    ...(mode === "demo" ? { platform_settings: { auth: { enable_auth: true } } } : {}),
  });
  const create = (model: string) => eleven<{ agent_id: string }>("POST", "/v1/convai/agents/create", body(model), 60_000);
  const res = await create(AGENT_TTS_MODEL).catch((err) => {
    if (err instanceof ElevenError && err.status >= 400 && err.status < 500 && AGENT_TTS_MODEL !== AGENT_TTS_FALLBACK) return create(AGENT_TTS_FALLBACK);
    throw err;
  });
  return { agentId: res.agent_id, knowledgeBaseId: kb?.id };
}

/** Turn a prospect's demo agent into their real receptionist once they pay. */
export async function promoteToClient(agentId: string, f: BusinessFacts): Promise<void> {
  await eleven("PATCH", `/v1/convai/agents/${agentId}`, {
    name: `${f.business} – AI Receptionist`,
    tags: ["rainmaker", "client"],
    conversation_config: {
      agent: { first_message: receptionistFirstMessage(f, "client"), prompt: { prompt: receptionistPrompt(f, "client") } },
      conversation: { max_duration_seconds: 1800, client_events: CLIENT_EVENTS },
    },
  });
}

export async function deleteAgent(agentId: string): Promise<void> {
  await eleven("DELETE", `/v1/convai/agents/${agentId}`).catch((err) => {
    if (!(err instanceof ElevenError && err.status === 404)) throw err;
  });
}

export function agentDashboardUrl(agentId: string): string {
  return `https://elevenlabs.io/app/agents/agents/${agentId}`;
}
