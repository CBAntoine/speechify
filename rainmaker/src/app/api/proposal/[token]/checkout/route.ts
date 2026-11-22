import { leadByProposal } from "@/lib/clients/proposal";
import { serviceById } from "@/lib/clients/services";
import { teamOffer } from "@/lib/clients/team-offer";
import { paypalEnabled, stripeEnabled } from "@/lib/config";
import { HttpError, readBody, route } from "@/lib/http";
import { createPendingOrder, setProviderRef } from "@/lib/payments/orders";
import { createSubscription, ensurePlan } from "@/lib/payments/paypal";
import { createCheckoutSession } from "@/lib/payments/stripe";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { siteUrl } from "@/lib/site";
import { readDb } from "@/lib/store";
import type { Price } from "@/lib/catalog";

// Public: a prospect accepts their proposal and pays. Creates a pending order
// for the proposal's services and price; paying it opens their client
// workspace and starts onboarding (see payments/fulfill.ts).

export const maxDuration = 30;

const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
/** Currencies PayPal subscriptions accept, of the ones North American clients use. */
const PAYPAL_CURRENCIES = new Set(["usd", "cad", "mxn", "eur", "dkk"]);
/** Stripe can't charge these yet. */
const NO_STRIPE = new Set(["cup", "xcg"]);

export const POST = route(async (req: Request, { params }: { params: Promise<{ token: string }> }) => {
  if (!rateLimit(`proposal:${clientIp(req)}`, 8, 10 * 60_000)) throw new HttpError(429, "Too many tries from this network. Try again in a few minutes.");
  const token = (await params).token;
  const lead = await leadByProposal(token);
  const p = lead?.proposal;
  if (!lead || !p) throw new HttpError(404, "This proposal isn't available any more.");
  const b = await readBody<Record<string, unknown>>(req);
  if (clip(b.company_url, 200)) return Response.json({ url: `/proposal/${token}` });
  const provider = b.provider === "paypal" ? "paypal" : "stripe";
  const email = clip(b.email, 200);
  if (!EMAIL.test(email)) throw new HttpError(400, "Enter a valid email address.");
  if (provider === "stripe" && (!stripeEnabled() || NO_STRIPE.has(p.currency))) throw new HttpError(400, "Card payments aren't available for this proposal. Reply to our email and we'll invoice you.");
  if (provider === "paypal" && (!paypalEnabled() || !PAYPAL_CURRENCIES.has(p.currency))) throw new HttpError(400, "PayPal isn't available for this proposal. Try a card, or reply and we'll invoice you.");

  const db = await readDb();
  const names = p.services.map((s) => serviceById(s)?.short).filter(Boolean);
  const offer = teamOffer(p.services.length === 7 ? "Full growth team" : `Growth team: ${names.join(", ")}`.slice(0, 120));
  const price: Price = { monthly: p.monthly, setup: p.setup, recurring: p.monthly, setupCharged: p.setup, interval: "month", annualSaving: 0 };
  const order = await createPendingOrder({
    offer,
    price,
    currency: p.currency,
    provider,
    buyer: { email, business: lead.name, website: lead.website, name: clip(b.name, 120) || undefined, phone: clip(b.phone, 40) || undefined },
    leadId: lead.id,
  });
  const base = siteUrl(req);
  const cancelUrl = `${base}/proposal/${token}?canceled=1`;
  try {
    if (provider === "stripe") {
      const session = await createCheckoutSession({ order, offer, price, currency: p.currency, base, brand: db.profile.agencyName, cancelUrl });
      await setProviderRef(order.id, { providerRef: session.id });
      if (!session.url) throw new Error("Stripe didn't return a checkout link");
      return Response.json({ url: session.url });
    }
    const planId = await ensurePlan(offer, price, p.currency);
    const sub = await createSubscription({ planId, order, base, brand: db.profile.agencyName, slug: offer.slug, cancelUrl });
    await setProviderRef(order.id, { providerRef: sub.id, subscriptionId: sub.id });
    return Response.json({ url: sub.approveUrl });
  } catch (err) {
    console.error("[rainmaker] proposal checkout failed", err);
    throw new HttpError(502, `Checkout couldn't start: ${err instanceof Error ? err.message : String(err)}`);
  }
});
