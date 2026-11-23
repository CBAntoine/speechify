// Alpaca (alpaca.markets): US stocks and ETFs (commission-free) and crypto, with a free paper
// account for practice and a live account for real money. Plain REST, no SDK.
//   Trading: https://paper-api.alpaca.markets (paper) or https://api.alpaca.markets (live)
//   Data:    https://data.alpaca.markets (crypto needs no key; stocks use the free IEX feed)

export const ALPACA = {
  paper: "https://paper-api.alpaca.markets",
  live: "https://api.alpaca.markets",
  data: "https://data.alpaca.markets",
};

const TF = { 3_600_000: "1Hour", 14_400_000: "4Hour", 86_400_000: "1Day" };

export class AlpacaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class AlpacaClient {
  constructor({ key = "", secret = "", paper = true, base = null, dataBase = ALPACA.data, fetchImpl = globalThis.fetch } = {}) {
    this.key = key;
    this.secret = secret;
    this.paper = paper;
    this.base = base || (paper ? ALPACA.paper : ALPACA.live);
    this.dataBase = dataBase;
    this.fetch = fetchImpl;
  }

  get hasKeys() {
    return !!(this.key && this.secret);
  }

  async #req(url, { method = "GET", body, auth = true } = {}) {
    const headers = { accept: "application/json" };
    if (auth && this.hasKeys) {
      headers["APCA-API-KEY-ID"] = this.key;
      headers["APCA-API-SECRET-KEY"] = this.secret;
    }
    if (body) headers["content-type"] = "application/json";
    let res;
    try {
      res = await this.fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new AlpacaError(0, `Couldn't reach Alpaca (${e.cause?.code || e.message}).`);
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text };
    }
    if (!res.ok) {
      const msg = data?.message || `Alpaca answered ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new AlpacaError(res.status, /forbidden|unauthorized|not authorized/i.test(msg) ? "Alpaca didn't accept those keys. Check the key ID and secret, and that they're for the right account (paper or live)." : msg);
      throw new AlpacaError(res.status, msg);
    }
    return data;
  }

  // ── trading ──
  account() {
    return this.#req(`${this.base}/v2/account`);
  }
  positions() {
    return this.#req(`${this.base}/v2/positions`);
  }
  clock() {
    return this.#req(`${this.base}/v2/clock`);
  }
  asset(symbol) {
    return this.#req(`${this.base}/v2/assets/${encodeURIComponent(symbol)}`);
  }
  order(id) {
    return this.#req(`${this.base}/v2/orders/${encodeURIComponent(id)}`);
  }
  cancel(id) {
    return this.#req(`${this.base}/v2/orders/${encodeURIComponent(id)}`, { method: "DELETE" }).catch((e) => {
      if (e.status !== 422 && e.status !== 404) throw e;
    });
  }
  /** {symbol, side, type, qty | notional, limit_price, time_in_force} */
  submit(order) {
    return this.#req(`${this.base}/v2/orders`, { method: "POST", body: order });
  }

  // ── market data ──
  async bars(symbol, tfMs, { start, end, limit = 10_000 } = {}) {
    const crypto = symbol.includes("/");
    const tf = TF[tfMs];
    if (!tf) throw new AlpacaError(400, `Alpaca doesn't have ${tfMs / 3_600_000}-hour bars.`);
    if (!crypto && !this.hasKeys) throw new AlpacaError(401, "Stock prices from Alpaca need your free Alpaca keys: connect Alpaca (a paper account is fine).");
    const out = [];
    let token = null;
    let pages = 0;
    do {
      const q = new URLSearchParams({ symbols: symbol, timeframe: tf, limit: String(Math.min(limit, 10_000)), sort: "asc" });
      if (start) q.set("start", new Date(start).toISOString());
      if (end) q.set("end", new Date(end).toISOString());
      if (token) q.set("page_token", token);
      if (!crypto) {
        q.set("feed", "iex");
        q.set("adjustment", "all");
      }
      const url = crypto ? `${this.dataBase}/v1beta3/crypto/us/bars?${q}` : `${this.dataBase}/v2/stocks/bars?${q}`;
      const data = await this.#req(url, { auth: !crypto || this.hasKeys });
      for (const b of data?.bars?.[symbol] ?? []) out.push({ t: Date.parse(b.t), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      token = data?.next_page_token;
      pages++;
    } while (token && pages < 50);
    return out;
  }

  async quote(symbol) {
    const crypto = symbol.includes("/");
    if (crypto) {
      const d = await this.#req(`${this.dataBase}/v1beta3/crypto/us/latest/quotes?symbols=${encodeURIComponent(symbol)}`, { auth: this.hasKeys });
      const q = d?.quotes?.[symbol];
      if (!q) throw new AlpacaError(404, `No price for ${symbol} on Alpaca.`);
      return { bid: q.bp, ask: q.ap, last: (q.bp + q.ap) / 2, t: Date.parse(q.t) };
    }
    if (!this.hasKeys) throw new AlpacaError(401, "Stock prices from Alpaca need your Alpaca keys.");
    const [qd, td] = await Promise.all([this.#req(`${this.dataBase}/v2/stocks/quotes/latest?symbols=${encodeURIComponent(symbol)}&feed=iex`), this.#req(`${this.dataBase}/v2/stocks/trades/latest?symbols=${encodeURIComponent(symbol)}&feed=iex`)]);
    const q = qd?.quotes?.[symbol];
    const tr = td?.trades?.[symbol];
    if (!q && !tr) throw new AlpacaError(404, `No price for ${symbol} on Alpaca.`);
    const last = tr?.p ?? (q.bp + q.ap) / 2;
    return { bid: q?.bp || last, ask: q?.ap || last, last, t: Date.parse(tr?.t ?? q?.t) };
  }
}
