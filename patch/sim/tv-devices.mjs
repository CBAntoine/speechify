// Simulated TVs and other identifiable devices for demo mode and tests: a Samsung TV (REST + secure
// WebSocket remote with "Allow?" pairing), an LG webOS TV (SSAP over WebSocket with client keys and
// a pointer socket), a Fire TV (ADB with real RSA authentication), a PlayStation 5 (DDP), a Spotify
// Connect speaker, a WS-Discovery (ONVIF) camera and the YouTube Data API.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dgram from "node:dgram";
import crypto from "node:crypto";
import { acceptUpgrade } from "../src/net/websocket.mjs";
import { AUTH, CMD, MessageParser, SHA1_PREFIX, encodeMessage, parseAndroidPublicKey } from "../src/net/adb.mjs";
import { apkInfo, templateLevel } from "../src/apk/index.mjs";
import { encodePng } from "../src/apk/png.mjs";
import { verifyV2 } from "../src/apk/sign.mjs";
import { entryData, readZip } from "../src/apk/zip.mjs";
import { selfSigned } from "./selfsigned.mjs";
import { httpServer } from "./http-devices.mjs";

const listen = (server, port, ip) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, ip, () => resolve(server));
  });

// ── Samsung (Tizen) ──────────────────────────────────────

export function samsungState() {
  return {
    name: "[TV] Family Room TV",
    power: "on",
    token: null,
    allow: true,
    keys: [],
    launched: [],
    texts: [],
    connects: 0,
    apps: [
      { appId: "111299001912", app_type: 2, name: "YouTube" }, { appId: "3201907018807", app_type: 2, name: "Netflix" },
      { appId: "3201910019365", app_type: 2, name: "Prime Video" }, { appId: "3201901017640", app_type: 2, name: "Disney+" },
      { appId: "org.tizen.browser", app_type: 4, name: "Internet" },
    ],
  };
}

export async function samsungTv(ip, s) {
  const duid = "uuid:7a1c3e55-2b4f-4c1e-9d0a-641cae123456";
  const info = () => ({
    device: { FrameTVSupport: "false", GamePadSupport: "true", OS: "Tizen", PowerState: s.power, TokenAuthSupport: "true", VoiceSupport: "true", countryCode: "US", description: "Samsung DTV RCR", duid, firmwareVersion: "Unknown", id: duid, ip, model: "22_PONTUSM_QTV", modelName: "QN65Q80BAFXZA", name: s.name, networkType: "wireless", resolution: "3840x2160", type: "Samsung SmartTV", udn: duid, wifiMac: "64:1c:ae:12:34:56" },
    id: duid, isSupport: "{}", name: s.name, remote: "1.0", type: "Samsung SmartTV", uri: `http://${ip}:8001/api/v2/`, version: "2.0.25",
  });
  const rest = await httpServer(ip, 8001, async ({ req, url, send }) => {
    if (url.pathname === "/api/v2/" || url.pathname === "/api/v2") return send(200, info());
    const m = url.pathname.match(/^\/api\/v2\/applications\/([^/]+)$/);
    if (m && req.method === "POST") {
      s.launched.push({ appId: decodeURIComponent(m[1]), via: "rest" });
      return send(200, "true", "text/plain");
    }
    if (m && req.method === "PUT") {
      // Installs a known app (a real TV shows its page and installs it).
      s.installing = decodeURIComponent(m[1]);
      return send(200, "true", "text/plain");
    }
    return send(404, { error: "not found" });
  });
  const { cert, key } = selfSigned("SmartViewSDK");
  const secure = https.createServer({ cert, key }, (req, res) => res.writeHead(404).end());
  secure.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `https://${ip}:8002`);
    if (url.pathname !== "/api/v2/channels/samsung.remote.control") return socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    const ws = acceptUpgrade(req, socket, head);
    s.connects++;
    const connected = () => ws.send({ event: "ms.channel.connect", data: { id: crypto.randomUUID(), clients: [{ attributes: { name: url.searchParams.get("name") } }], token: s.token } });
    const given = url.searchParams.get("token");
    if (given && given === s.token) connected();
    else if (!s.allow) setTimeout(() => ws.open && ws.send({ event: "ms.channel.unauthorized" }), 100);
    else
      setTimeout(() => {
        s.token = String(crypto.randomInt(10_000_000, 99_999_999));
        if (ws.open) connected();
      }, 250);
    ws.on("message", (m) => {
      let p;
      try {
        p = JSON.parse(m);
      } catch {
        return;
      }
      if (p.method === "ms.remote.control") {
        const x = p.params || {};
        if (x.TypeOfRemote === "SendRemoteKey") {
          s.keys.push(x.Cmd && x.Cmd !== "Click" ? `${x.Cmd} ${x.DataOfCmd}` : x.DataOfCmd);
          if (x.DataOfCmd === "KEY_POWER") s.power = s.power === "on" ? "standby" : "on";
        } else if (x.TypeOfRemote === "SendInputString") s.texts.push(Buffer.from(x.Cmd, "base64").toString("utf8"));
      } else if (p.method === "ms.channel.emit") {
        const ev = p.params?.event;
        if (ev === "ed.installedApp.get") ws.send({ event: "ed.installedApp.get", from: "host", data: { data: s.apps } });
        if (ev === "ed.apps.launch") {
          const d = p.params.data || {};
          const ok = s.apps.some((a) => a.appId === d.appId);
          if (ok) s.launched.push({ appId: d.appId, type: d.action_type, metaTag: d.metaTag || null });
          ws.send({ event: "ed.apps.launch", from: "host", data: ok ? 200 : 404 });
        }
      }
    });
  });
  await listen(secure, 8002, ip);
  return [rest, secure];
}

// ── LG (webOS) ───────────────────────────────────────────

export function lgState() {
  return {
    power: "Active",
    volume: 14,
    muted: false,
    app: "com.webos.app.livetv",
    channel: { channelId: "1_7_1", channelNumber: "7-1", channelName: "KXYZ" },
    channels: [
      { channelId: "1_4_1", channelNumber: "4-1", channelName: "NBC" }, { channelId: "1_7_1", channelNumber: "7-1", channelName: "KXYZ" },
      { channelId: "1_9_1", channelNumber: "9-1", channelName: "PBS Kids" }, { channelId: "1_11_1", channelNumber: "11-1", channelName: "CBS" },
    ],
    inputs: [{ id: "HDMI_1", label: "Xbox" }, { id: "HDMI_2", label: "HDMI 2" }, { id: "HDMI_3", label: "Soundbar" }],
    launchPoints: [
      { id: "youtube.leanback.v4", title: "YouTube" }, { id: "netflix", title: "Netflix" }, { id: "amazon", title: "Prime Video" },
      { id: "com.webos.app.browser", title: "Web Browser" }, { id: "com.webos.app.livetv", title: "Live TV" }, { id: "spotify-beehive", title: "Spotify" },
      { id: "com.webos.app.discovery", title: "LG Content Store" },
    ],
    clientKey: null,
    accept: true,
    buttons: [],
    opened: [],
    launched: [],
    texts: [],
    calls: [],
  };
}

const LG_DESC = `<?xml version="1.0" encoding="utf-8"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><device><deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType><friendlyName>[LG] webOS TV OLED55C1PUB</friendlyName><manufacturer>LG Electronics</manufacturer><modelName>LG Smart TV</modelName><modelNumber>OLED55C1PUB</modelNumber><UDN>uuid:4c1d7e52-0b3f-4f43-a9e1-44be8b0a1b2c</UDN></device></root>`;

export async function lgTv(ip, s) {
  const desc = await httpServer(ip, 1754, async ({ send }) => send(200, LG_DESC, "text/xml"));
  const server = http.createServer((req, res) => res.writeHead(404).end());
  server.on("upgrade", (req, socket, head) => {
    const ws = acceptUpgrade(req, socket, head);
    if (req.url.startsWith("/resources/")) {
      ws.on("message", (m) => {
        const name = String(m).match(/^name:(\S+)$/m)?.[1];
        if (/^type:button$/m.test(String(m)) && name) s.buttons.push(name);
      });
      return;
    }
    let registered = false;
    ws.on("message", (raw) => {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      const reply = (payload) => ws.send({ type: "response", id: m.id, payload: { returnValue: true, ...payload } });
      const error = (text) => ws.send({ type: "error", id: m.id, error: text, payload: {} });
      if (m.type === "register") {
        const key = m.payload?.["client-key"];
        if (key && key === s.clientKey) {
          registered = true;
          return ws.send({ type: "registered", id: m.id, payload: { "client-key": key } });
        }
        if (!s.accept) return error("403 User Denied Access");
        ws.send({ type: "response", id: m.id, payload: { pairingType: "PROMPT", returnValue: true } });
        setTimeout(() => {
          s.clientKey = crypto.randomBytes(16).toString("hex");
          registered = true;
          if (ws.open) ws.send({ type: "registered", id: m.id, payload: { "client-key": s.clientKey } });
        }, 250);
        return;
      }
      if (m.type !== "request") return;
      if (!registered) return error("401 insufficient permissions (not registered)");
      const uri = String(m.uri || "").replace(/^ssap:\/\//, "");
      const p = m.payload || {};
      s.calls.push(uri);
      switch (uri) {
        case "system/turnOff":
          s.power = "Suspend";
          return reply({});
        case "system/getSystemInfo":
          return reply({ features: { "3d": false, dvr: true }, receiverType: "atsc", modelName: "OLED55C1PUB", programMode: false });
        case "com.webos.service.update/getCurrentSWInformation":
          return reply({ product_name: "webOSTV 6.0", model_name: "HE_DTV_W21O_AFABATAA", major_ver: "03", minor_ver: "34.65", country: "US", device_id: "44:be:8b:0a:1b:2c" });
        case "com.webos.service.tvpower/power/getPowerState":
          return reply({ state: s.power });
        case "com.webos.service.tvpower/power/turnOnScreen":
          s.power = "Active";
          return reply({});
        case "audio/getVolume":
          return reply({ volumeStatus: { volume: s.volume, muteStatus: s.muted, soundOutput: "tv_speaker" }, callerId: "secondscreen.client" });
        case "audio/setVolume":
          s.volume = Number(p.volume);
          return reply({});
        case "audio/volumeUp":
          s.volume = Math.min(100, s.volume + 1);
          return reply({});
        case "audio/volumeDown":
          s.volume = Math.max(0, s.volume - 1);
          return reply({});
        case "audio/setMute":
          s.muted = !!p.mute;
          return reply({});
        case "tv/getChannelList":
          return reply({ channelList: s.channels });
        case "tv/getCurrentChannel":
          return s.app === "com.webos.app.livetv" ? reply({ ...s.channel }) : error("500 Application error");
        case "tv/openChannel": {
          const hit = s.channels.find((c) => (p.channelId && c.channelId === p.channelId) || (p.channelNumber && c.channelNumber === String(p.channelNumber)));
          if (!hit) return error("500 Application error");
          s.channel = hit;
          s.app = "com.webos.app.livetv";
          return reply({});
        }
        case "tv/channelUp":
        case "tv/channelDown": {
          const i = s.channels.indexOf(s.channels.find((c) => c.channelId === s.channel.channelId));
          s.channel = s.channels[(i + (uri.endsWith("Up") ? 1 : s.channels.length - 1)) % s.channels.length];
          return reply({});
        }
        case "tv/getExternalInputList":
          return reply({ devices: s.inputs.map((d) => ({ ...d, connected: true })) });
        case "tv/switchInput":
          s.app = `com.webos.app.${String(p.inputId).toLowerCase().replace("_", "")}`;
          return reply({});
        case "com.webos.applicationManager/listLaunchPoints":
          return reply({ launchPoints: s.launchPoints });
        case "com.webos.applicationManager/getForegroundAppInfo":
          return reply({ appId: s.app, windowId: "", processId: "" });
        case "system.launcher/launch":
        case "com.webos.applicationManager/launch":
          if (!s.launchPoints.some((l) => l.id === p.id)) return error("404 no such app");
          s.app = p.id;
          s.launched.push({ id: p.id, contentId: p.contentId || null, params: p.params || null });
          return reply({ id: p.id, sessionId: crypto.randomBytes(6).toString("hex") });
        case "system.launcher/open":
          s.app = "com.webos.app.browser";
          s.opened.push(p.target);
          return reply({ id: "com.webos.app.browser" });
        case "com.webos.service.ime/insertText":
          s.texts.push(p.text);
          return reply({});
        case "com.webos.service.ime/sendEnterKey":
          return reply({});
        case "media.controls/play":
        case "media.controls/pause":
        case "media.controls/stop":
          return reply({});
        case "com.webos.service.networkinput/getPointerInputSocket":
          return reply({ socketPath: `ws://${ip}:3000/resources/9f8e7d6c5b4a/netinput.pointer.sock` });
        default:
          return error("404 no such service or method");
      }
    });
  });
  await listen(server, 3000, ip);
  return [desc, server];
}

// ── Fire TV (ADB) ────────────────────────────────────────

export function fireTvState() {
  return {
    awake: true,
    focus: "com.amazon.tv.launcher/.ui.HomeActivity_vNext",
    authorized: [], // public keys the person has allowed ("Always allow from this computer")
    accept: true,
    prompts: 0,
    commands: [],
    packages: ["com.amazon.tv.launcher", "com.amazon.firetv.youtube", "com.netflix.ninja", "com.amazon.amazonvideo.livingroom", "com.disney.disneyplus", "com.hulu.livingroomplus", "com.amazon.cloud9", "com.spotify.tv.android", "com.android.settings", "com.amazon.venezia"],
    // Apps that came with it (can't be removed); the rest were installed by the person.
    system: ["com.amazon.tv.launcher", "com.amazon.firetv.youtube", "com.amazon.amazonvideo.livingroom", "com.amazon.cloud9", "com.android.settings", "com.amazon.venezia"],
    files: {}, // pushed over ADB, by path
    installed: {}, // app id → { label, versionCode, cert }
    store: null, // the Appstore page that's open
    taps: [],
    running: [], // apps that have been opened (each has a process)
    // A real browser for Patch's own browser app to show its pages in: { open() } gives a new
    // connection to its debugging port (sim/chrome.mjs). Without one, Patch can't see into pages here.
    browser: null,
    playing: null, // what a streaming app is playing: { app, title, state }
    keys: [], // every button pressed, in order ("hold KEYCODE_HOME" for one held down)
    cursor: 0, // which app on the home screen the remote is on
    refuseKey: null, // a key code this TV's Android won't press (a test's switch)
    ytTakes: ["alexa", "assistant", "results", "search"], // the ways this TV's YouTube app takes a search (a test's switch)
    youtube: null, // the last thing its YouTube app was asked: { asked, query, play }
  };
}

/** The apps on the pretend TV's home screen, in order (rows of eight). */
const fireHomeApps = (s) => s.packages.filter((p) => !["com.amazon.tv.launcher", "com.amazon.venezia", "com.android.settings"].includes(p));
/** The process id an app would have on this pretend TV. */
const firePid = (s, pkg) => 4000 + s.packages.indexOf(pkg);
/** One of Patch's own apps, from a template whose pages are open to Patch. */
const fireWebApp = (s, pkg) => (s.installed[pkg]?.level || 1) >= 2 && s.running.includes(pkg);

/** A picture of the screen (what `screencap -p` gives): the app's colour, with a lighter panel. */
function firePicture(s) {
  const pkg = s.focus.split("/")[0];
  if (s.pictures?.[pkg]) return s.pictures[pkg];
  const w = 1920;
  const h = 1080;
  const hash = [...pkg].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rgb = [40 + (hash % 90), 40 + ((hash >> 8) % 90), 60 + ((hash >> 16) % 120)];
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const panel = x > 160 && x < 1760 && y > 540 && y < 780;
      px.set([rgb[0] + (panel ? 60 : 0), rgb[1] + (panel ? 60 : 0), rgb[2] + (panel ? 60 : 0), 255], (y * w + x) * 4);
    }
  }
  (s.pictures ??= {})[pkg] = encodePng(w, h, px);
  return s.pictures[pkg];
}

const STORE_NAMES = { "com.plexapp.android": "Plex", "org.videolan.vlc": "VLC for Fire" };
const HOME_NAMES = { "com.amazon.firetv.youtube": "YouTube", "com.netflix.ninja": "Netflix", "com.amazon.amazonvideo.livingroom": "Prime Video", "com.disney.disneyplus": "Disney+", "com.hulu.livingroomplus": "Hulu", "com.amazon.cloud9": "Silk Browser", "com.spotify.tv.android": "Spotify", "com.plexapp.android": "Plex" };
const xmlEsc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** What `uiautomator dump` would show: the home screen, an Appstore page, or an app drawing its own picture. */
function fireScreen(s) {
  const pkg = s.focus.split("/")[0];
  const node = (a, kids = "") =>
    `<node index="0" text="${xmlEsc(a.text || "")}" resource-id="" class="${a.cls || "android.widget.TextView"}" package="${pkg}" content-desc="${xmlEsc(a.desc || "")}" checkable="false" checked="false" clickable="${!!a.click}" enabled="true" focusable="${!!a.focus}" focused="${!!a.focused}" scrollable="${!!a.scroll}" long-clickable="false" password="false" selected="false" bounds="${a.b}">${kids}</node>`;
  let body;
  if (pkg === "com.amazon.venezia" && s.store?.pkg) {
    const installed = s.packages.includes(s.store.pkg);
    body = node({ cls: "android.widget.FrameLayout", b: "[0,0][1920,1080]" }, node({ text: STORE_NAMES[s.store.pkg] || s.store.pkg, b: "[120,100][900,180]" }) + node({ text: "Free", b: "[120,200][300,240]" }) + node({ cls: "android.widget.FrameLayout", click: true, focus: true, focused: true, b: "[120,300][420,380]" }, node({ cls: "android.widget.Button", text: installed ? "Open" : "Get", b: "[140,310][400,370]" })) + node({ desc: "More like this", b: "[120,500][1800,1000]", scroll: true }));
  } else if (pkg === "com.amazon.tv.launcher") {
    const apps = fireHomeApps(s);
    const at = (i) => ({ x: 100 + (i % 8) * 220, y: 500 + Math.floor(i / 8) * 140 }); // rows of eight
    body = node({ cls: "android.widget.FrameLayout", b: "[0,0][1920,1080]" }, node({ text: "Home", b: "[100,40][300,90]" }) + apps.map((p, i) => node({ cls: "android.widget.FrameLayout", click: true, focus: true, focused: i === s.cursor, b: `[${at(i).x},${at(i).y}][${at(i).x + 200},${at(i).y + 120}]` }, node({ desc: s.installed[p]?.label || HOME_NAMES[p] || p.split(".").at(-1), cls: "android.widget.ImageView", b: `[${at(i).x + 10},${at(i).y + 10}][${at(i).x + 190},${at(i).y + 110}]` }))).join(""));
  } else {
    body = node({ cls: "android.view.SurfaceView", b: "[0,0][1920,1080]" });
  }
  return `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">${body}</hierarchy>`;
}

function storeGet(s) {
  const pkg = s.store?.pkg;
  if (!pkg || s.packages.includes(pkg)) return;
  setTimeout(() => {
    s.packages.push(pkg);
    s.installed[pkg] = { label: STORE_NAMES[pkg] || pkg, versionCode: 1, cert: "store" };
  }, 300);
}

function fireShell(s, cmd) {
  s.commands.push(cmd);
  if (/getprop ro\.product\.manufacturer/.test(cmd)) return "Amazon|AFTKA|9|Kids Room Fire TV\n";
  if (/^dumpsys power/.test(cmd)) return `  mWakefulness=${s.awake ? "Awake" : "Asleep"}\n`;
  if (/^dumpsys window/.test(cmd)) return `  mCurrentFocus=Window{4a3b2c1 u0 ${s.focus}}\n  mFocusedApp=AppWindowToken{5d4e3f2 token=Token{6e5f4a3 ActivityRecord{7f6a5b4 u0 ${s.focus} t12}}}\n`;
  if (/^pm list packages -3$/.test(cmd)) return s.packages.filter((p) => !s.system.includes(p)).map((p) => `package:${p}`).join("\n") + "\n";
  if (/^pm list packages/.test(cmd)) return s.packages.map((p) => `package:${p}`).join("\n") + "\n";
  if (/^cmd package query-activities/.test(cmd)) return s.packages.filter((p) => p !== "com.amazon.tv.launcher").map((p) => `  ${p}/.MainActivity`).join("\n") + "\n";
  if (/^uiautomator dump/.test(cmd)) return fireScreen(s);
  if (/android\.search\.action\.GLOBAL_SEARCH/.test(cmd)) return "Error: Activity not started, unable to resolve Intent { act=android.search.action.GLOBAL_SEARCH }\n";
  let m = cmd.match(/^pm install -r (\S+)$/);
  if (m) {
    const file = s.files[m[1]];
    if (!file) return "Failure [INSTALL_FAILED_INVALID_URI]\n";
    let info;
    try {
      info = apkInfo(file);
    } catch {
      return "Failure [INSTALL_PARSE_FAILED_NOT_APK: Failed to parse]\n";
    }
    const cert = verifyV2(file).cert || "unsigned";
    const prev = s.installed[info.package];
    if (prev && prev.cert !== cert) return "Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package signatures do not match]\n";
    if (prev && prev.versionCode > info.versionCode) return "Failure [INSTALL_FAILED_VERSION_DOWNGRADE]\n";
    let kind = null;
    try {
      const entry = readZip(file).entries.find((e) => e.name === "assets/app/app.json");
      kind = entry ? JSON.parse(entryData(entry).toString("utf8")).kind || null : null;
    } catch {
      kind = null;
    }
    s.installed[info.package] = { label: info.label, versionCode: info.versionCode, cert, size: file.length, kind, level: templateLevel(file) };
    if (!s.packages.includes(info.package)) s.packages.push(info.package);
    return "Success\n";
  }
  m = cmd.match(/^pm uninstall (\S+)$/);
  if (m) {
    if (!s.packages.includes(m[1]) || s.system.includes(m[1])) return "Failure [DELETE_FAILED_INTERNAL_ERROR]\n";
    s.running = s.running.filter((p) => p !== m[1]);
    s.packages = s.packages.filter((p) => p !== m[1]);
    delete s.installed[m[1]];
    return "Success\n";
  }
  m = cmd.match(/^rm -f (\S+)$/);
  if (m) {
    delete s.files[m[1]];
    return "";
  }
  m = cmd.match(/^input tap (\d+) (\d+)$/);
  if (m) {
    s.taps.push([Number(m[1]), Number(m[2])]);
    if (s.focus.startsWith("com.amazon.venezia/") && Number(m[2]) > 300 && Number(m[2]) < 380) storeGet(s);
    return "";
  }
  m = cmd.match(/^am start -a android\.intent\.action\.VIEW -d '(amzn:\/\/apps\/android\?[^']*)'$/);
  if (m) {
    const u = new URL(m[1]);
    s.focus = "com.amazon.venezia/.details.DetailsActivity";
    s.store = { pkg: u.searchParams.get("p"), search: u.searchParams.get("s") };
    return `Starting: Intent { act=android.intent.action.VIEW dat=${m[1]} }\n`;
  }
  m = cmd.match(/^input keyevent (--longpress )?(KEYCODE_\w+(?: KEYCODE_\w+)*)$/);
  if (m) {
    // (refuseKey "all": a TV whose maker keeps button presses from ADB.)
    if (s.refuseKey === "all") return "java.lang.SecurityException: Injecting to another application requires INJECT_EVENTS permission\n\tat android.os.Parcel.createExceptionOrNull(Parcel.java:3011)\n";
    for (const code of m[2].split(" ")) {
      // (refuseKey: a key this Android doesn't know. It presses the ones before it, then says so.)
      if (code === s.refuseKey) return "Error: Invalid arguments for command: keyevent\nusage: input [<source>] keyevent [--longpress|--doubletap] <key code number or name> ...\n";
      s.keys.push(m[1] ? `hold ${code}` : code);
      const home = s.focus.startsWith("com.amazon.tv.launcher/");
      const apps = fireHomeApps(s);
      if (code === "KEYCODE_DPAD_CENTER" && s.focus.startsWith("com.amazon.venezia/")) storeGet(s);
      else if (code === "KEYCODE_DPAD_CENTER" && home && apps[s.cursor]) {
        // OK on the home screen opens the app the remote is on.
        s.focus = `${apps[s.cursor]}/.MainActivity`;
        if (!s.running.includes(apps[s.cursor])) s.running.push(apps[s.cursor]);
      }
      if (home && /^KEYCODE_DPAD_(LEFT|RIGHT|UP|DOWN)$/.test(code)) {
        const to = s.cursor + { KEYCODE_DPAD_LEFT: -1, KEYCODE_DPAD_RIGHT: 1, KEYCODE_DPAD_UP: -8, KEYCODE_DPAD_DOWN: 8 }[code];
        const sideways = /LEFT|RIGHT/.test(code);
        if (to >= 0 && to < apps.length && (!sideways || Math.floor(to / 8) === Math.floor(s.cursor / 8))) s.cursor = to;
      }
      if (code === "KEYCODE_SLEEP") s.awake = false;
      if (code === "KEYCODE_WAKEUP") s.awake = true;
      if (code === "KEYCODE_HOME") {
        s.focus = "com.amazon.tv.launcher/.ui.HomeActivity_vNext";
        s.cursor = 0;
      }
      if (code === "KEYCODE_BACK" && !home) s.focus = "com.amazon.tv.launcher/.ui.HomeActivity_vNext";
    }
    return "";
  }
  m = cmd.match(/^monkey -p (\S+) -c (\S+) 1$/);
  if (m) {
    if (!s.packages.includes(m[1])) return "** No activities found to run, monkey aborted.\n";
    s.focus = `${m[1]}/.MainActivity`;
    if (!s.running.includes(m[1])) s.running.push(m[1]);
    return "Events injected: 1\n## Network stats: elapsed time=12ms\n";
  }
  // One of Patch's own apps, opened on a page (its browser takes a link).
  m = cmd.match(/^am start -n (\S+)\/app\.patch\.tvapp\.AppActivity -a android\.intent\.action\.VIEW -d '([^']*)'$/);
  if (m) {
    if (!s.packages.includes(m[1])) return `Error type 3\nError: Activity class {${m[1]}/app.patch.tvapp.AppActivity} does not exist.\n`;
    s.focus = `${m[1]}/.MainActivity`;
    if (!s.running.includes(m[1])) s.running.push(m[1]);
    s.lastIntent = { action: "android.intent.action.VIEW", data: m[2], query: null, pkg: m[1] };
    return `Starting: Intent { act=android.intent.action.VIEW dat=${m[2]} cmp=${m[1]}/app.patch.tvapp.AppActivity }\n`;
  }
  m = cmd.match(/^am start -a (\S+)(?: -d '([^']*)')?(?: --es query '([^']*)')?(?: (\S+))?$/);
  if (m) {
    const [, action, data, query, pkg] = m;
    if (pkg && !s.packages.includes(pkg)) return `Error: Activity not started, unable to resolve Intent { act=${action} pkg=${pkg} }\n`;
    if (action === "android.intent.action.SEARCH" && (pkg !== "com.amazon.firetv.youtube" || !s.ytTakes.includes("search"))) return "Error: Activity not started, unable to resolve Intent\n";
    if (pkg === "com.amazon.firetv.youtube" && action === "android.intent.action.VIEW" && data) {
      // A search or "play this" for the YouTube app: Alexa's link, Google Assistant's, or a results page's address.
      const form = /^youtube:\/\/search\?/.test(data) ? "alexa" : /^https:\/\/www\.youtube\.com\/tv\?/.test(data) ? "assistant" : /\/results\?search_query=/.test(data) ? "results" : null;
      if (form && !s.ytTakes.includes(form)) return `Error: Activity not started, unable to resolve Intent { act=${action} dat=${data} pkg=${pkg} }\n`;
      if (form) {
        const u = new URL(data);
        const q = u.searchParams.get("query") || u.searchParams.get("vq") || u.searchParams.get("search_query") || "";
        const play = u.searchParams.get("method") === "play" || u.searchParams.get("va") === "play";
        s.youtube = { asked: form, query: q, play };
        // Asked to play something by name, it picks the closest match and starts it.
        if (play) s.playing = { app: pkg, title: `${q.slice(0, 1).toUpperCase()}${q.slice(1)} (Official Video)`, state: "playing" };
      }
    }
    if (action === "android.intent.action.SEARCH") s.youtube = { asked: "search", query: query || "", play: false };
    const target = pkg || (/^https?:\/\/(www\.)?youtube\.com/.test(data || "") ? "com.amazon.firetv.youtube" : "com.amazon.cloud9");
    s.focus = `${target}/.MainActivity`;
    if (!s.running.includes(target)) s.running.push(target);
    s.lastIntent = { action, data: data || null, query: query || null, pkg: target };
    return `Starting: Intent { act=${action}${data ? ` dat=${data}` : ""} pkg=${target} }\n`;
  }
  // Which process an app is, and the sockets programs on the TV have open (a browser's debugging socket is one).
  m = cmd.match(/^pidof (\S+) 2>\/dev\/null; echo; cat \/proc\/net\/unix 2>\/dev\/null$/);
  if (m) {
    const pid = !s.noPidof && s.running.includes(m[1]) ? `${firePid(s, m[1])}\n` : "";
    const sockets = s.running.filter((p) => s.browser && fireWebApp(s, p)).map((p) => `0000000000000000: 00000002 00000000 00010000 0001 01 ${20000 + firePid(s, p)} @webview_devtools_remote_${firePid(s, p)}`);
    // (noSocketList: a TV that keeps that list to itself.)
    if (s.noSocketList) return `${pid}\n`;
    return `${pid}\nNum       RefCount Protocol Flags    Type St Inode Path\n0000000000000000: 00000002 00000000 00010000 0001 01 11872 /dev/socket/logdw\n${sockets.join("\n")}${sockets.length ? "\n" : ""}`;
  }
  m = cmd.match(/^cat \/proc\/(\d+)\/cmdline 2>\/dev\/null$/);
  if (m) return `${s.running.find((p) => firePid(s, p) === Number(m[1])) || ""}\0`;
  if (/^dumpsys media_session/.test(cmd)) {
    const p = s.playing;
    if (!p) return "MEDIA SESSION SERVICE (dumpsys media_session)\n\n0 sessions listeners.\nGlobal priority session is null\n";
    return `MEDIA SESSION SERVICE (dumpsys media_session)\n\n1 sessions listeners.\nSessions Stack - have 1 sessions:\n  NetflixMediaSession ${p.app}/NetflixMediaSession (userId=0)\n    ownerPid=5120, ownerUid=10089, userId=0\n    package=${p.app}\n    active=true\n    state=PlaybackState {state=${p.state === "paused" ? 2 : 3}, position=754000, buffered position=0, speed=1.0, updated=9871234, actions=823, error=null}\n    metadata: size=4, description=${p.title}, null, null\n`;
  }
  m = cmd.match(/^input text '(.*)'$/);
  if (m) {
    s.lastText = m[1].replace(/%s/g, " ").replace(/'\\''/g, "'");
    return "";
  }
  return `/system/bin/sh: ${cmd.split(" ")[0]}: not found\n`;
}

export async function fireTv(ip, s) {
  // Connections end with the simulator (Patch's ADB client would otherwise keep one open for a minute).
  const open = new Set();
  const server = net.createServer((sock) => {
    open.add(sock);
    const streams = new Map();
    sock.on("close", () => {
      open.delete(sock);
      for (const st of streams.values()) st.tcp?.destroy();
    });
    let token = null;
    let authed = false;
    const send = (c, a0, a1, d) => sock.writable && sock.write(encodeMessage(c, a0, a1, d));
    const banner = "device::ro.product.name=kara;ro.product.model=AFTKA;ro.product.device=kara;features=shell_v2,cmd\0";
    const challenge = () => {
      token = crypto.randomBytes(20);
      send(CMD.AUTH, AUTH.TOKEN, 0, token);
    };
    const parser = new MessageParser((m) => {
      if (m.command === CMD.CNXN) return challenge();
      if (m.command === CMD.AUTH && m.arg0 === AUTH.SIGNATURE) {
        const ok = s.authorized.some((k) => {
          try {
            return crypto.publicDecrypt({ key: k, padding: crypto.constants.RSA_PKCS1_PADDING }, m.data).equals(Buffer.concat([SHA1_PREFIX, token]));
          } catch {
            return false;
          }
        });
        if (ok) {
          authed = true;
          return send(CMD.CNXN, 0x01000001, 256 * 1024, banner);
        }
        return challenge();
      }
      if (m.command === CMD.AUTH && m.arg0 === AUTH.RSAPUBLICKEY) {
        s.prompts++;
        const { key, valid } = parseAndroidPublicKey(m.data.toString("utf8"));
        if (!valid || !s.accept) return;
        setTimeout(() => {
          s.authorized.push(key);
          authed = true;
          send(CMD.CNXN, 0x01000001, 256 * 1024, banner);
        }, 200);
        return;
      }
      if (!authed) return;
      if (m.command === CMD.WRTE && streams.get(m.arg1)?.tcp) {
        const st = streams.get(m.arg1);
        st.tcp.write(m.data);
        send(CMD.OKAY, m.arg1, st.remote);
        return;
      }
      if (m.command === CMD.WRTE && streams.has(m.arg1)) {
        // ADB "sync": SEND path,mode → DATA… → DONE (answered OKAY) → QUIT.
        const st = streams.get(m.arg1);
        if (st.pump) return;
        send(CMD.OKAY, m.arg1, st.remote);
        st.buf = Buffer.concat([st.buf, m.data]);
        while (st.buf.length >= 8) {
          const id = st.buf.toString("latin1", 0, 4);
          const n = st.buf.readUInt32LE(4);
          if ((id === "SEND" || id === "DATA") && st.buf.length < 8 + n) break;
          if (id === "SEND") {
            const spec = st.buf.toString("utf8", 8, 8 + n);
            st.path = spec.slice(0, spec.lastIndexOf(","));
            st.parts = [];
            st.buf = st.buf.subarray(8 + n);
          } else if (id === "DATA") {
            st.parts.push(Buffer.from(st.buf.subarray(8, 8 + n)));
            st.buf = st.buf.subarray(8 + n);
          } else if (id === "DONE") {
            s.files[st.path] = Buffer.concat(st.parts);
            st.buf = st.buf.subarray(8);
            send(CMD.WRTE, m.arg1, st.remote, Buffer.from("OKAY\0\0\0\0", "latin1"));
          } else {
            streams.delete(m.arg1);
            send(CMD.CLSE, m.arg1, st.remote);
            break;
          }
        }
        return;
      }
      if (m.command === CMD.CLSE) {
        streams.get(m.arg1)?.tcp?.destroy();
        streams.delete(m.arg1);
        return;
      }
      if (m.command === CMD.OKAY) {
        // Patch took the last piece of a stream: send the next (ADB sends one piece at a time).
        const st = streams.get(m.arg1);
        if (st?.pump) {
          st.waiting = false;
          st.pump();
        }
        return;
      }
      if (m.command === CMD.OPEN) {
        const remote = m.arg0;
        const local = crypto.randomInt(1, 1 << 30);
        const service = m.data.toString("utf8").replace(/\0$/, "");
        // Sends bytes a piece at a time, each after Patch has taken the one before; then closes if asked.
        const outbound = (st) => {
          st.out = [];
          st.waiting = false;
          st.pump = () => {
            if (st.waiting) return;
            if (!st.out.length) {
              if (st.closeAfter && streams.delete(local)) send(CMD.CLSE, local, remote);
              return;
            }
            st.waiting = true;
            send(CMD.WRTE, local, remote, st.out.shift());
          };
          st.push = (data) => {
            for (let o = 0; o < data.length; o += 64 * 1024) st.out.push(data.subarray(o, o + 64 * 1024));
            st.pump();
          };
          return st;
        };
        const devtools = service.match(/^localabstract:webview_devtools_remote_(\d+)$/);
        if (devtools) {
          // One of Patch's own apps showing a web page: its debugging socket, handed through to the real browser.
          const pkg = s.running.find((p) => firePid(s, p) === Number(devtools[1]));
          if (!s.browser || !pkg || !fireWebApp(s, pkg)) return send(CMD.CLSE, 0, remote);
          s.browser.open().then(
            (tcp) => {
              const st = outbound({ remote, tcp });
              streams.set(local, st);
              send(CMD.OKAY, local, remote);
              tcp.on("data", (d) => st.push(d));
              tcp.on("error", () => {});
              tcp.on("close", () => {
                st.closeAfter = true;
                st.pump();
              });
            },
            () => send(CMD.CLSE, 0, remote),
          );
          return;
        }
        if (/^(localabstract|localreserved|localfilesystem|tcp|dev|jdwp):/.test(service)) return send(CMD.CLSE, 0, remote);
        send(CMD.OKAY, local, remote);
        if (service === "sync:") {
          streams.set(local, { remote, buf: Buffer.alloc(0), path: null, parts: [] });
          return;
        }
        if (service === "exec:screencap -p") {
          s.commands.push("screencap -p");
          const st = outbound({ remote, closeAfter: true });
          streams.set(local, st);
          st.push(firePicture(s));
          return;
        }
        const out = service.startsWith("shell:") ? fireShell(s, service.slice(6)) : "";
        if (out) send(CMD.WRTE, local, remote, Buffer.from(out));
        setTimeout(() => send(CMD.CLSE, local, remote), 5);
      }
    });
    sock.on("data", (d) => {
      try {
        parser.push(d);
      } catch {
        sock.destroy();
      }
    });
    sock.on("error", () => {});
  });
  await listen(server, 5555, ip);
  const close = server.close.bind(server);
  server.close = (cb) => {
    for (const sock of open) sock.destroy();
    return close(cb);
  };
  return [server];
}

// ── PlayStation 5 (DDP) ──────────────────────────────────

export async function playStation(ip, { name = "PS5-773", standby = true } = {}) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("message", (m, r) => {
    if (!/^SRCH \* HTTP\/1\.1/.test(m.toString())) return;
    const lines = [standby ? "HTTP/1.1 620 Server Standby" : "HTTP/1.1 200 Ok", "host-id:A4B1C2D3E4F5", "host-type:PS5", `host-name:${name}`, "host-request-port:997", "device-discovery-protocol-version:00030010", "system-version:09400004", ""];
    sock.send(Buffer.from(lines.join("\n")), r.port, r.address);
  });
  await new Promise((r) => sock.bind(9302, ip, r));
  return [sock];
}

// ── Spotify Connect speaker ──────────────────────────────

export async function spotifySpeaker(ip, port, info) {
  return [
    await httpServer(ip, port, async ({ url, send }) => {
      if (url.pathname === "/zc" && url.searchParams.get("action") === "getInfo") return send(200, { status: 101, statusString: "OK", spotifyError: 0, version: "2.7.1", libraryVersion: "3.88.29", accountReq: "PREMIUM", activeUser: "", deviceID: "b2c4d6e8f0a1b3c5d7e9f1a3b5c7d9e1f3a5b7c9", publicKey: "", availability: "", productID: 0, groupStatus: "NONE", tokenType: "accesstoken", ...info });
      return send(404, "not found", "text/plain");
    }),
  ];
}

// ── WS-Discovery responder (ONVIF cameras) ───────────────

export async function wsdResponder(ip, cameras) {
  const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  sock.on("message", (m, r) => {
    const text = m.toString();
    if (!/Probe<\/|:Probe>|Probe\/>/.test(text)) return;
    const rel = text.match(/MessageID>([^<]+)</)?.[1] || "";
    for (const c of cameras) {
      const xml = `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><SOAP-ENV:Header><wsa:MessageID>uuid:${crypto.randomUUID()}</wsa:MessageID><wsa:RelatesTo>${rel}</wsa:RelatesTo><wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/ProbeMatches</wsa:Action></SOAP-ENV:Header><SOAP-ENV:Body><d:ProbeMatches><d:ProbeMatch><wsa:EndpointReference><wsa:Address>urn:uuid:${c.uuid}</wsa:Address></wsa:EndpointReference><d:Types>dn:NetworkVideoTransmitter tds:Device</d:Types><d:Scopes>onvif://www.onvif.org/type/video_encoder onvif://www.onvif.org/Profile/Streaming onvif://www.onvif.org/name/${encodeURIComponent(c.maker)} onvif://www.onvif.org/hardware/${encodeURIComponent(c.model)} onvif://www.onvif.org/location/${encodeURIComponent(c.location)}</d:Scopes><d:XAddrs>http://${c.ip}:8000/onvif/device_service</d:XAddrs><d:MetadataVersion>1</d:MetadataVersion></d:ProbeMatch></d:ProbeMatches></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
      sock.send(Buffer.from(xml), r.port, r.address);
    }
  });
  await new Promise((r) => sock.bind(3702, ip, r));
  return [sock];
}

// ── YouTube Data API (for tests; demo mode uses it too, so search works without a real key) ──

export function youtubeVideos() {
  return [
    { id: "jfKfPfyJRdk", title: "lofi hip hop radio 📚 beats to relax/study to", channel: "Lofi Girl", duration: "PT0S", live: true },
    { id: "5qap5aO4i9A", title: "Lo-fi Beats for Focus &amp; Study (2 Hours)", channel: "Chillhop Music", duration: "PT2H1M5S" },
    { id: "dQw4w9WgXcQ", title: "Rick Astley - Never Gonna Give You Up (Official Video)", channel: "Rick Astley", duration: "PT3M33S" },
    { id: "kJQP7kiw5Fk", title: "Luis Fonsi - Despacito ft. Daddy Yankee", channel: "Luis Fonsi", duration: "PT4M42S" },
    { id: "UcRtFYAz2Yo", title: "How to make perfect pancakes", channel: "Home Cooking", duration: "PT8M12S" },
    { id: "9bZkp7q19f0", title: "PSY - GANGNAM STYLE(강남스타일) M/V", channel: "officialpsy", duration: "PT4M13S" },
  ];
}

export async function youtubeApi(ip, port, { key = "demo-youtube-key", videos = youtubeVideos() } = {}) {
  const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(" ").filter((w) => w.length > 1);
  return [
    await httpServer(ip, port, async ({ url, send }) => {
      if (url.searchParams.get("key") !== key) return send(400, { error: { code: 400, status: "INVALID_ARGUMENT", errors: [{ reason: "keyInvalid", message: "API key not valid." }] } });
      if (url.pathname.endsWith("/search")) {
        const q = words(url.searchParams.get("q"));
        const max = Number(url.searchParams.get("maxResults") || 5);
        const hits = videos.filter((v) => q.some((w) => words(`${v.title} ${v.channel}`).includes(w))).slice(0, max);
        return send(200, { kind: "youtube#searchListResponse", items: hits.map((v) => ({ kind: "youtube#searchResult", id: { kind: "youtube#video", videoId: v.id }, snippet: { title: v.title, channelTitle: v.channel, liveBroadcastContent: v.live ? "live" : "none" } })) });
      }
      if (url.pathname.endsWith("/videos")) {
        const ids = String(url.searchParams.get("id") || "").split(",");
        return send(200, { items: videos.filter((v) => ids.includes(v.id)).map((v) => ({ id: v.id, contentDetails: { duration: v.duration } })) });
      }
      return send(404, { error: { code: 404 } });
    }),
  ];
}
