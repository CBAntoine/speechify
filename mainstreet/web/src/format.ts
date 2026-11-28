// Labels and number formatting shared by every screen.

import type { AgentId, Approval, LeadStatus, ReplyAnalysis, WebsiteState } from "./api";

let currency: "USD" | "CAD" = "USD";
export function setCurrency(c: "USD" | "CAD" | undefined) {
  if (c) currency = c;
}

export function money(cents: number | undefined | null, opts?: { exact?: boolean }): string {
  const v = (cents ?? 0) / 100;
  const exact = opts?.exact || (Math.abs(v) < 100 && v % 1 !== 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: exact ? 2 : 0,
    maximumFractionDigits: exact ? 2 : 0,
  }).format(v);
}

export function usd(v: number | undefined | null): string {
  const n = v ?? 0;
  return `$${n < 100 ? n.toFixed(2) : n < 1000 ? n.toFixed(0) : Math.round(n).toLocaleString("en-US")}`;
}

export function pct(v: number | undefined | null, digits = 1): string {
  return `${((v ?? 0) * 100).toFixed(digits).replace(/\.0$/, "")}%`;
}

export function num(v: number | undefined | null): string {
  return (v ?? 0).toLocaleString("en-US");
}

export function ago(iso: string | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) {
    const f = -s;
    if (f < 3600) return `in ${Math.max(1, Math.round(f / 60))}m`;
    if (f < 86400) return `in ${Math.round(f / 3600)}h`;
    return `in ${Math.round(f / 86400)}d`;
  }
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 172800) return "yesterday";
  if (s < 604800) return `${Math.round(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function clock(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function dateTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export const STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  qualified: "Qualified",
  skipped: "Skipped",
  diagnosed: "Diagnosed",
  built: "Built",
  filmed: "Filmed",
  ready: "Ready",
  pitched: "Pitched",
  replied: "Replied",
  negotiating: "Negotiating",
  won: "Won",
  lost: "Lost",
  dnc: "Do not contact",
};

/** Tone for status chips: maps to CSS classes. */
export const STATUS_TONE: Record<LeadStatus, string> = {
  new: "grey",
  qualified: "blue",
  skipped: "grey",
  diagnosed: "violet",
  built: "indigo",
  filmed: "violet",
  ready: "amber",
  pitched: "sky",
  replied: "green",
  negotiating: "green",
  won: "money",
  lost: "grey",
  dnc: "red",
};

export const STATE_LABEL: Record<WebsiteState, string> = {
  none: "No website",
  social_only: "Facebook only",
  dead: "Dead link",
  outdated: "2014-era site",
  weak: "Weak site",
  modern: "Modern site",
};

export const STATE_TONE: Record<WebsiteState, string> = {
  none: "red",
  social_only: "amber",
  dead: "red",
  outdated: "amber",
  weak: "blue",
  modern: "grey",
};

export const INTENT_LABEL: Record<ReplyAnalysis["intent"], string> = {
  interested: "Interested",
  ready_to_buy: "Ready to buy",
  question: "Question",
  wants_call: "Wants a call",
  price_objection: "Price objection",
  not_interested: "Not interested",
  unsubscribe: "Unsubscribe",
  wrong_person: "Wrong person",
  auto_reply: "Auto-reply",
};

export const INTENT_TONE: Record<ReplyAnalysis["intent"], string> = {
  interested: "green",
  ready_to_buy: "money",
  question: "blue",
  wants_call: "green",
  price_objection: "amber",
  not_interested: "grey",
  unsubscribe: "red",
  wrong_person: "grey",
  auto_reply: "grey",
};

export const APPROVAL_LABEL: Record<Approval["kind"], string> = {
  deal: "Big deal",
  pitch: "Pitch",
  reply: "Reply",
  spend: "Spend",
  strategy: "Strategy",
};

export const AGENT_NAME: Record<AgentId, string> = {
  orchestrator: "Atlas",
  scout: "Scout",
  diagnoser: "Diagnoser",
  builder: "Builder",
  filmer: "Filmer",
  pitcher: "Pitcher",
  checker: "Checker",
  closer: "Closer",
};

export const AGENT_ORDER: AgentId[] = ["orchestrator", "scout", "diagnoser", "builder", "filmer", "pitcher", "checker", "closer"];

export const AGENT_ABOUT: Record<AgentId, { role: string; does: string }> = {
  orchestrator: {
    role: "Orchestrator",
    does: "Runs the day: sets the quotas, moves every lead along, watches the numbers and wakes you only for a big deal or a response-rate drop. It's also the voice you talk to.",
  },
  scout: {
    role: "Finds businesses",
    does: "Searches the map in your target towns, checks every website and queues the businesses with none, a dead link or a site from 2014.",
  },
  diagnoser: {
    role: "Writes the diagnosis",
    does: "Explains what's wrong and what it costs them in customers, using only facts from their listing and their site.",
  },
  builder: {
    role: "Builds the mockups",
    does: "Plans the site and builds three designs with their real name, phone, hours and reviews.",
  },
  filmer: {
    role: "Makes the video",
    does: "Records a 10–15 second vertical video of their new site, with a voiceover that says their name.",
  },
  pitcher: {
    role: "Writes and sends outreach",
    does: "Writes the email, follow-ups, text, DM and call script, sends email inside your caps and hours, and lines up your one-tap list.",
  },
  checker: {
    role: "Guards cost and quality",
    does: "Prices every step before it's spent, holds the daily budget, and checks each mockup and email before anything goes out.",
  },
  closer: {
    role: "Handles replies",
    does: "Reads replies, answers questions, sends the payment link and hands you anything big.",
  },
};

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function scoreTone(score: number | undefined): string {
  if (score === undefined) return "grey";
  if (score >= 75) return "money";
  if (score >= 55) return "green";
  if (score >= 40) return "amber";
  return "grey";
}

export function firstName(name: string | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
