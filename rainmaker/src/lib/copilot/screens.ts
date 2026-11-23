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
  { id: "settings", label: "Settings", path: "/settings", aliases: ["settings", "profile", "agency profile"] },
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
  "estimate_ai_guide",
  "build_ai_guide",
  "test_ai_guide",
  "pitch_ai_guide",
  "start_ai_guide_trial",
  "ai_guide_report",
  "teach_ai_guide",
] as const;
export type CopilotCrmTool = (typeof COPILOT_CRM_TOOLS)[number];
export type CopilotToolName = (typeof COPILOT_UI_TOOLS)[number] | CopilotCrmTool;
