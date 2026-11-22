// Turns a check's outcome into a finding. Kept apart from the check registry so that check modules
// can use it without importing the registry (which imports them).

import type { Check, CheckOutcome, Finding } from "./types.ts";

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
