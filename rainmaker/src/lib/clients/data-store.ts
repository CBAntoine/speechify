import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { databaseUrl } from "@/lib/store";
import type { ClientData } from "@/lib/types";
import { casClientData, normalizeClientData, type DocBackend } from "./data-core";

// Each client's customers, messages, calls and coaching live in their own
// document: a row in Postgres (DATABASE_URL), or a JSON file next to the main
// database. Updates are compare-and-set, like the main store, so a webhook,
// the daily run and someone clicking in the app never overwrite each other.

const SAFE_ID = /^cli_[a-z0-9]+$/;

function assertId(id: string) {
  if (!SAFE_ID.test(id)) throw new Error("Not a client id");
}

function fileBackend(): DocBackend {
  let dir: string | null = null;
  const cache = new Map<string, { doc: ClientData; version: number }>();
  let writes: Promise<unknown> = Promise.resolve();

  async function resolveDir(): Promise<string> {
    if (dir) return dir;
    const preferred = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "clients");
    try {
      await fs.mkdir(preferred, { recursive: true });
      dir = preferred;
    } catch {
      dir = path.join(os.tmpdir(), "rainmaker-data", "clients");
      await fs.mkdir(dir, { recursive: true });
    }
    return dir;
  }

  return {
    kind: "file",
    async load(id) {
      assertId(id);
      const hit = cache.get(id);
      if (hit) return { doc: structuredClone(hit.doc), version: hit.version };
      let doc: ClientData;
      try {
        doc = normalizeClientData(JSON.parse(await fs.readFile(path.join(await resolveDir(), `${id}.json`), "utf8")) as Partial<ClientData>, id);
      } catch {
        doc = normalizeClientData(undefined, id);
      }
      cache.set(id, { doc, version: 1 });
      return { doc: structuredClone(doc), version: 1 };
    },
    async save(id, doc, version) {
      const hit = cache.get(id);
      if (!hit || hit.version !== version) return null;
      cache.set(id, { doc, version: version + 1 });
      const snapshot = JSON.stringify(doc);
      writes = writes
        .then(async () => {
          const file = path.join(await resolveDir(), `${id}.json`);
          const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
          await fs.writeFile(tmp, snapshot);
          await fs.rename(tmp, file);
        })
        .catch((err) => console.error("[rainmaker] could not save client data", err));
      return version + 1;
    },
    async remove(id) {
      assertId(id);
      cache.delete(id);
      await fs.rm(path.join(await resolveDir(), `${id}.json`), { force: true });
    },
  };
}

function pgBackend(url: string): DocBackend {
  const sql = postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 15, prepare: false, onnotice: () => {} });
  const json = (v: unknown) => sql.json(JSON.parse(JSON.stringify(v)) as postgres.JSONValue);
  let ready: Promise<void> | null = null;
  const init = () =>
    (ready ??= sql`create table if not exists rainmaker_client_data (id text primary key, version bigint not null, data jsonb not null, updated_at timestamptz not null default now())`
      .then(() => undefined)
      .catch((err) => {
        ready = null;
        throw err;
      }));

  return {
    kind: "postgres",
    async load(id) {
      assertId(id);
      await init();
      const rows = await sql<{ version: string; data: unknown }[]>`select version, data from rainmaker_client_data where id = ${id}`;
      if (!rows.length) return { doc: normalizeClientData(undefined, id), version: 0 };
      const data = typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
      return { doc: normalizeClientData(data as Partial<ClientData>, id), version: Number(rows[0].version) };
    },
    async save(id, doc, version) {
      await init();
      if (version === 0) {
        const rows = await sql<{ version: string }[]>`
          insert into rainmaker_client_data (id, version, data) values (${id}, 1, ${json(doc)})
          on conflict (id) do nothing returning version`;
        return rows.length ? 1 : null;
      }
      const rows = await sql<{ version: string }[]>`
        update rainmaker_client_data set data = ${json(doc)}, version = version + 1, updated_at = now()
        where id = ${id} and version = ${version} returning version`;
      return rows.length ? Number(rows[0].version) : null;
    },
    async remove(id) {
      assertId(id);
      await init();
      await sql`delete from rainmaker_client_data where id = ${id}`;
    },
  };
}

type State = { backend: DocBackend | null; chains: Map<string, Promise<unknown>> };
const g = globalThis as { __rmClientData?: State };
const state: State = (g.__rmClientData ??= { backend: null, chains: new Map() });

function backend(): DocBackend {
  if (!state.backend) {
    const url = databaseUrl();
    state.backend = url ? pgBackend(url) : fileBackend();
  }
  return state.backend;
}

/** A snapshot of one client's data. Changing it changes nothing; use updateClientData(). */
export async function readClientData(clientId: string): Promise<ClientData> {
  return (await backend().load(clientId)).doc;
}

/** Run fn against the client's latest data and save. fn may re-run on a conflict, so keep side effects out of it. */
export function updateClientData<T>(clientId: string, fn: (doc: ClientData) => T | Promise<T>): Promise<T> {
  const prev = state.chains.get(clientId) ?? Promise.resolve();
  const run = prev.then(async () => (await casClientData(backend(), clientId, fn)).result);
  const tail = run.catch(() => undefined);
  state.chains.set(clientId, tail);
  void tail.then(() => {
    if (state.chains.get(clientId) === tail) state.chains.delete(clientId);
  });
  return run;
}

export async function deleteClientData(clientId: string): Promise<void> {
  await backend().remove(clientId);
}
