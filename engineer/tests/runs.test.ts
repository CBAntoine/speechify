import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { buildBundle, BundleError } from "../src/review/bundle.ts";
import { cleanupInputs, reviewOutputs, reviewStatus, startReview } from "../src/review/runs.ts";

const sampleText = fs.readFileSync(new URL("../samples/branch-office.conf", import.meta.url), "utf8");
const hitsText = fs.readFileSync(new URL("../samples/branch-office-hits.json", import.meta.url), "utf8");

const sampleBundle = () =>
  buildBundle({
    configText: sampleText,
    configName: "branch-office.conf",
    hits: { text: hitsText, name: "hits.json", periodDays: 90, exportedAt: "2026-11-22T14:05:00.000Z" },
    reviewDate: "2026-11-23",
  });

test("builds the agent's inputs from a backup", () => {
  const b = sampleBundle();
  assert.equal(b.device, "BR-TOR-FW01");
  assert.deepEqual(b.files.map((f) => f.name), ["config.conf", "config.json", "hits.json", "run.json"]);
  assert.equal(b.redactions.length, 6);
  assert.doesNotMatch(b.files[0].content, /SAMPLEONLY/);
  const run = JSON.parse(b.files.find((f) => f.name === "run.json")!.content);
  assert.equal(run.inputs.hits_period_days, 90);
  assert.equal(run.source_file, "branch-office.conf");
});

test("explains inputs it can't use", () => {
  assert.throws(() => buildBundle({ configText: "hello", configName: "notes.txt", reviewDate: "2026-11-23" }), BundleError);
  assert.throws(
    () => buildBundle({ configText: sampleText, configName: "a.conf", deviations: { text: "{}", name: "dev.json" }, reviewDate: "2026-11-23" }),
    /JSON array/,
  );
  assert.throws(
    () => buildBundle({ configText: sampleText, configName: "a.conf", hits: { text: '{"x":1}', name: "h.json", periodDays: null, exportedAt: null }, reviewDate: "2026-11-23" }),
    /h\.json: Hit counts/,
  );
});

type Ev = Record<string, unknown>;

/** A stand-in for the SDK with one session. */
function fake(opts: { status?: string; events?: Ev[]; grades?: Ev[]; metadata?: Record<string, string>; failCreate?: boolean; files?: Ev[] } = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  let uploads = 0;
  const session = () => ({
    id: "sesn_1",
    status: opts.status ?? "running",
    created_at: "2026-11-23T12:00:00Z",
    metadata: opts.metadata ?? { device: "BR-TOR-FW01", review_date: "2026-11-23", inputs: "file_a,file_b" },
    outcome_evaluations: opts.grades ?? [],
    usage: { list_cost: { amount: "184", currency: "USD" } },
  });
  const client = {
    files: {
      upload: async () => ({ id: `file_${++uploads}` }),
      delete: async (id: string) => void calls.push({ name: "files.delete", args: [id] }),
    },
    beta: {
      sessions: {
        create: async (body: unknown) => {
          calls.push({ name: "sessions.create", args: [body] });
          if (opts.failCreate) throw new Error("boom");
          return { id: "sesn_1" };
        },
        retrieve: async () => session(),
        update: async (id: string, body: unknown) => void calls.push({ name: "sessions.update", args: [id, body] }),
        events: {
          list: () =>
            (async function* () {
              // Newest first, like order: "desc".
              for (const e of [...(opts.events ?? [])].reverse()) yield e;
            })(),
        },
      },
      files: {
        list: () =>
          (async function* () {
            for (const f of opts.files ?? []) yield f;
          })(),
        download: async (id: string) => new Response(`contents of ${id}`),
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

const ev = (type: string, extra: Ev = {}): Ev => ({ id: `sevt_${type}_${Math.random()}`, type, processed_at: "2026-11-23T12:01:00Z", ...extra });

test("starts a review with the outcome in the create call", async () => {
  const { client, calls } = fake();
  const res = await startReview(client, { agentId: "agent_1", environmentId: "env_1" }, sampleBundle(), { budgetCents: 500, kickoff: true, source: "console" });
  assert.equal(res.sessionId, "sesn_1");
  assert.deepEqual(res.uploaded, ["file_1", "file_2", "file_3", "file_4"]);
  const body = calls.find((c) => c.name === "sessions.create")!.args[0] as Record<string, any>;
  assert.equal(body.agent, "agent_1");
  assert.deepEqual(body.budget, { type: "limit", max_list_cost: { amount: "500", currency: "USD" } });
  assert.equal(body.metadata.inputs, "file_1,file_2,file_3,file_4");
  assert.equal(body.metadata.workflow, "NET-2");
  assert.equal(body.resources[0].mount_path, "/config.conf");
  assert.equal(body.initial_events[0].type, "user.define_outcome");
  assert.match(body.initial_events[0].description, /BR-TOR-FW01/);
});

test("deletes the uploads if the session can't be created", async () => {
  const { client, calls } = fake({ failCreate: true });
  await assert.rejects(startReview(client, { agentId: "a", environmentId: "e" }, sampleBundle(), { budgetCents: 500, kickoff: true, source: "console" }));
  assert.deepEqual(calls.filter((c) => c.name === "files.delete").map((c) => c.args[0]), ["file_1", "file_2", "file_3", "file_4"]);
});

test("reads where a review is", async () => {
  const now = Date.parse("2026-11-23T12:09:00Z");
  const starting = await reviewStatus(fake({ events: [ev("user.define_outcome"), ev("session.status_running")] }).client, "sesn_1", now);
  assert.equal(starting.phase, "starting");
  assert.equal(starting.minutes, 9);
  assert.equal(starting.costUsd, 1.84);

  const working = await reviewStatus(
    fake({ events: [ev("session.status_running"), ev("agent.tool_use", { name: "bash", input: { command: "python3 a.py" }, evaluated_permission: "allow" }), ev("agent.message", { content: [{ type: "text", text: "Parsing the policies." }] })] }).client,
    "sesn_1",
    now,
  );
  assert.equal(working.phase, "working");
  assert.equal(working.lastMessage, "Parsing the policies.");

  const grading = await reviewStatus(fake({ events: [ev("session.status_running"), ev("agent.message", { content: [] }), ev("span.outcome_evaluation_start", { iteration: 0 })] }).client, "sesn_1", now);
  assert.equal(grading.phase, "grading");
  assert.match(grading.detail, /draft 1/);
});

test("lists calls waiting for approval", async () => {
  const ask = ev("agent.tool_use", { id: "sevt_ask", name: "bash", input: { command: "curl example.com" }, evaluated_permission: "ask" });
  const { client } = fake({
    status: "idle",
    events: [ev("session.status_running"), ask, ev("session.status_idle", { stop_reason: { type: "requires_action" } })],
  });
  const s = await reviewStatus(client, "sesn_1");
  assert.equal(s.phase, "waiting");
  assert.deepEqual(s.pending, [{ id: "sevt_ask", tool: "bash", summary: "bash curl example.com" }]);
});

test("knows when a review finished or stopped", async () => {
  const done = await reviewStatus(
    fake({
      status: "idle",
      events: [ev("span.outcome_evaluation_end", { result: "satisfied" }), ev("session.status_idle", { stop_reason: { type: "end_turn" } })],
      grades: [{ iteration: 0, result: "needs_revision", explanation: "Lines missing" }, { iteration: 1, result: "satisfied", explanation: "All met" }],
    }).client,
    "sesn_1",
  );
  assert.equal(done.phase, "done");
  assert.match(done.detail, /passed its quality check/);
  assert.equal(done.grades.length, 2);

  const capped = await reviewStatus(fake({ status: "idle", events: [ev("agent.message", { content: [] }), ev("session.status_idle", { stop_reason: { type: "budget_reached" } })] }).client, "sesn_1");
  assert.equal(capped.phase, "stopped");
  assert.equal(capped.stopReason, "budget_reached");
  assert.match(capped.detail, /spending cap/);
});

test("downloads the newest copy of each text output", async () => {
  const { client } = fake({
    files: [
      { id: "f2", filename: "report.md", created_at: "2026-11-23T12:08:00Z" },
      { id: "f1", filename: "report.md", created_at: "2026-11-23T12:05:00Z" },
      { id: "f3", filename: "findings.json", created_at: "2026-11-23T12:08:01Z" },
      { id: "f4", filename: "chart.png", created_at: "2026-11-23T12:08:02Z" },
    ],
  });
  const out = await reviewOutputs(client, "sesn_1");
  assert.deepEqual(out.map((f) => `${f.name}=${f.text}`).sort(), ["findings.json=contents of f3", "report.md=contents of f2"]);
});

test("deletes the uploaded inputs once", async () => {
  const { client, calls } = fake();
  assert.equal(await cleanupInputs(client, "sesn_1"), 2);
  assert.deepEqual(calls.filter((c) => c.name === "files.delete").map((c) => c.args[0]), ["file_a", "file_b"]);
  assert.deepEqual(calls.find((c) => c.name === "sessions.update")!.args[1], { metadata: { inputs: null } });
  const none = fake({ metadata: { device: "x" } });
  assert.equal(await cleanupInputs(none.client, "sesn_1"), 0);
});
