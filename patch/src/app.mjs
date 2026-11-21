// The local web app: serves the dashboard, the JSON API it and the voice agent use, and a live
// event stream. It listens on this computer only unless LAN access is switched on.
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Store } from "./store.mjs";
import { Inventory } from "./inventory.mjs";
import { Controller } from "./controller.mjs";
import { Scanner } from "./scanner.mjs";
import { runTuneup } from "./tuneup.mjs";
import { speedTest, internetStatus } from "./net/internet.mjs";
import { wifiInfo } from "./net/wifi.mjs";
import { ACTIONS } from "./drivers/common.mjs";
import homeassistant from "./drivers/homeassistant.mjs";
import { DEFAULT_AGENT_ID, DEFAULT_PORT } from "./defaults.mjs";
import { YOUTUBE_API } from "./net/youtube.mjs";
import { localNetworks } from "./net/interfaces.mjs";
import { safeJson } from "./util.mjs";
import { appVersion, onPhone, setPhoneOpener } from "./platform.mjs";
import { TvApps } from "./tvapps/index.mjs";
import { CLAUDE_NAME, checkKey as checkClaudeKey, sdkReady } from "./tvapps/claude.mjs";
import { Uploads } from "./uploads.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };

function findSdk() {
  const candidates = [path.join(ROOT, "node_modules/@elevenlabs/client/dist/lib.iife.js")];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

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
  "form-action 'self'",
].join("; ");

class HttpError extends Error {
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
    if (size > 3_000_000) throw new HttpError(413, "Request too large");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  const parsed = safeJson(Buffer.concat(chunks).toString("utf8"));
  if (parsed == null || typeof parsed !== "object") throw new HttpError(400, "Expected JSON");
  return parsed;
}

function send(res, status, body, headers = {}) {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(data);
}

export async function voiceSession(creds, mode) {
  const apiKey = creds.apiKey;
  const agentId = creds.agentId || DEFAULT_AGENT_ID;
  if (!apiKey) return { ok: false, error: "nokey", message: "Add your ElevenLabs API key in Settings, then I can talk." };
  const endpoint = mode === "text" ? "get-signed-url" : "token";
  let res;
  try {
    res = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/${endpoint}?agent_id=${encodeURIComponent(agentId)}`, { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(12_000) });
  } catch {
    return { ok: false, error: "network", message: "Couldn't reach ElevenLabs. Check this computer's internet connection." };
  }
  if (res.status === 401 || res.status === 403) {
    const t = await res.text().catch(() => "");
    return { ok: false, error: "auth", message: /permission/i.test(t) ? "Your ElevenLabs API key needs the “ElevenLabs Agents” permission (Write). Edit the key at elevenlabs.io → Developers → API keys." : "ElevenLabs didn't accept the API key. Paste it again in Settings." };
  }
  if (res.status === 404) return { ok: false, error: "agent", message: "That ElevenLabs account doesn't have the Patch agent. Check the agent ID in Settings, or use a key from the account the agent was created in." };
  if (!res.ok) return { ok: false, error: "upstream", message: `ElevenLabs answered ${res.status}. Try again in a moment.` };
  const data = await res.json();
  if (mode === "text" && data.signed_url) return { ok: true, auth: { signedUrl: data.signed_url } };
  if (data.token) return { ok: true, auth: { conversationToken: data.token } };
  return { ok: false, error: "upstream", message: "Unexpected answer from ElevenLabs." };
}

/** A one-unit YouTube Data API call that tells a working key from a wrong or switched-off one. */
async function checkYouTubeKey(key, base = YOUTUBE_API) {
  try {
    const res = await fetch(`${base}/videos?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) return { ok: true, message: "YouTube key works. I can find and play videos on your TVs now." };
    const body = await res.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || "";
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(reason)) return { ok: false, message: "That key's Google project doesn't have the YouTube Data API v3 turned on. Enable it in the Google Cloud console, then save again." };
    return { ok: false, message: "YouTube didn't accept that key. Copy it again from the Google Cloud console (APIs & Services → Credentials)." };
  } catch {
    return { ok: false, network: true, message: "Couldn't reach YouTube to check the key, so I saved it anyway." };
  }
}

export async function startApp({ port = DEFAULT_PORT, lan = false, demo = false, dataDir, overrides = {}, autoScan = true, log = console.log } = {}) {
  const store = new Store(dataDir || path.join(ROOT, demo ? ".data-demo" : ".data"));
  lan = lan || store.data.lan.enabled;
  if (lan && !store.data.lan.accessCode) {
    store.data.lan.accessCode = String(crypto.randomInt(100000, 999999));
    store.save();
  }
  const inventory = new Inventory(store);
  const controller = new Controller({ store, inventory, overrides });
  const scanner = new Scanner({ store, inventory, controller, overrides });
  controller.scanner = scanner;
  // Files sent from the dashboard, and the TV apps the person makes.
  const uploads = new Uploads(path.join(store.dir, "uploads"));
  const tvapps = new TvApps({ store, controller, inventory, address: () => scanner.network?.address || null, overrides, log });
  controller.uploads = uploads;
  controller.tvapps = tvapps;
  const previewToken = crypto.randomBytes(12).toString("base64url");
  const token = crypto.randomBytes(18).toString("base64url");
  const sessions = new Set();
  const state = { tuneup: null, speed: null, internet: null, wifi: null };

  // ── live events ──
  const clients = new Set();
  const broadcast = (type, data) => {
    const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(msg);
  };
  // Claude's builds report as they go, and once more when they're done (the conversation hears it).
  // Anthropic's SDK itself is only loaded when Claude is used, so it costs a phone nothing until then.
  tvapps.onChange = () => broadcast("tvapps", tvapps.list());
  tvapps.onBuilt = (r) => broadcast("tvapp-built", r);
  // In the phone app, pages and videos for "this phone" go to the open dashboard, which hands them to Android.
  setPhoneOpener((url) => {
    if (!clients.size) return false;
    broadcast("open-url", { url });
    return true;
  });
  let devTimer = null;
  const knownNew = new Set();
  inventory.on("change", () => {
    clearTimeout(devTimer);
    devTimer = setTimeout(() => broadcast("devices", inventory.list()), 120);
  });
  scanner.on("progress", (p) => broadcast("scan", p));
  scanner.on("done", (s) => {
    broadcast("scan", { running: false, done: true, summary: s });
    for (const d of inventory.list().filter((x) => x.isNew && !knownNew.has(x.id))) {
      knownNew.add(d.id);
      broadcast("notice", { kind: "new-device", text: `New on your WiFi: ${d.name}${d.vendor ? ` (${d.vendor})` : ""}`, deviceId: d.id });
    }
  });
  scanner.on("failed", (e) => broadcast("scan", { running: false, error: e.message }));

  const redactedSettings = () => {
    const el = store.elevenlabs;
    const ha = store.secrets.homeAssistant;
    return {
      elevenlabs: { hasKey: !!el.apiKey, keyHint: el.apiKey ? `…${el.apiKey.slice(-4)}` : null, agentId: el.agentId || DEFAULT_AGENT_ID, customAgent: !!el.agentId, fromEnv: !!process.env.ELEVENLABS_API_KEY },
      homeAssistant: { url: store.data.homeAssistant.url || ha?.url || "", hasToken: !!ha?.token },
      youtube: { hasKey: !!store.secrets.youtubeApiKey, keyHint: store.secrets.youtubeApiKey ? `…${store.secrets.youtubeApiKey.slice(-4)}` : null, fromEnv: !!process.env.YOUTUBE_API_KEY },
      claude: { hasKey: !!store.anthropic.apiKey, keyHint: store.anthropic.apiKey ? `…${store.anthropic.apiKey.slice(-4)}` : null, fromEnv: !!process.env.PATCH_ANTHROPIC_API_KEY, model: CLAUDE_NAME },
      network: { subnet: store.data.network.subnet || "" },
      lan: { enabled: !!store.data.lan.enabled, active: lan, accessCode: lan ? store.data.lan.accessCode : null },
      features: store.data.features,
      dataDir: store.dir,
    };
  };

  // Devices waiting to be connected explain why something can't be found ("pair the Hue Bridge first").
  const setupHint = () => {
    const waiting = inventory.list().filter((d) => d.setup && d.online !== false);
    return waiting.length ? ` Not connected yet: ${waiting.map((d) => `${d.name} (${d.setup.message})`).join(" ")}` : "";
  };

  async function control(body) {
    const { device, kind, room, action, value, confirmToken } = body;
    // Sight: whoever is asking (the voice assistant) can be shown a picture of a TV's screen, and the person hasn't switched that off.
    const sight = body.sight === true && store.data.features.sight !== false;
    if (!ACTIONS[action]) return { ok: false, error: "EACTION", message: `Unknown action "${action}".` };
    if (!device && (kind || room)) {
      const all = inventory.findMany({ kind, room }).filter((d) => d.actions?.includes(action));
      const list = all.filter((d) => d.online !== false);
      const offline = all.length - list.length;
      if (!list.length) {
        return { ok: false, error: "ENOTFOUND", message: `I couldn't find any ${kind || "devices"}${room ? ` in the ${room}` : ""} that can ${ACTIONS[action].label.toLowerCase()}${offline ? ` (${offline} are offline)` : ""}.${setupHint()}` };
      }
      const r = list.length === 1 ? await controller.act(list[0].id, action, value, { confirmToken, look: true, sight }) : await controller.actMany(list.map((d) => d.id), action, value, { confirmToken });
      if (offline && r.ok) r.message += ` (${offline} offline ${offline === 1 ? "device was" : "devices were"} skipped.)`;
      return r;
    }
    // "YouTube" means the YouTube app on the TV, at once: with no TV named (or just "the TV"), it's
    // the TV used last, or the one that's connected and on. Nobody is asked "which one?".
    const youtube = action === "search_youtube" || action === "play_youtube" || (action === "launch_app" && /\byou\s?tube\b/i.test(String(value || "")));
    const anyTv = !device || /^(on\s+)?((the|my|our|a)\s+)?(tv|telly|television|big screen|screen)$/i.test(String(device).trim());
    if (youtube && !room && anyTv) {
      const tv = inventory.defaultTv(inventory.tvs().filter((d) => d.setup || d.actions?.includes(action)));
      if (tv) return controller.act(tv.id, action, value, { confirmToken, look: true, sight });
    }
    const r = inventory.resolve(room && device ? `${room} ${device}` : device, { kind, action });
    if (r.ambiguous && youtube) {
      const tv = inventory.defaultTv(r.ambiguous.filter((d) => inventory.tvs().some((t) => t.id === d.id)));
      if (tv) return controller.act(tv.id, action, value, { confirmToken, look: true, sight });
    }
    if (r.ambiguous) return { ok: false, error: "EAMBIGUOUS", message: `Which one do you mean: ${r.ambiguous.map((d) => inventory.displayName(d)).join(", ")}?`, candidates: r.ambiguous.map((d) => inventory.toPublic(d)) };
    if (r.none) return { ok: false, error: "ENOTFOUND", message: `I couldn't find "${device}".${r.suggestions.length ? ` Did you mean ${r.suggestions.join(" or ")}?` : " A new scan might find it."}${setupHint()}` };
    // Asked for by voice or in the chat: the answer says what's on screen afterwards, where it can.
    return controller.act(r.device.id, action, value, { confirmToken, look: true, sight });
  }

  async function applyFix(fixId, confirmToken) {
    const f = state.tuneup?.findings.find((x) => x.id === fixId);
    if (!f?.fix) return { ok: false, message: "That fix isn't available any more. Run the tune-up again." };
    if (f.fix.haUpdate) {
      if (!confirmToken || confirmToken !== f.fix.pendingToken) {
        f.fix.pendingToken = crypto.randomBytes(9).toString("base64url");
        return { ok: false, needsConfirmation: true, confirmToken: f.fix.pendingToken, message: `Installing this update restarts the device it's for. Ask the person to confirm first.` };
      }
      await homeassistant.installUpdate(f.fix.haUpdate, controller.ctx());
      f.fixed = true;
      return { ok: true, message: `Home Assistant is installing ${f.title.replace(/^Update available: /, "")}.` };
    }
    const r = await controller.act(f.fix.deviceId, f.fix.action, f.fix.value, { confirmToken });
    if (r.ok) f.fixed = true;
    return r;
  }

  async function saveSettings(b) {
    const checks = {};
    if (typeof b.elevenlabsApiKey === "string") {
      const key = b.elevenlabsApiKey.trim();
      if (key) {
        const probe = await voiceSession({ apiKey: key, agentId: (b.agentId ?? store.data.elevenlabs.agentId) || "" }, "voice");
        checks.elevenlabs = probe.ok ? { ok: true, message: "Key works. You can talk to Patch now." } : { ok: probe.error === "network", message: probe.message };
        if (probe.ok || probe.error === "network" || probe.error === "agent") store.data.elevenlabs.apiKey = key;
      } else store.data.elevenlabs.apiKey = "";
    }
    if (typeof b.youtubeApiKey === "string") {
      const key = b.youtubeApiKey.trim();
      if (!key) store.data.youtube.apiKey = "";
      else {
        const check = await checkYouTubeKey(key, overrides.youtubeBase);
        checks.youtube = check;
        if (check.ok || check.network) store.data.youtube.apiKey = key;
      }
    }
    if (typeof b.anthropicApiKey === "string") {
      const key = b.anthropicApiKey.trim();
      if (!key) store.data.anthropic.apiKey = "";
      else {
        const check = await checkClaudeKey({ apiKey: key, baseURL: overrides.claudeBase });
        checks.claude = check;
        if (check.ok || check.network) store.data.anthropic.apiKey = key;
      }
    }
    if (typeof b.agentId === "string") store.data.elevenlabs.agentId = /^agent_[a-z0-9]+$/i.test(b.agentId.trim()) ? b.agentId.trim() : "";
    if (typeof b.haUrl === "string" || typeof b.haToken === "string") {
      const url = (b.haUrl ?? store.data.homeAssistant.url).trim().replace(/\/+$/, "");
      const tok = (b.haToken ?? store.data.homeAssistant.token).trim();
      if (url && !/^https?:\/\//i.test(url)) checks.homeAssistant = { ok: false, message: "The Home Assistant address should start with http:// or https://" };
      else {
        store.data.homeAssistant = { url, token: tok };
        if (url && tok) {
          try {
            const res = await fetch(`${url}/api/`, { headers: { authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(6000) });
            checks.homeAssistant = res.ok ? { ok: true, message: "Connected to Home Assistant. Loading its devices…" } : { ok: false, message: res.status === 401 ? "Home Assistant rejected that token." : `Home Assistant answered ${res.status}.` };
          } catch {
            checks.homeAssistant = { ok: false, message: "Couldn't reach Home Assistant at that address." };
          }
        }
      }
    }
    if (typeof b.subnet === "string") {
      const s = b.subnet.trim();
      if (!s || /^\d+\.\d+\.\d+\.\d+\/(1[6-9]|2\d|3[0-2])$/.test(s)) store.data.network.subnet = s;
      else checks.subnet = { ok: false, message: "Use the form 192.168.1.0/24 (from /16 to /32)." };
    }
    if (typeof b.lanEnabled === "boolean") store.data.lan.enabled = b.lanEnabled;
    if (typeof b.vendorLookup === "boolean") store.data.features.vendorLookup = b.vendorLookup;
    if (typeof b.sight === "boolean") store.data.features.sight = b.sight;
    await store.save();
    if (checks.homeAssistant?.ok) scanner.scan().catch(() => {});
    return { ok: true, settings: redactedSettings(), checks, restartNeeded: typeof b.lanEnabled === "boolean" && b.lanEnabled !== lan };
  }

  const routes = [
    ["GET", /^\/api\/state$/, async () => ({
      app: { version: appVersion(), demo, lan, platform: onPhone() ? "android" : process.platform },
      setup: { voice: !!store.elevenlabs.apiKey, sdk: !!findSdk(), claude: !!store.anthropic.apiKey, sight: store.data.features.sight !== false, agentId: store.elevenlabs.agentId || DEFAULT_AGENT_ID, homeAssistant: !!store.secrets.homeAssistant, scanned: !!store.data.history.firstScanAt },
      network: scanner.network ? { cidr: scanner.network.cidr, gateway: scanner.network.gateway, address: scanner.network.address, iface: scanner.network.iface } : null,
      scan: { running: !!scanner.running, last: scanner.lastScan },
      devices: inventory.list(),
      tuneup: state.tuneup,
      speed: state.speed,
      tvapps: tvapps.list(),
    })],
    ["POST", /^\/api\/scan$/, async (b) => {
      const summary = await scanner.scan({ deep: !!b.deep });
      return { ok: true, summary, devices: inventory.list() };
    }],
    ["GET", /^\/api\/devices$/, async () => ({ devices: inventory.list() })],
    ["GET", /^\/api\/devices\/([^/]+)$/, async (_, [id], url) => {
      const d = url.searchParams.get("refresh") === "0" ? controller.publicDevice(id) : await controller.refresh(id);
      if (!d) throw new HttpError(404, "No such device");
      return { device: d };
    }],
    ["POST", /^\/api\/devices\/([^/]+)\/action$/, async (b, [id]) => controller.act(id, b.action, b.value, { confirmToken: b.confirmToken })],
    ["POST", /^\/api\/devices\/([^/]+)\/meta$/, async (b, [id]) => {
      if (!inventory.get(id)) throw new HttpError(404, "No such device");
      let last = { ok: true };
      if (typeof b.name === "string" && b.name.trim()) last = await controller.act(id, "rename", b.name);
      if (typeof b.room === "string") last = await controller.act(id, "set_room", b.room);
      if (typeof b.hidden === "boolean") {
        await store.setPath(["meta", id], { ...inventory.meta(id), hidden: b.hidden });
        inventory.changed(inventory.get(id));
      }
      return { ...last, device: controller.publicDevice(id) };
    }],
    ["POST", /^\/api\/devices\/([^/]+)\/credentials$/, async (b, [id]) => controller.setCredentials(id, b)],
    ["POST", /^\/api\/devices\/([^/]+)\/diagnose$/, async (_, [id]) => controller.diagnose(id)],
    // A tap on the picture of a TV's screen (the picture itself is served below, as an image).
    ["POST", /^\/api\/devices\/([^/]+)\/screen\/tap$/, async (b, [id]) => controller.tapAt(id, Number(b.x), Number(b.y))],
    ["POST", /^\/api\/control$/, async (b) => control(b)],
    ["POST", /^\/api\/resolve$/, async (b) => {
      const r = inventory.resolve(b.query, { kind: b.kind });
      if (r.device) return { device: await controller.refresh(r.device.id) };
      if (r.ambiguous) return { ambiguous: r.ambiguous.map((d) => inventory.toPublic(d)) };
      return { none: true, suggestions: r.suggestions };
    }],
    ["POST", /^\/api\/tuneup$/, async (b) => {
      if (!store.data.history.firstScanAt || !scanner.lastScan) await scanner.scan().catch(() => null);
      state.tuneup = await runTuneup({ inventory, controller, store, focus: b.focus || "all", skipInternet: !!b.skipInternet, skipWifi: !!b.skipWifi });
      broadcast("tuneup", state.tuneup);
      return state.tuneup;
    }],
    ["POST", /^\/api\/fixes\/([^/]+)$/, async (b, [id]) => {
      const r = await applyFix(id, b.confirmToken);
      if (r.ok) broadcast("tuneup", state.tuneup);
      return r;
    }],
    ["POST", /^\/api\/speedtest$/, async () => {
      broadcast("speed", { running: true });
      state.speed = await speedTest({ onProgress: (p) => broadcast("speed", { running: true, ...p }) });
      broadcast("speed", { running: false, result: state.speed });
      return state.speed;
    }],
    ["GET", /^\/api\/network$/, async (_, __, url) => {
      if (url.searchParams.get("fresh") === "1" || !state.internet) {
        const [wifi, internet] = await Promise.all([wifiInfo().catch(() => null), internetStatus().catch(() => ({ online: false }))]);
        state.wifi = wifi;
        state.internet = internet;
      }
      return { network: scanner.network || (await scanner.currentNetwork()), wifi: state.wifi, internet: state.internet, speed: state.speed };
    }],
    ["GET", /^\/api\/settings$/, async () => redactedSettings()],
    ["POST", /^\/api\/settings$/, async (b) => saveSettings(b)],
    ["POST", /^\/api\/voice\/session$/, async (b) => voiceSession(store.elevenlabs, b.mode === "text" ? "text" : "voice")],
    // The TV app maker.
    ["GET", /^\/api\/tvapps$/, async () => ({ apps: tvapps.list(), kinds: tvapps.kinds() })],
    ["POST", /^\/api\/tvapps$/, async (b) => tvChanged(await tvapps.create(b))],
    // Claude builds an app, or changes one (both answer at once; the work goes on, shown as it happens).
    ["POST", /^\/api\/tvapps\/build$/, async (b) => tvChanged(await tvapps.build(b))],
    // Whether Anthropic's SDK loads here (loading it if it hasn't been): the phone app's tests ask.
    ["GET", /^\/api\/claude\/sdk$/, async () => ({ ok: await sdkReady() })],
    ["POST", /^\/api\/tvapps\/([^/]+)\/improve$/, async (b, [id]) => tvChanged(await tvapps.improve(id, b))],
    ["POST", /^\/api\/tvapps\/([^/]+)\/retry$/, async (b, [id]) => tvChanged(await tvapps.retry(id))],
    ["POST", /^\/api\/tvapps\/([^/]+)\/cancel$/, async (b, [id]) => tvChanged(await tvapps.cancel(id))],
    ["POST", /^\/api\/tvapps\/([^/]+)$/, async (b, [id]) => tvChanged(await tvapps.update(id, b))],
    ["POST", /^\/api\/tvapps\/([^/]+)\/photos$/, async (b, [id]) => tvChanged(await tvapps.addPhotos(id, Array.isArray(b.files) ? b.files : [], uploads))],
    ["POST", /^\/api\/tvapps\/([^/]+)\/photos\/remove$/, async (b, [id]) => tvChanged(await tvapps.removePhoto(id, b.name))],
    ["POST", /^\/api\/tvapps\/([^/]+)\/tv$/, async (b, [id]) => tvChanged(await tvapps.putOnTv(id, b.device))],
    ["POST", /^\/api\/tvapps\/([^/]+)\/open$/, async (b, [id]) => tvChanged(await tvapps.open(id, b.device))],
    ["POST", /^\/api\/tvapps\/([^/]+)\/remove$/, async (b, [id]) => tvChanged(await tvapps.remove(id, { fromTvs: b.fromTvs !== false }))],
  ];

  function tvChanged(r) {
    broadcast("tvapps", tvapps.list());
    return r;
  }

  // ── security ──
  const lanAddresses = () => (lan ? localNetworks().map((n) => n.address) : []);
  const hostname = os.hostname().toLowerCase();
  function hostAllowed(req) {
    const h = String(req.headers.host || "").toLowerCase();
    const m = h.match(/^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
    if (!m) return false;
    if (Number(m[2] || 80) !== actualPort) return false;
    const name = m[1];
    if (["localhost", "127.0.0.1", "[::1]"].includes(name)) return true;
    if (lan && (lanAddresses().includes(name) || name === hostname || name === `${hostname}.local` || name === hostname.replace(/\.local$/, "") + ".local")) return true;
    return false;
  }
  const isLoopback = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
  const cookie = (req, name) => String(req.headers.cookie || "").split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1];

  async function serveStatic(req, res, pathname) {
    if (pathname === "/vendor/elevenlabs-client.js") {
      const p = findSdk();
      if (!p) return send(res, 404, "// ElevenLabs SDK not installed: run npm install in the patch folder.\n", { "content-type": "text/javascript" });
      return send(res, 200, await fsp.readFile(p), { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" });
    }
    const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
    const file = path.resolve(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 404, "Not found");
    let body;
    try {
      body = await fsp.readFile(file);
    } catch {
      return send(res, 404, "Not found");
    }
    const ext = path.extname(file);
    if (ext === ".html") {
      body = body
        .toString("utf8")
        .replace("%%PATCH_BOOT%%", JSON.stringify({ token, demo, lan, version: appVersion(), phone: onPhone(), tvPreview: previewToken }).replace(/</g, "\\u003c"));
    }
    send(res, 200, body, { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": ext === ".html" ? "no-store" : "no-cache", ...(ext === ".html" ? { "content-security-policy": CSP } : {}) });
  }

  const loginPage = (error) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Patch · sign in</title>
<style>body{font:16px system-ui,sans-serif;background:#0b1020;color:#e8ecf6;display:grid;place-items:center;min-height:100vh;margin:0}form{background:#141b31;padding:28px;border-radius:16px;width:min(340px,90vw)}input,button{font:inherit;width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2a355a;margin-top:12px;background:#0b1020;color:inherit}button{background:#3ee6b0;color:#06281d;border:0;font-weight:600}p{color:#9aa6c7;margin:6px 0 0}</style>
<form method="post" action="/login"><strong>Patch</strong><p>Enter the access code shown on the computer running Patch.</p><input name="code" inputmode="numeric" autocomplete="one-time-code" autofocus placeholder="6-digit code">${error ? `<p style="color:#ff8a8a">${error}</p>` : ""}<button>Open Patch</button></form>`;

  async function handle(req, res) {
    const url = new URL(req.url, "http://local");
    if (!hostAllowed(req)) return send(res, 421, "Patch only answers on this computer's own address.");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-frame-options", "DENY");
    res.setHeader("permissions-policy", "microphone=(self), camera=(), geolocation=()");

    if (!isLoopback(req)) {
      if (url.pathname === "/login" && req.method === "POST") {
        let raw = "";
        for await (const c of req) raw += c;
        const code = new URLSearchParams(raw).get("code")?.trim() || "";
        const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
        if (code && store.data.lan.accessCode && crypto.timingSafeEqual(digest(code), digest(store.data.lan.accessCode))) {
          const sid = crypto.randomBytes(24).toString("base64url");
          sessions.add(sid);
          res.writeHead(303, { location: "/", "set-cookie": `patch_session=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000` });
          return res.end();
        }
        return send(res, 401, loginPage("That code didn't match."), { "content-type": "text/html; charset=utf-8" });
      }
      if (!sessions.has(cookie(req, "patch_session"))) return send(res, 401, loginPage(), { "content-type": "text/html; charset=utf-8" });
    }

    // A TV app's preview in the dashboard (shown in a sandboxed frame, with its own token).
    const preview = url.pathname.match(/^\/tvapp-preview\/([A-Za-z0-9_-]+)\/(a[0-9a-f]{10})\/(.*)$/);
    if (preview) {
      if (preview[1] !== previewToken || req.method !== "GET") return send(res, 404, "Not found");
      res.removeHeader("x-frame-options");
      return tvapps.serveFile(res, preview[2], decodeURIComponent(preview[3]), {
        "content-security-policy": "default-src 'self' https: http: data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'",
        "x-frame-options": "SAMEORIGIN",
      });
    }

    if (!url.pathname.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
      return serveStatic(req, res, url.pathname);
    }

    const given = req.headers["x-patch-token"] || url.searchParams.get("token");
    if (given !== token) return send(res, 403, { ok: false, message: "Missing or wrong app token. Reload the page." });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, { ok: false, message: "Cross-site request refused." });

    const picture = url.pathname.match(/^\/api\/devices\/([^/]+)\/screen\.png$/);
    if (picture && req.method === "GET") {
      // A picture of a TV's screen: an image, not JSON.
      try {
        return send(res, 200, await controller.picture(decodeURIComponent(picture[1])), { "content-type": "image/png" });
      } catch (err) {
        return send(res, err.status || 502, { ok: false, message: err.message || "The TV didn't give a picture of its screen." });
      }
    }

    if (url.pathname === "/api/uploads" && req.method === "POST") {
      // Raw bytes (an app file, a photo), not JSON.
      try {
        const f = await uploads.save(req, { name: url.searchParams.get("name") || "file" });
        return send(res, 200, { ok: true, upload: { id: f.id, name: f.name, size: f.size } });
      } catch (err) {
        return send(res, err.status || 500, { ok: false, message: err.message || "The file didn't arrive." });
      }
    }

    if (url.pathname === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ devices: inventory.list(), scan: { running: !!scanner.running } })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
      req.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    for (const [method, re, fn] of routes) {
      const m = url.pathname.match(re);
      if (!m || method !== req.method) continue;
      try {
        if (method === "POST" && !/^application\/json/i.test(req.headers["content-type"] || "")) throw new HttpError(415, "Send JSON");
        const body = method === "POST" ? await readBody(req) : null;
        const out = await fn(body, m.slice(1).map(decodeURIComponent), url);
        return send(res, 200, out);
      } catch (err) {
        const status = err.status || 500;
        if (status >= 500) log(`[patch] ${req.method} ${url.pathname} failed: ${err.stack || err.message}`);
        return send(res, status, { ok: false, message: err.message || "Something went wrong." });
      }
    }
    return send(res, 404, { ok: false, message: "No such API route." });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      log(`[patch] request failed: ${err.message}`);
      if (!res.headersSent) send(res, 500, { ok: false, message: "Something went wrong." });
      else res.end();
    });
  });
  let actualPort = port;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
      actualPort = server.address().port;
      resolve();
    });
  });

  // ── background work ──
  const timers = [];
  if (autoScan) {
    setTimeout(() => scanner.scan().catch((e) => log(`[patch] scan failed: ${e.message}`)), 600);
    timers.push(setInterval(() => scanner.scan().catch(() => {}), 20 * 60_000));
  }
  timers.push(
    setInterval(() => {
      if (clients.size && !scanner.running) controller.refreshAll().catch(() => {});
    }, 45_000),
  );

  return {
    port: actualPort,
    url: `http://localhost:${actualPort}/`,
    token,
    store,
    inventory,
    controller,
    scanner,
    lanUrls: lan ? lanAddresses().map((a) => `http://${a}:${actualPort}/`) : [],
    accessCode: lan ? store.data.lan.accessCode : null,
    tvapps,
    uploads,
    async close() {
      timers.forEach(clearInterval);
      await tvapps.close();
      for (const c of clients) c.end();
      await new Promise((r) => server.close(r));
    },
  };
}
