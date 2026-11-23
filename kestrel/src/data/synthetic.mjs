// A simulated market for demo mode and tests. Prices follow a random walk that switches between
// bull, bear and choppy regimes (so the bot has trends to catch and traps to avoid), on a sped-up
// clock: one 4-hour bar every few seconds. Every symbol gets its own repeatable price path.

const START_PRICE = { BTC: 61000, ETH: 1700, SOL: 72, XRP: 0.55, DOGE: 0.12, ADA: 0.45, AVAX: 22, LINK: 13, LTC: 70, SPY: 590, QQQ: 515, AAPL: 230, MSFT: 430, NVDA: 140, TSLA: 260, AMZN: 210, GOOGL: 175, META: 600 };

function hashSeed(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0 || 1;
}

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function gauss(rand) {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const REGIMES = {
  bull: { drift: 0.0022, vol: 0.011, stay: 0.985 },
  bear: { drift: -0.0022, vol: 0.014, stay: 0.982 },
  chop: { drift: 0, vol: 0.009, stay: 0.975 },
};

export class SyntheticMarket {
  /**
   * @param speed how many market milliseconds pass per real millisecond (default: a 4h bar every 4s)
   * @param history bars of history before "now"
   */
  constructor({ speed = 3600, history = 900, barMs = 14_400_000, now = Date.now() } = {}) {
    this.speed = speed;
    this.barMs = barMs;
    this.historyBars = history;
    this.wallStart = now;
    // Market time starts on a bar boundary, `history` bars after the first generated bar.
    this.marketStart = Math.floor(now / barMs) * barMs;
    this.series = new Map();
  }

  /** Market time right now (runs `speed` times faster than the wall clock). */
  now(wall = Date.now()) {
    return this.marketStart + (wall - this.wallStart) * this.speed;
  }

  #series(symbol) {
    let s = this.series.get(symbol);
    if (!s) {
      const base = String(symbol).split("/")[0].toUpperCase();
      const rand = rng(hashSeed(symbol));
      s = { rand, bars: [], regime: "chop", price: START_PRICE[base] ?? 50 + (hashSeed(base) % 200), t0: this.marketStart - this.historyBars * this.barMs };
      this.series.set(symbol, s);
    }
    return s;
  }

  #extend(s, untilT) {
    while ((s.bars.at(-1)?.t ?? s.t0 - this.barMs) + this.barMs <= untilT) {
      const t = (s.bars.at(-1)?.t ?? s.t0 - this.barMs) + this.barMs;
      const r = REGIMES[s.regime];
      if (s.rand() > r.stay) {
        const k = s.rand();
        s.regime = k < 0.38 ? "bull" : k < 0.7 ? "bear" : "chop";
      }
      const open = s.price;
      // Four sub-steps inside the bar make a believable high and low.
      let p = open;
      let hi = open;
      let lo = open;
      for (let i = 0; i < 4; i++) {
        p *= Math.exp(r.drift / 4 + (r.vol / 2) * gauss(s.rand));
        hi = Math.max(hi, p);
        lo = Math.min(lo, p);
      }
      hi *= 1 + Math.abs(gauss(s.rand)) * r.vol * 0.15;
      lo *= 1 - Math.abs(gauss(s.rand)) * r.vol * 0.15;
      const vol = Math.round((800 + s.rand() * 1200) * (1 + Math.abs(Math.log(p / open)) * 60));
      s.bars.push({ t, o: open, h: hi, l: lo, c: p, v: vol });
      s.price = p;
    }
  }

  /** Closed bars of `tfMs` (a multiple of the base bar), oldest first. */
  bars(symbol, tfMs = this.barMs, count = 500, wall = Date.now()) {
    const s = this.#series(symbol);
    const now = this.now(wall);
    const lastClosedStart = Math.floor(now / this.barMs) * this.barMs - this.barMs;
    this.#extend(s, lastClosedStart);
    let bars = s.bars.filter((b) => b.t <= lastClosedStart);
    if (tfMs > this.barMs) {
      const k = tfMs / this.barMs;
      const out = [];
      for (const b of bars) {
        const bucket = Math.floor(b.t / tfMs) * tfMs;
        const cur = out.at(-1);
        if (!cur || cur.t !== bucket) out.push({ ...b, t: bucket, n: 1 });
        else {
          cur.h = Math.max(cur.h, b.h);
          cur.l = Math.min(cur.l, b.l);
          cur.c = b.c;
          cur.v += b.v;
          cur.n++;
        }
      }
      if (out.length && out.at(-1).n < k) out.pop();
      bars = out.map(({ n, ...b }) => b);
    }
    return bars.slice(-count);
  }

  /** The live price inside the bar that's still forming, with a small bid/ask spread. */
  price(symbol, wall = Date.now()) {
    const s = this.#series(symbol);
    const now = this.now(wall);
    const curStart = Math.floor(now / this.barMs) * this.barMs;
    this.#extend(s, curStart);
    const bar = s.bars.find((b) => b.t === curStart) ?? s.bars.at(-1);
    const prev = s.bars[s.bars.indexOf(bar) - 1] ?? bar;
    const progress = Math.min(1, Math.max(0, (now - curStart) / this.barMs));
    // Walk from the open toward the close, touching the low or high on the way.
    const mid = bar.c >= bar.o ? bar.l : bar.h;
    const last = progress < 0.5 ? prev.c + (mid - prev.c) * (progress * 2) : mid + (bar.c - mid) * ((progress - 0.5) * 2);
    const spread = last * 0.0004;
    return { last, bid: last - spread / 2, ask: last + spread / 2, t: now };
  }
}
