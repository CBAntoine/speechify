// Charts, drawn with TradingView's open-source Lightweight Charts (served from node_modules).
const L = () => window.LightweightCharts;

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const base = (el, extra = {}) => ({
  autoSize: true,
  layout: { background: { type: "solid", color: "transparent" }, textColor: css("--muted") || "#98a1b3", fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif", fontSize: 12, attributionLogo: false },
  grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
  rightPriceScale: { borderVisible: false },
  timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
  crosshair: { mode: 1 },
  ...extra,
});

const sec = (ms) => Math.floor(ms / 1000);

function ema(values, period) {
  const a = 2 / (period + 1);
  let e = null;
  return values.map((v) => (e = e == null ? v : e + a * (v - e)));
}

export function priceFormat(price) {
  if (!(price > 0)) return { type: "price", precision: 2, minMove: 0.01 };
  const precision = price >= 1000 ? 2 : price >= 1 ? 3 : price >= 0.01 ? 5 : 8;
  return { type: "price", precision, minMove: 1 / 10 ** precision };
}

export class PriceChart {
  constructor(el) {
    this.el = el;
    this.chart = L().createChart(el, base(el));
    this.candles = this.chart.addSeries(L().CandlestickSeries, { upColor: "#2fd18b", downColor: "#ff5d6c", wickUpColor: "#2fd18b", wickDownColor: "#ff5d6c", borderVisible: false });
    this.fast = this.chart.addSeries(L().LineSeries, { color: "rgba(106,167,255,0.9)", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    this.slow = this.chart.addSeries(L().LineSeries, { color: "rgba(167,139,250,0.9)", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    this.markers = L().createSeriesMarkers(this.candles, []);
    this.lines = [];
    this.key = null;
  }

  set(data) {
    const bars = data.bars || [];
    const key = `${data.symbol}:${bars[0]?.t}`;
    const fmt = priceFormat(bars.at(-1)?.c);
    this.candles.applyOptions({ priceFormat: fmt });
    this.candles.setData(bars.map((b) => ({ time: sec(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    const closes = bars.map((b) => b.c);
    const f = ema(closes, 20);
    const s = ema(closes, 100);
    this.fast.setData(bars.map((b, i) => ({ time: sec(b.t), value: f[i] })).slice(5));
    this.slow.setData(bars.map((b, i) => ({ time: sec(b.t), value: s[i] })).slice(20));
    // Buy and sell markers, snapped to the bar each fill happened in.
    const times = bars.map((b) => b.t);
    const snap = (t) => {
      let lo = 0;
      let hi = times.length - 1;
      if (!times.length || t < times[0]) return null;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid] <= t) lo = mid;
        else hi = mid - 1;
      }
      return times[lo];
    };
    const marks = [];
    for (const f2 of data.fills || []) {
      const t = snap(f2.mt ?? f2.t);
      if (t == null) continue;
      const buy = f2.side === "buy";
      marks.push({ time: sec(t), position: buy ? "belowBar" : "aboveBar", color: buy ? "#2fd18b" : f2.reason === "stop" || f2.reason === "breaker" ? "#ffbf47" : "#ff5d6c", shape: buy ? "arrowUp" : "arrowDown", text: buy ? "Buy" : f2.reason === "stop" ? "Stop" : "Sell" });
    }
    marks.sort((a, b) => a.time - b.time);
    this.markers.setMarkers(marks);
    for (const l of this.lines) this.candles.removePriceLine(l);
    this.lines = [];
    if (data.stop) this.lines.push(this.candles.createPriceLine({ price: data.stop, color: "#ffbf47", lineWidth: 1, lineStyle: L().LineStyle.Dashed, axisLabelVisible: true, title: "Stop" }));
    if (data.entry) this.lines.push(this.candles.createPriceLine({ price: data.entry, color: "rgba(238,241,247,0.45)", lineWidth: 1, lineStyle: L().LineStyle.Dotted, axisLabelVisible: true, title: "Bought" }));
    if (key !== this.key) {
      this.key = key;
      this.chart.timeScale().fitContent();
    }
  }
}

export class EquityChart {
  constructor(el, { height } = {}) {
    this.chart = L().createChart(el, base(el, { rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.05 } }, timeScale: { borderVisible: false, timeVisible: true }, handleScroll: false, handleScale: false }));
    this.area = this.chart.addSeries(L().AreaSeries, {
      lineColor: "#ff8a3d",
      topColor: "rgba(255,138,61,0.28)",
      bottomColor: "rgba(255,138,61,0.0)",
      lineWidth: 2,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      // Show at least a 2% band, so a quiet day doesn't look like a cliff.
      autoscaleInfoProvider: (original) => {
        const r = original();
        if (!r?.priceRange) return r;
        const { minValue, maxValue } = r.priceRange;
        const mid = (minValue + maxValue) / 2;
        const span = Math.max(maxValue - minValue, Math.abs(mid) * 0.02);
        return { ...r, priceRange: { minValue: mid - span / 2, maxValue: mid + span / 2 } };
      },
    });
    this.n = 0;
  }
  set(points) {
    const seen = new Set();
    const data = [];
    for (const p of points) {
      const t = sec(p.t);
      if (seen.has(t)) data.pop();
      seen.add(t);
      data.push({ time: t, value: p.v });
    }
    this.area.setData(data);
    if (data.length !== this.n) {
      this.n = data.length;
      this.chart.timeScale().fitContent();
    }
  }
}

export function compareChart(el, mine, bench) {
  const chart = L().createChart(el, base(el));
  const a = chart.addSeries(L().AreaSeries, { lineColor: "#ff8a3d", topColor: "rgba(255,138,61,0.25)", bottomColor: "rgba(255,138,61,0)", lineWidth: 2, title: "Kestrel" });
  const b = chart.addSeries(L().LineSeries, { color: "rgba(152,161,179,0.85)", lineWidth: 1.5, lineStyle: L().LineStyle.Dashed, title: "Buy & hold" });
  const dedupe = (pts) => {
    const out = [];
    let last = -1;
    for (const p of pts) {
      const t = sec(p.t);
      if (t <= last) continue;
      last = t;
      out.push({ time: t, value: p.equity });
    }
    return out;
  };
  a.setData(dedupe(mine));
  b.setData(dedupe(bench));
  chart.timeScale().fitContent();
  return chart;
}
