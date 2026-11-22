import { elevenEnabled } from "@/lib/config";
import { eleven } from "@/lib/elevenlabs/client";
import { resolveSalesAgentId, syncSalesAgent } from "@/lib/elevenlabs/sales-agent";
import { HttpError, route } from "@/lib/http";
import { getProfile } from "@/lib/repo";
import { readDb } from "@/lib/store";

export const maxDuration = 60;

/** Is the store's sales assistant reachable with this API key? */
export const GET = route(async () => {
  const agentId = await resolveSalesAgentId();
  const db = await readDb();
  if (!elevenEnabled()) return Response.json({ connected: false, agentId, reason: "Add ELEVENLABS_API_KEY" });
  if (!agentId) return Response.json({ connected: false, reason: "No sales assistant yet: press Sync to create one" });
  try {
    const a = await eleven<{ name?: string }>("GET", `/v1/convai/agents/${agentId}`);
    return Response.json({ connected: true, agentId, name: a.name, syncedAt: db.store.salesAgent?.syncedAt });
  } catch (err) {
    return Response.json({ connected: false, agentId, reason: err instanceof Error ? err.message : String(err) });
  }
});

/** Create the assistant, or push the prompt and tools from the code to it. */
export const POST = route(async () => {
  if (!elevenEnabled()) throw new HttpError(400, "Add ELEVENLABS_API_KEY first");
  const res = await syncSalesAgent((await getProfile()).agencyName);
  return Response.json(res);
});
