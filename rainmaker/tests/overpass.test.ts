import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_OVERPASS_URLS, OverpassUnavailableError, overpassUrls, queryOverpass } from "../src/lib/prospecting/overpass.ts";

const UA = "test-agent";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const timeout = () => Promise.reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
const urls = ["https://a.example/api/interpreter", "https://b.example/api/interpreter", "https://c.example/api/interpreter"];

/** Fake fetch: answers each host from a script and records what was asked. */
function fakeFetch(script: Record<string, () => Promise<Response>>) {
  const calls: { host: string; ua: string | null; body: string }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const host = new URL(String(input)).host;
    const headers = new Headers(init?.headers);
    calls.push({ host, ua: headers.get("user-agent"), body: String(init?.body) });
    return script[host]();
  }) as typeof fetch;
  return { impl, calls };
}

test("OVERPASS_URL can list several servers; empty falls back to defaults", () => {
  assert.deepEqual(overpassUrls(" https://x.example/api/interpreter , https://y.example/api/interpreter "), [
    "https://x.example/api/interpreter",
    "https://y.example/api/interpreter",
  ]);
  assert.deepEqual(overpassUrls(undefined), DEFAULT_OVERPASS_URLS);
  assert.deepEqual(overpassUrls(" , "), DEFAULT_OVERPASS_URLS);
  assert.equal(DEFAULT_OVERPASS_URLS[0], "https://overpass-api.de/api/interpreter", "main instance first");
});

test("an overloaded server moves on to the next one, in order, and stops at the first answer", async () => {
  const { impl, calls } = fakeFetch({
    "a.example": () => Promise.resolve(new Response("Bad Gateway", { status: 502 })),
    "b.example": () => Promise.resolve(json({ elements: [{ type: "node", id: 1, lat: 1, lon: 2, tags: { name: "Acme Roofing" } }] })),
    "c.example": () => assert.fail("must not be called after a success"),
  });
  const seen: string[] = [];
  const r = await queryOverpass(urls, "[out:json];node(1);out;", { userAgent: UA, fetchImpl: impl, onAttempt: (a) => seen.push(`${a.host}:${a.ok}`) });
  assert.equal(r.elements.length, 1);
  assert.deepEqual(seen, ["a.example:false", "b.example:true"]);
  assert.deepEqual(calls.map((c) => c.host), ["a.example", "b.example"]);
  assert.ok(calls.every((c) => c.ua === UA), "identifies itself, as the usage policy asks");
  assert.ok(calls[0].body.startsWith("data="), "sends the query as form data");
});

test("timeouts, rate limits and 'ran out of time' remarks all count as failures", async () => {
  const { impl } = fakeFetch({
    "a.example": timeout,
    "b.example": () => Promise.resolve(new Response("Too Many Requests", { status: 429 })),
    "c.example": () => Promise.resolve(json({ elements: [{ type: "node", id: 9, lat: 1, lon: 2 }], remark: "runtime error: Query timed out in \"query\" at line 1 after 26 seconds." })),
  });
  await assert.rejects(
    () => queryOverpass(urls, "q", { userAgent: UA, fetchImpl: impl, firstTimeoutMs: 1000 }),
    (err: unknown) => {
      assert.ok(err instanceof OverpassUnavailableError);
      assert.deepEqual(err.attempts.map((a) => a.problem?.slice(0, 13)), ["timed out aft", "HTTP 429", "runtime error"]);
      assert.equal(err.attempts[2].elements, 1, "partial results are not trusted");
      return true;
    },
  );
});

test("a reply that isn't JSON counts as a failure", async () => {
  const { impl } = fakeFetch({
    "a.example": () => Promise.resolve(new Response("<html>maintenance</html>", { status: 200 })),
    "b.example": () => Promise.resolve(json({ elements: [] })),
    "c.example": () => assert.fail("not reached"),
  });
  const r = await queryOverpass(urls, "q", { userAgent: UA, fetchImpl: impl });
  assert.deepEqual(r.attempts.map((a) => a.ok), [false, true]);
  assert.equal(r.elements.length, 0, "an empty answer is still an answer");
});

test("the total time budget caps how many servers are tried", async () => {
  const { impl, calls } = fakeFetch({
    "a.example": () => new Promise((res) => setTimeout(() => res(new Response("busy", { status: 504 })), 60)),
    "b.example": () => assert.fail("no time left for a second server"),
    "c.example": () => assert.fail("no time left"),
  });
  await assert.rejects(() => queryOverpass(urls, "q", { userAgent: UA, fetchImpl: impl, budgetMs: 3_050 }), OverpassUnavailableError);
  assert.deepEqual(calls.map((c) => c.host), ["a.example"]);
});
