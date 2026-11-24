import { readBody, route } from "@/lib/http";
import { checkService } from "@/lib/keys";

// Settings > API keys > Check: asks the service whether it accepts the key in
// effect, and what's left to set up.

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const b = await readBody<{ service?: unknown }>(req);
  return Response.json(await checkService(b.service));
});
