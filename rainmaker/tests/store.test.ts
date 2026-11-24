import { test } from "node:test";
import assert from "node:assert/strict";
import { casUpdate, compactRun, type Backend } from "../src/lib/store-core.ts";
import { seedDb } from "../src/lib/seed.ts";
import type { AgentRun, Db } from "../src/lib/types.ts";

/** In-memory backend that behaves like the Postgres one (compare-and-set). */
function memory(): Backend & { writes: number } {
  let doc = JSON.stringify(seedDb());
  let version = 1;
  const runs = new Map<string, AgentRun>();
  return {
    kind: "postgres",
    label: "memory",
    persistent: true,
    writes: 0,
    async load() {
      await new Promise((r) => setTimeout(r, Math.random() * 3));
      return { db: JSON.parse(doc) as Db, version };
    },
    async save(db, v) {
      await new Promise((r) => setTimeout(r, Math.random() * 3));
      if (v !== version) return null;
      doc = JSON.stringify(db);
      version += 1;
      this.writes += 1;
      return version;
    },
    async getRun(id) {
      return runs.get(id);
    },
    async putRun(run) {
      runs.set(run.id, run);
    },
    async listRuns() {
      return [...runs.values()];
    },
  };
}

test("concurrent writers never lose an update", async () => {
  const b = memory();
  // 30 "server instances" each add a task at the same moment.
  await Promise.all(
    Array.from({ length: 30 }, (_, i) =>
      casUpdate(
        b,
        (db) => {
          db.tasks.push({ id: `t${i}`, title: `Task ${i}`, done: false, createdBy: "test", createdAt: "" });
        },
        50
      )
    )
  );
  const { db } = await b.load();
  assert.equal(db.tasks.length, 30);
  assert.equal(new Set(db.tasks.map((t) => t.id)).size, 30);
});

test("a stale version is rejected and retried against fresh data", async () => {
  const b = memory();
  let calls = 0;
  const { db: first, version } = await b.load();
  // Someone else writes in between.
  await casUpdate(b, (db) => {
    db.profile.agencyName = "Other writer";
  });
  assert.equal(await b.save(first, version), null, "old version must not overwrite");
  await casUpdate(b, (db) => {
    calls += 1;
    db.profile.city = "Austin, TX";
  });
  const { db } = await b.load();
  assert.equal(db.profile.agencyName, "Other writer");
  assert.equal(db.profile.city, "Austin, TX");
  assert.ok(calls >= 1);
});

test("an error inside the update saves nothing", async () => {
  const b = memory();
  await assert.rejects(
    casUpdate(b, (db) => {
      db.profile.agencyName = "half-done";
      throw new Error("boom");
    })
  );
  const { db } = await b.load();
  assert.notEqual(db.profile.agencyName, "half-done");
  assert.equal(b.writes, 0);
});

test("compactRun caps event count and size", () => {
  const run: AgentRun = {
    id: "r",
    agentId: "ops",
    goal: "g",
    status: "running",
    runtime: "demo",
    startedAt: new Date().toISOString(),
    events: Array.from({ length: 900 }, (_, i) => ({ id: `e${i}`, at: "", kind: "message" as const, text: "x".repeat(i === 899 ? 9000 : 10), input: i === 899 ? { big: "y".repeat(5000) } : undefined })),
  };
  const c = compactRun(run);
  assert.equal(c.events.length, 400);
  assert.ok((c.events.at(-1)!.text ?? "").length <= 4001);
  assert.deepEqual(c.events.at(-1)!.input, { note: "large input omitted" });
});
