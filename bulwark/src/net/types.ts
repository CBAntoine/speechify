import type { AutoFixRef, Confidence, ServiceInfo, Severity } from "../core/types.ts";

/** A problem a network probe found on one service. */
export interface NetIssue {
  checkId: string;
  title: string;
  severity: Severity;
  summary: string;
  why: string;
  steps: string[];
  evidence?: string[];
  cves?: string[];
  confidence?: Confidence;
  subject?: string;
  references?: string[];
  auto?: AutoFixRef;
}

export interface ProbeResult {
  service: ServiceInfo;
  issues: NetIssue[];
}

export type Probe = (ip: string, port: number) => Promise<ProbeResult | null>;
