import { createTask, listTasks } from "@/lib/repo";
import { HttpError, readBody, route } from "@/lib/http";

export const GET = route(async () => Response.json({ tasks: await listTasks() }));

export const POST = route(async (req: Request) => {
  const b = await readBody<{ title?: string; leadId?: string; due?: string }>(req);
  if (!b.title?.trim()) throw new HttpError(400, "Give the task a title");
  return Response.json({ task: await createTask({ title: b.title.trim().slice(0, 200), leadId: b.leadId, due: b.due, createdBy: "user" }) });
});
