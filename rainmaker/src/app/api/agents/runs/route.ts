import { after } from "next/server";
import { listRuns, startRun } from "@/lib/agents/runner";
import { HttpError, readBody, route } from "@/lib/http";

// Agent runs keep going after this response is sent. On a long-lived Node
// server they can run as long as they need; on serverless hosts this is the
// time limit.
export const maxDuration = 800;

export const GET = route(async () => {
  const runs = await listRuns();
  return Response.json({ runs: runs.map(({ events, ...r }) => ({ ...r, steps: events.filter((e) => e.kind === "tool_call").length })) });
});

export const POST = route(async (req: Request) => {
  const b = await readBody<{ agentId?: string; goal?: string }>(req);
  if (!b.agentId) throw new HttpError(400, "Pick an agent");
  const { run, done } = await startRun(b.agentId, b.goal ?? "");
  after(() => done);
  return Response.json({ run });
});
