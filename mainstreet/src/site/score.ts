import { getNiche } from "../niches.ts";
import type { WebsiteState } from "../types.ts";

// Opportunity score, 0–100: how much they need a site (the website state) plus
// whether they can pay (established reviews, a high-ticket niche) and whether
// we can reach them. Hot is 70+; the Scout sends the day's best forward.

export interface ScoreInput {
  state: WebsiteState;
  niche: string;
  rating?: number;
  reviewCount?: number;
  hasEmail: boolean;
  hasPhone: boolean;
  chain: boolean;
  closed: boolean;
}

const BASE: Record<WebsiteState, number> = { none: 45, dead: 48, social_only: 42, outdated: 38, weak: 18, modern: 0 };

const STATE_REASON: Record<WebsiteState, string> = {
  none: "No website at all",
  dead: "Website link is dead",
  social_only: "Only a social media page",
  outdated: "Website looks years out of date",
  weak: "Website misses the basics",
  modern: "Already has a decent website",
};

export function scoreLead(i: ScoreInput): { score: number; reasons: string[] } {
  const reasons = [STATE_REASON[i.state]];
  let s = BASE[i.state];
  const reviews = i.reviewCount ?? 0;
  if (reviews >= 50) (s += 15), reasons.push(`${reviews} Google reviews: established`);
  else if (reviews >= 20) (s += 11), reasons.push(`${reviews} Google reviews`);
  else if (reviews >= 8) s += 7;
  else if (reviews >= 3) s += 3;
  else reasons.push("Few or no reviews");
  if (i.rating !== undefined && reviews >= 3) {
    if (i.rating >= 4.5) (s += 8), reasons.push(`${i.rating.toFixed(1)}★ rating`);
    else if (i.rating >= 4) s += 5;
    else if (i.rating < 3.5) (s -= 10), reasons.push(`Low rating (${i.rating.toFixed(1)}★)`);
  }
  const value = getNiche(i.niche).value;
  s += value === "high" ? 10 : value === "medium" ? 6 : 2;
  if (value === "high") reasons.push("High-value niche");
  if (i.hasEmail) (s += 8), reasons.push("Email published on their site");
  if (i.hasPhone) s += 4;
  if (!i.hasEmail && !i.hasPhone) (s -= 30), reasons.push("No way to reach them");
  if (i.chain) (s -= 60), reasons.push("Chain or franchise");
  if (i.closed) (s -= 100), reasons.push("Closed");
  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons };
}
