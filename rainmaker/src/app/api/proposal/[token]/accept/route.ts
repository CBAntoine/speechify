import { acceptProposal } from "@/lib/clients/proposal";
import { resendEnabled } from "@/lib/config";
import { sendEmail } from "@/lib/email";
import { HttpError, readBody, route } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { getProfile } from "@/lib/repo";
import { siteUrl } from "@/lib/site";

// Public: a prospect accepts their proposal without paying online (card and
// PayPal aren't available to them). It's recorded on the lead and the agency
// is emailed, so they can invoice and start onboarding.

export const maxDuration = 30;

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export const POST = route(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  if (!rateLimit(`proposal-accept:${clientIp(req)}`, 6, 10 * 60_000)) throw new HttpError(429, "Too many tries from this network. Try again in a few minutes.");
  const token = (await params).token;
  const b = await readBody<Record<string, unknown>>(req);
  // Honeypot: pretend it worked.
  if (clip(b.company_url, 200)) return Response.json({ ok: true });
  const email = clip(b.email, 200);
  if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
  const name = clip(b.name, 120) || undefined;
  const phone = clip(b.phone, 40) || undefined;
  const r = await acceptProposal(token, { email, name, phone });
  if (!r) throw new HttpError(404, "This proposal isn't available any more.");

  const profile = await getProfile();
  if (r.first && profile.email && resendEnabled()) {
    const p = r.lead.proposal!;
    const lines = [
      `${r.lead.name} accepted their proposal.`,
      "",
      `Contact: ${[name, email, phone].filter(Boolean).join(" · ")}`,
      `Price: ${p.monthly} ${p.currency.toUpperCase()}/month + ${p.setup} ${p.currency.toUpperCase()} setup`,
      "",
      "Next: send their invoice, then press \"They signed: make them a client\" on the lead.",
      `${siteUrl(req)}/pipeline`,
    ];
    await sendEmail({ to: profile.email, subject: `${r.lead.name} accepted the proposal`, text: lines.join("\n"), replyTo: email }).catch((err) => console.error("[rainmaker] accept alert failed", err));
  }
  return Response.json({ ok: true });
});
