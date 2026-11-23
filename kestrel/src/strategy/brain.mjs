// Kestrel's brain: seven "experts" each read the market their own way and give a score from -1
// (strongly bearish) to +1 (strongly bullish). A meta-learner (fixed-share Hedge, a standard
// online-learning method) keeps a weight for each expert and shifts it toward the ones whose
// recent calls would have made money, while never letting any expert's weight die out, so the
// ensemble re-adapts when the market changes character. One of the experts is itself a
// self-training model (online logistic regression) that learns which readings have been
// predicting rises lately.
//
// Everything here learns only from bars that have closed, in order. Nothing looks ahead.
import { FeatureEngine } from "./features.mjs";
import { clamp, sigmoid } from "./indicators.mjs";

export const EXPERTS = [
  { id: "trend", name: "Trend", blurb: "Moving averages: is price climbing or sliding over days and weeks?" },
  { id: "momentum", name: "Momentum", blurb: "How far price has moved over 1, 3, 7 and 14 days, adjusted for how jumpy it is." },
  { id: "breakout", name: "Breakout", blurb: "Did price break out of its recent range (the classic Turtle rules)?" },
  { id: "kalman", name: "Trend filter", blurb: "A Kalman filter that separates the real drift from noise." },
  { id: "macd", name: "MACD", blurb: "Whether short-term momentum is speeding up or fading." },
  { id: "reversion", name: "Bounce", blurb: "In choppy markets: buy oversold dips, avoid overbought spikes." },
  { id: "learner", name: "Self-learning model", blurb: "A model that keeps retraining on recent bars to learn what predicts a rise." },
];

export const BRAIN_DEFAULTS = {
  horizon: 12, // bars ahead the learner and the meta-learner judge calls over
  eta: 0.03, // meta-learner learning rate
  share: 0.02, // fixed-share mixing: every expert keeps at least this share of attention
  learnerRate: 0.01,
  learnerL2: 0.01,
  learnerIntercept: false,
  kalman: { levelNoise: 0.01, slopeNoise: 1e-6 }, // a trend over roughly the last 30-50 bars
  macd: [48, 104, 36], // slow MACD: trend acceleration over days, not hours
  prior: {}, // optional head start for some experts, e.g. {trend: 1.5}
  only: null, // optional list of expert ids to use (the rest are switched off)
};

/**
 * Online logistic regression with RMSprop-style steps (so it keeps adapting instead of freezing)
 * and an L2 pull toward zero. There's deliberately no intercept: an intercept just chases the
 * recent ratio of up to down bars, which lags turning points and hurts more than it helps.
 */
export class OnlineLogit {
  constructor(dim, { lr = 0.01, l2 = 0.01, decay = 0.999, intercept = false } = {}) {
    this.dim = dim;
    this.intercept = intercept;
    this.w = new Float64Array(dim + 1);
    this.g2 = new Float64Array(dim + 1).fill(1e-4);
    this.lr = lr;
    this.l2 = l2;
    this.decay = decay;
    this.seen = 0;
  }
  predict(x) {
    let z = this.intercept ? this.w[0] : 0;
    for (let i = 0; i < x.length; i++) z += this.w[i + 1] * x[i];
    return sigmoid(z);
  }
  learn(x, y) {
    const err = y - this.predict(x);
    for (let i = this.intercept ? 0 : 1; i <= x.length; i++) {
      const xi = i === 0 ? 1 : x[i - 1];
      const g = err * xi - (i === 0 ? 0 : this.l2 * this.w[i]);
      this.g2[i] = this.decay * this.g2[i] + (1 - this.decay) * g * g;
      this.w[i] += (this.lr * g) / Math.sqrt(this.g2[i] + 1e-8);
    }
    this.seen++;
  }
}

const N = EXPERTS.length;
const LEARNER = EXPERTS.findIndex((e) => e.id === "learner");

export class Brain {
  constructor({ features = {}, ...params } = {}) {
    this.p = { ...BRAIN_DEFAULTS, ...params };
    this.fe = new FeatureEngine({ kalman: this.p.kalman, macd: this.p.macd, ...features });
    this.active = EXPERTS.map((e) => !this.p.only || this.p.only.includes(e.id));
    this.logw = Float64Array.from(EXPERTS, (e, i) => (this.active[i] ? Math.log(this.p.prior[e.id] ?? 1) : -Infinity));
    this.breakout = 0; // the Turtle state: +1 long, -1 short, 0 out
    this.history = []; // recent {close, scores, x} for judging calls `horizon` bars later
    this.learner = new OnlineLogit(13, { lr: this.p.learnerRate, l2: this.p.learnerL2, intercept: this.p.learnerIntercept });
    this.last = null;
    this.bars = 0;
  }

  weights() {
    const m = Math.max(...this.logw);
    const e = Array.from(this.logw, (v) => (Number.isFinite(v) ? Math.exp(v - m) : 0));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / s);
  }

  /** Feed one closed bar. Returns the brain's view as of that close (null while warming up). */
  update(bar) {
    const f = this.fe.update(bar);
    this.bars++;
    const scores = this.#scores(f);
    const x = this.#learnerInputs(f, scores);
    scores[LEARNER] = this.fe.ready && this.learner.seen > 200 ? clamp((this.learner.predict(x) - 0.5) * 4, -1, 1) : 0;

    // Judge the calls made `horizon` bars ago against what actually happened since.
    const H = this.p.horizon;
    this.history.push({ close: f.close, scores, x });
    if (this.history.length > H) {
      const then = this.history.shift();
      const move = Math.log(f.close / then.close);
      const sigma = Math.max(f.volLong, 1e-6) * Math.sqrt(H);
      const z = clamp(move / sigma, -3, 3);
      if (this.fe.ready) {
        for (let i = 0; i < N; i++) if (this.active[i]) this.logw[i] += this.p.eta * then.scores[i] * z;
        // Fixed share: mix a little uniform weight back in so no expert is ever written off.
        const n = this.active.filter(Boolean).length;
        const w = this.weights().map((v, i) => (this.active[i] ? (1 - this.p.share) * v + this.p.share / n : 0));
        for (let i = 0; i < N; i++) this.logw[i] = this.active[i] ? Math.log(w[i]) : -Infinity;
      }
      this.learner.learn(then.x, move > 0 ? 1 : 0);
    }

    const w = this.weights();
    let score = 0;
    for (let i = 0; i < N; i++) score += w[i] * scores[i];
    let agreeNum = 0;
    let agreeDen = 0;
    for (let i = 0; i < N; i++) {
      agreeDen += w[i] * Math.abs(scores[i]);
      if (Math.sign(scores[i]) === Math.sign(score)) agreeNum += w[i] * Math.abs(scores[i]);
    }
    this.last = {
      t: f.t,
      ready: this.fe.ready,
      score,
      agreement: agreeDen > 0 ? agreeNum / agreeDen : 0,
      scores: Object.fromEntries(EXPERTS.map((e, i) => [e.id, scores[i]])),
      weights: Object.fromEntries(EXPERTS.map((e, i) => [e.id, w[i]])),
      regime: regimeOf(f),
      f,
    };
    return this.last;
  }

  #scores(f) {
    const atr = Math.max(f.atr, 1e-12);
    const s = new Array(N).fill(0);
    // Trend: short vs medium average, and price vs the long average, in units of ATR.
    s[0] = 0.6 * Math.tanh((f.emaFast - f.emaSlow) / (2 * atr)) + 0.4 * Math.tanh((f.close - f.emaLong) / (4 * atr));
    // Momentum over several horizons, each as a t-statistic of the move.
    const sig = Math.max(f.volLong, 1e-6);
    const hs = Object.keys(f.mom);
    s[1] = hs.reduce((a, h) => a + Math.tanh(f.mom[h] / (sig * Math.sqrt(Number(h))) / 1.5), 0) / hs.length;
    // Breakout (Turtle): in on a 55-bar high, out on a 20-bar low, and the mirror image.
    if (f.close > f.donHi) this.breakout = 1;
    else if (f.close < f.donLoEntry) this.breakout = -1;
    else if (this.breakout === 1 && f.close < f.donLo) this.breakout = 0;
    else if (this.breakout === -1 && f.close > f.donHiExit) this.breakout = 0;
    s[2] = this.breakout * (0.5 + 0.5 * clamp(f.adx / 40, 0, 1));
    // Kalman trend filter.
    s[3] = Math.tanh(f.kalmanT / 3);
    // MACD histogram in units of ATR.
    s[4] = Math.tanh(f.macdHist / (0.3 * atr));
    // Mean reversion, only when the market is range-bound (low ADX).
    const gate = clamp((25 - f.adx) / 10, 0, 1);
    s[5] = gate * (-0.5 * Math.tanh(f.bbZ / 1.5) + 0.5 * clamp((50 - f.rsi) / 30, -1, 1));
    return s;
  }

  #learnerInputs(f, s) {
    const sig = Math.max(f.volLong, 1e-6);
    const x = [s[0], s[1], s[2], s[3], s[4], s[5], (f.rsi - 50) / 20, f.bbZ / 2, f.volRatio - 1, f.adx / 25 - 1, f.volumeZ / 3, f.ret / sig, (f.mom[24] ?? 0) / (sig * Math.sqrt(24))];
    return x.map((v) => clamp(Number.isFinite(v) ? v : 0, -3, 3));
  }
}

export function regimeOf(f) {
  const volatile = f.volRatio > 1.6;
  const trending = f.adx >= 25;
  const up = f.emaFast > f.emaSlow;
  const label = volatile ? "Volatile" : trending ? (up ? "Trending up" : "Trending down") : f.adx < 18 ? "Choppy" : up ? "Drifting up" : "Drifting down";
  return { label, volatile, trending, adx: f.adx, volRatio: f.volRatio };
}

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;

/** Plain-English reasons for the brain's view, most important first. */
export function explain(view, { symbolName = "it", money = (x) => `$${x.toFixed(2)}`, horizon = BRAIN_DEFAULTS.horizon } = {}) {
  if (!view?.ready) return { summary: "Still warming up: reading the recent price history.", reasons: [] };
  const f = view.f;
  const items = EXPERTS.map((e) => ({ id: e.id, name: e.name, s: view.scores[e.id], w: view.weights[e.id] }))
    .map((x) => ({ ...x, impact: x.s * x.w }))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const say = {
    trend: (s) => (s > 0.25 ? `Uptrend: the 20-bar average (${money(f.emaFast)}) is above the 100-bar average (${money(f.emaSlow)})` : s < -0.25 ? `Downtrend: the 20-bar average (${money(f.emaFast)}) is below the 100-bar average (${money(f.emaSlow)})` : "No clear trend in the moving averages"),
    momentum: () => {
      const d3 = f.mom[72] ?? 0;
      const d7 = f.mom[168] ?? 0;
      return `Momentum: ${d3 >= 0 ? "up" : "down"} ${pct(Math.abs(Math.expm1(d3)))} over 72 bars, ${d7 >= 0 ? "up" : "down"} ${pct(Math.abs(Math.expm1(d7)))} over 168 bars`;
    },
    breakout: (s) => (s > 0 ? `Breakout: ${symbolName} broke above its 55-bar high` : s < 0 ? `Breakdown: ${symbolName} fell below its 55-bar low` : "Inside its recent range (no breakout)"),
    kalman: (s) => (s > 0.3 ? "The trend filter sees a steady climb beneath the noise" : s < -0.3 ? "The trend filter sees a steady slide beneath the noise" : "The trend filter sees mostly noise"),
    macd: (s) => (s > 0.3 ? "Short-term momentum is speeding up" : s < -0.3 ? "Short-term momentum is fading" : "Short-term momentum is flat"),
    reversion: (s) => (s > 0.15 ? `Oversold in a choppy market (RSI ${f.rsi.toFixed(0)}), so a bounce is likely` : s < -0.15 ? `Overbought in a choppy market (RSI ${f.rsi.toFixed(0)}), so a pullback is likely` : "Not stretched either way"),
    learner: (s) => (Math.abs(s) < 0.05 ? "The self-learning model sees no edge right now" : `The self-learning model puts the chance of a rise over the next ${horizon} bars at ${pct(0.5 + s / 4, 0)}`),
  };
  const reasons = items.filter((x) => Math.abs(x.s) > 0.05).slice(0, 4).map((x) => ({ expert: x.name, score: round(x.s), weight: round(x.w), text: say[x.id](x.s) }));
  const r = view.regime;
  if (r.volatile) reasons.push({ expert: "Risk", score: 0, weight: 0, text: `Volatility is high (${r.volRatio.toFixed(1)}× usual), so positions are kept smaller` });
  const s = view.score;
  const stance = s > 0.35 ? "Strongly bullish" : s > 0.12 ? "Bullish" : s > 0.02 ? "Slightly bullish" : s < -0.35 ? "Strongly bearish" : s < -0.12 ? "Bearish" : s < -0.02 ? "Slightly bearish" : "Neutral";
  return {
    stance,
    score: round(s),
    agreement: round(view.agreement),
    regime: r.label,
    summary: `${stance} (score ${s >= 0 ? "+" : ""}${s.toFixed(2)}, ${pct(view.agreement, 0)} of the weighted experts agree). Market: ${r.label.toLowerCase()}.`,
    reasons,
  };
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
