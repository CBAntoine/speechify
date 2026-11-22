import { after } from "next/server";
import { fulfillOrder } from "@/lib/payments/fulfill";
import { activateOrder, firstTimeSeen, forgetEvent, setOrderStatus } from "@/lib/payments/orders";
import { paypalWebhookId, verifyPaypalWebhook } from "@/lib/payments/paypal";
import { siteUrl } from "@/lib/site";

// PayPal → Rainmaker. PayPal verifies each delivery for us (the
// verify-webhook-signature API); each event id is handled once.

export const maxDuration = 300;

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

export async function POST(req: Request) {
  const raw = await req.text();
  let event: { id: string; event_type: string; resource: Obj };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  const webhookId = await paypalWebhookId();
  if (!webhookId) return Response.json({ error: "Webhook not connected: connect PayPal in Store & pricing" }, { status: 400 });
  let genuine = false;
  try {
    genuine = await verifyPaypalWebhook(req.headers, event, webhookId);
  } catch (err) {
    console.error("[rainmaker] paypal verify", err);
    return Response.json({ error: "Couldn't verify" }, { status: 502 });
  }
  if (!genuine) return Response.json({ error: "Bad signature" }, { status: 400 });
  if (!(await firstTimeSeen(`paypal:${event.id}`))) return Response.json({ received: true, duplicate: true });

  const r = event.resource ?? {};
  const base = siteUrl(req);
  try {
    switch (event.event_type) {
      case "BILLING.SUBSCRIPTION.ACTIVATED": {
        const subscriber = (r.subscriber ?? {}) as { email_address?: string; name?: { given_name?: string; surname?: string } };
        const name = [subscriber.name?.given_name, subscriber.name?.surname].filter(Boolean).join(" ") || undefined;
        const { order, activatedNow } = await activateOrder({ orderId: str(r.custom_id), subscriptionId: str(r.id) }, { subscriptionId: str(r.id), providerRef: str(r.id), email: subscriber.email_address, name });
        if (activatedNow && order) after(() => fulfillOrder(order.id, base).then(() => undefined));
        break;
      }
      case "PAYMENT.SALE.COMPLETED": {
        const sub = str(r.billing_agreement_id);
        if (!sub) break;
        const amount = Number((r.amount as { total?: string } | undefined)?.total ?? 0);
        const { order, activatedNow } = await activateOrder({ subscriptionId: sub, orderId: str(r.custom) }, { subscriptionId: sub, amountPaid: amount, paymentRef: str(r.id) });
        if (activatedNow && order) after(() => fulfillOrder(order.id, base).then(() => undefined));
        break;
      }
      case "BILLING.SUBSCRIPTION.CANCELLED":
      case "BILLING.SUBSCRIPTION.EXPIRED":
        await setOrderStatus({ subscriptionId: str(r.id), orderId: str(r.custom_id) }, "canceled");
        break;
      case "BILLING.SUBSCRIPTION.SUSPENDED":
      case "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
        await setOrderStatus({ subscriptionId: str(r.id), orderId: str(r.custom_id) }, "past_due", "PayPal payment failed");
        break;
    }
  } catch (err) {
    console.error("[rainmaker] paypal webhook", event.event_type, err);
    await forgetEvent(`paypal:${event.id}`);
    return Response.json({ error: "Handler failed" }, { status: 500 });
  }
  return Response.json({ received: true });
}
