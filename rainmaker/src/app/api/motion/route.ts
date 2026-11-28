import { claudeEnabled, elevenEnabled } from "@/lib/config";
import { describeError, RefusalError } from "@/lib/claude/client";
import { HttpError, readBody, route } from "@/lib/http";
import { createMotionAd, listMotion, type MotionCreate } from "@/lib/motion/make";

// Motion ads made in code. GET: all of them. POST: gather a business's
// assets and write the numbered storyboard to approve (up to a minute).

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = route(async () => {
  return Response.json({ ads: await listMotion(), claude: claudeEnabled(), elevenlabs: elevenEnabled() });
});

export const POST = route(async (req: Request) => {
  const b = await readBody<MotionCreate>(req);
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  try {
    return Response.json(
      await createMotionAd({
        leadId: text(b.leadId),
        business: text(b.business),
        website: text(b.website),
        format: text(b.format),
        goal: text(b.goal),
        offer: text(b.offer),
        audience: text(b.audience),
        notes: text(b.notes),
        cta: text(b.cta),
      })
    );
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(err instanceof RefusalError ? 422 : 400, describeError(err));
  }
});
