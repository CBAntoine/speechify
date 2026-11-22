// Twilio pieces with no network: checking that a webhook really came from
// Twilio, and writing the TwiML that tells a call what to do. Pure (Node's
// crypto only), so it's unit tested.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Lang } from "../markets.ts";

/**
 * Twilio signs each webhook: HMAC-SHA1, keyed with the auth token, of the
 * full URL it called followed by every POST parameter (sorted by name) as
 * name+value, base64 encoded. https://www.twilio.com/docs/usage/security
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, header: string | null | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * The URL forms Twilio may have signed. Twilio signs the exact URL it was
 * configured with, which may or may not spell out the default port, so try
 * both. (new URL() drops default ports, so this works on the string.)
 */
export function candidateUrls(url: string): string[] {
  const out = new Set([url]);
  const m = url.match(/^(https?):\/\/([^/:?#]+)(:\d+)?(.*)$/i);
  if (m) {
    const [, scheme, host, port, rest] = m;
    const def = scheme.toLowerCase() === "https" ? ":443" : ":80";
    if (port === def) out.add(`${scheme}://${host}${rest}`);
    if (!port) out.add(`${scheme}://${host}${def}${rest}`);
  }
  return [...out];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function twiml(...verbs: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${verbs.join("")}</Response>`;
}

/** The language a <Say> should speak for a client: "es-MX", "fr-CA", "en-US"… */
export function sayLanguage(lang: Lang, country: string): string {
  const c = country.toUpperCase();
  if (lang === "es") return c === "US" || c === "PR" ? "es-US" : "es-MX";
  if (lang === "fr") return c === "CA" ? "fr-CA" : "fr-FR";
  if (lang === "nl") return "nl-NL";
  if (lang === "da") return "da-DK";
  return c === "CA" ? "en-CA" : "en-US";
}

export function say(text: string, language: string): string {
  return `<Say language="${esc(language)}">${esc(text)}</Say>`;
}

export function dial(numbers: string[], opts: { timeout: number; action: string; callerId?: string }): string {
  const attrs = [`timeout="${Math.max(5, Math.min(60, Math.round(opts.timeout)))}"`, `action="${esc(opts.action)}"`, `method="POST"`, `answerOnBridge="true"`];
  if (opts.callerId) attrs.push(`callerId="${esc(opts.callerId)}"`);
  return `<Dial ${attrs.join(" ")}>${numbers.map((n) => `<Number>${esc(n)}</Number>`).join("")}</Dial>`;
}

export const hangup = () => "<Hangup/>";

export function pause(seconds: number): string {
  return `<Pause length="${Math.max(1, Math.min(10, Math.round(seconds)))}"/>`;
}

/** Statuses a <Dial> ends with when nobody picked up. */
export function unanswered(dialCallStatus: string | undefined): boolean {
  return ["no-answer", "busy", "failed", "canceled"].includes((dialCallStatus ?? "").toLowerCase());
}

/** What the caller hears when nobody (and no AI) can take the call. */
export function missedLine(lang: Lang): string {
  if (lang === "es") return "Lo sentimos, no podemos atender en este momento. Le enviaremos un mensaje de texto enseguida.";
  if (lang === "fr") return "Désolés, nous ne pouvons pas répondre pour le moment. Nous vous envoyons un texto tout de suite.";
  return "Sorry we can't take your call right now. We'll text you right away.";
}
