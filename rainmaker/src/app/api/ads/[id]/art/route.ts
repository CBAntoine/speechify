import { deleteAssets } from "@/lib/assets";
import { artPrompt, generateArt } from "@/lib/elevenlabs/art";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { getCampaign, getLead, patchCampaign } from "@/lib/repo";
import type { ArtSize } from "@/lib/types";

// Make custom background art for a campaign's creative card with the
// ElevenLabs Image & Video API, in one of the three ad sizes.

export const maxDuration = 150;

const SIZES: ArtSize[] = ["square", "story", "landscape"];

export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const b = await readBody<{ size?: string; prompt?: string }>(req);
  const size = SIZES.find((s) => s === b.size) ?? "square";
  const campaign = await getCampaign(id);
  if (!campaign) throw new HttpError(404, "Campaign not found");
  const lead = campaign.leadId ? await getLead(campaign.leadId) : undefined;
  const custom = b.prompt?.trim().slice(0, 1500);
  const prompt = artPrompt(
    {
      businessName: campaign.businessName,
      niche: campaign.niche,
      location: campaign.location,
      offer: campaign.offer,
      artPrompt: custom || campaign.creative.artPrompt,
      palette: campaign.creative.palette,
      brandColors: lead?.audit?.brandColors,
    },
    size
  );
  const art = await generateArt(prompt, size);
  const old = campaign.art?.[size]?.assetId;
  const updated = await patchCampaign(id, (c) => {
    c.art = { ...(c.art ?? {}), [size]: art };
    if (custom) c.creative.artPrompt = custom;
  });
  if (old) await deleteAssets([old]).catch(() => undefined);
  return Response.json({ campaign: updated });
});
