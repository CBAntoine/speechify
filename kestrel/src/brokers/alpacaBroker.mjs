// Trading through Alpaca: stocks and ETFs (commission-free, fractional by dollar amount) and
// crypto. Works with the free paper account and with a live account.
import { AlpacaClient } from "./alpaca.mjs";
import { VENUES } from "./catalog.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class AlpacaBroker {
  constructor({ credentials = {}, paper = true, client = null }) {
    this.client = client || new AlpacaClient({ key: credentials.apiKey, secret: credentials.secret, paper });
    this.paper = paper;
    this.live = !paper;
    this.sandbox = paper;
    this.id = "alpaca";
    this.venue = "alpaca";
    this.name = paper ? "Alpaca (paper)" : "Alpaca";
    this.clockAt = 0;
    this.clockVal = null;
  }

  async connect() {
    try {
      const a = await this.client.account();
      if (a.trading_blocked || a.account_blocked) return { ok: false, message: "Alpaca says this account is blocked from trading. Check your Alpaca dashboard." };
      return { ok: true, balances: { USD: { total: Number(a.cash), free: Number(a.buying_power ?? a.cash) } }, equity: Number(a.equity), status: a.status, crypto: a.crypto_status, paper: this.paper };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  async balance() {
    const [a, pos] = await Promise.all([this.client.account(), this.client.positions()]);
    const out = { USD: { total: Number(a.cash), free: Number(a.cash) } };
    for (const p of pos || []) out[p.symbol] = { total: Number(p.qty), free: Number(p.qty_available ?? p.qty) };
    return out;
  }

  fees(symbol) {
    return String(symbol).includes("/") ? { ...VENUES.alpaca.fees, source: "published base tier" } : { ...VENUES.alpaca.stockFees, source: "commission-free" };
  }

  /** Stocks trade in market hours; crypto around the clock. */
  async marketOpen(symbol) {
    if (String(symbol).includes("/")) return true;
    if (Date.now() - this.clockAt > 60_000) {
      this.clockVal = await this.client.clock();
      this.clockAt = Date.now();
    }
    return !!this.clockVal?.is_open;
  }

  async execute({ symbol, side, qty, notional, patient = true, patientSeconds = 90 }) {
    const crypto = symbol.includes("/");
    const fees = this.fees(symbol);
    let first = null;
    let filledQty = 0;
    let filledCost = 0;
    let maker = false;
    const round = (x, d) => Math.floor(x * 10 ** d) / 10 ** d;

    if (crypto && patient) {
      const q = await this.client.quote(symbol);
      const price = side === "buy" ? q.bid : q.ask;
      const amount = side === "buy" ? notional / price : qty;
      first = await this.client.submit({ symbol, side, type: "limit", qty: String(round(amount, 8)), limit_price: String(Number(price.toPrecision(8))), time_in_force: "gtc" });
      const o = await this.#await(first.id, patientSeconds * 1000);
      filledQty += Number(o.filled_qty || 0);
      filledCost += Number(o.filled_qty || 0) * Number(o.filled_avg_price || 0);
      maker = filledQty > 0;
      if (side === "sell") qty = round(qty - filledQty, 8);
      else notional = Math.max(0, notional - filledCost);
    }
    const left = side === "buy" ? notional >= 1 : qty > 0;
    if (left) {
      const order = { symbol, side, type: "market", time_in_force: crypto ? "gtc" : "day" };
      if (side === "buy") order.notional = String(Math.floor(notional * 100) / 100);
      else order.qty = String(round(qty, crypto ? 8 : 9));
      const o0 = await this.client.submit(order);
      const o = await this.#await(o0.id, 30_000);
      filledQty += Number(o.filled_qty || 0);
      filledCost += Number(o.filled_qty || 0) * Number(o.filled_avg_price || 0);
    }
    if (!(filledQty > 0)) throw new Error(`Alpaca didn't fill the ${side} order for ${symbol}${crypto ? "" : " (stock orders only fill while the market is open)"}.`);
    const price = filledCost / filledQty;
    const rate = maker ? fees.maker : fees.taker;
    const fee = filledCost * rate;
    // Alpaca takes the crypto fee from the coin you receive on a buy.
    const qtyNet = crypto && side === "buy" ? filledQty * (1 - rate) : filledQty;
    return { symbol, side, qty: qtyNet, price, fee, maker, t: Date.now(), orderIds: [first?.id].filter(Boolean) };
  }

  async #await(id, ms) {
    const deadline = Date.now() + ms;
    let o = await this.client.order(id);
    while (!["filled", "canceled", "expired", "rejected", "done_for_day"].includes(o.status)) {
      if (Date.now() > deadline) {
        await this.client.cancel(id);
        await sleep(800);
        o = await this.client.order(id);
        break;
      }
      await sleep(2000);
      o = await this.client.order(id);
    }
    return o;
  }
}
