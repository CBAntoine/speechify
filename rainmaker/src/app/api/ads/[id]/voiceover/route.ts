import { deleteAssets } from "@/lib/assets";
import { listVoices } from "@/lib/elevenlabs/client";
import { synthesize } from "@/lib/elevenlabs/tts";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { getCampaign, patchCampaign } from "@/lib/repo";
import { newId } from "@/lib/store";

// Turn a campaign's audio-ad script (or any text) into a finished voiceover
// with ElevenLabs text to speech.

export const maxDuration = 120;

export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const b = await readBody<{ voiceId?: string; text?: string }>(req);
  const campaign = await getCampaign(id);
  if (!campaign) throw new HttpError(404, "Campaign not found");
  const text = (b.text?.trim() || campaign.audio?.script || campaign.video[0]?.script || "").slice(0, 5000);
  if (!text) throw new HttpError(400, "Write the script first");
  const voiceId = /^[A-Za-z0-9]{10,40}$/.test(b.voiceId ?? "") ? b.voiceId : undefined;
  const out = await synthesize(text, voiceId);
  const voiceName = voiceId ? (await listVoices().catch(() => [])).find((v) => v.voiceId === voiceId)?.name : undefined;
  const updated = await patchCampaign(id, (c) => {
    c.voiceovers = [{ id: newId("vo"), assetId: out.assetId, voiceId: voiceId ?? "default", voiceName, text, createdAt: new Date().toISOString() }, ...(c.voiceovers ?? [])].slice(0, 12);
  });
  return Response.json({ campaign: updated });
});

export const DELETE = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const vo = new URL(req.url).searchParams.get("voiceover");
  const campaign = await getCampaign(id);
  const target = campaign?.voiceovers?.find((v) => v.id === vo);
  if (!campaign || !target) throw new HttpError(404, "Voiceover not found");
  const updated = await patchCampaign(id, (c) => {
    c.voiceovers = (c.voiceovers ?? []).filter((v) => v.id !== vo);
  });
  await deleteAssets([target.assetId]).catch(() => undefined);
  return Response.json({ campaign: updated });
});
