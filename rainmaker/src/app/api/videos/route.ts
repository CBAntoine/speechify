import { claudeEnabled, elevenEnabled } from "@/lib/config";
import { describeError, RefusalError } from "@/lib/claude/client";
import { HttpError, readBody, route } from "@/lib/http";
import { getLead } from "@/lib/repo";
import { createVideoAd, listVideos, productChoices } from "@/lib/video/make";

// Video ads. GET ?leadId=: that lead's videos and the product checklist.
// POST: make one (it can take a minute or two: website check, research,
// script, voiceover).

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route(async (req: Request) => {
  const leadId = new URL(req.url).searchParams.get("leadId") ?? "";
  const lead = leadId ? await getLead(leadId) : undefined;
  if (leadId && !lead) throw new HttpError(404, "Lead not found");
  return Response.json({
    videos: await listVideos(lead?.id),
    choices: lead ? await productChoices(lead) : [],
    claude: claudeEnabled(),
    elevenlabs: elevenEnabled(),
  });
});

export const POST = route(async (req: Request) => {
  const b = await readBody<{ leadId?: string; products?: string[]; format?: "vertical" | "square"; research?: boolean; voice?: boolean }>(req);
  if (!b.leadId) throw new HttpError(400, "Pick a business from your pipeline");
  try {
    return Response.json(await createVideoAd(b.leadId, { products: Array.isArray(b.products) ? b.products.map(String) : [], format: b.format, research: b.research, voice: b.voice }));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(err instanceof RefusalError ? 422 : 502, describeError(err));
  }
});
