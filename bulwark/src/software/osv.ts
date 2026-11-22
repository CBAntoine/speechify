// OSV.dev: Google's open database of vulnerabilities in open-source packages. Bulwark sends it
// package names and versions (nothing else) and gets back the known vulnerabilities for each.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { requestJson } from "../core/https.ts";
import type { Severity } from "../core/types.ts";
import { mapLimit } from "../core/util.ts";
import { cvss3Score, cvss4Severity, scoreToSeverity } from "./cvss.ts";
import { normalizePyName } from "./lockfiles.ts";
import { compareEcosystem } from "./versions.ts";

export interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
  limit?: string;
}

export interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
  affected?: { package?: { name: string; ecosystem: string }; ranges?: { type: string; events: OsvEvent[] }[]; versions?: string[] }[];
  references?: { type?: string; url: string }[];
}

export interface PackageQuery {
  ecosystem: string;
  name: string;
  version: string;
}

export interface VulnGroup {
  /** Every id that refers to this vulnerability (GHSA, PYSEC, CVE…). */
  ids: string[];
  /** The id people know it by: a CVE when there is one. */
  display: string;
  primary: string;
  summary: string;
  severity: Severity;
  cves: string[];
  /** The lowest version that fixes it for this package, if there is one. */
  fixed?: string;
}

const DEFAULT_URL = "https://api.osv.dev";

export class OsvClient {
  readonly baseUrl: string;
  private cacheDir?: string;
  private memory = new Map<string, OsvVuln>();

  constructor(opts: { baseUrl?: string; cacheDir?: string } = {}) {
    this.baseUrl = (opts.baseUrl ?? process.env.BULWARK_OSV_URL ?? DEFAULT_URL).replace(/\/$/, "");
    this.cacheDir = opts.cacheDir;
  }

  /** Vulnerability ids for each query, in order. Throws if OSV can't be reached. */
  async queryBatch(queries: PackageQuery[]): Promise<string[][]> {
    const out: string[][] = [];
    for (let i = 0; i < queries.length; i += 1000) {
      const chunk = queries.slice(i, i + 1000);
      const r = await requestJson<{ results?: { vulns?: { id: string }[] }[] }>(
        "POST",
        `${this.baseUrl}/v1/querybatch`,
        { queries: chunk.map((q) => ({ package: { name: q.name, ecosystem: q.ecosystem }, version: q.version })) },
        { timeoutMs: 60_000 },
      );
      if (r.status !== 200 || !r.data?.results) throw new Error(`Couldn't reach osv.dev: ${r.error ?? `HTTP ${r.status}`}`);
      for (let k = 0; k < chunk.length; k++) out.push((r.data.results[k]?.vulns ?? []).map((v) => v.id));
    }
    return out;
  }

  private cacheFile(id: string): string | null {
    return this.cacheDir && /^[\w.:-]+$/.test(id) ? path.join(this.cacheDir, `${id.replace(/:/g, "_")}.json`) : null;
  }

  async getVuln(id: string): Promise<OsvVuln | null> {
    if (this.memory.has(id)) return this.memory.get(id)!;
    const file = this.cacheFile(id);
    if (file) {
      try {
        const st = await fs.stat(file);
        if (Date.now() - st.mtimeMs < 24 * 3600_000) {
          const v = JSON.parse(await fs.readFile(file, "utf8")) as OsvVuln;
          this.memory.set(id, v);
          return v;
        }
      } catch {
        /* not cached */
      }
    }
    const r = await requestJson<OsvVuln>("GET", `${this.baseUrl}/v1/vulns/${encodeURIComponent(id)}`, undefined, { timeoutMs: 30_000 });
    if (r.status !== 200 || !r.data) return null;
    this.memory.set(id, r.data);
    if (file) {
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 }).catch(() => {});
      await fs.writeFile(file, JSON.stringify(r.data), { mode: 0o600 }).catch(() => {});
    }
    return r.data;
  }

  async getVulns(ids: string[]): Promise<Map<string, OsvVuln>> {
    const unique = [...new Set(ids)];
    const out = new Map<string, OsvVuln>();
    await mapLimit(unique, 8, async (id) => {
      const v = await this.getVuln(id);
      if (v) out.set(id, v);
    });
    return out;
  }
}

const DB_SEVERITY: Record<string, Severity> = { CRITICAL: "critical", HIGH: "high", MODERATE: "medium", MEDIUM: "medium", LOW: "low" };
const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export function vulnSeverity(v: OsvVuln): Severity | null {
  const db = v.database_specific?.severity?.toUpperCase();
  if (db && DB_SEVERITY[db]) return DB_SEVERITY[db];
  for (const s of v.severity ?? []) {
    if (s.type === "CVSS_V3") {
      const score = cvss3Score(s.score);
      if (score !== null) return scoreToSeverity(score);
    }
  }
  const v4 = v.severity?.find((s) => s.type === "CVSS_V4");
  return v4 ? cvss4Severity(v4.score) : null;
}

function samePackage(ecosystem: string, a: string, b: string): boolean {
  return ecosystem === "PyPI" ? normalizePyName(a) === normalizePyName(b) : a === b;
}

/**
 * The lowest version that fixes `v` for this package and version, or undefined when no fixed
 * version is known (or the version isn't in an affected range we can read).
 */
export function fixedVersion(v: OsvVuln, q: PackageQuery): string | undefined {
  const cmp = (a: string, b: string) => compareEcosystem(q.ecosystem, a, b);
  const fixes: string[] = [];
  for (const a of v.affected ?? []) {
    if (!a.package || a.package.ecosystem.split(":")[0] !== q.ecosystem.split(":")[0] || !samePackage(q.ecosystem, a.package.name, q.name)) continue;
    for (const r of a.ranges ?? []) {
      if (r.type !== "SEMVER" && r.type !== "ECOSYSTEM") continue;
      let start: string | null = null;
      for (const e of r.events) {
        if (e.introduced !== undefined) start = e.introduced;
        else if (e.fixed !== undefined && start !== null) {
          const inRange = (start === "0" || cmp(q.version, start) >= 0) && cmp(q.version, e.fixed) < 0;
          if (inRange) fixes.push(e.fixed);
          start = null;
        } else if (e.last_affected !== undefined || e.limit !== undefined) start = null;
      }
    }
  }
  return fixes.sort(cmp)[0];
}

/** Merges ids that alias each other (a GHSA and its PYSEC twin) into one vulnerability each. */
export function groupVulns(ids: string[], details: Map<string, OsvVuln>, q: PackageQuery): VulnGroup[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      const p = parent.get(x)!;
      parent.set(x, parent.get(p)!);
      x = p;
    }
    return x;
  };
  const add = (x: string) => {
    if (!parent.has(x)) parent.set(x, x);
  };
  const union = (a: string, b: string) => {
    add(a);
    add(b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const id of ids) {
    add(id);
    for (const alias of details.get(id)?.aliases ?? []) union(id, alias);
  }
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const r = find(id);
    groups.set(r, [...(groups.get(r) ?? []), id]);
  }
  const out: VulnGroup[] = [];
  for (const members of groups.values()) {
    const vulns = members.map((m) => details.get(m)).filter((v): v is OsvVuln => !!v);
    const allIds = [...new Set([...members, ...vulns.flatMap((v) => v.aliases ?? [])])];
    const cves = allIds.filter((i) => /^CVE-\d{4}-\d+$/.test(i)).sort();
    // GitHub advisories carry the best summaries and ratings.
    const primary = vulns.find((v) => v.id.startsWith("GHSA-")) ?? vulns[0];
    const severities = vulns.map(vulnSeverity).filter((s): s is Severity => !!s);
    const severity = severities.sort((a, b) => RANK[a] - RANK[b])[0] ?? "medium";
    const fixedAll = vulns.map((v) => fixedVersion(v, q)).filter((f): f is string => !!f);
    const summary = primary?.summary?.trim() || primary?.details?.split(/(?<=\.)\s/)[0]?.trim().slice(0, 200) || "Known vulnerability";
    out.push({
      ids: allIds,
      display: cves[0] ?? primary?.id ?? members[0],
      primary: primary?.id ?? members[0],
      summary,
      severity,
      cves,
      fixed: fixedAll.sort((a, b) => compareEcosystem(q.ecosystem, b, a))[0],
    });
  }
  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
}
