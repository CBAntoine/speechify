// The Trader turns the brains' views into orders for a whole portfolio. The same class runs the
// backtester, practice trading and live trading, so what you test is exactly what trades.
//
// It manages only its own positions and its own budget: coins or shares already in your account
// are never touched.
import { Brain, explain } from "./strategy/brain.mjs";
import { riskPreset, desiredWeight, portfolioScale, initialStop, trailStop, barsPerYear as bpyFor } from "./risk.mjs";

export const STOP_COOLDOWN_BARS = 12;
const DAY = 86_400_000;

export class Trader {
  constructor({ symbols = [], risk = "balanced", riskOverrides = {}, barsPerYear = null, brain = {}, minOrder = 10, addAt = 1.0, trimAt = 0.5, timeframeMs = 14_400_000, assetClass = "crypto" } = {}) {
    this.preset = riskPreset(risk, riskOverrides);
    this.riskId = risk;
    this.riskOverrides = riskOverrides;
    this.brainParams = brain;
    this.minOrder = minOrder;
    this.addAt = addAt;
    this.trimAt = trimAt;
    this.defaults = { tfMs: timeframeMs, assetClass, bpy: barsPerYear };
    this.cfg = new Map(); // symbol → {tfMs, assetClass, bpy}
    this.brains = new Map();
    this.views = new Map();
    this.daily = new Map(); // symbol → Map(day → summed log return), for correlations across timeframes
    this.rets = new Map(); // symbol → Map(bar time → log return), for correlations on one timeframe
    this.meta = new Map(); // symbol → {stop, highest, entry, entryT, barsHeld, cost, qty, fees, proceeds, reason}
    this.cool = new Map();
    this.peak = null;
    this.day = null;
    this.dayStart = null;
    this.halted = null;
    this.noBuysUntil = 0;
    this.dailyNoted = null;
    for (const s of symbols) this.addSymbol(s);
  }

  get symbols() {
    return [...this.brains.keys()];
  }

  addSymbol(sym, { tfMs, assetClass } = {}) {
    const tf = tfMs ?? this.defaults.tfMs;
    const ac = assetClass ?? (String(sym).includes("/") ? "crypto" : this.defaults.assetClass);
    const prev = this.cfg.get(sym);
    if (!this.brains.has(sym) || (prev && prev.tfMs !== tf)) {
      this.brains.set(sym, new Brain(this.brainParams));
      this.views.delete(sym);
      this.daily.set(sym, new Map());
      this.rets.set(sym, new Map());
    }
    this.cfg.set(sym, { tfMs: tf, assetClass: ac, bpy: this.defaults.bpy ?? bpyFor(tf, ac) });
  }

  removeSymbol(sym) {
    this.brains.delete(sym);
    this.views.delete(sym);
    this.cfg.delete(sym);
    this.daily.delete(sym);
    this.rets.delete(sym);
  }

  setRisk(level, overrides = this.riskOverrides) {
    this.preset = riskPreset(level, overrides);
    this.riskId = level;
    this.riskOverrides = overrides;
    // Re-tighten any stop that is now looser than the new preset allows.
    for (const [sym, m] of this.meta) {
      const atr = this.views.get(sym)?.f?.atr;
      if (atr) m.stop = Math.max(m.stop, m.highest - this.preset.stopAtr * atr);
    }
  }

  /** Feed one closed bar for a market. */
  ingest(sym, bar) {
    if (!this.brains.has(sym)) this.addSymbol(sym);
    const view = this.brains.get(sym).update(bar);
    this.views.set(sym, view);
    const d = this.daily.get(sym);
    const day = Math.floor(bar.t / DAY);
    d.set(day, (d.get(day) ?? 0) + (view.f.ret || 0));
    if (d.size > 120) d.delete(d.keys().next().value);
    const r = this.rets.get(sym);
    r.set(bar.t, view.f.ret || 0);
    if (r.size > 200) r.delete(r.keys().next().value);
    const m = this.meta.get(sym);
    if (m) {
      m.barsHeld++;
      m.highest = Math.max(m.highest, bar.c);
      if (view.f.atr) m.stop = trailStop(m.stop, m.highest, view.f.atr, this.preset);
    }
    const c = this.cool.get(sym);
    if (c > 0) this.cool.set(sym, c - 1);
    return view;
  }

  stopFor(sym) {
    return this.meta.get(sym)?.stop ?? null;
  }

  explain(sym, opts) {
    return explain(this.views.get(sym), { horizon: this.brains.get(sym)?.p.horizon, ...opts });
  }

  /**
   * Returns of several markets lined up in time, for their correlation. Markets on one timeframe
   * use their last 168 bars (the same horizon their sizing uses); a mix of timeframes (crypto on
   * 4h, stocks on 1d) falls back to daily returns over the last 90 days.
   * @returns {series, periodsPerYear}
   */
  #alignedReturns(keys) {
    const tfs = new Set(keys.map((k) => this.cfg.get(k)?.tfMs));
    if (tfs.size === 1) {
      const maps = keys.map((k) => this.rets.get(k) ?? new Map());
      const times = [...maps[0].keys()].filter((t) => maps.every((m) => m.has(t))).slice(-168);
      return { series: maps.map((m) => times.map((t) => m.get(t))), periodsPerYear: this.cfg.get(keys[0]).bpy };
    }
    const maps = keys.map((k) => this.daily.get(k) ?? new Map());
    const days = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d))).slice(-91, -1); // the newest day may be unfinished
    const stocks = keys.some((k) => this.cfg.get(k)?.assetClass === "stock");
    return { series: maps.map((m) => days.map((d) => m.get(d))), periodsPerYear: stocks ? 252 : 365 };
  }

  /** Should this market be left alone because its data is old? */
  #fresh(sym, now) {
    const v = this.views.get(sym);
    const c = this.cfg.get(sym);
    if (!v || !c) return false;
    const allowed = c.tfMs >= DAY ? 4 * DAY : 3 * c.tfMs;
    return now - (v.t + c.tfMs) <= allowed;
  }

  /**
   * Decide orders.
   * @param account {cash, positions: {sym: qty}, prices: {sym: price}, t, now, skip: Set of symbols to leave alone}
   * @returns {orders, events, equity, drawdown, dayLoss, targets}
   */
  plan({ cash, positions = {}, prices = {}, t = Date.now(), now = t, skip = new Set() }) {
    const p = this.preset;
    const events = [];
    let equity = cash;
    for (const [s, q] of Object.entries(positions)) equity += q * (prices[s] ?? 0);
    const day = Math.floor(t / DAY);
    if (day !== this.day) {
      this.day = day;
      this.dayStart = equity;
    }
    this.peak = Math.max(this.peak ?? equity, equity);
    const drawdown = this.peak > 0 ? Math.max(0, 1 - equity / this.peak) : 0;
    const dayLoss = this.dayStart > 0 ? 1 - equity / this.dayStart : 0;
    const held = (s) => (positions[s] ?? 0) > 0;
    const out = { orders: [], events, equity, drawdown, dayLoss, targets: {} };

    if (this.halted) return out;

    if (drawdown >= p.maxDrawdown) {
      this.halted = { reason: "drawdown", t, drawdown };
      for (const s of Object.keys(positions)) if (held(s)) out.orders.push({ symbol: s, side: "sell", qty: positions[s], reason: "breaker", why: `the bot fell ${(drawdown * 100).toFixed(1)}% from its peak (limit ${(p.maxDrawdown * 100).toFixed(0)}%)` });
      events.push({ type: "breaker", level: "danger", text: `Safety stop: down ${(drawdown * 100).toFixed(1)}% from the peak, past the ${(p.maxDrawdown * 100).toFixed(0)}% limit. Selling everything and pausing until you resume.` });
      return out;
    }
    if (dayLoss >= p.dailyLoss && t < (day + 1) * DAY) {
      this.noBuysUntil = (day + 1) * DAY;
      if (this.dailyNoted !== day) {
        this.dailyNoted = day;
        events.push({ type: "daily-limit", level: "warning", text: `Down ${(dayLoss * 100).toFixed(1)}% today (limit ${(p.dailyLoss * 100).toFixed(0)}%). No new buys until midnight UTC; stops stay on.` });
      }
    }
    const buysAllowed = t >= this.noBuysUntil;

    const want = {};
    const why = {};
    for (const s of this.symbols) {
      if (skip.has(s)) continue;
      const v = this.views.get(s);
      if (!v || !this.#fresh(s, now) || !(prices[s] > 0)) {
        if (held(s)) want[s] = (positions[s] * prices[s]) / equity || 0;
        continue;
      }
      const d = desiredWeight(v, p, { held: held(s), cooldown: this.cool.get(s) ?? 0, barsPerYear: this.cfg.get(s).bpy, drawdown });
      want[s] = d.weight;
      why[s] = d.why;
    }
    const keys = Object.keys(want).filter((k) => want[k] > 0);
    const returns = {};
    let periodsPerYear = 365;
    if (keys.length) {
      const a = this.#alignedReturns(keys);
      keys.forEach((k, i) => (returns[k] = a.series[i]));
      periodsPerYear = a.periodsPerYear;
    }
    const scaled = portfolioScale(want, returns, p, periodsPerYear, { minDays: 20 }).weights;
    out.targets = scaled;

    const sells = [];
    const buys = [];
    for (const s of Object.keys(scaled)) {
      const price = prices[s];
      if (!(price > 0)) continue;
      const curVal = (positions[s] ?? 0) * price;
      const tgtVal = scaled[s] * equity;
      const view = this.views.get(s);
      const brief = view?.ready ? { score: round(view.score), regime: view.regime.label } : null;
      if (held(s) && tgtVal <= 0) {
        sells.push({ symbol: s, side: "sell", qty: positions[s], reason: "exit", why: why[s], view: brief });
      } else if (!held(s) && tgtVal >= this.minOrder) {
        if (buysAllowed) buys.push({ symbol: s, side: "buy", notional: tgtVal, reason: "enter", why: why[s], view: brief });
      } else if (held(s) && curVal > 0) {
        // Resizing costs fees, so only when the target has at least doubled or halved.
        const diff = tgtVal - curVal;
        if (Math.abs(diff) >= this.minOrder) {
          if (tgtVal < curVal * (1 - this.trimAt)) sells.push({ symbol: s, side: "sell", qty: Math.min(positions[s], -diff / price), reason: "trim", why: why[s], view: brief });
          else if (tgtVal > curVal * (1 + this.addAt) && buysAllowed) buys.push({ symbol: s, side: "buy", notional: diff, reason: "add", why: why[s], view: brief });
        }
      }
    }
    // Sells first; buys only with cash the bot actually has (after those sells).
    let budget = cash + sells.reduce((a, o) => a + o.qty * prices[o.symbol] * 0.995, 0);
    for (const o of buys) {
      o.notional = Math.min(o.notional, budget * 0.995);
      if (o.notional >= this.minOrder) {
        budget -= o.notional;
        out.orders.push(o);
      }
    }
    out.orders.unshift(...sells);
    return out;
  }

  /** Record a fill: sets the stop on a new position, closes the books on a finished one. */
  onFill({ symbol, side, qty, price, fee = 0, t = Date.now(), reason = "" }) {
    let m = this.meta.get(symbol);
    if (side === "buy") {
      const atr = this.views.get(symbol)?.f?.atr ?? price * 0.02;
      if (!m) {
        m = { entry: price, entryT: t, stop: initialStop(price, atr, this.preset), highest: price, barsHeld: 0, qty: 0, cost: 0, fees: 0, proceeds: 0, reason };
        this.meta.set(symbol, m);
      }
      m.cost += qty * price;
      m.qty += qty;
      m.fees += fee;
      m.entry = m.cost / m.qty;
      return null;
    }
    if (!m) return null;
    const sold = Math.min(qty, m.qty);
    m.proceeds += sold * price;
    m.fees += fee;
    m.qty -= sold;
    // Still holding more than rounding dust: the position stays open.
    if (m.qty * price > Math.max(0.5, 0.001 * m.cost)) return null;
    const pnl = m.proceeds - m.cost - m.fees;
    const trade = { symbol, entryT: m.entryT, exitT: t, entry: m.entry, exit: price, cost: m.cost, proceeds: m.proceeds, fees: m.fees, pnl, ret: m.cost > 0 ? pnl / m.cost : 0, bars: m.barsHeld, exitReason: reason, entryReason: m.reason };
    this.meta.delete(symbol);
    if (reason === "stop") this.cool.set(symbol, STOP_COOLDOWN_BARS);
    return trade;
  }

  /** Forget a position the bot no longer holds (sold outside Kestrel). */
  forget(symbol) {
    this.meta.delete(symbol);
  }

  resume() {
    this.halted = null;
    this.peak = null;
  }

  /** The books (not the brains) as plain JSON, to survive restarts. */
  exportState() {
    return { meta: Object.fromEntries(this.meta), cool: Object.fromEntries(this.cool), peak: this.peak, day: this.day, dayStart: this.dayStart, halted: this.halted, noBuysUntil: this.noBuysUntil, dailyNoted: this.dailyNoted };
  }

  importState(s = {}) {
    this.meta = new Map(Object.entries(s.meta || {}));
    this.cool = new Map(Object.entries(s.cool || {}));
    this.peak = s.peak ?? null;
    this.day = s.day ?? null;
    this.dayStart = s.dayStart ?? null;
    this.halted = s.halted ?? null;
    this.noBuysUntil = s.noBuysUntil ?? 0;
    this.dailyNoted = s.dailyNoted ?? null;
  }
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
