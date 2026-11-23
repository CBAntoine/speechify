import { elevenEnabled } from "@/lib/config";
import { embedSnippet } from "@/lib/elevenlabs/guide";
import { HttpError, readBody, route, type IdParams } from "@/lib/http";
import {
  addKnowledge,
  buildGuide,
  draftGuidePitch,
  guideReport,
  guideRoiFor,
  guideUrl,
  removeGuide,
  setGuideRoi,
  setQuestions,
  startGuideTrial,
  testGuide,
} from "@/lib/offers/guide";
import { SiteScanError } from "@/lib/offers/site-kb";
import { getLead } from "@/lib/repo";
import { siteUrl } from "@/lib/site";

// The AI Website Guide offer for one lead. GET: the guide, its ROI and (with
// ?report=1) what it has captured. POST { action }: roi, build, test,
// questions, pitch, trial, knowledge.

export const maxDuration = 300;

async function view(req: Request, id: string) {
  const lead = await getLead(id);
  if (!lead) throw new HttpError(404, "Lead not found");
  return {
    guide: lead.guide ?? null,
    roi: guideRoiFor(lead),
    roiInputs: lead.guideRoi ?? {},
    url: lead.guide ? guideUrl(lead.guide.token, siteUrl(req)) : null,
    snippet: lead.guide ? embedSnippet(lead.guide.agentId) : null,
    elevenlabs: elevenEnabled(),
  };
}

export const GET = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const base = await view(req, id);
  const wantReport = new URL(req.url).searchParams.get("report") === "1";
  if (!wantReport || !base.guide) return Response.json(base);
  return Response.json({ ...base, report: await guideReport(id) });
});

export const POST = route(async (req: Request, { params }: IdParams) => {
  const id = (await params).id;
  const b = await readBody<{ action?: string; monthlyVisitors?: number; leadValue?: number; questions?: string[]; website?: string; weeks?: number; text?: string }>(req);
  const needsEleven = ["build", "test", "trial", "knowledge"];
  if (needsEleven.includes(String(b.action)) && !elevenEnabled()) throw new HttpError(400, "Add ELEVENLABS_API_KEY to build AI guides");
  try {
    switch (b.action) {
      case "roi":
        await setGuideRoi(id, { monthlyVisitors: b.monthlyVisitors, leadValue: b.leadValue });
        break;
      case "build":
        await buildGuide(id, "user", { text: typeof b.text === "string" && b.text.trim() ? b.text : undefined });
        break;
      case "test":
        await testGuide(id);
        break;
      case "questions":
        await setQuestions(id, b.questions ?? []);
        break;
      case "pitch":
        return Response.json({ ...(await view(req, id)), drafts: await draftGuidePitch(id, siteUrl(req)) });
      case "trial": {
        const r = await startGuideTrial(id, b.website ?? "", b.weeks);
        return Response.json({ ...(await view(req, id)), snippet: r.snippet });
      }
      case "knowledge":
        await addKnowledge(id, b.text ?? "");
        break;
      default:
        throw new HttpError(400, "Unknown action");
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(err instanceof SiteScanError ? 422 : 502, err instanceof Error ? err.message : String(err));
  }
  return Response.json(await view(req, id));
});

export const DELETE = route(async (_req: Request, { params }: IdParams) => {
  await removeGuide((await params).id);
  return Response.json({ ok: true });
});
