// Runs the local checks and turns their outcomes into findings.

import { checksFor } from "../checks/index.ts";
import type { Check, CheckOutcome, Finding, Host } from "./types.ts";
import { errorMessage, mapLimit } from "./util.ts";

export function outcomeToFinding(check: Check, o: CheckOutcome, target = "local"): Finding {
  const id = o.subject ? `${check.id}:${o.subject}` : check.id;
  const failing = o.status === "fail";
  return {
    id,
    checkId: check.id,
    target,
    title: o.title ?? check.title,
    category: check.category,
    severity: failing ? o.severity ?? check.severity : "info",
    status: o.status,
    confidence: o.confidence ?? "confirmed",
    summary: o.summary,
    why: check.why,
    evidence: o.evidence ?? [],
    remedy: failing
      ? {
          auto: o.auto ? { fixId: o.auto.fixId, params: o.auto.params ?? {} } : undefined,
          steps: o.steps ?? check.steps ?? [],
        }
      : undefined,
    references: check.references ?? [],
    cves: o.cves ?? [],
  };
}

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
