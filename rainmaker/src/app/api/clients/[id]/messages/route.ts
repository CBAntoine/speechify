import { readClientData } from "@/lib/clients/data-store";
import { approveDraft, discardMessage, sendFromStaff } from "@/lib/clients/engine";
import { getClient } from "@/lib/clients/repo";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { siteUrl } from "@/lib/site";
import type { MsgChannel } from "@/lib/types";

export const maxDuration = 60;

/** ?contact=<id>: one conversation, oldest first. */
export const GET = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const contactId = new URL(req.url).searchParams.get("contact");
  const data = await readClientData(id);
  const contact = data.contacts.find((c) => c.id === contactId);
  if (!contact) throw new HttpError(404, "Contact not found");
  return Response.json({ contact, messages: data.messages.filter((m) => m.contactId === contact.id) });
});

/**
 * { action: "send", contactId, channel, body, subject? }
 * { action: "approve", messageId, body?, subject? }  { action: "approve_all" }
 * { action: "discard", messageId }
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const client = await getClient(id);
  if (!client) throw new HttpError(404, "Client not found");
  const b = await readBody<{ action?: string; contactId?: string; messageId?: string; channel?: string; body?: string; subject?: string }>(req);
  const ctx = { base: siteUrl(req) };
  try {
    switch (b.action) {
      case "send": {
        const channel = (["sms", "whatsapp", "email"].includes(b.channel ?? "") ? b.channel : "sms") as MsgChannel;
        if (!b.contactId || !b.body?.trim()) throw new HttpError(400, "Write a message first");
        return Response.json({ message: await sendFromStaff(client, b.contactId, { channel, body: b.body.trim(), subject: b.subject?.trim() }, ctx) });
      }
      case "approve":
        if (!b.messageId) throw new HttpError(400, "Which message?");
        return Response.json({ message: await approveDraft(client, b.messageId, { body: b.body, subject: b.subject }, ctx) });
      case "approve_all": {
        const data = await readClientData(id);
        const drafts = data.messages.filter((m) => m.status === "draft" && m.direction === "out" && !m.error?.startsWith("Fill in")).slice(0, 100);
        let sent = 0;
        const errors: string[] = [];
        for (const m of drafts) {
          try {
            const r = await approveDraft(client, m.id, {}, ctx);
            if (r.status === "sent") sent++;
            else if (r.error) errors.push(r.error);
          } catch (err) {
            errors.push(err instanceof Error ? err.message : String(err));
          }
        }
        return Response.json({ sent, tried: drafts.length, error: errors[0] });
      }
      case "discard":
        if (!b.messageId) throw new HttpError(400, "Which message?");
        await discardMessage(id, b.messageId);
        return Response.json({ ok: true });
      default:
        throw new HttpError(400, "Unknown action");
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
});
