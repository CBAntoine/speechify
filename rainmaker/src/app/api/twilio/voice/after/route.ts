import { after } from "next/server";
import { answerUnanswered } from "@/lib/clients/calls";
import { logCall } from "@/lib/clients/engine";
import { clientByNumber } from "@/lib/clients/repo";
import { readTwilioRequest, twimlResponse } from "@/lib/clients/twilio";
import { hangup, twiml, unanswered } from "@/lib/clients/twilio-core";
import { siteUrl } from "@/lib/site";

// Twilio: the staff phone finished ringing. Picked up: done. Not picked up:
// the voice agent takes the call, or the caller gets a text back.

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { params, valid } = await readTwilioRequest(req);
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const client = await clientByNumber(params.To ?? "");
  if (!client || !params.From) return twimlResponse(twiml(hangup()));
  if (!unanswered(params.DialCallStatus)) {
    after(() => logCall(client, { sid: params.CallSid, from: params.From, outcome: "answered", durationSec: Number(params.DialCallDuration) || undefined }));
    return twimlResponse(twiml(hangup()));
  }
  return twimlResponse(await answerUnanswered(client, { sid: params.CallSid, from: params.From, to: params.To }, { base: siteUrl(req) }));
}
