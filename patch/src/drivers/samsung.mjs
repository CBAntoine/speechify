// Samsung smart TVs (Tizen, 2016 onwards). The TV describes itself at http://tv:8001/api/v2/ and
// takes remote-control commands over a WebSocket (wss on port 8002 with a token on 2018+ models,
// ws on 8001 before that). The first connection makes the TV ask "Allow Patch?" on screen.
import { request } from "../net/lanhttp.mjs";
import { wsConnect } from "../net/websocket.mjs";
import { wakeOnLan } from "../net/probe.mjs";
import { youtubeSearchUrl } from "../net/youtube.mjs";
import { fuzzyPick, normalizeMac, normalizeText, safeJson, sleep } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";
import { APPS, knownApp, parseChannel, webSearchUrl, websiteOrSearch, youtubePlay, youtubeSearch } from "./tv.mjs";

const CLIENT_NAME = Buffer.from("Patch").toString("base64");

const KEYS = {
  power: "KEY_POWER", home: "KEY_HOME", back: "KEY_RETURN", return: "KEY_RETURN", exit: "KEY_EXIT", menu: "KEY_MENU", settings: "KEY_MENU",
  up: "KEY_UP", down: "KEY_DOWN", left: "KEY_LEFT", right: "KEY_RIGHT", ok: "KEY_ENTER", select: "KEY_ENTER", enter: "KEY_ENTER",
  play: "KEY_PLAY", pause: "KEY_PAUSE", "play pause": "KEY_PLAY", stop: "KEY_STOP", rewind: "KEY_REWIND", "fast forward": "KEY_FF", forward: "KEY_FF",
  "volume up": "KEY_VOLUP", "volume down": "KEY_VOLDOWN", mute: "KEY_MUTE", "channel up": "KEY_CHUP", "channel down": "KEY_CHDOWN",
  source: "KEY_SOURCE", input: "KEY_SOURCE", guide: "KEY_GUIDE", info: "KEY_INFO", options: "KEY_TOOLS", tools: "KEY_TOOLS",
  "previous channel": "KEY_PRECH", "last channel": "KEY_PRECH", dash: "KEY_PLUS100", red: "KEY_RED", green: "KEY_GREEN", yellow: "KEY_YELLOW", blue: "KEY_CYAN",
};
const INPUT_KEYS = { "hdmi 1": "KEY_HDMI1", hdmi1: "KEY_HDMI1", "hdmi 2": "KEY_HDMI2", hdmi2: "KEY_HDMI2", "hdmi 3": "KEY_HDMI3", hdmi3: "KEY_HDMI3", "hdmi 4": "KEY_HDMI4", hdmi4: "KEY_HDMI4", hdmi: "KEY_HDMI", tv: "KEY_TV", antenna: "KEY_TV", "live tv": "KEY_TV", cable: "KEY_TV" };

/** "[TV] Samsung Q80B Series (65)" → "Samsung Q80B Series (65)" */
const cleanName = (n) => String(n || "").replace(/^\[TV\]\s*/i, "").trim();

/** Screen size and series from a Samsung model code: QN65Q80BAFXZA → { size: 65, series: "Q80B" }. */
export function samsungModel(code, name = "") {
  const m = String(code || "").match(/^(?:QN|UN|QA|UA|QE|UE|GQ|GU|KQ|KU|HG|LS|LH)(\d{2,3})([A-Z]{1,2}\d{4}|[A-Z]{1,2}\d{2,3}[A-Z]?|LS\d{2}[A-Z]?)/i);
  const size = m ? Number(m[1]) : Number(String(name).match(/\((\d{2,3})\)\s*$/)?.[1]) || null;
  const series = m ? m[2].toUpperCase() : String(name).match(/\b([A-Z]{1,2}\d{2,3}[A-Z]?)\s+Series\b/)?.[1] || null;
  return { size, series };
}

async function info(ip) {
  const res = await request({ url: `http://${ip}:8001/api/v2/`, timeout: 2500 });
  if (res.status !== 200) return null;
  const j = safeJson(res.text());
  return j?.device ? j : null;
}

// One live connection per TV, closed after a minute of quiet.
const conns = new Map();

function closeLater(id) {
  const c = conns.get(id);
  if (!c) return;
  clearTimeout(c.timer);
  c.timer = setTimeout(() => {
    c.ws.close();
    conns.delete(id);
  }, 60_000);
  c.timer.unref?.();
}

async function connect(device, ctx, { pairing = false } = {}) {
  const existing = conns.get(device.id);
  if (existing?.ws.open) {
    closeLater(device.id);
    return existing.ws;
  }
  const saved = ctx.secrets.pairings?.[device.id] || {};
  if (!saved.paired && !pairing) throw new DeviceError(`${device.name} hasn't been connected to Patch yet. Press Pair, then choose Allow on the TV.`, { code: "ESETUP" });
  const { ip, tokenAuth } = device.ref;
  const urls = tokenAuth
    ? [`wss://${ip}:8002/api/v2/channels/samsung.remote.control?name=${CLIENT_NAME}${saved.token ? `&token=${encodeURIComponent(saved.token)}` : ""}`]
    : [`ws://${ip}:8001/api/v2/channels/samsung.remote.control?name=${CLIENT_NAME}`, `wss://${ip}:8002/api/v2/channels/samsung.remote.control?name=${CLIENT_NAME}`];
  let lastErr = null;
  for (const url of urls) {
    let ws;
    try {
      ws = await wsConnect(url, { timeout: 4000 });
    } catch (err) {
      lastErr = err;
      continue;
    }
    // The TV only says "connected" once the person has allowed Patch (first time) or straight away.
    const first = await ws.waitFor((m) => /^ms\.channel\.(connect|unauthorized|timeOut)$/.test(m?.event || ""), pairing ? 40_000 : 8000).catch((err) => err);
    if (first instanceof Error || first.event !== "ms.channel.connect") {
      ws.close();
      if (first instanceof Error && first.code === "ETIMEDOUT")
        throw new DeviceError(pairing ? `Nobody answered the question on ${device.name}'s screen. Press Pair again and choose Allow on the TV.` : `${device.name} didn't answer.`, { code: pairing ? "ESETUP" : "EOFFLINE" });
      if (saved.paired && !pairing) await ctx.forgetSecret(["pairings", device.id]);
      throw new DeviceError(`${device.name} said no to Patch. Press Pair and choose Allow on the TV. (If it never asks, check Settings → General → External Device Manager → Device Connection Manager on the TV.)`, { code: "ESETUP" });
    }
    const token = first.data?.token;
    if (!saved.paired || (token && token !== saved.token)) await ctx.saveSecret(["pairings", device.id], { ...saved, paired: true, ...(token ? { token: String(token) } : {}) });
    conns.set(device.id, { ws, timer: null });
    ws.on("close", () => conns.get(device.id)?.ws === ws && conns.delete(device.id));
    closeLater(device.id);
    return ws;
  }
  throw lastErr || new DeviceError(`Couldn't reach ${device.name}.`, { code: "EOFFLINE" });
}

const keyMsg = (key) => ({ method: "ms.remote.control", params: { Cmd: "Click", DataOfCmd: key, Option: "false", TypeOfRemote: "SendRemoteKey" } });

async function keys(ws, list, gap = 350) {
  for (let i = 0; i < list.length; i++) {
    ws.send(keyMsg(list[i]));
    if (i < list.length - 1) await sleep(gap);
  }
}

async function installedApps(ws) {
  ws.send({ method: "ms.channel.emit", params: { event: "ed.installedApp.get", to: "host" } });
  const r = await ws.waitFor((m) => m?.event === "ed.installedApp.get", 4000).catch(() => null);
  return (r?.data?.data || []).map((a) => ({ id: String(a.appId), name: a.name, type: a.app_type }));
}

async function launch(ws, device, appId, { type = "DEEP_LINK", metaTag } = {}) {
  ws.send({ method: "ms.channel.emit", params: { event: "ed.apps.launch", to: "host", data: { appId, action_type: type, ...(metaTag ? { metaTag } : {}) } } });
  const r = await ws.waitFor((m) => m?.event === "ed.apps.launch", 2500).catch(() => null);
  if (r && Number(r.data) >= 400) {
    // Some models only launch through the REST endpoint.
    const res = await request({ url: `http://${device.ref.ip}:8001/api/v2/applications/${encodeURIComponent(appId)}`, method: "POST", body: "", timeout: 3000 }).catch(() => null);
    if (!res || res.status >= 400) throw new DeviceError(`${device.name} couldn't open that app (it may not be installed).`, { code: "ENOTINSTALLED" });
  }
}

/** The appId for a spoken app name: the TV's own list first, then well-known ids. */
async function findApp(ws, device, name) {
  const list = await installedApps(ws);
  const hit = list.length ? fuzzyPick(name, list) : null;
  if (hit) return { id: hit.id, name: hit.name, type: hit.type === 4 ? "NATIVE_LAUNCH" : "DEEP_LINK" };
  const known = knownApp(name);
  if (known?.samsung?.length) return { id: known.samsung[0], name: known.names[0].replace(/\b\w/g, (c) => c.toUpperCase()), type: "DEEP_LINK" };
  throw new DeviceError(`${name} doesn't seem to be installed on ${device.name}.${list.length ? ` It has ${list.slice(0, 8).map((a) => a.name).join(", ")}.` : ""}`, { code: "ENOTINSTALLED" });
}

const YOUTUBE = APPS.find((a) => a.key === "youtube").samsung[0];
const BROWSER = "org.tizen.browser";

function tvState(j) {
  const p = j?.device?.PowerState;
  return { on: p ? p === "on" : true, power: p || null };
}

const FULL = ["turn_on", "turn_off", "volume_up", "volume_down", "mute", "set_channel", "channel_up", "channel_down", "launch_app", "switch_input", "press_button", "type_text", "search_youtube", "play_youtube", "web_search", "open_website", "play", "pause", "rename", "set_room"];

export default {
  id: "samsung",
  label: "Samsung TV",

  async detect(host, ctx) {
    const hinted = host.ports.has(8001) || host.ports.has(8002) || host.ssdp.some((r) => /samsung/i.test(`${r.server} ${r.st} ${r.usn} ${r.desc?.manufacturer || ""}`));
    if (!hinted) return null;
    const j = await info(host.ip).catch(() => null);
    const d = j?.device;
    if (!d || !/tv/i.test(`${d.type} ${j.type}`)) return null;
    const { size, series } = samsungModel(d.modelName, d.name);
    const name = cleanName(d.name || j.name) || "Samsung TV";
    const id = `samsung:${String(d.duid || d.id || d.wifiMac || host.ip).replace(/^uuid:/, "").toLowerCase()}`;
    const paired = !!ctx?.secrets.pairings?.[id]?.paired;
    return [
      {
        id,
        driver: "samsung",
        kind: "tv",
        brand: "Samsung",
        model: [size ? `${size}" ` : "", series ? `${series} ` : "", d.FrameTVSupport === "true" ? "The Frame " : "", "Smart TV"].join("").trim(),
        name,
        ip: host.ip,
        mac: normalizeMac(d.wifiMac) || host.mac,
        ref: { ip: host.ip, tokenAuth: d.TokenAuthSupport === "true", mac: normalizeMac(d.wifiMac) || host.mac, frame: d.FrameTVSupport === "true" },
        state: tvState(j),
        info: { modelNumber: d.modelName || null, os: d.OS ? `${d.OS}${d.firmwareVersion && d.firmwareVersion !== "Unknown" ? ` ${d.firmwareVersion}` : ""}` : "Tizen", resolution: d.resolution || null, network: d.networkType || null, apiVersion: j.version || null },
        // Until the person has allowed Patch on the TV, only pairing and Wake-on-LAN work.
        setup: paired ? null : { kind: "tv-prompt", message: `Press Pair, then choose Allow on ${name}'s screen.` },
        actions: paired ? FULL : ["pair", "turn_on", "rename", "set_room"],
      },
    ];
  },

  async refresh(device) {
    const j = await info(device.ref.ip).catch(() => null);
    if (!j) return { online: false, state: { ...device.state, on: false } };
    return { state: { ...device.state, ...tvState(j) } };
  },

  async act(device, action, value, ctx) {
    try {
      if (action === "pair") {
        await connect(device, ctx, { pairing: true });
        return done(`${device.name} is connected. You can control it now.`, { devices: [{ id: device.id, setup: null, actions: FULL }] });
      }
      if (action === "turn_on") {
        const j = await info(device.ref.ip).catch(() => null);
        if (j && tvState(j).on) return done(`${device.name} is already on.`, { state: { ...device.state, on: true } });
        if (j && ctx.secrets.pairings?.[device.id]?.paired) {
          // Network standby: the TV still listens, so the power key wakes it.
          await keys(await connect(device, ctx), ["KEY_POWER"]);
        }
        const mac = normalizeMac(device.ref.mac || device.mac);
        if (!mac && !j) throw new DeviceError(`I don't know ${device.name}'s network address, so I can't wake it.`);
        if (mac) await wakeOnLan(mac, { broadcasts: [ctx.network?.broadcast, "255.255.255.255"].filter(Boolean), ip: device.ref.ip });
        return done(`Turning ${device.name} on. If it stays off, turn on "Power On with Mobile" in the TV's network settings.`, { state: { ...device.state, on: true } });
      }
      const ws = await connect(device, ctx);
      switch (action) {
        case "turn_off": {
          const j = await info(device.ref.ip).catch(() => null);
          if (j && !tvState(j).on) return done(`${device.name} is already off.`, { state: { ...device.state, on: false } });
          await keys(ws, ["KEY_POWER"]);
          return done(`${device.name} is off.`, { state: { ...device.state, on: false } });
        }
        case "volume_up":
        case "volume_down": {
          const times = Math.min(Math.max(Number(value) || 3, 1), 20);
          await keys(ws, Array(times).fill(action === "volume_up" ? "KEY_VOLUP" : "KEY_VOLDOWN"), 180);
          return done(`Turned ${device.name} ${action === "volume_up" ? "up" : "down"} ${times} steps.`);
        }
        case "mute":
          await keys(ws, ["KEY_MUTE"]);
          return done(`Toggled mute on ${device.name}.`);
        case "play":
        case "pause":
          await keys(ws, [action === "play" ? "KEY_PLAY" : "KEY_PAUSE"]);
          return done(action === "play" ? "Playing." : "Paused.");
        case "channel_up":
        case "channel_down":
          await keys(ws, [action === "channel_up" ? "KEY_CHUP" : "KEY_CHDOWN"]);
          return done(`Channel ${action === "channel_up" ? "up" : "down"} on ${device.name}.`);
        case "set_channel": {
          const ch = parseChannel(value);
          if (ch.dir) {
            await keys(ws, [ch.dir === "up" ? "KEY_CHUP" : "KEY_CHDOWN"]);
            return done(`Channel ${ch.dir} on ${device.name}.`);
          }
          if (ch.name) throw new DeviceError(`On a Samsung TV I can change channels by number (like 7 or 7.1). Which number is ${ch.name}?`, { code: "EVALUE" });
          const seq = [...String(ch.major)].map((c) => `KEY_${c}`);
          if (ch.minor != null) seq.push("KEY_PLUS100", ...[...String(ch.minor)].map((c) => `KEY_${c}`));
          await keys(ws, [...seq, "KEY_ENTER"], 400);
          return done(`Changed ${device.name} to channel ${ch.number}. (This works on the TV's own tuner; with a cable box, change the channel on the box.)`, { state: { ...device.state, channel: ch.number } });
        }
        case "switch_input": {
          const k = normalizeText(need(value, "input"));
          const key = INPUT_KEYS[k] || INPUT_KEYS[k.replace(/ /g, "")];
          if (!key) throw new DeviceError("Which input? HDMI 1 to 4, or TV.", { code: "EVALUE" });
          await keys(ws, [key]);
          return done(`Switched ${device.name} to ${value}.`);
        }
        case "press_button": {
          const k = normalizeText(need(value, "button")).replace(/\b\d+ times?\b/g, "").trim();
          const digit = k.match(/^\d$/)?.[0];
          const key = digit != null ? `KEY_${digit}` : Object.hasOwn(KEYS, k) ? KEYS[k] : null;
          if (!key) throw new DeviceError(`I don't know the button "${value}". Try home, back, up, down, left, right, ok, play, pause, source or guide.`, { code: "EVALUE" });
          const times = Math.min(Math.max(parseInt(String(value).match(/\b(\d+) times?\b/)?.[1] || "1", 10), 1), 10);
          await keys(ws, Array(times).fill(key), 250);
          return done(`Pressed ${value}.`);
        }
        case "launch_app": {
          const app = await findApp(ws, device, need(value, "app"));
          await launch(ws, device, app.id, { type: app.type });
          return done(`Opening ${app.name} on ${device.name}.`, { state: { ...device.state, on: true, app: app.name } });
        }
        case "type_text": {
          const text = String(need(value, "text"));
          ws.send({ method: "ms.remote.control", params: { Cmd: Buffer.from(text, "utf8").toString("base64"), DataOfCmd: "base64", TypeOfRemote: "SendInputString" } });
          await sleep(150);
          ws.send({ method: "ms.remote.control", params: { TypeOfRemote: "SendInputEnd" } });
          return done(`Typed “${text}” on ${device.name}. (It goes into whatever text box is open on the TV.)`);
        }
        case "web_search":
        case "open_website": {
          const url = action === "web_search" ? webSearchUrl(need(value, "search")) : websiteOrSearch(value);
          await launch(ws, device, BROWSER, { type: "NATIVE_LAUNCH", metaTag: url });
          return done(action === "web_search" ? `Searching the web for “${value}” in ${device.name}'s browser.` : `Opening ${url.replace(/^https:\/\//, "").replace(/\/$/, "")} in ${device.name}'s browser.`, { state: { ...device.state, on: true, app: "Internet" } });
        }
        case "search_youtube":
          return await youtubeSearch(device, value, ctx, {
            browserSearch: async (q) => {
              await launch(ws, device, BROWSER, { type: "NATIVE_LAUNCH", metaTag: youtubeSearchUrl(q) });
              return "in the TV's web browser";
            },
            openYouTube: () => launch(ws, device, YOUTUBE),
          });
        case "play_youtube":
          return await youtubePlay(device, value, ctx, {
            playVideo: (id) => launch(ws, device, YOUTUBE, { type: "DEEP_LINK", metaTag: `v=${id}` }),
            browserSearch: async (q) => {
              await launch(ws, device, BROWSER, { type: "NATIVE_LAUNCH", metaTag: youtubeSearchUrl(q) });
              return "in the TV's web browser";
            },
          });
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
