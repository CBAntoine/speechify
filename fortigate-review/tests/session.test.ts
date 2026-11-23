import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { downloadOutputs, follow, type Printer, type SessionEvent } from "../src/session.ts";

const quiet: Printer = { message() {}, detail() {}, heading() {} };

const ev = (e: Record<string, unknown>) => ({ processed_at: "2026-11-23T12:00:00Z", ...e }) as unknown as SessionEvent;
const message = (id: string, text: string) => ev({ id, type: "agent.message", content: [{ type: "text", text }] });
const ask = (id: string) => ev({ id, type: "agent.tool_use", name: "bash", input: { command: "rm -rf /workspace" }, evaluated_permission: "ask" });
const idle = (id: string, reason: string) => ev({ id, type: "session.status_idle", stop_reason: { type: reason }, stop_details: null });
const graded = (id: string, result: string) =>
  ev({ id, type: "span.outcome_evaluation_end", result, explanation: "", iteration: 0, outcome_id: "outc_1", outcome_evaluation_start_id: "sevt_0", usage: {} });
const confirmation = (id: string, toolUseId: string) => ev({ id, type: "user.tool_confirmation", tool_use_id: toolUseId, result: "deny" });

/** A stand-in for the SDK client. Each stream can end with a dropped connection. */
function fakeClient(script: { streams: { events: SessionEvent[]; drop?: boolean }[]; history?: SessionEvent[] }) {
  const sent: { events: Record<string, unknown>[] }[] = [];
  let streamCalls = 0;
  const client = {
    beta: {
      sessions: {
        events: {
          stream: async () => {
            const s = script.streams[streamCalls++] ?? { events: [] };
            return (async function* () {
              for (const e of s.events) yield e;
              if (s.drop) throw new Error("socket hang up");
            })();
          },
          list: () =>
            (async function* () {
              for (const e of script.history ?? []) yield e;
            })(),
          send: async (_id: string, body: { events: Record<string, unknown>[] }) => {
            sent.push(body);
            return {};
          },
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, sent, streamCalls: () => streamCalls };
}

test("answers a call that waits for approval and stops at the end of the turn", async () => {
  const { client, sent } = fakeClient({
    streams: [{ events: [message("e1", "Reading the config"), ask("e2"), idle("e3", "requires_action"), graded("e4", "satisfied"), idle("e5", "end_turn")] }],
  });
  let kickoffs = 0;
  const asked: string[] = [];
  const ending = await follow(client, "sesn_1", async () => void kickoffs++, {
    approve: async (call) => (asked.push(call.id), false),
    print: quiet,
    unattended: true,
  });
  assert.deepEqual(ending, { stopReason: "end_turn", outcome: "satisfied" });
  assert.equal(kickoffs, 1);
  assert.deepEqual(asked, ["e2"]);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].events[0].type, "user.tool_confirmation");
  assert.equal(sent[0].events[0].tool_use_id, "e2");
  assert.equal(sent[0].events[0].result, "deny");
});

test("reports a budget pause as the stop reason", async () => {
  const { client } = fakeClient({ streams: [{ events: [message("e1", "Working"), idle("e2", "budget_reached")] }] });
  const ending = await follow(client, "sesn_1", async () => {}, { approve: async () => true, print: quiet, unattended: true });
  assert.equal(ending.stopReason, "budget_reached");
});

test("after a dropped connection, replays history without answering a call twice", async () => {
  const { client, sent, streamCalls } = fakeClient({
    streams: [{ events: [message("e1", "Reading the config")], drop: true }, { events: [] }],
    history: [
      message("e1", "Reading the config"),
      ask("e2"),
      confirmation("e3", "e2"),
      ask("e4"),
      graded("e5", "needs_revision"),
    ],
  });
  const asked: string[] = [];
  const kickoffs: number[] = [];
  const ending = follow(client, "sesn_1", async () => void kickoffs.push(1), {
    approve: async (call) => (asked.push(call.id), true),
    print: quiet,
    unattended: false,
    retryDelayMs: 1,
  });
  // The second stream ends without a stop, so the loop keeps reconnecting until it gives up.
  await assert.rejects(ending, /Lost the connection/);
  assert.equal(kickoffs.length, 1, "the outcome is sent once");
  assert.deepEqual(asked, ["e4"], "e2 was already answered while we were away");
  assert.equal(sent.filter((b) => b.events[0].type === "user.tool_confirmation").length, 1);
  assert.equal(streamCalls(), 5);
});

test("stops when the history shows the session already finished", async () => {
  const { client } = fakeClient({
    streams: [{ events: [message("e1", "Working")], drop: true }],
    history: [message("e1", "Working"), graded("e2", "satisfied"), idle("e3", "end_turn")],
  });
  const ending = await follow(client, "sesn_1", async () => {}, { approve: async () => true, print: quiet, unattended: true, retryDelayMs: 1 });
  assert.deepEqual(ending, { stopReason: "end_turn", outcome: "satisfied" });
});

test("downloads outputs and keeps the newest copy of each file", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgt-out-"));
  const files = [
    { id: "file_2", filename: "report.md", created_at: "2026-11-23T12:05:00Z" },
    { id: "file_1", filename: "report.md", created_at: "2026-11-23T12:01:00Z" },
    { id: "file_3", filename: "findings.json", created_at: "2026-11-23T12:05:01Z" },
  ];
  const bodies: Record<string, string> = { file_1: "draft 1", file_2: "draft 2", file_3: "{}" };
  let lists = 0;
  const client = {
    beta: {
      files: {
        list: (params: { scope_id: string; betas: string[] }) => {
          assert.equal(params.scope_id, "sesn_1");
          assert.deepEqual(params.betas, ["managed-agents-2026-04-01"]);
          const page = lists++ === 0 ? [] : files;
          return (async function* () {
            for (const f of page) yield f;
          })();
        },
        download: async (id: string) => new Response(bodies[id]),
      },
    },
  } as unknown as Anthropic;
  const saved = await downloadOutputs(client, "sesn_1", dir, 1);
  assert.deepEqual(saved.sort(), ["findings.json", "report.md"]);
  assert.equal(fs.readFileSync(path.join(dir, "report.md"), "utf8"), "draft 2");
  assert.equal(lists, 2, "retries once when the outputs aren't listed yet");
});
