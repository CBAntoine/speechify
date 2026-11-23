/**
 * Read policy hit counts and turn them into the hits.json the agent reads.
 *
 * Accepts the FortiOS REST response from GET /api/v2/monitor/firewall/policy
 * (one VDOM, or an array of responses for several), a plain array of
 * per-policy records, or a CSV with a header row.
 */

export interface PolicyHits {
  vdom: string | null;
  policyid: number;
  hit_count: number | null;
  /** ISO 8601, or null when the policy has never matched. */
  last_used: string | null;
  first_used: string | null;
}

export interface HitsFile {
  format: "fortigate-review hits.json v1";
  source: string;
  exported_at: string | null;
  /** How many days the counters cover, if known. Counters reset when the unit reboots or someone clears them. */
  period_days: number | null;
  policies: PolicyHits[];
}

type Row = Record<string, unknown>;

function pick(row: Row, names: string[]): unknown {
  for (const [key, value] of Object.entries(row)) {
    const k = key.toLowerCase().replace(/[\s_-]/g, "");
    if (names.includes(k)) return value;
  }
  return undefined;
}

function toNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Unix seconds, Unix milliseconds or a date string to ISO 8601. Zero and blanks mean never. */
function toIso(v: unknown): string | null {
  if (v === undefined || v === null || v === "" || v === 0 || v === "0") return null;
  const n = toNumber(v);
  if (n !== null) {
    if (n <= 0) return null;
    return new Date(n > 1e12 ? n : n * 1000).toISOString();
  }
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalize(row: Row, vdom: string | null): PolicyHits | null {
  const policyid = toNumber(pick(row, ["policyid", "id"]));
  if (policyid === null) return null;
  const rowVdom = pick(row, ["vdom"]);
  return {
    vdom: typeof rowVdom === "string" && rowVdom ? rowVdom : vdom,
    policyid,
    hit_count: toNumber(pick(row, ["hitcount", "hits", "hit"])),
    last_used: toIso(pick(row, ["lastused", "lasthit"])),
    first_used: toIso(pick(row, ["firstused", "firsthit"])),
  };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function rowsFromJson(data: unknown): { rows: Row[]; vdom: string | null }[] {
  if (Array.isArray(data)) {
    if (data.every((d) => d && typeof d === "object" && Array.isArray((d as Row).results))) {
      return data.flatMap((d) => rowsFromJson(d));
    }
    return [{ rows: data as Row[], vdom: null }];
  }
  if (data && typeof data === "object") {
    const obj = data as Row;
    if (Array.isArray(obj.results)) return [{ rows: obj.results as Row[], vdom: typeof obj.vdom === "string" ? obj.vdom : null }];
    if (Array.isArray(obj.policies)) return [{ rows: obj.policies as Row[], vdom: null }];
  }
  throw new Error("Hit counts: expected the FortiOS monitor API response, an array of policy records, or a CSV file.");
}

export function parseHits(
  text: string,
  opts: { source: string; periodDays: number | null; exportedAt: string | null },
): HitsFile {
  const trimmed = text.trim();
  let groups: { rows: Row[]; vdom: string | null }[];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    groups = rowsFromJson(JSON.parse(trimmed));
  } else {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error("Hit counts: the CSV needs a header row and at least one policy.");
    const header = splitCsvLine(lines[0]);
    const rows = lines.slice(1).map((l) => {
      const cells = splitCsvLine(l);
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
    });
    groups = [{ rows, vdom: null }];
  }
  const policies: PolicyHits[] = [];
  for (const g of groups) {
    for (const row of g.rows) {
      if (!row || typeof row !== "object") continue;
      const p = normalize(row, g.vdom);
      if (p) policies.push(p);
    }
  }
  if (!policies.length) throw new Error("Hit counts: no policy records found.");
  return {
    format: "fortigate-review hits.json v1",
    source: opts.source,
    exported_at: opts.exportedAt,
    period_days: opts.periodDays,
    policies,
  };
}
