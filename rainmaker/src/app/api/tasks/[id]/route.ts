import { updateTask } from "@/lib/repo";
import { readBody, route, type IdParams } from "@/lib/http";

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const b = await readBody<{ done?: boolean; title?: string; due?: string }>(req);
  const patch: { done?: boolean; title?: string; due?: string } = {};
  if (typeof b.done === "boolean") patch.done = b.done;
  if (typeof b.title === "string" && b.title.trim()) patch.title = b.title.trim();
  if (typeof b.due === "string") patch.due = b.due;
  return Response.json({ task: await updateTask((await params).id, patch) });
});
