// Server entry for the Next.js routes: the job queue runs the pipeline.
import { installRunner } from "./pipeline/run.ts";

installRunner();

export { cancel, createJob, enqueue, getJob, listJobs, removeJob, subscribe } from "./jobs.ts";
export { machine } from "./stack.ts";
export { act, addTiktokAccount, BizError, snapshot } from "./biz/api.ts";

import { releaseLock, startAutopilot } from "./biz/autopilot.ts";

/** The autopilot runs inside the dashboard's server (unless CF_AUTOPILOT=off or `npm run autopilot` holds it). */
export function startServerAutopilot() {
  if (process.env.CF_AUTOPILOT === "off" || process.env.NEXT_PHASE === "phase-production-build") return;
  startAutopilot();
  process.once("exit", releaseLock);
}
