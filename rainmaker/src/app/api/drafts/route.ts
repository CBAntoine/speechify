import { createDraft, listDrafts } from "@/lib/repo";
import { HttpError, readBody, route } from "@/lib/http";
import type { Channel } from "@/lib/types";

export const GET = route(async () => Response.json({ drafts: await listDrafts() }));

export const POST = route(async (req: Request) => {
  const b = await readBody<{ leadId?: string; channel?: Channel; subject?: string; body?: string; to?: string; rationale?: string }>(req);
  if (!b.body?.trim()) throw new HttpError(400, "The message is empty");
  const channel: Channel = b.channel && ["email", "sms", "dm", "call"].includes(b.channel) ? b.channel : "email";
  const draft = await createDraft({ leadId: b.leadId, channel, subject: b.subject, body: b.body, to: b.to, rationale: b.rationale, createdBy: "user" });
  return Response.json({ draft });
});
