#!/usr/bin/env node
// Backtest from the command line on real history (no app needed):
//   npm run backtest -- BTC/USD ETH/USD SOL/USD --days 730 --risk balanced --venue kraken
// Prices come from public exchange data (Coinbase/Alpaca fill in where Kraken's history stops),
// and the fees are the chosen venue's. Results are the same as the Test page in the app.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.mjs";
import { MarketData } from "../src/data/feed.mjs";
import { backtest } from "../src/backtest.mjs";
import { venueInfo } from "../src/brokers/catalog.mjs";
import { normalizeSymbol, timeframeMs, assetClassOf, marketName } from "../src/markets.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const symbols = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--"))).map(normalizeSymbol).filter(Boolean);
if (!symbols.length) symbols.push("BTC/USD", "ETH/USD", "SOL/USD");
const days = Number(opt("days", 730));
const risk = opt("risk", "balanced");
const venue = opt("venue", "kraken");
const ac = assetClassOf(symbols[0]);
const tf = timeframeMs(opt("tf", ac === "stock" ? "1d" : "4h"));

const store = new Store(path.join(HERE, "..", ".data"));
const data = new MarketData({ store });
const bars = {};
for (const s of symbols) {
  process.stdout.write(`Downloading ${marketName(s)}… `);
  const h = await data.history(venue, s, tf, days + Math.ceil((380 * tf) / 86_400_000));
  if (!h?.bars?.length) {
    console.log(`no history (${h?.error ?? "unavailable"})`);
    process.exit(1);
  }
  bars[s] = h.bars;
  console.log(`${h.bars.length} bars from ${h.source}`);
}
const fees = venueInfo(venue).fees;
const r = backtest({ data: bars, timeframeMs: tf, assetClass: ac, risk, costs: { maker: fees.maker, taker: fees.taker, slippage: 0.0005 } });
const pct = (x) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
console.log(`\n${symbols.map(marketName).join(" + ")} · ${risk} · ${new Date(r.from).toISOString().slice(0, 10)} → ${new Date(r.to).toISOString().slice(0, 10)} · fees ${venueInfo(venue).name} ${(fees.maker * 100).toFixed(2)}% / ${(fees.taker * 100).toFixed(2)}%`);
console.log(`Kestrel        ${pct(r.metrics.totalReturn).padStart(8)}   worst dip ${pct(r.metrics.maxDrawdown)}   Sharpe ${r.metrics.sharpe.toFixed(2)}   ${r.metrics.trades} trades, ${(r.metrics.winRate * 100).toFixed(0)}% winners, fees $${r.metrics.fees.toFixed(0)}`);
console.log(`Buy and hold   ${pct(r.benchmark.totalReturn).padStart(8)}   worst dip ${pct(r.benchmark.maxDrawdown)}`);
if (r.montecarlo) console.log(`One-year range (Monte Carlo): ${pct(r.montecarlo.returnP5)} to ${pct(r.montecarlo.returnP95)}, typical ${pct(r.montecarlo.returnP50)}, chance of a losing year ${(r.montecarlo.chanceOfLoss * 100).toFixed(0)}%`);
