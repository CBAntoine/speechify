// Friendly names for markets, so "bitcoin", "BTC" and "BTC/USD" all mean the same thing, plus the
// quick picks the setup screen offers. Any pair or ticker an exchange lists works too.

export const CRYPTO = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  XRP: "XRP",
  DOGE: "Dogecoin",
  ADA: "Cardano",
  AVAX: "Avalanche",
  LINK: "Chainlink",
  LTC: "Litecoin",
  DOT: "Polkadot",
  BCH: "Bitcoin Cash",
  SHIB: "Shiba Inu",
  UNI: "Uniswap",
  AAVE: "Aave",
  XLM: "Stellar",
  ATOM: "Cosmos",
  NEAR: "Near",
  SUI: "Sui",
  TRX: "Tron",
  PEPE: "Pepe",
};

export const STOCKS = {
  SPY: "S&P 500 ETF",
  QQQ: "Nasdaq 100 ETF",
  DIA: "Dow Jones ETF",
  IWM: "Russell 2000 ETF",
  AAPL: "Apple",
  MSFT: "Microsoft",
  NVDA: "Nvidia",
  AMZN: "Amazon",
  GOOGL: "Alphabet (Google)",
  META: "Meta",
  TSLA: "Tesla",
  AMD: "AMD",
  NFLX: "Netflix",
  AVGO: "Broadcom",
  JPM: "JPMorgan",
  COST: "Costco",
  GLD: "Gold ETF",
  TLT: "20+ Year Treasury ETF",
};

export const QUICK_PICKS = [
  { symbol: "BTC/USD", assetClass: "crypto" },
  { symbol: "ETH/USD", assetClass: "crypto" },
  { symbol: "SOL/USD", assetClass: "crypto" },
  { symbol: "XRP/USD", assetClass: "crypto" },
  { symbol: "DOGE/USD", assetClass: "crypto" },
  { symbol: "SPY", assetClass: "stock" },
  { symbol: "QQQ", assetClass: "stock" },
  { symbol: "AAPL", assetClass: "stock" },
  { symbol: "NVDA", assetClass: "stock" },
  { symbol: "TSLA", assetClass: "stock" },
];

const byName = new Map();
for (const [k, v] of Object.entries(CRYPTO)) {
  byName.set(k.toLowerCase(), `${k}/USD`);
  byName.set(v.toLowerCase(), `${k}/USD`);
}
for (const [k, v] of Object.entries(STOCKS)) {
  byName.set(k.toLowerCase(), k);
  byName.set(v.toLowerCase(), k);
  byName.set(v.toLowerCase().replace(/ etf$/, ""), k);
}
for (const [alias, sym] of Object.entries({ "s&p 500": "SPY", "s and p 500": "SPY", "s&p": "SPY", sp500: "SPY", nasdaq: "QQQ", google: "GOOGL", facebook: "META", ether: "ETH/USD", btc: "BTC/USD", "bit coin": "BTC/USD", doge: "DOGE/USD", gold: "GLD" })) byName.set(alias, sym);

/** Turn whatever the person said or typed into a market symbol ("bitcoin" → "BTC/USD"). */
export function normalizeSymbol(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  const low = raw.toLowerCase().replace(/\s+/g, " ");
  if (byName.has(low)) return byName.get(low);
  const pair = raw.toUpperCase().replace(/[\s_-]+/g, "/");
  if (/^[A-Z0-9]{2,10}\/[A-Z]{3,5}$/.test(pair)) return pair;
  const up = raw.toUpperCase();
  // "BTCUSD", "ETHUSDT": a known coin glued to a quote currency.
  const glued = up.match(/^([A-Z0-9]{2,6}?)(USD|USDT|USDC|EUR|CAD|GBP)$/);
  if (glued && CRYPTO[glued[1]]) return `${glued[1]}/${glued[2]}`;
  if (/^[A-Z][A-Z0-9.]{0,6}$/.test(up)) return CRYPTO[up] ? `${up}/USD` : up;
  return null;
}

export function assetClassOf(symbol) {
  return String(symbol).includes("/") ? "crypto" : "stock";
}

export function marketName(symbol) {
  const s = String(symbol || "");
  if (s.includes("/")) {
    const [base, quote] = s.split("/");
    return CRYPTO[base] ? (quote === "USD" ? CRYPTO[base] : `${CRYPTO[base]} (${quote})`) : s;
  }
  return STOCKS[s] || s;
}

export const TIMEFRAMES = {
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export const timeframeMs = (tf) => TIMEFRAMES[tf] || TIMEFRAMES["4h"];
export const timeframeLabel = (tf) => ({ "1h": "hourly", "4h": "4-hour", "1d": "daily" })[tf] || tf;
