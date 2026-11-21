import { auditWebsite } from "@/lib/prospecting/audit";
import { deriveSignals, scoreProspect } from "@/lib/prospecting/score";
import { getNiche } from "@/lib/niches";
import { getLead, updateLead } from "@/lib/repo";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";

export const maxDuration = 60;

export const POST = route(async (req: Request, { params }: IdParams) => {
  const lead = await getLead((await params).id);
  if (!lead) throw new HttpError(404, "Lead not found");
  const b = await readBody<{ url?: string }>(req).catch(() => ({ url: undefined }));
  const url = b.url?.trim() || lead.website;
  const niche = getNiche(lead.niche);
  if (!url) {
    const base = { phone: lead.phone, rating: lead.rating, reviewCount: lead.reviewCount, booking: niche?.booking, retainerMid: niche?.retainerMid, source: lead.source };
    const signals = deriveSignals(base);
    return Response.json({ lead: await updateLead(lead.id, { signals, score: scoreProspect(base, signals) }) });
  }
  const audit = await auditWebsite(url);
  const base = { website: url, phone: lead.phone, rating: lead.rating, reviewCount: lead.reviewCount, booking: niche?.booking, retainerMid: niche?.retainerMid, audit, source: lead.source };
  const signals = deriveSignals(base);
  const updated = await updateLead(lead.id, { website: url, audit, signals, score: scoreProspect(base, signals), email: lead.email ?? audit.emails[0] });
  return Response.json({ lead: updated });
});
