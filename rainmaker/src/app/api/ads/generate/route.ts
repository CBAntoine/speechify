import { claudeEnabled } from "@/lib/config";
import { describeError } from "@/lib/claude/client";
import { generateCampaign, templateCampaign, toCampaign, type AdBrief } from "@/lib/claude/ads";
import { auditWebsite } from "@/lib/prospecting/audit";
import { getLead, getProfile, saveCampaign } from "@/lib/repo";
import { HttpError, readBody, route } from "@/lib/http";

export const maxDuration = 300;

// Streams newline-delimited JSON: progress lines while Claude writes, then
// one {"type":"done","campaign":...} line (or {"type":"error"}).
export const POST = route(async (req: Request) => {
  const b = await readBody<Partial<AdBrief>>(req);
  const lead = b.leadId ? await getLead(b.leadId) : undefined;
  const businessName = (b.businessName ?? lead?.name ?? "").trim();
  if (!businessName) throw new HttpError(400, "Name the business");
  const brief: AdBrief = {
    leadId: lead?.id,
    businessName,
    niche: b.niche ?? lead?.niche,
    location: b.location?.trim() || lead?.city || lead?.address,
    website: b.website?.trim() || lead?.website,
    goal: b.goal?.trim() || "Get more booked appointments",
    offer: b.offer?.trim() || undefined,
    notes: b.notes?.trim() || undefined,
    rating: lead?.rating,
    reviewCount: lead?.reviewCount,
    audit: lead?.audit,
    research: b.research?.trim() || undefined,
  };
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        if (brief.website && !brief.audit) {
          send({ type: "phase", phase: "auditing" });
          brief.audit = await auditWebsite(brief.website).catch(() => undefined);
        }
        const ai = claudeEnabled();
        const content = ai
          ? await generateCampaign(brief, await getProfile(), (p) => send(p))
          : templateCampaign(brief);
        const campaign = await saveCampaign(toCampaign(content, brief, ai ? "user" : "template"));
        send({ type: "done", campaign, ai });
      } catch (err) {
        send({ type: "error", error: describeError(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
});
