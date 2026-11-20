// LG smart TVs (webOS). Commands go over a WebSocket ("SSAP": wss on port 3001, ws on 3000 on older
// TVs). The first connection makes the TV ask whether to allow Patch; after that it hands over a
// client key that Patch keeps. Remote buttons use a second "pointer input" socket.
import { readFileSync } from "node:fs";
import { wsConnect } from "../net/websocket.mjs";
import { wakeOnLan } from "../net/probe.mjs";
import { youtubeSearchUrl, watchUrl } from "../net/youtube.mjs";
import { clamp, fuzzyPick, normalizeMac, normalizeText, parsePercent, sleep } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";
import { knownApp, parseChannel, webSearchUrl, websiteOrSearch, youtubePlay, youtubeSearch } from "./tv.mjs";

const PAIRING = JSON.parse(readFileSync(new URL("./lg-pairing.json", import.meta.url), "utf8"));
delete PAIRING._source;

/** Newer firmware rejects the signed manifest ("blacklisted certificate"); the unsigned form still works. */
function unsignedPairing() {
  const p = structuredClone(PAIRING);
  delete p.manifest.signed;
  p.manifest.appVersion = "1.0";
  p.manifest.permissions.push("CONTROL_INPUT_TEXT", "CONTROL_MOUSE_AND_KEYBOARD");
  return p;
}

const BUTTONS = {
  home: "HOME", back: "BACK", exit: "EXIT", menu: "MENU", settings: "MENU", up: "UP", down: "DOWN", left: "LEFT", right: "RIGHT",
  ok: "ENTER", select: "ENTER", enter: "ENTER", play: "PLAY", pause: "PAUSE", stop: "STOP", rewind: "REWIND", "fast forward": "FASTFORWARD",
  forward: "FASTFORWARD", "volume up": "VOLUMEUP", "volume down": "VOLUMEDOWN", mute: "MUTE", "channel up": "CHANNELUP", "channel down": "CHANNELDOWN",
  info: "INFO", dash: "DASH", red: "RED", green: "GREEN", yellow: "YELLOW", blue: "BLUE", guide: "GUIDE", captions: "CC", subtitles: "CC",
};

/** "[LG] webOS TV OLED55C1PUB" → { model: "OLED55C1PUB", size: 55, series: "C1", oled: true }; also "50NANO75UPA", "43UQ7570PUD". */
export function lgModel(text) {
  const code = String(text || "").match(/\b(OLED\d{2,3}[A-Z0-9]{2,10}|\d{2,3}(?:NANO|QNED|UQ|UR|UP|UN|UM|UK|UJ|UT|US|SK|SM|LM|LK)[A-Z0-9]{2,10})\b/)?.[1] || null;
  if (!code) return { model: null, size: null, series: null, oled: false };
  let m = code.match(/^OLED(\d{2,3})([A-Z]\d|[A-Z]{2})/);
  if (m) return { model: code, size: Number(m[1]), series: m[2], oled: true };
  m = code.match(/^(\d{2,3})(NANO\d{2}|QNED\d{2}|[A-Z]{2}\d{2,4})/);
  return { model: code, size: m ? Number(m[1]) : null, series: m?.[2] || null, oled: false };
}

class Session {
  constructor(ws) {
    this.ws = ws;
    this.n = 0;
    this.pointer = null;
  }

  /** One SSAP request; resolves with the payload or throws the TV's error. */
  async request(uri, payload = {}, timeout = 6000) {
    const id = `req_${++this.n}`;
    this.ws.send({ id, type: "request", uri, payload });
    const r = await this.ws.waitFor((m) => m?.id === id, timeout);
    if (r.type === "error" || r.payload?.returnValue === false) {
      const msg = r.error || r.payload?.errorText || "request failed";
      throw Object.assign(new Error(msg), { code: /401|403/.test(msg) ? "EDENIED" : "ESSAP" });
    }
    return r.payload || {};
  }

  async button(name) {
    if (!this.pointer?.open) {
      const { socketPath } = await this.request("ssap://com.webos.service.networkinput/getPointerInputSocket");
      if (!socketPath) throw new DeviceError("The TV didn't open its remote-button channel.");
      this.pointer = await wsConnect(socketPath, { timeout: 4000 });
    }
    this.pointer.send(`type:button\nname:${name}\n\n`);
  }

  close() {
    this.pointer?.close();
    this.ws.close();
  }
}

const sessions = new Map();

function closeLater(id) {
  const s = sessions.get(id);
  if (!s) return;
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.session.close();
    sessions.delete(id);
  }, 60_000);
  s.timer.unref?.();
}

async function register(ws, pairing, key, timeout) {
  ws.send({ type: "register", id: "register_0", payload: { ...pairing, ...(key ? { "client-key": key } : {}) } });
  // "response" means the TV is showing its question; "registered" means we're in.
  return ws.waitFor((m) => m?.id === "register_0" && (m.type === "registered" || m.type === "error"), timeout);
}

async function connect(device, ctx, { pairing = false } = {}) {
  const live = sessions.get(device.id);
  if (live?.session.ws.open) {
    closeLater(device.id);
    return live.session;
  }
  const saved = ctx.secrets.pairings?.[device.id] || {};
  if (!saved.clientKey && !pairing) throw new DeviceError(`${device.name} hasn't been connected to Patch yet. Press Pair, then choose Accept on the TV.`, { code: "ESETUP" });
  const { ip } = device.ref;
  let ws = null;
  let lastErr = null;
  for (const url of device.ref.url ? [device.ref.url] : [`wss://${ip}:3001`, `ws://${ip}:3000`]) {
    try {
      ws = await wsConnect(url, { timeout: 4000 });
      if (!device.ref.url) device.ref.url = url;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!ws) throw lastErr || new DeviceError(`Couldn't reach ${device.name}.`, { code: "EOFFLINE" });
  const wait = pairing ? 45_000 : 8000;
  let r = await register(ws, PAIRING, saved.clientKey, wait).catch((e) => e);
  if (!(r instanceof Error) && r.type === "error" && /blacklisted/i.test(r.error || "")) r = await register(ws, unsignedPairing(), saved.clientKey, wait).catch((e) => e);
  if (r instanceof Error || r.type !== "registered" || !r.payload?.["client-key"]) {
    ws.close();
    if (r instanceof Error && r.code === "ETIMEDOUT")
      throw new DeviceError(pairing ? `Nobody accepted Patch on ${device.name}'s screen. Press Pair again and choose Accept on the TV.` : `${device.name} didn't answer.`, { code: pairing ? "ESETUP" : "EOFFLINE" });
    if (saved.clientKey) await ctx.forgetSecret(["pairings", device.id]);
    throw new DeviceError(`${device.name} didn't allow Patch. Press Pair and choose Accept on the TV.`, { code: "ESETUP" });
  }
  const key = r.payload["client-key"];
  if (key !== saved.clientKey) await ctx.saveSecret(["pairings", device.id], { ...saved, clientKey: key, paired: true });
  const session = new Session(ws);
  sessions.set(device.id, { session, timer: null });
  ws.on("close", () => sessions.get(device.id)?.session === session && sessions.delete(device.id));
  closeLater(device.id);
  return session;
}

async function launchPoints(s) {
  const r = await s.request("ssap://com.webos.applicationManager/listLaunchPoints");
  return (r.launchPoints || []).map((p) => ({ id: p.id, name: p.title }));
}

const POWER = { Active: true, "Active Standby": false, "Screen Off": true, "Screen Saver": true, Suspend: false, "Power Off": false };

async function liveState(s, device) {
  const [fg, vol, power, ch] = await Promise.all([
    s.request("ssap://com.webos.applicationManager/getForegroundAppInfo").catch(() => null),
    s.request("ssap://audio/getVolume").catch(() => null),
    s.request("ssap://com.webos.service.tvpower/power/getPowerState").catch(() => null),
    s.request("ssap://tv/getCurrentChannel").catch(() => null),
  ]);
  const st = { ...device.state, on: power?.state ? POWER[power.state] ?? true : true, power: power?.state || null };
  if (fg?.appId) {
    const names = device.ref.appNames || {};
    st.app = names[fg.appId] || (fg.appId === "com.webos.app.livetv" ? "Live TV" : fg.appId);
  }
  const v = vol?.volumeStatus ? { volume: vol.volumeStatus.volume, muted: vol.volumeStatus.muteStatus } : vol;
  if (typeof v?.volume === "number" && v.volume >= 0) st.volume = v.volume;
  if (typeof v?.muted === "boolean") st.muted = v.muted;
  if (ch?.channelNumber && fg?.appId === "com.webos.app.livetv") st.channel = `${ch.channelNumber}${ch.channelName ? ` ${ch.channelName}` : ""}`;
  return st;
}

const FULL = ["turn_on", "turn_off", "set_volume", "volume_up", "volume_down", "mute", "unmute", "set_channel", "channel_up", "channel_down", "launch_app", "switch_input", "press_button", "type_text", "search_youtube", "play_youtube", "web_search", "open_website", "play", "pause", "stop", "rename", "set_room"];

export default {
  id: "lgwebos",
  label: "LG TV",

  async detect(host, ctx) {
    const lg = host.ssdp.find((r) => /lge-com|webos/i.test(`${r.st} ${r.usn} ${r.server}`) || /^LG Electronics/i.test(r.desc?.manufacturer || ""));
    const ports = host.ports.has(3000) || host.ports.has(3001);
    if (!lg && !(ports && /^LG/i.test(host.vendor || ""))) return null;
    if (lg && !ports && !/webos|lge-com/i.test(`${lg.st} ${lg.usn} ${lg.server}`)) return null;
    const desc = host.ssdp.map((r) => r.desc).find((d) => d && /LG/i.test(`${d.manufacturer} ${d.friendlyName}`)) || null;
    const friendly = desc?.friendlyName || "";
    const parsed = lgModel(`${friendly} ${desc?.modelName || ""} ${desc?.modelNumber || ""}`);
    const name = friendly.replace(/^\[LG\]\s*/i, "").replace(/^webOS TV\s+[A-Z0-9]+$/i, "LG TV").trim() || "LG TV";
    const id = `lgwebos:${String(desc?.udn || lg?.usn?.match(/uuid:[^:]+/)?.[0] || host.mac || host.ip).replace(/^uuid:/, "").toLowerCase()}`;
    const paired = !!ctx?.secrets.pairings?.[id]?.clientKey;
    return [
      {
        id,
        driver: "lgwebos",
        kind: "tv",
        brand: "LG",
        model: [parsed.size ? `${parsed.size}" ` : "", parsed.oled ? "OLED " : "", parsed.series ? `${parsed.series} ` : "", "webOS TV"].join("").trim(),
        name,
        ip: host.ip,
        ref: { ip: host.ip, mac: host.mac },
        state: {},
        info: { modelNumber: parsed.model, os: "webOS" },
        setup: paired ? null : { kind: "tv-prompt", message: `Press Pair, then choose Accept on ${name}'s screen.` },
        actions: paired ? FULL : ["pair", "turn_on", "rename", "set_room"],
      },
    ];
  },

  async refresh(device, ctx) {
    const s = await connect(device, ctx);
    return { state: await liveState(s, device) };
  },

  async act(device, action, value, ctx) {
    try {
      if (action === "pair") {
        const s = await connect(device, ctx, { pairing: true });
        const sys = await s.request("ssap://system/getSystemInfo").catch(() => ({}));
        const sw = await s.request("ssap://com.webos.service.update/getCurrentSWInformation").catch(() => ({}));
        const parsed = lgModel(sys.modelName || "");
        const info = { ...device.info, ...(sys.modelName ? { modelNumber: sys.modelName } : {}), ...(sw.product_name ? { os: `${sw.product_name}${sw.major_ver ? ` (${sw.major_ver}.${sw.minor_ver})` : ""}` } : {}) };
        return done(`${device.name} is connected. You can control it now.`, {
          devices: [{ id: device.id, setup: null, actions: FULL, info, ...(parsed.size ? { model: [`${parsed.size}"`, parsed.oled ? "OLED" : "", parsed.series, "webOS TV"].filter(Boolean).join(" ") } : {}) }],
        });
      }
      if (action === "turn_on") {
        const live = sessions.get(device.id)?.session;
        if (live?.ws.open) {
          const p = await live.request("ssap://com.webos.service.tvpower/power/getPowerState").catch(() => null);
          if (p?.state === "Screen Off") {
            await live.request("ssap://com.webos.service.tvpower/power/turnOnScreen");
            return done(`${device.name}'s screen is back on.`, { state: { ...device.state, on: true } });
          }
          if (p?.state === "Active") return done(`${device.name} is already on.`, { state: { ...device.state, on: true } });
        }
        const mac = normalizeMac(device.ref.mac || device.mac);
        if (!mac) throw new DeviceError(`I don't know ${device.name}'s network address, so I can't wake it.`);
        await wakeOnLan(mac, { broadcasts: [ctx.network?.broadcast, "255.255.255.255"].filter(Boolean), ip: device.ref.ip });
        return done(`Turning ${device.name} on. If it stays off, turn on "Turn on via Wi-Fi" (or "Mobile TV On") in the TV's settings.`, { state: { ...device.state, on: true } });
      }
      const s = await connect(device, ctx);
      switch (action) {
        case "turn_off":
          await s.request("ssap://system/turnOff");
          sessions.get(device.id)?.session.close();
          sessions.delete(device.id);
          return done(`${device.name} is off.`, { state: { ...device.state, on: false } });
        case "set_volume": {
          const v = parsePercent(need(value, "volume"), device.state?.volume);
          if (v == null) throw new DeviceError(`I didn't catch the volume "${value}".`, { code: "EVALUE" });
          await s.request("ssap://audio/setVolume", { volume: clamp(v, 0, 100) });
          return done(`${device.name} volume is ${v}.`, { state: { ...device.state, volume: v } });
        }
        case "volume_up":
        case "volume_down": {
          const times = Math.min(Math.max(Number(value) || 3, 1), 20);
          for (let i = 0; i < times; i++) await s.request(`ssap://audio/${action === "volume_up" ? "volumeUp" : "volumeDown"}`);
          return done(`Turned ${device.name} ${action === "volume_up" ? "up" : "down"} ${times} steps.`);
        }
        case "mute":
        case "unmute":
          await s.request("ssap://audio/setMute", { mute: action === "mute" });
          return done(`${device.name} is ${action === "mute" ? "muted" : "unmuted"}.`, { state: { ...device.state, muted: action === "mute" } });
        case "play":
        case "pause":
        case "stop":
          await s.request(`ssap://media.controls/${action}`);
          return done(action === "play" ? "Playing." : action === "pause" ? "Paused." : "Stopped.");
        case "channel_up":
        case "channel_down":
          await s.request(`ssap://tv/${action === "channel_up" ? "channelUp" : "channelDown"}`);
          return done(`Channel ${action === "channel_up" ? "up" : "down"} on ${device.name}.`);
        case "set_channel": {
          const ch = parseChannel(value);
          if (ch.dir) {
            await s.request(`ssap://tv/${ch.dir === "up" ? "channelUp" : "channelDown"}`);
            return done(`Channel ${ch.dir} on ${device.name}.`);
          }
          if (ch.name) {
            // Only list channels when asked by name: on TVs with no tuned channels this call can drop the connection.
            const list = (await s.request("ssap://tv/getChannelList", {}, 8000)).channelList || [];
            const hit = fuzzyPick(ch.name, list, (c) => c.channelName || "");
            if (!hit) throw new DeviceError(`I couldn't find a channel called ${ch.name} on ${device.name}.`, { code: "ENOTFOUND" });
            await s.request("ssap://tv/openChannel", { channelId: hit.channelId });
            return done(`${device.name} is on ${hit.channelName} (${hit.channelNumber}).`, { state: { ...device.state, channel: `${hit.channelNumber} ${hit.channelName}`, app: "Live TV" } });
          }
          const number = ch.minor != null ? `${ch.major}-${ch.minor}` : String(ch.major);
          await s.request("ssap://tv/openChannel", { channelNumber: number });
          return done(`${device.name} is on channel ${ch.number}.`, { state: { ...device.state, channel: ch.number, app: "Live TV" } });
        }
        case "switch_input": {
          const list = (await s.request("ssap://tv/getExternalInputList")).devices || [];
          const want = normalizeText(need(value, "input")).replace(/hdmi (\d)/, "hdmi$1");
          const hit = list.find((d) => normalizeText(d.id).replace(/ /g, "") === want.replace(/ /g, "")) || fuzzyPick(value, list, (d) => d.label || d.id);
          if (!hit) throw new DeviceError(`Which input? ${list.map((d) => d.label || d.id).join(", ")}.`, { code: "EVALUE" });
          await s.request("ssap://tv/switchInput", { inputId: hit.id });
          return done(`Switched ${device.name} to ${hit.label || hit.id}.`);
        }
        case "press_button": {
          const k = normalizeText(need(value, "button")).replace(/\b\d+ times?\b/g, "").trim();
          const name = /^\d$/.test(k) ? k : Object.hasOwn(BUTTONS, k) ? BUTTONS[k] : null;
          if (!name) throw new DeviceError(`I don't know the button "${value}". Try home, back, up, down, left, right, ok, play or pause.`, { code: "EVALUE" });
          const times = Math.min(Math.max(parseInt(String(value).match(/\b(\d+) times?\b/)?.[1] || "1", 10), 1), 10);
          for (let i = 0; i < times; i++) {
            await s.button(name);
            await sleep(200);
          }
          return done(`Pressed ${value}.`);
        }
        case "launch_app": {
          const list = await launchPoints(s);
          device.ref.appNames = Object.fromEntries(list.map((a) => [a.id, a.name]));
          const want = need(value, "app");
          const known = knownApp(want);
          const hit = list.find((a) => known?.lg?.includes(a.id)) || fuzzyPick(want, list);
          if (!hit) throw new DeviceError(`${want} isn't installed on ${device.name}. It has ${list.slice(0, 8).map((a) => a.name).join(", ")}.`, { code: "ENOTINSTALLED" });
          await s.request("ssap://system.launcher/launch", { id: hit.id });
          return done(`Opening ${hit.name} on ${device.name}.`, { state: { ...device.state, on: true, app: hit.name } });
        }
        case "type_text": {
          const text = String(need(value, "text"));
          await s.request("ssap://com.webos.service.ime/insertText", { text, replace: 0 });
          await s.request("ssap://com.webos.service.ime/sendEnterKey").catch(() => null);
          return done(`Typed “${text}” on ${device.name}.`);
        }
        case "web_search":
        case "open_website": {
          const url = action === "web_search" ? webSearchUrl(need(value, "search")) : websiteOrSearch(value);
          await s.request("ssap://system.launcher/open", { target: url });
          return done(action === "web_search" ? `Searching the web for “${value}” in ${device.name}'s browser.` : `Opening ${url.replace(/^https:\/\//, "").replace(/\/$/, "")} in ${device.name}'s browser.`, { state: { ...device.state, on: true, app: "Web Browser" } });
        }
        case "search_youtube":
          return await youtubeSearch(device, value, ctx, {
            browserSearch: async (q) => {
              await s.request("ssap://system.launcher/open", { target: youtubeSearchUrl(q) });
              return "in the TV's web browser";
            },
            openYouTube: () => s.request("ssap://system.launcher/launch", { id: "youtube.leanback.v4" }),
          });
        case "play_youtube":
          return await youtubePlay(device, value, ctx, {
            playVideo: (id) => s.request("ssap://com.webos.applicationManager/launch", { id: "youtube.leanback.v4", params: { contentTarget: watchUrl(id) } }),
            browserSearch: async (q) => {
              await s.request("ssap://system.launcher/open", { target: youtubeSearchUrl(q) });
              return "in the TV's web browser";
            },
          });
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      if (err.code === "EDENIED") {
        await ctx.forgetSecret(["pairings", device.id]);
        throw new DeviceError(`${device.name} no longer accepts Patch. Press Pair and choose Accept on the TV.`, { code: "ESETUP" });
      }
      throw explainError(err, device.name);
    }
  },
};
