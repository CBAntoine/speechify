import { elevenEnabled } from "@/lib/config";
import { buildDemo, demoPath, removeDemo } from "@/lib/elevenlabs/demo";
import { HttpError, route, type IdParams } from "@/lib/http";
import { siteUrl } from "@/lib/site";

export const maxDuration = 120;

/** Build a demo AI receptionist from the lead's website and return its private link. */
export const POST = route(async (req: Request, { params }: IdParams) => {
  if (!elevenEnabled()) throw new HttpError(400, "Add your ElevenLabs API key in Settings → API keys to build demo agents");
  const demo = await buildDemo((await params).id);
  return Response.json({ demo, url: `${siteUrl(req)}${demoPath(demo.token)}` });
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  await removeDemo((await params).id);
  return Response.json({ ok: true });
});
