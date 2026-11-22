import type { Finding, Severity } from "./types.ts";

const WEIGHT: Record<Severity, number> = { critical: 30, high: 15, medium: 6, low: 2, info: 0 };

/** 100 minus points for each open problem; "possible" findings count half. */
export function score(findings: Finding[]): number {
  let lost = 0;
  for (const f of findings) {
    if (f.status !== "fail") continue;
    lost += WEIGHT[f.severity] * (f.confidence === "possible" ? 0.5 : 1);
  }
  return Math.max(0, Math.round(100 - lost));
}

export function grade(s: number): string {
  return s >= 90 ? "A" : s >= 80 ? "B" : s >= 65 ? "C" : s >= 50 ? "D" : "F";
}

const ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const STATUS: Record<string, number> = { fail: 0, error: 1, skipped: 2, pass: 3 };

export function sortFindings(list: Finding[]): Finding[] {
  return [...list].sort((a, b) => STATUS[a.status] - STATUS[b.status] || ORDER[a.severity] - ORDER[b.severity] || a.title.localeCompare(b.title));
}

export function counts(list: Finding[]): Record<Severity, number> {
  const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of list) if (f.status === "fail") c[f.severity]++;
  return c;
}
