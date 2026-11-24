import "server-only";
import { stripeEnabled } from "@/lib/config";
import type { Offer, Price } from "@/lib/catalog";
import type { Order } from "@/lib/types";
import { formEncode, toCents, type Encodable } from "./encode";

// Stripe over its REST API (no SDK): Checkout Sessions in subscription mode
// with inline prices, so nothing has to be created in the Stripe dashboard
// first. A setup fee rides along as a one-time line item on the first
// invoice. Prices change in Rainmaker and the next checkout uses them.

const API = "https://api.stripe.com/v1";

export const STRIPE_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;

export class StripeError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string
  ) {
    super(message);
  }
}

type Params = Record<string, Encodable>;

export async function stripe<T = Record<string, unknown>>(method: "GET" | "POST" | "DELETE", path: string, params?: Params, opts: { idempotencyKey?: string } = {}): Promise<T> {
  if (!stripeEnabled()) throw new StripeError("Add your Stripe secret key in Settings → API keys to take card payments", 400);
  const query = method === "GET" && params ? `?${formEncode(params)}` : "";
  const res = await fetch(`${API}${path}${query}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
      ...(opts.idempotencyKey ? { "idempotency-key": opts.idempotencyKey } : {}),
    },
    body: method === "POST" && params ? formEncode(params) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: string } };
  if (!res.ok) {
    const msg = data.error?.message ?? `Stripe error ${res.status}`;
    throw new StripeError(res.status === 401 ? "Stripe rejected the secret key. Check it in Settings → API keys." : msg, res.status, data.error?.code);
  }
  return data;
}

export interface CheckoutSession {
  id: string;
  url: string | null;
  status: "open" | "complete" | "expired" | null;
  payment_status: "paid" | "unpaid" | "no_payment_required";
  customer: string | null;
  subscription: string | null;
  client_reference_id: string | null;
  amount_total: number | null;
  metadata: Record<string, string> | null;
  customer_details?: { email?: string | null; name?: string | null; phone?: string | null } | null;
}

export async function createCheckoutSession(input: {
  order: Order;
  offer: Offer;
  price: Price;
  currency: string;
  base: string;
  brand: string;
}): Promise<CheckoutSession> {
  const { order, offer, price, currency, base } = input;
  const interval = price.interval;
  const lineItems: Encodable[] = [
    {
      price_data: {
        currency,
        unit_amount: toCents(price.recurring),
        recurring: { interval },
        product_data: {
          name: `${offer.name} (${interval === "year" ? "yearly" : "monthly"})`,
          description: offer.tagline.slice(0, 300),
          metadata: { offer_id: offer.id },
        },
      },
      quantity: 1,
    },
  ];
  if (price.setupCharged > 0) {
    lineItems.push({
      price_data: { currency, unit_amount: toCents(price.setupCharged), product_data: { name: `${offer.name} setup`, description: "One-time setup, charged with the first payment" } },
      quantity: 1,
    });
  }
  const params: Params = {
    mode: "subscription",
    line_items: lineItems,
    client_reference_id: order.id,
    customer_email: order.email,
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    phone_number_collection: { enabled: true },
    metadata: { order_id: order.id, offer_id: offer.id, business: order.business?.slice(0, 450) },
    subscription_data: { metadata: { order_id: order.id, offer_id: offer.id }, description: `${input.brand}: ${offer.name}` },
    success_url: `${base}/store/thanks?order=${encodeURIComponent(order.id)}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/store/${offer.slug}?canceled=1`,
    ...(process.env.STRIPE_AUTOMATIC_TAX === "1" ? { automatic_tax: { enabled: true } } : {}),
  };
  return stripe<CheckoutSession>("POST", "/checkout/sessions", params, { idempotencyKey: `checkout_${order.id}` });
}

export function getCheckoutSession(id: string): Promise<CheckoutSession> {
  return stripe<CheckoutSession>("GET", `/checkout/sessions/${encodeURIComponent(id)}`);
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const s = await stripe<{ url: string }>("POST", "/billing_portal/sessions", { customer: customerId, return_url: returnUrl });
  return s.url;
}

export async function cancelStripeSubscription(subscriptionId: string): Promise<void> {
  await stripe("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

interface WebhookEndpoint {
  id: string;
  url: string;
  secret?: string;
  status: string;
}

/**
 * Point Stripe at this deployment's webhook. Stripe only reveals a signing
 * secret when an endpoint is created, so an endpoint we can't reuse is
 * replaced (only one Rainmaker created itself, never anyone else's).
 */
export async function connectStripeWebhook(url: string, known?: { webhookId?: string; webhookSecret?: string }): Promise<{ id: string; secret: string; reused: boolean }> {
  const list = await stripe<{ data: (WebhookEndpoint & { metadata?: Record<string, string> })[] }>("GET", "/webhook_endpoints", { limit: 100 });
  const mine = list.data.filter((e) => e.url === url);
  const current = known?.webhookId ? mine.find((e) => e.id === known.webhookId) : undefined;
  if (current && known?.webhookSecret && current.status === "enabled") return { id: current.id, secret: known.webhookSecret, reused: true };
  for (const e of mine) if (e.metadata?.created_by === "rainmaker") await stripe("DELETE", `/webhook_endpoints/${e.id}`).catch(() => undefined);
  const created = await stripe<WebhookEndpoint>("POST", "/webhook_endpoints", {
    url,
    enabled_events: [...STRIPE_EVENTS],
    description: "Rainmaker store: subscriptions and payments",
    metadata: { created_by: "rainmaker" },
  });
  if (!created.secret) throw new StripeError("Stripe didn't return a signing secret. Add the webhook signing secret in Settings → API keys.", 502);
  return { id: created.id, secret: created.secret, reused: false };
}

/** Subscription id on an invoice, across Stripe API versions. */
export function invoiceSubscription(invoice: Record<string, unknown>): string | undefined {
  const direct = invoice.subscription;
  if (typeof direct === "string") return direct;
  const parent = invoice.parent as { subscription_details?: { subscription?: string } } | undefined;
  return parent?.subscription_details?.subscription ?? undefined;
}
