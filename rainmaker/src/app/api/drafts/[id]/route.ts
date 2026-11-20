import { updateDraft } from "@/lib/repo";
import { readBody, route, type IdParams } from "@/lib/http";
import type { Draft } from "@/lib/types";

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const b = await readBody<Partial<Pick<Draft, "subject" | "body" | "to" | "status">>>(req);
  const patch: Partial<Pick<Draft, "subject" | "body" | "to" | "status">> = {};
  if (typeof b.subject === "string") patch.subject = b.subject;
  if (typeof b.body === "string") patch.body = b.body;
  if (typeof b.to === "string") patch.to = b.to;
  if (b.status === "discarded" || b.status === "pending") patch.status = b.status;
  return Response.json({ draft: await updateDraft((await params).id, patch) });
});
