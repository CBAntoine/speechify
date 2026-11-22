import { after } from "next/server";
import { handleInboundText, processDue } from "@/lib/clients/engine";
import { clientByNumber } from "@/lib/clients/repo";
import { readTwilioRequest, twimlResponse } from "@/lib/clients/twilio";
import { twiml } from "@/lib/clients/twilio-core";
import { siteUrl } from "@/lib/site";

// Twilio: a text (or WhatsApp message) to one of the clients' numbers. The
// reply is written and sent after Twilio gets its answer, so a slow AI reply
// never times the webhook out.

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { params, valid } = await readTwilioRequest(req);
  if (!valid) return new Response("Invalid signature", { status: 403 });
  const client = await clientByNumber(params.To ?? "");
  if (!client || !params.From) return twimlResponse(twiml());
  const base = siteUrl(req);
  after(async () => {
    try {
      await handleInboundText(client, { from: params.From, body: params.Body ?? "", channel: params.From.startsWith("whatsapp:") ? "whatsapp" : "sms", sid: params.MessageSid ?? params.SmsSid }, { base });
      await processDue(client.id, { base });
    } catch (err) {
      console.error(`[rainmaker] inbound text for ${client.name}`, err);
    }
  });
  return twimlResponse(twiml());
}
