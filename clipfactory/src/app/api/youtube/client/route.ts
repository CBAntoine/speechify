import { guard, originOf } from "@/server/guard";
import { removeClientConfig, saveClientConfig, status, YouTubeError } from "@/server/youtube";

export const dynamic = "force-dynamic";

/** Save your Google OAuth client: the JSON downloaded from Google Cloud Console, or {client_id, client_secret}. */
export async function POST(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  const body = await req.json().catch(() => null);
  try {
    saveClientConfig(body);
  } catch (err) {
    return Response.json({ error: err instanceof YouTubeError ? err.message : "Couldn't save the OAuth client." }, { status: 400 });
  }
  return Response.json(status(originOf(req)));
}

export async function DELETE(req: Request) {
  const blocked = guard(req);
  if (blocked) return blocked;
  removeClientConfig();
  return Response.json(status(originOf(req)));
}
