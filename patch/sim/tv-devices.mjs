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
import { apkInfo } from "../src/apk/index.mjs";
import { verifyV2 } from "../src/apk/sign.mjs";
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
          s.keys.push(x.DataOfCmd);
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
  };
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
    const apps = s.packages.filter((p) => !["com.amazon.tv.launcher", "com.amazon.venezia", "com.android.settings"].includes(p));
    body = node({ cls: "android.widget.FrameLayout", b: "[0,0][1920,1080]" }, node({ text: "Home", b: "[100,40][300,90]" }) + apps.map((p, i) => node({ cls: "android.widget.FrameLayout", click: true, focus: true, focused: i === 0, b: `[${100 + i * 220},600][${300 + i * 220},720]` }, node({ desc: s.installed[p]?.label || HOME_NAMES[p] || p.split(".").at(-1), cls: "android.widget.ImageView", b: `[${110 + i * 220},610][${290 + i * 220},710]` }))).join(""));
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
    s.installed[info.package] = { label: info.label, versionCode: info.versionCode, cert, size: file.length };
    if (!s.packages.includes(info.package)) s.packages.push(info.package);
    return "Success\n";
  }
  m = cmd.match(/^pm uninstall (\S+)$/);
  if (m) {
    if (!s.packages.includes(m[1]) || s.system.includes(m[1])) return "Failure [DELETE_FAILED_INTERNAL_ERROR]\n";
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
  m = cmd.match(/^input keyevent (\S+)$/);
  if (m) {
    if (m[1] === "KEYCODE_DPAD_CENTER" && s.focus.startsWith("com.amazon.venezia/")) storeGet(s);
    if (m[1] === "KEYCODE_SLEEP") s.awake = false;
    if (m[1] === "KEYCODE_WAKEUP") s.awake = true;
    if (m[1] === "KEYCODE_HOME") s.focus = "com.amazon.tv.launcher/.ui.HomeActivity_vNext";
    return "";
  }
  m = cmd.match(/^monkey -p (\S+) -c (\S+) 1$/);
  if (m) {
    if (!s.packages.includes(m[1])) return "** No activities found to run, monkey aborted.\n";
    s.focus = `${m[1]}/.MainActivity`;
    return "Events injected: 1\n## Network stats: elapsed time=12ms\n";
  }
  m = cmd.match(/^am start -a (\S+)(?: -d '([^']*)')?(?: --es query '([^']*)')?(?: (\S+))?$/);
  if (m) {
    const [, action, data, query, pkg] = m;
    if (pkg && !s.packages.includes(pkg)) return `Error: Activity not started, unable to resolve Intent { act=${action} pkg=${pkg} }\n`;
    if (action === "android.intent.action.SEARCH" && pkg !== "com.amazon.firetv.youtube") return "Error: Activity not started, unable to resolve Intent\n";
    const target = pkg || (/^https?:\/\/(www\.)?youtube\.com/.test(data || "") ? "com.amazon.firetv.youtube" : "com.amazon.cloud9");
    s.focus = `${target}/.MainActivity`;
    s.lastIntent = { action, data: data || null, query: query || null, pkg: target };
    return `Starting: Intent { act=${action}${data ? ` dat=${data}` : ""} pkg=${target} }\n`;
  }
  m = cmd.match(/^input text '(.*)'$/);
  if (m) {
    s.lastText = m[1].replace(/%s/g, " ").replace(/'\\''/g, "'");
    return "";
  }
  return `/system/bin/sh: ${cmd.split(" ")[0]}: not found\n`;
}

export async function fireTv(ip, s) {
  const server = net.createServer((sock) => {
    let token = null;
    let authed = false;
    const streams = new Map();
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
      if (m.command === CMD.WRTE && streams.has(m.arg1)) {
        // ADB "sync": SEND path,mode → DATA… → DONE (answered OKAY) → QUIT.
        const st = streams.get(m.arg1);
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
        streams.delete(m.arg1);
        return;
      }
      if (m.command === CMD.OPEN) {
        const remote = m.arg0;
        const local = crypto.randomInt(1, 1 << 30);
        const service = m.data.toString("utf8").replace(/\0$/, "");
        send(CMD.OKAY, local, remote);
        if (service === "sync:") {
          streams.set(local, { remote, buf: Buffer.alloc(0), path: null, parts: [] });
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
