import { logCall } from "@/lib/clients/engine";
import { clientByNumber } from "@/lib/clients/repo";
import { readTwilioRequest } from "@/lib/clients/twilio";

// Twilio: a call to a client's number ended. Records how long it lasted.

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { params, valid } = await readTwilioRequest(req);
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const client = await clientByNumber(params.To ?? "");
  if (client && params.CallSid && params.CallStatus === "completed") {
    // Only adds the length to the call the flow already logged; never creates one.
    await logCall(client, { sid: params.CallSid, from: params.From, outcome: "missed", durationSec: Number(params.CallDuration) || undefined }, { create: false }).catch(() => undefined);
  }
  return new Response(null, { status: 204 });
}
