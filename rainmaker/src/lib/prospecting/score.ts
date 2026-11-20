// Opportunity signals and scoring. Pure functions, unit tested.
// A prospect scores high when it clearly NEEDS help (gaps we can sell against)
// and can likely PAY for it (established, already spending on ads).

import type { AuditResult, LeadSource, Signal } from "../types.ts";

export interface ScoreInput {
  website?: string;
  phone?: string;
  rating?: number;
  reviewCount?: number;
  source?: LeadSource;
  /** Is the niche appointment-based (online booking matters)? */
  booking?: boolean;
  /** Typical monthly retainer midpoint for the niche. */
  retainerMid?: number;
  audit?: AuditResult;
  now?: Date;
}

const WEIGHT = { high: 16, medium: 9, low: 4, info: 0 } as const;

export function deriveSignals(p: ScoreInput): Signal[] {
  const s: Signal[] = [];
  const a = p.audit;
  const year = (p.now ?? new Date()).getFullYear();

  if (!p.website) {
    s.push({
      id: "no_website",
      label: "No website",
      detail:
        p.source === "openstreetmap"
          ? "No website in the map listing. Confirm before you pitch: some businesses only list it elsewhere."
          : "No website on their listing. Customers who search for them hit a dead end.",
      severity: "high",
      pitch: "A simple site that books jobs",
    });
  } else if (a && !a.reachable) {
    s.push({
      id: "site_down",
      label: "Website not loading",
      detail: a.error ? `Their site failed to load (${a.error}).` : `Their site returned an error${a.status ? ` (HTTP ${a.status})` : ""}.`,
      severity: "high",
      pitch: "Website rebuild",
    });
  }

  if (p.reviewCount !== undefined) {
    if (p.reviewCount < 25) {
      s.push({
        id: "few_reviews",
        label: `Only ${p.reviewCount} reviews`,
        detail: "Competitors with more reviews win the map pack and the click.",
        severity: "high",
        pitch: "Automated review requests",
      });
    } else if (p.reviewCount >= 100 && (p.rating ?? 0) >= 4.5) {
      s.push({
        id: "established",
        label: `${p.reviewCount} reviews at ${p.rating?.toFixed(1)}★`,
        detail: "Established and well liked: they have customers and likely budget.",
        severity: "info",
        positive: true,
      });
    }
  }
  if (p.rating !== undefined && p.rating > 0 && p.rating < 4.2) {
    s.push({
      id: "low_rating",
      label: `Rated ${p.rating.toFixed(1)}★`,
      detail: "Below 4.2 stars, many searchers scroll past.",
      severity: "high",
      pitch: "Reputation management",
    });
  }

  if (a && a.reachable) {
    if (!a.https) {
      s.push({
        id: "no_https",
        label: "Not secure (no HTTPS)",
        detail: "Browsers label the site “Not secure”, which scares off visitors.",
        severity: "high",
        pitch: "Security and trust fix",
      });
    }
    if (!a.mobileViewport) {
      s.push({
        id: "not_mobile",
        label: "Not mobile-friendly",
        detail: "No mobile viewport tag, so the site likely renders tiny on phones, where most local searches happen.",
        severity: "high",
        pitch: "Mobile-first redesign",
      });
    }
    if (a.responseMs !== undefined && a.responseMs > 2500) {
      s.push({
        id: "slow",
        label: `Slow site (${(a.responseMs / 1000).toFixed(1)}s)`,
        detail: "It took over 2.5 seconds just to respond. Visitors leave before it loads.",
        severity: a.responseMs > 6000 ? "high" : "medium",
        pitch: "Speed optimization",
      });
    }
    if (p.booking && a.booking.length === 0) {
      s.push({
        id: "no_booking",
        label: "No online booking",
        detail: "No booking widget or booking link found. Every appointment needs a phone call.",
        severity: "high",
        pitch: "Online booking with reminders",
      });
    }
    if (a.pixels.length === 0) {
      s.push({
        id: "no_pixel",
        label: "No ad tracking",
        detail: "No Meta Pixel or Google Ads tag. They are probably not advertising, or can't measure it.",
        severity: "medium",
        pitch: "Paid ads with proper tracking",
      });
    } else {
      s.push({
        id: "runs_ads",
        label: "Already pays for ads",
        detail: `Found ${a.pixels.join(", ")}. They have an ad budget; pitch better results.`,
        severity: "info",
        positive: true,
        pitch: "Better ads and creative",
      });
    }
    if (a.analytics.length === 0) {
      s.push({
        id: "no_analytics",
        label: "No analytics",
        detail: "They can't see where customers come from.",
        severity: "low",
        pitch: "Tracking and monthly reporting",
      });
    }
    if (a.chat.length === 0) {
      s.push({
        id: "no_chat",
        label: "No chat or text-back",
        detail: "Visitors who don't want to call have no way to reach them instantly.",
        severity: "medium",
        pitch: "Web chat and missed-call text-back",
      });
    }
    if (a.copyrightYear !== undefined && a.copyrightYear <= year - 2) {
      s.push({
        id: "stale_site",
        label: `Site last updated ~${a.copyrightYear}`,
        detail: `The footer still says © ${a.copyrightYear}. The site looks neglected.`,
        severity: "medium",
        pitch: "Website refresh",
      });
    }
    if (!a.hasContactForm) {
      s.push({
        id: "no_form",
        label: "No contact form",
        detail: "No way to leave details after hours.",
        severity: "medium",
        pitch: "Lead capture form",
      });
    }
    if (!a.hasClickToCall) {
      s.push({
        id: "no_click_to_call",
        label: "Phone not tappable",
        detail: "Mobile visitors can't tap to call.",
        severity: "low",
        pitch: "Click-to-call buttons",
      });
    }
    if (!a.title || !a.description) {
      s.push({
        id: "weak_seo",
        label: "Missing search title or description",
        detail: "Google shows whatever it guesses in search results.",
        severity: "low",
        pitch: "Local SEO basics",
      });
    }
    if (!a.hasSchema) {
      s.push({
        id: "no_schema",
        label: "No local business markup",
        detail: "Search engines get no structured hours, address or services.",
        severity: "low",
        pitch: "Local SEO",
      });
    }
    if (a.chat.includes("LeadConnector (GoHighLevel)") || a.cms === "GoHighLevel site") {
      s.push({
        id: "uses_ghl",
        label: "Uses a GoHighLevel tool",
        detail: "Another agency (or they) already set up GoHighLevel. Pitch results and simplicity.",
        severity: "info",
        positive: true,
      });
    }
    if (a.socials.length === 0) {
      s.push({
        id: "no_social",
        label: "No social links",
        detail: "No Facebook, Instagram or TikTok linked from the site.",
        severity: "low",
        pitch: "Social presence",
      });
    }
  }

  return s;
}

export function scoreProspect(p: ScoreInput, signals: Signal[] = deriveSignals(p)): number {
  let need = 0;
  for (const sig of signals) if (!sig.positive) need += WEIGHT[sig.severity];
  need = Math.min(need, 70);

  let fit = 8;
  if ((p.reviewCount ?? 0) >= 30) fit += 6;
  if ((p.reviewCount ?? 0) >= 100) fit += 4;
  if (p.audit?.pixels.length) fit += 6;
  const mid = p.retainerMid ?? 0;
  if (mid >= 2500) fit += 6;
  else if (mid >= 1500) fit += 3;
  if (p.phone) fit += 2;
  fit = Math.min(fit, 30);

  return Math.max(0, Math.min(100, Math.round(need + fit)));
}

export function tierOf(score: number | undefined): { id: "hot" | "warm" | "cool"; label: string } {
  if (score === undefined) return { id: "cool", label: "Unscored" };
  if (score >= 70) return { id: "hot", label: "Hot" };
  if (score >= 45) return { id: "warm", label: "Warm" };
  return { id: "cool", label: "Cool" };
}

/** The three most sellable findings, highest severity first. */
export function topSignals(signals: Signal[] | undefined, n = 3): Signal[] {
  if (!signals) return [];
  const order = { high: 0, medium: 1, low: 2, info: 3 };
  return [...signals]
    .filter((s) => !s.positive)
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, n);
}
