import { DEFAULT_ATLAS_AGENT_ID, eleven as cfg, features, publicBase } from "../config.ts";
import { getSettings, kvGet } from "../db.ts";
import { log } from "../events.ts";
import { errorMessage, fetchWithTimeout } from "../util.ts";
import { callOwner, elevenEnabled } from "./eleven.ts";
import { sendEmail } from "./email.ts";

// How the crew reaches you. Push (ntfy.sh, free, iPhone and Android) for
// anything worth knowing, email for important things, and — for the two
// things that should wake you up — a phone call from Atlas, if you turn it on.

export interface OwnerNotice {
  title: string;
  body: string;
  priority?: "low" | "default" | "high" | "urgent";
  path?: string; // dashboard path to open, e.g. "#/approvals"
  tags?: string[];
  call?: { reason: string }; // ask Atlas to phone you about this
  dedupeKey?: string;
}

const recent = new Map<string, number>();

export async function notifyOwner(n: OwnerNotice): Promise<void> {
  const key = n.dedupeKey ?? `${n.title}|${n.body}`;
  const last = recent.get(key);
  if (last && Date.now() - last < 30 * 60_000) return;
  recent.set(key, Date.now());

  const s = getSettings();
  const url = `${publicBase()}/${n.path ?? ""}`;
  const jobs: Promise<unknown>[] = [];

  if (s.escalation.ntfyTopic) {
    const prio = { low: "2", default: "3", high: "4", urgent: "5" }[n.priority ?? "default"];
    jobs.push(
      fetchWithTimeout(`https://ntfy.sh/${encodeURIComponent(s.escalation.ntfyTopic)}`, {
        method: "POST",
        body: n.body,
        headers: { Title: n.title.replace(/[^\x20-\x7e]/g, ""), Priority: prio, Tags: (n.tags ?? []).join(","), Click: url },
        timeoutMs: 10_000,
      }).catch((err) => log("system", `Push notification failed: ${errorMessage(err)}`, { level: "warn" })),
    );
  }

  if ((n.priority === "high" || n.priority === "urgent") && features.resend && s.owner.email) {
    jobs.push(
      sendEmail({ to: s.owner.email, subject: `[Mainstreet] ${n.title}`, text: `${n.body}\n\nOpen: ${url}`, agent: "orchestrator" }).catch((err) =>
        log("system", `Alert email failed: ${errorMessage(err)}`, { level: "warn" }),
      ),
    );
  }

  if (n.call && s.escalation.callOwner) {
    const agentId = cfg.agentId ?? kvGet<{ agentId?: string }>("voice_agent")?.agentId ?? DEFAULT_ATLAS_AGENT_ID;
    const callKey = "call";
    const lastCall = recent.get(callKey);
    if (!elevenEnabled() || !agentId || !cfg.phoneNumberId || !s.owner.phone) {
      log("orchestrator", "Wanted to call you, but calling needs ELEVENLABS_PHONE_NUMBER_ID, your phone in Settings and Atlas synced.", { level: "warn" });
    } else if (!lastCall || Date.now() - lastCall > 60 * 60_000) {
      recent.set(callKey, Date.now());
      jobs.push(
        callOwner({
          agentId,
          phoneNumberId: cfg.phoneNumberId,
          to: s.owner.phone,
          firstMessage: `Hey ${s.owner.name || "there"}, it's Atlas. ${n.call.reason} Do you want to deal with it now?`,
          dynamicVariables: { owner_name: s.owner.name || "there", agency_name: s.owner.agencyName, call_reason: n.call.reason, briefing: n.body, session_key: "phone" },
        })
          .then(() => log("orchestrator", `Called you about: ${n.call!.reason}`))
          .catch((err) => log("orchestrator", `Couldn't call you: ${errorMessage(err)}`, { level: "warn" })),
      );
    }
  }
  await Promise.all(jobs);
}
