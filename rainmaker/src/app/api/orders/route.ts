import { after } from "next/server";
import { getOffer, priceOf } from "@/lib/catalog";
import { HttpError, readBody, route } from "@/lib/http";
import { salesStats } from "@/lib/payments/encode";
import { fulfillOrder } from "@/lib/payments/fulfill";
import { activateOrder, createPendingOrder, listOrders } from "@/lib/payments/orders";
import { siteUrl } from "@/lib/site";
import { readDb } from "@/lib/store";

export const maxDuration = 300;

export const GET = route(async () => {
  const orders = await listOrders();
  return Response.json({ orders, stats: salesStats(orders) });
});

/** Record a sale made outside the store (cash, e-transfer, invoice). */
export const POST = route(async (req: Request) => {
  const b = await readBody<{ offerId?: string; interval?: string; business?: string; email?: string; name?: string; phone?: string; website?: string; leadId?: string; amount?: number; setup?: number }>(req);
  const offer = getOffer(b.offerId);
  if (!offer) throw new HttpError(400, "Pick a product or plan");
  if (!b.business?.trim() && !b.leadId) throw new HttpError(400, "Name the business");
  const db = await readDb();
  const interval = b.interval === "year" ? "year" : "month";
  const listed = priceOf(offer, db.store, interval);
  const amount = typeof b.amount === "number" && b.amount >= 0 ? b.amount : listed.recurring;
  const setup = typeof b.setup === "number" && b.setup >= 0 ? b.setup : listed.setupCharged;
  const order = await createPendingOrder({
    offer,
    price: { ...listed, recurring: amount, setupCharged: setup },
    currency: db.store.currency,
    provider: "manual",
    buyer: { business: b.business?.trim(), email: b.email?.trim() || undefined, name: b.name?.trim() || undefined, phone: b.phone?.trim() || undefined, website: b.website?.trim() || undefined },
    leadId: b.leadId,
  });
  const { order: active } = await activateOrder({ orderId: order.id }, { amountPaid: amount + setup, paymentRef: `manual_${order.id}` });
  if (active) after(() => fulfillOrder(active.id, siteUrl(req)).then(() => undefined));
  return Response.json({ order: active ?? order });
});
