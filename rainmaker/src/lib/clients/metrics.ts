// A client's results for a period, in outcomes they care about: leads
// answered and how fast, calls caught, past customers back, reviews and
// referrals, bookings and what they're worth, ad cost per booking. These are
// what the agency sells, so they're what the report shows. Pure.

import type { Client, ClientData, ContactSource } from "../types.ts";

export interface Period {
  from: number;
  to: number;
  /** "2026-11" or "Last 30 days". */
  label: string;
}

/** A calendar month, YYYY-MM, as UTC bounds. */
export function monthPeriod(ym: string): Period {
  const [y, m] = ym.split("-").map(Number);
  const from = Date.UTC(y, m - 1, 1);
  const to = Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1);
  return { from, to, label: ym };
}

export function lastDays(days: number, now = Date.now()): Period {
  return { from: now - days * 86_400_000, to: now + 1, label: `Last ${days} days` };
}

export const INBOUND: ContactSource[] = ["website", "webhook", "ad", "referral", "call", "text", "manual"];

export interface Results {
  period: Period;
  leads: number;
  leadsBySource: Partial<Record<ContactSource, number>>;
  /** Leads that got a reply, and how fast (median seconds). */
  answered: number;
  medianResponseSec?: number;
  /** Answered within 5 minutes. */
  fast: number;
  calls: { total: number; answered: number; ai: number; missed: number; textedBack: number };
  /** Unanswered or AI-answered callers who then replied or booked. */
  recoveredCalls: number;
  winback: { reached: number; replied: number; booked: number };
  reviews: { asked: number; clicked: number };
  referrals: { asked: number; leads: number };
  booked: number;
  /** Bookings x what each is worth, in the client's currency. */
  revenue: number;
  messagesSent: number;
  conversations: number;
  siteViews: number;
  ads: { spend: number; leads: number; booked: number; costPerLead?: number; costPerBooking?: number };
  coaching: { reviewed: number; average?: number };
  /** Rough hours of staff work this replaced. */
  hours: number;
}

const inP = (iso: string | undefined, p: Period) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return t >= p.from && t < p.to;
};

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function results(client: Pick<Client, "jobValue" | "adMonths">, data: ClientData, p: Period): Results {
  const leads = data.contacts.filter((c) => INBOUND.includes(c.source) && inP(c.createdAt, p));
  const bySource: Results["leadsBySource"] = {};
  for (const c of leads) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  const times = leads.filter((c) => c.firstReplyAt).map((c) => Math.max(0, Math.round((Date.parse(c.firstReplyAt!) - Date.parse(c.createdAt)) / 1000)));

  const calls = data.calls.filter((c) => inP(c.at, p));
  const contactById = new Map(data.contacts.map((c) => [c.id, c]));
  const recovered = calls.filter((call) => {
    if (call.outcome === "answered" || !call.contactId) return false;
    const c = contactById.get(call.contactId);
    return Boolean(c && ((c.lastInboundAt && Date.parse(c.lastInboundAt) > Date.parse(call.at)) || (c.bookedAt && Date.parse(c.bookedAt) >= Date.parse(call.at))));
  }).length;

  const sent = data.messages.filter((m) => m.direction === "out" && m.status === "sent" && m.purpose !== "alert" && inP(m.sentAt ?? m.at, p));
  const contactsGot = (purpose: string) => new Set(sent.filter((m) => m.purpose === purpose).map((m) => m.contactId));
  const reached = contactsGot("reactivation");
  const inbound = data.messages.filter((m) => m.direction === "in" && inP(m.at, p));
  const repliedAfter = (ids: Set<string>, purpose: string) =>
    [...ids].filter((id) => {
      const first = sent.find((m) => m.contactId === id && m.purpose === purpose);
      return first && inbound.some((m) => m.contactId === id && Date.parse(m.at) > Date.parse(first.sentAt ?? first.at));
    }).length;
  const booked = data.contacts.filter((c) => inP(c.bookedAt, p));
  const winbackBooked = booked.filter((c) => reached.has(c.id) || c.enrollments.some((e) => e.kind === "reactivation")).length;

  const months = client.adMonths.filter((m) => {
    const t = monthPeriod(m.month);
    return t.from < p.to && t.to > p.from;
  });
  const spend = months.reduce((a, m) => a + m.spend, 0);
  const adLeads = months.reduce((a, m) => a + m.leads, 0) || leads.filter((c) => c.source === "ad").length;
  const adBooked = months.reduce((a, m) => a + m.booked, 0);

  const reviewed = data.reviews.filter((r) => inP(r.createdAt, p));
  const aiCalls = calls.filter((c) => c.outcome === "ai");
  const aiMinutes = aiCalls.reduce((a, c) => a + (c.durationSec ?? 180) / 60, 0);
  const hours = (sent.length * 2 + inbound.length * 2 + aiMinutes + reviewed.length * 30 + leads.length * 5) / 60;

  return {
    period: p,
    leads: leads.length,
    leadsBySource: bySource,
    answered: times.length,
    medianResponseSec: median(times),
    fast: times.filter((t) => t <= 300).length,
    calls: {
      total: calls.length,
      answered: calls.filter((c) => c.outcome === "answered").length,
      ai: aiCalls.length,
      missed: calls.filter((c) => c.outcome === "missed").length,
      textedBack: calls.filter((c) => c.textedBack).length,
    },
    recoveredCalls: recovered,
    winback: { reached: reached.size, replied: repliedAfter(reached, "reactivation"), booked: winbackBooked },
    reviews: { asked: contactsGot("review").size, clicked: data.contacts.filter((c) => inP(c.reviewClickedAt, p)).length },
    referrals: { asked: contactsGot("referral").size, leads: leads.filter((c) => c.source === "referral" || c.referredBy).length },
    booked: booked.length,
    revenue: Math.round(booked.reduce((a, c) => a + (c.value ?? client.jobValue), 0)),
    messagesSent: sent.length,
    conversations: new Set(inbound.map((m) => m.contactId)).size,
    siteViews: Object.entries(data.daily)
      .filter(([day]) => {
        const t = Date.parse(`${day}T12:00:00Z`);
        return t >= p.from && t < p.to;
      })
      .reduce((a, [, d]) => a + d.views, 0),
    ads: {
      spend,
      leads: adLeads,
      booked: adBooked,
      costPerLead: spend && adLeads ? Math.round(spend / adLeads) : undefined,
      costPerBooking: spend && adBooked ? Math.round(spend / adBooked) : undefined,
    },
    coaching: { reviewed: reviewed.length, average: reviewed.length ? Math.round(reviewed.reduce((a, r) => a + r.scorecard.overall, 0) / reviewed.length) : undefined },
    hours: Math.round(hours * 10) / 10,
  };
}

/** "42s", "3 min", "2.5 h". */
export function formatDuration(sec: number | undefined): string {
  if (sec === undefined) return "–";
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)} min`;
  return `${Math.round((sec / 3600) * 10) / 10} h`;
}
