import { sign, verify, secureCookie } from "./signing";

/**
 * Crew Pass (paid membership) without a database:
 * Stripe is the source of truth; the browser holds a signed claim that we
 * re-check against Stripe when it expires.
 */
export const CREW_COOKIE = "na_crew";
export const CREW_UI_COOKIE = "na_crew_ui"; // readable flag the UI uses to hide ads
const CLAIM_DAYS = 32;
const MAX_DEVICES = Number(process.env.CREW_PASS_MAX_DEVICES || 5);

export interface CrewClaims {
  /** Stripe customer id (or "guest") */
  c: string;
  /** Stripe subscription id, if the pass is a subscription */
  s?: string;
  /** Expiry, epoch ms */
  exp: number;
}

const stripeKey = () => process.env.STRIPE_SECRET_KEY || "";

async function stripe<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      ...(init?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type StripeRef = string | { id: string } | null | undefined;
const refId = (r: StripeRef) => (typeof r === "string" ? r : r?.id);

export function crewConfigured(): boolean {
  return !!stripeKey();
}

/** Verify a completed Checkout Session from a Payment Link and mint claims. */
export async function claimsFromCheckout(sessionId: string): Promise<{ claims: CrewClaims } | { error: string }> {
  if (!crewConfigured()) return { error: "Payments aren't configured on this site yet." };
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,}$/.test(sessionId)) return { error: "That checkout link looks invalid." };
  const s = await stripe<{
    status: string;
    payment_status: string;
    customer: StripeRef;
    subscription: StripeRef;
  }>(`checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (s.status !== "complete" || !["paid", "no_payment_required"].includes(s.payment_status)) {
    return { error: "We couldn't confirm that payment yet. Refresh in a few seconds." };
  }
  const customer = refId(s.customer);
  const subscription = refId(s.subscription);
  if (customer) {
    // Cap how many browsers one purchase can unlock (stops link sharing).
    const cust = await stripe<{ metadata?: Record<string, string> }>(`customers/${customer}`);
    const used = Number(cust.metadata?.na_activations || 0);
    if (used >= MAX_DEVICES) return { error: "This pass is already active on the maximum number of devices." };
    await stripe(`customers/${customer}`, {
      method: "POST",
      body: new URLSearchParams({ "metadata[na_activations]": String(used + 1) }),
    });
  }
  return { claims: { c: customer || "guest", s: subscription, exp: Date.now() + CLAIM_DAYS * 86_400_000 } };
}

async function subscriptionActive(subId: string): Promise<boolean> {
  const sub = await stripe<{ status: string }>(`subscriptions/${encodeURIComponent(subId)}`);
  return ["active", "trialing", "past_due"].includes(sub.status);
}

/** Find an active pass by email (for "restore on another device"). */
export async function claimsForEmail(email: string): Promise<CrewClaims | null> {
  if (!crewConfigured()) return null;
  const list = await stripe<{ data: { id: string }[] }>(`customers?email=${encodeURIComponent(email)}&limit=5`);
  for (const cust of list.data) {
    const subs = await stripe<{ data: { id: string }[] }>(`subscriptions?customer=${cust.id}&status=active&limit=1`);
    if (subs.data[0]) return { c: cust.id, s: subs.data[0].id, exp: Date.now() + CLAIM_DAYS * 86_400_000 };
  }
  return null;
}

/**
 * Read the member cookie. Expired subscription claims are re-checked with Stripe
 * and refreshed; `refreshed` holds a new cookie value to set when that happens.
 */
export async function readCrew(raw: string | undefined): Promise<{ claims: CrewClaims | null; refreshed?: string }> {
  const claims = verify<CrewClaims>(raw);
  if (!claims) return { claims: null };
  if (claims.exp > Date.now()) return { claims };
  if (!claims.s || !crewConfigured()) return { claims: null };
  try {
    if (await subscriptionActive(claims.s)) {
      const next = { ...claims, exp: Date.now() + CLAIM_DAYS * 86_400_000 };
      return { claims: next, refreshed: sign(next) };
    }
  } catch (err) {
    console.error("[crew] refresh failed", err);
    return { claims }; // fail open briefly rather than locking out a paying member
  }
  return { claims: null };
}

export const crewCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: secureCookie,
  path: "/",
  maxAge: 400 * 86_400,
};

export const crewUiCookieOptions = { ...crewCookieOptions, httpOnly: false };
