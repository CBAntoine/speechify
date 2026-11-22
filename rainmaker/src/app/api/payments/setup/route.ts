import { HttpError, readBody, route } from "@/lib/http";
import { connectPaypalWebhook } from "@/lib/payments/paypal";
import { connectStripeWebhook } from "@/lib/payments/stripe";
import { siteUrl } from "@/lib/site";
import { readDb, update } from "@/lib/store";

// One click in Store & pricing: register this deployment's webhook with
// Stripe or PayPal and keep what they return (Stripe's signing secret,
// PayPal's webhook id) in the database.

export const POST = route(async (req: Request) => {
  const b = await readBody<{ provider?: string }>(req);
  const base = siteUrl(req);
  if (!/^https:\/\//.test(base) || /localhost|127\.0\.0\.1/.test(base)) {
    throw new HttpError(400, `Webhooks need a public https address, and this app is running at ${base}. Deploy it (or set SITE_URL) first.`);
  }
  if (b.provider === "stripe") {
    const url = `${base}/api/payments/stripe/webhook`;
    const known = (await readDb()).payments.stripe;
    const res = await connectStripeWebhook(url, known);
    await update((db) => {
      db.payments.stripe = { webhookId: res.id, webhookSecret: res.secret, webhookUrl: url };
    });
    return Response.json({ ok: true, provider: "stripe", url, reused: res.reused });
  }
  if (b.provider === "paypal") {
    const url = `${base}/api/payments/paypal/webhook`;
    const res = await connectPaypalWebhook(url);
    await update((db) => {
      db.payments.paypal.webhookId = res.id;
      db.payments.paypal.webhookUrl = url;
    });
    return Response.json({ ok: true, provider: "paypal", url, reused: res.reused });
  }
  throw new HttpError(400, "Pick stripe or paypal");
});
