import { Hono } from "hono";
import { DEMO, keys } from "../config.ts";
import { handleInbound, markPaid } from "../crew/closer.ts";
import { getLead } from "../db.ts";
import { log } from "../events.ts";
import { verifyStripeSignature } from "../providers/stripe.ts";
import { errorMessage, fetchWithTimeout, safeEqual } from "../util.ts";

// Payments from Stripe and replies from your inbound email service.

export const hooks = new Hono();

hooks.post("/webhooks/stripe", async (c) => {
  const raw = await c.req.text();
  if (!keys.stripeWebhook || !verifyStripeSignature(raw, c.req.header("stripe-signature"), keys.stripeWebhook)) return c.text("Bad signature", 400);
  const event = JSON.parse(raw) as { type: string; data: { object: Record<string, unknown> } };
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const o = event.data.object as { id: string; payment_status?: string; amount_total?: number; currency?: string; client_reference_id?: string; metadata?: Record<string, string> };
    if (o.payment_status === "paid" || o.payment_status === "no_payment_required") {
      const lead = getLead(o.metadata?.lead_id ?? o.client_reference_id ?? "");
      if (lead) await markPaid(lead, { amountCents: o.amount_total ?? lead.priceCents, currency: o.currency ?? "usd", externalId: o.id, provider: "stripe", variant: o.metadata?.variant });
      else log("closer", `Stripe payment ${o.id} doesn't match a lead.`, { level: "warn" });
    }
  }
  return c.json({ received: true });
});

/** Cut quoted history so the Closer reads only what they just wrote. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^From: .+/.test(line) || /^Sent from my /i.test(line)) break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim() || text.trim();
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type InboundBody = {
  type?: string;
  data?: { email_id?: string; id?: string; from?: string; to?: string | string[]; subject?: string; text?: string; html?: string };
  from?: string | { email?: string };
  to?: string | string[];
  subject?: string;
  text?: string;
  html?: string;
  message_id?: string;
};

hooks.post("/webhooks/inbound-email", async (c) => {
  const given = c.req.header("x-mainstreet-secret") ?? c.req.query("secret") ?? "";
  if (!keys.inbound || !given || !safeEqual(given, keys.inbound)) return c.text("Unauthorized", 401);
  const b = (await c.req.json().catch(() => ({}))) as InboundBody;
  const d = b.data ?? {};
  let text = d.text ?? b.text ?? "";
  let html = d.html ?? b.html ?? "";
  const id = d.email_id ?? d.id ?? b.message_id;
  if (!text && !html && id && keys.resend) {
    for (const url of [`https://api.resend.com/emails/receiving/${id}`, `https://api.resend.com/emails/${id}`]) {
      try {
        const r = await fetchWithTimeout(url, { headers: { authorization: `Bearer ${keys.resend}` }, timeoutMs: 15_000 });
        if (!r.ok) continue;
        const full = (await r.json()) as { text?: string; html?: string };
        text = full.text ?? "";
        html = full.html ?? "";
        if (text || html) break;
      } catch (err) {
        log("closer", `Couldn't fetch the email body: ${errorMessage(err)}`, { level: "warn" });
      }
    }
  }
  const from = typeof b.from === "object" ? (b.from?.email ?? "") : (d.from ?? b.from ?? "");
  const to = d.to ?? b.to;
  const body = stripQuoted(text || htmlToText(html));
  if (!from || !body) return c.json({ ok: false, error: "Missing from or body" }, 400);
  const r = await handleInbound({ from, to: Array.isArray(to) ? to.join(",") : to, subject: d.subject ?? b.subject, text: body, externalId: id });
  return c.json(r);
});

export const demoMode = DEMO;
