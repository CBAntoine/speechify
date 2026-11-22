// What a person doing each job would cost in a client's country, and a
// price for each service that stays at or below it. Default prices are US
// list prices; other markets scale them by how local wages compare to US
// wages for the same job, never below what delivery costs (texts, call
// minutes, AI) and never above what the person would cost, unless delivery
// alone costs more, which the quote flags. Pure.

import { USD_PER_UNIT, WAGES, type MarketWages } from "../labor-data.ts";
import type { ServiceId } from "../types.ts";
import { BUNDLE_USD, SERVICES, type ServiceDef } from "./services.ts";

/** Hours in a full-time month (40 hours x 52 weeks / 12). */
export const FULL_TIME_HOURS = 173;
/** Prices are kept at least this many times the delivery cost. */
export const MIN_MARKUP = 3;

export function wagesFor(country: string | undefined): MarketWages {
  const c = (country ?? "").toUpperCase();
  return WAGES.find((w) => w.country === c) ?? WAGES.find((w) => w.country === "US")!;
}

export function usdRate(currency: string): number | undefined {
  const r = USD_PER_UNIT[currency.toLowerCase()];
  return typeof r === "number" && r > 0 ? r : undefined;
}

export function toUsd(amount: number, currency: string): number {
  return amount * (usdRate(currency) ?? 1);
}

export function fromUsd(usd: number, currency: string): number {
  return usd / (usdRate(currency) ?? 1);
}

/** Currencies where "$297"-style prices read naturally. */
const CHARM = new Set(["usd", "cad", "bsd", "bmd", "kyd", "bzd", "bbd", "xcd", "awg", "xcg", "eur", "pab"]);

/** A price that looks deliberate: 296.4 → 297 in dollars; 5,012 → 4,990 in pesos. */
export function niceRound(n: number, currency: string): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 20) return Math.round(n);
  if (CHARM.has(currency.toLowerCase())) {
    const step = n < 1000 ? 10 : 100;
    return Math.max(step - 3, Math.round(n / step) * step - 3);
  }
  const magnitude = 10 ** (Math.floor(Math.log10(n)) - 1);
  const r = Math.round(n / magnitude) * magnitude;
  return r >= 1000 ? r - 10 : r;
}

/** A person doing this service's job, per month, in local currency (wage x hours x employer costs). */
export function humanMonthly(s: ServiceDef, w: MarketWages): number {
  return s.hours * w.hourly[s.role] * w.burden;
}

export function humanSetup(s: ServiceDef, w: MarketWages): number {
  return (s.setupHours ?? 0) * w.hourly[s.role] * w.burden;
}

/** How local wages for this job compare to US wages, after converting to dollars. */
export function wageIndex(s: ServiceDef, w: MarketWages): number {
  const us = wagesFor("US");
  const local = toUsd(w.hourly[s.role] * w.burden, w.currency);
  const base = us.hourly[s.role] * us.burden;
  return base > 0 ? local / base : 1;
}

/** Local front-desk wages against US ones, in dollars: a rough guide to local price levels (0.05-1.6). */
export function costIndex(country: string): number {
  const w = wagesFor(country);
  const us = wagesFor("US");
  const local = toUsd(w.hourly.receptionist * w.burden, w.currency);
  const base = us.hourly.receptionist * us.burden;
  return base > 0 ? Math.min(1.6, Math.max(0.05, local / base)) : 1;
}

/** "$1,000–$3,000+ per new patient" → 1000: the low end of a niche's typical customer value, in US dollars. */
export function usdValueFrom(text: string | undefined, fallback = 300): number {
  const m = (text ?? "").match(/\$\s?([\d,]+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return fallback;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** What one booked customer is worth in a market, in local currency: the niche's US value scaled to local prices. */
export function localJobValue(customerValue: string | undefined, country: string): number {
  const w = wagesFor(country);
  return niceRound(fromUsd(usdValueFrom(customerValue) * costIndex(country), w.currency), w.currency) || 1;
}

export interface ServiceQuote {
  id: ServiceId;
  step: number;
  /** A person doing it, per month, local currency. */
  humanMonthly: number;
  /** A person setting it up once, local currency. */
  humanSetup: number;
  /** Suggested monthly price and setup, local currency. */
  price: number;
  setup: number;
  /** The lowest monthly price that still covers delivery with a margin. */
  floor: number;
  /** price / humanMonthly. */
  share: number;
  /** Delivering it costs more here than paying a person: sell on speed and coverage, not price. */
  personCheaper: boolean;
}

export interface Quote {
  country: string;
  currency: string;
  basis: MarketWages["basis"];
  lines: ServiceQuote[];
  /** Sums of the selected lines. */
  humanMonthly: number;
  humanSetup: number;
  /** Sum of the suggested prices. */
  listMonthly: number;
  /** The price for the selection: the bundle price when all seven are chosen. */
  monthly: number;
  setup: number;
  /** Monthly saving against paying people, local currency. */
  saving: number;
  /** monthly / humanMonthly. */
  share: number;
  /** Full-time-equivalent people the selection replaces. */
  fte: number;
}

export function quoteService(s: ServiceDef, w: MarketWages): ServiceQuote {
  const currency = w.currency;
  const human = humanMonthly(s, w);
  const index = Math.min(1.6, Math.max(0.05, wageIndex(s, w)));
  const floor = niceRound(fromUsd(s.deliveryUsd * MIN_MARKUP, currency), currency);
  const scaled = fromUsd(s.price.monthly * index, currency);
  const capped = Math.min(scaled, human);
  const price = niceRound(Math.max(floor, capped), currency);
  const setup = s.price.setup ? niceRound(Math.max(fromUsd(s.price.setup * index, currency), fromUsd(100, currency)), currency) : 0;
  return {
    id: s.id,
    step: s.step,
    humanMonthly: Math.round(human),
    humanSetup: Math.round(humanSetup(s, w)),
    price,
    setup,
    floor,
    share: human > 0 ? price / human : 0,
    personCheaper: floor > human,
  };
}

/** Prices for some or all services in a country. All seven together get the bundle price. */
export function quote(country: string, services: ServiceId[] = SERVICES.map((s) => s.id)): Quote {
  const w = wagesFor(country);
  const chosen = SERVICES.filter((s) => services.includes(s.id));
  const lines = chosen.map((s) => quoteService(s, w));
  const sum = (f: (l: ServiceQuote) => number) => lines.reduce((a, l) => a + f(l), 0);
  const listMonthly = sum((l) => l.price);
  const listSetup = sum((l) => l.setup);
  const human = sum((l) => l.humanMonthly);
  const all = chosen.length === SERVICES.length;
  const listUsd = SERVICES.reduce((a, s) => a + s.price.monthly, 0);
  const setupUsd = SERVICES.reduce((a, s) => a + s.price.setup, 0);
  const monthly = all ? niceRound(Math.max(sum((l) => l.floor), listMonthly * (BUNDLE_USD.monthly / listUsd)), w.currency) : listMonthly;
  const setup = all && setupUsd ? niceRound(listSetup * (BUNDLE_USD.setup / setupUsd), w.currency) : listSetup;
  return {
    country: w.country,
    currency: w.currency,
    basis: w.basis,
    lines,
    humanMonthly: Math.round(human),
    humanSetup: Math.round(sum((l) => l.humanSetup)),
    listMonthly,
    monthly,
    setup,
    saving: Math.round(human - monthly),
    share: human > 0 ? monthly / human : 0,
    fte: Math.round((chosen.reduce((a, s) => a + s.hours, 0) / FULL_TIME_HOURS) * 10) / 10,
  };
}

/** "es" + "MX" → "es-MX", for number and date formatting. */
export function localeFor(lang: string, country: string): string {
  return `${lang}-${country.toUpperCase()}`;
}

/** Money in the client's currency, no cents: "$1,497", "MX$4,990", "1 497 $". */
export function formatMoney(n: number, currency: string, locale = "en-US"): string {
  const code = currency.toUpperCase();
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Math.round(n));
  } catch {
    return `${code} ${Math.round(n).toLocaleString("en-US")}`;
  }
}
