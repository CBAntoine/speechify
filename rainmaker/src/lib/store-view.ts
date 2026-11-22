import "server-only";
import { CATEGORIES, PLANS, PRODUCTS, bundleWorth, isVisible, priceOf, type Category, type Offer } from "@/lib/catalog";
import { elevenEnabled, paypalEnabled, paypalMode, stripeEnabled, stripeMode } from "@/lib/config";
import { resolveSalesAgentId } from "@/lib/elevenlabs/sales-agent";
import { readDb } from "@/lib/store";
import type { StoreSettings } from "@/lib/types";

// Everything the public store pages (and the sales assistant's tools) need,
// with the owner's prices applied. Serializable, so it can go to the client.

export interface OfferView extends Omit<Offer, "costs" | "signals" | "niches"> {
  /** Price per month on monthly billing. */
  price: number;
  /** Price per year on yearly billing (10 months). */
  yearly: number;
  setupFee: number;
  /** Setup charged on yearly billing (0 when waived). */
  setupYearly: number;
  annualSaving: number;
  /** For plans: what the bundled products cost separately per month. */
  worth?: number;
}

export interface StoreView {
  brand: { name: string; owner: string; email: string; phone: string; website: string; calendarUrl: string; city: string; mailingAddress: string };
  settings: Pick<StoreSettings, "enabled" | "currency" | "annual" | "waiveSetupOnAnnual" | "overagePerMinute" | "assistantName" | "showEngine" | "headline" | "subheadline">;
  plans: OfferView[];
  products: OfferView[];
  categories: Category[];
  payments: { stripe: boolean; paypal: boolean; testMode: boolean };
  assistant: boolean;
}

function view(o: Offer, s: StoreSettings): OfferView {
  const m = priceOf(o, s, "month");
  const y = priceOf(o, s, "year");
  const { costs, signals, niches, ...rest } = o;
  return {
    ...rest,
    price: m.monthly,
    yearly: y.recurring,
    setupFee: m.setup,
    setupYearly: y.setupCharged,
    annualSaving: m.annualSaving,
    ...(o.kind === "plan" ? { worth: bundleWorth(o, s) } : {}),
  };
}

export async function getStoreView(): Promise<StoreView> {
  const db = await readDb();
  const s = db.store;
  const p = db.profile;
  return {
    brand: { name: p.agencyName, owner: p.ownerName, email: p.email, phone: p.phone, website: p.website, calendarUrl: p.calendarUrl, city: p.city, mailingAddress: p.mailingAddress },
    settings: {
      enabled: s.enabled,
      currency: s.currency,
      annual: s.annual,
      waiveSetupOnAnnual: s.waiveSetupOnAnnual,
      overagePerMinute: s.overagePerMinute,
      assistantName: s.assistantName,
      showEngine: s.showEngine,
      headline: s.headline,
      subheadline: s.subheadline,
    },
    plans: PLANS.filter((o) => isVisible(o, s)).map((o) => view(o, s)),
    products: PRODUCTS.filter((o) => isVisible(o, s)).map((o) => view(o, s)),
    categories: CATEGORIES,
    payments: { stripe: stripeEnabled(), paypal: paypalEnabled(), testMode: stripeMode() === "test" || (paypalEnabled() && paypalMode() === "sandbox") },
    assistant: elevenEnabled() && Boolean(await resolveSalesAgentId()),
  };
}

export function findOfferView(v: StoreView, idOrSlug: string): OfferView | undefined {
  const k = idOrSlug.toLowerCase();
  return [...v.plans, ...v.products].find((o) => o.id === k || o.slug === k);
}
