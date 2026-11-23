import { guard, originOf } from "@/server/guard";
import { status } from "@/server/youtube";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = guard(req, "read");
  if (blocked) return blocked;
  return Response.json(status(originOf(req)));
}
