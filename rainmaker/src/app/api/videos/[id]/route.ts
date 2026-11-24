import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { siteUrl } from "@/lib/site";
import { deleteVideoAd, emailVideoAd, getVideo } from "@/lib/video/make";

// One video ad. POST { action: "email", to? }: its email as a draft in the
// Inbox, with the private link. DELETE: the video and its media.

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const v = await getVideo((await params).id);
  if (!v) throw new HttpError(404, "Video not found");
  return Response.json({ video: v });
});

export const POST = route(async (req: Request, { params }: IdParams) => {
  const b = await readBody<{ action?: string; to?: string }>(req);
  if (b.action !== "email") throw new HttpError(400, "Unknown action");
  try {
    const draft = await emailVideoAd((await params).id, { to: b.to, origin: siteUrl(req) });
    return Response.json({ draft });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  await deleteVideoAd((await params).id);
  return Response.json({ ok: true });
});
