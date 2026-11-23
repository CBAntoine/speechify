import { parseFindings, type FindingsDoc } from "@/review/findings.ts";
import { cleanupInputs, reviewOutputs, reviewStatus } from "@/review/runs.ts";
import { claude } from "@/lib/claude";
import { consoleUrl } from "@/lib/config";
import { HttpError, route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface Outputs {
  report: string | null;
  findings: FindingsDoc | null;
}

// A finished review never changes, so its outputs are kept for as long as
// this server instance lives.
const finished = new Map<string, Outputs>();

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  if (!/^sesn_[A-Za-z0-9]+$/.test(id)) throw new HttpError(400, "That isn't a review ID.");
  const client = claude();
  const status = await reviewStatus(client, id);
  let outputs: Outputs | null = finished.get(id) ?? null;
  if (!outputs && (status.phase === "done" || status.phase === "stopped")) {
    const files = await reviewOutputs(client, id);
    const report = files.find((f) => f.name === "report.md")?.text ?? null;
    const findingsText = files.find((f) => f.name === "findings.json")?.text;
    // Outputs appear a few seconds after the session goes idle; until then the console asks again.
    if (report || findingsText) {
      outputs = { report, findings: findingsText ? parseFindings(findingsText) : null };
      if (status.phase === "done") finished.set(id, outputs);
    }
    await cleanupInputs(client, id).catch(() => 0);
  }
  return Response.json({ ...status, consoleUrl: consoleUrl(id), outputs });
});
