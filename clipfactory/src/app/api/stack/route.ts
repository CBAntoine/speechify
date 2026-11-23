import { machine } from "@/server/app";
import { guard } from "@/server/guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = guard(req, "read");
  if (blocked) return blocked;
  const fresh = new URL(req.url).searchParams.has("fresh");
  const m = await machine(fresh);
  return Response.json(m.report);
}
