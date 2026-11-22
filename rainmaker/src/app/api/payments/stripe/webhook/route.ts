import { after } from "next/server";
import { verifyStripeSignature } from "@/lib/payments/encode";
import { fulfillOrder } from "@/lib/payments/fulfill";
import { activateOrder, firstTimeSeen, forgetEvent, recordPayment, setOrderStatus } from "@/lib/payments/orders";
import { invoiceSubscription } from "@/lib/payments/stripe";
import { siteUrl } from "@/lib/site";
import { readDb, syncSavedKeys } from "@/lib/store";

// Stripe → Rainmaker. Every delivery is signature-checked against the raw
// body, and each event id is handled once (Stripe retries deliveries).

export const maxDuration = 300;

type Obj = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

function orderIdOf(o: Obj): string | undefined {
  const meta = (x: unknown) => (x && typeof x === "object" ? str((x as { metadata?: Obj }).metadata?.order_id) : undefined);
  const parent = o.parent as { subscription_details?: unknown } | undefined;
  const lines = (o.lines as { data?: unknown[] } | undefined)?.data;
  return str(o.client_reference_id) ?? meta(o) ?? meta(parent?.subscription_details) ?? meta(o.subscription_details) ?? meta(lines?.[0]);
}

export async function POST(req: Request) {
  const raw = await req.text();
  await syncSavedKeys().catch(() => undefined);
  const secret = process.env.STRIPE_WEBHOOK_SECRET || (await readDb()).payments.stripe.webhookSecret;
  if (!secret) return Response.json({ error: "Webhook signing secret not set: connect Stripe in Store & pricing" }, { status: 400 });
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), secret)) return Response.json({ error: "Bad signature" }, { status: 400 });

  let event: { id: string; type: string; data: { object: Obj } };
  try {
    event = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (!(await firstTimeSeen(`stripe:${event.id}`))) return Response.json({ received: true, duplicate: true });

  const o = event.data.object;
  const base = siteUrl(req);
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        if (o.mode !== "subscription") break;
        if (o.payment_status !== "paid" && o.payment_status !== "no_payment_required") break;
        const details = (o.customer_details ?? {}) as Obj;
        const { order, activatedNow } = await activateOrder(
          { orderId: orderIdOf(o), providerRef: str(o.id) },
          {
            subscriptionId: str(o.subscription),
            customerId: str(o.customer),
            providerRef: str(o.id),
            email: str(details.email),
            name: str(details.name),
            phone: str(details.phone),
            amountPaid: typeof o.amount_total === "number" ? o.amount_total / 100 : undefined,
            paymentRef: str(o.invoice) ?? str(o.id),
          }
        );
        if (activatedNow && order) after(() => fulfillOrder(order.id, base).then(() => undefined));
        break;
      }
      case "invoice.paid": {
        const sub = invoiceSubscription(o);
        const orderId = orderIdOf(o);
        if (!sub && !orderId) break;
        const amount = typeof o.amount_paid === "number" ? o.amount_paid / 100 : 0;
        const { order, activatedNow } = await activateOrder({ orderId, subscriptionId: sub }, { subscriptionId: sub, customerId: str(o.customer), amountPaid: amount, paymentRef: str(o.id) });
        if (!order && sub) await recordPayment({ subscriptionId: sub }, amount, str(o.id));
        if (activatedNow && order) after(() => fulfillOrder(order.id, base).then(() => undefined));
        break;
      }
      case "invoice.payment_failed": {
        const sub = invoiceSubscription(o);
        if (sub) await setOrderStatus({ subscriptionId: sub }, "past_due", "card payment failed");
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const status = event.type === "customer.subscription.deleted" ? "canceled" : str(o.status);
        const mapped = status === "active" || status === "trialing" ? "active" : status === "past_due" || status === "unpaid" ? "past_due" : status === "canceled" || status === "incomplete_expired" ? "canceled" : undefined;
        if (mapped && str(o.id)) await setOrderStatus({ subscriptionId: str(o.id), orderId: orderIdOf(o) }, mapped);
        break;
      }
    }
  } catch (err) {
    console.error("[rainmaker] stripe webhook", event.type, err);
    await forgetEvent(`stripe:${event.id}`);
    return Response.json({ error: "Handler failed" }, { status: 500 });
  }
  return Response.json({ received: true });
}
