import { act, BizError, snapshot } from "@/server/app";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

/** Everything the business dashboard shows. */
export async function GET(req: Request) {
  const blocked = guard(req, "read");
  if (blocked) return blocked;
  return Response.json(snapshot());
}

/** {"action": "creator.add", …}: see act() in server/biz/api.ts. Returns the result and a fresh snapshot. */
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return Response.json({ error: "Expected {action, …}" }, { status: 400 });
  try {
    const result = await act(body);
    return Response.json({ result, snapshot: snapshot() });
  } catch (err) {
    const msg = err instanceof BizError ? err.message : `Something went wrong: ${(err as Error).message}`;
    return Response.json({ error: msg }, { status: err instanceof BizError ? 400 : 500 });
  }
}
