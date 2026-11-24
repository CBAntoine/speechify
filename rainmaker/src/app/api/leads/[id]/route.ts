import { deleteElevenResources } from "@/lib/elevenlabs/cleanup";
import { deleteAssets } from "@/lib/assets";
import { elevenResourcesOf, videoAssetIds } from "@/lib/fresh";
import { readDb } from "@/lib/store";
import { deleteLead, getLead, updateLead } from "@/lib/repo";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import type { Lead } from "@/lib/types";

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const lead = await getLead((await params).id);
  if (!lead) throw new HttpError(404, "Lead not found");
  return Response.json({ lead });
});

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const patch = await readBody<Partial<Lead>>(req);
  const lead = await updateLead((await params).id, patch);
  return Response.json({ lead });
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const lead = await getLead(id);
  const videoFiles = ((await readDb()).videos ?? []).filter((v) => v.leadId === id).flatMap(videoAssetIds);
  await deleteLead(id);
  await deleteAssets(videoFiles).catch(() => undefined);
  // Its demo receptionist and AI guide go too (never a client's live agent).
  if (lead) await deleteElevenResources(elevenResourcesOf(lead));
  return Response.json({ ok: true });
});
