// Pure helpers for the payment providers: Stripe's form encoding, Stripe's
// webhook signature check, and the money/MRR math. No network, no Next
// imports, so they're unit tested directly.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Order } from "../types.ts";

type Scalar = string | number | boolean;
export type Encodable = Scalar | null | undefined | Encodable[] | { [k: string]: Encodable };

/** Stripe's application/x-www-form-urlencoded with bracket nesting: a[b][0][c]=v. */
export function formEncode(params: Record<string, Encodable>): string {
  const pairs: string[] = [];
  const walk = (key: string, v: Encodable) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(`${key}[${i}]`, item));
    } else if (typeof v === "object") {
      for (const [k, child] of Object.entries(v)) walk(`${key}[${k}]`, child);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  };
  for (const [k, v] of Object.entries(params)) walk(k, v);
  return pairs.join("&");
}

/** Dollars to the integer cents Stripe expects. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/**
 * Verify a Stripe-Signature header (t=...,v1=...) against the raw request
 * body. Rejects old timestamps to stop replays.
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  let t = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex");
  const exp = Buffer.from(expected, "hex");
  return sigs.some((s) => {
    if (!/^[0-9a-f]+$/i.test(s) || s.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(s, "hex"), exp);
  });
}

/** Build a header the way Stripe does (tests and local webhook replays). */
export function signStripePayload(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex")}`;
}

/** PayPal money strings: "297.00". */
export function paypalAmount(dollars: number): string {
  return (Math.round(dollars * 100) / 100).toFixed(2);
}

/** A stable key for one PayPal billing plan, so price changes create a new plan. */
export function paypalPlanKey(offerId: string, interval: string, amount: number, setup: number, currency: string): string {
  return `${offerId}:${interval}:${paypalAmount(amount)}:${paypalAmount(setup)}:${currency.toUpperCase()}`;
}

// ── Sales math ───────────────────────────────────────────────

export function monthlyEquivalent(o: Pick<Order, "amount" | "interval">): number {
  return o.interval === "year" ? o.amount / 12 : o.amount;
}

export interface SalesStats {
  mrr: number;
  active: number;
  pending: number;
  newThisMonth: number;
  churnedThisMonth: number;
  revenueThisMonth: number;
  lifetimeRevenue: number;
}

export function salesStats(orders: Order[], now = new Date()): SalesStats {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const inMonth = (iso?: string) => Boolean(iso && Date.parse(iso) >= monthStart);
  let mrr = 0;
  let active = 0;
  let pending = 0;
  let newThisMonth = 0;
  let churnedThisMonth = 0;
  let revenueThisMonth = 0;
  let lifetimeRevenue = 0;
  for (const o of orders) {
    if (o.status === "active" || o.status === "past_due") {
      mrr += monthlyEquivalent(o);
      active++;
    }
    if (o.status === "pending") pending++;
    if (inMonth(o.activatedAt)) newThisMonth++;
    if (o.status === "canceled" && inMonth(o.canceledAt)) churnedThisMonth++;
    for (const p of o.payments) {
      lifetimeRevenue += p.amount;
      if (inMonth(p.at)) revenueThisMonth += p.amount;
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { mrr: r(mrr), active, pending, newThisMonth, churnedThisMonth, revenueThisMonth: r(revenueThisMonth), lifetimeRevenue: r(lifetimeRevenue) };
}
