import "server-only";
import { siteUrlFrom } from "@/lib/site";
import { candidateUrls, validTwilioSignature } from "./twilio-core";

// Texts and calls for clients go through the agency's own Twilio account:
// one local number per client (A2P 10DLC registration in the US, CASL rules
// in Canada), plus an optional WhatsApp sender. REST calls use the account
// SID and auth token; no SDK.

const API = "https://api.twilio.com/2010-04-01";

export function twilioEnabled(): boolean {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

export class TwilioError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: number
  ) {
    super(message);
  }
}

/** One sentence a person can act on, for the error codes people hit most. */
function explain(code: number | undefined, message: string | undefined, status: number): string {
  switch (code) {
    case 21610:
      return "This person texted STOP to this number, so Twilio won't deliver to them.";
    case 21211:
      return "Twilio says the recipient's number isn't valid.";
    case 21408:
      return "Your Twilio account isn't allowed to text this country. Turn it on in Twilio → Messaging → Settings → Geo permissions.";
    case 21606:
    case 21212:
      return "The client's number can't send texts. Use an SMS-capable Twilio number.";
    case 30034:
    case 30007:
      return "Carriers blocked the text. In the US, register the number for A2P 10DLC in Twilio first.";
    case 63016:
      return "WhatsApp only allows free-form messages within 24 hours of the customer's last message. Use an approved template, or text them instead.";
    case 20003:
      return "Twilio rejected the account SID or auth token.";
  }
  if (status === 401) return "Twilio rejected the account SID or auth token.";
  return `Twilio: ${message ?? `error ${status}`}`;
}

async function twilio<T>(method: "GET" | "POST", path: string, form?: Record<string, string>): Promise<T> {
  if (!twilioEnabled()) throw new TwilioError("Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to send texts and answer calls", 400);
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const res = await fetch(`${API}/Accounts/${sid}${path}`, {
    method,
    headers: { authorization: `Basic ${auth}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { code?: number; message?: string };
  if (!res.ok) throw new TwilioError(explain(data.code, data.message, res.status), res.status, data.code);
  return data;
}

export async function sendText(input: { from: string; to: string; body: string; whatsapp?: boolean; statusCallback?: string }): Promise<{ sid: string }> {
  const wa = (n: string) => (input.whatsapp ? `whatsapp:${n}` : n);
  const msg = await twilio<{ sid: string }>("POST", "/Messages.json", {
    From: wa(input.from),
    To: wa(input.to),
    Body: input.body.slice(0, 1600),
    ...(input.statusCallback ? { StatusCallback: input.statusCallback } : {}),
  });
  return { sid: msg.sid };
}

interface IncomingNumber {
  sid: string;
  phone_number: string;
  sms_url?: string;
  voice_url?: string;
  capabilities?: { sms?: boolean; voice?: boolean; mms?: boolean };
}

/** Point a Twilio number's texts and calls at this deployment. */
export async function connectNumber(number: string, base: string): Promise<{ sid: string; sms: boolean; voice: boolean }> {
  const list = await twilio<{ incoming_phone_numbers: IncomingNumber[] }>("GET", `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(number)}`);
  const found = list.incoming_phone_numbers[0];
  if (!found) throw new TwilioError(`${number} isn't a number on this Twilio account. Buy it in Twilio (Phone Numbers → Buy a number) first.`, 404);
  await twilio("POST", `/IncomingPhoneNumbers/${found.sid}.json`, {
    SmsUrl: `${base}/api/twilio/sms`,
    SmsMethod: "POST",
    VoiceUrl: `${base}/api/twilio/voice`,
    VoiceMethod: "POST",
    StatusCallback: `${base}/api/twilio/voice/status`,
    StatusCallbackMethod: "POST",
  });
  return { sid: found.sid, sms: found.capabilities?.sms !== false, voice: found.capabilities?.voice !== false };
}

/** Read a Twilio webhook: its form fields, and whether the signature checks out. */
export async function readTwilioRequest(req: Request): Promise<{ params: Record<string, string>; valid: boolean }> {
  const text = await req.text();
  const params: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) params[k] = v;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return { params, valid: false };
  const u = new URL(req.url);
  const url = `${siteUrlFrom(req.headers, req.url)}${u.pathname}${u.search}`;
  const header = req.headers.get("x-twilio-signature");
  const valid = candidateUrls(url).some((candidate) => validTwilioSignature(token, candidate, params, header));
  return { params, valid };
}

/** TwiML responses. */
export function twimlResponse(xml: string, status = 200): Response {
  return new Response(xml, { status, headers: { "content-type": "text/xml; charset=utf-8", "cache-control": "no-store" } });
}
