// First-run data: an empty workspace with a default agency profile. No demo
// data: the pipeline, inbox and ads start empty.

import type { AgencyProfile, Db, PaymentsState } from "./types.ts";
import { DEFAULT_STORE } from "./catalog.ts";
import { defaultAutopilot } from "./autopilot/plan.ts";

export function defaultPayments(): PaymentsState {
  return { stripe: {}, paypal: { products: {}, plans: {} }, seenEvents: [] };
}

/** The placeholder offer and pricing earlier versions filled in; cleared from databases that still have them. */
export const OLD_PLACEHOLDERS = {
  coreOffer: "We fill your calendar with booked appointments using ads, a fast website and automatic follow-up. You only keep paying if it works.",
  pricing: "Setup $500, then $1,500/month. Cancel anytime.",
};

export function defaultProfile(): AgencyProfile {
  return {
    agencyName: "Your Agency",
    ownerName: "",
    email: "",
    phone: "",
    website: "",
    city: "",
    services: ["Google & Meta ads", "Websites that book appointments", "Review generation", "Missed-call text-back"],
    // Your offer and prices: blank until you write them, so nothing made up reaches a prospect.
    coreOffer: "",
    pricing: "",
    calendarUrl: "",
    voice: "Friendly, direct and specific. Short sentences. No hype, no jargon.",
    targetNiches: ["dentist", "med_spa", "roofer"],
    proof: "",
    mailingAddress: "",
  };
}

export function seedDb(): Db {
  return {
    version: 1,
    profile: defaultProfile(),
    leads: [],
    drafts: [],
    campaigns: [],
    tasks: [],
    runs: [],
    activity: [],
    managed: { agents: {} },
    orders: [],
    store: structuredClone(DEFAULT_STORE),
    payments: defaultPayments(),
    autopilot: defaultAutopilot(),
    seeded: true,
  };
}
