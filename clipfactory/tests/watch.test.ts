import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Claude's second look: every candidate goes over as a contact sheet plus what
// was said, and comes back rated. A local stand-in for the Messages API.
test("Claude watches contact sheets and rates every candidate", async () => {
  let body: Record<string, any> | null = null;
  const answer = {
    ratings: [
      { id: 1, score: 88, keep: true, note: "Clear crash, readable on a phone." },
      { id: 2, score: 140, keep: false, note: " A loading screen. " },
    ],
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      body = JSON.parse(raw);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const ev = (type: string, data: unknown) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      ev("message_start", { type: "message_start", message: { id: "msg_2", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 1 } } });
      ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: JSON.stringify(answer) } });
      ev("content_block_stop", { type: "content_block_stop", index: 0 });
      ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 120 } });
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
    const { claudeWatch } = await import("../src/server/pipeline/claude.ts");
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const out = await claudeWatch([
      { id: 1, title: "The building blew up", start: 57.5, end: 80, transcript: "No way! The whole building just blew up!", sheet: jpeg },
      { id: 2, title: "Menu", start: 100, end: 120, transcript: "", sheet: jpeg },
    ]);
    const content = body!.messages[0].content as { type: string; text?: string; source?: { media_type: string; data: string } }[];
    const images = content.filter((b) => b.type === "image");
    assert.equal(images.length, 2, "one contact sheet per candidate");
    assert.equal(images[0].source!.media_type, "image/jpeg");
    assert.equal(images[0].source!.data, jpeg.toString("base64"));
    assert.match(content[0].text!, /Candidate 1: "The building blew up" \(00:57\.5–01:20\.0\)/);
    assert.match(content[2].text!, /Said: \(nothing\)/);
    assert.equal(body!.output_config.effort, "medium");
    assert.equal(body!.output_config.format.type, "json_schema");
    assert.equal(body!.fallbacks, "default");
    assert.deepEqual(out.ratings.get(1), { score: 88, keep: true, note: "Clear crash, readable on a phone." });
    assert.deepEqual(out.ratings.get(2), { score: 100, keep: false, note: "A loading screen." }, "scores clamped, notes trimmed");
    assert.ok(out.usd > 0);
  } finally {
    server.close();
  }
});
