import { incomingCall } from "@/lib/clients/calls";
import { clientByNumber } from "@/lib/clients/repo";
import { readTwilioRequest, twimlResponse } from "@/lib/clients/twilio";
import { hangup, twiml } from "@/lib/clients/twilio-core";
import { siteUrl } from "@/lib/site";

// Twilio: a call to one of the clients' numbers (step 5). Rings their staff
// first, or goes straight to their voice agent for forwarded calls.

export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { params, valid } = await readTwilioRequest(req);
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const client = await clientByNumber(params.To ?? "");
  if (!client || !params.From) return twimlResponse(twiml(hangup()));
  return twimlResponse(await incomingCall(client, { sid: params.CallSid, from: params.From, to: params.To }, { base: siteUrl(req) }));
}
