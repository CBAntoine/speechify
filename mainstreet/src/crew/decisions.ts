import { decideApproval, getApproval, getLead, getSettings, kvGet, kvSet, updateLead, updateMessage } from "../db.ts";
import { leadChanged, log } from "../events.ts";
import type { Approval } from "../types.ts";
import { localDate, money } from "../util.ts";
import { applyStrategy } from "./orchestrator.ts";
import { nextSendSlot, sendMessage } from "./pitcher.ts";

// What happens when you approve or reject something, whether you tap it in
// the dashboard, say it to Atlas or call it over MCP.

export async function applyDecision(id: string, decision: "approve" | "reject", via: string, note?: string): Promise<{ ok: boolean; say: string }> {
  const a = getApproval(id);
  if (!a) return { ok: false, say: "I couldn't find that decision. It may have been handled already." };
  if (a.status !== "pending") return { ok: false, say: `That one was already ${a.status}.` };
  const payload = (a.payload ?? {}) as { messageId?: string; changes?: { path: string; value: unknown }[] };
  const lead = a.leadId ? getLead(a.leadId) : undefined;
  const approve = decision === "approve";
  decideApproval(a.id, approve ? "approved" : "rejected", via);
  const who = lead ? { lead } : {};
  let say = "";

  switch (a.kind) {
    case "pitch": {
      if (approve && payload.messageId) {
        updateMessage(payload.messageId, { status: "queued", sendAfter: nextSendSlot() });
        say = `Approved. The pitch to ${lead?.name} goes out in the next send slot.`;
      } else {
        if (payload.messageId) updateMessage(payload.messageId, { status: "discarded", error: "You passed on this one" });
        if (lead) leadChanged(updateLead(lead.id, (l) => ((l.status = "skipped"), (l.skipReason = note || "You passed on this one")))!);
        say = `Okay, skipped ${lead?.name ?? "it"}.`;
      }
      break;
    }
    case "reply": {
      if (approve && payload.messageId) {
        const r = await sendMessage(payload.messageId, { force: true });
        say = r.ok ? `Sent the reply to ${lead?.name}.` : `I approved it but sending failed: ${r.error}`;
      } else {
        if (payload.messageId) updateMessage(payload.messageId, { status: "discarded", error: "You rejected this draft" });
        say = `Okay, I won't send that reply. You can ask me to draft a different one.`;
      }
      break;
    }
    case "deal": {
      if (approve) {
        if (lead && a.amountCents) updateLead(lead.id, (l) => (l.dealValueCents = a.amountCents));
        const r = payload.messageId ? await sendMessage(payload.messageId, { force: true }) : { ok: true };
        say = `Approved the ${money(a.amountCents, getSettings().offer.currency)} deal with ${lead?.name}.${payload.messageId ? (r.ok ? " The reply with the next steps went out." : ` The reply didn't send: ${"error" in r ? r.error : ""}`) : ""}`;
      } else {
        if (lead) updateLead(lead.id, (l) => (l.dealValueCents = undefined));
        if (payload.messageId) updateMessage(payload.messageId, { status: "discarded", error: "Deal rejected" });
        say = `Okay. The crew won't quote the bigger project for ${lead?.name}; it's yours to handle.`;
      }
      break;
    }
    case "spend": {
      if (approve) {
        const key = `budget_bump:${localDate(getSettings().owner.timezone)}`;
        kvSet(key, (kvGet<number>(key) ?? 0) + (a.amountCents ?? 1000) / 100);
        say = `Raised today's budget by ${money(a.amountCents ?? 1000)}. Paid work resumes now.`;
      } else say = "Okay, paid work stays paused until tomorrow.";
      break;
    }
    case "strategy": {
      if (approve && payload.changes?.length) {
        applyStrategy(payload.changes);
        say = `Applied ${payload.changes.length} change${payload.changes.length === 1 ? "" : "s"} to the plan.`;
      } else say = "Okay, keeping the current plan.";
      break;
    }
  }
  log("owner", `${approve ? "Approved" : "Rejected"}: ${a.title.replace(/[?.!\s]+$/, "")}${note ? ` (${note})` : ""}, via ${via}`, { ...who, level: approve ? "success" : "info" });
  return { ok: true, say };
}

export function describeApproval(a: Approval, i?: number): string {
  return `${i !== undefined ? `${i + 1}. ` : ""}${a.title.replace(/[?.!\s]+$/, "")}${a.amountCents && !a.title.includes("$") ? ` (${money(a.amountCents)})` : ""}`;
}
