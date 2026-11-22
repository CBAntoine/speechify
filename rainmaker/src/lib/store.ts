import "server-only";
import { promises as fs, constants as fsConstants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import type { AgentRun, Db } from "./types";
import { seedDb } from "./seed";
import { casUpdate, compactRun, type Backend } from "./store-core";

// Two storage backends behind one API:
//  - Postgres when DATABASE_URL (or POSTGRES_URL) is set. Use this for any
//    cloud host, especially serverless ones like Vercel: data is shared by
//    every server instance and survives restarts.
//  - A JSON file otherwise (./.data/db.json or DATA_DIR), for local use and
//    single-server hosting.
// Every write is a compare-and-set, so concurrent writers never clobber
// each other. Agent runs are stored separately because they change often.

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
}

function migrate(raw: Partial<Db>): Db {
  const base = seedDb({ withSamples: false });
  const payments = raw.payments;
  const autopilot = raw.autopilot;
  return {
    ...base,
    ...raw,
    profile: { ...base.profile, ...(raw.profile ?? {}) },
    managed: { agents: {}, ...(raw.managed ?? {}) },
    leads: raw.leads ?? [],
    drafts: raw.drafts ?? [],
    campaigns: raw.campaigns ?? [],
    tasks: raw.tasks ?? [],
    runs: raw.runs ?? [],
    activity: raw.activity ?? [],
    stopRequests: raw.stopRequests ?? [],
    orders: raw.orders ?? [],
    store: { ...base.store, ...(raw.store ?? {}), prices: { ...(raw.store?.prices ?? {}) } },
    payments: {
      stripe: { ...(payments?.stripe ?? {}) },
      paypal: { products: {}, plans: {}, ...(payments?.paypal ?? {}) },
      seenEvents: payments?.seenEvents ?? [],
    },
    autopilot: {
      ...base.autopilot,
      ...(autopilot ?? {}),
      config: { ...base.autopilot.config, ...(autopilot?.config ?? {}) },
      sent: autopilot?.sent ?? base.autopilot.sent,
      runs: autopilot?.runs ?? [],
    },
    version: 1,
  };
}

// ── File backend ──────────────────────────────────────────────

function fileBackend(): Backend {
  let dir: string | null = null;
  let persistent = true;
  let cache: Db | null = null;
  let version = 0;
  let loading: Promise<void> | null = null;
  let writes: Promise<unknown> = Promise.resolve();

  async function resolveDir(): Promise<string> {
    if (dir) return dir;
    const preferred = process.env.DATA_DIR || path.join(process.cwd(), ".data");
    try {
      await fs.mkdir(preferred, { recursive: true });
      await fs.access(preferred, fsConstants.W_OK);
      dir = preferred;
    } catch {
      // Read-only filesystem (serverless): keep working in the temp dir, but
      // flag it so the app can warn that data won't last.
      dir = path.join(os.tmpdir(), "rainmaker-data");
      persistent = false;
      await fs.mkdir(dir, { recursive: true });
    }
    return dir;
  }

  function persist(snapshot: string) {
    writes = writes
      .then(async () => {
        const file = path.join(await resolveDir(), "db.json");
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tmp, snapshot);
        await fs.rename(tmp, file);
      })
      .catch((err) => console.error("[rainmaker] could not save data", err));
    return writes;
  }

  async function init() {
    const file = path.join(await resolveDir(), "db.json");
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as Partial<Db>;
      cache = migrate(raw);
      // A run that was live when the server stopped can't resume.
      cache.runs = cache.runs.map((r) =>
        r.status === "running" || r.status === "waiting" ? { ...r, status: "stopped" as const, error: r.error ?? "Server restarted during this run" } : r
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        await fs.copyFile(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
      }
      cache = seedDb({ withSamples: true });
      await persist(JSON.stringify(cache));
    }
    version = 1;
  }

  const self: Backend = {
    kind: "file",
    get label() {
      return dir ? path.join(dir, "db.json") : "./.data/db.json";
    },
    get persistent() {
      return persistent;
    },
    async load() {
      if (!cache) await (loading ??= init());
      return { db: structuredClone(cache!), version };
    },
    async save(db, v) {
      if (v !== version) return null;
      cache = db;
      version += 1;
      void persist(JSON.stringify(db));
      return version;
    },
    async getRun(id) {
      const { db } = await self.load();
      return db.runs.find((r) => r.id === id);
    },
    async putRun(run) {
      const c = compactRun(run);
      await casUpdate(self, (db) => {
        const i = db.runs.findIndex((r) => r.id === c.id);
        if (i >= 0) db.runs[i] = c;
        else db.runs.unshift(c);
      });
    },
    async listRuns(limit) {
      const { db } = await self.load();
      return db.runs.slice(0, limit);
    },
  };
  return self;
}

// ── Postgres backend ──────────────────────────────────────────

/** jsonb comes back parsed; older or hand-edited rows may hold a JSON string. */
function parseJson<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

function pgBackend(url: string): Backend {
  const sql = postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 15, prepare: false, onnotice: () => {} });
  // Let the driver encode jsonb parameters (a string + ::jsonb cast gets
  // double-encoded into a JSON string).
  const json = (v: unknown) => sql.json(JSON.parse(JSON.stringify(v)) as postgres.JSONValue);
  let ready: Promise<void> | null = null;
  let host = "database";
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep the generic label */
  }

  function init() {
    ready ??= (async () => {
      await sql`create table if not exists rainmaker_store (id text primary key, version bigint not null, data jsonb not null, updated_at timestamptz not null default now())`;
      await sql`create table if not exists rainmaker_runs (id text primary key, started_at timestamptz not null, data jsonb not null, updated_at timestamptz not null default now())`;
      await sql`create index if not exists rainmaker_runs_started on rainmaker_runs (started_at desc)`;
    })().catch((err) => {
      ready = null;
      throw err;
    });
    return ready;
  }

  return {
    kind: "postgres",
    label: `Postgres (${host})`,
    persistent: true,
    async load() {
      await init();
      let rows = await sql<{ version: string; data: Partial<Db> }[]>`select version, data from rainmaker_store where id = 'main'`;
      if (!rows.length) {
        const seed = seedDb({ withSamples: true });
        await sql`insert into rainmaker_store (id, version, data) values ('main', 1, ${json({ ...seed, runs: [] })}) on conflict (id) do nothing`;
        rows = await sql<{ version: string; data: Partial<Db> }[]>`select version, data from rainmaker_store where id = 'main'`;
      }
      const db = migrate(parseJson<Partial<Db>>(rows[0].data));
      db.runs = [];
      return { db, version: Number(rows[0].version) };
    },
    async save(db, version) {
      // Runs live in their own table; never store them in the main document.
      const rows = await sql<{ version: string }[]>`
        update rainmaker_store set data = ${json({ ...db, runs: [] })}, version = version + 1, updated_at = now()
        where id = 'main' and version = ${version} returning version`;
      return rows.length ? Number(rows[0].version) : null;
    },
    async getRun(id) {
      await init();
      const rows = await sql<{ data: AgentRun }[]>`select data from rainmaker_runs where id = ${id}`;
      return rows[0] ? parseJson<AgentRun>(rows[0].data) : undefined;
    },
    async putRun(run) {
      await init();
      const c = compactRun(run);
      await sql`
        insert into rainmaker_runs (id, started_at, data) values (${c.id}, ${c.startedAt}, ${json(c)})
        on conflict (id) do update set data = excluded.data, updated_at = now()`;
      if (c.events.length <= 2) {
        // New run: keep the table to the latest 100.
        await sql`delete from rainmaker_runs where id in (select id from rainmaker_runs order by started_at desc offset 100)`;
      }
    },
    async listRuns(limit) {
      await init();
      const rows = await sql<{ data: AgentRun }[]>`select data from rainmaker_runs order by started_at desc limit ${limit}`;
      return rows.map((r) => parseJson<AgentRun>(r.data));
    },
  };
}

// ── Public API ────────────────────────────────────────────────

type State = { backend: Backend | null; chain: Promise<unknown>; cached: { db: Db; at: number } | null };
const g = globalThis as { __rmStore2?: State };
const state: State = (g.__rmStore2 ??= { backend: null, chain: Promise.resolve(), cached: null });

export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  return url && /^postgres(ql)?:\/\//.test(url) ? url : undefined;
}

function backend(): Backend {
  if (!state.backend) {
    const url = databaseUrl();
    state.backend = url ? pgBackend(url) : fileBackend();
  }
  return state.backend;
}

/** A snapshot of the database. Mutating it changes nothing; use update(). */
export async function readDb(): Promise<Db> {
  const b = backend();
  // Postgres: reuse a read for a moment so one page render doesn't query
  // several times. Writes on this instance refresh it immediately.
  if (b.kind === "postgres" && state.cached && Date.now() - state.cached.at < 1000) return structuredClone(state.cached.db);
  const { db } = await b.load();
  if (b.kind === "postgres") state.cached = { db, at: Date.now() };
  return structuredClone(db);
}

/** Run fn against the latest data and save. fn may re-run on a conflict. */
export function update<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  const run = state.chain.then(async () => {
    const out = await casUpdate(backend(), fn);
    if (backend().kind === "postgres") state.cached = { db: out.db, at: Date.now() };
    return out.result;
  });
  state.chain = run.catch(() => undefined);
  return run;
}

export async function getStoredRun(id: string): Promise<AgentRun | undefined> {
  return backend().getRun(id);
}

export async function putStoredRun(run: AgentRun): Promise<void> {
  await backend().putRun(run);
}

export async function listStoredRuns(limit = 40): Promise<AgentRun[]> {
  return backend().listRuns(limit);
}

export async function storageInfo(): Promise<{ kind: "file" | "postgres"; label: string; persistent: boolean }> {
  const b = backend();
  await b.load();
  return { kind: b.kind, label: b.label, persistent: b.persistent };
}
