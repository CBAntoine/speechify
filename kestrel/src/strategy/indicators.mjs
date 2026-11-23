// Streaming indicators: each one takes one new value (or bar) at a time and keeps only what it
// needs. The backtester, practice trading and live trading all feed bars through these in time
// order, so every decision is made only from bars that had already closed.

export class EMA {
  constructor(period) {
    this.alpha = 2 / (period + 1);
    this.value = null;
  }
  update(x) {
    this.value = this.value == null ? x : this.value + this.alpha * (x - this.value);
    return this.value;
  }
}

/** Wilder's smoothing (RMA): the average used by RSI, ATR and ADX. */
export class RMA {
  constructor(period) {
    this.period = period;
    this.value = null;
    this.n = 0;
    this.sum = 0;
  }
  update(x) {
    if (this.n < this.period) {
      this.n++;
      this.sum += x;
      this.value = this.sum / this.n;
    } else this.value = (this.value * (this.period - 1) + x) / this.period;
    return this.value;
  }
}

/** A fixed-size window over the last `size` values, oldest first. */
export class Window {
  constructor(size) {
    this.size = size;
    this.buf = new Float64Array(size);
    this.start = 0;
    this.length = 0;
    this.sum = 0;
    this.sumSq = 0;
  }
  push(x) {
    if (this.length < this.size) {
      this.buf[(this.start + this.length) % this.size] = x;
      this.length++;
    } else {
      const old = this.buf[this.start];
      this.sum -= old;
      this.sumSq -= old * old;
      this.buf[this.start] = x;
      this.start = (this.start + 1) % this.size;
    }
    this.sum += x;
    this.sumSq += x * x;
  }
  get full() {
    return this.length === this.size;
  }
  /** i = 0 is the newest value, 1 the one before, and so on. */
  ago(i) {
    if (i < 0 || i >= this.length) return null;
    return this.buf[(this.start + this.length - 1 - i) % this.size];
  }
  mean() {
    return this.length ? this.sum / this.length : null;
  }
  std() {
    if (this.length < 2) return null;
    const m = this.sum / this.length;
    return Math.sqrt(Math.max(0, this.sumSq / this.length - m * m));
  }
  max() {
    let m = -Infinity;
    for (let i = 0; i < this.length; i++) m = Math.max(m, this.buf[(this.start + i) % this.size]);
    return m;
  }
  min() {
    let m = Infinity;
    for (let i = 0; i < this.length; i++) m = Math.min(m, this.buf[(this.start + i) % this.size]);
    return m;
  }
  values() {
    const out = new Array(this.length);
    for (let i = 0; i < this.length; i++) out[i] = this.buf[(this.start + i) % this.size];
    return out;
  }
}

export class RSI {
  constructor(period = 14) {
    this.up = new RMA(period);
    this.down = new RMA(period);
    this.prev = null;
    this.value = null;
  }
  update(close) {
    if (this.prev != null) {
      const d = close - this.prev;
      const u = this.up.update(Math.max(d, 0));
      const dn = this.down.update(Math.max(-d, 0));
      this.value = dn === 0 ? (u === 0 ? 50 : 100) : 100 - 100 / (1 + u / dn);
    }
    this.prev = close;
    return this.value;
  }
}

export class ATR {
  constructor(period = 14) {
    this.rma = new RMA(period);
    this.prevClose = null;
    this.value = null;
  }
  update(bar) {
    const tr = this.prevClose == null ? bar.h - bar.l : Math.max(bar.h - bar.l, Math.abs(bar.h - this.prevClose), Math.abs(bar.l - this.prevClose));
    this.prevClose = bar.c;
    this.value = this.rma.update(tr);
    return this.value;
  }
}

/** Average Directional Index: how strongly the market is trending (not which way). */
export class ADX {
  constructor(period = 14) {
    this.tr = new RMA(period);
    this.pdm = new RMA(period);
    this.mdm = new RMA(period);
    this.adx = new RMA(period);
    this.prev = null;
    this.value = null;
    this.pdi = null;
    this.mdi = null;
  }
  update(bar) {
    if (this.prev) {
      const up = bar.h - this.prev.h;
      const down = this.prev.l - bar.l;
      const tr = Math.max(bar.h - bar.l, Math.abs(bar.h - this.prev.c), Math.abs(bar.l - this.prev.c));
      const atr = this.tr.update(tr);
      const p = this.pdm.update(up > down && up > 0 ? up : 0);
      const m = this.mdm.update(down > up && down > 0 ? down : 0);
      if (atr > 0) {
        this.pdi = (100 * p) / atr;
        this.mdi = (100 * m) / atr;
        const s = this.pdi + this.mdi;
        this.value = this.adx.update(s > 0 ? (100 * Math.abs(this.pdi - this.mdi)) / s : 0);
      }
    }
    this.prev = bar;
    return this.value;
  }
}

export class MACD {
  constructor(fast = 12, slow = 26, signal = 9) {
    this.f = new EMA(fast);
    this.s = new EMA(slow);
    this.sig = new EMA(signal);
    this.macd = null;
    this.signal = null;
    this.hist = null;
  }
  update(close) {
    this.macd = this.f.update(close) - this.s.update(close);
    this.signal = this.sig.update(this.macd);
    this.hist = this.macd - this.signal;
    return this.hist;
  }
}

/**
 * A local linear trend Kalman filter on log price. It tracks the price "level" and its "slope"
 * (drift per bar) and how sure it is of the slope, which makes a cleaner trend reading than a
 * moving average and adapts as volatility changes.
 */
export class KalmanTrend {
  constructor({ levelNoise = 0.05, slopeNoise = 0.0005 } = {}) {
    this.qL = levelNoise;
    this.qS = slopeNoise;
    this.x = null; // [level, slope]
    this.P = null; // 2x2 covariance
  }
  /** @param y log price, @param r measurement variance (1-bar return variance) */
  update(y, r) {
    if (!(r > 0)) r = 1e-6;
    if (!this.x) {
      this.x = [y, 0];
      this.P = [
        [r, 0],
        [0, r],
      ];
      return { slope: 0, slopeStd: Math.sqrt(r), t: 0 };
    }
    // predict
    const [l, s] = this.x;
    const P = this.P;
    let xl = l + s;
    let xs = s;
    let p00 = P[0][0] + 2 * P[0][1] + P[1][1] + this.qL * r;
    let p01 = P[0][1] + P[1][1];
    let p11 = P[1][1] + this.qS * r;
    // update
    const S = p00 + r;
    const k0 = p00 / S;
    const k1 = p01 / S;
    const innov = y - xl;
    xl += k0 * innov;
    xs += k1 * innov;
    const n00 = (1 - k0) * p00;
    const n01 = (1 - k0) * p01;
    const n11 = p11 - k1 * p01;
    this.x = [xl, xs];
    this.P = [
      [n00, n01],
      [n01, n11],
    ];
    const slopeStd = Math.sqrt(Math.max(n11, 1e-18));
    return { slope: xs, slopeStd, t: xs / slopeStd };
  }
}

/** Groups bars into a longer timeframe (for example 1h bars into 4h bars), aligned to UTC. */
export function resample(bars, fromMs, toMs) {
  if (toMs === fromMs) return bars.slice();
  if (toMs % fromMs) throw new Error(`Can't build ${toMs}ms bars from ${fromMs}ms bars`);
  const out = [];
  let cur = null;
  for (const b of bars) {
    const bucket = Math.floor(b.t / toMs) * toMs;
    if (!cur || cur.t !== bucket) {
      if (cur) out.push(cur);
      cur = { t: bucket, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: 1 };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
      cur.n++;
    }
  }
  if (cur) out.push(cur);
  const need = toMs / fromMs;
  // A bucket is only complete once all its source bars are in; drop an unfinished last one.
  if (out.length && out.at(-1).n < need && out.at(-1).t + toMs > (bars.at(-1)?.t ?? 0) + fromMs) out.pop();
  return out.map(({ n, ...b }) => b);
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const sigmoid = (z) => 1 / (1 + Math.exp(-clamp(z, -30, 30)));
