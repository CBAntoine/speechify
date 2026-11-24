import { HttpError, readBody, route } from "@/lib/http";
import { keysPolicy, listKeys, removeKey, saveKey } from "@/lib/keys";

// Settings > API keys. Owner only (behind the sign-in). Answers with masked
// previews; a full key never comes back out.

export const dynamic = "force-dynamic";

/** Only this app's own pages may change keys. */
function guard(req: Request) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Keys can only be changed from Rainmaker itself.");
  const policy = keysPolicy();
  if (!policy.canSave) throw new HttpError(403, policy.reason ?? "Saving keys is turned off here.");
}

export const GET = route(async () => Response.json({ keys: await listKeys(), policy: keysPolicy() }));

export const PUT = route(async (req: Request) => {
  guard(req);
  if (!req.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Send JSON");
  const b = await readBody<{ name?: unknown; value?: unknown }>(req);
  return Response.json({ keys: await saveKey(b.name, b.value) });
});

export const DELETE = route(async (req: Request) => {
  guard(req);
  const name = new URL(req.url).searchParams.get("name");
  return Response.json({ keys: await removeKey(name) });
});
