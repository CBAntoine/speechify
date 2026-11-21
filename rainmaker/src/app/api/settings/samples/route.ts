import { clearSamples, loadSamples } from "@/lib/repo";
import { HttpError, readBody, route } from "@/lib/http";

export const POST = route(async (req: Request) => {
  const b = await readBody<{ action?: "clear" | "load" }>(req);
  if (b.action === "clear") await clearSamples();
  else if (b.action === "load") await loadSamples();
  else throw new HttpError(400, "action must be clear or load");
  return Response.json({ ok: true });
});
