import { test } from "node:test";
import assert from "node:assert/strict";

// Two separately loaded copies of the module stand in for two server instances.
const load = (tag) => import(`../../src/lib/server/signing.ts?${tag}`);

test("without SESSION_SECRET, cookies signed on one server verify on another", async () => {
  delete process.env.SESSION_SECRET;
  process.env.ELEVENLABS_API_KEY = "sk_test_0123456789abcdef0123456789abcdef";
  const a = await load("a");
  const b = await load("b");
  const cookie = a.sign({ d: "2026-11-20", v: 1, t: 0 });
  assert.deepEqual(b.verify(cookie), { d: "2026-11-20", v: 1, t: 0 });
  assert.equal(b.verify(cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"))), null);
});

test("SESSION_SECRET wins over the derived secret", async () => {
  process.env.ELEVENLABS_API_KEY = "sk_test_0123456789abcdef0123456789abcdef";
  process.env.SESSION_SECRET = "a-very-long-session-secret-value";
  const a = await load("c");
  const cookie = a.sign({ x: 1 }); // signed with SESSION_SECRET
  assert.deepEqual(a.verify(cookie), { x: 1 });
  delete process.env.SESSION_SECRET;
  const b = await load("d"); // derived secret only
  assert.equal(b.verify(cookie), null);
});
