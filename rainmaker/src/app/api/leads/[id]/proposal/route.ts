import { createProposal, removeProposal } from "@/lib/clients/proposal";
import { SERVICE_IDS } from "@/lib/clients/services";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { siteUrl } from "@/lib/site";
import type { ServiceId } from "@/lib/types";

/** Make (or refresh) the lead's outcome proposal: { services?, monthly?, setup? }. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const b = await readBody<{ services?: unknown; monthly?: unknown; setup?: unknown }>(req);
  const services = Array.isArray(b.services) ? (b.services.filter((s) => SERVICE_IDS.includes(s as ServiceId)) as ServiceId[]) : undefined;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  try {
    const { proposal } = await createProposal((await params).id, { services, monthly: num(b.monthly), setup: num(b.setup) });
    return Response.json({ proposal, url: `${siteUrl(req)}/proposal/${proposal.token}` });
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  await removeProposal((await params).id);
  return Response.json({ ok: true });
});
