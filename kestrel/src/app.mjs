// The local web app: serves the dashboard, the JSON API it and the voice agent use, and a live
// event stream. It listens on this computer only.
//
// Security: every API call needs this launch's secret token (it's written into the page, so only
// a page served by Kestrel has it); the Host header must be localhost (which blocks DNS-rebinding
// attacks); writes from another website's page are refused; and a strict Content-Security-Policy
// limits what the page can load or talk to.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { runTool, TOOL_NAMES } from "./tools.mjs";
import { voiceSession, voiceCredits } from "./voice.mjs";
import { VENUES, VENUE_ORDER, venueInfo, PRACTICE_SOURCES } from "./brokers/catalog.mjs";
import { QUICK_PICKS, marketName, normalizeSymbol, assetClassOf } from "./markets.mjs";
import { RISK_LEVELS } from "./risk.mjs";
import { DEFAULT_AGENT_ID, VERSION } from "./defaults.mjs";
import { hint } from "./store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };
const VENDOR = {
  "/vendor/elevenlabs-client.js": "node_modules/@elevenlabs/client/dist/lib.iife.js",
  "/vendor/lightweight-charts.js": "node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' blob: https://cdn.jsdelivr.net",
  "worker-src 'self' blob:",
  "connect-src 'self' https://api.elevenlabs.io wss://api.elevenlabs.io https://*.elevenlabs.io wss://*.elevenlabs.io https://cdn.jsdelivr.net",
  "media-src 'self' blob: data:",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 200_000) throw new HttpError(413, "Request too large");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (v == null || typeof v !== "object") throw new Error();
    return v;
  } catch {
    throw new HttpError(400, "Expected JSON");
  }
}

function send(res, status, body, headers = {}) {
  const isObj = typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(status, { "content-type": isObj ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

export function startApp({ engine, store, port, host = "127.0.0.1", demo = false, elevenlabsBase }) {
  const token = crypto.randomBytes(24).toString("base64url");
  const clients = new Set();

  const allowedHost = (h) => {
    if (!h) return false;
    const name = h.replace(/:\d+$/, "").replace(/^\[|\]$/g, "").toLowerCase();
    return name === "localhost" || name === "127.0.0.1" || name === "::1";
  };

  // ── live updates to the page (Server-Sent Events) ──
  const broadcast = (type, data) => {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  let stateTimer = null;
  const pushState = () => {
    if (stateTimer) return;
    stateTimer = setTimeout(() => {
      stateTimer = null;
      if (clients.size) broadcast("state", engine.snapshot());
    }, 400);
  };
  engine.on("change", pushState);
  engine.on("event", (e) => broadcast("activity", e));
  engine.on("job", (j) => broadcast("job", { id: j.id, status: j.status, progress: j.progress, error: j.error }));
  engine.on("approvals", () => broadcast("approvals", [...engine.approvals.values()]));
  const ping = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 20_000);
  ping.unref();

  const voiceCreds = () => {
    const el = store.elevenlabs;
    return { apiKey: el.apiKey, agentId: el.agentId || DEFAULT_AGENT_ID };
  };

  const bool = (v) => v === true || v === "true";
  const sym = (s) => {
    const n = normalizeSymbol(s);
    if (!n) throw new HttpError(400, `I don't know a market called "${s}".`);
    return n;
  };

  // ── API routes ──
  const routes = [
    ["GET", /^\/api\/state$/, () => engine.snapshot()],
    ["GET", /^\/api\/briefing$/, () => ({ ok: true, text: engine.briefing() })],
    ["GET", /^\/api\/market$/, (_b, _m, q) => engine.chart(sym(q.get("symbol")), Number(q.get("bars")) || 300)],
    ["GET", /^\/api\/markets\/search$/, async (_b, _m, q) => ({ ok: true, results: await engine.data.search(q.get("venue") || engine.venueFor({ symbol: "BTC/USD", assetClass: "crypto" }) || "kraken", q.get("q") || "") })],
    [
      "GET",
      /^\/api\/catalog$/,
      () => ({
        venues: VENUE_ORDER.map((k) => ({ ...VENUES[k], fieldsIds: VENUES[k].fields.map((f) => f.id) })),
        practiceSources: PRACTICE_SOURCES.map((k) => ({ id: k, name: VENUES[k].name, fees: VENUES[k].fees })),
        quickPicks: QUICK_PICKS.map((p) => ({ ...p, name: marketName(p.symbol) })),
        risk: Object.values(RISK_LEVELS),
        version: VERSION,
        tools: TOOL_NAMES,
      }),
    ],
    [
      "POST",
      /^\/api\/setup$/,
      async (b) => {
        if (b.risk) engine.setRisk(b.risk);
        if (Array.isArray(b.markets) && b.markets.length) {
          const wanted = [...new Set(b.markets.map(sym))].slice(0, 12);
          for (const m of [...engine.s.markets]) if (!wanted.includes(m.symbol) && !(engine.book.positions[m.symbol] > 0)) await engine.removeMarket(m.symbol, { sell: false }).catch(() => {});
          const errors = [];
          for (const s of wanted) await engine.addMarket(s).catch((e) => errors.push(`${marketName(s)}: ${e.message}`));
          if (errors.length) engine.event({ type: "warning", level: "warning", text: `Some markets couldn't be added: ${errors.join("; ")}` });
        }
        if (b.cash && engine.mode === "practice" && !engine.s.setupDone) engine.resetPractice(b.cash);
        engine.s.setupDone = true;
        engine.persist();
        if (bool(b.start)) await engine.start();
        engine.emit("change");
        return { ok: true };
      },
    ],
    ["POST", /^\/api\/bot\/start$/, () => engine.start()],
    ["POST", /^\/api\/bot\/pause$/, () => engine.pause("you")],
    [
      "POST",
      /^\/api\/bot\/sell-all$/,
      (b) => {
        if (!bool(b.confirm)) throw new HttpError(400, "Confirm first.");
        return engine.sellAll("you");
      },
    ],
    ["POST", /^\/api\/orders$/, (b) => engine.order({ symbol: b.symbol, side: b.side, amount: b.amount != null ? Number(b.amount) : null, all: bool(b.all), by: "you" })],
    ["POST", /^\/api\/risk$/, (b) => engine.setRisk(String(b.level))],
    ["POST", /^\/api\/markets\/add$/, (b) => engine.addMarket(b.symbol)],
    ["POST", /^\/api\/markets\/remove$/, (b) => engine.removeMarket(b.symbol, { sell: bool(b.sell) })],
    [
      "POST",
      /^\/api\/settings$/,
      async (b) => {
        if (b.practiceVenue) await engine.setPracticeVenue(String(b.practiceVenue));
        if (b.patientOrders != null) engine.s.settings.patientOrders = bool(b.patientOrders);
        if (b.patientSeconds != null) engine.s.settings.patientSeconds = Math.max(10, Math.min(600, Number(b.patientSeconds) || 90));
        if (b.maxOrder != null && engine.mode === "live") {
          const v = Number(b.maxOrder);
          if (!(v >= 10)) throw new HttpError(400, "The largest order must be at least $10.");
          engine.s.live.maxOrder = v;
          engine.event({ type: "settings", level: "info", text: `Largest single real-money order is now $${v.toFixed(2)}.` });
        }
        if (b.timeframes && typeof b.timeframes === "object") {
          let changed = false;
          for (const ac of ["crypto", "stock"]) if (["1h", "4h", "1d"].includes(b.timeframes[ac]) && engine.s.timeframes[ac] !== b.timeframes[ac]) ((engine.s.timeframes[ac] = b.timeframes[ac]), (changed = true));
          if (changed) {
            engine.event({ type: "settings", level: "info", text: `Bar timeframes now: crypto ${engine.s.timeframes.crypto}, stocks ${engine.s.timeframes.stock}. Re-reading history…` });
            for (const m of engine.s.markets) engine.trader.addSymbol(m.symbol, { tfMs: engine.tfFor(m), assetClass: m.assetClass });
            await engine.warmAll();
          }
        }
        engine.persist();
        engine.emit("change");
        return { ok: true };
      },
    ],
    ["POST", /^\/api\/practice\/reset$/, (b) => engine.resetPractice(b.cash)],
    ["POST", /^\/api\/connect$/, (b) => engine.connect({ venue: String(b.venue || ""), credentials: b.credentials || {}, paper: bool(b.paper), sandbox: bool(b.sandbox) })],
    ["POST", /^\/api\/disconnect$/, (b) => engine.disconnect(String(b.id || ""))],
    ["POST", /^\/api\/live\/enable$/, (b) => engine.goLive({ connection: String(b.connection || ""), budget: b.budget, maxOrder: b.maxOrder, confirm: b.confirm })],
    ["POST", /^\/api\/live\/disable$/, () => engine.goPractice()],
    [
      "POST",
      /^\/api\/backtest$/,
      (b) => {
        const job = engine.startBacktest({ symbols: b.symbols, days: b.days, risk: b.risk });
        return { ok: true, id: job.id };
      },
    ],
    [
      "GET",
      /^\/api\/backtest\/([\w-]+)$/,
      (_b, [jid]) => {
        const j = engine.jobs.get(jid);
        if (!j) throw new HttpError(404, "No such test.");
        return j;
      },
    ],
    [
      "POST",
      /^\/api\/agent\/tool$/,
      (b) => {
        if (!TOOL_NAMES.includes(b.name)) throw new HttpError(400, `Unknown tool ${b.name}`);
        return runTool(engine, b.name, b.params || {});
      },
    ],
    ["POST", /^\/api\/approvals\/([\w-]+)$/, (b, [aid]) => engine.approve(aid, bool(b.approve))],
    ["POST", /^\/api\/voice\/session$/, () => voiceSession(voiceCreds(), "voice", elevenlabsBase)],
    ["POST", /^\/api\/voice\/text-session$/, () => voiceSession(voiceCreds(), "text", elevenlabsBase)],
    ["GET", /^\/api\/voice\/credits$/, () => voiceCredits(voiceCreds(), elevenlabsBase)],
    [
      "GET",
      /^\/api\/voice\/settings$/,
      () => {
        const el = store.elevenlabs;
        return { hasKey: !!el.apiKey, keyHint: hint(el.apiKey), fromEnv: el.fromEnv, agentId: el.agentId || DEFAULT_AGENT_ID, customAgent: !!el.agentId, sdk: fs.existsSync(path.join(ROOT, VENDOR["/vendor/elevenlabs-client.js"])) };
      },
    ],
    [
      "POST",
      /^\/api\/voice\/settings$/,
      async (b) => {
        const cur = store.secrets.elevenlabs || {};
        const next = { ...cur };
        if (typeof b.agentId === "string") next.agentId = /^agent_[a-z0-9]+$/i.test(b.agentId.trim()) ? b.agentId.trim() : "";
        if (typeof b.apiKey === "string") {
          const key = b.apiKey.trim();
          if (key) {
            const probe = await voiceSession({ apiKey: key, agentId: next.agentId || DEFAULT_AGENT_ID }, "voice", elevenlabsBase);
            if (!probe.ok && probe.error !== "network" && probe.error !== "agent") return { ok: false, message: probe.message };
            next.apiKey = key;
          } else delete next.apiKey;
        }
        await store.setSecret("elevenlabs", next);
        return { ok: true, message: "Saved. You can talk to Kestrel now." };
      },
    ],
  ];

  async function api(req, res, url) {
    const given = req.headers["x-kestrel-token"] || url.searchParams.get("token");
    if (given !== token) return send(res, 403, { ok: false, message: "Missing or wrong app token. Reload the page." });
    if (req.method !== "GET") {
      const origin = req.headers.origin;
      if (origin && !allowedHost(new URL(origin).host)) return send(res, 403, { ok: false, message: "Cross-site request refused." });
    }
    if (url.pathname === "/api/stream") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
      res.write(`event: state\ndata: ${JSON.stringify(engine.snapshot())}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    for (const [method, re, fn] of routes) {
      if (method !== req.method) continue;
      const m = url.pathname.match(re);
      if (!m) continue;
      try {
        const body = method === "GET" ? {} : await readBody(req);
        const out = await fn(body, m.slice(1), url.searchParams);
        return send(res, 200, out ?? { ok: true });
      } catch (e) {
        const status = e.status || 400;
        if (!e.status && !(e instanceof HttpError)) console.error(`[kestrel] ${req.method} ${url.pathname}:`, e.message);
        return send(res, status, { ok: false, message: e.message });
      }
    }
    return send(res, 404, { ok: false, message: "Not found" });
  }

  function serveFile(res, file, extraHeaders = {}) {
    fs.readFile(file, (err, buf) => {
      if (err) return send(res, 404, "Not found");
      send(res, 200, buf, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache", ...extraHeaders });
    });
  }

  const server = http.createServer(async (req, res) => {
    if (!allowedHost(req.headers.host)) return send(res, 403, "Kestrel only answers on this computer (localhost).");
    let url;
    try {
      url = new URL(req.url, "http://localhost");
    } catch {
      return send(res, 400, "Bad request");
    }
    if (url.pathname.startsWith("/api/")) return api(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
    if (VENDOR[url.pathname]) {
      const p = path.join(ROOT, VENDOR[url.pathname]);
      if (!fs.existsSync(p)) return send(res, 404, `// Missing ${VENDOR[url.pathname]}: run npm install in the kestrel folder.\n`, { "content-type": "text/javascript" });
      return serveFile(res, p);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return fs.readFile(path.join(PUBLIC, "index.html"), "utf8", (err, html) => {
        if (err) return send(res, 500, "index.html is missing");
        const boot = JSON.stringify({ token, demo, version: VERSION }).replace(/</g, "\\u003c");
        send(res, 200, html.replace("%%KESTREL_BOOT%%", boot), { "content-type": TYPES[".html"], "content-security-policy": CSP, "x-frame-options": "DENY" });
      });
    }
    const file = path.normalize(path.join(PUBLIC, url.pathname));
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, "Forbidden");
    serveFile(res, file);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const close = () =>
        new Promise((r) => {
          clearInterval(ping);
          for (const c of clients) c.end();
          server.close(() => r());
        });
      resolve({ server, port: server.address().port, token, close });
    });
  });
}
