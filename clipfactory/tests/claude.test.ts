import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// A local stand-in for the Messages API that streams a structured answer, so the
// orchestrator's request shape and parsing are tested without a real key.
test("Claude picks moments: request shape, streaming, structured output", async () => {
  let seen: { headers: http.IncomingHttpHeaders; body: Record<string, unknown> } | null = null;
  const answer = {
    moments: [
      { start: 57.5, end: 80, replay_at: 61, score: 93, hook: "no way", title: "The building blew up", reason: "Huge reaction to the explosion.", description: "Chat lost it.", hashtags: ["#gta", "Gaming"] },
      { start: 70, end: 90, replay_at: 75, score: 70, hook: "overlaps.", title: "x", reason: "x", description: "x", hashtags: [] },
      { start: 10, end: 12, replay_at: 11, score: 50, hook: "SHORT ONE!", title: "Too short", reason: "x", description: "x", hashtags: [] },
    ],
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen = { headers: req.headers, body: JSON.parse(raw) };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const ev = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      ev("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10000, output_tokens: 1 } } });
      ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      const text = JSON.stringify(answer);
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(0, 40) } });
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(40) } });
      ev("content_block_stop", { type: "content_block_stop", index: 0 });
      ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 500 } });
      ev("message_stop", { type: "message_stop" });
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.ANTHROPIC_API_KEY = "test-key";
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.CLAUDE_MODEL;
  try {
    const { claudeMoments, modelLabel } = await import("../src/server/pipeline/claude.ts");
    const phases: string[] = [];
    const out = await claudeMoments({
      sourceTitle: "Heist stream",
      duration: 120,
      words: [{ w: "No", s: 58, e: 58.3 }],
      segments: [{ s: 58, e: 60, text: "No way! The whole building just blew up!" }],
      spikes: [{ t: 60.5, db: 20 }],
      count: 3,
      minSec: 15,
      maxSec: 30,
      instructions: "only the explosions",
      onProgress: (p) => phases.push(p),
    });
    // Request: the model, effort, structured output, server-side refusal fallback.
    const body = seen!.body;
    assert.equal(body.model, "claude-opus-5-5");
    assert.equal((body.output_config as { effort: string }).effort, "high");
    assert.equal((body.output_config as { format: { type: string } }).format.type, "json_schema");
    assert.equal(body.fallbacks, "default");
    assert.equal(body.thinking, undefined);
    assert.equal(body.temperature, undefined);
    assert.match(String(seen!.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
    const prompt = JSON.stringify(body.messages);
    assert.match(prompt, /\[00:58\.0–01:00\.0\] No way! The whole building just blew up!/);
    assert.match(prompt, /only the explosions/);
    assert.ok(phases.includes("writing"));
    // Parsing: overlaps dropped, too-short stretched to the minimum, hooks normalised.
    assert.equal(out.model, "claude-opus-5-5");
    assert.equal(out.picks.length, 2);
    assert.equal(out.picks[0].hook, "NO WAY.");
    assert.deepEqual(out.picks[0].hashtags, ["gta", "gaming"]);
    assert.equal(out.picks[1].end - out.picks[1].start, 15);
    assert.ok(out.usd > 0.04 && out.usd < 0.06, `cost ${out.usd}`);
    assert.equal(modelLabel("claude-opus-5-5"), "OPUS 5.5");
  } finally {
    server.close();
  }
});
