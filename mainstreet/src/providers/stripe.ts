import crypto from "node:crypto";
import { keys } from "../config.ts";
import { fetchWithTimeout } from "../util.ts";

// Stripe Checkout over plain REST (no SDK). One checkout per proposal: the
// website price as a one-time charge, plus optional monthly hosting.

function form(obj: Record<string, unknown>, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? form(item as Record<string, unknown>, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === "object") form(v as Record<string, unknown>, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export function stripeTestMode(): boolean {
  return Boolean(keys.stripe?.startsWith("sk_test_") || keys.stripe?.startsWith("rk_test_"));
}

export async function createCheckout(opts: {
  leadId: string;
  token: string;
  businessName: string;
  amountCents: number;
  currency: string;
  hostingMonthlyCents: number;
  email?: string;
  variant?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ id: string; url: string }> {
  if (!keys.stripe) throw new Error("Stripe isn't connected.");
  const currency = opts.currency.toLowerCase();
  const items: Record<string, unknown>[] = [
    {
      quantity: 1,
      price_data: { currency, unit_amount: opts.amountCents, product_data: { name: `New website for ${opts.businessName}`, description: "Design, build and launch of your new website" } },
    },
  ];
  if (opts.hostingMonthlyCents > 0) {
    items.push({ quantity: 1, price_data: { currency, unit_amount: opts.hostingMonthlyCents, recurring: { interval: "month" }, product_data: { name: "Hosting, updates and support" } } });
  }
  const body = form({
    mode: opts.hostingMonthlyCents > 0 ? "subscription" : "payment",
    line_items: items,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    client_reference_id: opts.leadId,
    customer_email: opts.email,
    metadata: { lead_id: opts.leadId, token: opts.token, variant: opts.variant ?? "" },
    ...(opts.hostingMonthlyCents > 0 ? { subscription_data: { metadata: { lead_id: opts.leadId } } } : { payment_intent_data: { metadata: { lead_id: opts.leadId } } }),
  });
  const res = await fetchWithTimeout("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${keys.stripe}`, "content-type": "application/x-www-form-urlencoded" },
    body,
    timeoutMs: 20_000,
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !data.url || !data.id) throw new Error(`Stripe: ${data.error?.message ?? `HTTP ${res.status}`}`);
  return { id: data.id, url: data.url };
}

/** Check a Stripe-Signature header (t=…,v1=…) against the raw body. */
export function verifyStripeSignature(raw: string, header: string | undefined, secret: string, toleranceSec = 300, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
    }),
  ) as Record<string, string>;
  const t = Number(parts.t);
  if (!t || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  const sigs = header
    .split(",")
    .filter((kv) => kv.trim().startsWith("v1="))
    .map((kv) => kv.trim().slice(3));
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}
