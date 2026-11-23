// Risk management: how much to hold, when to get out, and when to stop trading altogether.
// Three presets keep it simple. Every number is a limit the bot can't cross on its own.
import { clamp } from "./strategy/indicators.mjs";

export const RISK_LEVELS = {
  careful: {
    id: "careful",
    label: "Careful",
    blurb: "Small positions, quick to step aside. Aims for steady, small gains.",
    targetVol: 0.15, // annual volatility the whole bot aims for
    maxWeight: 0.25, // most of the bot's money in any one market
    maxTotal: 0.5, // most of the bot's money invested at once (the rest stays in cash)
    stopAtr: 4, // trailing stop distance, in ATRs
    dailyLoss: 0.03, // stop buying for the day after losing this much today
    maxDrawdown: 0.12, // sell everything and pause after falling this far from the peak
    enter: 0.15, // brain score needed to buy
    exit: 0.0, // brain score below which it sells
    full: 0.5, // brain score for a full-size position
    floor: 0.5, // once a trend is confirmed, commit at least this much of the risk budget
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    blurb: "The default. Takes clear trends, cuts losers, keeps cash in reserve.",
    targetVol: 0.3,
    maxWeight: 0.4,
    maxTotal: 0.8,
    stopAtr: 5,
    dailyLoss: 0.05,
    maxDrawdown: 0.2,
    enter: 0.12,
    exit: 0.0,
    full: 0.45,
    floor: 0.5,
  },
  bold: {
    id: "bold",
    label: "Bold",
    blurb: "Bigger positions for bigger swings. Expect deeper dips along the way.",
    targetVol: 0.5,
    maxWeight: 0.7,
    maxTotal: 1.0,
    stopAtr: 6,
    dailyLoss: 0.08,
    maxDrawdown: 0.35,
    enter: 0.1,
    exit: -0.02,
    full: 0.4,
    floor: 0.5,
  },
};

export const RISK_ORDER = ["careful", "balanced", "bold"];

export function riskPreset(id, overrides = {}) {
  const base = RISK_LEVELS[id] || RISK_LEVELS.balanced;
  return { ...base, ...overrides };
}

/**
 * The weight (share of the bot's money) one market should have, from the brain's view.
 * Hysteresis: it takes a stronger signal to buy than to keep holding, which avoids churning.
 */
export function desiredWeight(view, preset, { held = false, cooldown = 0, barsPerYear = 8760, drawdown = 0 } = {}) {
  if (!view?.ready) return { weight: 0, why: "warming up" };
  const s = view.score;
  if (!held) {
    if (s < preset.enter) return { weight: 0, why: `score ${s.toFixed(2)} below the ${preset.enter} needed to buy` };
    if (cooldown > 0 && s < preset.full) return { weight: 0, why: `cooling off after a stop (${cooldown} bars left)` };
  } else if (s < preset.exit) return { weight: 0, why: `score ${s.toFixed(2)} fell below ${preset.exit}` };

  const f = view.f;
  const annVol = Math.max(f.volShort, f.volLong) * Math.sqrt(barsPerYear);
  const volScalar = annVol > 0 ? Math.min(1, preset.targetVol / annVol) : 0;
  // Once a trend is confirmed, commit at least `floor` of the risk budget; a stronger signal
  // commits more, up to all of it.
  const strength = clamp(s / preset.full, 0, 1);
  const floor = preset.floor ?? 0.5;
  let w = volScalar * (floor + (1 - floor) * strength);
  const notes = [];
  if (view.regime.volatile) {
    w *= 0.6;
    notes.push("volatility high");
  }
  // The major-trend filter: below the long-term average the market is in a downtrend, so no new
  // buys (the classic "only trade with the big trend" rule); a position already held is halved.
  if (f.close < f.emaLong) {
    if (!held && preset.trendFilter !== "half") return { weight: 0, why: `below its long-term average (${f.emaLong.toFixed(2)}): waiting for the bigger trend to turn up` };
    w *= 0.5;
    notes.push("below the long-term average");
  }
  // Draw down and the bot gets more careful: half way to the pause limit means 75% size.
  const dd = clamp(drawdown / preset.maxDrawdown, 0, 1);
  if (dd > 0.25) {
    w *= 1 - dd * 0.5;
    notes.push(`drawdown ${(drawdown * 100).toFixed(1)}%`);
  }
  w = Math.min(w, preset.maxWeight);
  return { weight: w, why: `score ${s.toFixed(2)}, volatility ${(annVol * 100).toFixed(0)}%/yr${notes.length ? `, ${notes.join(", ")}` : ""}` };
}

/** Sample covariance of aligned return series (each the same length). */
export function covariance(series) {
  const n = Math.min(...series.map((s) => s.length));
  const k = series.length;
  const xs = series.map((s) => s.slice(-n));
  const means = xs.map((s) => s.reduce((a, b) => a + b, 0) / n);
  const cov = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++)
    for (let j = i; j < k; j++) {
      let acc = 0;
      for (let t = 0; t < n; t++) acc += (xs[i][t] - means[i]) * (xs[j][t] - means[j]);
      cov[i][j] = cov[j][i] = n > 1 ? acc / (n - 1) : 0;
    }
  return cov;
}

/**
 * Scale a set of weights so the whole portfolio respects the preset: no more than maxTotal
 * invested, and (because coins tend to move together) no more than the target volatility once
 * their correlation is counted. `returns` are aligned per-period returns (daily in practice).
 */
export function portfolioScale(weights, returns, preset, periodsPerYear = 365, { minDays = 20 } = {}) {
  const keys = Object.keys(weights).filter((k) => weights[k] > 0);
  const out = { ...weights };
  if (!keys.length) return { weights: out, scale: 1, vol: 0 };
  let scale = 1;
  const total = keys.reduce((a, k) => a + weights[k], 0);
  if (total > preset.maxTotal) scale = preset.maxTotal / total;
  let vol = 0;
  const series = keys.map((k) => returns[k] || []);
  if (series.every((s) => s.length >= minDays)) {
    const cov = covariance(series);
    let v = 0;
    for (let i = 0; i < keys.length; i++) for (let j = 0; j < keys.length; j++) v += weights[keys[i]] * scale * weights[keys[j]] * scale * cov[i][j];
    vol = Math.sqrt(Math.max(v, 0) * periodsPerYear);
    if (vol > preset.targetVol) {
      scale *= preset.targetVol / vol;
      vol = preset.targetVol;
    }
  }
  for (const k of keys) out[k] = weights[k] * scale;
  return { weights: out, scale, vol };
}

/** A new position's protective stop. */
export function initialStop(price, atr, preset) {
  return price - preset.stopAtr * atr;
}

/** Chandelier trailing stop: it only ever moves up, following the highest close since entry. */
export function trailStop(stop, highestClose, atr, preset) {
  return Math.max(stop ?? -Infinity, highestClose - preset.stopAtr * atr);
}

/** Bars per year for a timeframe, for annualising volatility. Stocks trade about 6.5h a day. */
export function barsPerYear(timeframeMs, assetClass = "crypto") {
  const perDay = 86_400_000 / timeframeMs;
  if (assetClass === "stock") return timeframeMs >= 86_400_000 ? 252 : 252 * Math.max(1, Math.round((6.5 * 3_600_000) / timeframeMs));
  return 365 * perDay;
}
