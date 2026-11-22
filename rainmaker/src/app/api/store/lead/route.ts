import { HttpError, readBody, route } from "@/lib/http";
import { normalizeUrl } from "@/lib/net";
import { captureStoreLead } from "@/lib/payments/orders";
import { clientIp, rateLimit } from "@/lib/ratelimit";

// Public: a visitor left their details (the sales assistant's save_contact
// tool, or the contact form). Becomes an inbound lead plus a callback task.

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export const POST = route(async (req: Request) => {
  if (!rateLimit(`lead:${clientIp(req)}`, 6, 10 * 60_000)) throw new HttpError(429, "Thanks! We already have your details.");
  const b = await readBody<Record<string, unknown>>(req);
  if (clip(b.company_url, 200)) return Response.json({ ok: true });
  const name = clip(b.name, 120);
  const email = clip(b.email, 200);
  const phone = clip(b.phone, 40).replace(/[^\d+()\-.\s]/g, "");
  if (!name) throw new HttpError(400, "A name is needed.");
  if (email && !EMAIL.test(email)) throw new HttpError(400, "That email address doesn't look right.");
  if (!email && phone.replace(/\D/g, "").length < 7) throw new HttpError(400, "An email address or phone number is needed.");
  const lead = await captureStoreLead(
    {
      name,
      email: email || undefined,
      phone: phone || undefined,
      business: clip(b.business, 120) || undefined,
      website: normalizeUrl(clip(b.website, 300) || undefined),
      notes: clip(b.notes, 1500) || undefined,
    },
    clip(b.interest, 200) || undefined
  );
  return Response.json({ ok: true, leadId: lead.id });
});
