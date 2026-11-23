import type { ChangeContext } from "@/review/context.ts";
import { draftChange } from "@/lib/changes";
import { HttpError, readJson, route, str } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** Draft a firewall change (workflow NET-1) against the context the browser built from the redacted backup. */
export const POST = route(async (req: Request) => {
  const b = await readJson<{ request?: string; context?: ChangeContext }>(req, 1_500_000);
  const request = str(b.request, 4_000).trim();
  if (request.length < 8) throw new HttpError(400, "Describe the access needed: source, destination, service and owner.");
  if (!b.context || typeof b.context !== "object" || !Array.isArray(b.context.policies)) throw new HttpError(400, "Load a FortiGate backup first, so the draft can be checked against it.");
  return Response.json({ draft: await draftChange(request, b.context) });
});
