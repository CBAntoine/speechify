import { executeTool } from "@/lib/agents/tools";
import { COPILOT_CRM_TOOLS } from "@/lib/copilot/screens";
import { HttpError, readBody, route } from "@/lib/http";
import type { Prospect } from "@/lib/types";

// Runs one CRM tool for the copilot: the same tools, rules and validation as
// the Claude agents (nothing gets sent; messages become drafts). Signed-in
// owner only. find_businesses hands its results back to the browser, which
// passes the chosen ones to save_leads.

export const maxDuration = 300;

export const POST = route(async (req: Request) => {
  const b = await readBody<{ name?: string; input?: unknown; prospects?: unknown }>(req);
  const name = String(b.name ?? "");
  const allowed = [...COPILOT_CRM_TOOLS];
  if (!(allowed as string[]).includes(name)) throw new HttpError(400, `Unknown tool ${name}`);
  const prospects = new Map<string, Prospect>();
  for (const p of Array.isArray(b.prospects) ? b.prospects.slice(0, 60) : []) {
    const x = p as Prospect;
    if (x && typeof x.key === "string" && typeof x.name === "string") prospects.set(x.key, x);
  }
  const res = await executeTool(name, b.input ?? {}, { runId: "copilot", agentId: "copilot", prospects }, allowed);
  return Response.json({ ...res, prospects: name === "find_businesses" ? [...prospects.values()] : undefined });
});
