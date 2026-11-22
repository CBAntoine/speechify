import { timingSafeEqual } from "node:crypto";
import { updateClientData } from "@/lib/clients/data-store";
import { captureLead, findContact, markJobsDone, newContact } from "@/lib/clients/engine";
import { toE164 } from "@/lib/phone";
import { getClient } from "@/lib/clients/repo";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { siteUrl } from "@/lib/site";

// Public, key-protected: a new lead from anywhere else: the client's own
// website forms, Zapier or Make (Meta lead ads, Typeform, Jotform…), or a
// Google Ads lead form webhook (its "key" field is checked as google_key).
// The lead is answered right away by step 4.
//
//   POST /api/intake/<client id>?key=<intake key>
//   { "name": "…", "phone": "…", "email": "…", "message": "…", "sms_consent": true }

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : typeof v === "number" ? String(v) : "");

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The first non-empty value under any of these names, at the top level or nested one level down. */
function pick(body: Record<string, unknown>, names: string[]): string {
  const flat: Record<string, unknown> = { ...body };
  for (const v of Object.values(body)) if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(flat, v as Record<string, unknown>);
  const lower = Object.fromEntries(Object.entries(flat).map(([k, v]) => [k.toLowerCase().replace(/[\s-]+/g, "_"), v]));
  for (const n of names) {
    const v = str(lower[n], 2000);
    if (v) return v;
  }
  return "";
}

/** Google Ads lead forms send user_column_data: [{ column_id: "FULL_NAME", string_value: "…" }]. */
function googleColumns(body: Record<string, unknown>): Record<string, string> {
  const cols = Array.isArray(body.user_column_data) ? (body.user_column_data as { column_id?: string; column_name?: string; string_value?: string }[]) : [];
  return Object.fromEntries(cols.map((c) => [(c.column_id ?? c.column_name ?? "").toLowerCase(), str(c.string_value, 2000)]));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const client = await getClient((await params).id);
  if (!client) return Response.json({ error: "Unknown client" }, { status: 404 });
  if (!rateLimit(`intake:${client.id}:${clientIp(req)}`, 60, 60_000)) return Response.json({ error: "Too many requests" }, { status: 429 });

  let body: Record<string, unknown> = {};
  const type = req.headers.get("content-type") ?? "";
  try {
    body = type.includes("application/json") ? ((await req.json()) as Record<string, unknown>) : Object.fromEntries((await req.formData()).entries());
  } catch {
    return Response.json({ error: "Send JSON or form fields" }, { status: 400 });
  }
  const given = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-rainmaker-key") ?? str(body.google_key, 200) ?? "";
  if (!given || !same(given, client.intakeKey)) return Response.json({ error: "Wrong or missing key" }, { status: 401 });

  const g = googleColumns(body);
  const isGoogle = Boolean(Object.keys(g).length || body.google_key);
  if (isGoogle && body.is_test === true) return Response.json({ ok: true, test: true });
  const first = g.first_name || pick(body, ["first_name", "firstname", "nombre"]);
  const last = g.last_name || pick(body, ["last_name", "lastname", "apellido"]);
  const name = g.full_name || pick(body, ["name", "full_name", "fullname", "nombre_completo", "nom"]) || [first, last].filter(Boolean).join(" ");
  const phone = g.phone_number || pick(body, ["phone", "phone_number", "mobile", "cell", "telephone", "tel", "telefono", "celular", "whatsapp"]);
  const email = g.email || pick(body, ["email", "email_address", "e_mail", "correo", "courriel"]);
  if (!phone && !email) return Response.json({ error: "A phone number or email address is needed" }, { status: 400 });
  const consent = pick(body, ["sms_consent", "text_consent", "consent", "acepto"]).toLowerCase();
  const consentSms = ["true", "yes", "1", "on", "si", "sí", "oui"].includes(consent);

  // A finished job from their booking or job software: ask for a review (step 3), no lead follow-up.
  // Only an explicit event counts: form tools often send "status": "completed" for a filled-in form.
  const event = str(body.event, 40).toLowerCase();
  if (["job_done", "job_completed", "appointment_completed", "visit_completed"].includes(event)) {
    const e164 = toE164(phone, client.country);
    const mail = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) ? email.toLowerCase() : undefined;
    if (!e164 && !mail) return Response.json({ error: "A valid phone number or email address is needed" }, { status: 400 });
    const contact = await updateClientData(client.id, (data) => {
      const existing = findContact(data, e164, mail);
      if (existing) {
        if (consentSms && e164 && !existing.optedOutAt) existing.consent = { ...existing.consent, sms: true, basis: "written", at: new Date().toISOString() };
        return structuredClone(existing);
      }
      return structuredClone(newContact(data, { name: name || mail?.split("@")[0] || e164!, phone: e164, email: mail, source: "import", consent: { email: Boolean(mail), sms: consentSms && Boolean(e164), basis: consentSms ? "written" : "customer", at: new Date().toISOString() } }));
    });
    const r = await markJobsDone(client, [contact.id]);
    return Response.json({ ok: true, contactId: contact.id, reviewQueued: r.queued > 0 });
  }

  try {
    const { contact, replies } = await captureLead(
      client,
      {
        name,
        phone,
        email,
        message: pick(body, ["message", "comments", "comment", "notes", "details", "mensaje", "comentarios"]),
        interest: pick(body, ["service", "interest", "product", "servicio"]) || g.service || undefined,
        source: isGoogle || pick(body, ["ad_id", "adset_id", "campaign_id", "form_id"]) ? "ad" : "webhook",
        consentSms,
      },
      { base: siteUrl(req) }
    );
    return Response.json({ ok: true, contactId: contact.id, replied: replies.some((m) => m.status === "sent"), drafted: replies.some((m) => m.status === "draft") });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Couldn't save the lead" }, { status: 400 });
  }
}
