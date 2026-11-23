// Real trading on crypto exchanges through CCXT. Orders are "patient" by default: a post-only
// limit order rests at the best bid (buys) or ask (sells), so it pays the lower maker fee; if it
// hasn't filled after a while, the rest goes out as a market order. Stops and "sell now" go out at
// market straight away.
import { ccxt, ccxtOptions } from "../data/feed.mjs";
import { venueInfo } from "./catalog.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function friendlyExchangeError(e, name = "The exchange") {
  const C = ccxt();
  const m = String(e?.message || e).replace(/\s+/g, " ").slice(0, 240);
  if (e instanceof C.AuthenticationError || /invalid.*(key|sign|nonce)|unauthor|api-key|permission denied|EAPI:Invalid key/i.test(m)) return `${name} didn't accept the API key. Check that you copied the key and secret exactly, and that the key is still active.`;
  if (e instanceof C.PermissionDenied || /permission/i.test(m)) return `${name} says this API key doesn't have permission to do that. Give it trading permission (never withdrawal).`;
  if (e instanceof C.InsufficientFunds) return `${name} says there isn't enough money in the account for that order.`;
  if (e instanceof C.InvalidOrder) return `${name} turned the order down: ${m}`;
  if (e instanceof C.DDoSProtection || e instanceof C.RateLimitExceeded) return `${name} asked Kestrel to slow down. It will try again shortly.`;
  if (e instanceof C.ExchangeNotAvailable || e instanceof C.NetworkError || e instanceof C.RequestTimeout) return `Couldn't reach ${name} (${m}).`;
  return `${name}: ${m}`;
}

export class CcxtBroker {
  constructor({ venue, credentials = {}, sandbox = false }) {
    const C = ccxt();
    if (!C[venue]) throw new Error(`Kestrel doesn't know an exchange called "${venue}".`);
    this.venue = venue;
    this.info = venueInfo(venue);
    this.name = this.info.name;
    this.id = venue;
    this.live = true;
    this.sandbox = !!sandbox;
    const creds = {};
    for (const k of ["apiKey", "secret", "password", "uid", "login"]) if (credentials[k]) creds[k] = credentials[k];
    this.ex = new C[venue](ccxtOptions(creds));
    if (sandbox) {
      if (!this.ex.urls?.test) throw new Error(`${this.name} has no test environment, so it can only be connected for real money.`);
      this.ex.setSandboxMode(true);
    }
    this.feeCache = new Map();
    this.loaded = false;
  }

  async #load() {
    if (!this.loaded) {
      await this.ex.loadMarkets();
      this.loaded = true;
    }
  }

  /** Check the keys work and read the balance. */
  async connect() {
    try {
      await this.#load();
      const bal = await this.ex.fetchBalance();
      return { ok: true, balances: summarizeBalance(bal), sandbox: this.sandbox };
    } catch (e) {
      return { ok: false, message: friendlyExchangeError(e, this.name) };
    }
  }

  async balance() {
    await this.#load();
    return summarizeBalance(await this.ex.fetchBalance());
  }

  async marketOpen() {
    return true;
  }

  async fees(symbol) {
    if (this.feeCache.has(symbol)) return this.feeCache.get(symbol);
    let f = null;
    try {
      await this.#load();
      if (this.ex.has.fetchTradingFee) {
        const r = await this.ex.fetchTradingFee(symbol);
        if (r?.maker != null && r?.taker != null) f = { maker: r.maker, taker: r.taker, source: "your account" };
      }
    } catch {
      /* fall back to the published schedule */
    }
    f ??= { ...this.info.fees, source: "published base tier" };
    this.feeCache.set(symbol, f);
    return f;
  }

  rules(symbol) {
    const m = this.ex.market(symbol);
    return { minQty: m.limits?.amount?.min ?? 0, minCost: m.limits?.cost?.min ?? 0, base: m.base, quote: m.quote };
  }

  #amount(symbol, q) {
    return Number(this.ex.amountToPrecision(symbol, q));
  }

  /**
   * Buy (by dollar amount) or sell (by quantity). Returns the combined fill:
   * {symbol, side, qty, price, fee, maker, t, orderIds}
   */
  async execute({ symbol, side, qty, notional, patient = true, patientSeconds = 90 }) {
    await this.#load();
    const m = this.ex.market(symbol);
    const t = await this.ex.fetchTicker(symbol);
    const ref = side === "buy" ? t.ask || t.last : t.bid || t.last;
    if (!(ref > 0)) throw new Error(`${this.name} has no price for ${symbol} right now.`);
    let amount = side === "buy" ? notional / ref : qty;
    amount = this.#amount(symbol, amount);
    const r = this.rules(symbol);
    if (!(amount > 0) || amount < r.minQty || amount * ref < r.minCost) throw new Error(`That order is below ${this.name}'s minimum for ${symbol} (at least ${r.minQty} ${m.base}${r.minCost ? ` or $${r.minCost}` : ""}).`);

    const fills = [];
    let remaining = amount;
    if (patient && this.ex.has.createOrder) {
      const price = side === "buy" ? t.bid || ref : t.ask || ref;
      try {
        const o = await this.ex.createOrder(symbol, "limit", side, remaining, Number(this.ex.priceToPrecision(symbol, price)), { postOnly: true });
        const done = await this.#await(o.id, symbol, patientSeconds * 1000);
        if (done.filled > 0) fills.push(done);
        remaining = this.#amount(symbol, remaining - (done.filled || 0));
      } catch (e) {
        // Post-only refused (the price moved) or not supported: fall through to a market order.
        if (!(e instanceof ccxt().InvalidOrder) && !(e instanceof ccxt().OrderImmediatelyFillable) && !/post.?only|would.*(take|cross)|immediately/i.test(String(e.message))) throw e;
      }
    }
    if (remaining > 0 && remaining >= r.minQty && remaining * ref >= (r.minCost || 0)) {
      let o;
      if (side === "buy" && this.ex.has.createMarketBuyOrderWithCost && !fills.length) o = await this.ex.createMarketBuyOrderWithCost(symbol, Number(this.ex.costToPrecision?.(symbol, notional) ?? notional));
      else o = await this.ex.createOrder(symbol, "market", side, remaining);
      const done = await this.#await(o.id, symbol, 30_000, o);
      if (done.filled > 0) fills.push(done);
    }
    if (!fills.length) throw new Error(`${this.name} didn't fill the ${side} order for ${symbol}.`);
    return this.#combine(symbol, side, fills, m);
  }

  async #await(id, symbol, ms, first = null) {
    const deadline = Date.now() + ms;
    let o = first;
    while (true) {
      try {
        o = await this.ex.fetchOrder(id, symbol);
      } catch (e) {
        if (!o) throw e;
      }
      if (o && (o.status === "closed" || o.status === "canceled" || o.status === "rejected" || o.status === "expired")) break;
      if (Date.now() > deadline) {
        try {
          await this.ex.cancelOrder(id, symbol);
        } catch {
          /* already filled or gone */
        }
        try {
          o = await this.ex.fetchOrder(id, symbol);
        } catch {
          /* keep what we have */
        }
        break;
      }
      await sleep(3000);
    }
    return { filled: o?.filled ?? 0, average: o?.average ?? o?.price ?? 0, cost: o?.cost ?? (o?.filled ?? 0) * (o?.average ?? 0), fee: o?.fee, fees: o?.fees, maker: o?.type === "limit", id };
  }

  #combine(symbol, side, fills, m) {
    let qty = 0;
    let cost = 0;
    let feeQuote = 0;
    let feeBase = 0;
    for (const f of fills) {
      qty += f.filled;
      cost += f.cost || f.filled * f.average;
      for (const fee of f.fees?.length ? f.fees : f.fee ? [f.fee] : []) {
        if (!fee?.cost) continue;
        if (fee.currency === m.base) feeBase += fee.cost;
        else feeQuote += fee.currency === m.quote ? fee.cost : 0;
      }
    }
    const price = qty > 0 ? cost / qty : 0;
    // Exchanges that take the fee from the coin you receive leave you a little less of it.
    if (side === "buy" && feeBase) qty -= feeBase;
    const fee = feeQuote + feeBase * price;
    return { symbol, side, qty, price, fee: fee || cost * (fills.some((f) => f.maker) ? this.info.fees.maker : this.info.fees.taker), maker: fills.every((f) => f.maker), t: Date.now(), orderIds: fills.map((f) => f.id) };
  }
}

function summarizeBalance(bal) {
  const out = {};
  for (const [cur, v] of Object.entries(bal?.total || {})) if (v > 0) out[cur] = { total: v, free: bal.free?.[cur] ?? v };
  return out;
}
