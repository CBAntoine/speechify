import "server-only";
import { TOOLS } from "@/lib/agents/tools";
import { GUIDE } from "./guide";
import { COPILOT_CRM_TOOLS, SCREEN_IDS, SCREENS, type CopilotToolName } from "./screens";

// The Rainmaker copilot: an ElevenLabs agent (voice and chat) that drives the
// CRM for the owner. Its tools run in the owner's browser: screen tools act on
// the page, CRM tools call /api/copilot/tool (the same tools the Claude agents
// use). Change it here, then press "Sync copilot" in Settings.

/** {{briefing}} is what changed since the owner last talked to it (src/lib/copilot/briefing.ts). */
export const COPILOT_FIRST_MESSAGE = "Hi {{owner_name}}. {{briefing}} What should we work on?";

export const COPILOT_DYNAMIC_DEFAULTS = {
  owner_name: "there",
  agency_name: "your agency",
  today: "today",
  current_screen: "Today",
  briefing: "I'm your Rainmaker copilot.",
};

export const COPILOT_PROMPT = `# Personality
You are the Rainmaker copilot for {{agency_name}}: a sharp, calm operator who knows every screen, feature and workflow of Rainmaker, the CRM {{owner_name}} uses to find clients and sell AI services. You get things done in the app for them and explain only what's useful.

# Environment
You are inside the Rainmaker app with {{owner_name}}, who talks to you by voice or types. You can see and drive their screen with tools. They are on: {{current_screen}}. Today is {{today}}.
You opened with this update: {{briefing}} If they ask what's new or what needs attention, call get_app_state for the details.
Screens: ${SCREENS.map((s) => s.label).join(", ")}. The public store opens in a new tab.

# Tone
- Voice: one or two short sentences, then stop or ask what's next. Text: brief and plain.
- Never more than three items aloud; offer to show the rest on screen.
- Say what you did, in the past tense, only after a tool confirms it.
- Never read ids, URLs or JSON aloud.

# Goal
Do what {{owner_name}} asks inside Rainmaker, quickly and correctly:
1. Understand the request. If it's ambiguous and the choice matters (which lead, which city, which plan), ask one short question.
2. Get the facts. Call get_app_state for anything about their business: pipeline, inbox, tasks, Autopilot, store, sales, what's connected. Call how_to for how a feature works. This step is important: never guess numbers, names or features.
3. Act. Use the direct tools for data: find_businesses, save_leads, list_leads, get_lead, update_lead, draft_message, create_ad_campaign, create_task, list_tasks, audit_website, research_web, run_team_agent, and the AI website guide tools. For anything else (settings, switches, prices, Autopilot, sending or discarding a draft, store setup), go_to the screen, call read_screen, then click or fill the element ids it returns.
4. Show. After a change, go_to the screen where they can see it or point_to it, and say what changed in one sentence.

# Tools
- go_to opens a screen. Pass lead_id to open a lead, campaign_id to open a campaign, niche and location with search true to run a search on screen, agent and goal to prefill an agent.
- read_screen returns the visible text and element ids for buttons, links, fields, switches and tabs. Ids change after every read, so read again after navigating or after the page changes.
- click and fill act on an element id from the latest read_screen. Use click for switches, checkboxes and tabs. After a Save button, read_screen again to check it worked.
- point_to highlights an element. Use it when they ask where something is or want to do it themselves.
- get_app_state is a live snapshot; call it again after big changes.
- how_to topics: ${GUIDE.map((t) => t.id).join(", ")}.
- find_businesses can take a minute (it audits websites); create_ad_campaign and research_web up to two. Say it takes a minute before calling them.
- save_leads needs keys returned by find_businesses in this conversation.
- If a tool says a key or service isn't connected, say which key turns it on (how_to keys) and that it's set in their hosting settings.
- Cold call scripts: draft_message with channel call, from get_lead's facts.
- Video ads: create_video_ad makes a short video for a lead's owner from their real data, selling store products (up to 4). Say it takes a minute or two first. Then offer email_video_ad to draft the email with its link, or go_to ad_studio to show it.

# The AI website guide offer
A chat and voice guide on a business's website that answers visitors and passes them the leads. Pitch it as 10 to 20 percent more website leads, never as "AI".
1. estimate_ai_guide: fit and price. Need-to-have niches (HVAC, plumbing, roofing, auto repair) first. Ask for their monthly visitors if unknown.
2. build_ai_guide: reads their site and builds the guide and the private demo page. Say it takes a minute first.
3. test_ai_guide: the five demo questions. Fix weak answers with teach_ai_guide, then test again.
4. pitch_ai_guide: email, text and call script drafts with the demo link and the free trial, no credit card.
5. start_ai_guide_trial: only after {{owner_name}} says the business agreed and says yes to going live; then confirmed true.
6. ai_guide_report: weekly leads report and monthly upkeep; teach_ai_guide for questions it missed.
To show it, go_to pipeline with the lead_id: the AI website guide section is in the lead's Overview.

# Guardrails
- Confirm before anything that sends a message, deletes or discards something, cancels or refunds a subscription, changes prices, charges money, or turns on auto-send: ask "Should I go ahead?" and wait for a yes before calling click with confirmed true. This step is important.
- Never invent results, leads, numbers or features. If a tool fails, say so in one sentence and offer the next best step.
- Never type passwords, API keys or card numbers into fields; ask them to do that themselves.
- Rainmaker never calls or texts prospects: it drafts and emails, with an opt-out line and postal address. Voice clones need written consent.
- Stay on Rainmaker and their agency's work. For legal, tax or financial advice, say a professional should answer.`;

type Literal = { type: "string" | "integer" | "number" | "boolean"; description: string; enum?: string[] };
type Arr = { type: "array"; description: string; items: Literal | Obj | Arr };
type Obj = { type: "object"; description: string; properties: Record<string, Literal | Arr | Obj>; required: string[] };
export type ParamSchema = { type: "object"; properties: Record<string, Literal | Arr | Obj>; required: string[] };

export interface CopilotToolSpec {
  name: CopilotToolName;
  description: string;
  parameters?: ParamSchema;
  timeoutSecs: number;
  preToolSpeech?: "auto" | "force" | "off";
}

const human = (k: string) => k.replace(/_/g, " ");

type JsonIn = { type?: string; description?: string; enum?: string[]; items?: JsonIn; properties?: Record<string, JsonIn>; required?: string[] };

function prop(key: string, v: JsonIn): Literal | Arr | Obj {
  const description = v.description ?? human(key);
  if (v.type === "array") return { type: "array", description, items: v.items ? prop(`${key} item`, v.items) : { type: "string", description: "One item" } };
  if (v.type === "object") return { type: "object", description, properties: props(v.properties ?? {}), required: v.required ?? [] };
  const type = (["string", "integer", "number", "boolean"].includes(v.type ?? "") ? v.type : "string") as Literal["type"];
  return { type, description, ...(v.enum ? { enum: v.enum } : {}) };
}

function props(p: Record<string, JsonIn>): Record<string, Literal | Arr | Obj> {
  return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, prop(k, v)]));
}

/** The Claude agents' JSON Schema, in the shape ElevenLabs tool parameters take. */
export function elevenParams(schema: { properties: Record<string, unknown>; required?: string[] }): ParamSchema {
  return { type: "object", properties: props(schema.properties as Record<string, JsonIn>), required: schema.required ?? [] };
}

const SLOW: Partial<Record<CopilotToolName, number>> = {
  find_businesses: 120,
  create_ad_campaign: 120,
  research_web: 120,
  audit_website: 60,
  build_ai_guide: 120,
  test_ai_guide: 120,
  start_ai_guide_trial: 60,
  ai_guide_report: 60,
  teach_ai_guide: 45,
  create_video_ad: 120,
};

const id = (description: string): Literal => ({ type: "string", description });

export const COPILOT_TOOLS: CopilotToolSpec[] = [
  {
    name: "get_app_state",
    description:
      "A live snapshot of the user's Rainmaker: the screen they're on, pipeline by stage and value, hot leads, drafts waiting, tasks, Autopilot settings and last run, store status, prices and checkout links, sales and recurring revenue, recent agent runs, recent activity, and which services and keys are connected.",
    timeoutSecs: 20,
  },
  {
    name: "how_to",
    description: "Rainmaker's guide for one topic: what a screen or feature does, its button and field names, and how to use it.",
    parameters: { type: "object", properties: { topic: id(`One of: ${GUIDE.map((t) => t.id).join(", ")}. Or a short question.`) }, required: ["topic"] },
    timeoutSecs: 5,
  },
  {
    name: "go_to",
    description: "Open a Rainmaker screen on the user's screen, optionally a specific lead, campaign, search or agent goal. The public store opens in a new tab.",
    parameters: {
      type: "object",
      properties: {
        screen: { type: "string", enum: SCREEN_IDS, description: "Which screen to open." },
        lead_id: id("Pipeline or Ad Studio: open this lead."),
        campaign_id: id("Ad Studio: open this campaign."),
        niche: id("Find clients or Ad Studio: the niche, e.g. dentist, roofer, med spa."),
        location: id("Find clients or Ad Studio: city and province or state, e.g. Toronto, ON."),
        search: { type: "boolean", description: "Find clients: run the search on screen right away." },
        agent: { type: "string", enum: ["prospector", "outreach", "ads", "ops"], description: "Agents: which agent to select." },
        goal: id("Agents: a goal to prefill (it doesn't start until they press Run)."),
        product: id("Public store: a product or plan slug to open, e.g. ai-receptionist or growth."),
      },
      required: ["screen"],
    },
    timeoutSecs: 10,
  },
  {
    name: "read_screen",
    description:
      "Read the user's current screen: its name, the visible text, and the buttons, links, fields, switches and tabs with element ids for click, fill and point_to. An open panel or dialog is read first.",
    timeoutSecs: 10,
  },
  {
    name: "click",
    description:
      "Click a button, link, tab, switch or checkbox by element id from the latest read_screen. Clicks that send, delete, discard, cancel, pay or turn on auto-send are refused unless confirmed is true, which you only set after the user said yes.",
    parameters: {
      type: "object",
      properties: {
        element_id: id("Element id from read_screen, e.g. e12."),
        confirmed: { type: "boolean", description: "True only after the user explicitly confirmed this action." },
      },
      required: ["element_id"],
    },
    timeoutSecs: 10,
  },
  {
    name: "fill",
    description: "Type into a text field or text area, or choose an option in a dropdown, by element id from the latest read_screen. Replaces what's there.",
    parameters: {
      type: "object",
      properties: { element_id: id("Element id from read_screen."), value: id("The text to enter, or the option to choose.") },
      required: ["element_id", "value"],
    },
    timeoutSecs: 10,
  },
  {
    name: "point_to",
    description: "Scroll to and highlight an element on the user's screen, to show them where something is.",
    parameters: { type: "object", properties: { element_id: id("Element id from read_screen.") }, required: ["element_id"] },
    timeoutSecs: 10,
  },
  {
    name: "run_team_agent",
    description:
      "Start one of Rainmaker's Claude agents on a goal and open the Agents screen to watch it: prospector (finds and saves businesses), outreach (drafts messages for approval), ads (writes campaigns), ops (reviews the pipeline and plans next steps). Each run spends Claude credits, up to its budget: say which agent and goal, ask \"Should I go ahead?\", and pass confirmed true only after a yes.",
    parameters: {
      type: "object",
      properties: {
        agent: { type: "string", enum: ["prospector", "outreach", "ads", "ops"], description: "Which agent." },
        goal: id("The goal in plain English, e.g. Find 15 roofers in Calgary with no online booking."),
        confirmed: { type: "boolean", description: "True only after the user said yes to this agent and goal." },
      },
      required: ["agent", "goal", "confirmed"],
    },
    timeoutSecs: 20,
  },
  ...COPILOT_CRM_TOOLS.map((name) => ({
    name,
    description: TOOLS[name].description,
    parameters: elevenParams(TOOLS[name].input_schema),
    timeoutSecs: SLOW[name] ?? 30,
    ...(SLOW[name] ? { preToolSpeech: "force" as const } : {}),
  })),
];
