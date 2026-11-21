import { after } from "next/server";
import { followUp, getRun, stopRun } from "@/lib/agents/runner";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";

export const maxDuration = 300;

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const run = await getRun((await params).id);
  if (!run) throw new HttpError(404, "Run not found");
  return Response.json({ run });
});

export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const b = await readBody<{ action?: "message" | "stop"; text?: string }>(req);
  if (b.action === "stop") {
    await stopRun(id);
    return Response.json({ run: await getRun(id) });
  }
  if (!b.text?.trim()) throw new HttpError(400, "Write a message for the agent");
  const { run, done } = await followUp(id, b.text);
  after(() => done);
  return Response.json({ run });
});
