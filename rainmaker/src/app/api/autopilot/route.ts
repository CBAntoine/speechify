import { after } from "next/server";
import { AutopilotBusy, runAutopilot } from "@/lib/autopilot/run";
import { sanitizeConfig } from "@/lib/autopilot/plan";
import { HttpError, readBody, route } from "@/lib/http";
import { siteUrl } from "@/lib/site";
import { readDb, update } from "@/lib/store";
import type { AutopilotConfig } from "@/lib/types";

export const maxDuration = 300;

export const GET = route(async () => {
  const { autopilot } = await readDb();
  const running = Boolean(autopilot.lockUntil && Date.parse(autopilot.lockUntil) > Date.now());
  return Response.json({ config: autopilot.config, runs: autopilot.runs.slice(0, 15), running, sent: autopilot.sent });
});

export const PUT = route(async (req: Request) => {
  const patch = await readBody<Partial<AutopilotConfig>>(req);
  const config = await update((db) => {
    db.autopilot.config = sanitizeConfig(patch, db.autopilot.config);
    return structuredClone(db.autopilot.config);
  });
  return Response.json({ config });
});

/** Run now. Returns at once; the run keeps going in the background and logs as it goes. */
export const POST = route(async (req: Request) => {
  const { autopilot } = await readDb();
  if (autopilot.lockUntil && Date.parse(autopilot.lockUntil) > Date.now()) throw new HttpError(409, "Autopilot is already running.");
  const base = siteUrl(req);
  after(() =>
    runAutopilot("manual", { base, budgetMs: 270_000 }).catch((err) => {
      if (!(err instanceof AutopilotBusy)) console.error("[rainmaker] autopilot", err);
    })
  );
  return Response.json({ started: true });
});
