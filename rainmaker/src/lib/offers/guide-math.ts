// The AI Website Guide offer: a chat and voice agent on a business's website
// that answers visitors and turns them into leads. Who to pitch, what it's
// worth to them and what to charge, from the playbook's baseline: about 5%
// of visitors talk to the guide and 2.5% become leads. Pure, unit tested.

export type Intent = "urgent" | "considered" | "elective";

/**
 * What one inbound lead is roughly worth to a business in each niche (in
 * dollars): a starting estimate to edit, or to check by asking Claude what a
 * lead is worth in their industry.
 */
export const LEAD_VALUE: Record<string, number> = {
  hvac: 350,
  plumber: 250,
  roofer: 600,
  auto_repair: 120,
  pest_control: 150,
  dentist: 250,
  veterinarian: 120,
  law_pi: 1500,
  real_estate: 800,
  accountant: 300,
  physical_therapy: 150,
  chiropractor: 150,
  landscaping: 200,
  cleaning: 120,
  gym: 60,
  salon: 40,
  med_spa: 150,
  restaurant: 20,
};
export const DEFAULT_LEAD_VALUE = 150;

/**
 * Need-to-have businesses (a broken furnace, a burst pipe) and high-ticket
 * ones with complex catalogs convert website visitors best. Want-to-have
 * services (med spas) convert least, so pitch them last.
 */
export const INTENT: Record<string, Intent> = {
  hvac: "urgent",
  plumber: "urgent",
  roofer: "urgent",
  auto_repair: "urgent",
  pest_control: "urgent",
  veterinarian: "urgent",
  dentist: "urgent",
  law_pi: "urgent",
  real_estate: "considered",
  accountant: "considered",
  physical_therapy: "considered",
  landscaping: "considered",
  chiropractor: "elective",
  cleaning: "elective",
  gym: "elective",
  salon: "elective",
  med_spa: "elective",
  restaurant: "elective",
};

export const INTENT_LABEL: Record<Intent, { label: string; advice: string }> = {
  urgent: { label: "High intent", advice: "Need-to-have service: visitors want an answer now, so an AI guide on the site turns into leads fast. Pitch these first." },
  considered: { label: "Considered purchase", advice: "Higher-ticket and researched: the guide wins by answering detailed questions about services, pricing and process." },
  elective: { label: "Want-to-have", advice: "Nice-to-have service: visitors browse more than they buy. Expect fewer leads; pitch these after the high-intent ones." },
};

export const INTERACT_RATE = 0.05;
export const LEAD_RATE = 0.025;
/** Monthly retainer bounds from the playbook: $300 for a small site up to $4,000+ for busy ones. */
export const MIN_RETAINER = 300;
export const MAX_RETAINER = 4000;

export interface GuideRoi {
  visitors: number;
  leadValue: number;
  /** Visitors a month who talk to the guide (5%). */
  chats: number;
  /** Visitors a month who leave their details (2.5%). */
  leads: number;
  /** What those leads are worth to the business each month. */
  value: number;
  price: {
    monthly: number;
    /** True when the value supports more than the $4,000 shown. */
    plus: boolean;
    setup: number;
    setupNote: string;
  };
}

export function leadValueFor(nicheId: string | undefined): number {
  return (nicheId && LEAD_VALUE[nicheId]) || DEFAULT_LEAD_VALUE;
}

export function intentFor(nicheId: string | undefined): Intent {
  return (nicheId && INTENT[nicheId]) || "considered";
}

const roundTo = (n: number, step: number) => Math.round(n / step) * step;

/**
 * The month's numbers for a site. The retainer is about a tenth of the lead
 * value the guide brings in, between $300 and $4,000+. A setup fee applies
 * when the knowledge base is a big build (many pages or a product catalog).
 */
export function estimateGuideRoi(input: { monthlyVisitors: number; leadValue: number; pages?: number; interactRate?: number; leadRate?: number }): GuideRoi {
  const visitors = Math.max(0, Math.round(input.monthlyVisitors || 0));
  const leadValue = Math.max(0, Math.round(input.leadValue || 0));
  const chats = Math.round(visitors * (input.interactRate ?? INTERACT_RATE));
  const leads = Math.round(visitors * (input.leadRate ?? LEAD_RATE) * 10) / 10;
  const value = Math.round(leads * leadValue);
  const raw = roundTo(value * 0.1, 50);
  const monthly = Math.min(MAX_RETAINER, Math.max(MIN_RETAINER, raw));
  const pages = input.pages ?? 0;
  const setup = pages > 80 ? 2500 : pages > 25 ? 1000 : 0;
  const setupNote =
    setup === 0
      ? "No setup fee: a small site's knowledge base is quick to build."
      : setup === 1000
        ? "A $1,000 setup fee covers the larger knowledge base (or bill $200 an hour)."
        : "A big site or product catalog: $2,500 to $5,000 setup (or $200 an hour) for the knowledge base build.";
  return { visitors, leadValue, chats, leads, value, price: { monthly, plus: raw > MAX_RETAINER, setup, setupNote } };
}
