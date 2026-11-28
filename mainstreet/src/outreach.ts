import { getSettings, kvGet, kvSet, leadsWithStatus, messagesWithStatus, recentInbound, getLead } from "./db.ts";
import type { Lead, Message } from "./types.ts";
import { digits, localDate } from "./util.ts";

// The owner's one-tap channels: calls, texts and DMs prepared by the Pitcher
// and sent by a human from their own phone, plus the email queue and inbox.

export interface OneTapItem {
  leadId: string;
  leadName: string;
  channel: "call" | "sms" | "dm";
  href: string;
  text: string;
  phone?: string;
  done: boolean;
}

export function e164(phone: string | undefined, country: string): string | undefined {
  const d = digits(phone);
  if (!d) return undefined;
  if (d.length === 10 && (country === "US" || country === "CA")) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return `+${d}`;
}

const tapKey = (leadId: string, channel: string) => `tap:${localDate(getSettings().owner.timezone)}:${leadId}:${channel}`;

export function markTapDone(leadId: string, channel: "call" | "sms" | "dm"): void {
  kvSet(tapKey(leadId, channel), true);
  kvSet(`tapped:${leadId}:${channel}`, true);
}

function everTapped(leadId: string, channel: string): boolean {
  return Boolean(kvGet(`tapped:${leadId}:${channel}`));
}

export function oneTapItems(limit = 40): OneTapItem[] {
  const s = getSettings();
  const items: (OneTapItem & { rank: number })[] = [];
  const leads = leadsWithStatus(["ready", "pitched", "negotiating"], { order: "score", limit: 200 });
  for (const l of leads) {
    if (!l.pitch) continue;
    const phone = e164(l.phone, l.country);
    const rank = (l.email ? 0 : 50) + (l.score ?? 0);
    if (phone && s.pitching.channels.call && !everTapped(l.id, "call")) items.push({ leadId: l.id, leadName: l.name, channel: "call", href: `tel:${phone}`, text: l.pitch.callScript, phone: l.phone, done: Boolean(kvGet(tapKey(l.id, "call"))), rank: rank + 2 });
    if (phone && s.pitching.channels.sms && !everTapped(l.id, "sms")) items.push({ leadId: l.id, leadName: l.name, channel: "sms", href: `sms:${phone}?&body=${encodeURIComponent(l.pitch.sms)}`, text: l.pitch.sms, phone: l.phone, done: Boolean(kvGet(tapKey(l.id, "sms"))), rank: rank + 1 });
    const social = l.audit?.socials.facebook ?? l.audit?.socials.instagram;
    if (social && s.pitching.channels.dm && !everTapped(l.id, "dm")) items.push({ leadId: l.id, leadName: l.name, channel: "dm", href: social, text: l.pitch.dm, done: Boolean(kvGet(tapKey(l.id, "dm"))), rank });
  }
  return items
    .sort((a, b) => Number(a.done) - Number(b.done) || b.rank - a.rank)
    .slice(0, limit)
    .map(({ rank: _r, ...x }) => x);
}

export function emailQueue(): { leadId: string; leadName: string; subject: string; status: Message["status"]; sendAfter?: string; messageId: string }[] {
  return messagesWithStatus(["queued", "pending_approval", "draft"], 100)
    .filter((m) => m.channel === "email" && m.direction === "out")
    .map((m) => ({ leadId: m.leadId, leadName: getLead(m.leadId)?.name ?? "Unknown", subject: m.subject ?? "", status: m.status, sendAfter: m.sendAfter, messageId: m.id }));
}

export function inbox(limit = 30): (Message & { leadName: string; leadStatus?: Lead["status"] })[] {
  return recentInbound(limit).map((m) => {
    const l = getLead(m.leadId);
    return { ...m, leadName: l?.name ?? "Unknown", leadStatus: l?.status };
  });
}
