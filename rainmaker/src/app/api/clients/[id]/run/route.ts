import { processDue } from "@/lib/clients/engine";
import { route, type IdParams } from "@/lib/http";
import { siteUrl } from "@/lib/site";

export const maxDuration = 120;

/** Send (or draft) everything that's due for this client now. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  return Response.json(await processDue((await params).id, { base: siteUrl(req) }, 200));
});
