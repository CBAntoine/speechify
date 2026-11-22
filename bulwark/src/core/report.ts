// A Markdown report of a scan, for saving or sharing.

import { counts, grade, sortFindings } from "./score.ts";
import type { ChangeRecord, Finding, Scan } from "./types.ts";

const label = (f: Finding) => `**${f.severity.toUpperCase()}**${f.confidence !== "confirmed" ? ` (${f.confidence})` : ""}`;

function section(title: string, findings: Finding[]): string[] {
  const failing = sortFindings(findings).filter((f) => f.status === "fail");
  const out = [`### ${title}`, ""];
  if (!failing.length) return [...out, "No problems found.", ""];
  for (const f of failing) {
    out.push(`- ${label(f)} ${f.title}`, `  - ${f.summary}`);
    if (f.cves.length) out.push(`  - ${f.cves.map((c) => `[${c}](https://www.cve.org/CVERecord?id=${c})`).join(", ")}`);
    if (f.remedy?.auto) out.push(`  - Bulwark can fix this automatically.`);
    for (const s of f.remedy?.steps ?? []) out.push(`  - Fix: ${s}`);
  }
  out.push("");
  return out;
}

export function markdownReport(scan: Scan, changes: ChangeRecord[] = []): string {
  const out: string[] = [
    `# Bulwark security report`,
    "",
    `${scan.device.hostname} · ${scan.device.os} · scanned ${new Date(scan.startedAt).toLocaleString()}`,
    "",
  ];
  if (scan.local) {
    const c = counts(scan.local.findings);
    out.push(
      `## This device: ${scan.scores.local}/100 (${grade(scan.scores.local ?? 0)})`,
      "",
      `${c.critical} critical, ${c.high} high, ${c.medium} medium, ${c.low} low. ${scan.local.findings.filter((f) => f.status === "pass").length} checks passed.`,
      "",
      ...section("Problems", scan.local.findings),
    );
  }
  if (scan.network) {
    out.push(`## Network: ${scan.network.devices.length} devices`, "", `Scanned: ${scan.network.targets.join(", ")}`, "");
    for (const d of scan.network.devices) {
      const fs = scan.network.findings.filter((f) => f.target === d.ip);
      const name = [d.name, d.model].filter(Boolean).join(" · ");
      out.push(...section(`${d.ip} — ${d.kind}${name ? ` (${name})` : ""}: ${scan.scores.devices[d.ip] ?? 100}/100`, fs));
    }
    for (const n of scan.network.notes) out.push(`> ${n}`, "");
  }
  const applied = changes.filter((c) => c.status === "applied");
  if (applied.length) {
    out.push("## Changes Bulwark made", "");
    for (const c of applied) out.push(`- ${new Date(c.appliedAt).toLocaleString()}: ${c.title}${c.verification ? ` (${c.verification.summary})` : ""}`);
    out.push("");
  }
  return out.join("\n");
}
