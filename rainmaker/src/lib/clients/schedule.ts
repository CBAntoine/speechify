// Which sequence messages are due for a client right now: lead follow-ups,
// win-back texts, review requests and referral asks. Decides only; the engine
// claims and sends. Pure, so the timing rules are unit tested.

import type { Client, ClientData, Contact, Enrollment, MsgChannel, MsgPurpose, Sequence, SequenceKind } from "../types.ts";
import { inSendingHours, localTime, pickChannel, render, type Placeholder } from "./rules.ts";
import { identifiedText } from "./templates.ts";

export const PURPOSE_OF: Record<SequenceKind, MsgPurpose> = { nurture: "nurture", reactivation: "reactivation", review: "review", referral: "referral" };

/** Never two automated sequence messages to the same person closer than this. */
export const MIN_GAP_HOURS = 12;

export interface DueSend {
  contactId: string;
  seqId: string;
  kind: SequenceKind;
  step: number;
  channel: MsgChannel;
  subject?: string;
  body: string;
  /** Placeholders with no value: the message waits as a draft instead of going out broken. */
  missing: Placeholder[];
}

export interface Plan {
  sends: DueSend[];
  /** Enrollments with no steps left, or no allowed way to reach the person. */
  finish: { contactId: string; seqId: string; stop: NonNullable<Enrollment["stop"]> }[];
  /** Why messages are being held back, if they are. */
  held?: "quiet_hours" | "daily_cap";
}

export type Vars = (c: Contact, kind: SequenceKind) => Partial<Record<Placeholder, string>>;

/**
 * The messages due now. Only enrollments of `kinds` are considered (the
 * caller leaves out kinds whose service is off), oldest first, at most one per
 * person per run, within sending hours and the daily cap.
 */
export function planDue(client: Pick<Client, "timezone" | "settings" | "whatsappNumber"> & Partial<Pick<Client, "country" | "name" | "lang">>, data: ClientData, now: Date, vars: Vars, opts: { kinds?: SequenceKind[]; max?: number } = {}): Plan {
  const max = opts.max ?? Infinity;
  const finish: Plan["finish"] = [];
  const seqs = new Map(data.sequences.map((s) => [s.id, s]));
  const candidates: { c: Contact; e: Enrollment; seq: Sequence; dueAt: number }[] = [];
  for (const c of data.contacts) {
    for (const e of c.enrollments) {
      if (e.stoppedAt || (opts.kinds && !opts.kinds.includes(e.kind))) continue;
      const seq = seqs.get(e.seqId);
      if (!seq || seq.status !== "running") continue;
      const step = seq.steps[e.next];
      if (!step) {
        finish.push({ contactId: c.id, seqId: e.seqId, stop: "finished" });
        continue;
      }
      const dueAt = Date.parse(e.startedAt) + step.delayHours * 3_600_000;
      if (Number.isFinite(dueAt) && dueAt <= now.getTime()) candidates.push({ c, e, seq, dueAt });
    }
  }
  if (!candidates.length) return { sends: [], finish };
  if (!inSendingHours(now, client)) return { sends: [], finish, held: "quiet_hours" };

  const { day } = localTime(now, client.timezone);
  const left = Math.min(max, Math.max(0, client.settings.dailyCap - (data.daily[day]?.sent ?? 0)));
  const sends: DueSend[] = [];
  const touched = new Set<string>();
  candidates.sort((a, b) => a.dueAt - b.dueAt);
  for (const { c, e, seq } of candidates) {
    if (touched.has(c.id)) continue;
    const last = c.lastOutboundAt ? Date.parse(c.lastOutboundAt) : 0;
    if (last && now.getTime() - last < MIN_GAP_HOURS * 3_600_000) continue;
    const channel = pickChannel(c, PURPOSE_OF[seq.kind], client);
    if (!channel) {
      finish.push({ contactId: c.id, seqId: e.seqId, stop: "no_channel" });
      continue;
    }
    if (sends.length >= left) return { sends, finish, held: "daily_cap" };
    const step = seq.steps[e.next];
    const v = vars(c, seq.kind);
    const body = render(channel === "email" ? step.email : step.sms, v);
    const subject = channel === "email" ? render(step.subject, v) : undefined;
    sends.push({
      contactId: c.id,
      seqId: seq.id,
      kind: seq.kind,
      step: e.next,
      channel,
      subject: subject?.text,
      body: channel === "email" ? body.text : identifiedText(body.text, { business: client.name ?? "", lang: client.lang, country: client.country ?? "", first: e.next === 0 }),
      missing: [...new Set([...body.missing, ...(subject?.missing ?? [])])],
    });
    touched.add(c.id);
  }
  return { sends, finish };
}

/** Start a contact on a sequence. False if they're opted out or already on it. */
export function enroll(contact: Contact, seq: Pick<Sequence, "id" | "kind">, now: Date, opts: { next?: number; startAt?: Date } = {}): boolean {
  if (contact.status === "opted_out" || contact.optedOutAt) return false;
  if (contact.enrollments.some((e) => e.seqId === seq.id && !e.stoppedAt)) return false;
  // One run of a sequence per person: re-enrolling restarts a finished one only for win-backs.
  if (seq.kind !== "reactivation" && contact.enrollments.some((e) => e.seqId === seq.id)) return false;
  contact.enrollments.push({ seqId: seq.id, kind: seq.kind, startedAt: (opts.startAt ?? now).toISOString(), next: opts.next ?? 0 });
  return true;
}

/** Stop a contact's active enrollments (all of them, or only some kinds). Returns how many stopped. */
export function stopEnrollments(contact: Contact, stop: NonNullable<Enrollment["stop"]>, now: Date, kinds?: SequenceKind[]): number {
  let n = 0;
  for (const e of contact.enrollments) {
    if (e.stoppedAt || (kinds && !kinds.includes(e.kind))) continue;
    e.stoppedAt = now.toISOString();
    e.stop = stop;
    n++;
  }
  return n;
}

/** When a contact replies: follow-ups and win-backs give way to the conversation; review and referral asks carry on. */
export const STOP_ON_REPLY: SequenceKind[] = ["nurture", "reactivation"];
