import { getOffer, isVisible, priceOf } from "@/lib/catalog";
import { paypalEnabled, stripeEnabled } from "@/lib/config";
import { HttpError, readBody, route } from "@/lib/http";
import { normalizeUrl } from "@/lib/net";
import { createPendingOrder, setProviderRef } from "@/lib/payments/orders";
import { createSubscription, ensurePlan } from "@/lib/payments/paypal";
import { createCheckoutSession } from "@/lib/payments/stripe";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { siteUrl } from "@/lib/site";
import { readDb } from "@/lib/store";

// Public: start a checkout for one offer. Creates a pending order (and a
// lead), then hands the buyer to Stripe Checkout or PayPal.

export const maxDuration = 30;

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export const POST = route(async (req: Request) => {
  if (!rateLimit(`checkout:${clientIp(req)}`, 8, 10 * 60_000)) throw new HttpError(429, "Too many checkouts from this network. Try again in a few minutes.");
  const b = await readBody<Record<string, unknown>>(req);
  // Honeypot: a field people never see; bots fill it in.
  if (clip(b.company_url, 200)) return Response.json({ url: "/store/thanks" });

  const db = await readDb();
  if (!db.store.enabled) throw new HttpError(403, "The store is closed right now.");
  const offer = getOffer(clip(b.offerId, 60));
  if (!offer || !isVisible(offer, db.store)) throw new HttpError(404, "That product isn't available.");
  const interval = b.interval === "year" && db.store.annual ? "year" : "month";
  const provider = b.provider === "paypal" ? "paypal" : "stripe";
  if (provider === "stripe" && !stripeEnabled()) throw new HttpError(400, "Card payments aren't switched on yet. Try PayPal, or leave your details and we'll call you.");
  if (provider === "paypal" && !paypalEnabled()) throw new HttpError(400, "PayPal isn't switched on yet. Try paying by card, or leave your details and we'll call you.");

  const email = clip(b.email, 200);
  const business = clip(b.business, 120);
  if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (!business) throw new HttpError(400, "Enter your business name.");
  const website = normalizeUrl(clip(b.website, 300) || undefined);

  const price = priceOf(offer, db.store, interval);
  const order = await createPendingOrder({
    offer,
    price,
    currency: db.store.currency,
    provider,
    buyer: { email, business, website, name: clip(b.name, 120) || undefined, phone: clip(b.phone, 40) || undefined, notes: clip(b.notes, 1000) || undefined },
    leadId: clip(b.leadId, 60) || undefined,
  });
  const base = siteUrl(req);
  const brand = db.profile.agencyName;

  try {
    if (provider === "stripe") {
      const session = await createCheckoutSession({ order, offer, price, currency: db.store.currency, base, brand });
      await setProviderRef(order.id, { providerRef: session.id });
      if (!session.url) throw new Error("Stripe didn't return a checkout link");
      return Response.json({ url: session.url, orderId: order.id });
    }
    const planId = await ensurePlan(offer, price, db.store.currency);
    const sub = await createSubscription({ planId, order, base, brand, slug: offer.slug });
    await setProviderRef(order.id, { providerRef: sub.id, subscriptionId: sub.id });
    return Response.json({ url: sub.approveUrl, orderId: order.id });
  } catch (err) {
    console.error("[rainmaker] checkout failed", err);
    throw new HttpError(502, `Checkout couldn't start: ${err instanceof Error ? err.message : String(err)}`);
  }
});
