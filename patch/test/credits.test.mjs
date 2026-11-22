// When the ElevenLabs account's credits for the month are used up, ElevenLabs still hands out a
// session but won't start the conversation, and says only "The AI agent you are trying to reach is
// not available". Patch asks ElevenLabs for the account's credits and says plainly what's wrong.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startApp, voiceCredits } from "../src/app.mjs";
import { friendlyError, refusalMessage, creditsSummary, TOP_UP } from "../public/voice.js";

// Noon UTC on 4 December 2026, so the day reads the same in any time zone.
const RENEWS = 1796385600;
const ACCOUNTS = {
  "used-up": { character_count: 40562, character_limit: 40562 },
  plenty: { character_count: 1000, character_limit: 40562 },
  low: { character_count: 38562, character_limit: 40562 },
};

let eleven;
let base;
const seen = [];
before(async () => {
  // A stand-in for api.elevenlabs.io, answering the way the real one does.
  eleven = http.createServer((req, res) => {
    const key = req.headers["xi-api-key"];
    seen.push(`${req.method} ${req.url.split("?")[0]} ${key}`);
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (key === "limited") return json(401, { detail: { status: "missing_permissions", message: "The API key you used is missing the permission user_read to execute this operation." } });
    if (!ACCOUNTS[key]) return json(401, { detail: { status: "invalid_api_key" } });
    if (req.url === "/v1/user/subscription") return json(200, { tier: "starter", status: "active", ...ACCOUNTS[key], next_character_count_reset_unix: RENEWS, can_extend_character_limit: false });
    if (req.url.startsWith("/v1/convai/conversation/token")) return json(200, { token: "lk-token" });
    if (req.url.startsWith("/v1/convai/conversation/get-signed-url")) return json(200, { signed_url: "wss://example.invalid/convai" });
    json(404, { detail: "not found" });
  });
  await new Promise((r) => eleven.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${eleven.address().port}`;
});
after(() => eleven?.close());

test("Patch reads the month's ElevenLabs credits with the saved key", async () => {
  const usedUp = await voiceCredits({ apiKey: "used-up" }, base);
  assert.deepEqual(usedUp, { ok: true, used: 40562, limit: 40562, left: 0, renews: "2026-12-04T12:00:00.000Z", plan: "starter" });
  assert.equal((await voiceCredits({ apiKey: "plenty" }, base)).left, 39562);
  // A key limited to some parts of ElevenLabs can't see the balance; that's said, not guessed.
  assert.deepEqual(await voiceCredits({ apiKey: "limited" }, base), { ok: false, error: "permission" });
  assert.deepEqual(await voiceCredits({ apiKey: "" }, base), { ok: false, error: "nokey" });
  assert.deepEqual(await voiceCredits({ apiKey: "plenty" }, "http://127.0.0.1:1"), { ok: false, error: "network" });
  assert.ok(seen.includes("GET /v1/user/subscription used-up"), "it asks ElevenLabs, with the key in the xi-api-key header");
});

test("a conversation ElevenLabs won't start is explained in plain words", async () => {
  const usedUp = await voiceCredits({ apiKey: "used-up" }, base);
  const plenty = await voiceCredits({ apiKey: "plenty" }, base);
  const said = "Server error: The AI agent you are trying to reach is not available.";

  // Credits used up: what's wrong, when they come back, and how to carry on sooner.
  const m = refusalMessage(usedUp, said);
  assert.match(m, /^Your ElevenLabs credits for this month are used up \(40,562 of 40,562\), so ElevenLabs won't start a conversation\. They renew on December 4\./);
  assert.match(m, /add credits on elevenlabs\.io \(Developers, then Top Up\)\. The rest of Patch works as usual\.$/);
  assert.doesNotMatch(m, /not available/, "ElevenLabs' own words aren't needed once the reason is known");
  assert.equal(TOP_UP, "https://elevenlabs.io/app/developers");

  // Credits fine: ElevenLabs' words, and that it's worth trying again.
  assert.equal(refusalMessage(plenty, said), "ElevenLabs ended the conversation as it started (ElevenLabs said: “The AI agent you are trying to reach is not available.”). Your credits are fine (39,562 left this month), so try again in a minute.");
  // Balance unknown (no network, or a key that can't see it): the likely reason, and where to look.
  assert.match(refusalMessage({ ok: false, error: "permission" }, said), /^ElevenLabs wouldn't start the conversation \(ElevenLabs said: .*\)\. The usual reason is that the account's credits for this month are used up: you can see them at elevenlabs\.io, under Subscription\.$/);
  assert.match(refusalMessage(null, ""), /^ElevenLabs wouldn't start the conversation\. The usual reason/);

  // The raw message never reaches the person as it is.
  assert.match(friendlyError("The AI agent you are trying to reach is not available."), /credits for this month are used up/);
  assert.match(friendlyError(said, true), /credits for this month are used up/);
  assert.equal(friendlyError("The voice service hung up."), "The voice service hung up.");

  // Settings: the balance in one line.
  assert.equal(creditsSummary(plenty), "ElevenLabs credits this month: 39,562 of 40,562 left. They renew on December 4.");
  assert.match(creditsSummary(usedUp), /^Your ElevenLabs credits for this month are used up \(40,562 of 40,562\), so Patch can't talk or chat until they renew, unless you add credits\. They renew on December 4\.$/);
  assert.equal(creditsSummary({ ok: false, error: "permission" }), null);
});

test("the dashboard can ask for the credits (GET /api/voice/credits)", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-credits-"));
  const app = await startApp({ port: 0, dataDir, overrides: { elevenlabsBase: base }, autoScan: false, log: () => {} });
  try {
    const call = async (method, p, body) => (await fetch(`http://127.0.0.1:${app.port}${p}`, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
    assert.deepEqual(await call("GET", "/api/voice/credits"), { ok: false, error: "nokey" });
    // Saving the key checks it against (the stand-in) ElevenLabs, as it does against the real one.
    const saved = await call("POST", "/api/settings", { elevenlabsApiKey: "used-up" });
    assert.equal(saved.checks.elevenlabs.ok, true, JSON.stringify(saved.checks));
    const c = await call("GET", "/api/voice/credits");
    assert.equal(c.ok, true);
    assert.equal(c.left, 0);
    assert.equal(c.renews, "2026-12-04T12:00:00.000Z");
    // ElevenLabs still hands out a session with no credits left: Patch can't tell beforehand.
    assert.equal((await call("POST", "/api/voice/session", { mode: "voice" })).ok, true);
  } finally {
    await app.close();
  }
});
