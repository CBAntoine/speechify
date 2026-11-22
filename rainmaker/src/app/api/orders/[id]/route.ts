import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { fulfillOrder } from "@/lib/payments/fulfill";
import { findOrder, recordPayment, setOrderStatus } from "@/lib/payments/orders";
import { cancelPaypalSubscription } from "@/lib/payments/paypal";
import { cancelStripeSubscription, createPortalSession } from "@/lib/payments/stripe";
import { siteUrl } from "@/lib/site";
import { update } from "@/lib/store";

export const maxDuration = 300;

export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const b = await readBody<{ action?: string; amount?: number }>(req);
  const order = await findOrder({ orderId: id });
  if (!order) throw new HttpError(404, "Order not found");

  switch (b.action) {
    case "fulfill": {
      if (order.status !== "active") throw new HttpError(400, "Only paid orders can be onboarded");
      await update((db) => {
        const o = db.orders.find((x) => x.id === id);
        if (o?.fulfillment && o.fulfillment.status !== "running") o.fulfillment.status = "queued";
      });
      return Response.json({ order: await fulfillOrder(id, siteUrl(req)) });
    }
    case "cancel": {
      if (order.subscriptionId && order.status !== "canceled") {
        if (order.provider === "stripe") await cancelStripeSubscription(order.subscriptionId);
        if (order.provider === "paypal") await cancelPaypalSubscription(order.subscriptionId, "Cancelled by the agency");
      }
      return Response.json({ order: await setOrderStatus({ orderId: id }, "canceled", "cancelled by you") });
    }
    case "portal": {
      if (order.provider !== "stripe" || !order.customerId) throw new HttpError(400, "Billing portal links are for Stripe customers");
      return Response.json({ url: await createPortalSession(order.customerId, `${siteUrl(req)}/store`) });
    }
    case "payment": {
      if (typeof b.amount !== "number" || b.amount <= 0) throw new HttpError(400, "Enter the amount received");
      return Response.json({ order: await recordPayment({ orderId: id }, b.amount, `manual_${Date.now()}`) });
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
});
