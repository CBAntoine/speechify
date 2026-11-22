import { describeError } from "@/lib/claude/client";
import { elevenEnabled } from "@/lib/config";
import { handleMissedCall } from "@/lib/clients/engine";
import { getClient, patchClient } from "@/lib/clients/repo";
import { connectNumber, twilioEnabled } from "@/lib/clients/twilio";
import { preparePhoneAgent } from "@/lib/elevenlabs/phone";
import { agentDashboardUrl, createReceptionist, promoteToClient } from "@/lib/elevenlabs/receptionist";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { toE164 } from "@/lib/phone";
import { getProfile } from "@/lib/repo";
import { siteUrl } from "@/lib/site";
import { readDb } from "@/lib/store";

export const maxDuration = 120;

/**
 * { action: "connect_number" }: point the client's Twilio number at this app.
 * { action: "build_agent" }: build their voice agent from their website (or
 *   promote the demo they tried) and set it up for phone audio.
 * { action: "phone_ready" }: set an existing agent to phone audio.
 * { action: "simulate", from? }: try a missed call without a phone.
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const client = await getClient(id);
  if (!client) throw new HttpError(404, "Client not found");
  const b = await readBody<{ action?: string; from?: string }>(req);
  const base = siteUrl(req);

  switch (b.action) {
    case "connect_number": {
      if (!twilioEnabled()) throw new HttpError(400, "Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN to your hosting's environment variables first");
      if (!client.smsNumber) throw new HttpError(400, "Enter the client's Twilio number first");
      if (/^http:\/\/(localhost|127\.)/.test(base)) throw new HttpError(400, "Twilio can only reach a public https address. Deploy the app (or use a tunnel) and press this there.");
      try {
        const r = await connectNumber(client.smsNumber, base);
        return Response.json({ ok: true, ...r, message: `${client.smsNumber} now sends texts and calls to Rainmaker.` });
      } catch (err) {
        throw new HttpError(400, describeError(err));
      }
    }
    case "build_agent": {
      if (!elevenEnabled()) throw new HttpError(400, "Add ELEVENLABS_API_KEY to build voice agents");
      const profile = await getProfile();
      const lead = client.leadId ? (await readDb()).leads.find((l) => l.id === client.leadId) : undefined;
      const facts = {
        business: client.name,
        niche: client.niche,
        city: client.place,
        address: client.address,
        phone: client.phone,
        email: client.email,
        website: client.site?.published ? `${base}/s/${client.site.slug}` : client.website,
        audit: client.audit,
        agencyName: profile.agencyName,
        lang: client.lang,
      };
      try {
        let agentId = client.agentId;
        if (!agentId && lead?.demo?.agentId) {
          await promoteToClient(lead.demo.agentId, facts);
          agentId = lead.demo.agentId;
        }
        agentId ??= (await createReceptionist(facts, "client", [client.niche])).agentId;
        await preparePhoneAgent(agentId);
        const saved = await patchClient(id, (c) => {
          c.agentId = agentId;
          if (c.services.missed_calls.status === "off") c.services.missed_calls = { ...c.services.missed_calls, status: "setup", since: new Date().toISOString() };
        });
        return Response.json({ client: saved, url: agentDashboardUrl(agentId) });
      } catch (err) {
        throw new HttpError(502, describeError(err));
      }
    }
    case "phone_ready": {
      if (!client.agentId) throw new HttpError(400, "Enter or build the agent first");
      try {
        await preparePhoneAgent(client.agentId);
      } catch (err) {
        throw new HttpError(502, describeError(err));
      }
      return Response.json({ ok: true });
    }
    case "simulate": {
      const from = toE164(b.from || "", client.country) ?? (client.country === "MX" ? "+525555550100" : "+14155550100");
      const messages = await handleMissedCall(client, { from, sid: `SIM${Date.now()}` }, { base });
      return Response.json({ ok: true, from, messages });
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
});
