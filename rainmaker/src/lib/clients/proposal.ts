import "server-only";
import { randomBytes } from "node:crypto";
import { addActivity } from "@/lib/repo";
import { marketOf } from "@/lib/regions";
import { readDb, update } from "@/lib/store";
import type { Lead, Proposal, ServiceId } from "@/lib/types";
import { quote } from "./pricing";
import { placeForLead } from "./repo";
import { SERVICE_IDS } from "./services";

// Outcome proposals: for a prospect in the pipeline, the services they need
// in deployment order, what people doing the same work would cost in their
// market, and the price. Shared as a private link (/proposal/<token>), in
// their language, payable by card or PayPal.

export async function createProposal(leadId: string, input: { services?: ServiceId[]; monthly?: number; setup?: number } = {}): Promise<{ proposal: Proposal; lead: Lead }> {
  const db = await readDb();
  const lead = db.leads.find((l) => l.id === leadId);
  if (!lead) throw new Error("Lead not found");
  const place = placeForLead(lead, db.profile.city);
  const market = marketOf(place, marketOf(db.profile.city, "US").country.code);
  const services = input.services?.filter((s) => SERVICE_IDS.includes(s)) ?? [...SERVICE_IDS];
  if (!services.length) throw new Error("Pick at least one service");
  const q = quote(market.country.code, services);
  const proposal: Proposal = {
    token: lead.proposal?.token ?? randomBytes(12).toString("base64url"),
    createdAt: new Date().toISOString(),
    services,
    place,
    lang: market.lang,
    currency: q.currency,
    monthly: input.monthly !== undefined && Number.isFinite(input.monthly) && input.monthly > 0 ? Math.round(input.monthly) : q.monthly,
    setup: input.setup !== undefined && Number.isFinite(input.setup) && input.setup >= 0 ? Math.round(input.setup) : q.setup,
    humanMonthly: q.humanMonthly,
  };
  const saved = await update((d) => {
    const l = d.leads.find((x) => x.id === leadId);
    if (!l) throw new Error("Lead not found");
    l.proposal = proposal;
    if (["new", "contacted", "replied", "meeting"].includes(l.stage)) l.stage = "proposal";
    l.nextStep = "Follow up on the proposal";
    l.updatedAt = new Date().toISOString();
    return structuredClone(l);
  });
  await addActivity({ kind: "stage", text: `Proposal ready for ${saved.name}`, leadId });
  return { proposal, lead: saved };
}

export async function removeProposal(leadId: string): Promise<void> {
  await update((d) => {
    const l = d.leads.find((x) => x.id === leadId);
    if (l) delete l.proposal;
  });
}

export async function leadByProposal(token: string): Promise<Lead | undefined> {
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(token)) return undefined;
  return (await readDb()).leads.find((l) => l.proposal?.token === token);
}

/**
 * The prospect said yes without paying online (no card or PayPal for their
 * currency, or none set up): record it, with how to reach them, so the agency
 * invoices them and opens their workspace. Returns undefined for an unknown link.
 */
export async function acceptProposal(token: string, buyer: { email: string; name?: string; phone?: string }): Promise<{ lead: Lead; first: boolean } | undefined> {
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(token)) return undefined;
  return update((d) => {
    const l = d.leads.find((x) => x.proposal?.token === token);
    if (!l?.proposal) return undefined;
    const at = new Date().toISOString();
    const first = !l.proposal.acceptedAt;
    l.proposal.acceptedAt = at;
    if (buyer.name && !l.contactName) l.contactName = buyer.name;
    if (!l.email) l.email = buyer.email;
    if (buyer.phone && !l.phone) l.phone = buyer.phone;
    l.nextStep = "They accepted: send the invoice, then make them a client";
    l.updatedAt = at;
    if (first) d.activity.unshift({ id: `act_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`, at, kind: "stage", text: `${l.name} accepted their proposal`, leadId: l.id });
    return { lead: structuredClone(l), first };
  });
}

/** Count a view (the agency sees when a prospect opened it). */
export async function proposalViewed(token: string): Promise<void> {
  await update((d) => {
    const l = d.leads.find((x) => x.proposal?.token === token);
    if (!l?.proposal) return;
    const first = !l.proposal.viewedAt;
    l.proposal.views = (l.proposal.views ?? 0) + 1;
    l.proposal.viewedAt = new Date().toISOString();
    if (first) d.activity.unshift({ id: `act_${Date.now().toString(36)}${randomBytes(3).toString("hex")}`, at: new Date().toISOString(), kind: "lead", text: `${l.name} opened their proposal`, leadId: l.id });
  }).catch(() => undefined);
}
