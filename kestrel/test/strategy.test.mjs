// The strategy's building blocks: indicators, the brain, and the guarantee that nothing looks ahead.
import test from "node:test";
import assert from "node:assert/strict";
import { EMA, RMA, RSI, ATR, Window, resample, KalmanTrend } from "../src/strategy/indicators.mjs";
import { Brain, EXPERTS, explain } from "../src/strategy/brain.mjs";
import { SyntheticMarket } from "../src/data/synthetic.mjs";
import { normalizeSymbol, marketName, assetClassOf } from "../src/markets.mjs";

const H4 = 14_400_000;
const series = (sym = "BTC/USD", n = 900) => new SyntheticMarket({ history: n, now: Date.UTC(2026, 0, 1) }).bars(sym, H4, n, Date.UTC(2026, 0, 1));

test("EMA and Wilder's RMA follow their textbook definitions", () => {
  const e = new EMA(3); // alpha 0.5
  assert.equal(e.update(10), 10);
  assert.equal(e.update(20), 15);
  assert.equal(e.update(20), 17.5);
  const r = new RMA(3);
  r.update(3);
  r.update(6);
  assert.equal(r.update(9), 6); // simple mean while warming up
  assert.equal(r.update(12), (6 * 2 + 12) / 3);
});

test("RSI stays between 0 and 100, and is 100 when price only rises", () => {
  const rsi = new RSI(14);
  let v;
  for (let i = 1; i <= 40; i++) v = rsi.update(100 + i);
  assert.equal(v, 100);
  const rsi2 = new RSI(14);
  for (const b of series()) {
    const x = rsi2.update(b.c);
    if (x != null) assert.ok(x >= 0 && x <= 100);
  }
});

test("ATR uses the true range, including gaps", () => {
  const atr = new ATR(1);
  atr.update({ h: 10, l: 9, c: 9.5 });
  // Gap up: true range is from the previous close (9.5) to the high (13).
  assert.equal(atr.update({ h: 13, l: 12, c: 12.5 }), 3.5);
});

test("Window keeps the last N values in order", () => {
  const w = new Window(3);
  for (const x of [1, 2, 3, 4, 5]) w.push(x);
  assert.deepEqual(w.values(), [3, 4, 5]);
  assert.equal(w.ago(0), 5);
  assert.equal(w.ago(2), 3);
  assert.equal(w.ago(3), null);
  assert.equal(w.mean(), 4);
  assert.equal(w.max(), 5);
  assert.equal(w.min(), 3);
});

test("resample builds 4h bars from 1h bars and drops an unfinished one", () => {
  const H = 3_600_000;
  const t0 = Date.UTC(2026, 0, 1);
  const hourly = Array.from({ length: 10 }, (_, i) => ({ t: t0 + i * H, o: i, h: i + 1, l: i - 1, c: i + 0.5, v: 1 }));
  const four = resample(hourly, H, 4 * H);
  assert.equal(four.length, 2); // hours 0-3, 4-7; 8-9 unfinished
  assert.deepEqual(four[0], { t: t0, o: 0, h: 4, l: -1, c: 3.5, v: 4 });
  assert.equal(four[1].o, 4);
  assert.equal(four[1].c, 7.5);
});

test("the Kalman trend filter sees a steady climb as a positive slope", () => {
  const k = new KalmanTrend({ levelNoise: 0.01, slopeNoise: 1e-6 });
  let out;
  for (let i = 0; i < 300; i++) out = k.update(Math.log(100) + i * 0.002 + (i % 2 ? 0.001 : -0.001), 1e-6);
  assert.ok(out.slope > 0.0015 && out.slope < 0.0025, `slope ${out.slope}`);
  assert.ok(out.t > 2);
});

test("the brain warms up, then gives a score in [-1, 1] with weights that sum to 1", () => {
  const brain = new Brain();
  let v;
  for (const b of series()) v = brain.update(b);
  assert.ok(v.ready);
  assert.ok(v.score >= -1 && v.score <= 1);
  const w = Object.values(v.weights).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(w - 1) < 1e-9);
  assert.equal(Object.keys(v.scores).length, EXPERTS.length);
  for (const s of Object.values(v.scores)) assert.ok(s >= -1 && s <= 1);
  const ex = explain(v, { symbolName: "Bitcoin" });
  assert.ok(ex.summary.length > 10);
  assert.ok(Array.isArray(ex.reasons));
});

test("no look-ahead: the view at a bar doesn't change when later bars change", () => {
  const bars = series("ETH/USD", 900);
  const cut = 700;
  const a = new Brain();
  let at;
  for (let i = 0; i <= cut; i++) at = a.update(bars[i]);
  // Same history up to the cut, then wildly different future bars.
  const b = new Brain();
  let bt;
  for (let i = 0; i <= cut; i++) bt = b.update(bars[i]);
  for (let i = cut + 1; i < bars.length; i++) b.update({ ...bars[i], c: bars[i].c * 3, h: bars[i].h * 3, l: bars[i].l * 3, o: bars[i].o * 3 });
  assert.equal(at.score, bt.score);
  assert.deepEqual(at.scores, bt.scores);
});

test("market names: spoken names and tickers all resolve", () => {
  assert.equal(normalizeSymbol("bitcoin"), "BTC/USD");
  assert.equal(normalizeSymbol("Bitcoin"), "BTC/USD");
  assert.equal(normalizeSymbol("ETH"), "ETH/USD");
  assert.equal(normalizeSymbol("eth/usdt"), "ETH/USDT");
  assert.equal(normalizeSymbol("BTCUSD"), "BTC/USD");
  assert.equal(normalizeSymbol("apple"), "AAPL");
  assert.equal(normalizeSymbol("S&P 500"), "SPY");
  assert.equal(normalizeSymbol("nvda"), "NVDA");
  assert.equal(normalizeSymbol(""), null);
  assert.equal(marketName("SOL/USD"), "Solana");
  assert.equal(assetClassOf("TSLA"), "stock");
  assert.equal(assetClassOf("XRP/USD"), "crypto");
});
