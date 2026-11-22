import { after } from "next/server";
import { captureLead, processDue } from "@/lib/clients/engine";
import { clientBySlug } from "@/lib/clients/repo";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { siteUrl } from "@/lib/site";

// Public: someone sent the form on a client's website. It becomes a contact
// and gets an answer right away (step 4). Works as a plain HTML form post
// (redirects back to the page) or as JSON.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const clip = (v: FormDataEntryValue | unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const client = await clientBySlug(slug);
  const isForm = !(req.headers.get("content-type") ?? "").includes("application/json");
  const back = (q: string) => Response.redirect(new URL(`/s/${slug}?${q}#contact`, siteUrl(req)), 303);
  if (!client?.site?.published) return isForm ? new Response("Not found", { status: 404 }) : Response.json({ error: "Not found" }, { status: 404 });

  let b: Record<string, unknown> = {};
  try {
    b = isForm ? Object.fromEntries((await req.formData()).entries()) : ((await req.json()) as Record<string, unknown>);
  } catch {
    return isForm ? back("error=required") : Response.json({ error: "Send the form fields" }, { status: 400 });
  }
  // Honeypot: a field people never see. Pretend it worked.
  if (clip(b.company_url, 200)) return isForm ? back("sent=1") : Response.json({ ok: true });
  if (!rateLimit(`sitelead:${client.id}:${clientIp(req)}`, 5, 10 * 60_000)) return isForm ? back("sent=1") : Response.json({ ok: true });

  const phone = clip(b.phone, 40);
  const email = clip(b.email, 200);
  if (!phone && !email) return isForm ? back("error=required") : Response.json({ error: "A phone number or email is needed" }, { status: 400 });
  const utm = { source: clip(b.utm_source, 100) || undefined, medium: clip(b.utm_medium, 100) || undefined, campaign: clip(b.utm_campaign, 100) || undefined };
  const fromAd = Boolean(clip(b.gclid, 200) || clip(b.fbclid, 200) || /^(cpc|paid|ppc|ads?)$/i.test(utm.medium ?? ""));
  const base = siteUrl(req);
  try {
    await captureLead(
      client,
      {
        name: clip(b.name, 120),
        phone,
        email,
        message: clip(b.message, 2000),
        interest: clip(b.interest, 200),
        source: fromAd ? "ad" : "website",
        consentSms: ["yes", "on", "true", "1"].includes(clip(b.sms_consent, 10).toLowerCase()) || b.sms_consent === true,
        ref: /^[a-z0-9]{6}$/.test(clip(b.ref, 10)) ? clip(b.ref, 10) : undefined,
        utm: utm.source || utm.medium || utm.campaign ? utm : undefined,
        lang: client.lang,
      },
      { base }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Something went wrong";
    console.error(`[rainmaker] site lead for ${client.name}`, err);
    if (/phone number or email/i.test(msg)) return isForm ? back("error=required") : Response.json({ error: msg }, { status: 400 });
    return isForm ? back("sent=1") : Response.json({ ok: true });
  }
  after(() => processDue(client.id, { base }).then(() => undefined).catch(() => undefined));
  return isForm ? back("sent=1") : Response.json({ ok: true });
}
