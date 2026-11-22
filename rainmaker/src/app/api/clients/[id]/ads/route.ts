import { adviseAds, type AdAdvice } from "@/lib/claude/clients";
import { generateCampaign, templateCampaign, toCampaign, type AdBrief } from "@/lib/claude/ads";
import { describeError } from "@/lib/claude/client";
import { claudeEnabled } from "@/lib/config";
import { readClientData } from "@/lib/clients/data-store";
import { lastDays, results } from "@/lib/clients/metrics";
import { getClient, patchClient } from "@/lib/clients/repo";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import { getProfile, saveCampaign } from "@/lib/repo";
import { siteUrl } from "@/lib/site";
import type { AdMonth, Client } from "@/lib/types";

export const maxDuration = 300;

/** Advice from the numbers alone, when Claude isn't connected. */
function rulesAdvice(c: Client, months: AdMonth[], responseSec?: number, missed?: number): AdAdvice {
  const actions: AdAdvice["actions"] = [];
  const last = [...months].sort((a, b) => b.month.localeCompare(a.month))[0];
  if (!last) {
    return { summary: "No ad results recorded yet.", actions: [{ title: "Record last month's spend, leads and bookings", why: "Cost per booking is the number that decides what to change." }] };
  }
  const cpb = last.booked ? last.spend / last.booked : undefined;
  if (responseSec !== undefined && responseSec > 300) actions.push({ title: "Fix follow-up speed before spending more", why: `New leads wait ${Math.round(responseSec / 60)} minutes for a reply; most go cold in that time.` });
  if (missed) actions.push({ title: "Catch the missed calls", why: `${missed} calls went unanswered this month. Turn on step 5 before raising the budget.` });
  if (last.leads && !last.booked) actions.push({ title: "Leads aren't booking", why: "Check the offer and the first reply; test a clearer offer or a free first step." });
  if (cpb !== undefined && cpb > c.jobValue) actions.push({ title: "Pause the weakest ad set", why: `Each booking cost ${Math.round(cpb)}, more than a customer is worth (${c.jobValue}). Keep the best ad and test a new offer.` });
  if (cpb !== undefined && cpb < c.jobValue / 3) actions.push({ title: "Raise the budget 20%", why: `Each booking costs ${Math.round(cpb)} and is worth about ${c.jobValue}: there's room to scale.` });
  if (!actions.length) actions.push({ title: "Test one new angle", why: "Results are steady. Try one new hook or offer against the current best ad." });
  return { summary: `${last.month}: ${last.spend} spent, ${last.leads} leads, ${last.booked} bookings${cpb ? ` (${Math.round(cpb)} per booking)` : ""}.`, actions };
}

/**
 * { action: "month", month, spend, leads, booked, revenue?, notes? }  { action: "delete_month", month }
 * { action: "advice" }  { action: "campaign", goal?, offer?, notes? }  { action: "unlink", campaignId }
 */
export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const client = await getClient(id);
  if (!client) throw new HttpError(404, "Client not found");
  const b = await readBody<Record<string, unknown>>(req);
  const num = (k: string) => Math.max(0, Math.round((Number(b[k]) || 0) * 100) / 100);

  switch (b.action) {
    case "month": {
      const month = typeof b.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.month) ? b.month : undefined;
      if (!month) throw new HttpError(400, "Pick the month");
      const saved = await patchClient(id, (c) => {
        const row: AdMonth = { month, spend: num("spend"), leads: Math.round(num("leads")), booked: Math.round(num("booked")), ...(b.revenue !== undefined && b.revenue !== "" ? { revenue: num("revenue") } : {}), ...(typeof b.notes === "string" && b.notes.trim() ? { notes: b.notes.slice(0, 300) } : {}) };
        c.adMonths = [...c.adMonths.filter((m) => m.month !== month), row].sort((x, y) => y.month.localeCompare(x.month)).slice(0, 36);
      });
      return Response.json({ client: saved });
    }
    case "delete_month": {
      const saved = await patchClient(id, (c) => {
        c.adMonths = c.adMonths.filter((m) => m.month !== b.month);
      });
      return Response.json({ client: saved });
    }
    case "advice": {
      const r = results(client, await readClientData(id), lastDays(30));
      if (claudeEnabled()) {
        try {
          return Response.json({ advice: await adviseAds({ client, months: client.adMonths, responseSec: r.medianResponseSec, missedCalls: r.calls.missed }), by: "ai" });
        } catch (err) {
          return Response.json({ advice: rulesAdvice(client, client.adMonths, r.medianResponseSec, r.calls.missed), by: "rules", note: describeError(err) });
        }
      }
      return Response.json({ advice: rulesAdvice(client, client.adMonths, r.medianResponseSec, r.calls.missed), by: "rules" });
    }
    case "campaign": {
      const base = siteUrl(req);
      const brief: AdBrief = {
        leadId: client.leadId,
        businessName: client.name,
        niche: client.niche,
        location: client.place,
        website: client.site?.published ? `${base}/s/${client.site.slug}` : client.website,
        goal: typeof b.goal === "string" && b.goal.trim() ? b.goal.trim().slice(0, 200) : client.settings.nurtureGoal,
        offer: typeof b.offer === "string" && b.offer.trim() ? b.offer.trim().slice(0, 200) : client.site?.content.offer || undefined,
        notes: [
          typeof b.notes === "string" ? b.notes.slice(0, 800) : "",
          "Every lead is answered within a minute and every call is picked up, day or night: 'we reply in minutes' is a true, usable angle.",
          client.lang !== "en" ? `Write the ads in ${client.lang === "es" ? "Spanish" : client.lang === "fr" ? "French" : client.lang} for this market.` : "",
        ]
          .filter(Boolean)
          .join(" "),
        audit: client.audit,
      };
      let content;
      try {
        content = claudeEnabled() ? await generateCampaign(brief, await getProfile()) : templateCampaign(brief);
      } catch (err) {
        throw new HttpError(502, describeError(err));
      }
      const campaign = await saveCampaign(toCampaign(content, brief, "user"));
      const saved = await patchClient(id, (c) => {
        c.campaignIds = [campaign.id, ...c.campaignIds.filter((x) => x !== campaign.id)].slice(0, 30);
        if (c.services.ads.status === "off") c.services.ads = { ...c.services.ads, status: "setup", since: new Date().toISOString() };
      });
      return Response.json({ campaign: { id: campaign.id, businessName: campaign.businessName, createdAt: campaign.createdAt }, client: saved });
    }
    case "unlink": {
      const saved = await patchClient(id, (c) => {
        c.campaignIds = c.campaignIds.filter((x) => x !== b.campaignId);
      });
      return Response.json({ client: saved });
    }
    default:
      throw new HttpError(400, "Unknown action");
  }
});
