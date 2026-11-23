// The engine runs the bot: it keeps every market's brain fed with closed bars, watches prices for
// stops every few seconds, makes the portfolio decision at each bar close, sends orders to the
// practice account or the real exchange, keeps the books, and reports everything as events.
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import { Trader } from "./trader.mjs";
import { RISK_LEVELS, riskPreset } from "./risk.mjs";
import { PaperBroker } from "./brokers/paper.mjs";
import { CcxtBroker } from "./brokers/ccxt.mjs";
import { AlpacaBroker } from "./brokers/alpacaBroker.mjs";
import { venueInfo, VENUES } from "./brokers/catalog.mjs";
import { backtest } from "./backtest.mjs";
import { marketName, timeframeMs, assetClassOf, normalizeSymbol, timeframeLabel } from "./markets.mjs";
import { PRACTICE_CASH } from "./store.mjs";
import { explain } from "./strategy/brain.mjs";

const URGENT = new Set(["stop", "breaker", "sell-all", "manual-sell", "remove"]);
const MAX_ORDERS_PER_DAY = 60;
const MAX_ERRORS_IN_A_ROW = 5;
const PRICE_SANITY = 0.15; // skip a non-urgent order if the live price is this far from the last close
const money = (x) => `$${Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (x, d = 1) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`;
const id = () => crypto.randomBytes(6).toString("base64url");

export class Engine extends EventEmitter {
  constructor({ store, data, demo = false, pollMs = null, now = () => Date.now() }) {
    super();
    this.store = store;
    this.data = data;
    this.demo = demo;
    this.now = now;
    this.pollMs = pollMs ?? (demo ? 1000 : 15_000);
    this.prices = {};
    this.lastBar = {};
    this.recentBars = {};
    this.status = {}; // symbol → {state: warming|ready|error, message}
    this.symbolOn = {}; // symbol → the venue's own symbol (BTC/USD may be BTC/USDT on some)
    this.executing = null;
    this.liveBroker = null;
    this.jobs = new Map();
    this.confirms = new Map();
    this.approvals = new Map();
    this.errorsInRow = 0;
    this.awaitingOpen = new Set();
    this.lastTickAt = 0;
    this.lastDecisionAt = 0;
    this.warnedAt = {};
    this.timer = null;
    this.stopped = false;
    this.trader = this.#newTrader();
  }

  // ───────────────────────── basics ─────────────────────────
  get s() {
    return this.store.data;
  }
  get mode() {
    return this.demo ? "practice" : this.s.mode;
  }
  get book() {
    return this.mode === "live" ? this.s.live : this.s.paper;
  }
  get preset() {
    return riskPreset(this.s.risk);
  }

  #newTrader() {
    const t = new Trader({ risk: this.s.risk, minOrder: 10 });
    for (const m of this.s.markets) t.addSymbol(m.symbol, { tfMs: this.tfFor(m), assetClass: m.assetClass });
    t.importState(this.s.trader[this.mode]);
    return t;
  }

  tfFor(m) {
    return timeframeMs(this.s.timeframes[m.assetClass || assetClassOf(m.symbol)]);
  }

  /** Where a market's prices come from right now. */
  venueFor(m) {
    if (this.demo) return "demo";
    const stock = (m.assetClass || assetClassOf(m.symbol)) === "stock";
    if (this.mode === "live") return stock ? "alpaca" : this.s.live.broker && this.s.connections[this.s.live.broker]?.venue;
    return stock ? "alpaca" : this.s.practiceVenue || "kraken";
  }

  broker() {
    if (this.mode === "live") return this.liveBroker;
    return new PaperBroker({ data: this.data, venue: this.s.practiceVenue || "kraken" });
  }

  alpacaKeys() {
    const conn = Object.entries(this.s.connections).find(([, c]) => c.venue === "alpaca");
    if (!conn) return {};
    const sec = this.store.secret(`broker:${conn[0]}`) || {};
    return { ...sec, paper: conn[1].paper !== false };
  }

  persist() {
    this.s.trader[this.mode] = this.trader.exportState();
    this.store.save();
  }

  event(e) {
    const ev = { id: id(), t: this.now(), mode: this.mode, level: "info", ...e };
    this.s.events.push(ev);
    if (this.s.events.length > 400) this.s.events.splice(0, this.s.events.length - 400);
    this.store.journal({ kind: "event", ...ev });
    this.store.save();
    this.emit("event", ev);
    return ev;
  }

  #warnOnce(key, text, everyMs = 15 * 60_000) {
    if (this.now() - (this.warnedAt[key] ?? 0) < everyMs) return;
    this.warnedAt[key] = this.now();
    this.event({ type: "warning", level: "warning", text });
  }

  // ───────────────────────── lifecycle ─────────────────────────
  async init() {
    if (this.mode === "live") {
      try {
        await this.#openLiveBroker();
      } catch (e) {
        this.s.running = false;
        this.event({ type: "error", level: "danger", text: `Couldn't reconnect to your exchange (${e.message}). The bot is paused until it can.` });
      }
    }
    this.warmAll().catch(() => {});
    this.timer = setInterval(() => this.tick().catch((e) => console.error("[kestrel] tick:", e)), this.pollMs);
    this.timer.unref?.();
  }

  async close() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.executing?.catch(() => {});
    this.persist();
    await this.store.close();
  }

  /** Read each market's recent history so its brain is ready before trading. */
  async warmAll() {
    await Promise.all(this.s.markets.map((m) => this.warm(m)));
    this.emit("change");
  }

  async warm(m) {
    const sym = m.symbol;
    this.status[sym] = { state: "warming", message: "Reading recent prices…" };
    this.emit("change");
    try {
      const venue = this.venueFor(m);
      if (!venue) throw new Error("No exchange connected for this market in real-money mode.");
      const vsym = await this.#venueSymbol(venue, sym);
      const tf = this.tfFor(m);
      const bars = await this.data.bars(venue, vsym, tf, 720);
      if (bars.length < 360) throw new Error(`only ${bars.length} bars of history (needs 360)`);
      this.trader.addSymbol(sym, { tfMs: tf, assetClass: m.assetClass });
      // A fresh brain: feed it everything, in order.
      const fresh = this.trader.brains.get(sym);
      if (fresh.bars > 0) {
        this.trader.removeSymbol(sym);
        this.trader.addSymbol(sym, { tfMs: tf, assetClass: m.assetClass });
      }
      for (const b of bars) this.trader.ingest(sym, b);
      this.lastBar[sym] = bars.at(-1).t;
      this.recentBars[sym] = bars.slice(-400);
      this.status[sym] = { state: "ready" };
      this.s.lastSeen[sym] = this.#stance(sym);
      await this.#refreshPrice(m).catch(() => {});
    } catch (e) {
      this.status[sym] = { state: "error", message: e.message };
      this.#warnOnce(`warm:${sym}`, `${marketName(sym)}: ${e.message}`);
    }
  }

  async #venueSymbol(venue, sym) {
    const key = `${venue}|${sym}`;
    if (this.symbolOn[key]) return this.symbolOn[key];
    let found = sym;
    if (venue !== "demo" && !this.data.isDemo() && venueInfo(venue).kind === "ccxt") {
      const ex = this.data.publicExchange(venue);
      await this.data.loadMarkets(ex);
      const [base, quote] = sym.split("/");
      // Real money in a CAD or EUR account trades the coin against that currency.
      const home = this.mode === "live" ? this.s.live.quote : null;
      const alts = [...new Set([home, quote, ...(quote === "USD" ? ["USDC", "USDT"] : quote === "USDT" ? ["USD", "USDC"] : ["USD"])].filter(Boolean))];
      found = alts.map((q) => `${base}/${q}`).find((s) => ex.markets[s]);
      if (!found) throw new Error(`${venueInfo(venue).name} doesn't list ${sym}.`);
    }
    this.symbolOn[key] = found;
    return found;
  }

  async #refreshPrice(m) {
    const venue = this.venueFor(m);
    const p = await this.data.price(venue, await this.#venueSymbol(venue, m.symbol));
    this.prices[m.symbol] = p;
    return p;
  }

  // ───────────────────────── the loop ─────────────────────────
  async tick() {
    if (this.ticking || this.stopped) return;
    this.ticking = true;
    try {
      this.lastTickAt = this.now();
      let newBar = false;
      for (const m of this.s.markets) {
        const sym = m.symbol;
        if (this.status[sym]?.state === "error" && this.now() - (this.status[sym].at ?? 0) > 5 * 60_000) {
          this.status[sym].at = this.now();
          this.warm(m).catch(() => {});
          continue;
        }
        if (this.status[sym]?.state !== "ready") continue;
        try {
          const p = await this.#refreshPrice(m);
          await this.#checkStop(m, p);
          const tf = this.tfFor(m);
          const clock = this.demo ? this.data.demo.now() : this.now();
          if (clock >= this.lastBar[sym] + 2 * tf + (this.demo ? 0 : 20_000)) {
            const venue = this.venueFor(m);
            const bars = await this.data.bars(venue, await this.#venueSymbol(venue, sym), tf, 10);
            for (const b of bars) {
              if (b.t <= this.lastBar[sym]) continue;
              this.trader.ingest(sym, b);
              this.lastBar[sym] = b.t;
              this.recentBars[sym] = [...(this.recentBars[sym] || []), b].slice(-400);
              newBar = true;
              this.#noticeStance(sym);
            }
          }
        } catch (e) {
          this.#warnOnce(`tick:${sym}`, `Couldn't update ${marketName(sym)}: ${e.message}`);
        }
      }
      if (newBar) {
        this.#recordEquity(true);
        if (this.s.running && !this.executing) await this.decide();
      } else {
        this.#recordEquity(false);
        // Stock decisions made while the market was shut wait for the opening bell.
        if (this.s.running && !this.executing && this.awaitingOpen.size) {
          const open = [];
          for (const s of this.awaitingOpen) if (await this.#marketOpen(this.s.markets.find((m) => m.symbol === s))) open.push(s);
          if (open.length) await this.decide({ only: new Set(open) });
        }
      }
      if (this.mode === "live" && this.now() - (this.reconciledAt ?? 0) > 10 * 60_000) {
        this.reconciledAt = this.now();
        this.reconcile().catch((e) => this.#warnOnce("reconcile", `Couldn't check your ${this.liveBroker?.name ?? "exchange"} balances: ${e.message}`));
      }
      this.#expire();
      this.emit("change");
    } finally {
      this.ticking = false;
    }
  }

  #noticeStance(sym) {
    const now = this.#stance(sym);
    const before = this.s.lastSeen[sym];
    this.s.lastSeen[sym] = now;
    if (!before || !now || before.side === now.side) return;
    const ex = this.explainMarket(sym);
    this.event({ type: "signal", level: "info", symbol: sym, text: `${marketName(sym)} turned ${now.side} (score ${now.score >= 0 ? "+" : ""}${now.score.toFixed(2)}). ${ex.reasons?.[0]?.text ?? ""}`.trim() });
  }

  #stance(sym) {
    const v = this.trader.views.get(sym);
    if (!v?.ready) return null;
    const p = this.preset;
    const side = v.score >= p.enter ? "bullish" : v.score <= -p.enter ? "bearish" : "neutral";
    return { side, score: v.score };
  }

  /** Crypto trades around the clock; stocks only while the US market is open. */
  async #marketOpen(m) {
    if (!m || this.demo || (m.assetClass || assetClassOf(m.symbol)) !== "stock") return true;
    if (this.now() - (this.clockAt ?? 0) > 60_000) {
      try {
        this.clockOpen = !!(await this.data.alpaca().clock()).is_open;
      } catch {
        this.clockOpen = false;
      }
      this.clockAt = this.now();
    }
    return this.clockOpen;
  }

  async #checkStop(m, p) {
    const sym = m.symbol;
    const qty = this.book.positions[sym] ?? 0;
    if (!(qty > 0) || this.executing) return;
    if (!(await this.#marketOpen(m))) return;
    const stop = this.trader.stopFor(sym);
    const price = p.bid || p.last;
    if (stop != null && price <= stop) {
      await this.#run([{ symbol: sym, side: "sell", qty, reason: "stop", why: `price ${money(price)} reached the stop at ${money(stop)}` }]);
    }
  }

  /**
   * The portfolio decision, at a bar close. `only` limits the orders to some markets (stocks
   * whose decision waited for the market to open); the rest still count for sizing.
   */
  async decide({ only = null } = {}) {
    const prices = this.#priceMap();
    const skip = new Set();
    for (const m of this.s.markets) {
      if (this.status[m.symbol]?.state !== "ready") skip.add(m.symbol);
      else if (only && !only.has(m.symbol)) skip.add(m.symbol);
      else if (!(await this.#marketOpen(m))) {
        skip.add(m.symbol);
        this.awaitingOpen.add(m.symbol);
      } else this.awaitingOpen.delete(m.symbol);
    }
    const plan = this.trader.plan({ cash: this.book.cash, positions: { ...this.book.positions }, prices, t: this.demo ? this.data.demo.now() : this.now(), now: this.demo ? this.data.demo.now() : this.now(), skip });
    this.lastDecisionAt = this.now();
    for (const e of plan.events) this.event(e);
    if (plan.events.some((e) => e.type === "breaker")) this.s.running = false;
    this.persist();
    for (const o of plan.orders) {
      o.detail = o.why;
      o.why = this.#plainWhy(o) || o.why;
    }
    if (plan.orders.length) await this.#run(plan.orders);
  }

  /** The reason for an order in words: the brain's top reasons, not its internal numbers. */
  #plainWhy(o) {
    const ex = this.explainMarket(o.symbol);
    const lower = (t) => t.charAt(0).toLowerCase() + t.slice(1);
    const top = (ex.reasons || [])
      .filter((r) => r.expert !== "Risk")
      .slice(0, 2)
      .map((r) => lower(r.text));
    const score = ex.score != null ? `score ${ex.score >= 0 ? "+" : ""}${ex.score.toFixed(2)}` : "";
    if (o.reason === "enter" || o.reason === "add") return `${lower(ex.stance || "bullish")} (${score}): ${top.join("; ")}`;
    if (o.reason === "exit") return `the signal faded (${score}): ${top.join("; ")}`;
    if (o.reason === "trim") return `it wants a smaller position (${o.why})`;
    return null;
  }

  #priceMap() {
    const out = {};
    for (const m of this.s.markets) out[m.symbol] = this.prices[m.symbol]?.last ?? this.recentBars[m.symbol]?.at(-1)?.c;
    for (const s of Object.keys(this.book.positions)) out[s] ??= this.prices[s]?.last;
    return out;
  }

  /** Execute orders one after another (sells first). Only one batch runs at a time. */
  #run(orders) {
    const job = (async () => {
      for (const o of orders) {
        try {
          await this.#execute(o);
          this.errorsInRow = 0;
        } catch (e) {
          this.errorsInRow++;
          this.event({ type: "error", level: "danger", symbol: o.symbol, text: `Couldn't ${o.side} ${marketName(o.symbol)}: ${e.message}` });
          if (this.errorsInRow >= MAX_ERRORS_IN_A_ROW && this.s.running) {
            this.s.running = false;
            this.event({ type: "paused", level: "danger", text: `Paused after ${MAX_ERRORS_IN_A_ROW} failed orders in a row. Check the exchange connection, then press Start.` });
          }
        }
      }
    })();
    this.executing = job.finally(() => {
      this.executing = null;
      this.persist();
      this.emit("change");
    });
    return this.executing;
  }

  async #execute(o) {
    const sym = o.symbol;
    const m = this.s.markets.find((x) => x.symbol === sym) || { symbol: sym, assetClass: assetClassOf(sym) };
    const urgent = URGENT.has(o.reason);
    const broker = this.broker();
    if (!broker) throw new Error("No exchange is connected for real money.");
    const book = this.book;
    const held = book.positions[sym] ?? 0;
    let { qty, notional } = o;
    if (o.side === "sell") {
      qty = Math.min(qty ?? held, held);
      if (!(qty > 0)) return;
    } else {
      notional = Math.min(notional, book.cash * 0.995);
      if (this.mode === "live") notional = Math.min(notional, this.s.live.maxOrder || Infinity);
      if (!(notional >= 10)) return;
    }

    // Safety checks before real money moves.
    const last = this.recentBars[sym]?.at(-1)?.c;
    const px = this.prices[sym]?.last;
    if (!urgent && last && px && Math.abs(px / last - 1) > PRICE_SANITY) {
      this.#warnOnce(`sanity:${sym}`, `Skipped a ${o.side} of ${marketName(sym)}: the price (${money(px)}) is more than ${PRICE_SANITY * 100}% away from the last close (${money(last)}), which can be a bad tick. Will look again at the next bar.`);
      return;
    }
    const today = Math.floor(this.now() / 86_400_000);
    this.s.ordersToday = this.s.ordersToday?.day === today ? this.s.ordersToday : { day: today, n: 0 };
    if (!urgent && this.s.ordersToday.n >= MAX_ORDERS_PER_DAY) {
      this.s.running = false;
      this.event({ type: "paused", level: "danger", text: `Paused: ${MAX_ORDERS_PER_DAY} orders today is far more than normal, so something may be wrong. Check the activity, then press Start.` });
      return;
    }
    if (this.mode === "live" && o.side === "buy") {
      const bal = await broker.balance().catch(() => null);
      const quote = (this.symbolOn[`${this.venueFor(m)}|${sym}`] || sym).split("/")[1] || "USD";
      const free = bal?.[quote]?.free ?? bal?.USD?.free;
      if (free != null && free < notional) notional = free * 0.99;
      if (!(notional >= 10)) {
        this.#warnOnce(`funds:${sym}`, `Not enough ${quote} free in your ${broker.name} account to buy ${marketName(sym)} (the bot's budget says ${money(book.cash)}, the account has ${money(free ?? 0)}).`);
        return;
      }
    }

    const venueSym = this.mode === "live" || this.s.practiceVenue ? await this.#venueSymbol(this.venueFor(m), sym) : sym;
    const fill = await broker.execute({ symbol: venueSym, side: o.side, qty, notional, patient: this.s.settings.patientOrders && !urgent, patientSeconds: this.s.settings.patientSeconds, venue: this.venueFor(m) });
    this.s.ordersToday.n++;
    const value = fill.qty * fill.price;
    if (o.side === "buy") {
      book.cash -= value + fill.fee;
      book.positions[sym] = (book.positions[sym] ?? 0) + fill.qty;
    } else {
      book.cash += value - fill.fee;
      book.positions[sym] = Math.max(0, held - fill.qty);
      if (book.positions[sym] * fill.price < 0.5) delete book.positions[sym];
    }
    const trade = this.trader.onFill({ symbol: sym, side: o.side, qty: fill.qty, price: fill.price, fee: fill.fee, t: this.demo ? this.data.demo.now() : this.now(), reason: o.reason });
    const f = { id: id(), t: this.now(), mt: this.demo ? this.data.demo.now() : undefined, mode: this.mode, symbol: sym, side: o.side, qty: fill.qty, price: fill.price, fee: fill.fee, value, maker: fill.maker, reason: o.reason, why: o.why, view: o.view, by: o.by || "bot", orderIds: fill.orderIds };
    this.s.fills.push(f);
    if (this.s.fills.length > 500) this.s.fills.splice(0, this.s.fills.length - 500);
    this.store.journal({ kind: "fill", ...f });
    if (trade) {
      const tr = { id: id(), mode: this.mode, ...trade, by: o.by || "bot" };
      this.s.trades.push(tr);
      if (this.s.trades.length > 1000) this.s.trades.splice(0, this.s.trades.length - 1000);
      this.store.journal({ kind: "trade", ...tr });
    }
    const verb = o.side === "buy" ? "Bought" : "Sold";
    const how = { enter: "", add: " (adding to the position)", trim: " (trimming the position)", exit: "", stop: " — stop hit", breaker: " — safety stop", "sell-all": " — you asked to sell everything", "manual-sell": " — your order", "manual-buy": " — your order", remove: " — market removed" }[o.reason] ?? "";
    const result = trade ? ` Result: ${trade.pnl >= 0 ? "made" : "lost"} ${money(Math.abs(trade.pnl))} (${pct(trade.ret)}) after fees.` : "";
    this.event({ type: "trade", level: o.reason === "stop" || o.reason === "breaker" ? "warning" : "success", symbol: sym, side: o.side, text: `${verb} ${money(value)} of ${marketName(sym)} at ${money(fill.price)}${how}.${o.why ? ` Why: ${o.why}.` : ""}${result}`, data: { fillId: f.id, tradeId: trade ? this.s.trades.at(-1).id : null } });
    this.persist();
  }

  #recordEquity(force) {
    const list = (this.s.equity[this.mode] ||= []);
    const last = list.at(-1);
    const gap = this.demo ? 0 : 10 * 60_000;
    if (!force && last && this.now() - last.t < gap) return;
    const v = this.equity();
    if (!(v > 0)) return;
    list.push({ t: this.demo ? this.data.demo.now() : this.now(), v: Math.round(v * 100) / 100 });
    if (list.length > 3000) list.splice(0, list.length - 3000);
  }

  #expire() {
    const now = this.now();
    for (const [k, c] of this.confirms) if (c.expires < now) this.confirms.delete(k);
    for (const [k, a] of this.approvals)
      if (a.expires < now) {
        this.approvals.delete(k);
        this.emit("approvals");
      }
  }

  // ───────────────────────── numbers ─────────────────────────
  equity() {
    const prices = this.#priceMap();
    let v = this.book.cash;
    for (const [s, q] of Object.entries(this.book.positions)) v += q * (prices[s] ?? 0);
    return v;
  }

  account() {
    const eq = this.equity();
    const start = this.mode === "live" ? this.s.live.startEquity || this.s.live.budget || eq : this.s.paper.start || PRACTICE_CASH;
    const list = this.s.equity[this.mode] || [];
    const dayStartT = Math.floor((this.demo ? this.data.demo.now() : this.now()) / 86_400_000) * 86_400_000;
    const dayStart = [...list].reverse().find((p) => p.t < dayStartT)?.v ?? list[0]?.v ?? start;
    const peak = Math.max(eq, ...list.map((p) => p.v));
    const invested = eq - this.book.cash;
    return {
      equity: eq,
      cash: this.book.cash,
      invested,
      investedPct: eq > 0 ? invested / eq : 0,
      start,
      pnl: eq - start,
      pnlPct: start > 0 ? eq / start - 1 : 0,
      today: eq - dayStart,
      todayPct: dayStart > 0 ? eq / dayStart - 1 : 0,
      peak,
      drawdown: peak > 0 ? 1 - eq / peak : 0,
    };
  }

  positions() {
    const prices = this.#priceMap();
    return Object.entries(this.book.positions)
      .filter(([, q]) => q > 0)
      .map(([s, q]) => {
        const m = this.trader.meta.get(s);
        const price = prices[s] ?? 0;
        const value = q * price;
        const cost = m ? m.entry * q : null;
        const stop = this.trader.stopFor(s);
        return { symbol: s, name: marketName(s), qty: q, price, value, entry: m?.entry ?? null, cost, pnl: cost != null ? value - cost : null, pnlPct: cost ? value / cost - 1 : null, stop, stopDistance: stop && price ? 1 - stop / price : null, since: m?.entryT ?? null, why: m?.reason ?? null };
      })
      .sort((a, b) => b.value - a.value);
  }

  explainMarket(sym) {
    return this.trader.explain(sym, { symbolName: marketName(sym), money });
  }

  marketView(sym) {
    const m = this.s.markets.find((x) => x.symbol === sym);
    const v = this.trader.views.get(sym);
    const p = this.prices[sym];
    const ex = this.explainMarket(sym);
    const st = this.status[sym] || { state: "warming" };
    const bars = this.recentBars[sym] || [];
    // 24-hour change: the live price against the close a day ago (the same on every exchange).
    const perDay = Math.max(1, Math.round(86_400_000 / (m ? this.tfFor(m) : 14_400_000)));
    const dayAgo = bars.length > perDay ? bars[bars.length - perDay].o : null;
    const day = dayAgo && (p?.last ?? bars.at(-1)?.c) ? (p?.last ?? bars.at(-1).c) / dayAgo - 1 : null;
    return {
      symbol: sym,
      name: marketName(sym),
      assetClass: m?.assetClass ?? assetClassOf(sym),
      venue: m ? this.venueFor(m) : null,
      timeframe: m ? this.s.timeframes[m.assetClass] : null,
      price: p?.last ?? bars.at(-1)?.c ?? null,
      change24h: day ?? p?.change24h ?? null,
      status: st.state,
      message: st.message ?? null,
      ready: !!v?.ready,
      score: v?.ready ? v.score : null,
      stance: ex.stance ?? null,
      regime: v?.ready ? v.regime.label : null,
      summary: ex.summary,
      reasons: ex.reasons || [],
      experts: v?.ready ? Object.keys(v.scores).map((k) => ({ id: k, score: v.scores[k], weight: v.weights[k] })) : [],
      holding: this.book.positions[sym] ?? 0,
      stop: this.trader.stopFor(sym),
      lastBar: this.lastBar[sym] ?? null,
      nextBar: this.lastBar[sym] ? this.lastBar[sym] + 2 * (m ? this.tfFor(m) : 0) : null,
    };
  }

  chart(sym, n = 300) {
    const bars = (this.recentBars[sym] || []).slice(-n);
    const from = bars[0]?.t ?? 0;
    const fills = this.s.fills.filter((f) => f.symbol === sym && f.mode === this.mode).map((f) => ({ t: f.t, mt: f.mt, side: f.side, price: f.price, value: f.value, reason: f.reason }));
    return { symbol: sym, name: marketName(sym), bars, fills, stop: this.trader.stopFor(sym), entry: this.trader.meta.get(sym)?.entry ?? null, from, view: this.marketView(sym) };
  }

  /** Everything the dashboard and the voice agent need, in one object. */
  snapshot() {
    const a = this.account();
    const p = this.preset;
    const conn = Object.entries(this.s.connections).map(([cid, c]) => ({ id: cid, venue: c.venue, name: venueInfo(c.venue).name, paper: c.paper, sandbox: c.sandbox, connectedAt: c.connectedAt, balances: c.balances, fees: c.fees }));
    const fees = this.mode === "live" ? this.s.connections[this.s.live.broker]?.fees || venueInfo(this.s.connections[this.s.live.broker]?.venue || "kraken").fees : venueInfo(this.s.practiceVenue || "kraken").fees;
    return {
      demo: this.demo,
      setupDone: this.s.setupDone || this.demo,
      mode: this.mode,
      running: !!this.s.running,
      halted: this.trader.halted,
      noBuysUntil: this.trader.noBuysUntil > (this.demo ? this.data.demo.now() : this.now()) ? this.trader.noBuysUntil : null,
      clock: this.demo ? this.data.demo.now() : this.now(),
      risk: { id: p.id, label: p.label, blurb: p.blurb, maxDrawdown: p.maxDrawdown, dailyLoss: p.dailyLoss, maxWeight: p.maxWeight, maxTotal: p.maxTotal, stopAtr: p.stopAtr, targetVol: p.targetVol },
      riskLevels: Object.values(RISK_LEVELS).map((r) => ({ id: r.id, label: r.label, blurb: r.blurb, maxDrawdown: r.maxDrawdown })),
      account: a,
      positions: this.positions(),
      markets: this.s.markets.map((m) => this.marketView(m.symbol)),
      trades: this.s.trades.filter((t) => t.mode === this.mode).slice(-60).reverse(),
      fills: this.s.fills.filter((f) => f.mode === this.mode).slice(-60).reverse(),
      events: this.s.events.filter((e) => !e.mode || e.mode === this.mode).slice(-120).reverse(),
      equity: this.s.equity[this.mode] || [],
      practiceVenue: this.s.practiceVenue,
      fees,
      timeframes: this.s.timeframes,
      settings: this.s.settings,
      live: { broker: this.s.live.broker, budget: this.s.live.budget, maxOrder: this.s.live.maxOrder, enabledAt: this.s.live.enabledAt, connected: !!this.liveBroker },
      connections: conn,
      approvals: [...this.approvals.values()],
      quote: this.mode === "live" ? this.s.live.quote || "USD" : "USD",
      busy: !!this.executing,
      lastTickAt: this.lastTickAt,
      lastDecisionAt: this.lastDecisionAt,
    };
  }

  /** A short spoken-style summary for the voice agent. */
  briefing() {
    const s = this.snapshot();
    const a = s.account;
    const lines = [];
    lines.push(`Mode: ${s.demo ? "DEMO (simulated market, sped up)" : s.mode === "live" ? "REAL MONEY" : "practice (pretend money, real prices)"}. Bot is ${s.halted ? "STOPPED by its safety limit" : s.running ? "running" : "paused"}. Risk level: ${s.risk.label}.`);
    lines.push(`Bot's money: ${money(a.equity)} (${money(a.cash)} cash, ${money(a.invested)} invested). Since start: ${pct(a.pnlPct)} (${money(a.pnl)}). Today: ${pct(a.todayPct)} (${money(a.today)}). Down ${(a.drawdown * 100).toFixed(1)}% from its peak.`);
    lines.push(s.positions.length ? `Holding: ${s.positions.map((p) => `${p.name} ${money(p.value)}${p.pnlPct != null ? ` (${pct(p.pnlPct)})` : ""}${p.stop ? `, stop ${money(p.stop)}` : ""}`).join("; ")}.` : "Holding nothing (all cash).");
    lines.push(`Markets watched: ${s.markets.map((m) => `${m.name} ${m.price ? money(m.price) : "?"} ${m.ready ? `${m.stance} (${m.score >= 0 ? "+" : ""}${m.score.toFixed(2)}), ${m.regime}` : m.status}`).join("; ")}.`);
    const lastTrades = s.trades.slice(0, 3);
    if (lastTrades.length) lines.push(`Last finished trades: ${lastTrades.map((t) => `${marketName(t.symbol)} ${pct(t.ret)} (${money(t.pnl)})`).join("; ")}.`);
    const ev = s.events.slice(0, 5).map((e) => e.text);
    if (ev.length) lines.push(`Latest activity, newest first: ${ev.join(" | ")}`);
    return lines.join("\n");
  }

  // ───────────────────────── actions ─────────────────────────
  async start() {
    if (this.mode === "live" && !this.liveBroker) throw new Error("Connect your exchange first.");
    if (this.trader.halted) {
      this.trader.resume();
      this.event({ type: "resumed", level: "info", text: "Safety stop cleared. Kestrel starts fresh from today's balance." });
    }
    this.s.running = true;
    this.errorsInRow = 0;
    this.persist();
    this.event({ type: "start", level: "success", text: `Kestrel started (${this.mode === "live" ? "real money" : "practice"}, ${this.preset.label}). It decides at each ${[...new Set(this.s.markets.map((m) => timeframeLabel(this.s.timeframes[m.assetClass])))].join(" / ")} bar close and watches stops every few seconds.` });
    this.emit("change");
    if (!this.executing && [...this.trader.views.values()].some((v) => v?.ready)) await this.decide();
    return { ok: true };
  }

  pause(by = "you") {
    this.s.running = false;
    this.persist();
    this.event({ type: "pause", level: "info", text: `Paused by ${by}. Positions are kept${this.book && Object.keys(this.book.positions).length ? " and no stops will trigger until you start again" : ""}.` });
    this.emit("change");
    return { ok: true };
  }

  async sellAll(by = "you") {
    const orders = Object.entries(this.book.positions)
      .filter(([, q]) => q > 0)
      .map(([s, q]) => ({ symbol: s, side: "sell", qty: q, reason: "sell-all", why: `${by} asked to sell everything`, by }));
    this.s.running = false;
    this.persist();
    this.event({ type: "sell-all", level: "warning", text: orders.length ? `Selling everything (${orders.length} position${orders.length > 1 ? "s" : ""}) and pausing, as ${by} asked.` : `Nothing to sell; paused, as ${by} asked.` });
    await this.executing?.catch(() => {});
    if (orders.length) await this.#run(orders);
    return { ok: true, sold: orders.length };
  }

  async order({ symbol, side, amount = null, all = false, by = "you" }) {
    const sym = normalizeSymbol(symbol);
    if (!sym) throw new Error(`I don't know a market called "${symbol}".`);
    if (side === "sell") {
      const held = this.book.positions[sym] ?? 0;
      if (!(held > 0)) throw new Error(`The bot doesn't hold any ${marketName(sym)}.`);
      const price = this.#priceMap()[sym];
      const qty = all || !amount ? held : Math.min(held, amount / price);
      await this.executing?.catch(() => {});
      await this.#run([{ symbol: sym, side: "sell", qty, reason: "manual-sell", why: `${by} asked`, by }]);
    } else {
      if (!this.s.markets.some((m) => m.symbol === sym)) throw new Error(`Add ${marketName(sym)} to the bot's markets first, so it can manage the position.`);
      if (!(amount >= 10)) throw new Error("The smallest order is $10.");
      await this.executing?.catch(() => {});
      await this.#run([{ symbol: sym, side: "buy", notional: amount, reason: "manual-buy", why: `${by} asked`, by }]);
    }
    const last = this.s.fills.at(-1);
    return { ok: true, fill: last?.symbol === sym ? last : null };
  }

  setRisk(level) {
    if (!RISK_LEVELS[level]) throw new Error(`Risk level must be one of: ${Object.keys(RISK_LEVELS).join(", ")}.`);
    const before = this.s.risk;
    this.s.risk = level;
    this.trader.setRisk(level);
    this.persist();
    if (before !== level) this.event({ type: "settings", level: "info", text: `Risk level changed from ${RISK_LEVELS[before].label} to ${RISK_LEVELS[level].label}. ${RISK_LEVELS[level].blurb}` });
    this.emit("change");
    return { ok: true, risk: level };
  }

  async addMarket(symbol) {
    const sym = normalizeSymbol(symbol);
    if (!sym) throw new Error(`I don't know a market called "${symbol}".`);
    if (this.s.markets.some((m) => m.symbol === sym)) return { ok: true, already: true, symbol: sym };
    if (this.s.markets.length >= 12) throw new Error("Kestrel watches up to 12 markets at once. Remove one first.");
    const m = { symbol: sym, assetClass: assetClassOf(sym) };
    const venue = this.venueFor(m);
    if (m.assetClass === "stock" && !this.demo && !this.alpacaKeys().apiKey) throw new Error("Stocks need an Alpaca account (a free paper account works for practice). Connect Alpaca first.");
    if (!venue) throw new Error("Connect an exchange that lists it first.");
    if (venue !== "demo" && !(await this.data.hasMarket(venue, await this.#venueSymbol(venue, sym).catch(() => sym)))) throw new Error(`${venueInfo(venue).name} doesn't list ${sym}.`);
    this.s.markets.push(m);
    this.trader.addSymbol(sym, { tfMs: this.tfFor(m), assetClass: m.assetClass });
    this.persist();
    this.event({ type: "settings", level: "info", symbol: sym, text: `Now watching ${marketName(sym)}. Reading its recent history first…` });
    await this.warm(m);
    this.emit("change");
    return { ok: true, symbol: sym, ready: this.status[sym]?.state === "ready", message: this.status[sym]?.message };
  }

  async removeMarket(symbol, { sell = true } = {}) {
    const sym = normalizeSymbol(symbol) || symbol;
    const i = this.s.markets.findIndex((m) => m.symbol === sym);
    if (i < 0) throw new Error(`The bot isn't watching ${symbol}.`);
    const held = this.book.positions[sym] ?? 0;
    if (held > 0) {
      if (!sell) throw new Error(`The bot holds ${marketName(sym)}. Sell it first, or remove it with selling.`);
      await this.executing?.catch(() => {});
      await this.#run([{ symbol: sym, side: "sell", qty: held, reason: "remove", why: "the market was removed" }]);
    }
    this.s.markets.splice(i, 1);
    this.trader.removeSymbol(sym);
    delete this.status[sym];
    this.persist();
    this.event({ type: "settings", level: "info", symbol: sym, text: `Stopped watching ${marketName(sym)}.` });
    this.emit("change");
    return { ok: true, symbol: sym };
  }

  async setPracticeVenue(venue) {
    if (!["kraken", "coinbase", "alpaca", "gemini", "bitstamp", "binanceus", "binance"].includes(venue)) throw new Error("Pick Kraken, Coinbase or Alpaca for practice prices.");
    this.s.practiceVenue = venue;
    for (const m of this.s.markets) if (m.assetClass === "crypto") m.venue = venue;
    this.persist();
    this.event({ type: "settings", level: "info", text: `Practice prices and fees now come from ${venueInfo(venue).name} (fees ${pct(venueInfo(venue).fees.maker, 2)} / ${pct(venueInfo(venue).fees.taker, 2)}).` });
    if (this.mode === "practice") await this.warmAll();
    return { ok: true };
  }

  resetPractice(cash = PRACTICE_CASH) {
    if (this.mode !== "practice") throw new Error("Switch to practice first.");
    const c = Math.max(100, Math.min(10_000_000, Number(cash) || PRACTICE_CASH));
    this.s.paper = { cash: c, start: c, positions: {} };
    this.s.equity.practice = [];
    this.s.trades = this.s.trades.filter((t) => t.mode !== "practice");
    this.s.fills = this.s.fills.filter((f) => f.mode !== "practice");
    this.trader.importState({});
    this.persist();
    this.event({ type: "settings", level: "info", text: `Practice account reset to ${money(c)}.` });
    this.emit("change");
    return { ok: true };
  }

  // ───────────────────────── exchanges and real money ─────────────────────────
  makeBroker(venue, credentials, { paper = false, sandbox = false } = {}) {
    if (venueInfo(venue).kind === "alpaca") return new AlpacaBroker({ credentials, paper });
    return new CcxtBroker({ venue, credentials, sandbox });
  }

  async connect({ venue, credentials = {}, paper = false, sandbox = false }) {
    const v = venueInfo(venue);
    for (const f of v.fields) if (!f.optional && !String(credentials[f.id] || "").trim()) return { ok: false, message: `${f.label} is missing.` };
    const clean = Object.fromEntries(Object.entries(credentials).map(([k, x]) => [k, String(x).trim()]).filter(([, x]) => x));
    let broker;
    try {
      broker = this.makeBroker(venue, clean, { paper, sandbox });
    } catch (e) {
      return { ok: false, message: e.message };
    }
    const r = await broker.connect();
    if (!r.ok) return r;
    const cid = `${venue}${paper ? "-paper" : sandbox ? "-test" : ""}`;
    await this.store.setSecret(`broker:${cid}`, clean);
    let fees = null;
    try {
      fees = await broker.fees(v.assets.includes("crypto") ? "BTC/USD" : "SPY");
    } catch {
      fees = v.fees;
    }
    this.s.connections[cid] = { venue, paper: !!paper, sandbox: !!sandbox || !!paper, connectedAt: this.now(), balances: r.balances, fees };
    this.persist();
    this.event({ type: "connect", level: "success", text: `Connected to ${v.name}${paper ? " (paper account)" : sandbox ? " (test environment)" : ""}. ${balanceLine(r.balances)}` });
    this.emit("change");
    return { ok: true, id: cid, balances: r.balances, fees };
  }

  async disconnect(cid) {
    if (this.s.live.broker === cid && this.mode === "live") throw new Error("Switch back to practice before disconnecting the exchange you trade with.");
    delete this.s.connections[cid];
    await this.store.setSecret(`broker:${cid}`, null);
    this.persist();
    this.event({ type: "connect", level: "info", text: `Disconnected ${cid}. Its keys were deleted from this computer.` });
    this.emit("change");
    return { ok: true };
  }

  async #openLiveBroker() {
    const cid = this.s.live.broker;
    const c = this.s.connections[cid];
    if (!c) throw new Error("the connection was removed");
    const b = this.makeBroker(c.venue, this.store.secret(`broker:${cid}`) || {}, { paper: c.paper, sandbox: c.sandbox && !c.paper });
    const r = await b.connect();
    if (!r.ok) throw new Error(r.message);
    this.liveBroker = b;
    c.balances = r.balances;
    return b;
  }

  /**
   * Switch to real money. Only from the dashboard (never by voice): needs a connected account, a
   * budget, a largest-order limit, and the typed confirmation.
   */
  async goLive({ connection, budget, maxOrder, confirm }) {
    if (this.demo) throw new Error("Demo mode can't trade real money. Start Kestrel without --demo.");
    if (String(confirm || "").trim().toUpperCase() !== "REAL MONEY") throw new Error('Type REAL MONEY to confirm.');
    const c = this.s.connections[connection];
    if (!c) throw new Error("Connect that exchange first.");
    const b = Number(budget);
    const mo = Number(maxOrder);
    if (!(b >= 20)) throw new Error("Set a budget of at least $20.");
    if (!(mo >= 10)) throw new Error("Set a largest single order of at least $10.");
    this.s.running = false;
    this.persist();
    const prevBroker = this.s.live.broker;
    this.s.live.broker = connection;
    try {
      await this.#openLiveBroker();
    } catch (e) {
      this.s.live.broker = prevBroker;
      throw new Error(`Couldn't open the exchange: ${e.message}`);
    }
    const bal = await this.liveBroker.balance().catch(() => ({}));
    // The account's cash currency: whichever of these it holds the most of.
    const cashes = ["USD", "CAD", "EUR", "GBP", "AUD", "USDC", "USDT"].map((q) => [q, bal[q]?.free ?? 0]).sort((x, y) => y[1] - x[1]);
    const [quote, free] = cashes[0][1] > 0 ? cashes[0] : ["USD", null];
    if (free != null && free < b) throw new Error(`Your account has ${money(free)} ${quote} free, less than the ${money(b)} budget. Lower the budget or add funds.`);
    this.s.live.quote = c.venue === "alpaca" ? "USD" : quote;
    // Same exchange as before: keep the bot's positions and add any budget change. New one: fresh books.
    const same = prevBroker === connection && this.s.live.enabledAt;
    if (!same) this.s.live = { ...this.s.live, broker: connection, budget: b, cash: b, positions: {}, startEquity: b };
    else {
      this.s.live.cash += b - (this.s.live.budget || 0);
      this.s.live.budget = b;
    }
    this.s.live.maxOrder = mo;
    this.s.live.enabledAt = this.now();
    this.s.trader.practice = this.trader.exportState();
    this.s.mode = "live";
    this.trader.importState(same ? this.s.trader.live : {});
    this.symbolOn = {};
    this.persist();
    this.event({ type: "mode", level: "danger", text: `REAL MONEY mode on ${venueInfo(c.venue).name}${c.paper ? " (Alpaca paper account)" : ""}. Budget ${money(b)}, largest order ${money(mo)}. Kestrel only trades this budget and never touches anything else in your account. Press Start when you're ready.` });
    await this.warmAll();
    return { ok: true };
  }

  async goPractice() {
    if (this.mode === "practice") return { ok: true };
    this.s.running = false;
    this.s.trader.live = this.trader.exportState();
    this.s.mode = "practice";
    this.liveBroker = null;
    this.trader.importState(this.s.trader.practice);
    this.symbolOn = {};
    this.persist();
    const held = Object.keys(this.s.live.positions).length;
    this.event({ type: "mode", level: "info", text: `Back to practice. ${held ? `Your real positions (${held}) stay in your exchange account; Kestrel will manage them again when you switch back.` : "No real positions are open."}` });
    await this.warmAll();
    return { ok: true };
  }

  /** Compare the bot's books with the real account, in case something was sold by hand. */
  async reconcile() {
    if (this.mode !== "live" || !this.liveBroker) return;
    const bal = await this.liveBroker.balance();
    for (const [sym, q] of Object.entries(this.s.live.positions)) {
      const venueSym = this.symbolOn[`${this.venueFor({ symbol: sym, assetClass: assetClassOf(sym) })}|${sym}`] || sym;
      const asset = venueSym.includes("/") ? venueSym.split("/")[0] : venueSym;
      const have = bal[asset]?.total ?? 0;
      if (have < q * 0.98) {
        this.s.live.positions[sym] = have;
        if (have * (this.prices[sym]?.last ?? 0) < 1) {
          delete this.s.live.positions[sym];
          this.trader.forget(sym);
        }
        this.event({ type: "warning", level: "warning", symbol: sym, text: `Your account holds less ${marketName(sym)} than Kestrel bought (${have} vs ${q}). Something was sold outside Kestrel, so it now manages ${have}.` });
      }
    }
    this.persist();
  }

  // ───────────────────────── backtests ─────────────────────────
  startBacktest({ symbols, days = 365, risk = this.s.risk, venue = null } = {}) {
    const syms = (symbols?.length ? symbols : this.s.markets.map((m) => m.symbol)).map((s) => normalizeSymbol(s)).filter(Boolean);
    if (!syms.length) throw new Error("Pick at least one market to test.");
    if (!RISK_LEVELS[risk]) throw new Error(`Risk level must be one of: ${Object.keys(RISK_LEVELS).join(", ")}.`);
    const d = Math.max(60, Math.min(1095, Number(days) || 365));
    const jobId = id();
    const job = { id: jobId, status: "running", progress: "Starting…", params: { symbols: syms, days: d, risk }, startedAt: this.now() };
    this.jobs.set(jobId, job);
    (async () => {
      const classes = new Set(syms.map(assetClassOf));
      if (classes.size > 1) throw new Error("Test crypto and stocks separately (they trade on different clocks).");
      const ac = [...classes][0];
      const tf = timeframeMs(this.s.timeframes[ac]);
      const warmDays = Math.ceil((380 * tf) / 86_400_000);
      const data = {};
      const sources = new Set();
      for (const s of syms) {
        job.progress = `Downloading ${marketName(s)} history…`;
        this.emit("job", job);
        const m = { symbol: s, assetClass: ac };
        const v = venue || (this.demo ? "demo" : this.venueFor(m) || "kraken");
        const h = await this.data.history(v, await this.#venueSymbol(v, s).catch(() => s), tf, d + warmDays, { onProgress: (p) => ((job.progress = p), this.emit("job", job)) });
        if (!h?.bars?.length) throw new Error(`No price history for ${marketName(s)}${h?.error ? ` (${h.error})` : ""}.`);
        data[s] = h.bars;
        sources.add(h.source);
      }
      job.progress = "Replaying history through Kestrel…";
      this.emit("job", job);
      const feeVenue = venue || (this.mode === "live" ? this.s.connections[this.s.live.broker]?.venue : this.s.practiceVenue) || "kraken";
      const vf = ac === "stock" && venueInfo(feeVenue).stockFees ? venueInfo(feeVenue).stockFees : venueInfo(feeVenue).fees;
      const r = backtest({ data, timeframeMs: tf, assetClass: ac, risk, costs: { maker: vf.maker, taker: vf.taker, slippage: 0.0005 } });
      job.status = "done";
      job.result = { ...r, fills: undefined, sources: [...sources], feeVenue: venueInfo(feeVenue).name, fees: vf, names: Object.fromEntries(syms.map((s) => [s, marketName(s)])), trades: r.trades.slice(-200) };
      job.finishedAt = this.now();
      this.event({ type: "backtest", level: "info", text: `Test finished for ${syms.map(marketName).join(", ")} over ${d} days (${RISK_LEVELS[risk].label}): ${r.summary}` });
    })()
      .catch((e) => {
        job.status = "error";
        job.error = e.message;
      })
      .finally(() => this.emit("job", job));
    return job;
  }

  // ───────────────────────── confirmations (voice) and approvals (screen) ─────────────────────────
  /** Ask the person first: returns a token the agent sends back once they've said yes. */
  needConfirm(action, params, summary) {
    const token = id();
    this.confirms.set(token, { action, params: JSON.stringify(params), summary, expires: this.now() + 3 * 60_000 });
    return { needsConfirmation: true, confirm_token: token, summary, say: `Ask the person to confirm: "${summary}". If they say yes, call the same tool again with confirm_token "${token}".` };
  }

  checkConfirm(token, action, params) {
    const c = token && this.confirms.get(token);
    if (!c || c.action !== action || c.params !== JSON.stringify(params)) return false;
    this.confirms.delete(token);
    return true;
  }

  /** A real-money order from the voice agent waits for a tap on the screen. */
  requestApproval(order, summary) {
    const aid = id();
    this.approvals.set(aid, { id: aid, order, summary, createdAt: this.now(), expires: this.now() + 5 * 60_000 });
    this.emit("approvals");
    this.emit("change");
    return aid;
  }

  async approve(aid, yes) {
    const a = this.approvals.get(aid);
    if (!a) throw new Error("That request expired. Ask again.");
    this.approvals.delete(aid);
    this.emit("approvals");
    if (!yes) {
      this.event({ type: "info", level: "info", text: `You declined: ${a.summary}.` });
      return { ok: true, declined: true };
    }
    if (a.order.kind === "order") return this.order({ ...a.order, by: "you (approved on screen)" });
    throw new Error("Unknown request.");
  }
}

function balanceLine(b = {}) {
  const parts = Object.entries(b)
    .slice(0, 6)
    .map(([c, v]) => `${c} ${Number(v.total).toLocaleString("en-US", { maximumFractionDigits: 6 })}`);
  return parts.length ? `Balances: ${parts.join(", ")}.` : "The account is empty.";
}
