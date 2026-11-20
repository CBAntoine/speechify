// Runs one Overpass query against a list of public servers, in order, and
// returns the first good answer. The free servers are often overloaded (HTTP
// 429/502/504, hangs, or a JSON "remark" saying the query ran out of time),
// so one failure moves on to the next server instead of failing the search.
// Servers are tried one at a time, never in parallel, to keep load on these
// volunteer-run services low. No server-only imports, so it's unit tested.

import type { OsmElement } from "./osm-parse.ts";

export const DEFAULT_OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

/** `OVERPASS_URL` may list several servers, comma-separated, tried in order. */
export function overpassUrls(env: string | undefined): string[] {
  const list = (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_OVERPASS_URLS;
}

export interface OverpassAttempt {
  host: string;
  ok: boolean;
  ms: number;
  status?: number;
  problem?: string;
  elements?: number;
}

export class OverpassUnavailableError extends Error {
  readonly attempts: OverpassAttempt[];
  constructor(attempts: OverpassAttempt[]) {
    super(`No Overpass server answered: ${attempts.map((a) => `${a.host} (${a.problem})`).join("; ")}`);
    this.name = "OverpassUnavailableError";
    this.attempts = attempts;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function describe(err: unknown, timeoutMs: number): string {
  const e = err as { name?: string; message?: string };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return `timed out after ${Math.round(timeoutMs / 1000)}s`;
  return e?.message ?? String(err);
}

export async function queryOverpass(
  urls: string[],
  query: string,
  opts: {
    userAgent: string;
    fetchImpl?: typeof fetch;
    /** Total time for all servers together. */
    budgetMs?: number;
    /** Per-server wait; the first server gets a little longer. */
    firstTimeoutMs?: number;
    nextTimeoutMs?: number;
    describeError?: (err: unknown, timeoutMs: number) => string;
    onAttempt?: (a: OverpassAttempt) => void;
  },
): Promise<{ elements: OsmElement[]; attempts: OverpassAttempt[] }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const explain = opts.describeError ?? describe;
  const deadline = Date.now() + (opts.budgetMs ?? 60_000);
  const attempts: OverpassAttempt[] = [];
  const record = (a: OverpassAttempt) => {
    attempts.push(a);
    opts.onAttempt?.(a);
  };

  for (const [i, url] of urls.entries()) {
    const left = deadline - Date.now();
    if (left < 3_000) break;
    const timeoutMs = Math.min(i === 0 ? (opts.firstTimeoutMs ?? 25_000) : (opts.nextTimeoutMs ?? 20_000), left);
    const host = hostOf(url);
    const t0 = Date.now();
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "user-agent": opts.userAgent, "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        record({ host, ok: false, ms: Date.now() - t0, status: res.status, problem: `HTTP ${res.status}` });
        continue;
      }
      const data = (await res.json()) as { elements?: OsmElement[]; remark?: string };
      const elements = data.elements ?? [];
      // Overpass reports a query that ran out of time or memory as HTTP 200
      // with a "remark", sometimes with partial results. Partial results are
      // incomplete, so another server gets a chance.
      if (data.remark && /runtime (error|remark)|timed out|out of memory/i.test(data.remark)) {
        record({ host, ok: false, ms: Date.now() - t0, status: res.status, problem: data.remark.slice(0, 120), elements: elements.length });
        continue;
      }
      record({ host, ok: true, ms: Date.now() - t0, status: res.status, elements: elements.length });
      return { elements, attempts };
    } catch (err) {
      record({ host, ok: false, ms: Date.now() - t0, problem: explain(err, timeoutMs) });
    }
  }
  throw new OverpassUnavailableError(attempts);
}
