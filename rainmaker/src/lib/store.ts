import "server-only";
import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Db } from "./types";
import { seedDb } from "./seed";

// A small JSON-file database. One process owns it; every write goes through a
// queue and lands atomically (write temp file, then rename). Swap this module
// for Postgres/SQLite when you outgrow a single server.

type State = { db: Db | null; dir: string | null; chain: Promise<unknown>; loading: Promise<Db> | null };
const g = globalThis as { __rmStore?: State };
const state: State = (g.__rmStore ??= { db: null, dir: null, chain: Promise.resolve(), loading: null });

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

async function resolveDir(): Promise<string> {
  if (state.dir) return state.dir;
  const preferred = process.env.DATA_DIR || path.join(process.cwd(), ".data");
  try {
    await fs.mkdir(preferred, { recursive: true });
    await fs.access(preferred, fsConstants.W_OK);
    state.dir = preferred;
  } catch {
    // Read-only filesystems (serverless): fall back to the temp dir. Data then
    // lasts only as long as the instance; see README "Deploying".
    const tmp = path.join(os.tmpdir(), "rainmaker-data");
    await fs.mkdir(tmp, { recursive: true });
    state.dir = tmp;
  }
  return state.dir;
}

async function persist(): Promise<void> {
  if (!state.db) return;
  const dir = await resolveDir();
  const file = path.join(dir, "db.json");
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state.db));
  await fs.rename(tmp, file);
}

function migrate(raw: Partial<Db>): Db {
  const base = seedDb({ withSamples: false });
  return {
    ...base,
    ...raw,
    profile: { ...base.profile, ...(raw.profile ?? {}) },
    managed: { agents: {}, ...(raw.managed ?? {}) },
    leads: raw.leads ?? [],
    drafts: raw.drafts ?? [],
    campaigns: raw.campaigns ?? [],
    tasks: raw.tasks ?? [],
    runs: (raw.runs ?? []).map((r) =>
      // A run that was live when the server stopped can't resume.
      r.status === "running" || r.status === "waiting" ? { ...r, status: "stopped" as const, error: r.error ?? "Server restarted during this run" } : r
    ),
    activity: raw.activity ?? [],
    version: 1,
  };
}

async function load(): Promise<Db> {
  if (state.db) return state.db;
  state.loading ??= (async () => {
    const dir = await resolveDir();
    const file = path.join(dir, "db.json");
    try {
      state.db = migrate(JSON.parse(await fs.readFile(file, "utf8")) as Partial<Db>);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        // Keep a copy of an unreadable file instead of silently losing it.
        await fs.copyFile(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
      }
      state.db = seedDb({ withSamples: true });
      await persist();
    }
    return state.db!;
  })();
  return state.loading;
}

function trim(db: Db) {
  if (db.activity.length > 400) db.activity = db.activity.slice(0, 400);
  if (db.runs.length > 60) db.runs = db.runs.slice(0, 60);
  for (const r of db.runs) if (r.events.length > 600) r.events = r.events.slice(-600);
}

/** A snapshot of the database. Mutating it changes nothing; use update(). */
export async function readDb(): Promise<Db> {
  const db = await load();
  return structuredClone(db);
}

/** Run fn with exclusive write access, then save. */
export function update<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = state.chain.then(async () => {
    const db = await load();
    const result = await fn(db);
    trim(db);
    await persist();
    return result;
  });
  state.chain = run.catch(() => undefined);
  return run;
}

export async function dataDir(): Promise<string> {
  return resolveDir();
}
