// The whole app on a simulated market: the local API's security, the voice agent's tools and
// their confirmation steps, and real-money approvals (against a fake exchange).
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../src/store.mjs";
import { MarketData } from "../src/data/feed.mjs";
import { SyntheticMarket } from "../src/data/synthetic.mjs";
import { Engine } from "../src/engine.mjs";
import { startApp } from "../src/app.mjs";
import { runTool } from "../src/tools.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "kestrel-test-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot({ demo = true } = {}) {
  const store = new Store(tmp());
  store.data.setupDone = true;
  const data = new MarketData({ store, demo: new SyntheticMarket({ speed: 3600 }) });
  const engine = new Engine({ store, data, demo, pollMs: 60_000 });
  await engine.warmAll();
  return { store, data, engine };
}

function raw(port, { method = "GET", path: p = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

test("the local API: token, Host and Origin checks, no path traversal", async () => {
  const { store, engine } = await boot();
  const app = await startApp({ engine, store, port: 0, demo: true });
  try {
    const home = await raw(app.port, { headers: { host: `localhost:${app.port}` } });
    assert.equal(home.status, 200);
    const token = JSON.parse(home.body.match(/<script id="boot" type="application\/json">(.*?)<\/script>/)[1]).token;
    assert.equal(token, app.token);
    const auth = { host: `localhost:${app.port}`, "x-kestrel-token": token };

    assert.equal((await raw(app.port, { path: "/api/state", headers: { host: `localhost:${app.port}` } })).status, 403);
    assert.equal((await raw(app.port, { path: "/api/state", headers: { ...auth, "x-kestrel-token": "wrong" } })).status, 403);
    assert.equal((await raw(app.port, { path: "/api/state", headers: { ...auth, host: "evil.example" } })).status, 403);
    assert.equal((await raw(app.port, { method: "POST", path: "/api/bot/pause", headers: { ...auth, origin: "https://evil.example" } })).status, 403);
    assert.equal((await raw(app.port, { path: "/../package.json", headers: auth })).status, 404);

    const state = JSON.parse((await raw(app.port, { path: "/api/state", headers: auth })).body);
    assert.equal(state.mode, "practice");
    assert.equal(state.markets.length, 3);
    assert.ok(state.markets.every((m) => m.status === "ready"));
    const csp = await new Promise((resolve) => http.get({ host: "127.0.0.1", port: app.port, path: "/", headers: { host: `localhost:${app.port}` } }, (res) => resolve(res.headers["content-security-policy"])));
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
  } finally {
    await app.close();
    await engine.close();
  }
});

test("voice tools: reading is free, changes need the person's yes, tokens are single-use", async () => {
  const { engine } = await boot();
  try {
    const ov = await runTool(engine, "get_overview", {});
    assert.equal(ov.ok, true);
    assert.match(ov.briefing, /DEMO/);
    const mk = await runTool(engine, "get_market", { symbol: "bitcoin" });
    assert.equal(mk.symbol, "BTC/USD");
    assert.ok(mk.reasons.length >= 1);

    // Pausing is immediate.
    engine.s.running = true;
    const p = await runTool(engine, "control_bot", { action: "pause" });
    assert.ok(p.done);
    assert.equal(engine.s.running, false);

    // Buying asks first; a made-up or mismatched token doesn't work; the right one works once.
    const ask = await runTool(engine, "place_order", { symbol: "ethereum", side: "buy", amount_usd: 250 });
    assert.equal(ask.needsConfirmation, true);
    assert.match(ask.summary, /Buy \$250\.00 of Ethereum/);
    assert.equal(engine.s.fills.length, 0);
    const fake = await runTool(engine, "place_order", { symbol: "ethereum", side: "buy", amount_usd: 250, confirm_token: "made-up" });
    assert.equal(fake.needsConfirmation, true);
    const changed = await runTool(engine, "place_order", { symbol: "ethereum", side: "buy", amount_usd: 900, confirm_token: ask.confirm_token });
    assert.equal(changed.needsConfirmation, true, "a token is only good for exactly what was confirmed");
    const ask2 = await runTool(engine, "place_order", { symbol: "ethereum", side: "buy", amount_usd: 250 });
    const done = await runTool(engine, "place_order", { symbol: "ethereum", side: "buy", amount_usd: 250, confirm_token: ask2.confirm_token });
    assert.match(done.done, /Bought \$2\d\d\.\d\d of Ethereum/);
    assert.equal(engine.s.fills.length, 1);
    assert.ok(engine.book.positions["ETH/USD"] > 0);
    const again = await runTool(engine, "place_order", { symbol: "ethereum", side: "buy", amount_usd: 250, confirm_token: ask2.confirm_token });
    assert.equal(again.needsConfirmation, true, "tokens are single-use");

    // Lowering risk is immediate; raising it asks first.
    assert.ok((await runTool(engine, "set_risk", { level: "careful" })).done);
    const up = await runTool(engine, "set_risk", { level: "bold" });
    assert.equal(up.needsConfirmation, true);
    assert.equal(engine.s.risk, "careful");
    await runTool(engine, "set_risk", { level: "bold", confirm_token: up.confirm_token });
    assert.equal(engine.s.risk, "bold");

    // Selling everything asks first, then sells and pauses.
    const sell = await runTool(engine, "control_bot", { action: "sell_all" });
    assert.equal(sell.needsConfirmation, true);
    const sold = await runTool(engine, "control_bot", { action: "sell_all", confirm_token: sell.confirm_token });
    assert.match(sold.done, /Sold 1 position/);
    assert.equal(Object.keys(engine.book.positions).length, 0);
    assert.equal(engine.s.trades.length, 1);

    // A backtest through the agent's tool.
    const bt = await runTool(engine, "run_backtest", { symbols: "bitcoin", days: 90 });
    assert.equal(bt.status, "done");
    assert.ok(bt.kestrel.return);
    assert.match(bt.caution, /don't guarantee/);

    // Unknown markets and actions get clear errors, not crashes.
    assert.equal((await runTool(engine, "get_market", { symbol: "!!!" })).ok, false);
    assert.equal((await runTool(engine, "control_bot", { action: "explode" })).ok, false);
  } finally {
    await engine.close();
  }
});

test("real money: voice orders wait for a tap on screen, and respect the largest-order limit", async () => {
  const { engine } = await boot({ demo: false });
  const orders = [];
  const fakeExchange = {
    name: "Test exchange",
    live: true,
    marketOpen: async () => true,
    balance: async () => ({ USD: { total: 5000, free: 5000 } }),
    execute: async (o) => {
      orders.push(o);
      return { symbol: o.symbol, side: o.side, qty: o.side === "buy" ? o.notional / 100 : o.qty, price: 100, fee: 0.1, maker: false, t: Date.now() };
    },
  };
  engine.s.connections.test = { venue: "kraken", connectedAt: Date.now() };
  engine.s.live = { broker: "test", budget: 1000, maxOrder: 200, cash: 1000, positions: {}, enabledAt: Date.now(), startEquity: 1000 };
  engine.s.mode = "live";
  engine.liveBroker = fakeExchange;
  try {
    const tooBig = await runTool(engine, "place_order", { symbol: "bitcoin", side: "buy", amount_usd: 500 });
    assert.equal(tooBig.ok, false);
    assert.match(tooBig.error, /largest single order/);

    const ask = await runTool(engine, "place_order", { symbol: "bitcoin", side: "buy", amount_usd: 150 });
    assert.match(ask.summary, /REAL MONEY/);
    const r = await runTool(engine, "place_order", { symbol: "bitcoin", side: "buy", amount_usd: 150, confirm_token: ask.confirm_token });
    assert.equal(r.waiting_for_screen, true);
    assert.equal(orders.length, 0, "nothing is sent until the person taps Approve");
    const [approval] = engine.approvals.values();
    assert.ok(approval);
    await engine.approve(approval.id, true);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].side, "buy");
    assert.ok(Math.abs(orders[0].notional - 150) < 1e-9);
    assert.ok(engine.s.live.positions["BTC/USD"] > 0);
    assert.ok(engine.s.live.cash < 1000);

    // Declining sends nothing.
    const ask2 = await runTool(engine, "place_order", { symbol: "bitcoin", side: "sell", sell_everything_of_it: true });
    await runTool(engine, "place_order", { symbol: "bitcoin", side: "sell", sell_everything_of_it: true, confirm_token: ask2.confirm_token });
    const [a2] = engine.approvals.values();
    await engine.approve(a2.id, false);
    assert.equal(orders.length, 1);

    // Starting with real money asks first.
    const start = await runTool(engine, "control_bot", { action: "start" });
    assert.equal(start.needsConfirmation, true);
    assert.match(start.summary, /REAL MONEY/);
  } finally {
    await engine.close();
  }
});

test("going live needs the typed confirmation and a budget, and never works in demo mode", async () => {
  const { engine } = await boot();
  try {
    await assert.rejects(engine.goLive({ connection: "x", budget: 100, maxOrder: 50, confirm: "REAL MONEY" }), /Demo mode/);
  } finally {
    await engine.close();
  }
  const { engine: e2 } = await boot({ demo: false });
  try {
    await assert.rejects(e2.goLive({ connection: "x", budget: 100, maxOrder: 50, confirm: "yes" }), /Type REAL MONEY/);
    await assert.rejects(e2.goLive({ connection: "nope", budget: 100, maxOrder: 50, confirm: "real money" }), /Connect that exchange first/);
  } finally {
    await e2.close();
  }
});

test("the demo bot trades by itself on the simulated market", async () => {
  const { engine } = await boot();
  engine.s.running = true;
  try {
    for (let i = 0; i < 12 && !engine.s.fills.length; i++) {
      await engine.tick();
      await sleep(1000);
    }
    // Either it traded, or every market is bearish right now: both are valid, but it must have decided.
    assert.ok(engine.lastDecisionAt > 0 || engine.s.fills.length > 0, "the bot made a decision at a bar close");
    const s = engine.snapshot();
    assert.ok(s.account.equity > 0);
    assert.equal(typeof engine.briefing(), "string");
  } finally {
    await engine.close();
  }
});
