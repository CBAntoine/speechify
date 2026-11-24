import { deleteAssets } from "@/lib/assets";
import { deleteElevenResources } from "@/lib/elevenlabs/cleanup";
import { planFresh, startFresh } from "@/lib/fresh";
import { HttpError, readBody, route } from "@/lib/http";
import { addActivity } from "@/lib/repo";
import { readDb, update } from "@/lib/store";

// Settings → Start fresh. GET: what it would delete. POST { confirm: "DELETE" }:
// delete every lead (paying clients stay) with its drafts, tasks, ad
// campaigns and activity, then their ElevenLabs demo agents. Signed-in owner only.

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const GET = route(async () => {
  const p = planFresh(await readDb());
  return Response.json({ ...p, agents: p.agents.length, knowledge: p.knowledge.length, assets: p.assets.length });
});

export const POST = route(async (req: Request) => {
  const b = await readBody<{ confirm?: string }>(req);
  if (String(b.confirm ?? "").trim().toUpperCase() !== "DELETE") throw new HttpError(400, 'Type DELETE to confirm');
  const done = await update((db) => startFresh(db));
  const eleven = await deleteElevenResources(done);
  await deleteAssets(done.assets).catch(() => undefined);
  await addActivity({ kind: "system", text: `You started fresh: deleted ${done.leads} lead${done.leads === 1 ? "" : "s"}${done.keptClients.length ? ` (kept ${done.keptClients.length} paying client${done.keptClients.length === 1 ? "" : "s"})` : ""}` });
  return Response.json({ ...done, agents: done.agents.length, knowledge: done.knowledge.length, assets: done.assets.length, eleven });
});
