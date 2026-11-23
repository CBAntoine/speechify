import { elevenEnabled } from "@/lib/config";
import { ElevenError, conversationCredential } from "@/lib/elevenlabs/client";
import { leadByDemoToken, useDemoSession } from "@/lib/elevenlabs/demo";
import { leadByGuideToken, useGuideSession } from "@/lib/offers/guide";
import { resolveSalesAgentId } from "@/lib/elevenlabs/sales-agent";
import { HttpError, readBody, route } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { readDb } from "@/lib/store";

// Public: a short-lived ElevenLabs credential for one conversation, either
// with the store's sales assistant, a prospect's demo receptionist or their
// demo AI website guide (by its private token). Voice gets a WebRTC token, text a signed URL. The
// API key never leaves the server.

export const dynamic = "force-dynamic";

export const POST = route(async (req: Request) => {
  const b = await readBody<{ mode?: string; demo?: string; guide?: string }>(req);
  const mode = b.mode === "text" ? "text" : "voice";
  if (!rateLimit(`voice:${mode}:${clientIp(req)}`, mode === "voice" ? 12 : 40, 60 * 60_000)) {
    throw new HttpError(429, "Too many conversations from this network. Try again later, or leave your details and we'll call you.");
  }
  if (!elevenEnabled()) throw new HttpError(503, "The AI assistant isn't switched on yet.");

  let agentId: string | undefined;
  if (b.guide) {
    const lead = await leadByGuideToken(String(b.guide));
    if (!lead?.guide) throw new HttpError(404, "This demo link has expired.");
    if (!(await useGuideSession(lead.id))) throw new HttpError(429, "This demo has been busy today. Try again tomorrow.");
    agentId = lead.guide.agentId;
  } else if (b.demo) {
    const lead = await leadByDemoToken(String(b.demo));
    if (!lead?.demo) throw new HttpError(404, "This demo link has expired.");
    if (!(await useDemoSession(lead.id))) throw new HttpError(429, "This demo has been busy today. Try again tomorrow.");
    agentId = lead.demo.agentId;
  } else {
    const db = await readDb();
    if (!db.store.enabled) throw new HttpError(403, "The store is closed right now.");
    agentId = await resolveSalesAgentId();
  }
  if (!agentId) throw new HttpError(503, "The AI assistant isn't set up yet.");

  try {
    return Response.json({ ok: true, auth: await conversationCredential(agentId, mode) });
  } catch (err) {
    console.error("[rainmaker] voice credential", err);
    throw new HttpError(502, err instanceof ElevenError && err.status === 404 ? "The assistant couldn't be found. The owner needs to sync it." : "The assistant is busy right now. Try again in a moment.");
  }
});
