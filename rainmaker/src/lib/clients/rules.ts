// When a message may go out to one of a client's contacts, and what it says
// once its placeholders are filled. Consent first, opt-outs honoured in any
// language, quiet hours in the client's own time zone, a daily cap per
// client. Pure, so every rule is unit tested.

import { RULES, UNIVERSAL_OPT_OUT } from "../compliance-data.ts";
import type { Client, Contact, MsgChannel, MsgPurpose, ServiceId } from "../types.ts";

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Stop words in every language the software works in, whatever the client's
 * country: a Spanish speaker texting a Toronto business can still say ALTO.
 * Honouring a few extra words is the safe direction.
 */
const ALL_OPT_OUT = [...new Set([...UNIVERSAL_OPT_OUT, ...RULES.flatMap((r) => r.optOutWords)].map(strip).filter(Boolean))];

function optOutWords(_country?: string): string[] {
  return ALL_OPT_OUT;
}

const OPT_OUT_PHRASES = [
  /\b(STOP|QUIT|DON'?T|DON T|DO NOT|NO MORE|NOT) (TEXT|TEXTING|MESSAGE|MESSAGING|CALL|CALLING|CONTACT|CONTACTING|EMAIL|EMAILING|SEND)/,
  /\bREMOVE ME\b|\bTAKE ME OFF\b|\bUNSUBSCRIBE ME\b|\bLEAVE ME ALONE\b|\bWRONG NUMBER\b/,
  /\bNO (ME )?(ESCRIBAN|ENVIEN|MANDEN|LLAMEN|CONTACTEN)\b|\bNO MAS MENSAJES\b|\bDAR(ME)? DE BAJA\b|\bNUMERO EQUIVOCADO\b/,
  /\bNE (PLUS )?(M'?ECRIVEZ|M'?ENVOYEZ|M'?APPELEZ|ME CONTACTEZ)\b|\bPLUS DE MESSAGES\b|\bDESINSCRI|\bMAUVAIS NUMERO\b/,
];

/**
 * True when an incoming message asks to stop: a stop word on its own or
 * leading a short message ("Stop", "stop please", "ALTO", "Arrêt"), or a
 * plain request ("please don't text me", "no me escriban más").
 */
export function isOptOut(text: string, country?: string): boolean {
  const t = strip(text).replace(/\b(PLEASE|PLS|POR FAVOR|SVP|S'IL VOUS PLAIT|THANKS|THANK YOU|GRACIAS|MERCI|NOW|YA)\b/g, "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  const words = optOutWords(country);
  if (words.includes(t)) return true;
  // "Stop texting", "ALTO ya", "Unsubscribe me": a short message led by a
  // clear stop word. Words that also mean something else ("cancel my
  // appointment", "end of the month", "stop by at 3") only count alone.
  const parts = t.split(" ");
  const lead = [parts[0], parts.slice(0, 2).join(" ")].find((w) => words.includes(w) && !WEAK.has(w));
  if (lead && parts.length <= 3 && !/^STOP BY\b/.test(t)) return true;
  return OPT_OUT_PHRASES.some((re) => re.test(t));
}

const WEAK = new Set(["CANCEL", "END", "CANCELAR", "FIN", "ANNULER", "TERMINAR"]);

/** START / UNSTOP: they want messages again. */
export function isOptIn(text: string): boolean {
  return /^(START|UNSTOP|SUBSCRIBE)$/.test(strip(text));
}

/** Stop words Twilio already answers on US and Canadian numbers, so we don't send a second confirmation. */
const CARRIER_HANDLED = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "OPT OUT"]);

export function needsOptOutReply(text: string, country?: string): boolean {
  const nanp = ["US", "CA"].includes((country ?? "").toUpperCase());
  return !(nanp && CARRIER_HANDLED.has(strip(text)));
}

export function quietHoursFor(country?: string): { start: number; end: number } {
  const r = RULES.find((x) => x.country === (country ?? "").toUpperCase())?.quietHours;
  return r ? { start: r.start, end: r.end } : { start: 9, end: 20 };
}

/** Days automated messages may go out by default. Several US states ban Sunday sales calls; French rules allow weekdays only. */
export function sendDaysFor(country?: string): "every" | "mon_sat" | "weekdays" {
  const c = (country ?? "").toUpperCase();
  if (c === "US") return "mon_sat";
  if (FRENCH_RULES.has(c)) return "weekdays";
  return "every";
}

/** France's rules for its territories also keep 13:00-14:00 free. */
const FRENCH_RULES = new Set(["GP", "MQ", "BL", "MF", "PM"]);

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Local date, hour and weekday (0 = Sunday) in a time zone. */
export function localTime(now: Date, timeZone: string): { day: string; hour: number; minute: number; weekday: number } {
  const opts = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" } as const;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: "UTC" }).formatToParts(now);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24, minute: Number(get("minute")), weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday"))) };
}

/** Inside the days and hours automated messages may go out, in the client's time zone. */
export function inSendingHours(now: Date, client: Pick<Client, "timezone" | "settings"> & { country?: string }): boolean {
  const { hour, weekday } = localTime(now, client.timezone);
  const days = client.settings.sendDays ?? "every";
  if (days === "mon_sat" && weekday === 0) return false;
  if (days === "weekdays" && (weekday === 0 || weekday === 6)) return false;
  if (client.country && FRENCH_RULES.has(client.country.toUpperCase()) && hour === 13) return false;
  const { quietStart, quietEnd } = client.settings;
  return quietStart <= quietEnd ? hour >= quietStart && hour < quietEnd : hour >= quietStart || hour < quietEnd;
}

/**
 * What a service may do on its own: nothing (off or paused), draft messages
 * for a person to check (setup, or live with approvals on), or send them.
 */
export function automation(client: Pick<Client, "services" | "settings">, service: ServiceId): "off" | "draft" | "send" {
  const s = client.services[service];
  if (!s || !s.included) return "off";
  if (s.status === "live") return client.settings.autoSend ? "send" : "draft";
  if (s.status === "setup") return "draft";
  return "off";
}

export type Gate = { ok: true } | { ok: false; reason: string };

/** Purposes that answer something the contact did (texted, called, filled in a form), not marketing. */
const RESPONSIVE: MsgPurpose[] = ["reply", "missed_call", "opt_out", "manual"];

/**
 * May this contact get this message on this channel? Marketing (win-back,
 * reviews, referrals, follow-ups) needs consent for the channel; answering
 * someone who just reached out needs only a way to reach them.
 */
export function canMessage(contact: Contact, channel: MsgChannel, purpose: MsgPurpose): Gate {
  if (contact.status === "opted_out" || contact.optedOutAt) return purpose === "opt_out" ? { ok: true } : { ok: false, reason: "Opted out" };
  if (channel === "email") {
    if (!contact.email) return { ok: false, reason: "No email address" };
    if (RESPONSIVE.includes(purpose) || contact.consent.email) return { ok: true };
    return { ok: false, reason: "No permission to email" };
  }
  if (!contact.phone) return { ok: false, reason: "No phone number" };
  // Answering what they asked for is fine by text; scheduled follow-ups and
  // campaigns need their permission to be texted (else email, or nothing).
  if (RESPONSIVE.includes(purpose) || contact.consent.sms) return { ok: true };
  return { ok: false, reason: "No permission to text" };
}

/** The channel to use: texting when allowed (WhatsApp where the client uses it), else email. */
export function pickChannel(contact: Contact, purpose: MsgPurpose, client: Pick<Client, "settings" | "whatsappNumber">): MsgChannel | undefined {
  const textChannel: MsgChannel = client.settings.whatsapp && client.whatsappNumber ? "whatsapp" : "sms";
  if (canMessage(contact, textChannel, purpose).ok) return textChannel;
  if (canMessage(contact, "email", purpose).ok) return "email";
  return undefined;
}

// ── Placeholders ──────────────────────────────────────────────

export const PLACEHOLDERS = ["first_name", "name", "business", "review_link", "referral_link", "booking_link", "site_link", "offer", "phone"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/**
 * Fill {first_name}, {business}, {review_link}… An empty value removes the
 * word for names ("Hi {first_name}," → "Hi,"), but a missing link or offer
 * is reported so the message waits for a person instead of going out broken.
 */
export function render(template: string, vars: Partial<Record<Placeholder, string>>): { text: string; missing: Placeholder[] } {
  const missing = new Set<Placeholder>();
  let text = template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!(PLACEHOLDERS as readonly string[]).includes(key)) return whole;
    const v = vars[key as Placeholder]?.trim();
    if (v) return v;
    if (key === "first_name" || key === "name") return "";
    missing.add(key as Placeholder);
    return whole;
  });
  text = text.replace(/ +([,.!?])/g, "$1").replace(/(^|\n)[ \t]+/g, "$1").replace(/[ \t]{2,}/g, " ");
  return { text: text.trim(), missing: [...missing] };
}

export function firstName(name: string | undefined): string {
  const n = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}'-]{2,}$/u.test(n) ? n.charAt(0).toUpperCase() + n.slice(1) : "";
}

// ── SMS length ────────────────────────────────────────────────

const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";

/** How many SMS segments a text takes: accents outside the GSM alphabet (á, í, ó, ú, ç…) halve the room per segment. */
export function smsSegments(text: string): { segments: number; unicode: boolean; chars: number } {
  let units = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM.includes(ch)) units += 1;
    else if (GSM_EXT.includes(ch)) units += 2;
    else unicode = true;
  }
  const chars = [...text].length;
  if (unicode) return { segments: chars <= 70 ? 1 : Math.ceil(chars / 67), unicode, chars };
  return { segments: units <= 160 ? 1 : Math.ceil(units / 153), unicode, chars };
}
