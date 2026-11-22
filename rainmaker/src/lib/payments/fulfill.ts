import "server-only";
import type { Offer } from "@/lib/catalog";
import { clientFromLead } from "@/lib/clients/repo";
import { buildSite } from "@/lib/clients/site";
import { offerForOrder } from "@/lib/clients/team-offer";
import { generateCampaign, templateCampaign, toCampaign, type AdBrief } from "@/lib/claude/ads";
import { describeError } from "@/lib/claude/client";
import { claudeEnabled, elevenEnabled, resendEnabled } from "@/lib/config";
import { artPrompt, generateArt } from "@/lib/elevenlabs/art";
import { agentDashboardUrl, createReceptionist, promoteToClient, type BusinessFacts } from "@/lib/elevenlabs/receptionist";
import { sendEmail } from "@/lib/email";
import { addActivity, createTask, getLead, getProfile, patchCampaign, saveCampaign } from "@/lib/repo";
import { readDb, update } from "@/lib/store";
import type { AgencyProfile, FulfillmentStep, Lead, Order } from "@/lib/types";
import { onboardingTasks, plannedSteps } from "./steps";

// Onboarding that runs by itself once an order is paid. Each step records
// its result on the order as it finishes; a failed step can be retried from
// the Sales screen without redoing the ones that worked.

const now = () => new Date().toISOString();
const STALE_MS = 10 * 60_000;

type StepResult = Pick<FulfillmentStep, "status" | "detail">;

function facts(order: Order, lead: Lead | undefined, profile: AgencyProfile): BusinessFacts {
  return {
    business: order.business || lead?.name || "Your business",
    niche: lead?.niche,
    city: lead?.city,
    address: lead?.address,
    phone: order.phone ?? lead?.phone,
    email: order.email ?? lead?.email,
    website: order.website ?? lead?.website,
    audit: lead?.audit,
    agencyName: profile.agencyName,
  };
}

async function agentStep(order: Order, lead: Lead | undefined, profile: AgencyProfile): Promise<StepResult> {
  if (lead?.clientAgentId) return { status: "done", detail: `Agent ready: ${agentDashboardUrl(lead.clientAgentId)}` };
  if (!elevenEnabled()) return { status: "skipped", detail: "Add ELEVENLABS_API_KEY to build client agents automatically. Until then, build it in ElevenLabs by hand." };
  const f = facts(order, lead, profile);
  let agentId: string;
  if (lead?.demo?.agentId) {
    await promoteToClient(lead.demo.agentId, f);
    agentId = lead.demo.agentId;
  } else {
    agentId = (await createReceptionist(f, "client", lead?.niche ? [lead.niche] : [])).agentId;
  }
  if (lead) {
    await update((db) => {
      const l = db.leads.find((x) => x.id === lead.id);
      if (l) l.clientAgentId = agentId;
    });
  }
  return { status: "done", detail: `${lead?.demo ? "Turned their demo into their receptionist" : "Built their receptionist"}: ${agentDashboardUrl(agentId)}` };
}

/** An accepted proposal: their workspace with the proposal's services and price, and a first draft of their website. */
async function clientStep(order: Order, lead: Lead | undefined): Promise<StepResult> {
  if (!lead) return { status: "error", detail: "No lead on this order to build the client from" };
  const client = await clientFromLead(lead.id, { orderId: order.id, email: order.email ?? lead.email, phone: order.phone ?? lead.phone });
  let site = "";
  if (!client.site) {
    try {
      await buildSite(client.id);
      site = " and drafted their website";
    } catch (err) {
      site = ` (website not drafted: ${describeError(err)})`;
    }
  }
  return { status: "done", detail: `Opened their workspace${site}: /clients/${client.id}` };
}

async function campaignStep(order: Order, lead: Lead | undefined, profile: AgencyProfile, offer: Offer): Promise<StepResult> {
  const brief: AdBrief = {
    leadId: lead?.id,
    businessName: order.business || lead?.name || "Client",
    niche: lead?.niche,
    location: lead?.city ?? lead?.address,
    website: order.website ?? lead?.website,
    goal: offer.id.includes("receptionist") || offer.bundles?.includes("ai-receptionist") ? "Get more phone calls" : "Book more appointments",
    rating: lead?.rating,
    reviewCount: lead?.reviewCount,
    audit: lead?.audit,
    notes: offer.bundles?.includes("ai-receptionist") || offer.id === "ai-receptionist" ? "They now answer every call 24/7 with an AI receptionist: 'call any time, we always pick up' is a usable angle." : undefined,
  };
  const content = claudeEnabled() ? await generateCampaign(brief, profile) : templateCampaign(brief);
  const campaign = await saveCampaign(toCampaign(content, brief, "agent:autopilot"));
  let art = "";
  if (elevenEnabled() && process.env.ART_ON_ORDERS !== "0") {
    try {
      const a = await generateArt(artPrompt({ ...brief, artPrompt: campaign.creative.artPrompt, palette: campaign.creative.palette, brandColors: lead?.audit?.brandColors, offer: campaign.offer }, "square"), "square");
      await patchCampaign(campaign.id, (c) => {
        c.art = { ...(c.art ?? {}), square: a };
      });
      art = " with custom art";
    } catch (err) {
      art = ` (art not made: ${describeError(err)})`;
    }
  }
  return { status: "done", detail: `Launch campaign written${art}: /ads?campaign=${campaign.id}` };
}

async function tasksStep(order: Order, lead: Lead | undefined, offer: Offer): Promise<StepResult> {
  const due = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const titles = onboardingTasks(offer);
  const who = order.business || lead?.name || "new client";
  for (const t of titles) await createTask({ title: `${who}: ${t}`, leadId: lead?.id, due, createdBy: "store" });
  return { status: "done", detail: `${titles.length} onboarding tasks added to your Inbox` };
}

function welcomeText(order: Order, offer: Offer, profile: AgencyProfile): string {
  const price = `${order.currency.toUpperCase()} ${order.amount.toLocaleString("en-US")} per ${order.interval}${order.setupFee ? ` plus a one-time ${order.currency.toUpperCase()} ${order.setupFee.toLocaleString("en-US")} setup` : ""}`;
  return [
    `Hi ${order.name?.split(" ")[0] || "there"},`,
    "",
    `Thanks for choosing ${profile.agencyName}! Your ${offer.name} is confirmed.`,
    "",
    "Here's what happens next:",
    ...offer.howItWorks.map((s, i) => `${i + 1}. ${s}`),
    "",
    profile.calendarUrl ? `Book your kickoff call here: ${profile.calendarUrl}` : "We'll email you within one business day to book your kickoff call.",
    "",
    `Your plan: ${offer.name}, ${price}. ${offer.timeToLive}.`,
    "Questions? Just reply to this email.",
    "",
    profile.ownerName || profile.agencyName,
    profile.agencyName,
    profile.mailingAddress,
  ]
    .filter((l, i, a) => !(l === "" && a[i - 1] === ""))
    .join("\n")
    .trim();
}

async function welcomeStep(order: Order, lead: Lead | undefined, offer: Offer, profile: AgencyProfile): Promise<StepResult> {
  const to = order.email ?? lead?.email;
  if (!to) return { status: "skipped", detail: "No email address on the order" };
  if (!resendEnabled()) {
    await createTask({ title: `Send ${order.business ?? to} a welcome email (email sending isn't connected)`, leadId: lead?.id, createdBy: "store" });
    return { status: "skipped", detail: "Email sending isn't connected (RESEND_API_KEY + RESEND_FROM): added a task to send it yourself" };
  }
  await sendEmail({ to, subject: `Welcome to ${profile.agencyName}: next steps for your ${offer.name}`, text: welcomeText(order, offer, profile), replyTo: profile.email || undefined });
  return { status: "done", detail: `Sent to ${to}` };
}

export async function fulfillOrder(orderId: string, _base?: string): Promise<Order | undefined> {
  const claimed = await update((db) => {
    const o = db.orders.find((x) => x.id === orderId);
    if (!o || o.status !== "active") return undefined;
    const offer = offerForOrder(o);
    o.fulfillment ??= { status: "queued", steps: offer ? plannedSteps(offer) : [], updatedAt: now() };
    if (o.fulfillment.status === "done") return undefined;
    if (o.fulfillment.status === "running" && Date.now() - Date.parse(o.fulfillment.updatedAt) < STALE_MS) return undefined;
    o.fulfillment.status = "running";
    o.fulfillment.updatedAt = now();
    return structuredClone(o);
  });
  if (!claimed?.fulfillment) return (await readDb()).orders.find((o) => o.id === orderId);

  const offer = offerForOrder(claimed);
  const profile = await getProfile();
  for (const step of claimed.fulfillment.steps) {
    if (step.status === "done" || step.status === "skipped") continue;
    const lead = claimed.leadId ? await getLead(claimed.leadId) : undefined;
    let result: StepResult;
    try {
      if (!offer) result = { status: "error", detail: "This product is no longer in the catalog" };
      else if (step.id === "client") result = await clientStep(claimed, lead);
      else if (step.id === "agent") result = await agentStep(claimed, lead, profile);
      else if (step.id === "campaign") result = await campaignStep(claimed, lead, profile, offer);
      else if (step.id === "tasks") result = await tasksStep(claimed, lead, offer);
      else if (step.id === "welcome") result = await welcomeStep(claimed, lead, offer, profile);
      else result = { status: "skipped", detail: "Unknown step" };
    } catch (err) {
      result = { status: "error", detail: describeError(err) };
    }
    await update((db) => {
      const o = db.orders.find((x) => x.id === orderId);
      const s = o?.fulfillment?.steps.find((x) => x.id === step.id);
      if (s && o?.fulfillment) {
        Object.assign(s, result, { at: now() });
        o.fulfillment.updatedAt = now();
      }
    });
  }
  const final = await update((db) => {
    const o = db.orders.find((x) => x.id === orderId);
    if (!o?.fulfillment) return undefined;
    o.fulfillment.status = o.fulfillment.steps.some((s) => s.status === "error") ? "error" : "done";
    o.fulfillment.updatedAt = now();
    return structuredClone(o);
  });
  if (final?.fulfillment) {
    const failed = final.fulfillment.steps.filter((s) => s.status === "error").length;
    await addActivity({
      kind: "system",
      text: failed ? `Onboarding for ${final.business ?? final.email}: ${failed} step${failed > 1 ? "s" : ""} need attention` : `Onboarding started for ${final.business ?? final.email}: agent, campaign and checklist ready`,
      leadId: final.leadId,
    });
  }
  return final;
}
