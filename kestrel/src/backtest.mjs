// The backtester replays history bar by bar through the very same Trader that trades live.
// Decisions made at a bar's close fill at the next bar's open, with fees and slippage. Stops are
// checked against each bar's low and fill at the stop, or at the open if price gapped through it.
import { Trader } from "./trader.mjs";
import { barsPerYear } from "./risk.mjs";

// Patient orders (entries, exits, resizes) rest as limit orders and pay the maker fee; stops and
// safety sells go out at market and pay the taker fee plus slippage.
export const DEFAULT_COSTS = { maker: 0.0025, taker: 0.004, slippage: 0.0005 };
const URGENT = new Set(["stop", "breaker", "manual-sell", "sell-all"]);

/**
 * @param data {[symbol]: bars[]} bars sorted by time, {t,o,h,l,c,v}
 * @returns {summary, metrics, benchmark, equity, trades, fills, montecarlo}
 */
export function backtest({ data, timeframeMs = 3_600_000, assetClass = "crypto", risk = "balanced", riskOverrides = {}, costs = DEFAULT_COSTS, cash = 10_000, brain = {}, minOrder = 10, addAt, trimAt, resumeAfterDays = 7, curvePoints = 400, montecarlo = true, seed = 7 } = {}) {
  const symbols = Object.keys(data).filter((s) => data[s]?.length);
  if (!symbols.length) throw new Error("No price history to test on.");
  const bpy = barsPerYear(timeframeMs, assetClass);
  const trader = new Trader({ symbols, risk, riskOverrides, barsPerYear: bpy, brain, minOrder, timeframeMs, assetClass, ...(addAt != null && { addAt }), ...(trimAt != null && { trimAt }) });
  const times = [...new Set(symbols.flatMap((s) => data[s].map((b) => b.t)))].sort((a, b) => a - b);
  const at = Object.fromEntries(symbols.map((s) => [s, new Map(data[s].map((b) => [b.t, b]))]));
  // A single `fee` means the same fee for every order.
  const maker = costs.maker ?? costs.fee ?? DEFAULT_COSTS.maker;
  const taker = costs.taker ?? costs.fee ?? DEFAULT_COSTS.taker;
  const slip = costs.slippage ?? DEFAULT_COSTS.slippage;

  let cashLeft = cash;
  const pos = Object.fromEntries(symbols.map((s) => [s, 0]));
  const last = {};
  let pending = [];
  const fills = [];
  const trades = [];
  const curve = [];
  let feesPaid = 0;
  let turnover = 0;
  let readyAt = null;
  let exposedBars = 0;
  let countedBars = 0;
  const events = [];

  const fill = (symbol, side, qty, price, t, reason) => {
    if (!(qty > 0)) return;
    const value = qty * price;
    const f = value * (URGENT.has(reason) ? taker : maker);
    feesPaid += f;
    turnover += value;
    if (side === "buy") {
      cashLeft -= value + f;
      pos[symbol] += qty;
    } else {
      cashLeft += value - f;
      pos[symbol] -= qty;
      if (pos[symbol] * price < 0.01) pos[symbol] = 0;
    }
    fills.push({ t, symbol, side, qty, price, fee: f, reason });
    const trade = trader.onFill({ symbol, side, qty, price, fee: f, t, reason });
    if (trade) trades.push(trade);
  };

  for (const t of times) {
    // 1. Orders decided at the last close fill at this bar's open.
    const keep = [];
    for (const o of pending) {
      const bar = at[o.symbol].get(t);
      if (!bar) {
        keep.push(o);
        continue;
      }
      const sl = URGENT.has(o.reason) ? slip : 0;
      if (o.side === "sell") fill(o.symbol, "sell", Math.min(o.qty, pos[o.symbol]), bar.o * (1 - sl), t, o.reason);
      else {
        const price = bar.o * (1 + sl);
        const notional = Math.min(o.notional, cashLeft / (1 + maker));
        if (notional >= minOrder) fill(o.symbol, "buy", notional / price, price, t, o.reason);
      }
    }
    pending = keep;

    // 2. Stops, during the bar.
    for (const s of symbols) {
      const bar = at[s].get(t);
      if (!bar || !(pos[s] > 0)) continue;
      const stop = trader.stopFor(s);
      if (stop != null && bar.l <= stop) fill(s, "sell", pos[s], Math.min(bar.o, stop) * (1 - slip), t, "stop");
    }

    // 3. The bar closes: every brain reads it.
    for (const s of symbols) {
      const bar = at[s].get(t);
      if (!bar) continue;
      trader.ingest(s, bar);
      last[s] = bar.c;
    }

    const ready = symbols.every((s) => trader.views.get(s)?.ready);
    let equity = cashLeft;
    for (const s of symbols) equity += pos[s] * (last[s] ?? 0);
    if (ready && readyAt == null) readyAt = t;
    if (readyAt != null) {
      curve.push({ t, equity });
      countedBars++;
      if (symbols.some((s) => pos[s] > 0)) exposedBars++;
    }

    // 4. Decide for the next bar. After a safety stop, assume the person resumes a week later.
    if (!ready) continue;
    if (trader.halted && resumeAfterDays != null && t - trader.halted.t >= resumeAfterDays * 86_400_000) {
      events.push({ t, type: "resumed", level: "info", text: `Assumed you resumed the bot ${resumeAfterDays} days after the safety stop.` });
      trader.resume();
    }
    const plan = trader.plan({ cash: cashLeft, positions: { ...pos }, prices: { ...last }, t });
    for (const e of plan.events) events.push({ t, ...e });
    pending = plan.orders;
  }

  if (readyAt == null) throw new Error(`Not enough history: the strategy needs about ${trader.brains.values().next().value.fe.p.warmup} bars before it can trade.`);

  // Benchmark: buy every market in equal parts when the strategy became ready, and hold.
  const benchStart = Object.fromEntries(symbols.map((s) => [s, at[s].get(readyAt)?.c ?? data[s].find((b) => b.t >= readyAt)?.c]));
  const benchCurve = curve.map(({ t }) => {
    let v = 0;
    for (const s of symbols) {
      const px = closeAtOrBefore(data[s], t);
      v += (cash / symbols.length) * (px / benchStart[s]);
    }
    return { t, equity: v };
  });

  const metrics = computeMetrics(curve, trades, { cash, feesPaid, turnover, exposure: countedBars ? exposedBars / countedBars : 0 });
  const benchmark = computeMetrics(benchCurve, [], { cash });
  const result = {
    symbols,
    timeframeMs,
    risk,
    costs: { maker, taker, slippage: slip },
    from: readyAt,
    to: times.at(-1),
    metrics,
    benchmark,
    equity: downsample(curve, curvePoints),
    benchmarkEquity: downsample(benchCurve, curvePoints),
    trades,
    fills,
    events,
    openPositions: Object.fromEntries(symbols.filter((s) => pos[s] > 0).map((s) => [s, { qty: pos[s], value: pos[s] * last[s], stop: trader.stopFor(s) }])),
  };
  if (montecarlo) result.montecarlo = monteCarlo(curve, { seed });
  result.summary = summarize(result);
  return result;
}

function closeAtOrBefore(bars, t) {
  let lo = 0;
  let hi = bars.length - 1;
  if (t < bars[0].t) return bars[0].c;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return bars[lo].c;
}

/** Daily closes of an equity curve (the standard basis for Sharpe and Sortino). */
export function dailyReturns(curve) {
  const byDay = new Map();
  for (const p of curve) byDay.set(Math.floor(p.t / 86_400_000), p.equity);
  const v = [...byDay.values()];
  const r = [];
  for (let i = 1; i < v.length; i++) r.push(v[i] / v[i - 1] - 1);
  return r;
}

export function maxDrawdown(values) {
  let peak = -Infinity;
  let mdd = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    mdd = Math.min(mdd, v / peak - 1);
  }
  return mdd;
}

export function computeMetrics(curve, trades = [], { cash = curve[0]?.equity ?? 1, feesPaid = 0, turnover = 0, exposure = null } = {}) {
  if (curve.length < 2) return null;
  const start = curve[0].equity;
  const end = curve.at(-1).equity;
  const days = Math.max((curve.at(-1).t - curve[0].t) / 86_400_000, 1);
  const totalReturn = end / start - 1;
  const cagr = Math.pow(end / start, 365 / days) - 1;
  const dr = dailyReturns(curve);
  const mean = dr.reduce((a, b) => a + b, 0) / (dr.length || 1);
  const sd = Math.sqrt(dr.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(dr.length - 1, 1));
  const downside = Math.sqrt(dr.reduce((a, b) => a + Math.min(b, 0) ** 2, 0) / Math.max(dr.length, 1));
  const mdd = maxDrawdown(curve.map((p) => p.equity));
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0);
  return {
    start,
    end,
    days: Math.round(days),
    totalReturn,
    cagr,
    volatility: sd * Math.sqrt(365),
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(365) : 0,
    sortino: downside > 0 ? (mean / downside) * Math.sqrt(365) : 0,
    maxDrawdown: mdd,
    calmar: mdd < 0 ? cagr / -mdd : 0,
    trades: trades.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : wins.length ? Infinity : 0,
    bestTrade: trades.length ? Math.max(...trades.map((t) => t.ret)) : 0,
    worstTrade: trades.length ? Math.min(...trades.map((t) => t.ret)) : 0,
    avgBarsHeld: trades.length ? trades.reduce((a, t) => a + t.bars, 0) / trades.length : 0,
    fees: feesPaid,
    turnover: turnover / cash,
    exposure,
  };
}

/** A small seeded random number generator, so Monte Carlo runs are repeatable. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Monte Carlo: reshuffle the strategy's own daily returns in 5-day blocks (keeping streaks
 * together) to see the range of one-year outcomes the same edge could have produced.
 */
export function monteCarlo(curve, { sims = 1000, days = 365, block = 5, seed = 7 } = {}) {
  const r = dailyReturns(curve);
  if (r.length < 30) return null;
  const rand = rng(seed);
  const finals = [];
  const dds = [];
  for (let k = 0; k < sims; k++) {
    let v = 1;
    let peak = 1;
    let mdd = 0;
    let n = 0;
    while (n < days) {
      let i = Math.floor(rand() * r.length);
      for (let j = 0; j < block && n < days; j++, n++) {
        v *= 1 + r[(i + j) % r.length];
        peak = Math.max(peak, v);
        mdd = Math.min(mdd, v / peak - 1);
      }
    }
    finals.push(v - 1);
    dds.push(mdd);
  }
  const q = (arr, p) => {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(p * s.length))];
  };
  return {
    sims,
    days,
    returnP5: q(finals, 0.05),
    returnP50: q(finals, 0.5),
    returnP95: q(finals, 0.95),
    drawdownP50: q(dds, 0.5),
    drawdownP95: q(dds, 0.05),
    chanceOfLoss: finals.filter((x) => x < 0).length / sims,
  };
}

function downsample(curve, n) {
  if (curve.length <= n) return curve.map((p) => ({ t: p.t, equity: round2(p.equity) }));
  const out = [];
  const step = (curve.length - 1) / (n - 1);
  for (let i = 0; i < n; i++) {
    const p = curve[Math.round(i * step)];
    out.push({ t: p.t, equity: round2(p.equity) });
  }
  return out;
}

const round2 = (x) => Math.round(x * 100) / 100;
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;

function summarize(r) {
  const m = r.metrics;
  const b = r.benchmark;
  const lines = [
    `Kestrel: ${pct(m.totalReturn)} (worst dip ${pct(m.maxDrawdown)}), against ${pct(b.totalReturn)} for buying and holding (worst dip ${pct(b.maxDrawdown)}).`,
    `${m.trades} trades, ${(m.winRate * 100).toFixed(0)}% winners, profit factor ${Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞"}, invested ${((m.exposure ?? 0) * 100).toFixed(0)}% of the time, fees $${m.fees.toFixed(2)}.`,
  ];
  if (r.montecarlo) lines.push(`Range of one-year outcomes from the same edge (Monte Carlo): ${pct(r.montecarlo.returnP5)} to ${pct(r.montecarlo.returnP95)}, middle ${pct(r.montecarlo.returnP50)}.`);
  return lines.join(" ");
}
