import { describeError, RefusalError } from "@/lib/claude/client";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { deleteMotion, getMotion, removeVoice, reviseMotion, rewriteMotion, updateMotion, voiceMotion, type MotionPatch } from "@/lib/motion/make";

// One motion ad. PATCH: edit shots, colours, sound, approve. POST actions:
// revise (ask Claude for a change), rewrite (start the storyboard again),
// voice (record the narration with ElevenLabs), unvoice. DELETE: the ad
// and its files.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const fail = (err: unknown): never => {
  if (err instanceof HttpError) throw err;
  throw new HttpError(err instanceof RefusalError ? 422 : 400, describeError(err));
};

export const GET = route(async (_req: Request, { params }: IdParams) => {
  const ad = await getMotion((await params).id);
  if (!ad) throw new HttpError(404, "Motion ad not found");
  return Response.json({ ad });
});

export const PATCH = route(async (req: Request, { params }: IdParams) => {
  const b = await readBody<MotionPatch>(req);
  const id = (await params).id;
  return Response.json(
    await updateMotion(id, {
      shots: Array.isArray(b.shots) ? b.shots : undefined,
      concept: typeof b.concept === "string" ? b.concept : undefined,
      status: b.status === "approved" || b.status === "storyboard" ? b.status : undefined,
      brand: b.brand && typeof b.brand === "object" ? b.brand : undefined,
      sound: b.sound && typeof b.sound === "object" ? b.sound : undefined,
      brief: b.brief && typeof b.brief === "object" ? b.brief : undefined,
    }).catch(fail)
  );
});

export const POST = route(async (req: Request, { params }: IdParams) => {
  const b = await readBody<{ action?: string; ask?: string; voiceId?: string }>(req);
  const id = (await params).id;
  switch (b.action) {
    case "revise":
      return Response.json(await reviseMotion(id, String(b.ask ?? "")).catch(fail));
    case "rewrite":
      return Response.json(await rewriteMotion(id).catch(fail));
    case "voice":
      return Response.json(await voiceMotion(id, typeof b.voiceId === "string" ? b.voiceId : undefined).catch(fail));
    case "unvoice":
      return Response.json({ ad: await removeVoice(id).catch(fail), notes: [] });
    default:
      throw new HttpError(400, "Unknown action");
  }
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  await deleteMotion((await params).id);
  return Response.json({ ok: true });
});
