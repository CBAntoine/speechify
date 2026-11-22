import "server-only";
import { randomBytes } from "node:crypto";
import { addActivity, getLead, getProfile } from "@/lib/repo";
import { readDb, update } from "@/lib/store";
import type { DemoAgent, Lead } from "@/lib/types";
import { createReceptionist, deleteAgent } from "./receptionist";

// A demo AI receptionist for a prospect: built from their website, reachable
// only through a private link (/demo/<token>) that goes in the outreach.
// Each link gets a daily allowance so a forwarded link can't run up a bill.

export const DEMO_SESSIONS_PER_DAY = Number(process.env.DEMO_SESSIONS_PER_DAY || 12);

export async function buildDemo(leadId: string, createdBy = "user"): Promise<DemoAgent> {
  const lead = await getLead(leadId);
  if (!lead) throw new Error("Lead not found");
  if (lead.demo) return lead.demo;
  const profile = await getProfile();
  const { agentId, knowledgeBaseId } = await createReceptionist(
    { business: lead.name, niche: lead.niche, city: lead.city, address: lead.address, phone: lead.phone, email: lead.email, website: lead.website, audit: lead.audit, agencyName: profile.agencyName },
    "demo",
    [lead.niche]
  );
  const demo: DemoAgent = { agentId, knowledgeBaseId, token: randomBytes(12).toString("base64url"), createdAt: new Date().toISOString() };
  const saved = await update((db) => {
    const l = db.leads.find((x) => x.id === leadId);
    if (!l) return undefined;
    if (l.demo) return l.demo; // someone else built one meanwhile
    l.demo = demo;
    l.updatedAt = new Date().toISOString();
    return demo;
  });
  if (saved && saved.agentId !== agentId) await deleteAgent(agentId).catch(() => undefined);
  if (!saved) {
    await deleteAgent(agentId).catch(() => undefined);
    throw new Error("Lead was deleted");
  }
  await addActivity({ kind: "lead", text: `${createdBy.startsWith("agent:") ? "Autopilot" : "You"} built a demo AI receptionist for ${lead.name}`, leadId });
  return saved;
}

export async function removeDemo(leadId: string): Promise<void> {
  const lead = await getLead(leadId);
  if (!lead?.demo) return;
  // Never delete an agent a paying client now relies on.
  if (lead.clientAgentId !== lead.demo.agentId) await deleteAgent(lead.demo.agentId);
  await update((db) => {
    const l = db.leads.find((x) => x.id === leadId);
    if (l) delete l.demo;
  });
}

export async function leadByDemoToken(token: string): Promise<Lead | undefined> {
  if (!/^[A-Za-z0-9_-]{10,40}$/.test(token)) return undefined;
  return (await readDb()).leads.find((l) => l.demo?.token === token);
}

/** Count one demo session against today's allowance. False when it's used up. */
export async function useDemoSession(leadId: string): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10);
  return update((db) => {
    const l = db.leads.find((x) => x.id === leadId);
    if (!l?.demo) return false;
    const usage = l.demo.usage?.day === day ? l.demo.usage : { day, sessions: 0 };
    if (usage.sessions >= DEMO_SESSIONS_PER_DAY) return false;
    l.demo.usage = { day, sessions: usage.sessions + 1 };
    return true;
  });
}

export function demoPath(token: string): string {
  return `/demo/${token}`;
}
