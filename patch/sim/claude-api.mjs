// Stands in for Anthropic's API in tests: answers like the real one (a Messages stream as server-sent
// events, errors in its JSON shape, the Models API), with whatever the test queues up next, and keeps
// every request so the test can check what Patch asked Claude for. Nothing here reaches Anthropic.
import http from "node:http";

const MODEL = "claude-opus-5-5";

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

/**
 * Queue entries, one per Messages request:
 *   { app: { about, html } }          the app as structured output (after some thinking)
 *   { text: "…" }                     any text as the answer
 *   { fallback: { app } }             a decline part way through, then the fallback model's answer
 *   { refusal: true }                 Claude declines
 *   { maxTokens: true }               cut off
 *   { hang: true }                    starts, then waits until the request is dropped
 *   { status, type, message }         an HTTP error
 * Each can add { chunks, delay } to stream the answer in pieces.
 */
export async function startClaudeApi({ key = "sk-ant-test-key" } = {}) {
  const requests = [];
  const queue = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const body = await readJson(req);
    requests.push({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body });
    const error = (status, type, message) =>
      res.writeHead(status, { "content-type": "application/json", "x-should-retry": "false", "request-id": "req_test" }).end(JSON.stringify({ type: "error", error: { type, message } }));
    // The SDK sends the key as a bearer token (older versions used x-api-key): either is accepted.
    const sent = req.headers["x-api-key"] || String(req.headers.authorization || "").replace(/^Bearer /, "");
    if (sent !== key) return error(401, "authentication_error", "invalid x-api-key");
    if (req.method === "GET" && url.pathname === `/v1/models/${MODEL}`) {
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ type: "model", id: MODEL, display_name: "Claude Opus 5.5", created_at: "2026-10-01T00:00:00Z" }));
    }
    if (!(req.method === "POST" && url.pathname === "/v1/messages")) return error(404, "not_found_error", "Not found");
    const next = queue.shift() || { app: { about: "A test app.", html: "<!doctype html><html><head><title>Test</title></head><body>Hello</body></html>" } };
    if (next.status) return error(next.status, next.type || "api_error", next.message || "Something went wrong");

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "request-id": "req_test" });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const pause = () => new Promise((r) => setTimeout(r, next.delay ?? 5));
    let index = 0;
    const block = async (start, deltas = []) => {
      send("content_block_start", { type: "content_block_start", index, content_block: start });
      for (const delta of deltas) {
        send("content_block_delta", { type: "content_block_delta", index, delta });
        await pause();
      }
      send("content_block_stop", { type: "content_block_stop", index });
      index++;
    };
    const textBlock = (text) => {
      const n = Math.max(1, next.chunks || 6);
      const size = Math.ceil(text.length / n);
      const parts = [];
      for (let i = 0; i < text.length; i += size) parts.push({ type: "text_delta", text: text.slice(i, i + size) });
      return block({ type: "text", text: "" }, parts);
    };
    const end = (stop_reason, extra = {}) => {
      send("message_delta", { type: "message_delta", delta: { stop_reason, stop_sequence: null, ...extra }, usage: { output_tokens: 9000 } });
      send("message_stop", { type: "message_stop" });
      res.end();
    };

    send("message_start", {
      type: "message_start",
      message: { id: "msg_test", type: "message", role: "assistant", model: MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3000, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    });
    if (next.refusal) return end("refusal", { stop_details: { type: "refusal", category: "cyber", explanation: "Declined in a test." } });
    await block({ type: "thinking", thinking: "", signature: "" }, [{ type: "signature_delta", signature: "c2lnbmF0dXJl" }]);
    if (next.hang) {
      await new Promise((r) => req.socket.once("close", r));
      return;
    }
    if (next.fallback) {
      const full = JSON.stringify(next.fallback.app);
      await textBlock(full.slice(0, 20));
      await block({ type: "fallback", from: { model: MODEL }, to: { model: "claude-opus-5" } });
      await textBlock(full);
      return end("end_turn");
    }
    await textBlock(next.text ?? JSON.stringify(next.app));
    end(next.maxTokens ? "max_tokens" : "end_turn");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    key,
    requests,
    queue,
    messages: () => requests.filter((r) => r.path === "/v1/messages"),
    close: () => new Promise((r) => server.close(r)),
  };
}
