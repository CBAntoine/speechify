// Risk rules and the backtester's books.
import test from "node:test";
import assert from "node:assert/strict";
import { RISK_LEVELS, riskPreset, desiredWeight, portfolioScale, trailStop, initialStop, barsPerYear } from "../src/risk.mjs";
import { backtest, computeMetrics, maxDrawdown, monteCarlo } from "../src/backtest.mjs";
import { Trader } from "../src/trader.mjs";
import { SyntheticMarket } from "../src/data/synthetic.mjs";

const H4 = 14_400_000;
const T0 = Date.UTC(2026, 0, 1);
const market = () => new SyntheticMarket({ history: 1500, now: T0 });

function view(score, { close = 100, emaLong = 90, vol = 0.01, volatile = false } = {}) {
  return { ready: true, score, regime: { volatile, label: "Trending up" }, f: { close, emaLong, volShort: vol, volLong: vol } };
}

test("buying needs a stronger signal than holding (hysteresis)", () => {
  const p = riskPreset("balanced");
  assert.equal(desiredWeight(view(0.08), p, { held: false }).weight, 0); // below the 0.12 to buy
  assert.ok(desiredWeight(view(0.08), p, { held: true }).weight > 0); // but enough to keep holding
  assert.equal(desiredWeight(view(-0.01), p, { held: true }).weight, 0); // below 0 sells
});

test("no new buys below the long-term average, and never above the per-market cap", () => {
  const p = riskPreset("balanced");
  assert.equal(desiredWeight(view(0.9, { close: 80, emaLong: 90 }), p, { held: false }).weight, 0);
  const w = desiredWeight(view(0.9, { vol: 0.0001 }), p, { held: false }).weight;
  assert.ok(w <= p.maxWeight + 1e-12 && w > 0);
});

test("high volatility means smaller positions; a cooldown blocks re-entry", () => {
  const p = riskPreset("balanced");
  const calm = desiredWeight(view(0.4, { vol: 0.004 }), p, { held: false, barsPerYear: 2190 }).weight;
  const wild = desiredWeight(view(0.4, { vol: 0.02 }), p, { held: false, barsPerYear: 2190 }).weight;
  assert.ok(wild < calm);
  assert.equal(desiredWeight(view(0.2), p, { held: false, cooldown: 5 }).weight, 0);
});

test("portfolio scaling respects the most-invested limit and the volatility target", () => {
  const p = riskPreset("careful");
  const { weights } = portfolioScale({ a: 0.25, b: 0.25, c: 0.25 }, {}, p);
  const total = Object.values(weights).reduce((x, y) => x + y, 0);
  assert.ok(total <= p.maxTotal + 1e-12);
  // Perfectly correlated, very volatile returns: scaled down to the target.
  const r = Array.from({ length: 60 }, (_, i) => (i % 2 ? 0.05 : -0.05));
  const out = portfolioScale({ a: 0.25, b: 0.25 }, { a: r, b: r }, p, 365);
  assert.ok(out.vol <= p.targetVol + 1e-9);
});

test("trailing stops only ever move up", () => {
  const p = riskPreset("balanced");
  let stop = initialStop(100, 2, p);
  assert.equal(stop, 100 - p.stopAtr * 2);
  stop = trailStop(stop, 120, 2, p);
  assert.equal(stop, 120 - p.stopAtr * 2);
  assert.equal(trailStop(stop, 105, 2, p), stop); // price fell back: stop stays
});

test("bars per year for crypto and stocks", () => {
  assert.equal(barsPerYear(H4, "crypto"), 2190);
  assert.equal(barsPerYear(86_400_000, "stock"), 252);
});

test("every risk preset is internally consistent", () => {
  for (const r of Object.values(RISK_LEVELS)) {
    assert.ok(r.enter > r.exit, r.id);
    assert.ok(r.maxWeight <= r.maxTotal, r.id);
    assert.ok(r.maxDrawdown > r.dailyLoss, r.id);
  }
});

test("metrics: drawdown, returns and a repeatable Monte Carlo", () => {
  assert.equal(maxDrawdown([100, 120, 90, 130]), 90 / 120 - 1);
  const curve = Array.from({ length: 200 }, (_, i) => ({ t: T0 + i * 86_400_000, equity: 100 * (1 + 0.001 * i + 0.01 * Math.sin(i)) }));
  const m = computeMetrics(curve, [{ pnl: 5, ret: 0.05, bars: 3 }, { pnl: -2, ret: -0.02, bars: 2 }]);
  assert.ok(Math.abs(m.totalReturn - (curve.at(-1).equity / 100 - 1)) < 1e-12);
  assert.equal(m.trades, 2);
  assert.equal(m.winRate, 0.5);
  assert.equal(m.profitFactor, 2.5);
  const a = monteCarlo(curve, { seed: 3 });
  const b = monteCarlo(curve, { seed: 3 });
  assert.deepEqual(a, b);
  assert.ok(a.returnP5 <= a.returnP50 && a.returnP50 <= a.returnP95);
});

test("a backtest keeps honest books: cash + holdings = equity, fees charged, nothing during warm-up", () => {
  const m = market();
  const data = { "BTC/USD": m.bars("BTC/USD", H4, 1500, T0), "ETH/USD": m.bars("ETH/USD", H4, 1500, T0) };
  const r = backtest({ data, timeframeMs: H4, risk: "balanced", costs: { maker: 0.0025, taker: 0.004, slippage: 0.0005 }, montecarlo: false });
  assert.ok(r.trades.length > 0, "should trade on 1500 bars of trending synthetic data");
  assert.ok(r.metrics.fees > 0);
  // Nothing happens before the brains are ready.
  assert.ok(r.fills.every((f) => f.t > r.from));
  // Fees add up: each fill's fee is its value times the maker or taker rate.
  for (const f of r.fills) {
    const rate = ["stop", "breaker"].includes(f.reason) ? 0.004 : 0.0025;
    assert.ok(Math.abs(f.fee - f.qty * f.price * rate) < 1e-6);
  }
  // Round trips: pnl = proceeds - cost - fees.
  for (const t of r.trades) assert.ok(Math.abs(t.pnl - (t.proceeds - t.cost - t.fees)) < 1e-6);
  assert.ok(r.benchmark.totalReturn > -1);
  assert.ok(r.summary.includes("Kestrel"));
});

test("the safety stop sells everything and halts; resume clears it", () => {
  const t = new Trader({ symbols: ["X"], risk: "balanced" });
  t.peak = 10_000;
  const plan = t.plan({ cash: 2_000, positions: { X: 50 }, prices: { X: 100 }, t: T0 }); // equity 7000: -30%
  assert.ok(t.halted);
  assert.deepEqual(plan.orders.map((o) => [o.symbol, o.side, o.qty, o.reason]), [["X", "sell", 50, "breaker"]]);
  assert.equal(plan.events[0].type, "breaker");
  assert.equal(t.plan({ cash: 7000, positions: {}, prices: { X: 100 }, t: T0 + 1 }).orders.length, 0);
  t.resume();
  assert.equal(t.halted, null);
});

test("the daily loss limit stops new buys for the rest of the day", () => {
  const t = new Trader({ symbols: ["X"], risk: "careful" });
  t.plan({ cash: 10_000, positions: {}, prices: { X: 100 }, t: T0 }); // day starts at 10,000
  const plan = t.plan({ cash: 9_600, positions: {}, prices: { X: 100 }, t: T0 + 3_600_000 }); // -4% > 3%
  assert.ok(plan.events.some((e) => e.type === "daily-limit"));
  assert.ok(t.noBuysUntil > T0);
});

test("the trader's books survive a restart", () => {
  const t = new Trader({ symbols: ["X"] });
  t.onFill({ symbol: "X", side: "buy", qty: 2, price: 50, fee: 0.25, t: T0, reason: "enter" });
  const saved = JSON.parse(JSON.stringify(t.exportState()));
  const t2 = new Trader({ symbols: ["X"] });
  t2.importState(saved);
  assert.equal(t2.stopFor("X"), t.stopFor("X"));
  const trade = t2.onFill({ symbol: "X", side: "sell", qty: 2, price: 60, fee: 0.3, t: T0 + 1, reason: "exit" });
  assert.ok(Math.abs(trade.pnl - (120 - 100 - 0.55)) < 1e-9);
});
