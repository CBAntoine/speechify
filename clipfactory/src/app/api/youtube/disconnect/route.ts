import { guard, originOf } from "@/server/guard";
import { disconnect, status } from "@/server/youtube";

export const dynamic = "force-dynamic";

/** Revoke Clip Factory's access to the channel and forget the login. */
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  await disconnect();
  return Response.json(status(originOf(req)));
}
