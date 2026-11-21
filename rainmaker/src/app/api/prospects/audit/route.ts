import { auditWebsite } from "@/lib/prospecting/audit";
import { deriveSignals, scoreProspect } from "@/lib/prospecting/score";
import { resolveNiche } from "@/lib/prospecting/search";
import { HttpError, readBody, route } from "@/lib/http";

export const maxDuration = 60;

export const POST = route(async (req: Request) => {
  const b = await readBody<{ url?: string; niche?: string; rating?: number; reviewCount?: number; phone?: string }>(req);
  if (!b.url?.trim()) throw new HttpError(400, "Add a website to audit");
  const audit = await auditWebsite(b.url);
  const niche = b.niche ? resolveNiche(b.niche) : undefined;
  const input = { website: b.url, audit, rating: b.rating, reviewCount: b.reviewCount, phone: b.phone, booking: niche?.booking, retainerMid: niche?.retainerMid };
  const signals = deriveSignals(input);
  return Response.json({ audit, signals, score: scoreProspect(input, signals) });
});
