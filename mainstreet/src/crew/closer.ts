import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DEMO, features, publicBase } from "../config.ts";
import {
  addApproval,
  addMessage,
  addPayment,
  decideApproval,
  getLead,
  getLeadByEmail,
  getLeadByToken,
  getSettings,
  kvGet,
  kvSet,
  messagesFor,
  pendingApprovalFor,
  updateLead,
  updateMessage,
} from "../db.ts";
import { leadChanged, log, working } from "../events.ts";
import { askStructured } from "../providers/claude.ts";
import { sendEmail } from "../providers/email.ts";
import { notifyOwner } from "../providers/notify.ts";
import { renderSite } from "../site/render.ts";
import type { Lead, Message, ReplyAnalysis } from "../types.ts";
import { clip, errorMessage, money, nowIso, slugify } from "../util.ts";
import { ESTIMATE, preflight } from "./checker.ts";
import { cancelQueued, sendMessage, stopContact } from "./pitcher.ts";
import { CLOSER_PROMPT } from "./prompts.ts";
import { abs, emailFooter, facts, leadDir, postalAddress, priceLabel, proposalUrl } from "./shared.ts";

// Closer: reads every reply, answers what it safely can, hands you anything
// big or unusual, sends the payment link, and launches the site when they pay.

const ReplySchema = z.object({
  intent: z.enum(["interested", "ready_to_buy", "question", "wants_call", "price_objection", "not_interested", "unsubscribe", "wrong_person", "auto_reply"]),
  summary: z.string(),
  suggestedReply: z.string().describe("Empty for not_interested, unsubscribe and auto_reply"),
  needsHuman: z.boolean(),
  dealHintUsd: z.number().describe("0 unless they asked for clearly more than the standard site"),
});

export interface Inbound {
  from: string;
  to?: string;
  subject?: string;
  text: string;
  externalId?: string;
  leadId?: string;
  channel?: Message["channel"];
}

/** Find which lead a reply belongs to: plus-address token, then sender address. */
export function matchLead(i: Inbound): Lead | undefined {
  if (i.leadId) return getLead(i.leadId);
  const token = /\+([A-Za-z0-9_-]{6,})@/.exec(i.to ?? "")?.[1];
  if (token) {
    const byToken = getLeadByToken(token);
    if (byToken) return byToken;
  }
  const from = /<([^>]+)>/.exec(i.from)?.[1] ?? i.from;
  return getLeadByEmail(from.trim());
}

export async function handleInbound(i: Inbound): Promise<{ ok: boolean; leadId?: string; intent?: string; error?: string }> {
  const lead = matchLead(i);
  if (!lead) {
    log("closer", `Got an email from ${i.from} that doesn't match any lead. Left it alone.`, { level: "warn" });
    return { ok: false, error: "No matching lead" };
  }
  if (i.externalId && messagesFor(lead.id).some((m) => m.externalId === i.externalId)) return { ok: true, leadId: lead.id };
  return working("closer", `Reading ${lead.name}'s reply`, async () => {
    const msg = addMessage({
      leadId: lead.id,
      channel: i.channel ?? "email",
      direction: "in",
      kind: "inbound",
      subject: i.subject,
      body: clip(i.text, 8000),
      status: "received",
      externalId: i.externalId,
    });
    const { analysis } = await analyze(lead, i.text);
    updateMessage(msg.id, { analysis });
    await act(lead, analysis);
    return { ok: true, leadId: lead.id, intent: analysis.intent };
  });
}

/** Reads a reply with Claude, or with the simple keyword reader when Claude is off or fails (simple: true). */
async function analyze(lead: Lead, text: string, instructions?: string): Promise<{ analysis: ReplyAnalysis; simple: boolean }> {
  const s = getSettings();
  if (features.claude && preflight(ESTIMATE.reply(), { agent: "closer", what: "reading a reply", lead }).ok) {
    try {
      const thread = messagesFor(lead.id)
        .slice(-6)
        .map((m) => `${m.direction === "out" ? "US" : "THEM"}: ${clip(m.body.split("\n—\n")[0], 900)}`)
        .join("\n\n");
      const out = await askStructured({
        agent: "closer",
        leadId: lead.id,
        system: CLOSER_PROMPT,
        prompt: [
          `Business: ${lead.name} (${lead.city})`,
          `Offer: a ready-made website, ${priceLabel(lead.dealValueCents ?? lead.priceCents, s)} one time, live in ${s.offer.deliveryDays} days. ${s.offer.hostingMonthlyCents ? `Optional hosting ${money(s.offer.hostingMonthlyCents, s.offer.currency)}/month.` : "No monthly fee required."} ${s.offer.guarantee} We can help connect their own domain.`,
          s.owner.bookingUrl ? `Booking link available: yes` : "Booking link available: no",
          instructions ? `The owner's instructions for this reply: ${instructions}` : "",
          "",
          `Conversation so far:\n${thread}`,
          "",
          `Their latest reply:\n${clip(text, 4000)}`,
        ].join("\n"),
        schema: ReplySchema,
        effort: "medium",
        maxTokens: 5000,
        label: "reply",
      });
      return { analysis: { ...out, dealHintCents: out.dealHintUsd > 0 ? Math.round(out.dealHintUsd * 100) : undefined }, simple: false };
    } catch (err) {
      log("closer", `Couldn't analyse with Claude (${errorMessage(err)}); used the simple reader.`, { lead, level: "warn" });
    }
  }
  return { analysis: demoAnalysis(text, lead), simple: true };
}

function fillLinks(text: string, lead: Lead): string {
  const s = getSettings();
  return text
    .replaceAll("{claim_link}", `${proposalUrl(lead)}#claim`)
    .replaceAll("{proposal_link}", proposalUrl(lead) ?? "")
    .replaceAll("{booking_link}", s.owner.bookingUrl ?? "");
}

async function act(lead: Lead, a: ReplyAnalysis): Promise<void> {
  const s = getSettings();
  const human = !["auto_reply", "unsubscribe"].includes(a.intent);
  if (a.intent === "unsubscribe") {
    const u = stopContact(lead, "They asked to stop");
    log("closer", "Asked to be removed. Done: they're on the do-not-contact list and won't hear from us again.", { lead: u });
    return;
  }
  if (a.intent === "auto_reply") {
    log("closer", "Auto-reply (out of office). Follow-ups stay on schedule.", { lead });
    return;
  }
  cancelQueued(lead.id, "They replied");
  if (a.intent === "not_interested" || a.intent === "wrong_person") {
    const u = updateLead(lead.id, (l) => {
      l.status = a.intent === "not_interested" ? "lost" : "replied";
      l.skipReason = a.summary;
    })!;
    leadChanged(u);
    log("closer", `${a.intent === "not_interested" ? "Not interested" : "Wrong person"}: ${a.summary}`, { lead: u });
    return;
  }

  const u = updateLead(lead.id, (l) => {
    l.status = "negotiating";
    l.consent = { basis: "replied", at: nowIso(), note: "They replied to our email" };
    if (a.dealHintCents && a.dealHintCents > l.priceCents) l.dealValueCents = a.dealHintCents;
  })!;
  leadChanged(u);
  const draft = a.suggestedReply.trim() ? await saveDraft(u, fillLinks(a.suggestedReply, u)) : undefined;

  const big = (a.dealHintCents ?? 0) > s.escalation.dealOverCents;
  if (big) {
    addApproval({
      kind: "deal",
      leadId: u.id,
      leadName: u.name,
      title: `${u.name} wants a bigger project (~${money(a.dealHintCents, s.offer.currency)})`,
      detail: `${a.summary}\n\nThis is over your ${money(s.escalation.dealOverCents, s.offer.currency)} limit, so nothing goes out until you decide.${draft ? `\n\nDraft reply:\n${clip(draft.body.split("\n—\n")[0], 500)}` : ""}`,
      amountCents: a.dealHintCents,
      payload: { messageId: draft?.id },
    });
    log("closer", `Deal for ${money(a.dealHintCents, s.offer.currency)} is over your approved limit. Sending it to you for review.`, { lead: u, level: "warn" });
    await notifyOwner({
      title: `${money(a.dealHintCents, s.offer.currency)} deal needs you`,
      body: `${u.name}: ${a.summary}`,
      priority: "urgent",
      path: "#/approvals",
      tags: ["moneybag"],
      call: { reason: `${u.name} in ${u.city} wants a project worth about ${money(a.dealHintCents, s.offer.currency)}, which is over your limit.` },
      dedupeKey: `deal:${u.id}`,
    });
    return;
  }
  if (draft && s.pitching.autoReply && !a.needsHuman) {
    const sent = await sendMessage(draft.id, { force: true });
    log("closer", `Answered (${a.intent.replace("_", " ")}): ${a.summary}${sent.ok ? "" : ` (send failed: ${sent.error})`}`, { lead: u, level: sent.ok ? "success" : "warn" });
  } else if (draft) {
    addApproval({ kind: "reply", leadId: u.id, leadName: u.name, title: `Reply to ${u.name}?`, detail: `They said: ${a.summary}\n\nDraft:\n${clip(draft.body.split("\n—\n")[0], 600)}`, payload: { messageId: draft.id } });
    log("closer", `${a.intent === "ready_to_buy" ? "Ready to buy!" : "Replied"}: ${a.summary} Drafted an answer for you to approve.`, { lead: u, level: "success" });
  } else {
    log("closer", `${a.summary} This one needs you.`, { lead: u, level: "warn" });
  }
  if (human) {
    await notifyOwner({
      title: a.intent === "ready_to_buy" ? `${u.name} wants to buy` : `${u.name} replied`,
      body: a.summary,
      priority: a.intent === "ready_to_buy" || a.needsHuman ? "high" : "default",
      path: `#/lead/${u.id}`,
      tags: [a.intent === "ready_to_buy" ? "tada" : "speech_balloon"],
      dedupeKey: `reply:${u.id}:${a.intent}`,
    });
  }
  if (DEMO && a.intent === "ready_to_buy") scheduleDemoPayment(u);
}

async function saveDraft(lead: Lead, body: string): Promise<Message> {
  for (const m of messagesFor(lead.id)) if (m.kind === "reply" && m.status === "pending_approval") updateMessage(m.id, { status: "discarded", error: "Replaced by a newer draft" });
  const subject = messagesFor(lead.id).filter((m) => m.direction === "in").pop()?.subject;
  return addMessage({
    leadId: lead.id,
    channel: "email",
    direction: "out",
    kind: "reply",
    subject: subject ? (subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`) : `Re: your new website`,
    body: `${body.trim()}\n\n${emailFooter(lead)}`,
    status: "pending_approval",
  });
}

/**
 * "Atlas, draft a reply to Bright Smile saying we can do the domain." The draft waits for approval.
 * ignoredInstructions: the simple reader wrote it (Claude off), so the owner's instructions aren't in it.
 */
export async function draftReply(lead: Lead, instructions?: string): Promise<{ draft: Message; ignoredInstructions: boolean } | undefined> {
  const last = messagesFor(lead.id).filter((m) => m.direction === "in").pop();
  const { analysis: a, simple } = await analyze(lead, last?.body ?? "(no reply yet; write a short check-in)", instructions);
  const text = a.suggestedReply.trim() || (instructions ? instructions : "");
  if (!text) return undefined;
  const draft = await saveDraft(lead, fillLinks(text, lead));
  if (!pendingApprovalFor(lead.id, "reply")) addApproval({ kind: "reply", leadId: lead.id, leadName: lead.name, title: `Reply to ${lead.name}?`, detail: clip(draft.body.split("\n—\n")[0], 600), payload: { messageId: draft.id } });
  log("closer", `Drafted a reply${instructions ? ` (${clip(instructions, 60)})` : ""}.`, { lead });
  return { draft, ignoredInstructions: Boolean(instructions) && simple };
}

export async function sendReplyNow(lead: Lead, body?: string): Promise<{ ok: boolean; error?: string; simulated?: boolean }> {
  let draft = messagesFor(lead.id).filter((m) => m.kind === "reply" && m.status === "pending_approval").pop();
  if (body) draft = await saveDraft(lead, body);
  if (!draft) return { ok: false, error: "There's no drafted reply. Ask me to draft one first." };
  const res = await sendMessage(draft.id, { force: true });
  const ap = pendingApprovalFor(lead.id, "reply");
  if (res.ok && ap) decideApproval(ap.id, "approved", "voice");
  return res;
}

// ── Payments and launch ──────────────────────────────────────────────────

export async function markPaid(lead: Lead, p: { amountCents: number; currency: string; externalId: string; provider: string; variant?: string }): Promise<void> {
  if (!addPayment({ leadId: lead.id, provider: p.provider, externalId: p.externalId, amountCents: p.amountCents, currency: p.currency, status: "paid" })) return;
  cancelQueued(lead.id, "They paid");
  const variant = (["bold", "classic", "fresh"] as const).find((v) => v === p.variant);
  const won = updateLead(lead.id, (l) => {
    l.status = "won";
    l.dealValueCents = p.amountCents;
    if (variant) l.chosenVariant = variant;
  })!;
  leadChanged(won);
  log("closer", `Paid ${money(p.amountCents, p.currency.toUpperCase())}${p.provider === "demo" ? " (demo)" : ""}. Launching their site.`, { lead: won, level: "success" });
  await notifyOwner({ title: `Won: ${won.name} paid ${money(p.amountCents, p.currency.toUpperCase())}`, body: `${won.name} in ${won.city} paid. Their site is going live now.`, priority: "high", path: `#/lead/${won.id}`, tags: ["tada"], dedupeKey: `won:${won.id}` });
  try {
    await launch(won);
  } catch (err) {
    log("closer", `Launch failed: ${errorMessage(err)}. The payment is recorded; launch again from the lead.`, { lead: won, level: "error" });
  }
}

function uniqueSlug(lead: Lead): string {
  const base = slugify(`${lead.name} ${lead.city}`);
  for (let i = 0; ; i++) {
    const slug = i ? `${base}-${i + 1}` : base;
    const owner = kvGet<string>(`live:${slug}`);
    if (!owner || owner === lead.id) return slug;
  }
}

/** Publish the chosen design at /live/<slug>/ and welcome the client. */
export async function launch(lead: Lead): Promise<string> {
  if (!lead.spec || !lead.variants?.length) throw new Error("There's no mockup to launch.");
  const s = getSettings();
  const variant = lead.chosenVariant ?? lead.variants[0].id;
  const slug = lead.liveSlug ?? uniqueSlug(lead);
  const dir = leadDir(lead, "live");
  let heroUrl: string | undefined;
  if (lead.heroImage && fs.existsSync(abs(lead.heroImage))) {
    const name = path.basename(lead.heroImage);
    fs.copyFileSync(abs(lead.heroImage), path.join(dir, name));
    heroUrl = name;
  }
  const html = renderSite({ spec: lead.spec, facts: facts(lead), variant, heroImageUrl: heroUrl, mode: "live" });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  kvSet(`live:${slug}`, lead.id);
  const updated = updateLead(lead.id, (l) => {
    l.liveSlug = slug;
    l.chosenVariant = variant;
  })!;
  const url = `${publicBase()}/live/${slug}/`;
  if (updated.email) {
    await sendEmail({
      to: updated.email,
      subject: `${updated.name}'s new website is live`,
      text: `Thank you! Your new website is live here:\n\n${url}\n\nNext steps:\n1. Reply with your logo and any photos you'd like on the site (optional).\n2. If you own a domain (or want one), reply with it and we'll connect it for you.\n3. Want anything changed? Just reply and tell us.\n\n—\n${s.owner.name || s.owner.agencyName}, ${s.owner.agencyName}\n${postalAddress(s)}`,
      replyTo: s.owner.email || undefined,
      agent: "closer",
      leadId: updated.id,
    }).catch((err) => log("closer", `Welcome email failed: ${errorMessage(err)}`, { lead: updated, level: "warn" }));
  }
  log("closer", `Launched their site: ${url}`, { lead: updated, level: "success" });
  return url;
}

// ── Demo ─────────────────────────────────────────────────────────────────

function scheduleDemoPayment(lead: Lead): void {
  const q = kvGet<{ leadId: string; at: string }[]>("demo_payments") ?? [];
  q.push({ leadId: lead.id, at: new Date(Date.now() + (60 + Math.random() * 90) * 1000).toISOString() });
  kvSet("demo_payments", q);
}

export async function runDueDemoPayments(): Promise<void> {
  const q = kvGet<{ leadId: string; at: string }[]>("demo_payments") ?? [];
  const due = q.filter((x) => Date.parse(x.at) <= Date.now());
  if (!due.length) return;
  kvSet("demo_payments", q.filter((x) => Date.parse(x.at) > Date.now()));
  for (const d of due) {
    const lead = getLead(d.leadId);
    if (lead && lead.status !== "won") await markPaid(lead, { amountCents: lead.dealValueCents ?? lead.priceCents, currency: getSettings().offer.currency, externalId: `demo_${lead.id}`, provider: "demo" });
  }
}

/** A keyword reader for demo mode (and if Claude is unavailable). */
export function demoAnalysis(text: string, lead: Lead): ReplyAnalysis {
  const t = text.toLowerCase();
  const s = getSettings();
  const claim = `{claim_link}`;
  if (/remove|unsubscribe|stop (emailing|contacting)|don.?t (email|contact)|take me off/.test(t)) return { intent: "unsubscribe", summary: "Asked to be removed from the list.", suggestedReply: "", needsHuman: false };
  if (/out of (the )?office|auto.?reply|limited access|on vacation|away until/.test(t)) return { intent: "auto_reply", summary: "Automatic out-of-office reply.", suggestedReply: "", needsHuman: false };
  if (/locations|online store|e-?commerce|gift card|several pages|whole (thing|site)|quote all/.test(t))
    return {
      intent: "interested",
      summary: "Interested, but wants a bigger project: several locations, online booking and a store.",
      suggestedReply: `Thanks! That's a bigger project than our standard site, so I'll put together a proper quote for all of it and get back to you shortly. In the meantime, the design is here: ${claim}`,
      needsHuman: true,
      dealHintCents: 340_000,
    };
  if (/already have|not interested|no thanks|we.?re (all )?set|pass on/.test(t)) return { intent: "not_interested", summary: "Not interested; they already have someone.", suggestedReply: "", needsHuman: false };
  if (/how do i pay|let.?s do it|sign me up|go ahead|we.?ll take it|yes/.test(t))
    return { intent: "ready_to_buy", summary: "Wants to go ahead and asked how to pay.", suggestedReply: `Great! You can claim the site and pay securely here: ${claim}\n\nPick your favourite design on that page. Once that's done it goes live within ${s.offer.deliveryDays} days, and we'll help connect your domain.`, needsHuman: false };
  if (/call|phone|ring me|talk/.test(t))
    return { intent: "wants_call", summary: "Asked for a call.", suggestedReply: s.owner.bookingUrl ? `Happy to! Grab any time that suits you here: {booking_link}` : "Happy to! What time works best for you tomorrow afternoon, and which number should I call?", needsHuman: true };
  if (/how much|price|cost|monthly|fee/.test(t))
    return {
      intent: "question",
      summary: "Asked about price and monthly fees.",
      suggestedReply: `It's ${priceLabel(lead.dealValueCents ?? lead.priceCents, s)} one time, and it's live within ${s.offer.deliveryDays} days. ${s.offer.hostingMonthlyCents ? `Hosting is optional at ${money(s.offer.hostingMonthlyCents, s.offer.currency)}/month.` : "There's no monthly fee required."} ${s.offer.guarantee}\n\nYou can claim it here: ${claim}`,
      needsHuman: false,
    };
  return {
    intent: "interested",
    summary: "Interested and asked how it works.",
    suggestedReply: `Thanks for getting back to me! We handle everything: the site, getting it live and connecting your domain (or helping you get one). Pick your favourite design and claim it here: ${claim}`,
    needsHuman: false,
  };
}

