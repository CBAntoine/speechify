// The places Kestrel can trade. Crypto exchanges go through CCXT (the standard open-source
// library behind most crypto bots, 100+ exchanges); stocks go through Alpaca.
//
// Fees are each venue's published base tier. Once you connect, Kestrel asks the exchange for
// your actual fees (your tier may be lower).

export const VENUES = {
  alpaca: {
    id: "alpaca",
    name: "Alpaca",
    kind: "alpaca",
    assets: ["stock", "crypto"],
    practiceAccount: true,
    fees: { maker: 0.0015, taker: 0.0025 },
    stockFees: { maker: 0, taker: 0 },
    fields: [
      { id: "apiKey", label: "API key ID" },
      { id: "secret", label: "Secret key", secret: true },
    ],
    keysUrl: "https://app.alpaca.markets/",
    steps: ["Sign up free at alpaca.markets (a paper account is instant).", "In the dashboard, open API Keys (right side of the Home page) and choose Generate New Keys.", "Copy the key ID and secret here. Paper keys and live keys are different: pick the matching account below."],
    blurb: "US stocks and ETFs with no commission, plus crypto. Free paper (practice) account, and a live account for real money.",
    recommended: true,
  },
  kraken: {
    id: "kraken",
    name: "Kraken",
    kind: "ccxt",
    assets: ["crypto"],
    fees: { maker: 0.0025, taker: 0.004 },
    fields: [
      { id: "apiKey", label: "API key" },
      { id: "secret", label: "Private key", secret: true },
    ],
    keysUrl: "https://pro.kraken.com/app/settings/api",
    steps: ["Log in at pro.kraken.com, then Settings → API → Create API key.", "Tick Query Funds, Query Open Orders & Trades, Create & Modify Orders and Cancel/Close Orders. Leave Withdraw Funds off.", "Copy the API key and private key here."],
    blurb: "Low fees on Kraken Pro and wide availability (Canada, most US states, UK, Europe). Kestrel's default source of practice prices.",
    recommended: true,
  },
  coinbase: {
    id: "coinbase",
    name: "Coinbase",
    kind: "ccxt",
    assets: ["crypto"],
    fees: { maker: 0.006, taker: 0.012 },
    fields: [
      { id: "apiKey", label: "API key name (organizations/…/apiKeys/…)" },
      { id: "secret", label: "Private key (-----BEGIN EC PRIVATE KEY-----…)", secret: true, multiline: true },
    ],
    keysUrl: "https://portal.cdp.coinbase.com/access/api",
    steps: ["Open the Coinbase Developer Platform (portal.cdp.coinbase.com) → API keys → Create API key.", "Give it View and Trade permissions only (no Transfer), and choose the ECDSA signature algorithm.", "Paste the key name and the whole private key here."],
    blurb: "Popular and easy, but base-tier fees are high (0.6% to 1.2% a trade), which can eat most of the bot's edge until your volume tier drops them.",
    feeWarning: true,
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    kind: "ccxt",
    assets: ["crypto"],
    sandbox: true,
    fees: { maker: 0.002, taker: 0.004 },
    fields: [
      { id: "apiKey", label: "API key" },
      { id: "secret", label: "API secret", secret: true },
    ],
    keysUrl: "https://exchange.gemini.com/settings/api",
    steps: ["Gemini → Settings → API → Create a new API key with the Trading role (not Fund Management).", "Copy the key and secret here."],
    blurb: "Regulated US exchange (ActiveTrader fees). Has a sandbox for testing.",
  },
  binanceus: {
    id: "binanceus",
    name: "Binance.US",
    kind: "ccxt",
    assets: ["crypto"],
    fees: { maker: 0.001, taker: 0.001 },
    fields: [
      { id: "apiKey", label: "API key" },
      { id: "secret", label: "Secret key", secret: true },
    ],
    keysUrl: "https://www.binance.us/settings/api-management",
    steps: ["Binance.US → Profile → API Management → Create API.", "Enable Spot Trading only; leave withdrawals off.", "Copy the API key and secret here."],
    blurb: "Very low fees, for US residents.",
  },
  binance: {
    id: "binance",
    name: "Binance",
    kind: "ccxt",
    assets: ["crypto"],
    sandbox: true,
    fees: { maker: 0.001, taker: 0.001 },
    fields: [
      { id: "apiKey", label: "API key" },
      { id: "secret", label: "Secret key", secret: true },
    ],
    keysUrl: "https://www.binance.com/en/my/settings/api-management",
    steps: ["Binance → Account → API Management → Create API (System generated).", "Enable Spot & Margin Trading only; leave withdrawals off.", "Copy the API key and secret here."],
    blurb: "The largest exchange, very low fees. Not available to residents of some countries (including the US and Canada).",
  },
  bitstamp: {
    id: "bitstamp",
    name: "Bitstamp",
    kind: "ccxt",
    assets: ["crypto"],
    fees: { maker: 0.003, taker: 0.004 },
    fields: [
      { id: "apiKey", label: "API key" },
      { id: "secret", label: "API secret", secret: true },
    ],
    keysUrl: "https://www.bitstamp.net/account/security/api/",
    steps: ["Bitstamp → Settings → API Access → New API key, with trading permissions only.", "Activate it from the email Bitstamp sends, then copy the key and secret here."],
    blurb: "One of the oldest exchanges, licensed in the EU and US.",
  },
  cryptocom: {
    id: "cryptocom",
    name: "Crypto.com Exchange",
    kind: "ccxt",
    assets: ["crypto"],
    sandbox: true,
    fees: { maker: 0.0025, taker: 0.005 },
    fields: [
      { id: "apiKey", label: "API key" },
      { id: "secret", label: "Secret key", secret: true },
    ],
    keysUrl: "https://crypto.com/exchange/user/settings/api-management",
    steps: ["Crypto.com Exchange → Settings → API Keys → Create a new key with trading enabled and withdrawals off.", "Copy the key and secret here."],
    blurb: "Crypto.com's trading exchange.",
  },
  okx: {
    id: "okx",
    name: "OKX",
    kind: "ccxt",
    assets: ["crypto"],
    sandbox: true,
    fees: { maker: 0.0008, taker: 0.001 },
    fields: [
      { id: "apiKey", label: "API key" },
      { id: "secret", label: "Secret key", secret: true },
      { id: "password", label: "Passphrase", secret: true },
    ],
    keysUrl: "https://www.okx.com/account/my-api",
    steps: ["OKX → Profile → API → Create V5 API key with Trade permission (not Withdraw).", "Copy the key, secret and the passphrase you chose here."],
    blurb: "Low fees and a demo-trading mode. Not available in some countries (including the US).",
  },
  bybit: {
    id: "bybit",
    name: "Bybit",
    kind: "ccxt",
    assets: ["crypto"],
    sandbox: true,
    fees: { maker: 0.001, taker: 0.001 },
    fields: [
      { id: "apiKey", label: "API key" },
      { id: "secret", label: "API secret", secret: true },
    ],
    keysUrl: "https://www.bybit.com/app/user/api-management",
    steps: ["Bybit → Account → API → Create New Key (system-generated) with Spot trading only.", "Copy the key and secret here."],
    blurb: "Low fees and a testnet. Not available in some countries (including the US and Canada).",
  },
  kucoin: {
    id: "kucoin",
    name: "KuCoin",
    kind: "ccxt",
    assets: ["crypto"],
    fees: { maker: 0.001, taker: 0.001 },
    fields: [
      { id: "apiKey", label: "API key" },
      { id: "secret", label: "API secret", secret: true },
      { id: "password", label: "API passphrase", secret: true },
    ],
    keysUrl: "https://www.kucoin.com/account/api",
    steps: ["KuCoin → Account → API Management → Create API with General and Spot Trading permissions.", "Copy the key, secret and passphrase here."],
    blurb: "Many smaller coins. Not available in some countries (including the US and Ontario).",
  },
};

export const VENUE_ORDER = ["alpaca", "kraken", "coinbase", "gemini", "binanceus", "binance", "bitstamp", "cryptocom", "okx", "bybit", "kucoin"];

/** Any other CCXT exchange id works too, with generic fields. */
export function venueInfo(id) {
  if (VENUES[id]) return VENUES[id];
  return {
    id,
    name: id,
    kind: "ccxt",
    assets: ["crypto"],
    fees: { maker: 0.002, taker: 0.004 },
    fields: [
      { id: "apiKey", label: "API key" },
      { id: "secret", label: "Secret", secret: true },
      { id: "password", label: "Passphrase (if it has one)", secret: true, optional: true },
    ],
    steps: ["Create an API key on the exchange with trading permission only (never withdrawals).", "Copy the key and secret here."],
    blurb: "Connected through CCXT.",
    generic: true,
  };
}

export const PRACTICE_SOURCES = ["kraken", "coinbase", "alpaca"];
