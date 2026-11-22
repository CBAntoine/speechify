// Runs the local checks and turns their outcomes into findings.

import { checksFor } from "../checks/index.ts";
import { outcomeToFinding } from "./finding.ts";
import type { Check, CheckOutcome, Finding, Host } from "./types.ts";
import { errorMessage, mapLimit } from "./util.ts";

export { outcomeToFinding };

export async function runCheck(check: Check, host: Host): Promise<Finding[]> {
  try {
    const outcomes = await check.run(host);
    return outcomes.map((o) => outcomeToFinding(check, o));
  } catch (err) {
    return [outcomeToFinding(check, { status: "error", summary: `The check failed: ${errorMessage(err)}` })];
  }
}

export interface AuditProgress {
  done: number;
  total: number;
  current?: string;
}

export async function auditLocal(host: Host, onProgress?: (p: AuditProgress) => void, only?: string[]): Promise<Finding[]> {
  const checks = checksFor(host.platform).filter((c) => !only || only.includes(c.id));
  let done = 0;
  const results = await mapLimit(checks, 4, async (c) => {
    onProgress?.({ done, total: checks.length, current: c.title });
    const r = await runCheck(c, host);
    done++;
    onProgress?.({ done, total: checks.length });
    return r;
  });
  return results.flat();
}
