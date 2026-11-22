// CVSS base scores, for vulnerabilities that come with a vector but no rating.

import type { Severity } from "../core/types.ts";

function roundUp(x: number): number {
  const i = Math.round(x * 100_000);
  return i % 10_000 === 0 ? i / 100_000 : (Math.floor(i / 10_000) + 1) / 10;
}

/** CVSS 3.0/3.1 base score from a vector like "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H". */
export function cvss3Score(vector: string): number | null {
  const m = Object.fromEntries(vector.split("/").slice(1).map((p) => p.split(":")));
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV as string];
  const AC = { L: 0.77, H: 0.44 }[m.AC as string];
  const UI = { N: 0.85, R: 0.62 }[m.UI as string];
  const changed = m.S === "C";
  const PR = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR as string];
  const cia = (k: string) => ({ H: 0.56, L: 0.22, N: 0 })[m[k] as string];
  const C = cia("C");
  const I = cia("I");
  const A = cia("A");
  if ([AV, AC, UI, PR, C, I, A].some((v) => v === undefined) || (m.S !== "U" && m.S !== "C")) return null;
  const iss = 1 - (1 - C!) * (1 - I!) * (1 - A!);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploit = 8.22 * AV! * AC! * PR! * UI!;
  if (impact <= 0) return 0;
  return changed ? roundUp(Math.min(1.08 * (impact + exploit), 10)) : roundUp(Math.min(impact + exploit, 10));
}

export function scoreToSeverity(score: number): Severity {
  return score >= 9 ? "critical" : score >= 7 ? "high" : score >= 4 ? "medium" : score > 0 ? "low" : "info";
}

/** CVSS 4.0 needs large lookup tables; this rough reading of the vector is enough to rank findings. */
export function cvss4Severity(vector: string): Severity {
  const m = Object.fromEntries(vector.split("/").slice(1).map((p) => p.split(":")));
  const impacts = ["VC", "VI", "VA", "SC", "SI", "SA"].map((k) => m[k]);
  const easy = m.AV === "N" && m.PR === "N" && m.AC === "L";
  if (impacts.slice(0, 3).includes("H")) return easy && m.UI === "N" ? "critical" : "high";
  if (impacts.includes("H")) return "high";
  if (impacts.includes("L")) return easy ? "medium" : "low";
  return "low";
}
