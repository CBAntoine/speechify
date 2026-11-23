import { answerApproval } from "@/review/runs.ts";
import { claude } from "@/lib/claude";
import { HttpError, readJson, route, str } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Allow or decline a call the review agent is waiting on. */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^sesn_[A-Za-z0-9]+$/.test(id)) throw new HttpError(400, "That isn't a review ID.");
  const b = await readJson<{ event_id?: string; allow?: boolean }>(req, 2_000);
  const eventId = str(b.event_id, 100);
  if (!/^sevt_[A-Za-z0-9]+$/.test(eventId)) throw new HttpError(400, "Say which call to answer.");
  await answerApproval(claude(), id, eventId, b.allow === true);
  return Response.json({ ok: true });
});
