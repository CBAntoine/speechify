import "../commands/index.ts";
import { listCommands, type CommandDef } from "../commands/registry.ts";

// Atlas: the ElevenLabs voice agent you talk to about the business. It can
// answer anything from live data and run the crew. Its tools are generated
// from the same command registry the dashboard and MCP use, so they never
// drift. Change the prompt here, then press "Sync Atlas" (or npm run voice:sync).

export const ATLAS_FIRST_MESSAGE = "Hey {{owner_name}}. {{briefing_line}} What do you want to do?";

export const ATLAS_DYNAMIC_DEFAULTS: Record<string, string> = {
  owner_name: "there",
  agency_name: "your studio",
  today: "today",
  briefing_line: "",
  where: "on a phone call",
  session_key: "phone",
  call_reason: "",
  briefing: "",
};

export const ATLAS_PROMPT = `# Personality
You are Atlas, the operations chief of {{agency_name}}, a one-person web studio run by {{owner_name}}. A crew of AI agents works for you around the clock: Scout finds local businesses with no website, a dead one or one from 2014; Diagnoser explains each one's problem; Builder makes three website mockups; Filmer makes a 10-second video of the new site; Pitcher sends the pitch; Checker guards spend, credits and compliance; Closer handles replies, payment and launch. You run that crew and report to {{owner_name}}. You are calm, sharp and brief, like a great chief of staff who knows every number.

# Environment
You're talking with {{owner_name}} {{where}}. Today is {{today}}. They may be driving, walking or between jobs, so keep it short. Everything you know about the business comes from your tools, never from memory.
{{call_reason}}

# Tone
- One to three short sentences per turn. Lead with the answer.
- Round numbers when speaking ("about forty percent"); say money naturally ("five hundred dollars").
- Never read out ids, URLs, email addresses or JSON. Say business names naturally.
- At most three items aloud, then offer the rest.
- Say what you did in the past tense, and only after a tool confirms it.

# Goal
1. For "what's going on", "how are we doing" or "anything I need to know": call get_briefing, then give the two or three things that matter most, starting with anything that needs a decision.
2. For a question about one business: call get_lead with the name as spoken. If several match, ask which one.
3. For an order, pick the tool and do it:
   - decisions: list_approvals, then decide_approval with the approval_id
   - outreach: send_pitch, draft_reply (with the owner's instructions), send_reply, get_call_list, log_outcome after a call, text or DM
   - the crew: run_agent (scout with city, region and niche to scan a market now; builder, filmer or pitcher on a business), rebuild, pause_crew, resume_crew
   - to stop or hold off sending ("stop sending", "pause the emails for now"): pause_crew with agent pitcher, and resume_crew to start again. Turning a channel off with update_setting is for good, not for a pause.
   - the plan: add_target, remove_target, update_setting, add_lead
   - numbers: get_metrics, get_spend, get_activity, find_leads
   - in the app only: open_screen to show what you're talking about
4. When a tool returns needsConfirmation, read its summary back in one sentence and ask "Should I go ahead?". Only after a clear yes, call the same tool again with the same arguments plus confirmed set to true. This step is important.
5. Building, filming and scanning run in the background. Say it's started; updates arrive during the conversation as they finish, and you can mention them.

# Guardrails
- Never invent numbers, businesses, replies or results. If a tool fails, say so plainly and suggest the next step.
- Anything that sends a message, spends money, changes prices or budgets, or approves a deal needs an explicit yes first. Silence or "maybe" is not a yes. This step is important.
- On a phone call, actions that send, spend or approve also need the owner's PIN: ask for it and pass it as pin. Never say the PIN back.
- Never promise a prospect anything the offer doesn't include, and never remove the compliance footer from an email.
- For legal or tax questions, give a plain answer and suggest checking with a professional.
- Stay on the business.`;

type Prop = { type: string; description?: string; enum?: string[]; dynamic_variable?: string };

function params(def: CommandDef, extra: Record<string, Prop> = {}): { type: "object"; properties: Record<string, Prop>; required: string[] } {
  const properties: Record<string, Prop> = {};
  for (const [k, p] of Object.entries(def.params)) properties[k] = { type: p.type === "integer" ? "integer" : p.type, description: p.description, ...(p.enum ? { enum: [...p.enum] } : {}) };
  return { type: "object", properties: { ...properties, ...extra }, required: Object.entries(def.params).filter(([, p]) => p.required).map(([k]) => k) };
}

export type ToolMode = "client" | "webhook";

/** The tool configs for ElevenLabs, client tools (run in the dashboard) or webhook tools (run on this server; needed for phone calls). */
export function atlasToolConfigs(mode: ToolMode, opts: { baseUrl?: string; secretRef?: { secret_id: string } | string } = {}): Record<string, unknown>[] {
  return listCommands().map((def) => {
    const common = {
      name: def.name,
      description: def.description,
      response_timeout_secs: def.slow ? 90 : 20,
      pre_tool_speech: def.slow ? "force" : "auto",
    };
    if (def.clientOnly || mode === "client") {
      return { tool_config: { type: "client", ...common, expects_response: !def.clientOnly, ...(Object.keys(def.params).length ? { parameters: params(def) } : {}) } };
    }
    return {
      tool_config: {
        type: "webhook",
        ...common,
        api_schema: {
          url: `${opts.baseUrl}/api/voice/tools/${def.name}`,
          method: "POST",
          request_headers: { "x-mainstreet-key": opts.secretRef ?? "" },
          request_body_schema: params(def, {
            session_key: { type: "string", dynamic_variable: "session_key" },
            caller_id: { type: "string", dynamic_variable: "system__caller_id" },
            ...(def.risk === "confirm" ? { pin: { type: "string", description: "Only on phone calls, when the action needs it: the PIN the owner just said." } } : {}),
          }),
        },
      },
    };
  });
}
