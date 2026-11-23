import { cancel, enqueue, getJob, removeJob } from "@/server/app";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const job = getJob((await params).id);
  if (!job) return Response.json({ error: "No such job" }, { status: 404 });
  return Response.json(job);
}

/** {"action": "cancel" | "restart"} */
export async function POST(req: Request, { params }: Ctx) {
  const id = (await params).id;
  const job = getJob(id);
  if (!job) return Response.json({ error: "No such job" }, { status: 404 });
  const { action } = ((await req.json().catch(() => ({}))) ?? {}) as { action?: string };
  if (action === "cancel") cancel(id);
  else if (action === "restart") enqueue(id);
  else return Response.json({ error: "Unknown action" }, { status: 400 });
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const ok = removeJob((await params).id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Can't delete a running job" }, { status: 409 });
}
