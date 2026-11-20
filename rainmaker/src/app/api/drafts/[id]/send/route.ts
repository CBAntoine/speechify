import { resendEnabled } from "@/lib/config";
import { sendEmail } from "@/lib/email";
import { getProfile, listDrafts, updateDraft } from "@/lib/repo";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";

// Approve and send. Email goes through Resend when configured; everything
// else (and email without Resend) is marked sent after you send it yourself.
export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const b = await readBody<{ manual?: boolean; to?: string; subject?: string; body?: string }>(req);
  const draft = (await listDrafts()).find((d) => d.id === id);
  if (!draft) throw new HttpError(404, "Draft not found");
  if (draft.status === "sent") throw new HttpError(409, "Already sent");
  const to = (b.to ?? draft.to ?? "").trim();
  const subject = (b.subject ?? draft.subject ?? "").trim();
  const body = (b.body ?? draft.body).trim();
  if (b.manual || draft.channel !== "email" || !resendEnabled()) {
    return Response.json({ draft: await updateDraft(id, { to, subject, body, status: "sent", sentAt: new Date().toISOString(), sentVia: "manual" }) });
  }
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(to)) throw new HttpError(400, "Add a valid email address first");
  if (!subject) throw new HttpError(400, "Add a subject line first");
  const profile = await getProfile();
  try {
    await sendEmail({ to, subject, text: body, replyTo: profile.email || undefined });
  } catch (err) {
    await updateDraft(id, { error: err instanceof Error ? err.message : String(err) });
    throw new HttpError(502, err instanceof Error ? err.message : "Email not sent");
  }
  return Response.json({ draft: await updateDraft(id, { to, subject, body, status: "sent", sentAt: new Date().toISOString(), sentVia: "resend", error: undefined }) });
});
