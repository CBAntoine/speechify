// The screens the copilot can open, shared by its prompt (server) and its
// go_to tool (browser).

export interface Screen {
  id: string;
  label: string;
  path: string;
  aliases: string[];
}

export const SCREENS: Screen[] = [
  { id: "today", label: "Today", path: "/", aliases: ["today", "home", "dashboard", "home page"] },
  { id: "find_clients", label: "Find clients", path: "/prospects", aliases: ["find clients", "find", "prospects", "prospecting", "search"] },
  { id: "pipeline", label: "Pipeline", path: "/pipeline", aliases: ["pipeline", "leads", "board", "deals", "crm"] },
  { id: "inbox", label: "Inbox", path: "/inbox", aliases: ["inbox", "drafts", "messages", "approvals", "tasks"] },
  { id: "ad_studio", label: "Ad Studio", path: "/ads", aliases: ["ad studio", "ads", "campaigns", "creative"] },
  { id: "agents", label: "Agents", path: "/agents", aliases: ["agents", "agent", "team"] },
  { id: "autopilot", label: "Autopilot", path: "/autopilot", aliases: ["autopilot", "automation"] },
  { id: "sales", label: "Sales", path: "/sales", aliases: ["sales", "orders", "revenue"] },
  { id: "store_and_pricing", label: "Store & pricing", path: "/sell", aliases: ["store and pricing", "store & pricing", "store settings", "pricing", "prices", "payments", "sell"] },
  { id: "playbooks", label: "Playbooks", path: "/playbooks", aliases: ["playbooks", "playbook"] },
  { id: "settings", label: "Settings", path: "/settings", aliases: ["settings", "profile", "agency profile", "api keys", "keys"] },
  { id: "public_store", label: "Public store", path: "/store", aliases: ["public store", "store page", "storefront", "sales page", "my store", "the store"] },
];

export const SCREEN_IDS = SCREENS.map((s) => s.id);

export function screenById(id: string | undefined): Screen | undefined {
  return SCREENS.find((s) => s.id === id);
}

/** The screen a path belongs to ("/pipeline?lead=…" is Pipeline). */
export function screenForPath(path: string): Screen {
  const p = path.split(/[?#]/)[0] || "/";
  if (p === "/") return SCREENS[0];
  return SCREENS.filter((s) => s.path !== "/" && (p === s.path || p.startsWith(`${s.path}/`))).sort((a, b) => b.path.length - a.path.length)[0] ?? SCREENS[0];
}

/** "take me to the inbox" → Inbox. Longest alias wins. */
export function matchScreen(text: string): Screen | undefined {
  const t = ` ${text.toLowerCase().replace(/[^a-z& ]+/g, " ").replace(/\s+/g, " ")} `;
  let best: { s: Screen; len: number } | undefined;
  for (const s of SCREENS) {
    for (const a of s.aliases) {
      if (t.includes(` ${a} `) && (!best || a.length > best.len)) best = { s, len: a.length };
    }
  }
  return best?.s;
}

/** Services whose keys go in Settings > API keys (ids match keys-core). */
export const KEY_SERVICES = [
  { id: "claude", name: "Claude", words: ["claude", "anthropic"] },
  { id: "elevenlabs", name: "ElevenLabs", words: ["elevenlabs", "eleven labs", "11labs", "11 labs", "voice"] },
  { id: "stripe", name: "Stripe", words: ["stripe"] },
  { id: "paypal", name: "PayPal", words: ["paypal", "pay pal"] },
  { id: "resend", name: "Resend", words: ["resend", "email sending", "sending email"] },
  { id: "places", name: "Google Places", words: ["google places", "places", "google maps", "google"] },
] as const;

export const KEY_SERVICE_IDS = KEY_SERVICES.map((k) => k.id);

/** "add my Stripe key" → Stripe; null when the text isn't about a key. */
export function matchKeyService(text: string): (typeof KEY_SERVICES)[number] | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ")} `;
  if (!/ (api key|api keys|key|keys|token|secret|client id|credentials?) /.test(t)) return null;
  let best: { k: (typeof KEY_SERVICES)[number]; len: number } | null = null;
  for (const k of KEY_SERVICES) for (const w of k.words) if (t.includes(` ${w} `) && (!best || w.length > best.len)) best = { k, len: w.length };
  return best?.k ?? null;
}

/** The copilot's tools, by where they run. */
export const COPILOT_UI_TOOLS = ["get_app_state", "how_to", "go_to", "read_screen", "click", "fill", "point_to", "run_team_agent"] as const;
export const COPILOT_CRM_TOOLS = [
  "find_businesses",
  "save_leads",
  "list_leads",
  "get_lead",
  "update_lead",
  "draft_message",
  "create_ad_campaign",
  "create_task",
  "list_tasks",
  "audit_website",
  "research_web",
] as const;
export type CopilotCrmTool = (typeof COPILOT_CRM_TOOLS)[number];
export type CopilotToolName = (typeof COPILOT_UI_TOOLS)[number] | CopilotCrmTool;
