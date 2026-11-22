import "server-only";
import { paypalEnabled, stripeEnabled } from "@/lib/config";
import type { Order } from "@/lib/types";
import { fulfillOrder } from "./fulfill";
import { activateOrder, findOrder } from "./orders";
import { getSubscription } from "./paypal";
import { getCheckoutSession } from "./stripe";

// The thank-you page confirms the payment with the provider itself, so a
// buyer sees "you're in" even before the webhook arrives (or if webhooks
// aren't connected yet). Activation is idempotent with the webhook path.

export interface ReturnResult {
  order?: Order;
  state: "paid" | "processing" | "unpaid" | "unknown";
  /** Activated on this request: start onboarding in the background. */
  fulfill?: () => Promise<unknown>;
}

export async function reconcileReturn(input: { orderId?: string; sessionId?: string; subscriptionId?: string; base: string }): Promise<ReturnResult> {
  const order = input.orderId ? await findOrder({ orderId: input.orderId }) : undefined;
  if (!order) return { state: "unknown" };
  if (order.status === "active") return { order, state: "paid" };

  if (order.provider === "stripe" && stripeEnabled()) {
    const sessionId = input.sessionId ?? order.providerRef;
    if (!sessionId) return { order, state: "unknown" };
    const s = await getCheckoutSession(sessionId).catch(() => undefined);
    if (!s || s.client_reference_id !== order.id) return { order, state: "unknown" };
    if (s.status === "complete" && (s.payment_status === "paid" || s.payment_status === "no_payment_required")) {
      const { order: o, activatedNow } = await activateOrder(
        { orderId: order.id },
        {
          subscriptionId: s.subscription ?? undefined,
          customerId: s.customer ?? undefined,
          providerRef: s.id,
          email: s.customer_details?.email ?? undefined,
          name: s.customer_details?.name ?? undefined,
          phone: s.customer_details?.phone ?? undefined,
          amountPaid: s.amount_total ? s.amount_total / 100 : undefined,
          paymentRef: (s as { invoice?: string | null }).invoice ?? s.id,
        }
      );
      return { order: o, state: "paid", fulfill: activatedNow && o ? () => fulfillOrder(o.id, input.base) : undefined };
    }
    return { order, state: s.status === "complete" ? "processing" : "unpaid" };
  }

  if (order.provider === "paypal" && paypalEnabled()) {
    const subId = input.subscriptionId ?? order.subscriptionId;
    if (!subId) return { order, state: "unknown" };
    const sub = await getSubscription(subId).catch(() => undefined);
    if (!sub || (sub.custom_id && sub.custom_id !== order.id)) return { order, state: "unknown" };
    if (sub.status === "ACTIVE") {
      const name = [sub.subscriber?.name?.given_name, sub.subscriber?.name?.surname].filter(Boolean).join(" ") || undefined;
      const { order: o, activatedNow } = await activateOrder({ orderId: order.id }, { subscriptionId: sub.id, providerRef: sub.id, email: sub.subscriber?.email_address, name });
      return { order: o, state: "paid", fulfill: activatedNow && o ? () => fulfillOrder(o.id, input.base) : undefined };
    }
    // APPROVED: PayPal is activating it; the webhook finishes the job.
    return { order, state: sub.status === "APPROVED" ? "processing" : "unpaid" };
  }
  return { order, state: "unknown" };
}
