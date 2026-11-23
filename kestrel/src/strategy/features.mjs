// The feature engine turns each closed bar into the readings the experts look at: trend,
// momentum over several horizons, breakouts, overbought/oversold, volatility and its regime.
import { EMA, RSI, ATR, ADX, MACD, Window, KalmanTrend } from "./indicators.mjs";

export const FEATURE_DEFAULTS = {
  emaFast: 20,
  emaSlow: 100,
  emaLong: 300,
  rsi: 14,
  atr: 14,
  adx: 14,
  bb: 20,
  donchianEntry: 55,
  donchianExit: 20,
  volShort: 24,
  volLong: 168,
  momentum: [24, 72, 168, 336],
  kalman: { levelNoise: 0.01, slopeNoise: 1e-6 },
  macd: [48, 104, 36],
  warmup: 350,
};

export class FeatureEngine {
  constructor(params = {}) {
    this.p = { ...FEATURE_DEFAULTS, ...params };
    const p = this.p;
    this.count = 0;
    this.prev = null;
    this.emaF = new EMA(p.emaFast);
    this.emaS = new EMA(p.emaSlow);
    this.emaL = new EMA(p.emaLong);
    this.rsi = new RSI(p.rsi);
    this.atr = new ATR(p.atr);
    this.adx = new ADX(p.adx);
    this.macd = new MACD(...p.macd);
    this.closes = new Window(Math.max(...p.momentum) + 2);
    this.bbWin = new Window(p.bb);
    this.highs = new Window(p.donchianEntry);
    this.lows = new Window(p.donchianExit);
    this.lowsEntry = new Window(p.donchianEntry);
    this.highsExit = new Window(p.donchianExit);
    this.retShort = new Window(p.volShort);
    this.retLong = new Window(p.volLong);
    this.volume = new Window(20);
    this.volNorm = new EMA(500); // the "usual" level of short-term volatility
    this.kalman = new KalmanTrend(p.kalman);
    this.last = null;
  }

  get ready() {
    return this.count >= this.p.warmup;
  }

  /** Feed one closed bar {t,o,h,l,c,v}. Returns the readings as of that bar's close. */
  update(bar) {
    const p = this.p;
    const prevClose = this.prev?.c ?? bar.c;
    const ret = Math.log(bar.c / prevClose) || 0;

    // Donchian channels use the bars *before* this one, so a breakout means beating them.
    const donHi = this.highs.length ? this.highs.max() : bar.h;
    const donLo = this.lows.length ? this.lows.min() : bar.l;
    const donLoEntry = this.lowsEntry.length ? this.lowsEntry.min() : bar.l;
    const donHiExit = this.highsExit.length ? this.highsExit.max() : bar.h;

    const emaFast = this.emaF.update(bar.c);
    const emaSlow = this.emaS.update(bar.c);
    const emaLong = this.emaL.update(bar.c);
    const rsi = this.rsi.update(bar.c);
    const atr = this.atr.update(bar);
    const adx = this.adx.update(bar);
    this.macd.update(bar.c);

    this.closes.push(bar.c);
    this.bbWin.push(bar.c);
    if (this.prev) {
      this.retShort.push(ret);
      this.retLong.push(ret);
    }
    this.volume.push(bar.v || 0);

    const volShort = this.retShort.std() ?? 0;
    const volLong = this.retLong.std() ?? volShort;
    const volUsual = this.volNorm.update(volShort || volLong || 0);
    const k = this.kalman.update(Math.log(bar.c), Math.max(volShort * volShort, 1e-10));

    const bbMid = this.bbWin.mean();
    const bbStd = this.bbWin.std() || 0;
    const mom = {};
    for (const h of p.momentum) {
      const old = this.closes.ago(h);
      mom[h] = old ? Math.log(bar.c / old) : 0;
    }
    const vMean = this.volume.mean() || 0;
    const vStd = this.volume.std() || 0;

    this.highs.push(bar.h);
    this.lows.push(bar.l);
    this.lowsEntry.push(bar.l);
    this.highsExit.push(bar.h);
    this.prev = bar;
    this.count++;

    this.last = {
      t: bar.t,
      close: bar.c,
      high: bar.h,
      low: bar.l,
      ret,
      emaFast,
      emaSlow,
      emaLong,
      rsi: rsi ?? 50,
      atr,
      atrPct: atr / bar.c,
      adx: adx ?? 0,
      pdi: this.adx.pdi ?? 0,
      mdi: this.adx.mdi ?? 0,
      macd: this.macd.macd,
      macdSignal: this.macd.signal,
      macdHist: this.macd.hist,
      bbMid,
      bbStd,
      bbZ: bbStd > 0 ? (bar.c - bbMid) / bbStd : 0,
      donHi,
      donLo,
      donLoEntry,
      donHiExit,
      volShort,
      volLong,
      volRatio: volUsual > 0 ? volShort / volUsual : 1,
      mom,
      kalmanT: k.t,
      kalmanSlope: k.slope,
      volumeZ: vStd > 0 ? (bar.v - vMean) / vStd : 0,
      ready: this.ready,
    };
    return this.last;
  }
}
