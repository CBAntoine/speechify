// Storage-agnostic core: compare-and-set updates with retries. No Node or
// Next imports, so it can be unit tested with an in-memory backend.

import type { AgentRun, Db } from "./types.ts";

export interface Backend {
  kind: "file" | "postgres";
  /** Human description, e.g. a file path or "Postgres". */
  label: string;
  /** True when data survives restarts and is shared by every server instance. */
  persistent: boolean;
  /** Latest document and its version. Creates and seeds it when missing. */
  load(): Promise<{ db: Db; version: number }>;
  /** Save if nobody else saved since `version`. Returns the new version, or null on conflict. */
  save(db: Db, version: number): Promise<number | null>;
  getRun(id: string): Promise<AgentRun | undefined>;
  putRun(run: AgentRun): Promise<void>;
  listRuns(limit: number): Promise<AgentRun[]>;
}

export function trimDb(db: Db) {
  if (db.activity.length > 400) db.activity = db.activity.slice(0, 400);
  if (db.runs.length > 40) db.runs = db.runs.slice(0, 40);
  for (const r of db.runs) if (r.events.length > 400) r.events = r.events.slice(-400);
  if (db.stopRequests && db.stopRequests.length > 50) db.stopRequests = db.stopRequests.slice(-50);
  if (db.payments?.seenEvents && db.payments.seenEvents.length > 300) db.payments.seenEvents = db.payments.seenEvents.slice(-300);
  if (db.autopilot?.runs && db.autopilot.runs.length > 30) db.autopilot.runs = db.autopilot.runs.slice(0, 30);
  for (const r of db.autopilot?.runs ?? []) if (r.lines.length > 200) r.lines = r.lines.slice(-200);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read-modify-write with optimistic concurrency. `fn` may run more than once
 * (on a conflict it re-runs against fresh data), so it must only change `db`.
 */
export async function casUpdate<T>(backend: Backend, fn: (db: Db) => T | Promise<T>, attempts = 6): Promise<{ result: T; db: Db; version: number }> {
  for (let i = 0; i < attempts; i++) {
    const { db, version } = await backend.load();
    const result = await fn(db);
    trimDb(db);
    const next = await backend.save(db, version);
    if (next !== null) return { result, db, version: next };
    await sleep(25 * (i + 1) + Math.floor(Math.random() * 40));
  }
  throw new Error("Too many changes at the same moment. Try again.");
}

/** Keep run records small enough to store and poll cheaply. */
export function compactRun(run: AgentRun): AgentRun {
  const events = run.events.slice(-400).map((e) => {
    const text = e.text && e.text.length > 4000 ? `${e.text.slice(0, 4000)}…` : e.text;
    const input = e.input !== undefined && JSON.stringify(e.input).length > 2000 ? { note: "large input omitted" } : e.input;
    return { ...e, text, input };
  });
  return { ...run, events };
}
