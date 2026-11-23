import { buildBundle } from "@/review/bundle.ts";
import { listReviews, startReview } from "@/review/runs.ts";
import { claude } from "@/lib/claude";
import { budgetCents, consoleUrl, reviewAgent } from "@/lib/config";
import { HttpError, readJson, route, str } from "@/lib/http";
import { fortinetKev } from "@/lib/kev-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function agent() {
  const ids = reviewAgent();
  if (!ids) throw new HttpError(503, "The review agent isn't set up. Run ant apply in the engineer folder, or set FGT_REVIEW_AGENT_ID and FGT_REVIEW_ENVIRONMENT_ID.");
  return ids;
}

/** The latest reviews. */
export const GET = route(async () => {
  return Response.json({ reviews: await listReviews(claude(), agent().agentId) });
});

interface StartBody {
  backup?: { name?: string; text?: string };
  redacted?: Record<string, number>;
  hits?: { name?: string; text?: string; days?: number | null; exportedAt?: string | null } | null;
  deviations?: { name?: string; text?: string } | null;
  notes?: string;
  reviewDate?: string;
}

/** Start a review. The browser has already removed secrets; the server checks again. */
export const POST = route(async (req: Request) => {
  const ids = agent();
  const client = claude();
  const b = await readJson<StartBody>(req);
  const text = str(b.backup?.text, 4_000_000);
  if (!text) throw new HttpError(400, "Load a FortiGate backup first.");
  const reviewDate = /^\d{4}-\d{2}-\d{2}$/.test(str(b.reviewDate)) ? str(b.reviewDate) : new Date().toISOString().slice(0, 10);
  const days = Number(b.hits?.days);
  const bundle = buildBundle({
    configText: text,
    configName: str(b.backup?.name, 200) || "backup.conf",
    hits: b.hits?.text
      ? { text: str(b.hits.text, 2_000_000), name: str(b.hits.name, 200) || "hits.json", periodDays: Number.isInteger(days) && days > 0 ? days : null, exportedAt: str(b.hits.exportedAt, 40) || null }
      : undefined,
    deviations: b.deviations?.text ? { text: str(b.deviations.text, 500_000), name: str(b.deviations.name, 200) || "deviations.json" } : undefined,
    kev: await fortinetKev(),
    notes: str(b.notes, 2_000),
    reviewDate,
    priorRedactions: b.redacted && typeof b.redacted === "object" ? b.redacted : undefined,
  });
  const { sessionId } = await startReview(client, ids, bundle, { budgetCents: budgetCents(), kickoff: true, source: "console" });
  return Response.json({ id: sessionId, device: bundle.device, reviewDate, consoleUrl: consoleUrl(sessionId), budgetUsd: budgetCents() / 100 });
});
