#!/usr/bin/env node
// Kestrel: a trading bot you can talk to. Start with `npm start` (or double-click a start file).
//   --demo      trade a simulated market that runs fast (no internet or accounts needed)
//   --port N    listen on another port (default 4747)
//   --no-open   don't open the browser automatically
//   --data DIR  keep Kestrel's files somewhere else (default: the .data folder here)
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Store } from "./src/store.mjs";
import { MarketData } from "./src/data/feed.mjs";
import { SyntheticMarket } from "./src/data/synthetic.mjs";
import { Engine } from "./src/engine.mjs";
import { startApp } from "./src/app.mjs";
import { DEFAULT_PORT } from "./src/defaults.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 12)) {
  console.error(`Kestrel needs Node.js 20.12 or newer (you have ${process.version}). Get the LTS version from https://nodejs.org`);
  process.exit(1);
}

// Optional .env file next to this script (ELEVENLABS_API_KEY=..., ELEVENLABS_AGENT_ID=...)
const envFile = path.join(HERE, ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") process.loadEnvFile(envFile);

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* no browser available */
  }
}

const demo = flag("--demo") || process.env.KESTREL_DEMO === "1";
const dataDir = path.resolve(value("--data") || process.env.KESTREL_DATA || path.join(HERE, demo ? ".data-demo" : ".data"));
const port = Number(value("--port") || process.env.KESTREL_PORT || DEFAULT_PORT);

const store = new Store(dataDir);
if (demo) {
  // The demo always starts fresh and running, so there's something to watch straight away.
  const fresh = new Store(dataDir);
  Object.assign(store.data, { ...fresh.data, running: true, setupDone: true, events: [], fills: [], trades: [], equity: { practice: [], live: [] }, paper: { cash: 10_000, start: 10_000, positions: {} }, trader: {}, mode: "practice" });
  store.data.markets = [
    { symbol: "BTC/USD", assetClass: "crypto" },
    { symbol: "ETH/USD", assetClass: "crypto" },
    { symbol: "SOL/USD", assetClass: "crypto" },
  ];
}
const synthetic = demo ? new SyntheticMarket({ speed: Number(process.env.KESTREL_DEMO_SPEED) || 3600 }) : null;
let engine;
const data = new MarketData({ store, demo: synthetic, alpacaKeys: () => engine?.alpacaKeys() ?? {} });
engine = new Engine({ store, data, demo });

let app;
try {
  app = await startApp({ engine, store, port, demo });
} catch (err) {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is busy: Kestrel may already be running. Open http://localhost:${port} or start with --port ${port + 1}.`);
    process.exit(1);
  }
  throw err;
}
await engine.init();
if (demo) engine.event({ type: "start", level: "success", text: "Demo mode: a simulated market where each 4-hour bar takes about 4 seconds, with $10,000 of pretend money. Nothing here is real." });

const url = `http://localhost:${app.port}`;
console.log(`\n  Kestrel is running${demo ? " in DEMO mode (simulated market)" : ""}: ${url}\n  Keep this window open while you use it. Press Ctrl+C to stop.\n`);
if (!flag("--no-open") && !process.env.KESTREL_NO_OPEN) openBrowser(url);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  console.log("\n  Stopping Kestrel (saving the books)…");
  await engine.close().catch(() => {});
  await app.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
