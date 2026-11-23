/**
 * Turn a FortiGate backup (plus optional hit counts, deviations and KEV
 * entries) into the files the review agent reads. Pure and in memory, so the
 * command line and the web console share it.
 */
import { parseConfig, summarize, toAgentJson, type ConfigSummary } from "./fortios.ts";
import { redactionCounts, sanitize, type Redaction } from "./sanitize.ts";
import { parseHits } from "./hits.ts";
import type { KevFile } from "./kev.ts";

export interface InputFile {
  name: string;
  content: string;
  type: string;
}

export interface BundleInput {
  configText: string;
  /** The backup's original file name. */
  configName: string;
  hits?: { text: string; name: string; periodDays: number | null; exportedAt: string | null };
  deviations?: { text: string; name: string };
  kev?: KevFile | null;
  notes?: string;
  /** YYYY-MM-DD */
  reviewDate: string;
  /** Settings already redacted before this call (the console redacts in the browser), by name. */
  priorRedactions?: Record<string, number>;
}

export interface Bundle {
  device: string;
  reviewDate: string;
  summary: ConfigSummary;
  lineCount: number;
  warnings: string[];
  redactions: Redaction[];
  files: InputFile[];
}

/** A problem with the inputs that the person can fix. */
export class BundleError extends Error {}

function mergeCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const src of [a, b]) {
    for (const [k, v] of Object.entries(src)) if (Number.isFinite(v) && v > 0) out[k] = (out[k] ?? 0) + Math.floor(v);
  }
  return out;
}

export function buildBundle(input: BundleInput): Bundle {
  const original = input.configText.replace(/^﻿/, "");
  const { text: redacted, redactions } = sanitize(original);
  if (redacted.split("\n").length !== original.split("\n").length) {
    throw new BundleError("Redaction changed the number of lines, so line references would be wrong. Nothing was uploaded.");
  }
  const parsed = parseConfig(redacted);
  const summary = summarize(parsed);
  const policyCount = Object.values(summary.policies).reduce((a, b) => a + b, 0);
  if (!parsed.header.config_version && policyCount === 0) {
    throw new BundleError(`${input.configName} doesn't look like a FortiGate backup: it has no #config-version header and no firewall policies.`);
  }
  const device = summary.hostname || input.configName.replace(/\.[^.]+$/, "") || "fortigate";

  const files: InputFile[] = [
    { name: "config.conf", content: redacted, type: "text/plain" },
    { name: "config.json", content: JSON.stringify(toAgentJson(parsed)), type: "application/json" },
  ];

  let hitsPeriod: number | null = null;
  if (input.hits) {
    let hits;
    try {
      hits = parseHits(input.hits.text, { source: input.hits.name, periodDays: input.hits.periodDays, exportedAt: input.hits.exportedAt });
    } catch (err) {
      throw new BundleError(`${input.hits.name}: ${(err as Error).message}`);
    }
    hitsPeriod = hits.period_days;
    files.push({ name: "hits.json", content: JSON.stringify(hits, null, 2), type: "application/json" });
  }

  if (input.kev) files.push({ name: "kev-fortinet.json", content: JSON.stringify(input.kev, null, 2), type: "application/json" });

  if (input.deviations) {
    let data: unknown;
    try {
      data = JSON.parse(input.deviations.text);
    } catch {
      throw new BundleError(`${input.deviations.name} isn't valid JSON.`);
    }
    if (!Array.isArray(data)) throw new BundleError("Deviations must be a JSON array of {check, object, reason, owner, expires}.");
    files.push({ name: "deviations.json", content: JSON.stringify(data, null, 2), type: "application/json" });
  }

  const run = {
    format: "fortigate-review run.json v1",
    device,
    review_date: input.reviewDate,
    notes: input.notes ?? "",
    source_file: input.configName,
    redacted_settings: mergeCounts(input.priorRedactions ?? {}, redactionCounts(redactions)),
    inputs: {
      hits: Boolean(input.hits),
      hits_period_days: hitsPeriod,
      kev: Boolean(input.kev),
      kev_entries: input.kev?.count ?? 0,
      deviations: Boolean(input.deviations),
    },
    parser_warnings: parsed.warnings.length,
  };
  files.push({ name: "run.json", content: JSON.stringify(run, null, 2), type: "application/json" });

  return { device, reviewDate: input.reviewDate, summary, lineCount: parsed.line_count, warnings: parsed.warnings, redactions, files };
}
