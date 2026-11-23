// What the voice agent can ask for. The agent's tools run in the browser (ElevenLabs "client
// tools") and each one calls POST /api/agent/tool, which lands here, so every tool behaves the
// same whether it's spoken, typed or tested.
//
// Safety ladder:
//   - Reading anything: always allowed.
//   - Pausing, lowering risk: done straight away (they only ever reduce risk).
//   - Anything else that changes the bot: the agent must read back a summary and get a yes
//     (confirm_token), and real-money orders then also need a tap on the screen.
//   - Switching to real money: never by voice; only on the dashboard.
import { RISK_LEVELS, RISK_ORDER } from "./risk.mjs";
import { marketName, normalizeSymbol } from "./markets.mjs";
import { VENUES, VENUE_ORDER, venueInfo } from "./brokers/catalog.mjs";

const money = (x) => (x == null ? null : `$${Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const pct = (x, d = 1) => (x == null ? null : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(d)}%`);
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const rate = (x) => (x == null ? null : `${Math.round(x * 100)}%`);
const ago = (t, now) => {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

export const TOOL_NAMES = ["get_overview", "get_positions", "get_trades", "get_activity", "get_market", "explain_decision", "run_backtest", "get_backtest", "control_bot", "set_risk", "manage_markets", "place_order", "get_setup"];

export async function runTool(engine, name, params = {}) {
  const fn = TOOLS[name];
  if (!fn) return { ok: false, error: `Unknown tool ${name}.` };
  try {
    return await fn(engine, params || {});
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function resolve(engine, symbol) {
  const sym = normalizeSymbol(symbol);
  if (!sym) throw new Error(`I don't know a market called "${symbol}".`);
  return sym;
}

const TOOLS = {
  get_overview(engine) {
    const s = engine.snapshot();
    const a = s.account;
    return {
      ok: true,
      briefing: engine.briefing(),
      mode: s.demo ? "demo" : s.mode,
      running: s.running,
      safety_stop: s.halted ? `Stopped by the safety limit (down ${(s.halted.drawdown * 100).toFixed(1)}% from the peak). Needs the person to press Start (or say start) to resume.` : null,
      no_new_buys_until: s.noBuysUntil ? new Date(s.noBuysUntil).toISOString() : null,
      risk: s.risk.label,
      money: { total: money(a.equity), cash: money(a.cash), invested: money(a.invested), since_start: `${pct(a.pnlPct)} (${money(a.pnl)})`, today: `${pct(a.todayPct)} (${money(a.today)})`, down_from_peak: pct(-a.drawdown) },
      positions: s.positions.map((p) => ({ market: p.name, value: money(p.value), gain: pct(p.pnlPct), stop: money(p.stop) })),
      markets: s.markets.map((m) => ({ market: m.name, symbol: m.symbol, price: money(m.price), view: m.ready ? `${m.stance} (${m.score >= 0 ? "+" : ""}${m.score.toFixed(2)})` : m.status, market_mood: m.regime, holding: m.holding > 0 })),
      pending_approvals: s.approvals.map((x) => x.summary),
    };
  },

  get_positions(engine) {
    const s = engine.snapshot();
    return {
      ok: true,
      count: s.positions.length,
      cash: money(s.account.cash),
      positions: s.positions.map((p) => ({ market: p.name, symbol: p.symbol, amount: p.qty, value: money(p.value), bought_at: money(p.entry), now: money(p.price), gain: pct(p.pnlPct), gain_dollars: money(p.pnl), stop: money(p.stop), stop_is_below_price_by: pct(p.stopDistance), held_since: p.since ? new Date(p.since).toISOString() : null })),
      note: s.positions.length ? undefined : "The bot holds no positions: it's all in cash.",
    };
  },

  get_trades(engine, { symbol, limit = 10 }) {
    const s = engine.snapshot();
    const sym = symbol ? resolve(engine, symbol) : null;
    const n = Math.max(1, Math.min(50, Number(limit) || 10));
    const trades = s.trades.filter((t) => !sym || t.symbol === sym).slice(0, n);
    const fills = s.fills.filter((f) => !sym || f.symbol === sym).slice(0, n);
    const wins = trades.filter((t) => t.pnl > 0).length;
    return {
      ok: true,
      finished_trades: trades.map((t) => ({ trade_id: t.id, market: marketName(t.symbol), opened: new Date(t.entryT).toISOString(), closed: new Date(t.exitT).toISOString(), bought_at: money(t.entry), sold_at: money(t.exit), result: `${pct(t.ret)} (${money(t.pnl)}) after ${money(t.fees)} fees`, why_it_sold: t.exitReason })),
      recent_orders: fills.map((f) => ({ when: ago(f.t, Date.now()), market: marketName(f.symbol), side: f.side, value: money(f.value), price: money(f.price), fee: money(f.fee), reason: f.reason, why: f.why, by: f.by })),
      summary: trades.length ? `${trades.length} finished trades shown, ${wins} winners.` : "No finished trades yet.",
    };
  },

  get_activity(engine, { limit = 12, kind }) {
    const s = engine.snapshot();
    const n = Math.max(1, Math.min(60, Number(limit) || 12));
    const list = s.events.filter((e) => !kind || e.type === kind).slice(0, n);
    return { ok: true, newest_first: list.map((e) => ({ when: new Date(e.t).toISOString(), ago: ago(e.t, Date.now()), type: e.type, text: e.text })) };
  },

  get_market(engine, { symbol }) {
    const sym = resolve(engine, symbol);
    const watched = engine.s.markets.some((m) => m.symbol === sym);
    if (!watched) return { ok: true, watched: false, market: marketName(sym), symbol: sym, note: "The bot isn't watching this market. manage_markets with action add can start watching it (after the person agrees)." };
    const v = engine.marketView(sym);
    return {
      ok: true,
      watched: true,
      market: v.name,
      symbol: sym,
      price: money(v.price),
      change_24h: pct(v.change24h),
      status: v.status === "ready" ? "ready" : `${v.status}${v.message ? `: ${v.message}` : ""}`,
      view: v.stance,
      score: v.score == null ? null : r2(v.score),
      market_mood: v.regime,
      summary: v.summary,
      reasons: v.reasons.map((r) => r.text),
      experts: v.experts.map((e) => ({ name: e.id, opinion: r2(e.score), say_weight: `${Math.round(e.weight * 100)}%` })),
      holding: v.holding > 0 ? { amount: v.holding, stop: money(v.stop) } : "not holding",
      bars: v.timeframe,
      next_decision: v.nextBar ? new Date(v.nextBar).toISOString() : null,
      thresholds: { buys_above: engine.preset.enter, sells_below: engine.preset.exit },
    };
  },

  explain_decision(engine, { symbol, trade_id }) {
    const s = engine.snapshot();
    if (trade_id) {
      const t = engine.s.trades.find((x) => x.id === trade_id);
      if (!t) return { ok: false, error: "No trade with that id. get_trades lists them." };
      const fills = engine.s.fills.filter((f) => f.symbol === t.symbol && f.t >= t.entryT - 60_000 && f.t <= t.exitT + 60_000);
      return { ok: true, market: marketName(t.symbol), result: `${pct(t.ret)} (${money(t.pnl)})`, steps: fills.map((f) => `${new Date(f.t).toISOString()}: ${f.side} ${money(f.value)} at ${money(f.price)} (${f.reason}${f.why ? `: ${f.why}` : ""})`) };
    }
    if (!symbol) {
      const f = s.fills[0];
      if (!f) return { ok: true, note: "The bot hasn't traded yet in this mode.", why_waiting: s.markets.map((m) => `${m.name}: ${m.summary}`) };
      return { ok: true, last_order: { market: marketName(f.symbol), side: f.side, value: money(f.value), price: money(f.price), when: new Date(f.t).toISOString(), reason: f.reason, why: f.why, view_then: f.view } };
    }
    const sym = resolve(engine, symbol);
    const v = engine.marketView(sym);
    const held = v.holding > 0;
    const p = engine.preset;
    let decision;
    if (!v.ready) decision = `Not deciding yet: ${v.message || "still reading the price history"}.`;
    else if (held) decision = v.score >= p.exit ? `Holding: the score (${v.score.toFixed(2)}) is still above the ${p.exit} sell line, and the stop at ${money(v.stop)} protects the downside.` : `About to sell: the score (${v.score.toFixed(2)}) is below the ${p.exit} sell line; it sells at the next decision.`;
    else if (v.score >= p.enter) decision = `Bullish enough to buy (score ${v.score.toFixed(2)} ≥ ${p.enter}); it buys at the next decision unless the market is below its long-term average, it's cooling off after a stop, or the daily loss limit is on.`;
    else decision = `Not buying: the score (${v.score.toFixed(2)}) is below the ${p.enter} needed to buy.`;
    const last = engine.s.fills.filter((f) => f.symbol === sym && f.mode === engine.mode).at(-1);
    return { ok: true, market: v.name, decision, summary: v.summary, reasons: v.reasons.map((r) => r.text), last_order: last ? { side: last.side, value: money(last.value), price: money(last.price), when: new Date(last.t).toISOString(), why: last.why } : null };
  },

  async run_backtest(engine, { symbols, symbol, days = 365, risk }) {
    const list = symbols?.length ? (Array.isArray(symbols) ? symbols : String(symbols).split(/[, ]+/)) : symbol ? [symbol] : null;
    const job = engine.startBacktest({ symbols: list, days, risk: risk || engine.s.risk });
    const deadline = Date.now() + 15_000;
    while (job.status === "running" && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    if (job.status === "running") return { ok: true, job_id: job.id, status: "running", say: "The test is still downloading history. Tell the person it's running and that you'll have results in a moment; the app will tell you when it finishes, or call get_backtest with the job id." };
    return backtestResult(job);
  },

  get_backtest(engine, { job_id }) {
    const job = engine.jobs.get(job_id) || [...engine.jobs.values()].at(-1);
    if (!job) return { ok: false, error: "No test has been run yet." };
    if (job.status === "running") return { ok: true, status: "running", progress: job.progress };
    return backtestResult(job);
  },

  async control_bot(engine, { action, confirm_token }) {
    const live = engine.mode === "live";
    if (action === "pause") {
      engine.pause("voice");
      return { ok: true, done: "Paused. Positions are kept; nothing will be bought or sold until it's started again." };
    }
    if (action === "start" || action === "resume") {
      if (live && !engine.checkConfirm(confirm_token, "start", {})) return engine.needConfirm("start", {}, `Start trading with REAL MONEY (${engine.preset.label} risk, budget ${money(engine.s.live.budget)})`);
      await engine.start();
      return { ok: true, done: `Started${live ? " with real money" : ""}. It acts on the latest signals now and then at every bar close.` };
    }
    if (action === "sell_all") {
      const n = Object.keys(engine.book.positions).length;
      if (!n) return { ok: true, done: "There's nothing to sell: the bot holds only cash." };
      if (!engine.checkConfirm(confirm_token, "sell_all", {})) return engine.needConfirm("sell_all", {}, `Sell all ${n} position${n > 1 ? "s" : ""} (${money(engine.account().invested)}) ${live ? "for REAL MONEY " : ""}at market prices and pause the bot`);
      const r = await engine.sellAll("voice");
      return { ok: true, done: `Sold ${r.sold} position(s) and paused.`, overview: engine.briefing() };
    }
    return { ok: false, error: 'action must be "start", "pause", "resume" or "sell_all".' };
  },

  set_risk(engine, { level, confirm_token }) {
    const id = String(level || "").toLowerCase();
    if (!RISK_LEVELS[id]) return { ok: false, error: `level must be one of: ${RISK_ORDER.join(", ")}.` };
    const now = engine.s.risk;
    if (id === now) return { ok: true, done: `Already ${RISK_LEVELS[id].label}.` };
    const higher = RISK_ORDER.indexOf(id) > RISK_ORDER.indexOf(now);
    if (higher && !engine.checkConfirm(confirm_token, "set_risk", { id })) {
      const r = RISK_LEVELS[id];
      return engine.needConfirm("set_risk", { id }, `Raise risk from ${RISK_LEVELS[now].label} to ${r.label}: up to ${Math.round(r.maxWeight * 100)}% in one market, safety stop at a ${Math.round(r.maxDrawdown * 100)}% drop`);
    }
    engine.setRisk(id);
    return { ok: true, done: `Risk is now ${RISK_LEVELS[id].label}. ${RISK_LEVELS[id].blurb}` };
  },

  async manage_markets(engine, { action, symbol, confirm_token }) {
    const sym = resolve(engine, symbol);
    if (action === "add") {
      if (engine.s.markets.some((m) => m.symbol === sym)) return { ok: true, done: `Already watching ${marketName(sym)}.` };
      if (!engine.checkConfirm(confirm_token, "add_market", { sym })) return engine.needConfirm("add_market", { sym }, `Add ${marketName(sym)} (${sym}) to the markets the bot trades${engine.mode === "live" ? " with REAL MONEY" : ""}`);
      const r = await engine.addMarket(sym);
      return { ok: true, done: r.ready ? `Now watching ${marketName(sym)}; it's ready to trade.` : `Added ${marketName(sym)}, but: ${r.message || "it's still reading the history"}.` };
    }
    if (action === "remove") {
      if (!engine.s.markets.some((m) => m.symbol === sym)) return { ok: true, done: `The bot isn't watching ${marketName(sym)}.` };
      const held = (engine.book.positions[sym] ?? 0) > 0;
      if (!engine.checkConfirm(confirm_token, "remove_market", { sym })) return engine.needConfirm("remove_market", { sym }, `Stop trading ${marketName(sym)}${held ? ", selling the position first" : ""}`);
      await engine.removeMarket(sym, { sell: true });
      return { ok: true, done: `Stopped watching ${marketName(sym)}${held ? " and sold the position" : ""}.` };
    }
    return { ok: false, error: 'action must be "add" or "remove".' };
  },

  async place_order(engine, { symbol, side, amount_usd, sell_everything_of_it, confirm_token }) {
    const sym = resolve(engine, symbol);
    if (side !== "buy" && side !== "sell") return { ok: false, error: 'side must be "buy" or "sell".' };
    const amount = amount_usd != null ? Number(amount_usd) : null;
    const all = side === "sell" && (sell_everything_of_it === true || amount == null);
    if (side === "buy" && !(amount >= 10)) return { ok: false, error: "Say how many dollars to buy (at least $10)." };
    const live = engine.mode === "live";
    if (live && side === "buy" && amount > engine.s.live.maxOrder) return { ok: false, error: `That's more than the largest single order allowed (${money(engine.s.live.maxOrder)}). The person can raise it in Settings on screen.` };
    const what = side === "buy" ? `Buy ${money(amount)} of ${marketName(sym)}` : all ? `Sell all of the bot's ${marketName(sym)}` : `Sell ${money(amount)} of ${marketName(sym)}`;
    const params = { sym, side, amount, all };
    if (!engine.checkConfirm(confirm_token, "order", params)) return engine.needConfirm("order", params, `${what}${live ? " with REAL MONEY" : " (practice money)"}, at the market price`);
    if (live) {
      engine.requestApproval({ kind: "order", symbol: sym, side, amount, all }, `${what} with real money`);
      return { ok: true, waiting_for_screen: true, say: "Real-money orders need one tap: tell the person the order is on their screen and to press Approve." };
    }
    const r = await engine.order({ symbol: sym, side, amount, all, by: "voice" });
    const f = r.fill;
    return { ok: true, done: f ? `${f.side === "buy" ? "Bought" : "Sold"} ${money(f.value)} of ${marketName(sym)} at ${money(f.price)} (fee ${money(f.fee)}).` : "Order sent." };
  },

  get_setup(engine) {
    const s = engine.snapshot();
    return {
      ok: true,
      mode: s.demo ? "demo (simulated market)" : s.mode,
      practice_prices_from: venueInfo(s.practiceVenue).name,
      fees_now: { maker: pct(s.fees.maker, 2), taker: pct(s.fees.taker, 2) },
      connected: s.connections.map((c) => ({ id: c.id, exchange: c.name, account: c.paper ? "paper (practice)" : c.sandbox ? "test" : "real money", fees: c.fees ? `${pct(c.fees.maker, 2)} / ${pct(c.fees.taker, 2)}` : null })),
      real_money: s.mode === "live" ? { exchange: s.live.broker, budget: money(s.live.budget), largest_order: money(s.live.maxOrder) } : "off",
      exchanges_available: VENUE_ORDER.map((k) => ({ id: k, name: VENUES[k].name, assets: VENUES[k].assets.join(" and "), fees: `${pct(VENUES[k].fees.maker, 2)} / ${pct(VENUES[k].fees.taker, 2)}`, about: VENUES[k].blurb })),
      how_to_connect: "Open Connect on the dashboard, pick the exchange, and paste an API key that can trade but not withdraw. Kestrel checks the key and keeps it on this computer only.",
      how_to_go_live: "Only on the dashboard: Connect an exchange, then Settings → Real money, set a budget and a largest single order, and type REAL MONEY. The agent can't switch to real money.",
      fee_advice: "Fees decide whether a trading bot makes money. Lower is better: Alpaca crypto (0.15%/0.25%) and Kraken Pro (0.25%/0.40%) suit Kestrel; Coinbase's base tier (0.6%/1.2%) eats most of the edge.",
    };
  },
};

function backtestResult(job) {
  if (job.status === "error") return { ok: false, error: `The test couldn't run: ${job.error}` };
  const r = job.result;
  const m = r.metrics;
  const b = r.benchmark;
  return {
    ok: true,
    status: "done",
    job_id: job.id,
    markets: r.symbols.map((s) => r.names[s]),
    period: `${new Date(r.from).toISOString().slice(0, 10)} to ${new Date(r.to).toISOString().slice(0, 10)}`,
    risk: r.risk,
    fees_used: `${r.feeVenue}: ${pct(r.fees.maker, 2)} maker / ${pct(r.fees.taker, 2)} taker`,
    kestrel: { return: pct(m.totalReturn), worst_drop: pct(m.maxDrawdown), sharpe: r2(m.sharpe), trades: m.trades, win_rate: rate(m.winRate), profit_factor: Number.isFinite(m.profitFactor) ? r2(m.profitFactor) : "no losing trades", invested_time: rate(m.exposure ?? 0), fees_paid: money(m.fees) },
    buy_and_hold: { return: pct(b.totalReturn), worst_drop: pct(b.maxDrawdown) },
    one_year_range: r.montecarlo ? { bad_case_5pct: pct(r.montecarlo.returnP5), typical: pct(r.montecarlo.returnP50), good_case_95pct: pct(r.montecarlo.returnP95), chance_of_loss: rate(r.montecarlo.chanceOfLoss) } : null,
    safety_stops: r.events.filter((e) => e.type === "breaker").length,
    summary: r.summary,
    caution: "Past results don't guarantee future ones; the range shows what the same edge could plausibly do.",
  };
}
