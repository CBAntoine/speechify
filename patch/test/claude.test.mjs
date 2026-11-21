// End to end: Claude building TV apps. The person describes an app; Patch asks Claude (here a stand-in
// for Anthropic's API that answers like the real one) to write it, shows it being built, installs it
// on the simulated Fire TV, and asks Claude again to change it. Nothing here reaches Anthropic.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSimulator } from "../sim/simulator.mjs";
import { startClaudeApi } from "../sim/claude-api.mjs";
import { fakeTemplate } from "../sim/apk-fixture.mjs";
import { startApp } from "../src/app.mjs";
import { entryData, readZip } from "../src/apk/zip.mjs";
import { costOf, readAnswer } from "../src/tvapps/claude.mjs";

let sim;
let claude;
let app;
let base;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-claude-test-"));
const TV = "Kids Room Fire TV";

const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const appById = async (id) => (await api("GET", "/api/tvapps")).apps.find((a) => a.id === id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Until Claude has finished with the app (or the app is gone). */
async function settled(id) {
  for (let i = 0; i < 200; i++) {
    const a = await appById(id);
    if (!a || !a.job || a.job.status === "failed") return a;
    await sleep(50);
  }
  throw new Error("Claude never finished");
}
const SNAKE = `<!doctype html><html><head><meta charset="utf-8"><title>Snake</title></head><body><canvas id="c"></canvas><script>window.tvkit = { back: function () { return false; } };</script></body></html>`;

before(async () => {
  sim = await startSimulator({ prefix: "127.0.14" });
  claude = await startClaudeApi();
  app = await startApp({ port: 0, demo: true, dataDir, overrides: { ...sim.overrides, tvappTemplate: fakeTemplate(), tvappsPort: 0, claudeBase: claude.url }, autoScan: false, log: () => {} });
  base = `http://127.0.0.1:${app.port}`;
  await api("POST", "/api/scan");
  const r = await api("POST", "/api/control", { device: TV, action: "pair" });
  assert.ok(r.ok, r.message);
});

after(async () => {
  await app?.close();
  await sim?.stop();
  await claude?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("Claude's answer is read safely, and its cost estimated", () => {
  const msg = (content, stop_reason = "end_turn") => ({ stop_reason, content });
  const app = { about: "A game.", html: "<html><body>x</body></html>" };
  assert.deepEqual(readAnswer(msg([{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(app) }])), { about: "A game.", html: "<!doctype html>\n<html><body>x</body></html>" });
  // After a fallback: the answer after the switch, or the text carried across it.
  const full = JSON.stringify(app);
  assert.equal(readAnswer(msg([{ type: "text", text: full.slice(0, 9) }, { type: "fallback" }, { type: "text", text: full }])).about, "A game.");
  assert.equal(readAnswer(msg([{ type: "text", text: full.slice(0, 9) }, { type: "fallback" }, { type: "text", text: full.slice(9) }])).about, "A game.");
  assert.throws(() => readAnswer(msg([], "refusal")), /wouldn't build that/);
  assert.throws(() => readAnswer(msg([{ type: "text", text: full.slice(0, 30) }], "max_tokens")), /too long/);
  assert.throws(() => readAnswer(msg([{ type: "text", text: '{"about":"x","html":"just words"}' }])), /wasn't a complete app/);
  assert.deepEqual(costOf({ input_tokens: 3000, output_tokens: 9000 }), { inputTokens: 3000, outputTokens: 9000, dollars: 0.19 });
});

test("Claude builds a TV app from a description, installs it, and changes it", async () => {
  // Not set up yet: the person is told what to do.
  let r = await api("POST", "/api/tvapps/build", { description: "a snake game", device: TV });
  assert.equal(r.ok, false);
  assert.match(r.message, /add your Anthropic API key/);
  // A wrong key isn't kept; a right one is checked with the Models API first (no tokens used).
  r = await api("POST", "/api/settings", { anthropicApiKey: "sk-ant-wrong" });
  assert.equal(r.checks.claude.ok, false);
  assert.match(r.checks.claude.message, /didn't accept your Anthropic API key/);
  assert.equal(r.settings.claude.hasKey, false);
  r = await api("POST", "/api/settings", { anthropicApiKey: ` ${claude.key} ` });
  assert.ok(r.checks.claude.ok, r.checks.claude.message);
  assert.deepEqual([r.settings.claude.hasKey, r.settings.claude.keyHint], [true, `…${claude.key.slice(-4)}`]);
  assert.ok(!JSON.stringify(r.settings).includes(claude.key), "the key never goes back to the browser");
  assert.equal(claude.requests.at(-1).path, "/v1/models/claude-opus-5-5");
  assert.equal((await api("GET", "/api/state")).setup.claude, true);

  // Build: answered at once, then built while the dashboard watches.
  claude.queue.push({ app: { about: "Steer the snake with the arrows; OK pauses.", html: SNAKE }, chunks: 12, delay: 15 });
  r = await api("POST", "/api/tvapps/build", { description: "a snake game for the kids, with a high score", name: "Snake", emoji: "🐍", color: "#43aa8b", device: TV });
  assert.ok(r.ok, r.message);
  assert.match(r.message, /is building “Snake”.*then I'll put it on Kids Room Fire TV/);
  const id = r.app.id;
  assert.deepEqual([r.app.built, r.app.job.status, r.app.kindLabel], [false, "building", "Built by Claude"]);
  // It can't go on a TV before it exists.
  r = await api("POST", `/api/tvapps/${id}/tv`, { device: TV });
  assert.match(r.message, /still building/);
  const done = await settled(id);
  assert.equal(done.job, null, done.job?.error);
  assert.deepEqual([done.built, done.version, done.madeBy, done.about], [true, 1, "claude", "Steer the snake with the arrows; OK pauses."]);
  assert.deepEqual(done.requests, ["a snake game for the kids, with a high score"]);
  assert.match(done.lastBuild.message, /Claude built “Snake”\. Steer the snake.*Snake is on Kids Room Fire TV now/);
  assert.equal(done.lastBuild.cost.dollars, 0.19);
  assert.ok(done.tvs.some((t) => t.name === TV && t.upToDate));

  // What Patch asked Claude for.
  const ask = claude.messages().at(-1);
  assert.equal(ask.headers.authorization || `Bearer ${ask.headers["x-api-key"]}`, `Bearer ${claude.key}`);
  assert.match(ask.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.equal(ask.body.model, "claude-opus-5-5");
  assert.equal(ask.body.stream, true);
  assert.equal(ask.body.fallbacks, "default");
  assert.deepEqual(ask.body.thinking, { type: "adaptive" });
  assert.equal(ask.body.output_config.effort, "high");
  assert.equal(ask.body.output_config.format.type, "json_schema");
  assert.deepEqual(ask.body.output_config.format.schema.required, ["about", "html"]);
  assert.match(ask.body.system[0].text, /window\.tvkit/);
  const asked = ask.body.messages[0].content;
  assert.match(asked, /a snake game for the kids, with a high score/);
  assert.match(asked, /Its name: Snake/);
  assert.match(asked, /Kids Room Fire TV, Amazon Fire TV Stick 4K Max.*installed as an app/);

  // On the TV: a real app with Claude's page inside, under its own name.
  const pkg = `app.patch.tvapp.${id}`;
  assert.equal(sim.state.firetv.installed[pkg].label, "Snake");
  const apk = (await app.tvapps.apk(id)).apk;
  const page = entryData(readZip(apk).entries.find((e) => e.name === "assets/app/index.html")).toString();
  assert.equal(page, SNAKE);

  // A change: Claude gets the app as it is and what to change, and the new version replaces the old one.
  claude.queue.push({ app: { about: "A faster snake.", html: SNAKE.replace("Snake</title>", "Snake 2</title>") } });
  r = await api("POST", `/api/tvapps/${id}/improve`, { instruction: "make the snake faster" });
  assert.ok(r.ok, r.message);
  assert.match(r.message, /Claude is changing “Snake”.*update it on Kids Room Fire TV/);
  r = await api("POST", `/api/tvapps/${id}/improve`, { instruction: "and blue" });
  assert.match(r.message, /still working on “Snake”/);
  const changed = await settled(id);
  assert.equal(changed.job, null, changed.job?.error);
  assert.deepEqual([changed.version, changed.about], [2, "A faster snake."]);
  assert.deepEqual(changed.requests, ["a snake game for the kids, with a high score", "make the snake faster"]);
  const change = claude.messages().at(-1).body.messages[0].content;
  assert.match(change, /<app>\n<!doctype html>.*<title>Snake<\/title>/s);
  assert.match(change, /<change>\nmake the snake faster\n<\/change>/);
  assert.match(change, /- a snake game for the kids/);
  assert.equal(sim.state.firetv.installed[pkg].versionCode, 2);
  assert.ok(changed.tvs[0].upToDate);

  // Ready-made kinds aren't Claude's to change.
  r = await api("POST", "/api/tvapps", { name: "Notes", kind: "notes", content: "Milk" });
  r = await api("POST", `/api/tvapps/${r.app.id}/improve`, { instruction: "bigger" });
  assert.match(r.message, /Claude changes the apps it built/);
});

test("When Claude can't build an app: what the person is told, trying again, and stopping", async () => {
  // Claude declines: the app shows why, and can be tried again.
  claude.queue.push({ refusal: true });
  let r = await api("POST", "/api/tvapps/build", { description: "a quiz about planets", name: "Planets" });
  assert.ok(r.ok, r.message);
  let a = await settled(r.app.id);
  assert.equal(a.job.status, "failed");
  assert.match(a.job.error, /wouldn't build that/);
  claude.queue.push({ app: { about: "Planet quiz.", html: SNAKE } });
  r = await api("POST", `/api/tvapps/${a.id}/retry`);
  assert.ok(r.ok, r.message);
  a = await settled(a.id);
  assert.deepEqual([a.job, a.built], [null, true]);
  assert.match(a.lastBuild.message, /It isn't on a TV yet/);

  // After a fallback, the fallback model's answer is used.
  claude.queue.push({ fallback: { app: { about: "Weather board.", html: SNAKE } } });
  r = await api("POST", "/api/tvapps/build", { description: "the weather for this week" });
  a = await settled(r.app.id);
  assert.deepEqual([a.job, a.about, a.name], [null, "Weather board.", "Weather"]);

  // Errors from Anthropic in plain words.
  for (const [reply, words] of [
    [{ status: 529, type: "overloaded_error" }, /overloaded/],
    [{ status: 402, type: "billing_error" }, /out of credit/],
    [{ text: "Sorry, here's some advice instead." }, /wasn't a complete app/],
    [{ app: { about: "x", html: "<html><body>" + "x".repeat(410 * 1024) + "</body></html>" } }, /bigger than a TV app can be/],
  ]) {
    claude.queue.push(reply);
    r = await api("POST", "/api/tvapps/build", { description: "a drawing app" });
    a = await settled(r.app.id);
    assert.equal(a.job.status, "failed");
    assert.match(a.job.error, words);
    await api("POST", `/api/tvapps/${a.id}/remove`);
  }

  // Stopping a build: the app that was never built goes away.
  claude.queue.push({ hang: true });
  r = await api("POST", "/api/tvapps/build", { description: "a big clock", name: "Big clock" });
  const slow = r.app.id;
  for (let i = 0; i < 100 && (await appById(slow)).job.phase !== "thinking"; i++) await sleep(20);
  r = await api("POST", `/api/tvapps/${slow}/cancel`);
  assert.ok(r.ok, r.message);
  assert.match(r.message, /wasn't built/);
  assert.equal(await appById(slow), undefined);

  // Two at a time at most.
  claude.queue.push({ hang: true }, { hang: true });
  const one = (await api("POST", "/api/tvapps/build", { description: "one" })).app.id;
  const two = (await api("POST", "/api/tvapps/build", { description: "two" })).app.id;
  r = await api("POST", "/api/tvapps/build", { description: "three" });
  assert.equal(r.ok, false);
  assert.match(r.message, /already working on 2 apps/);
  await api("POST", `/api/tvapps/${one}/cancel`);
  await api("POST", `/api/tvapps/${two}/cancel`);

  // A TV that can't take apps is turned down before Claude starts.
  const before = claude.messages().length;
  r = await api("POST", "/api/tvapps/build", { description: "a game", device: "Bathroom Speaker" });
  assert.equal(r.ok, false);
  assert.match(r.message, /can't take apps from Patch/);
  assert.equal(claude.messages().length, before);
});
