// Everything Kestrel remembers, as JSON files in its data folder (kestrel/.data by default):
//   state.json    settings, the bot's books (cash, positions, stops), equity history, recent activity
//   secrets.json  exchange and ElevenLabs keys, written owner-only (chmod 600), never sent to the page
//   journal.jsonl every event and fill, appended forever (your audit trail)
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const PRACTICE_CASH = 10_000;

export const DEFAULT_STATE = () => ({
  version: 1,
  setupDone: false,
  mode: "practice", // "practice" (pretend money) or "live" (real money)
  running: false,
  risk: "balanced",
  // Where practice prices come from (any public exchange), and its fees for realistic practice.
  practiceVenue: "kraken",
  markets: [
    { symbol: "BTC/USD", venue: "kraken", assetClass: "crypto" },
    { symbol: "ETH/USD", venue: "kraken", assetClass: "crypto" },
    { symbol: "SOL/USD", venue: "kraken", assetClass: "crypto" },
  ],
  timeframes: { crypto: "4h", stock: "1d" },
  // The practice account: pretend money, real prices.
  paper: { cash: PRACTICE_CASH, start: PRACTICE_CASH, positions: {} },
  // Real money: which connected account, how much the bot may use, the biggest single order.
  live: { broker: null, budget: 0, maxOrder: 1000, cash: 0, positions: {}, enabledAt: null, startEquity: null },
  connections: {}, // brokerId → {venue, kind, sandbox, label, connectedAt, account summary}
  trader: {}, // per-mode Trader books: stops, entries, cooldowns, peak, safety stops
  equity: { practice: [], live: [] }, // [{t, v}]
  trades: [], // finished round trips (latest last), both modes, tagged
  fills: [], // recent fills
  events: [], // recent activity
  settings: { patientOrders: true, patientSeconds: 90, announce: true },
  lastSeen: {},
});

async function writeAtomic(file, text, mode) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  await fsp.writeFile(tmp, text, { mode });
  await fsp.rename(tmp, file);
}

function merge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) merge(base[k], v);
    else base[k] = v;
  }
  return base;
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.stateFile = path.join(dir, "state.json");
    this.secretsFile = path.join(dir, "secrets.json");
    this.journalFile = path.join(dir, "journal.jsonl");
    this.cacheDir = path.join(dir, "cache");
    fs.mkdirSync(this.cacheDir, { recursive: true });
    this.data = merge(DEFAULT_STATE(), readJson(this.stateFile));
    this.secrets = readJson(this.secretsFile) || {};
    this.timer = null;
    this.writing = Promise.resolve();
  }

  /** Save soon (writes are batched). */
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 250);
  }

  flush() {
    const text = JSON.stringify(this.data);
    this.writing = this.writing.then(() => writeAtomic(this.stateFile, text, 0o600)).catch((e) => console.error("[kestrel] couldn't save state:", e.message));
    return this.writing;
  }

  async close() {
    clearTimeout(this.timer);
    this.timer = null;
    await this.flush();
  }

  // ── secrets ──
  secret(key) {
    return this.secrets[key];
  }

  async setSecret(key, value) {
    if (value == null) delete this.secrets[key];
    else this.secrets[key] = value;
    await writeAtomic(this.secretsFile, JSON.stringify(this.secrets, null, 2), 0o600);
    try {
      fs.chmodSync(this.secretsFile, 0o600);
    } catch {
      /* Windows */
    }
  }

  /** The ElevenLabs key: the environment wins (handy for a .env file). */
  get elevenlabs() {
    return {
      apiKey: process.env.ELEVENLABS_API_KEY || this.secrets.elevenlabs?.apiKey || "",
      agentId: process.env.ELEVENLABS_AGENT_ID || this.secrets.elevenlabs?.agentId || "",
      fromEnv: !!process.env.ELEVENLABS_API_KEY,
    };
  }

  // ── journal ──
  journal(entry) {
    fsp.appendFile(this.journalFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", { mode: 0o600 }).catch(() => {});
  }

  // ── bar cache for backtests ──
  cachePath(key) {
    return path.join(this.cacheDir, `${key.replace(/[^a-z0-9._-]+/gi, "_")}.json`);
  }
  readCache(key) {
    return readJson(this.cachePath(key));
  }
  async writeCache(key, value) {
    await writeAtomic(this.cachePath(key), JSON.stringify(value), 0o644);
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Show the last few characters of a key, never the key. */
export const hint = (s) => (s ? `…${String(s).slice(-4)}` : null);
