// Autopilot decisions, kept pure so they can be unit tested: which market to
// prospect next, which leads to work on, which follow-ups are due, and
// whether an email may go out without a human.

import type { AgencyProfile, AutopilotConfig, AutopilotState, Draft, Lead, Order } from "../types.ts";

export const DAY_MS = 86_400_000;

export function defaultAutopilotConfig(): AutopilotConfig {
  return {
    enabled: false,
    cities: [],
    niches: [],
    leadsPerRun: 12,
    minScore: 60,
    personalizePerRun: 3,
    draftOutreach: true,
    buildDemos: true,
    buildAds: true,
    makeArt: false,
    followUps: true,
    autoSend: false,
    dailySendCap: 20,
    fulfillOrders: true,
    emailSummary: false,
  };
}

export function defaultAutopilot(): AutopilotState {
  return { config: defaultAutopilotConfig(), cursor: 0, sent: { day: "", count: 0 }, runs: [] };
}

/** Clamp a config edit to safe ranges. Unknown keys are dropped. */
export function sanitizeConfig(patch: Partial<AutopilotConfig>, base: AutopilotConfig): AutopilotConfig {
  const int = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
  };
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const list = (v: unknown, d: string[], max: number) =>
    Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim().slice(0, 80)).filter(Boolean))].slice(0, max) : d;
  return {
    enabled: bool(patch.enabled, base.enabled),
    cities: list(patch.cities, base.cities, 20),
    niches: list(patch.niches, base.niches, 10),
    leadsPerRun: int(patch.leadsPerRun, 3, 40, base.leadsPerRun),
    minScore: int(patch.minScore, 0, 100, base.minScore),
    personalizePerRun: int(patch.personalizePerRun, 0, 10, base.personalizePerRun),
    draftOutreach: bool(patch.draftOutreach, base.draftOutreach),
    buildDemos: bool(patch.buildDemos, base.buildDemos),
    buildAds: bool(patch.buildAds, base.buildAds),
    makeArt: bool(patch.makeArt, base.makeArt),
    followUps: bool(patch.followUps, base.followUps),
    autoSend: bool(patch.autoSend, base.autoSend),
    dailySendCap: int(patch.dailySendCap, 1, 100, base.dailySendCap),
    fulfillOrders: bool(patch.fulfillOrders, base.fulfillOrders),
    emailSummary: bool(patch.emailSummary, base.emailSummary),
  };
}

/** The next niche × city to prospect, rotating through every pair. */
export function nextTarget(config: AutopilotConfig, targetNiches: string[], cursor: number): { niche: string; city: string; nextCursor: number } | null {
  const niches = config.niches.length ? config.niches : targetNiches;
  if (!niches.length || !config.cities.length) return null;
  const total = niches.length * config.cities.length;
  const i = ((cursor % total) + total) % total;
  return { niche: niches[i % niches.length], city: config.cities[Math.floor(i / niches.length) % config.cities.length], nextCursor: (i + 1) % total };
}

function draftsFor(drafts: Draft[], leadId: string) {
  return drafts.filter((d) => d.leadId === leadId && d.status !== "discarded");
}

/** New, good-fit leads nobody has written to yet, best first. */
export function pickForOutreach(leads: Lead[], drafts: Draft[], config: Pick<AutopilotConfig, "minScore" | "personalizePerRun">): Lead[] {
  return leads
    .filter((l) => !l.sample && l.stage === "new" && (l.score ?? 0) >= config.minScore && !draftsFor(drafts, l.id).length)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, config.personalizePerRun);
}

export interface DueFollowUp {
  lead: Lead;
  step: number;
}

/**
 * Follow-ups whose day has come: the lead is still in Contacted (no reply
 * logged), the first email was sent, the step's day offset has passed since
 * then, and nothing for this lead is waiting in the Inbox.
 */
export function dueFollowUps(leads: Lead[], drafts: Draft[], now: number, max = 10): DueFollowUp[] {
  const due: DueFollowUp[] = [];
  for (const lead of leads) {
    if (lead.sample || lead.stage !== "contacted" || !lead.sequence?.length) continue;
    const mine = draftsFor(drafts, lead.id);
    if (mine.some((d) => d.status === "pending")) continue;
    const sentEmails = mine.filter((d) => d.status === "sent" && d.channel === "email" && d.sentAt).sort((a, b) => Date.parse(a.sentAt!) - Date.parse(b.sentAt!));
    if (!sentEmails.length) continue;
    const first = Date.parse(sentEmails[0].sentAt!);
    const step = lead.sequence.findIndex((s) => !s.draftedAt);
    if (step < 0) continue;
    if (now - first >= lead.sequence[step].dayOffset * DAY_MS) due.push({ lead, step });
    if (due.length >= max) break;
  }
  return due;
}

export const OPT_OUT_PATTERN = /reply\s+['"‘’“”]?(no|stop|unsubscribe)['"‘’“”]?|unsubscribe|opt[- ]?out|won['’]t follow up|not interested\?/i;

/**
 * Whether autopilot may send this email on its own. Only email (texts and
 * calls always wait for a human: consent rules for those are stricter), only
 * with a postal address in the footer and an opt-out line (CAN-SPAM, CASL),
 * and never past the daily cap.
 */
export function canAutoSend(
  draft: Pick<Draft, "channel" | "to" | "subject" | "body" | "status">,
  profile: Pick<AgencyProfile, "mailingAddress">,
  config: Pick<AutopilotConfig, "autoSend" | "dailySendCap">,
  sentToday: number,
  resend: boolean
): { ok: boolean; reason?: string } {
  if (!config.autoSend) return { ok: false, reason: "Auto-send is off" };
  if (!resend) return { ok: false, reason: "Email sending isn't connected (add Resend in Settings → API keys)" };
  if (draft.status !== "pending") return { ok: false, reason: "Not a pending draft" };
  if (draft.channel !== "email") return { ok: false, reason: "Only emails are sent automatically" };
  if (!draft.to || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(draft.to)) return { ok: false, reason: "No valid email address" };
  if (!draft.subject?.trim()) return { ok: false, reason: "No subject" };
  if (/\[[^\]]{2,40}\]/.test(`${draft.subject} ${draft.body}`)) return { ok: false, reason: "Has an unfilled [placeholder]" };
  const address = profile.mailingAddress.trim();
  if (!address) return { ok: false, reason: "Add your postal address in Settings (required in commercial email)" };
  if (!draft.body.includes(address.split(/[\n,]/)[0].trim())) return { ok: false, reason: "Postal address missing from the footer" };
  if (!OPT_OUT_PATTERN.test(draft.body)) return { ok: false, reason: "No opt-out line" };
  if (sentToday >= config.dailySendCap) return { ok: false, reason: "Daily send cap reached" };
  return { ok: true };
}

/** Paid orders whose setup hasn't run (or failed and should be retried). */
export function ordersToFulfill(orders: Order[], max = 3): Order[] {
  return orders.filter((o) => o.status === "active" && (!o.fulfillment || o.fulfillment.status === "queued")).slice(0, max);
}

/** Checkouts started more than a day ago that never completed: worth a nudge. */
export function abandonedCheckouts(orders: Order[], now: number): Order[] {
  return orders.filter((o) => o.status === "pending" && o.email && now - Date.parse(o.createdAt) > DAY_MS && now - Date.parse(o.createdAt) < 14 * DAY_MS);
}
