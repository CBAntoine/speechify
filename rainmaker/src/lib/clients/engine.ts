import "server-only";
import { claudeEnabled, resendEnabled } from "@/lib/config";
import { describeError } from "@/lib/claude/client";
import { writeReply } from "@/lib/claude/clients";
import { brandedFrom, sendEmail } from "@/lib/email";
import type { Lang } from "@/lib/markets";
import { displayPhone, toE164 } from "@/lib/phone";
import { addActivity } from "@/lib/repo";
import { newId } from "@/lib/store";
import type { Client, ClientData, ClientMessage, Contact, ContactSource, MsgChannel, MsgPurpose, Sequence, SequenceKind, ServiceId } from "@/lib/types";
import { readClientData, updateClientData } from "./data-store";
import { getClient, listClients } from "./repo";
import { automation, canMessage, firstName, isOptIn, isOptOut, localTime, needsOptOutReply, pickChannel, render } from "./rules";
import { enroll, planDue, STOP_ON_REPLY, stopEnrollments, type Vars } from "./schedule";
import { defaultSequence, emailFooter, holdingReply, identifiedText, optOutConfirmation, ownerAlert } from "./templates";
import { sendText, TwilioError, twilioEnabled } from "./twilio";

// What happens when a client's customer does something: fills in the website
// form, texts the business, calls and nobody answers, taps a review link.
// Every message is claimed in the client's document first (so two servers
// never send it twice), then delivered, then recorded. Services decide how
// far it goes: off does nothing, setup drafts it for checking, live sends it
// (or drafts it while approvals are on).

const nowIso = () => new Date().toISOString();

export interface Ctx {
  /** This deployment's public address, for links in messages. */
  base: string;
}

/** Which service owns each kind of sequence. */
export const SERVICE_OF: Record<SequenceKind, ServiceId> = { nurture: "speed_to_lead", reactivation: "reactivation", review: "reviews", referral: "reviews" };

// ── Links and placeholders ────────────────────────────────────

export function siteLink(client: Pick<Client, "site" | "website">, base: string): string | undefined {
  return client.site?.published ? `${base}/s/${client.site.slug}` : client.website;
}

/** g: review link, f: referral share link, u: unsubscribe. */
export function trackedLink(client: Pick<Client, "ref">, contact: Pick<Contact, "ref">, kind: "g" | "f" | "u", base: string): string {
  return `${base}/r/${client.ref}/${contact.ref}/${kind}`;
}

export function varsFor(client: Client, base: string): Vars {
  return (c: Contact, kind: SequenceKind) => ({
    first_name: firstName(c.name),
    name: c.name,
    business: client.name,
    review_link: client.reviewUrl ? trackedLink(client, c, "g", base) : "",
    referral_link: siteLink(client, base) ? trackedLink(client, c, "f", base) : "",
    booking_link: client.bookingUrl || siteLink(client, base) || "",
    site_link: siteLink(client, base) || "",
    offer: kind === "referral" ? client.settings.referralOffer : client.settings.reactivationOffer,
    phone: client.phone ? displayPhone(client.phone) : "",
  });
}

// ── Contacts ──────────────────────────────────────────────────

function refFor(data: ClientData): string {
  const taken = new Set(data.contacts.map((c) => c.ref));
  for (;;) {
    const r = Math.random().toString(36).slice(2, 8);
    if (r.length === 6 && !taken.has(r)) return r;
  }
}

export function findContact(data: ClientData, phone?: string, email?: string): Contact | undefined {
  const e = email?.toLowerCase();
  return data.contacts.find((c) => (phone && c.phone === phone) || (e && c.email?.toLowerCase() === e));
}

export function newContact(data: ClientData, input: Partial<Contact> & { name: string; source: ContactSource }): Contact {
  const t = nowIso();
  const c: Contact = {
    id: newId("ct"),
    ref: refFor(data),
    status: "new",
    consent: { email: false, sms: false, basis: "none" },
    enrollments: [],
    createdAt: t,
    updatedAt: t,
    ...input,
  };
  data.contacts.unshift(c);
  return c;
}

/** The running sequence of a kind, made from the template the first time it's needed. */
export function ensureSequence(data: ClientData, client: Client, kind: SequenceKind): Sequence {
  const existing = data.sequences.find((s) => s.kind === kind && s.status === "running") ?? data.sequences.find((s) => s.kind === kind);
  if (existing) return existing;
  const t = defaultSequence(kind, client.lang, { business: client.name, offer: client.settings.reactivationOffer, referralOffer: client.settings.referralOffer });
  const seq: Sequence = { id: newId("seq"), kind, name: t.name, status: "running", steps: t.steps, createdBy: "template", createdAt: nowIso(), updatedAt: nowIso() };
  data.sequences.push(seq);
  return seq;
}

// ── Sending ───────────────────────────────────────────────────

interface Outgoing {
  contactId: string;
  channel: MsgChannel;
  purpose: MsgPurpose;
  subject?: string;
  body: string;
  by: ClientMessage["by"];
  seqId?: string;
  step?: number;
  /** Placeholders that couldn't be filled: the message waits as a draft. */
  missing?: string[];
}

type Delivery = { status: "sent" | "failed" | "draft"; providerId?: string; error?: string; optedOut?: boolean };

async function deliver(client: Client, contact: Contact, m: ClientMessage, base: string): Promise<Delivery> {
  try {
    if (m.channel === "email") {
      if (!contact.email) return { status: "failed", error: "No email address" };
      const from = brandedFrom(client.name);
      if (!resendEnabled() || !from) return { status: "draft", error: "Email sending isn't connected (RESEND_API_KEY and RESEND_FROM)" };
      const unsubscribe = trackedLink(client, contact, "u", base);
      const r = await sendEmail({
        to: contact.email,
        subject: m.subject || client.name,
        text: m.body + emailFooter(client.lang, client.name, client.address, unsubscribe),
        from,
        replyTo: client.email,
        headers: { "List-Unsubscribe": `<${unsubscribe}>` },
      });
      return { status: "sent", providerId: r.id };
    }
    if (!contact.phone) return { status: "failed", error: "No phone number" };
    const from = m.channel === "whatsapp" ? client.whatsappNumber : client.smsNumber;
    if (!twilioEnabled()) return { status: "draft", error: "Texting isn't connected (TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN)" };
    if (!from) return { status: "draft", error: "This client has no texting number yet (Calls tab)" };
    const r = await sendText({ from, to: contact.phone, body: m.body, whatsapp: m.channel === "whatsapp" });
    return { status: "sent", providerId: r.sid };
  } catch (err) {
    return { status: "failed", error: describeError(err), optedOut: err instanceof TwilioError && err.code === 21610 };
  }
}

const AUTOMATED: ClientMessage["by"][] = ["ai", "template"];

/**
 * Record messages, then send the ones that should go now. mode "draft" only
 * records them for a person to approve. Returns the messages as they ended up.
 */
async function dispatch(client: Client, outs: Outgoing[], mode: "draft" | "send", ctx: Ctx): Promise<ClientMessage[]> {
  if (!outs.length) return [];
  const day = localTime(new Date(), client.timezone).day;
  const claimed = await updateClientData(client.id, (data) => {
    const list: { m: ClientMessage; c: Contact }[] = [];
    for (const o of outs) {
      const c = data.contacts.find((x) => x.id === o.contactId);
      if (!c) continue;
      const send = mode === "send" && !o.missing?.length;
      const m: ClientMessage = {
        id: newId("msg"),
        contactId: c.id,
        channel: o.channel,
        direction: "out",
        purpose: o.purpose,
        subject: o.subject,
        body: o.body,
        by: o.by,
        status: send ? "sending" : "draft",
        at: nowIso(),
        seqId: o.seqId,
        step: o.step,
        error: o.missing?.length ? `Fill in ${o.missing.map((x) => `{${x}}`).join(", ")} before sending` : undefined,
      };
      data.messages.push(m);
      if (AUTOMATED.includes(o.by)) {
        const d = (data.daily[day] ??= { sent: 0, views: 0 });
        d.sent += 1;
      }
      list.push({ m: structuredClone(m), c: structuredClone(c) });
    }
    return list;
  });
  const results = await Promise.all(claimed.map(async ({ m, c }) => (m.status === "sending" ? { id: m.id, r: await deliver(client, c, m, ctx.base) } : { id: m.id, r: null })));
  if (!results.some((x) => x.r)) return claimed.map((x) => x.m);
  return updateClientData(client.id, (data) => {
    const out: ClientMessage[] = [];
    for (const { id, r } of results) {
      const m = data.messages.find((x) => x.id === id);
      if (!m) continue;
      if (r) {
        m.status = r.status;
        m.error = r.error;
        m.providerId = r.providerId;
        if (r.status === "sent") m.sentAt = nowIso();
        const c = data.contacts.find((x) => x.id === m.contactId);
        if (c && r.status === "sent") {
          c.lastOutboundAt = m.sentAt;
          if (c.source !== "import" && !c.firstReplyAt) c.firstReplyAt = m.sentAt;
          if (c.status === "new") c.status = "contacted";
          c.updatedAt = nowIso();
        }
        if (c && r.optedOut) optOut(c);
      }
      out.push(structuredClone(m));
    }
    return out;
  });
}

function optOut(c: Contact) {
  c.status = "opted_out";
  c.optedOutAt ??= nowIso();
  c.consent = { ...c.consent, sms: false, email: false };
  stopEnrollments(c, "opted_out", new Date());
  c.updatedAt = nowIso();
}

/** A short note to the business owner: their staff phone first, else their email. Never blocks. */
async function alertOwner(client: Client, text: string): Promise<void> {
  try {
    if (client.staffPhone && client.smsNumber && twilioEnabled() && client.staffPhone !== client.smsNumber) {
      await sendText({ from: client.smsNumber, to: client.staffPhone, body: text });
      return;
    }
    const from = brandedFrom(client.name);
    if (client.email && resendEnabled() && from) await sendEmail({ to: client.email, subject: text.slice(0, 80), text, from });
  } catch (err) {
    console.warn("[rainmaker] owner alert failed", describeError(err));
  }
}

function strongest(...modes: ("off" | "draft" | "send")[]): "off" | "draft" | "send" {
  return modes.includes("send") ? "send" : modes.includes("draft") ? "draft" : "off";
}

// ── New leads (website form, intake webhook, ad lead, manual) ─

export interface LeadInput {
  name?: string;
  phone?: string;
  email?: string;
  message?: string;
  interest?: string;
  source: ContactSource;
  /** They ticked "you may text me about my request". */
  consentSms?: boolean;
  /** Referral code from a customer's share link. */
  ref?: string;
  utm?: Contact["utm"];
  lang?: Lang;
}

export async function captureLead(client: Client, input: LeadInput, ctx: Ctx): Promise<{ contact: Contact; replies: ClientMessage[] }> {
  const phone = toE164(input.phone, client.country);
  const email = input.email?.trim().toLowerCase() || undefined;
  if (!phone && !email) throw new Error("A phone number or email address is needed");
  const mode = automation(client, "speed_to_lead");
  const { contact, isNew } = await updateClientData(client.id, (data) => {
    let c = findContact(data, phone, email);
    const isNew = !c;
    const referrer = input.ref ? data.contacts.find((x) => x.ref === input.ref) : undefined;
    if (!c) {
      c = newContact(data, {
        name: (input.name?.trim() || email?.split("@")[0] || (phone ? displayPhone(phone) : "")).slice(0, 120),
        phone,
        email,
        source: referrer ? "referral" : input.source,
        referredBy: referrer?.id,
        lang: input.lang,
        utm: input.utm,
        consent: { email: Boolean(email), sms: Boolean(phone && input.consentSms), basis: input.source === "call" || input.source === "text" ? "inquiry" : "form", at: nowIso() },
      });
    } else {
      c.phone ??= phone;
      c.email ??= email;
      if (input.consentSms && phone) c.consent = { ...c.consent, sms: true, basis: "form", at: nowIso() };
      if (c.status === "lost") c.status = "engaged";
    }
    if (input.message) c.message = input.message.slice(0, 2000);
    if (input.interest) c.interest = input.interest.slice(0, 200);
    c.lastInboundAt = nowIso();
    c.updatedAt = nowIso();
    if (mode !== "off") enroll(c, ensureSequence(data, client, "nurture"), new Date(), { next: 1 });
    return { contact: structuredClone(c), isNew };
  });

  let replies: ClientMessage[] = [];
  if (mode !== "off") {
    // The first answer replies to what they asked for; follow-ups need permission.
    const channel = pickChannel(contact, "reply", client);
    if (channel) {
      const data = await readClientData(client.id);
      const seq = ensureSequence(structuredClone(data), client, "nurture");
      let body: string | undefined;
      let by: ClientMessage["by"] = "template";
      if (claudeEnabled() && client.settings.aiReplies && (input.message || input.interest)) {
        try {
          const r = await writeReply({
            client,
            contact,
            history: [{ direction: "in", body: [input.interest, input.message].filter(Boolean).join(" — "), at: contact.createdAt }],
            channel,
            siteUrl: siteLink(client, ctx.base),
          });
          if (r.reply && r.intent !== "spam") {
            body = r.reply;
            by = "ai";
          }
        } catch (err) {
          console.warn("[rainmaker] instant reply fell back to the template", describeError(err));
        }
      }
      const step = seq.steps[0];
      const t = render(channel === "email" ? step.email : step.sms, varsFor(client, ctx.base)(contact, "nurture"));
      const subject = channel === "email" ? render(step.subject, varsFor(client, ctx.base)(contact, "nurture")).text : undefined;
      replies = await dispatch(
        client,
        [{ contactId: contact.id, channel, purpose: "reply", subject, body: channel === "email" ? (body ?? t.text) : identifiedText(body ?? t.text, { business: client.name, lang: client.lang, country: client.country, first: true }), by, seqId: seq.id, step: 0, missing: body ? [] : t.missing }],
        mode,
        ctx
      );
    }
  }
  const sent = replies.find((m) => m.status === "sent");
  if (isNew) {
    await addActivity({ kind: "lead", text: `New lead for ${client.name}: ${contact.name}${sent ? " (answered instantly)" : ""}` });
    if (mode === "send") {
      const seconds = sent?.sentAt ? Math.max(1, Math.round((Date.parse(sent.sentAt) - Date.parse(contact.createdAt)) / 1000)) : undefined;
      await alertOwner(client, ownerAlert("new_lead", client.lang, { business: client.name, name: contact.name, phone: contact.phone ? displayPhone(contact.phone) : contact.email, text: input.message, seconds }));
    }
  }
  return { contact, replies };
}

// ── Incoming texts ────────────────────────────────────────────

export async function handleInboundText(client: Client, input: { from: string; body: string; channel: "sms" | "whatsapp"; sid?: string }, ctx: Ctx): Promise<{ action: "opt_out" | "opt_in" | "reply" | "duplicate"; replies: ClientMessage[] }> {
  const phone = toE164(input.from.replace(/^whatsapp:/, ""), client.country) ?? input.from.replace(/^whatsapp:/, "");
  const body = input.body.trim().slice(0, 1600);
  const result = await updateClientData(client.id, (data) => {
    if (input.sid && data.messages.some((m) => m.providerId === input.sid)) return { action: "duplicate" as const };
    let c = findContact(data, phone);
    c ??= newContact(data, { name: displayPhone(phone), phone, source: "text", consent: { email: false, sms: false, basis: "inquiry", at: nowIso() } });
    data.messages.push({ id: newId("msg"), contactId: c.id, channel: input.channel, direction: "in", purpose: "reply", body, by: "contact", status: "received", at: nowIso(), providerId: input.sid });
    c.lastInboundAt = nowIso();
    c.updatedAt = nowIso();
    if (isOptOut(body, client.country)) {
      optOut(c);
      return { action: "opt_out" as const, contact: structuredClone(c) };
    }
    if (isOptIn(body)) {
      c.status = "engaged";
      c.optedOutAt = undefined;
      c.consent = { ...c.consent, sms: true, basis: "written", at: nowIso() };
      return { action: "opt_in" as const, contact: structuredClone(c) };
    }
    stopEnrollments(c, "replied", new Date(), STOP_ON_REPLY);
    if (c.status !== "booked") c.status = "engaged";
    const history = data.messages.filter((m) => m.contactId === c.id && m.status !== "draft").slice(-20);
    return { action: "reply" as const, contact: structuredClone(c), history };
  });
  if (result.action === "duplicate") return { action: "duplicate", replies: [] };
  const contact = result.contact;
  const vars = varsFor(client, ctx.base)(contact, "nurture");

  if (result.action === "opt_out") {
    const replies = needsOptOutReply(body, client.country)
      ? await dispatch(client, [{ contactId: contact.id, channel: input.channel, purpose: "opt_out", body: render(optOutConfirmation(client.lang), vars).text, by: "template" }], "send", ctx)
      : [];
    return { action: "opt_out", replies };
  }
  if (result.action === "opt_in") return { action: "opt_in", replies: [] };

  const mode = strongest(automation(client, "speed_to_lead"), automation(client, "missed_calls"), automation(client, "reactivation"));
  if (mode === "off" || !client.settings.aiReplies) {
    if (mode !== "off" || client.status === "active") await alertOwner(client, ownerAlert("needs_you", client.lang, { business: client.name, name: contact.name, phone: displayPhone(phone), text: body }));
    return { action: "reply", replies: [] };
  }
  let reply = render(holdingReply(client.lang), vars).text;
  let by: ClientMessage["by"] = "template";
  let intent: string = "other";
  let handoff = !claudeEnabled();
  if (claudeEnabled()) {
    try {
      const r = await writeReply({ client, contact, history: result.history, channel: input.channel, siteUrl: siteLink(client, ctx.base) });
      intent = r.intent;
      handoff = r.handoff;
      if (r.intent === "spam" || !r.reply) reply = "";
      else {
        reply = r.reply;
        by = "ai";
      }
    } catch (err) {
      console.warn("[rainmaker] AI reply failed; sent the holding reply", describeError(err));
      handoff = true;
    }
  }
  const replies = reply && canMessage(contact, input.channel, "reply").ok ? await dispatch(client, [{ contactId: contact.id, channel: input.channel, purpose: "reply", body: reply, by }], mode, ctx) : [];
  if (handoff || intent === "wants_to_book" || intent === "needs_person" || intent === "not_interested") {
    await updateClientData(client.id, (data) => {
      const c = data.contacts.find((x) => x.id === contact.id);
      if (!c) return;
      if (intent === "not_interested") {
        c.status = "lost";
        stopEnrollments(c, "manual", new Date());
      } else c.needsHuman = true;
      c.updatedAt = nowIso();
    });
    if (intent !== "not_interested" && mode === "send") {
      await alertOwner(client, ownerAlert(intent === "wants_to_book" ? "booked" : "needs_you", client.lang, { business: client.name, name: contact.name, phone: displayPhone(phone), text: body }));
    }
  }
  return { action: "reply", replies };
}

// ── Calls ─────────────────────────────────────────────────────

export async function logCall(client: Client, input: { sid?: string; from?: string; outcome: "answered" | "ai" | "missed"; durationSec?: number }, opts: { create?: boolean } = {}): Promise<void> {
  const phone = input.from ? (toE164(input.from, client.country) ?? input.from) : undefined;
  await updateClientData(client.id, (data) => {
    const existing = input.sid ? data.calls.find((c) => c.sid === input.sid) : undefined;
    if (existing) {
      // The status callback comes last: keep the outcome the call flow decided, add the length.
      if (input.durationSec !== undefined) existing.durationSec = input.durationSec;
      if (existing.outcome === "missed" && input.outcome !== "missed") existing.outcome = input.outcome;
      return;
    }
    if (opts.create === false) return;
    let contact = phone ? findContact(data, phone) : undefined;
    if (!contact && phone && input.outcome !== "answered") contact = newContact(data, { name: displayPhone(phone), phone, source: "call", consent: { email: false, sms: false, basis: "inquiry", at: nowIso() } });
    data.calls.unshift({ id: newId("call"), sid: input.sid, from: phone, contactId: contact?.id, at: nowIso(), outcome: input.outcome, durationSec: input.durationSec });
  });
}

/** Nobody (and no AI) took the call: text the caller back and follow up. */
export async function handleMissedCall(client: Client, input: { from: string; sid?: string }, ctx: Ctx): Promise<ClientMessage[]> {
  await logCall(client, { sid: input.sid, from: input.from, outcome: "missed" });
  const mode = automation(client, "missed_calls");
  if (mode === "off" || !client.settings.textBack) return [];
  const phone = toE164(input.from, client.country);
  if (!phone) return [];
  const contact = await updateClientData(client.id, (data) => {
    const c = findContact(data, phone);
    if (!c) return undefined;
    if (automation(client, "speed_to_lead") !== "off") enroll(c, ensureSequence(data, client, "nurture"), new Date(), { next: 1 });
    return structuredClone(c);
  });
  if (!contact) return [];
  const channel: MsgChannel = client.settings.whatsapp && client.whatsappNumber ? "whatsapp" : "sms";
  if (!canMessage(contact, channel, "missed_call").ok) return [];
  const r = render(client.settings.textBackMessage, varsFor(client, ctx.base)(contact, "nurture"));
  const sent = await dispatch(client, [{ contactId: contact.id, channel, purpose: "missed_call", body: r.text, by: "template", missing: r.missing }], mode, ctx);
  if (sent.some((m) => m.status === "sent")) {
    await updateClientData(client.id, (data) => {
      const call = data.calls.find((c) => (input.sid && c.sid === input.sid) || c.contactId === contact.id);
      if (call) call.textedBack = true;
    });
    await alertOwner(client, ownerAlert("missed_call", client.lang, { business: client.name, phone: displayPhone(phone) }));
  }
  return sent;
}

// ── Tracked links ─────────────────────────────────────────────

/** A review, referral or unsubscribe link was opened. Returns where to send the visitor. */
export async function trackClick(client: Client, contactRef: string, kind: "g" | "f" | "u", ctx: Ctx): Promise<{ to?: string; unsubscribed?: boolean }> {
  if (!/^[a-z0-9]{6}$/.test(contactRef)) return { to: siteLink(client, ctx.base) };
  const mode = automation(client, "reviews");
  const found = await updateClientData(client.id, (data) => {
    const c = data.contacts.find((x) => x.ref === contactRef);
    if (!c) return false;
    const t = nowIso();
    if (kind === "g") {
      if (!c.reviewClickedAt) {
        c.reviewClickedAt = t;
        stopEnrollments(c, "clicked", new Date(), ["review"]);
        if (mode !== "off") enroll(c, ensureSequence(data, client, "referral"), new Date());
      }
    } else if (kind === "f") {
      c.referralClicks = (c.referralClicks ?? 0) + 1;
    } else {
      optOut(c);
    }
    c.updatedAt = t;
    return true;
  });
  if (kind === "u") return { unsubscribed: found };
  if (kind === "g") return { to: client.reviewUrl ?? siteLink(client, ctx.base) };
  const site = siteLink(client, ctx.base);
  return { to: site ? `${site}${site.includes("?") ? "&" : "?"}ref=${contactRef}` : undefined };
}

// ── Due sequence messages ─────────────────────────────────────

export interface RunResult {
  sent: number;
  drafted: number;
  failed: number;
  held?: string;
}

/** Send (or draft) every sequence message that's due for one client. */
export async function processDue(clientId: string, ctx: Ctx, max = 60): Promise<RunResult> {
  const client = await getClient(clientId);
  if (!client || client.status === "ended" || client.status === "paused") return { sent: 0, drafted: 0, failed: 0 };
  const kinds = (Object.keys(SERVICE_OF) as SequenceKind[]).filter((k) => automation(client, SERVICE_OF[k]) !== "off");
  if (!kinds.length) return { sent: 0, drafted: 0, failed: 0 };
  const now = new Date();
  const vars = varsFor(client, ctx.base);
  const data = await readClientData(clientId);
  const plan = planDue(client, data, now, vars, { kinds, max });
  // Claim each step (advance the enrollment) before sending, so a second run skips it.
  const claimed = await updateClientData(clientId, (d) => {
    for (const f of plan.finish) {
      const e = d.contacts.find((c) => c.id === f.contactId)?.enrollments.find((x) => x.seqId === f.seqId && !x.stoppedAt);
      if (e) {
        e.stoppedAt = now.toISOString();
        e.stop = f.stop;
      }
    }
    const ok: typeof plan.sends = [];
    for (const s of plan.sends) {
      const e = d.contacts.find((c) => c.id === s.contactId)?.enrollments.find((x) => x.seqId === s.seqId && !x.stoppedAt);
      if (!e || e.next !== s.step) continue;
      e.next += 1;
      ok.push(s);
    }
    return ok;
  });
  const byMode: Record<"draft" | "send", Outgoing[]> = { draft: [], send: [] };
  for (const s of claimed) {
    const m = automation(client, SERVICE_OF[s.kind]);
    if (m === "off") continue;
    byMode[m].push({ contactId: s.contactId, channel: s.channel, purpose: s.kind, subject: s.subject, body: s.body, by: "template", seqId: s.seqId, step: s.step, missing: s.missing });
  }
  const out = [...(await dispatch(client, byMode.send, "send", ctx)), ...(await dispatch(client, byMode.draft, "draft", ctx))];
  return {
    sent: out.filter((m) => m.status === "sent").length,
    drafted: out.filter((m) => m.status === "draft").length,
    failed: out.filter((m) => m.status === "failed").length,
    held: plan.held,
  };
}

/** The daily run: every active client's due messages, until the time budget runs out. */
export async function processAllClients(ctx: Ctx, budgetMs = 200_000): Promise<{ clients: number } & RunResult> {
  const until = Date.now() + budgetMs;
  const total: { clients: number } & RunResult = { clients: 0, sent: 0, drafted: 0, failed: 0 };
  for (const c of await listClients()) {
    if (Date.now() > until) break;
    if (c.sample || c.status === "ended" || c.status === "paused") continue;
    try {
      const r = await processDue(c.id, ctx);
      total.clients += 1;
      total.sent += r.sent;
      total.drafted += r.drafted;
      total.failed += r.failed;
    } catch (err) {
      console.error(`[rainmaker] client run failed for ${c.name}`, err);
    }
  }
  return total;
}

// ── What staff do from the workspace ──────────────────────────

/** Approve a draft (optionally edited) and send it now. */
export async function approveDraft(client: Client, messageId: string, edits: { body?: string; subject?: string }, ctx: Ctx): Promise<ClientMessage> {
  const claimed = await updateClientData(client.id, (data) => {
    const m = data.messages.find((x) => x.id === messageId);
    if (!m) throw new Error("Message not found");
    if (m.status !== "draft" && m.status !== "failed") throw new Error("That message was already sent");
    const c = data.contacts.find((x) => x.id === m.contactId);
    if (!c) throw new Error("Contact not found");
    if (edits.body !== undefined) m.body = edits.body.slice(0, 1600);
    if (edits.subject !== undefined) m.subject = edits.subject.slice(0, 200);
    if (/\{(first_name|business|review_link|referral_link|booking_link|site_link|offer|phone)\}/.test(m.body)) throw new Error("Fill in the {placeholders} first");
    const gate = canMessage(c, m.channel, m.purpose);
    if (!gate.ok) throw new Error(gate.reason);
    m.status = "sending";
    m.error = undefined;
    return { m: structuredClone(m), c: structuredClone(c) };
  });
  const r = await deliver(client, claimed.c, claimed.m, ctx.base);
  return updateClientData(client.id, (data) => {
    const m = data.messages.find((x) => x.id === messageId)!;
    m.status = r.status;
    m.error = r.error;
    m.providerId = r.providerId;
    if (r.status === "sent") {
      m.sentAt = nowIso();
      const c = data.contacts.find((x) => x.id === m.contactId);
      if (c) {
        c.lastOutboundAt = m.sentAt;
        if (c.source !== "import" && !c.firstReplyAt) c.firstReplyAt = m.sentAt;
        if (c.status === "new") c.status = "contacted";
        if (r.optedOut) optOut(c);
      }
    }
    return structuredClone(m);
  });
}

/** Staff write to a contact themselves. */
export async function sendFromStaff(client: Client, contactId: string, input: { channel: MsgChannel; body: string; subject?: string }, ctx: Ctx): Promise<ClientMessage> {
  const draft = await updateClientData(client.id, (data) => {
    const c = data.contacts.find((x) => x.id === contactId);
    if (!c) throw new Error("Contact not found");
    const m: ClientMessage = { id: newId("msg"), contactId, channel: input.channel, direction: "out", purpose: "manual", subject: input.subject, body: input.body.slice(0, 1600), by: "staff", status: "draft", at: nowIso() };
    data.messages.push(m);
    c.needsHuman = false;
    return m;
  });
  return approveDraft(client, draft.id, {}, ctx);
}

export async function discardMessage(clientId: string, messageId: string): Promise<void> {
  await updateClientData(clientId, (data) => {
    const m = data.messages.find((x) => x.id === messageId);
    if (m && (m.status === "draft" || m.status === "failed")) data.messages = data.messages.filter((x) => x.id !== messageId);
  });
}

/** Mark jobs finished: each customer gets the review request after the client's delay. */
export async function markJobsDone(client: Client, contactIds: string[]): Promise<{ queued: number; skipped: number }> {
  const mode = automation(client, "reviews");
  const start = new Date(Date.now() + client.settings.reviewDelayHours * 3_600_000);
  return updateClientData(client.id, (data) => {
    const seq = ensureSequence(data, client, "review");
    let queued = 0;
    let skipped = 0;
    for (const id of contactIds) {
      const c = data.contacts.find((x) => x.id === id);
      if (!c) continue;
      c.jobDoneAt = nowIso();
      c.updatedAt = nowIso();
      if (mode !== "off" && enroll(c, seq, new Date(), { startAt: start })) queued++;
      else skipped++;
    }
    return { queued, skipped };
  });
}

export async function markBooked(clientId: string, contactId: string, booked: boolean, value?: number): Promise<Contact> {
  return updateClientData(clientId, (data) => {
    const c = data.contacts.find((x) => x.id === contactId);
    if (!c) throw new Error("Contact not found");
    if (booked) {
      c.status = "booked";
      c.bookedAt ??= nowIso();
      if (value !== undefined && Number.isFinite(value) && value >= 0) c.value = value;
      c.needsHuman = false;
      stopEnrollments(c, "booked", new Date(), ["nurture", "reactivation"]);
    } else {
      c.status = "engaged";
      c.bookedAt = undefined;
      c.value = undefined;
    }
    c.updatedAt = nowIso();
    return structuredClone(c);
  });
}

/** Start past customers on a win-back sequence. Only people allowed to hear from the business are enrolled. */
export async function startWinBack(client: Client, contactIds: string[], seqId?: string): Promise<{ enrolled: number; skipped: number }> {
  return updateClientData(client.id, (data) => {
    const seq = (seqId ? data.sequences.find((s) => s.id === seqId && s.kind === "reactivation") : undefined) ?? ensureSequence(data, client, "reactivation");
    seq.status = "running";
    let enrolled = 0;
    let skipped = 0;
    for (const id of contactIds) {
      const c = data.contacts.find((x) => x.id === id);
      if (!c || !pickChannel(c, "reactivation", client)) {
        skipped++;
        continue;
      }
      if (enroll(c, seq, new Date())) enrolled++;
      else skipped++;
    }
    return { enrolled, skipped };
  });
}
