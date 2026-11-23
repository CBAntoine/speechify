/**
 * Read the findings.json the review agent writes. Tolerant: a field the agent
 * left out gets a safe default instead of breaking the console.
 */

export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface Finding {
  id: string;
  check: string;
  severity: Severity;
  title: string;
  vdom: string;
  object: string;
  lines: number[];
  evidence: string;
  why: string;
  proposed_change: string;
  verify: string;
  confidence: string;
}

export interface FindingsDoc {
  device: { hostname: string; model: string; firmware: string; build: string; release_date: string; vdoms: string[] };
  review_date: string;
  summary: Record<Severity, number>;
  findings: Finding[];
  passed_checks: string[];
  skipped_checks: { check: string; reason: string }[];
  accepted_deviations: { check: string; object: string; owner: string; expires: string; reason: string }[];
}

const s = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function severity(v: unknown): Severity {
  const x = s(v).toLowerCase();
  return (SEVERITIES as readonly string[]).includes(x) ? (x as Severity) : "info";
}

export function parseFindings(text: string): FindingsDoc | null {
  let raw: Record<string, unknown>;
  try {
    raw = obj(JSON.parse(text));
  } catch {
    return null;
  }
  const findings: Finding[] = arr(raw.findings).map((f, i) => {
    const x = obj(f);
    return {
      id: s(x.id) || `F-${String(i + 1).padStart(3, "0")}`,
      check: s(x.check),
      severity: severity(x.severity),
      title: s(x.title),
      vdom: s(x.vdom),
      object: s(x.object),
      lines: arr(x.lines).map(Number).filter((n) => Number.isInteger(n) && n > 0),
      evidence: s(x.evidence),
      why: s(x.why),
      proposed_change: s(x.proposed_change),
      verify: s(x.verify),
      confidence: s(x.confidence) || "confirmed",
    };
  });
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.id.localeCompare(b.id));
  const summary = Object.fromEntries(SEVERITIES.map((k) => [k, findings.filter((f) => f.severity === k).length])) as Record<Severity, number>;
  const d = obj(raw.device);
  return {
    device: {
      hostname: s(d.hostname),
      model: s(d.model),
      firmware: s(d.firmware),
      build: s(d.build),
      release_date: s(d.release_date),
      vdoms: arr(d.vdoms).map(s).filter(Boolean),
    },
    review_date: s(raw.review_date),
    // Counted from the findings themselves, so the totals always match the list.
    summary,
    findings,
    passed_checks: arr(raw.passed_checks).map(s).filter(Boolean),
    skipped_checks: arr(raw.skipped_checks).map((x) => ({ check: s(obj(x).check), reason: s(obj(x).reason) })),
    accepted_deviations: arr(raw.accepted_deviations).map((x) => {
      const y = obj(x);
      return { check: s(y.check), object: s(y.object), owner: s(y.owner), expires: s(y.expires), reason: s(y.reason) };
    }),
  };
}

export function countsSentence(summary: Record<Severity, number>): string {
  const parts = SEVERITIES.filter((k) => summary[k]).map((k) => `${summary[k]} ${k}`);
  return parts.length ? parts.join(", ") : "no findings";
}
