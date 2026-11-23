import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DYNAMIC_DEFAULTS, PROMPT, TOOLS } from "../src/voice/spec.ts";
import { TESTS, TEST_PREFIX, testBody } from "../src/voice/tests.ts";

const saved = JSON.parse(fs.readFileSync(new URL("../voice-agent.json", import.meta.url), "utf8")) as {
  agent_id?: string;
  tool_ids?: Record<string, string>;
  test_ids?: Record<string, string>;
};
const toolNames = new Set(TOOLS.map((t) => t.name));

test("every {{variable}} in the prompt has a default, so conversations can start without it", () => {
  const used = new Set([...PROMPT.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]));
  assert.ok(used.size > 0);
  for (const name of used) assert.ok(name in DYNAMIC_DEFAULTS, `{{${name}}} has no default`);
});

test("the conversation tests only use tools the agent has", () => {
  for (const t of TESTS) {
    for (const turn of t.turns) if ("tool" in turn) assert.ok(toolNames.has(turn.tool), `${t.name}: ${turn.tool}`);
    const e = t.expect;
    if ("calls" in e) assert.ok(toolNames.has(e.calls), `${t.name}: ${e.calls}`);
    if ("avoids" in e) assert.ok(toolNames.has(e.avoids), `${t.name}: ${e.avoids}`);
  }
});

test("each test ends where the agent speaks next, with unique names", () => {
  const names = TESTS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
  for (const t of TESTS) {
    const body = testBody(t, saved.tool_ids ?? {});
    assert.equal(body.name, `${TEST_PREFIX}${t.name}`);
    const history = body.chat_history as Record<string, unknown>[];
    const last = history[history.length - 1];
    assert.ok(last.role === "user" || Array.isArray(last.tool_results), `${t.name} ends with an agent message`);
    // Every tool call in the history has its result right after it.
    history.forEach((h, i) => {
      if (Array.isArray(h.tool_calls)) {
        const call = (h.tool_calls as { request_id: string }[])[0];
        const next = history[i + 1]?.tool_results as { request_id: string }[] | undefined;
        assert.equal(next?.[0]?.request_id, call.request_id, `${t.name}: call without a result`);
      }
    });
    for (const key of Object.keys(DYNAMIC_DEFAULTS)) assert.ok(key in (body.dynamic_variables as object), `${t.name}: no ${key}`);
  }
});

test("voice-agent.json has an ID for every tool and test", () => {
  assert.match(saved.agent_id ?? "", /^agent_/);
  for (const name of toolNames) assert.match(saved.tool_ids?.[name] ?? "", /^tool_/, `tool ${name}`);
  for (const t of TESTS) assert.match(saved.test_ids?.[t.name] ?? "", /^test_/, `test ${t.name}`);
});

test("a test body without the tool's ID asks for a sync instead of sending a bad test", () => {
  const t = TESTS.find((x) => "calls" in x.expect)!;
  assert.throws(() => testBody(t, {}), /voice:sync/);
});
