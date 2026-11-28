import { z } from "zod";
import { DEMO, features, hasPublicUrl, publicBase } from "../config.ts";
import {
  addApproval,
  addMessage,
  countSentSince,
  dueMessages,
  getLead,
  getMessage,
  getSettings,
  isSuppressed,
  kvGet,
  kvSet,
  leadsWithStatus,
  messagesFor,
  updateLead,
  updateMessage,
} from "../db.ts";
import { leadChanged, log, working } from "../events.ts";
import { getNiche } from "../niches.ts";
import { askStructured } from "../providers/claude.ts";
import { sendEmail, textToHtml } from "../providers/email.ts";
import type { Lead, Message, PitchPack, Settings } from "../types.ts";
import { clip, errorMessage, localDayStart, localParts, nowIso } from "../util.ts";
import { ESTIMATE, emailProblems, preflight, realSendBlockers } from "./checker.ts";
import { PITCHER_PROMPT } from "./prompts.ts";
import { HeldError } from "./scout.ts";
import { emailFooter, factSheet, priceLabel, proposalUrl, unsubscribeUrl } from "./shared.ts";

// Pitcher: writes every channel's message, queues the email (or asks for your
// yes first, in review mode), sends inside your window and daily cap, and
// follows up. Calls, texts and DMs are prepared for one-tap sending from
// your phone: automated cold texts and DMs break carrier rules, platform
// terms and anti-spam law, and get numbers and accounts banned.

const PitchSchema = z.object({
  email: z.object({ subject: z.string(), body: z.string().describe("60-110 words with {proposal_link} on its own line, no signature") }),
  followups: z.array(z.object({ day: z.number(), subject: z.string(), body: z.string() })).describe("exactly two: day 3 and day 7"),
  sms: z.string(),
  dm: z.string(),
  callScript: z.string(),
});

/** In demo mode a "day" lasts two minutes so you can watch follow-ups happen. */
export const DAY_MS = DEMO ? 2 * 60_000 : 86_400_000;

export async function preparePitch(lead: Lead): Promise<Lead | undefined> {
  return working("pitcher", `Writing the pitch for ${lead.name}`, async () => {
    const s = getSettings();
    let pack: PitchPack;
    if (features.claude) {
      const v = preflight(ESTIMATE.pitch(), { agent: "pitcher", what: "writing the pitch", lead });
      if (!v.ok) throw new HeldError(v.reason);
      pack = await askStructured({
        agent: "pitcher",
        leadId: lead.id,
        system: PITCHER_PROMPT,
        prompt: [
          factSheet(lead),
          "",
          `Diagnosis: ${lead.diagnosis?.headline ?? ""}`,
          `Evidence: ${lead.diagnosis?.evidence.join("; ") ?? ""}`,
          `Core pitch: ${lead.diagnosis?.corePitch ?? ""}`,
          `Hooks: ${lead.diagnosis?.hooks.join("; ") ?? ""}`,
          `Tone: ${lead.diagnosis?.tone ?? "friendly"}`,
          `What they'll see at the proposal link: three designs of their new site${lead.video ? " and a 10-second video" : ""}.`,
          `Sender: ${s.owner.name || "the owner"} from ${s.owner.agencyName}.`,
          `Offer (sms and call script only, if asked): ${priceLabel(lead.dealValueCents ?? lead.priceCents, s)} one time, live in ${s.offer.deliveryDays} days. ${s.offer.guarantee}`,
        ].join("\n"),
        schema: PitchSchema,
        effort: "medium",
        maxTokens: 8000,
        label: "pitch",
      });
    } else {
      pack = demoPitch(lead, s);
    }
    const link = proposalUrl(lead)!;
    const fill = (t: string) => t.replaceAll("{proposal_link}", link).replace(/\n{3,}/g, "\n\n").trim();
    pack = {
      email: { subject: clip(pack.email.subject, 70), body: fill(pack.email.body) },
      followups: pack.followups.slice(0, s.pitching.followupDays.length).map((f, i) => ({ day: s.pitching.followupDays[i], subject: f.subject, body: fill(f.body) })),
      sms: fill(pack.sms),
      dm: fill(pack.dm),
      callScript: fill(pack.callScript),
    };
    if (!pack.email.body.includes(link)) pack.email.body += `\n\n${link}`;

    let updated = updateLead(lead.id, (l) => {
      l.pitch = pack;
      l.status = "ready";
    })!;
    const emailOk = updated.email && updated.consent?.basis !== "none" && s.pitching.channels.email && !isSuppressed([updated.email]);
    if (emailOk && !messagesFor(updated.id).some((m) => m.kind === "pitch")) {
      const body = `${pack.email.body}\n\n${emailFooter(updated, s)}`;
      const problems = emailProblems(body);
      const review = s.pitching.mode === "review";
      const msg = addMessage({
        leadId: updated.id,
        channel: "email",
        direction: "out",
        kind: "pitch",
        subject: pack.email.subject,
        body,
        status: problems.length ? "draft" : review ? "pending_approval" : "queued",
        error: problems.join(" ") || undefined,
        sendAfter: !problems.length && !review ? nextSendSlot() : undefined,
      });
      if (problems.length) log("checker", `Held the email: ${problems.join(" ")}`, { lead: updated, level: "warn" });
      else if (review) {
        addApproval({
          kind: "pitch",
          leadId: updated.id,
          leadName: updated.name,
          title: `Send the pitch to ${updated.name}?`,
          detail: `Subject: ${pack.email.subject}\n\n${clip(pack.email.body, 600)}`,
          payload: { messageId: msg.id },
        });
      }
    }
    updated = getLead(updated.id)!;
    leadChanged(updated);
    const channels = [emailOk ? "email" : undefined, updated.phone && s.pitching.channels.call ? "call" : undefined, updated.phone && s.pitching.channels.sms ? "text" : undefined, s.pitching.channels.dm ? "DM" : undefined].filter(Boolean);
    log("pitcher", `Pitch ready (${channels.join(", ")}): "${pack.email.subject}"${emailOk && s.pitching.mode === "review" ? ". Waiting for your yes." : ""}`, { lead: updated, level: "success" });
    return updated;
  });
}

// ── Sending ──────────────────────────────────────────────────────────────

export function windowOpen(at = new Date(), s: Settings = getSettings()): boolean {
  if (DEMO) return true;
  const p = localParts(s.owner.timezone, at);
  if (s.pitching.sendWindow.weekdaysOnly && (p.weekday === 0 || p.weekday === 6)) return false;
  return p.hour >= s.pitching.sendWindow.startHour && p.hour < s.pitching.sendWindow.endHour;
}

/** The next time an email may go out: spaced a few minutes apart, inside the send window. */
export function nextSendSlot(): string {
  const last = kvGet<string>("last_send_slot");
  const lastMs = last ? Date.parse(last) : 0;
  const gap = DEMO ? (15 + Math.random() * 30) * 1000 : (6 + Math.random() * 8) * 60_000;
  let t = Math.max(Date.now() + (DEMO ? 5_000 : 60_000), lastMs + gap);
  for (let i = 0; i < 24 * 14 && !windowOpen(new Date(t)); i++) t += 60 * 60_000;
  const iso = new Date(t).toISOString();
  kvSet("last_send_slot", iso);
  return iso;
}

export function dailyCap(s: Settings = getSettings()): number {
  let cap = s.quotas.pitchesPerDay;
  if (s.pitching.warmup && !DEMO) {
    const first = kvGet<string>("first_send_at");
    const days = first ? Math.floor((Date.now() - Date.parse(first)) / 86_400_000) : 0;
    cap = Math.min(cap, 8 + days * 4);
  }
  return cap;
}

export function sentToday(): number {
  return countSentSince(localDayStart(getSettings().owner.timezone), { channel: "email" });
}

function replyAddress(lead: Lead, s: Settings): string | undefined {
  if (s.owner.replyTo && lead.proposalToken && s.owner.replyTo.includes("@")) {
    const [local, domain] = s.owner.replyTo.split("@");
    return `${local}+${lead.proposalToken}@${domain}`;
  }
  return s.owner.email || undefined;
}

let warnedBlockers = "";

export async function sendDue(): Promise<number> {
  const s = getSettings();
  if (!windowOpen()) return 0;
  const blockers = realSendBlockers();
  if (blockers.length) {
    const key = blockers.join(" ");
    if (key !== warnedBlockers && dueMessages(nowIso(), 1).length) {
      warnedBlockers = key;
      log("pitcher", `Emails are waiting but can't go out yet: ${blockers.join(" ")}`, { level: "warn" });
    }
    return 0;
  }
  const room = dailyCap(s) - sentToday();
  if (room <= 0) return 0;
  let sent = 0;
  for (const m of dueMessages(nowIso(), Math.min(2, room))) if (await sendMessage(m.id)) sent++;
  return sent;
}

const CLOSED: Lead["status"][] = ["replied", "negotiating", "won", "lost", "dnc", "skipped"];

/** Send one queued email now (also used when you say "send it"). */
export async function sendMessage(messageId: string, opts: { force?: boolean } = {}): Promise<{ ok: boolean; error?: string; simulated?: boolean }> {
  const m = getMessage(messageId);
  if (!m || m.direction !== "out" || m.channel !== "email") return { ok: false, error: "No such email." };
  if (m.status === "sent") return { ok: true };
  const lead = getLead(m.leadId);
  const fail = (error: string, status: Message["status"] = "failed") => {
    updateMessage(m.id, { status, error });
    return { ok: false, error };
  };
  if (!lead?.email) return fail("The lead has no email address.");
  if (m.kind !== "reply" && CLOSED.includes(lead.status) && !opts.force) return fail(`Not sent: the lead is ${lead.status}.`);
  if (isSuppressed([lead.email, lead.email.split("@")[1], lead.sourceId])) {
    updateLead(lead.id, (l) => (l.status = "dnc"));
    return fail("Not sent: they're on the do-not-contact list.");
  }
  const problems = emailProblems(m.body);
  if (problems.length) return fail(problems.join(" "), "draft");
  const blockers = realSendBlockers();
  if (blockers.length) return { ok: false, error: blockers.join(" ") };
  const s = getSettings();
  return working("pitcher", `Emailing ${lead.name}`, async () => {
    try {
      const poster = lead.video && hasPublicUrl() ? { src: `${publicBase()}/p/${lead.proposalToken}/poster.jpg`, href: proposalUrl(lead)!, alt: `A short video of ${lead.name}'s new website` } : undefined;
      const r = await sendEmail({
        to: lead.email!,
        subject: m.subject ?? `A new website for ${lead.name}`,
        text: m.body,
        html: textToHtml(m.body, { poster }),
        replyTo: replyAddress(lead, s),
        unsubscribeUrl: unsubscribeUrl(lead),
        agent: "pitcher",
        leadId: lead.id,
        tags: { lead: lead.id, kind: m.kind },
      });
      const now = nowIso();
      updateMessage(m.id, { status: "sent", sentAt: now, externalId: r.id, error: undefined });
      if (!kvGet("first_send_at") && !r.simulated) kvSet("first_send_at", now);
      const updated = updateLead(lead.id, (l) => {
        l.lastContactAt = now;
        if (m.kind === "pitch") {
          l.firstPitchAt ??= now;
          if (l.status === "ready") l.status = "pitched";
        }
        if (m.kind === "followup") l.followupsSent += 1;
        const nextDay = s.pitching.followupDays[l.followupsSent];
        l.nextActionAt = nextDay !== undefined && l.firstPitchAt ? new Date(Date.parse(l.firstPitchAt) + nextDay * DAY_MS).toISOString() : undefined;
      })!;
      leadChanged(updated);
      const what = m.kind === "pitch" ? "the pitch" : m.kind === "followup" ? "a follow-up" : "a reply";
      log(m.kind === "reply" ? "closer" : "pitcher", `${r.simulated ? "Sent (to the outbox, nothing left the building)" : "Emailed"} ${what}: "${m.subject}"`, { lead: updated, level: "success" });
      if (DEMO && m.kind === "pitch") scheduleDemoReply(updated);
      return { ok: true, simulated: r.simulated };
    } catch (err) {
      const error = errorMessage(err);
      updateMessage(m.id, { status: "failed", error });
      log("pitcher", `Email failed: ${error}`, { lead, level: "error" });
      return { ok: false, error };
    }
  });
}

/** You said "send the pitch to X": approve and send it now, window or not. */
export async function sendPitchNow(lead: Lead): Promise<{ ok: boolean; error?: string; simulated?: boolean }> {
  const m = messagesFor(lead.id).find((x) => x.kind === "pitch" && x.direction === "out");
  if (!m) return { ok: false, error: lead.email ? `The pitch isn't written yet (${lead.name} is at the "${lead.status}" stage).` : `${lead.name} has no published email, so the pitch goes by phone, text or DM instead.` };
  if (m.status === "sent") return { ok: false, error: "The pitch already went out." };
  return sendMessage(m.id, { force: true });
}

// ── Follow-ups ───────────────────────────────────────────────────────────

export function queueFollowups(): number {
  const s = getSettings();
  let queued = 0;
  for (const lead of leadsWithStatus("pitched", { order: "oldest", limit: 300 })) {
    if (!lead.firstPitchAt) continue;
    const days = s.pitching.followupDays;
    const n = lead.followupsSent;
    const msgs = messagesFor(lead.id);
    if (msgs.some((m) => m.direction === "in")) continue;
    if (n < days.length && lead.pitch?.followups[n]) {
      if (Date.now() < Date.parse(lead.firstPitchAt) + days[n] * DAY_MS) continue;
      if (msgs.some((m) => m.kind === "followup" && ["queued", "pending_approval"].includes(m.status))) continue;
      const f = lead.pitch.followups[n];
      addMessage({
        leadId: lead.id,
        channel: "email",
        direction: "out",
        kind: "followup",
        subject: f.subject.toLowerCase().startsWith("re:") ? f.subject : `Re: ${lead.pitch.email.subject}`,
        body: `${f.body}\n\n${emailFooter(lead, s)}`,
        status: "queued",
        sendAfter: nextSendSlot(),
      });
      queued++;
    } else if (n >= days.length) {
      const last = days[days.length - 1] ?? 0;
      if (Date.now() > Date.parse(lead.firstPitchAt) + (last + 7) * DAY_MS) {
        const updated = updateLead(lead.id, (l) => {
          l.status = "lost";
          l.skipReason = "No reply after the full sequence";
        });
        if (updated) {
          leadChanged(updated);
          log("pitcher", "No reply after the full sequence. Closed it out; they won't hear from us again.", { lead: updated });
        }
      }
    }
  }
  return queued;
}

/** Cancel anything still waiting to go to this lead. */
export function cancelQueued(leadId: string, reason: string): void {
  for (const m of messagesFor(leadId)) if (m.direction === "out" && ["queued", "pending_approval", "draft"].includes(m.status) && m.kind !== "reply") updateMessage(m.id, { status: "failed", error: reason });
}

// ── Demo: replies arrive on their own so you can watch the Closer ───────

const DEMO_REPLIES = [
  { w: 3, text: "Hi! This actually looks great. What would it take to get it live? Do you handle the domain too?" },
  { w: 2, text: "Yes, let's do it. How do I pay?" },
  { w: 2, text: "Love this. We have three locations and we'd also need online booking and a gift card store. Can you quote all of it?" },
  { w: 2, text: "Can you give me a call tomorrow afternoon? Mornings are crazy here." },
  { w: 2, text: "How much is it, and is there a monthly fee after that?" },
  { w: 2, text: "Thanks, but we already have someone working on a site for us." },
  { w: 1, text: "Please remove us from your list." },
  { w: 1, text: "I'm out of the office until Monday with limited access to email." },
];

export function scheduleDemoReply(lead: Lead): void {
  if (Math.random() > 0.3) return;
  const total = DEMO_REPLIES.reduce((a, r) => a + r.w, 0);
  let x = Math.random() * total;
  const pick = DEMO_REPLIES.find((r) => (x -= r.w) < 0) ?? DEMO_REPLIES[0];
  const queue = kvGet<{ leadId: string; at: string; text: string }[]>("demo_replies") ?? [];
  queue.push({ leadId: lead.id, at: new Date(Date.now() + (40 + Math.random() * 120) * 1000).toISOString(), text: pick.text });
  kvSet("demo_replies", queue);
}

export function takeDueDemoReplies(): { leadId: string; text: string }[] {
  const queue = kvGet<{ leadId: string; at: string; text: string }[]>("demo_replies") ?? [];
  const due = queue.filter((r) => Date.parse(r.at) <= Date.now());
  if (due.length) kvSet("demo_replies", queue.filter((r) => Date.parse(r.at) > Date.now()));
  return due;
}

// ── Demo writer ──────────────────────────────────────────────────────────

export function demoPitch(lead: Lead, s: Settings): PitchPack {
  const niche = getNiche(lead.niche);
  const short = lead.name.replace(/\s+(LLC|Inc\.?|Ltd\.?|Co\.)$/i, "");
  const me = s.owner.name?.split(" ")[0] || "Sam";
  const problem: Record<string, string> = {
    none: `${short} doesn't have a website on Google yet`,
    social_only: `${short}'s Google listing points to a social page instead of a website`,
    dead: `the website link on ${short}'s Google listing is broken`,
    outdated: `${short}'s website is hard to use on a phone`,
    weak: `${short}'s website is missing online booking and a tap-to-call button`,
  };
  const p = problem[lead.websiteState ?? "none"] ?? problem.none;
  const rated = lead.rating && (lead.reviewCount ?? 0) >= 3 ? ` with ${lead.rating.toFixed(1)} stars from ${lead.reviewCount} reviews` : "";
  const subject = lead.websiteState === "dead" ? "your website link is broken" : `made ${short} a new website`;
  return {
    email: {
      subject,
      body: `Hi there,\n\nI was looking for a ${niche.label.toLowerCase()} in ${lead.city} and noticed ${p}. For a business${rated}, that's a lot of people who can't check your hours or services before they call.\n\nSo I built you ${lead.websiteState === "none" || lead.websiteState === "social_only" ? "one" : "a new one"}. It already has your real hours, phone number and reviews. Here it is, with a 10-second video:\n\n{proposal_link}\n\nWant me to put it live for you this week?`,
    },
    followups: [
      { day: 3, subject: `Re: ${subject}`, body: `Just making sure this reached you. The new site uses your real details, so there's nothing for you to write or send. Three designs to pick from:\n\n{proposal_link}` },
      { day: 7, subject: `Re: ${subject}`, body: `Last note from me. If the timing isn't right, no problem at all. If you want the site later, just reply and it's yours.` },
    ],
    sms: `Hi, it's ${me} from ${s.owner.agencyName}. I built ${short} a new website you can see here: {proposal_link} Reply STOP to opt out.`,
    dm: `Hi! I'm ${me}, a local web designer. I noticed ${p}, so I made you one. Take a look, no strings: {proposal_link}`,
    callScript: `Opener: "Hi, is this the owner of ${short}? This is ${me} with ${s.owner.agencyName}. I noticed ${p}, so I built you a new one already. Can I text you the link?"\nAsk: "Do many new customers find you on Google?"\nHow much? "${priceLabel(lead.dealValueCents ?? lead.priceCents, s)} once, and it's live this week. ${s.offer.guarantee}"\nWe already have someone: "No problem. I'll text you the link anyway in case it's useful."\nJust email me: "Will do. What's the best address?"`,
  };
}
