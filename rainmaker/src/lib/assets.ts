import "server-only";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import { databaseUrl, newId } from "./store";

// Binary files Rainmaker makes (ad art, voiceovers): a table in Postgres, or
// files next to the JSON database. Kept out of the main document so it stays
// small.

export interface Asset {
  id: string;
  mime: string;
  bytes: Buffer;
  createdAt: string;
}

const MAX_BYTES = 12 * 1024 * 1024;

type State = { sql?: postgres.Sql; ready?: Promise<void>; dir?: string };
const g = globalThis as { __rmAssets?: State };
const state: State = (g.__rmAssets ??= {});

function pg(): postgres.Sql | undefined {
  const url = databaseUrl();
  if (!url) return undefined;
  state.sql ??= postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 15, prepare: false, onnotice: () => {} });
  state.ready ??= state.sql`create table if not exists rainmaker_assets (id text primary key, mime text not null, bytes bytea not null, created_at timestamptz not null default now())`
    .then(() => undefined)
    .catch((err) => {
      state.ready = undefined;
      throw err;
    });
  return state.sql;
}

async function dir(): Promise<string> {
  if (state.dir) return state.dir;
  const preferred = path.join(process.env.DATA_DIR || path.join(process.cwd(), ".data"), "assets");
  try {
    await fs.mkdir(preferred, { recursive: true });
    state.dir = preferred;
  } catch {
    state.dir = path.join(os.tmpdir(), "rainmaker-data", "assets");
    await fs.mkdir(state.dir, { recursive: true });
  }
  return state.dir;
}

const SAFE_ID = /^asset_[a-z0-9]+$/;

export async function putAsset(bytes: Buffer, mime: string): Promise<string> {
  if (bytes.length > MAX_BYTES) throw new Error("File too large to store");
  const id = newId("asset");
  const sql = pg();
  if (sql) {
    await state.ready;
    await sql`insert into rainmaker_assets (id, mime, bytes) values (${id}, ${mime}, ${bytes})`;
  } else {
    const d = await dir();
    await fs.writeFile(path.join(d, id), bytes);
    await fs.writeFile(path.join(d, `${id}.json`), JSON.stringify({ mime, createdAt: new Date().toISOString() }));
  }
  return id;
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  if (!SAFE_ID.test(id)) return undefined;
  const sql = pg();
  if (sql) {
    await state.ready;
    const rows = await sql<{ mime: string; bytes: Buffer; created_at: Date }[]>`select mime, bytes, created_at from rainmaker_assets where id = ${id}`;
    return rows[0] ? { id, mime: rows[0].mime, bytes: Buffer.from(rows[0].bytes), createdAt: rows[0].created_at.toISOString() } : undefined;
  }
  const d = await dir();
  try {
    const meta = JSON.parse(await fs.readFile(path.join(d, `${id}.json`), "utf8")) as { mime: string; createdAt: string };
    return { id, mime: meta.mime, bytes: await fs.readFile(path.join(d, id)), createdAt: meta.createdAt };
  } catch {
    return undefined;
  }
}

export async function deleteAssets(ids: string[]): Promise<void> {
  const safe = ids.filter((id) => SAFE_ID.test(id));
  if (!safe.length) return;
  const sql = pg();
  if (sql) {
    await state.ready;
    await sql`delete from rainmaker_assets where id in ${sql(safe)}`;
    return;
  }
  const d = await dir();
  await Promise.all(safe.flatMap((id) => [fs.rm(path.join(d, id), { force: true }), fs.rm(path.join(d, `${id}.json`), { force: true })]));
}
