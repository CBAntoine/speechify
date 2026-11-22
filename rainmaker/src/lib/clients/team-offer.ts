// The offer an accepted proposal pays for: the client's chosen services from
// the seven, at the price on their proposal. It isn't in the store's catalog
// (each proposal carries its own price), so orders resolve it here. Pure.

import { getOffer, type Offer } from "../catalog.ts";
import type { Order } from "../types.ts";

export const TEAM_OFFER_ID = "team";

export function teamOffer(name = "Growth team"): Offer {
  return {
    id: TEAM_OFFER_ID,
    slug: TEAM_OFFER_ID,
    kind: "plan",
    category: "plans",
    name,
    tagline: "Website, instant follow-up, every call answered, reviews, coaching and ads: done for you.",
    summary: "The jobs a front desk, a follow-up team and a marketing person would do, run for you every day for less than one of them would cost.",
    icon: "Users",
    monthly: 0,
    setup: 0,
    included: [],
    features: [],
    howItWorks: [
      "Kickoff call (30 minutes): your services, hours, prices, booking link and where calls should go.",
      "Week 1: your new website goes live, and we bring back past customers from your list.",
      "Then, in order: review requests to every customer, instant replies to every new lead, and every call answered, even when you're busy.",
      "Every month: a results report with calls answered, leads followed up, reviews and bookings.",
    ],
    idealFor: [],
    deliverables: [],
    engine: [],
    timeToLive: "First services live within 7 days",
    example: "",
    faqs: [],
    costs: [],
    bundles: [],
  };
}

/** The catalog offer behind an order, or the team offer for an accepted proposal. */
export function offerForOrder(order: Pick<Order, "offerId" | "offerName">): Offer | undefined {
  return getOffer(order.offerId) ?? (order.offerId === TEAM_OFFER_ID ? teamOffer(order.offerName) : undefined);
}
