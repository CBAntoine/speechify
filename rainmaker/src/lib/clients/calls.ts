import "server-only";
import { after } from "next/server";
import { describeError } from "@/lib/claude/client";
import { elevenEnabled } from "@/lib/config";
import { registerTwilioCall } from "@/lib/elevenlabs/phone";
import type { Client } from "@/lib/types";
import { handleMissedCall, logCall, type Ctx } from "./engine";
import { automation } from "./rules";
import { dial, hangup, missedLine, say, sayLanguage, twiml } from "./twilio-core";

// Step 5 on the phone line. A call to the client's number either rings their
// staff first (ring_first) or arrives because the business forwarded a call
// nobody picked up (forwarded). Unanswered calls go to the client's voice
// agent; without one, the caller hears a short apology and gets a text back.

export interface CallParams {
  sid?: string;
  from: string;
  to: string;
}

/** TwiML for a call that needs answering by the AI, or the missed-call fallback. */
export async function answerUnanswered(client: Client, call: CallParams, ctx: Ctx): Promise<string> {
  const mode = automation(client, "missed_calls");
  if (mode !== "off" && client.agentId && elevenEnabled()) {
    try {
      const xml = await registerTwilioCall({
        agentId: client.agentId,
        from: call.from,
        to: call.to,
        variables: { business: client.name, caller_number: call.from },
      });
      after(() => logCall(client, { sid: call.sid, from: call.from, outcome: "ai" }));
      return xml;
    } catch (err) {
      console.error(`[rainmaker] ${client.name}: the AI couldn't take the call`, describeError(err));
    }
  }
  after(() => handleMissedCall(client, { from: call.from, sid: call.sid }, ctx).then(() => undefined));
  return twiml(say(missedLine(client.lang), sayLanguage(client.lang, client.country)), hangup());
}

/** The first TwiML for a call to the client's number. */
export async function incomingCall(client: Client, call: CallParams, ctx: Ctx): Promise<string> {
  if (client.settings.callFlow === "ring_first" && client.staffPhone && client.staffPhone !== call.to) {
    return twiml(dial([client.staffPhone], { timeout: client.settings.ringSeconds, action: `${ctx.base}/api/twilio/voice/after`, callerId: call.from }));
  }
  return answerUnanswered(client, call, ctx);
}
