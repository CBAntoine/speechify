// Market data: closed bars and live prices from any public exchange (through CCXT, no account
// needed), from Alpaca (stocks and crypto), or from the simulated market in demo mode. Long
// histories for backtests are cached on disk.
import { createRequire } from "node:module";
import { AlpacaClient } from "../brokers/alpaca.mjs";
import { resample } from "../strategy/indicators.mjs";
import { venueInfo } from "../brokers/catalog.mjs";

const require = createRequire(import.meta.url);
let ccxtLib = null;
/** CCXT is big; load it the first time it's needed. */
export function ccxt() {
  if (!ccxtLib) ccxtLib = require("ccxt");
  return ccxtLib;
}

const TF_MS = { "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000, "1d": 86_400_000 };
export const tfName = (ms) => Object.keys(TF_MS).find((k) => TF_MS[k] === ms) || "4h";

/** Settings every CCXT instance gets: rate limits, timeouts, and the HTTPS proxy if one is set. */
export function ccxtOptions(extra = {}) {
  const o = { enableRateLimit: true, timeout: 20_000, ...extra };
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) o.httpsProxy = proxy;
  return o;
}

export class MarketData {
  constructor({ store = null, demo = null, alpacaKeys = () => ({}) } = {}) {
    this.store = store;
    this.demo = demo;
    this.alpacaKeys = alpacaKeys;
    this.exchanges = new Map();
    this.marketsLoaded = new Map();
  }

  isDemo() {
    return !!this.demo;
  }

  publicExchange(venue) {
    let ex = this.exchanges.get(venue);
    if (!ex) {
      const C = ccxt();
      if (!C[venue]) throw new Error(`Unknown exchange "${venue}".`);
      ex = new C[venue](ccxtOptions());
      this.exchanges.set(venue, ex);
    }
    return ex;
  }

  async loadMarkets(ex) {
    const at = this.marketsLoaded.get(ex.id);
    if (at && Date.now() - at < 3_600_000) return ex.markets;
    await ex.loadMarkets(!!at);
    this.marketsLoaded.set(ex.id, Date.now());
    return ex.markets;
  }

  alpaca() {
    const k = this.alpacaKeys() || {};
    return new AlpacaClient({ key: k.apiKey, secret: k.secret, paper: k.paper !== false });
  }

  /** The last `count` closed bars, oldest first. */
  async bars(venue, symbol, tfMs, count = 500) {
    if (this.demo) return this.demo.bars(symbol, tfMs, count);
    if (venueInfo(venue).kind === "alpaca") {
      const lookback = tfMs >= 86_400_000 ? count * 1.6 : count * (symbol.includes("/") ? 1.05 : 4.2);
      const bars = await this.alpaca().bars(symbol, tfMs, { start: Date.now() - lookback * tfMs - 5 * 86_400_000 });
      return bars.filter((b) => b.t + tfMs <= Date.now()).slice(-count);
    }
    return this.#ccxtBars(this.publicExchange(venue), symbol, tfMs, { count });
  }

  async #ccxtBars(ex, symbol, tfMs, { count = 500, since = null, until = Date.now() } = {}) {
    await this.loadMarkets(ex);
    if (!ex.markets[symbol]) throw new Error(`${ex.name || ex.id} doesn't list ${symbol}.`);
    const want = tfName(tfMs);
    let baseTf = ex.timeframes?.[want] ? want : null;
    if (!baseTf) baseTf = ["2h", "1h", "30m", "15m"].find((t) => ex.timeframes?.[t] && tfMs % TF_MS[t] === 0);
    if (!baseTf) throw new Error(`${ex.name || ex.id} doesn't have ${want} bars.`);
    const baseMs = TF_MS[baseTf];
    const factor = tfMs / baseMs;
    const perCall = Math.min(ex.features?.spot?.fetchOHLCV?.limit || 300, 1000);
    let start = since ?? until - (count * factor + factor + 2) * baseMs;
    const all = new Map();
    for (let calls = 0; start < until - baseMs && calls < 400; calls++) {
      const rows = await ex.fetchOHLCV(symbol, baseTf, start, perCall);
      if (!rows?.length) {
        // Nothing here (before the market existed, or a gap): skip ahead.
        start += perCall * baseMs;
        if (since == null) break;
        continue;
      }
      for (const r of rows) if (r[0] >= (since ?? 0)) all.set(r[0], { t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] ?? 0 });
      const last = rows.at(-1)[0];
      if (last + baseMs <= start) break;
      start = last + baseMs;
    }
    let bars = [...all.values()].sort((a, b) => a.t - b.t).filter((b) => b.t + baseMs <= Date.now() && b.t < until);
    if (factor > 1) bars = resample(bars, baseMs, tfMs);
    return since != null ? bars : bars.slice(-count);
  }

  /** Live price: {last, bid, ask, t}. */
  async price(venue, symbol) {
    if (this.demo) return this.demo.price(symbol);
    if (venueInfo(venue).kind === "alpaca") return this.alpaca().quote(symbol);
    const ex = this.publicExchange(venue);
    await this.loadMarkets(ex);
    const t = await ex.fetchTicker(symbol);
    const last = t.last ?? t.close ?? (t.bid && t.ask ? (t.bid + t.ask) / 2 : null);
    if (!(last > 0)) throw new Error(`No price for ${symbol} on ${ex.name || ex.id} right now.`);
    return { last, bid: t.bid || last, ask: t.ask || last, t: t.timestamp || Date.now(), change24h: t.percentage != null ? t.percentage / 100 : null };
  }

  /**
   * Bars covering the last `days` days, for backtests. Cached on disk and topped up. If the
   * chosen exchange can't go that far back (Kraken keeps only 720 bars), another exchange
   * with the same market fills in.
   */
  async history(venue, symbol, tfMs, days, { onProgress } = {}) {
    const from = Date.now() - days * 86_400_000;
    if (this.demo) {
      const n = Math.ceil((days * 86_400_000) / tfMs);
      return { bars: this.demo.bars(symbol, tfMs, n), source: "simulated market" };
    }
    const sources = venueInfo(venue).kind === "alpaca" ? ["alpaca"] : symbol.includes("/") ? [...new Set([venue, "coinbase", "alpaca", "kraken"])] : ["alpaca"];
    let best = null;
    for (const src of sources) {
      try {
        const bars = await this.#cachedHistory(src, symbol, tfMs, from, onProgress);
        if (!best || bars.length > best.bars.length) best = { bars, source: venueInfo(src).name };
        if (bars.length && bars[0].t <= from + 3 * tfMs) break;
      } catch (e) {
        if (!best) best = { bars: [], source: venueInfo(src).name, error: e.message };
      }
    }
    return best;
  }

  async #cachedHistory(src, symbol, tfMs, from, onProgress) {
    const key = `${src}_${symbol}_${tfName(tfMs)}`;
    const cached = this.store?.readCache(key)?.bars || [];
    let bars = cached;
    const fetchRange = async (since, until) => {
      if (venueInfo(src).kind === "alpaca") return (await this.alpaca().bars(symbol, tfMs, { start: since, end: until })).filter((b) => b.t + tfMs <= Date.now());
      return this.#ccxtBars(this.publicExchange(src), symbol, tfMs, { since, until });
    };
    if (!bars.length || bars[0].t > from + tfMs) {
      onProgress?.(`Downloading ${symbol} history from ${venueInfo(src).name}…`);
      const older = await fetchRange(from, bars.length ? bars[0].t : Date.now());
      bars = mergeBars(older, bars);
    }
    const lastT = bars.at(-1)?.t ?? from;
    if (lastT + 2 * tfMs <= Date.now()) {
      const newer = await fetchRange(lastT + tfMs, Date.now());
      bars = mergeBars(bars, newer);
    }
    if (bars.length !== cached.length) await this.store?.writeCache(key, { bars });
    return bars.filter((b) => b.t >= from);
  }

  /** Markets on an exchange matching what the person typed. */
  async search(venue, query = "", { limit = 30 } = {}) {
    const q = String(query).trim().toUpperCase();
    if (this.demo || venueInfo(venue).kind === "alpaca") return [];
    const ex = this.publicExchange(venue);
    await this.loadMarkets(ex);
    const prefer = ["USD", "USDC", "USDT", "CAD", "EUR"];
    return Object.values(ex.markets)
      .filter((m) => m.spot && m.active !== false && prefer.includes(m.quote) && (!q || m.base === q || m.symbol.includes(q) || String(m.baseName || "").toUpperCase().includes(q)))
      .sort((a, b) => (a.base === q ? -1 : 0) - (b.base === q ? -1 : 0) || prefer.indexOf(a.quote) - prefer.indexOf(b.quote) || a.symbol.localeCompare(b.symbol))
      .slice(0, limit)
      .map((m) => ({ symbol: m.symbol, base: m.base, quote: m.quote }));
  }

  /** Does this exchange list the market? (Cheap: uses the cached market list.) */
  async hasMarket(venue, symbol) {
    if (this.demo) return true;
    if (venueInfo(venue).kind === "alpaca") {
      if (symbol.includes("/")) return true;
      try {
        await this.alpaca().quote(symbol);
        return true;
      } catch (e) {
        if (e.status === 401) return true; // can't check without keys; the first price fetch will say
        return false;
      }
    }
    const ex = this.publicExchange(venue);
    await this.loadMarkets(ex);
    return !!ex.markets[symbol];
  }
}

function mergeBars(a, b) {
  const m = new Map();
  for (const x of a) m.set(x.t, x);
  for (const x of b) m.set(x.t, x);
  return [...m.values()].sort((x, y) => x.t - y.t);
}
