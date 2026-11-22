import "server-only";
import { paypalEnabled, paypalMode } from "@/lib/config";
import type { Offer, Price } from "@/lib/catalog";
import { readDb, update } from "@/lib/store";
import type { Order } from "@/lib/types";
import { paypalAmount, paypalPlanKey } from "./encode";

// PayPal Subscriptions over REST. A subscription needs a catalog product and
// a billing plan; Rainmaker creates them the first time an offer is bought
// with PayPal and remembers their ids, keyed by price, so a price change
// simply creates a new plan.

export const PAYPAL_EVENTS = [
  "BILLING.SUBSCRIPTION.ACTIVATED",
  "BILLING.SUBSCRIPTION.UPDATED",
  "BILLING.SUBSCRIPTION.CANCELLED",
  "BILLING.SUBSCRIPTION.SUSPENDED",
  "BILLING.SUBSCRIPTION.EXPIRED",
  "BILLING.SUBSCRIPTION.PAYMENT.FAILED",
  "PAYMENT.SALE.COMPLETED",
] as const;

export class PaypalError extends Error {
  constructor(
    message: string,
    public status: number,
    public name_?: string
  ) {
    super(message);
  }
}

export function paypalBase(): string {
  return paypalMode() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

const g = globalThis as { __rmPaypalToken?: { token: string; exp: number; key: string } };

async function accessToken(): Promise<string> {
  if (!paypalEnabled()) throw new PaypalError("Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to take PayPal payments", 400);
  const key = `${paypalMode()}:${process.env.PAYPAL_CLIENT_ID}`;
  const cached = g.__rmPaypalToken;
  if (cached && cached.key === key && cached.exp > Date.now() + 60_000) return cached.token;
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !data.access_token) {
    throw new PaypalError(
      res.status === 401 ? `PayPal rejected the client id or secret (${paypalMode()} mode). Check PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET and PAYPAL_MODE.` : data.error_description ?? `PayPal error ${res.status}`,
      res.status
    );
  }
  g.__rmPaypalToken = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3000) * 1000, key };
  return data.access_token;
}

export async function paypal<T = Record<string, unknown>>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, opts: { requestId?: string } = {}): Promise<T> {
  const token = await accessToken();
  const res = await fetch(`${paypalBase()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(opts.requestId ? { "paypal-request-id": opts.requestId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 204) return {} as T;
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; name?: string; details?: { issue?: string; description?: string }[] };
  if (!res.ok) {
    const detail = data.details?.[0]?.description ?? data.details?.[0]?.issue;
    throw new PaypalError(`${data.message ?? `PayPal error ${res.status}`}${detail ? `: ${detail}` : ""}`, res.status, data.name);
  }
  return data;
}

/** The billing plan for this offer at this price, creating product and plan on first use. */
export async function ensurePlan(offer: Offer, price: Price, currency: string): Promise<string> {
  const key = paypalPlanKey(offer.id, price.interval, price.recurring, price.setupCharged, currency);
  const db = await readDb();
  const known = db.payments.paypal.plans[`${paypalMode()}:${key}`];
  if (known) return known;

  const productKey = `${paypalMode()}:${offer.id}`;
  let productId = db.payments.paypal.products[productKey];
  if (!productId) {
    const product = await paypal<{ id: string }>(
      "POST",
      "/v1/catalogs/products",
      { name: offer.name.slice(0, 127), description: offer.tagline.slice(0, 256), type: "SERVICE", category: "SOFTWARE" },
      { requestId: `rm-product-${productKey}` }
    );
    productId = product.id;
  }
  const C = currency.toUpperCase();
  const plan = await paypal<{ id: string }>(
    "POST",
    "/v1/billing/plans",
    {
      product_id: productId,
      name: `${offer.name} (${price.interval === "year" ? "yearly" : "monthly"})`.slice(0, 127),
      description: offer.tagline.slice(0, 127),
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: price.interval === "year" ? "YEAR" : "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value: paypalAmount(price.recurring), currency_code: C } },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee: { value: paypalAmount(price.setupCharged), currency_code: C },
        setup_fee_failure_action: "CANCEL",
        payment_failure_threshold: 3,
      },
    },
    { requestId: `rm-plan-${paypalMode()}-${key}`.slice(0, 100) }
  );
  await update((d) => {
    d.payments.paypal.products[productKey] = productId!;
    d.payments.paypal.plans[`${paypalMode()}:${key}`] = plan.id;
  });
  return plan.id;
}

export interface PaypalSubscription {
  id: string;
  status: "APPROVAL_PENDING" | "APPROVED" | "ACTIVE" | "SUSPENDED" | "CANCELLED" | "EXPIRED";
  custom_id?: string;
  plan_id?: string;
  subscriber?: { email_address?: string; name?: { given_name?: string; surname?: string }; payer_id?: string };
  billing_info?: { last_payment?: { amount?: { value?: string } }; next_billing_time?: string };
  links?: { href: string; rel: string }[];
}

export async function createSubscription(input: { planId: string; order: Order; base: string; brand: string; slug: string; cancelUrl?: string }): Promise<{ id: string; approveUrl: string }> {
  const { order } = input;
  const [given, ...rest] = (order.name ?? "").trim().split(/\s+/);
  const sub = await paypal<PaypalSubscription>(
    "POST",
    "/v1/billing/subscriptions",
    {
      plan_id: input.planId,
      custom_id: order.id,
      ...(order.email
        ? { subscriber: { email_address: order.email, ...(given ? { name: { given_name: given, surname: rest.join(" ") || given } } : {}) } }
        : {}),
      application_context: {
        brand_name: input.brand.slice(0, 127),
        user_action: "SUBSCRIBE_NOW",
        shipping_preference: "NO_SHIPPING",
        return_url: `${input.base}/store/thanks?order=${encodeURIComponent(order.id)}&provider=paypal`,
        cancel_url: input.cancelUrl ?? `${input.base}/store/${input.slug}?canceled=1`,
      },
    },
    { requestId: `rm-sub-${order.id}` }
  );
  const approveUrl = sub.links?.find((l) => l.rel === "approve")?.href;
  if (!approveUrl) throw new PaypalError("PayPal didn't return an approval link", 502);
  return { id: sub.id, approveUrl };
}

export function getSubscription(id: string): Promise<PaypalSubscription> {
  return paypal<PaypalSubscription>("GET", `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
}

export async function cancelPaypalSubscription(id: string, reason: string): Promise<void> {
  await paypal("POST", `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, { reason: reason.slice(0, 127) });
}

/** Ask PayPal whether a webhook delivery is genuine. */
export async function verifyPaypalWebhook(headers: Headers, event: unknown, webhookId: string): Promise<boolean> {
  const h = (k: string) => headers.get(k) ?? "";
  if (!h("paypal-transmission-id") || !h("paypal-transmission-sig")) return false;
  const res = await paypal<{ verification_status?: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: event,
  });
  return res.verification_status === "SUCCESS";
}

/** Register this deployment's webhook with PayPal (or find the one already there). */
export async function connectPaypalWebhook(url: string): Promise<{ id: string; reused: boolean }> {
  const list = await paypal<{ webhooks?: { id: string; url: string }[] }>("GET", "/v1/notifications/webhooks");
  const existing = list.webhooks?.find((w) => w.url === url);
  if (existing) {
    await paypal("PATCH", `/v1/notifications/webhooks/${existing.id}`, [
      { op: "replace", path: "/event_types", value: PAYPAL_EVENTS.map((name) => ({ name })) },
    ]).catch(() => undefined);
    return { id: existing.id, reused: true };
  }
  const created = await paypal<{ id: string }>("POST", "/v1/notifications/webhooks", { url, event_types: PAYPAL_EVENTS.map((name) => ({ name })) });
  return { id: created.id, reused: false };
}

export async function paypalWebhookId(): Promise<string | undefined> {
  return process.env.PAYPAL_WEBHOOK_ID || (await readDb()).payments.paypal.webhookId;
}
