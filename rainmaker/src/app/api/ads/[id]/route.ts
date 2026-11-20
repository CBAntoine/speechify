import { deleteCampaign, getCampaign } from "@/lib/repo";
import { HttpError, route, type IdParams } from "@/lib/http";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const campaign = await getCampaign((await params).id);
  if (!campaign) throw new HttpError(404, "Campaign not found");
  return Response.json({ campaign });
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  await deleteCampaign((await params).id);
  return Response.json({ ok: true });
});
