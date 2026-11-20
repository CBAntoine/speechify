// Simulated HTTP devices for demo mode and tests. Each answers like the real product's local API.
import http from "node:http";

export function httpServer(ip, port, handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, `http://${ip}:${port}`);
    const send = (status, body, type) => {
      const data = Buffer.isBuffer(body) ? body : typeof body === "string" ? body : JSON.stringify(body);
      res.writeHead(status, { "content-type": type || (typeof body === "object" && !Buffer.isBuffer(body) ? "application/json" : "text/html; charset=utf-8") });
      res.end(data);
    };
    try {
      await handler({ req, res, url, raw, text: raw.toString("utf8"), json: () => JSON.parse(raw.toString("utf8") || "null"), send });
    } catch (err) {
      send(500, { error: err.message });
    }
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, ip, () => resolve(server));
  });
}

const page = (title, body = "") => `<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;

// ── SOAP helpers ──────────────────────────────────────────

export function soapRequest(req, text) {
  const action = String(req.headers.soapaction || "").replace(/"/g, "").split("#")[1];
  const args = {};
  for (const m of text.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) args[m[1]] = m[2];
  return { action, args };
}

export const soapReply = (serviceType, action, out = {}) =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action}Response xmlns:u="${serviceType}">${Object.entries(out)
    .map(([k, v]) => `<${k}>${String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</${k}>`)
    .join("")}</u:${action}Response></s:Body></s:Envelope>`;

export const soapFault = (code, desc) =>
  `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>${desc}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`;

// ── Philips Hue bridge ────────────────────────────────────

export function hueState() {
  const light = (name, type, productname, state, n) => ({
    state: { alert: "none", reachable: true, ...state },
    swupdate: { state: "noupdates", lastinstall: "2026-08-02T09:12:41" },
    type,
    name,
    modelid: type.includes("color") ? "LCA001" : type.includes("temperature") ? "LTA001" : "LWA001",
    manufacturername: "Signify Netherlands B.V.",
    productname,
    uniqueid: `00:17:88:01:08:aa:0${n}:0${n}-0b`,
    swversion: "1.104.2",
  });
  return {
    bridgeid: "001788FFFE2A3B4C",
    mac: "00:17:88:2a:3b:4c",
    name: "Philips hue",
    users: new Set(),
    linkUntil: 0,
    lights: {
      1: light("Kitchen 1", "Extended color light", "Hue color lamp", { on: true, bri: 203, hue: 8418, sat: 140, ct: 366, xy: [0.4573, 0.41], colormode: "ct" }, 1),
      2: light("Kitchen 2", "Extended color light", "Hue color lamp", { on: true, bri: 203, hue: 8418, sat: 140, ct: 366, xy: [0.4573, 0.41], colormode: "ct" }, 2),
      3: light("Living room lamp", "Color temperature light", "Hue ambiance lamp", { on: false, bri: 120, ct: 300, colormode: "ct" }, 3),
      4: light("Hallway", "Extended color light", "Hue color candle", { on: true, bri: 90, hue: 47000, sat: 200, ct: 200, xy: [0.17, 0.2], colormode: "hs" }, 4),
      5: light("Garden spot", "Dimmable light", "Hue white lamp", { on: false, bri: 254, reachable: false }, 5),
    },
    groups: {
      1: { name: "Kitchen", type: "Room", class: "Kitchen", lights: ["1", "2"] },
      2: { name: "Living room", type: "Room", class: "Living room", lights: ["3"] },
      3: { name: "Hallway", type: "Room", class: "Hallway", lights: ["4"] },
    },
    scenes: {
      aBc1RelaxXyz: { name: "Relax", type: "GroupScene", group: "2", lights: ["3"] },
      aBc2ReadXyzz: { name: "Read", type: "GroupScene", group: "2", lights: ["3"] },
      kIt1BrightXy: { name: "Bright", type: "GroupScene", group: "1", lights: ["1", "2"] },
      kIt2DimmedXy: { name: "Dimmed", type: "GroupScene", group: "1", lights: ["1", "2"] },
    },
    swupdate2: { checkforupdate: false, lastchange: "2026-11-01T10:00:00", bridge: { state: "noupdates" }, state: "anyreadytoinstall", autoinstall: { updatetime: "T14:00:00", on: false } },
  };
}

function groupView(s, g) {
  const ls = g.lights.map((id) => s.lights[id]).filter(Boolean);
  const on = ls.filter((l) => l.state.on && l.state.reachable);
  return { ...g, state: { any_on: on.length > 0, all_on: ls.length > 0 && on.length === ls.length }, action: { on: on.length > 0, bri: ls[0]?.state.bri ?? 254, ct: ls[0]?.state.ct, colormode: ls[0]?.state.colormode } };
}

export function hueHandler(s, { ip }) {
  const config = () => ({ name: s.name, datastoreversion: "163", swversion: "1967054020", apiversion: "1.67.0", mac: s.mac, bridgeid: s.bridgeid, factorynew: false, replacesbridgeid: null, modelid: "BSB002", starterkitid: "" });
  const unauthorized = (path) => [{ error: { type: 1, address: path, description: "unauthorized user" } }];
  const applyState = (light, body, base) => {
    const out = [];
    for (const [k, v] of Object.entries(body)) {
      if (k === "on" || k === "bri" || k === "hue" || k === "sat" || k === "ct" || k === "alert" || k === "xy") {
        if (!light.state.reachable && k !== "alert") {
          out.push({ error: { type: 201, address: `${base}/${k}`, description: `parameter, ${k}, is not modifiable. Device is set to off.` } });
          continue;
        }
        light.state[k] = v;
        if (k === "ct") light.state.colormode = "ct";
        if (k === "hue" || k === "sat") light.state.colormode = "hs";
        out.push({ success: { [`${base}/${k}`]: v } });
      }
    }
    return out;
  };
  return async ({ req, url, json, send }) => {
    const p = url.pathname.replace(/\/+$/, "");
    if (p === "/description.xml") {
      return send(200, `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><URLBase>http://${ip}:80/</URLBase><device><deviceType>urn:schemas-upnp-org:device:Basic:1</deviceType><friendlyName>Philips hue (${ip})</friendlyName><manufacturer>Signify</manufacturer><modelName>Philips hue bridge 2015</modelName><modelNumber>BSB002</modelNumber><serialNumber>001788${s.bridgeid.slice(-6)}</serialNumber><UDN>uuid:2f402f80-da50-11e1-9b23-001788${s.bridgeid.slice(-6).toLowerCase()}</UDN><presentationURL>index.html</presentationURL></device></root>`, "text/xml");
    }
    if (p === "" || p === "/index.html") return send(200, page("hue personal wireless lighting"));
    if (p === "/api/config" || p === "/api/nouser/config") return send(200, config());
    if (p === "/api" && req.method === "POST") {
      const body = json() || {};
      if (!body.devicetype) return send(200, [{ error: { type: 5, address: "/", description: "invalid/missing parameters in body" } }]);
      if (Date.now() < s.linkUntil) {
        const username = `sim${Math.random().toString(36).slice(2, 14)}${Math.random().toString(36).slice(2, 14)}`;
        s.users.add(username);
        return send(200, [{ success: { username } }]);
      }
      // Demo: the button "gets pressed" right after the first attempt, like a person would.
      s.linkUntil = Date.now() + 60_000;
      return send(200, [{ error: { type: 101, address: "", description: "link button not pressed" } }]);
    }
    const m = p.match(/^\/api\/([^/]+)(\/.*)?$/);
    if (!m) return send(404, [{ error: { type: 4, address: p, description: "method, GET, not available for resource" } }]);
    const [, user, rest = ""] = m;
    if (!s.users.has(user)) return send(200, unauthorized(rest || "/"));
    const lightsView = () => Object.fromEntries(Object.entries(s.lights));
    if (!rest && req.method === "GET") {
      return send(200, { lights: lightsView(), groups: Object.fromEntries(Object.entries(s.groups).map(([k, g]) => [k, groupView(s, g)])), config: { ...config(), swupdate2: s.swupdate2, whitelist: {} }, scenes: s.scenes, schedules: {}, rules: {}, sensors: {}, resourcelinks: {} });
    }
    if (rest === "/config") {
      if (req.method === "GET") return send(200, { ...config(), swupdate2: s.swupdate2 });
      const b = json() || {};
      const out = [];
      if (b.name) {
        s.name = b.name;
        out.push({ success: { "/config/name": b.name } });
      }
      if (b.swupdate2?.install && /readytoinstall/.test(s.swupdate2.state)) {
        s.swupdate2.state = "installing";
        setTimeout(() => (s.swupdate2.state = "noupdates"), 3000);
        out.push({ success: { "/config/swupdate2/install": true } });
      }
      if (b.swupdate2?.checkforupdate) out.push({ success: { "/config/swupdate2/checkforupdate": true } });
      if (b.swupdate2?.autoinstall?.on !== undefined) {
        s.swupdate2.autoinstall.on = !!b.swupdate2.autoinstall.on;
        out.push({ success: { "/config/swupdate2/autoinstall/on": s.swupdate2.autoinstall.on } });
      }
      return send(200, out);
    }
    let lm = rest.match(/^\/lights\/(\d+)(\/state)?$/);
    if (lm) {
      const light = s.lights[lm[1]];
      if (!light) return send(200, [{ error: { type: 3, address: rest, description: `resource, ${rest}, not available` } }]);
      if (req.method === "GET") return send(200, light);
      const b = json() || {};
      if (lm[2]) return send(200, applyState(light, b, `/lights/${lm[1]}/state`));
      if (b.name) light.name = String(b.name).slice(0, 32);
      return send(200, [{ success: { [`/lights/${lm[1]}/name`]: light.name } }]);
    }
    lm = rest.match(/^\/groups\/(\d+)(\/action)?$/);
    if (lm) {
      const g = s.groups[lm[1]];
      if (!g) return send(200, [{ error: { type: 3, address: rest, description: `resource, ${rest}, not available` } }]);
      if (req.method === "GET") return send(200, groupView(s, g));
      const b = json() || {};
      if (!lm[2]) {
        if (b.name) g.name = b.name;
        return send(200, [{ success: { [`/groups/${lm[1]}/name`]: g.name } }]);
      }
      if (b.scene) {
        const sc = s.scenes[b.scene];
        if (!sc) return send(200, [{ error: { type: 7, address: `/groups/${lm[1]}/action/scene`, description: "invalid value" } }]);
        for (const id of g.lights) applyState(s.lights[id], { on: true, bri: sc.name === "Dimmed" || sc.name === "Relax" ? 110 : 254, ct: sc.name === "Relax" ? 447 : 233 }, "");
        return send(200, [{ success: { [`/groups/${lm[1]}/action/scene`]: b.scene } }]);
      }
      const out = [];
      for (const id of g.lights) out.push(...applyState(s.lights[id], b, `/groups/${lm[1]}/action`));
      return send(200, out.filter((x, i, a) => a.findIndex((y) => JSON.stringify(y) === JSON.stringify(x)) === i));
    }
    return send(200, [{ error: { type: 3, address: rest, description: `resource, ${rest}, not available` } }]);
  };
}

// ── Roku TV ───────────────────────────────────────────────

export function rokuState() {
  return {
    power: "PowerOn",
    active: "12",
    apps: [
      { id: "12", name: "Netflix", version: "5.2.110" }, { id: "837", name: "YouTube", version: "2.21.1" }, { id: "2285", name: "Hulu", version: "11.3.0" },
      { id: "291097", name: "Disney Plus", version: "1.31.2" }, { id: "13", name: "Prime Video", version: "15.4.1" }, { id: "22297", name: "Spotify Music", version: "2.6.3" },
      { id: "13535", name: "Plex - Free Movies & TV", version: "8.7.1" }, { id: "tvinput.dtv", name: "Live TV", version: "1.0.0" },
    ],
    keys: [],
    searches: [],
  };
}

export function rokuHandler(s) {
  const esc = (x) => String(x).replace(/&/g, "&amp;");
  return async ({ req, url, send }) => {
    const p = url.pathname;
    if (p === "/" || p === "") return send(200, `<?xml version="1.0" encoding="UTF-8" ?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><device><deviceType>urn:roku-com:device:player:1-0</deviceType><friendlyName>Living Room TV</friendlyName><manufacturer>Roku</manufacturer><modelName>TCL 55S455</modelName><serialNumber>YN00AB123456</serialNumber><UDN>uuid:29600009-5406-1005-8080-1234567890ab</UDN></device></root>`, "text/xml");
    if (p === "/query/device-info")
      return send(200, `<?xml version="1.0" encoding="UTF-8" ?>
<device-info>
	<udn>29600009-5406-1005-8080-1234567890ab</udn>
	<serial-number>YN00AB123456</serial-number>
	<device-id>S00820AB1234</device-id>
	<vendor-name>TCL</vendor-name>
	<model-name>55S455</model-name>
	<model-number>C210X</model-number>
	<wifi-mac>c8:3a:6b:12:34:56</wifi-mac>
	<network-type>wifi</network-type>
	<friendly-device-name>55&quot; TCL Roku TV</friendly-device-name>
	<user-device-name>Living Room TV</user-device-name>
	<user-device-location>Living room</user-device-location>
	<software-version>14.1.4</software-version>
	<software-build>2104</software-build>
	<is-tv>true</is-tv>
	<power-mode>${s.power}</power-mode>
	<supports-suspend>true</supports-suspend>
</device-info>`, "text/xml");
    if (p === "/query/apps") return send(200, `<?xml version="1.0" encoding="UTF-8" ?>\n<apps>\n${s.apps.map((a) => `\t<app id="${a.id}" type="appl" version="${a.version}">${esc(a.name)}</app>`).join("\n")}\n</apps>`, "text/xml");
    if (p === "/query/active-app") {
      const a = s.apps.find((x) => x.id === s.active);
      return send(200, `<?xml version="1.0" encoding="UTF-8" ?>\n<active-app>\n\t${a ? `<app id="${a.id}" type="appl" version="${a.version}">${esc(a.name)}</app>` : "<app>Roku</app>"}\n</active-app>`, "text/xml");
    }
    if (req.method !== "POST") return send(404, "");
    let m = p.match(/^\/keypress\/(\w+)$/);
    if (m) {
      s.keys.push(m[1]);
      if (m[1] === "PowerOff") s.power = "DisplayOff";
      if (m[1] === "PowerOn") s.power = "PowerOn";
      if (m[1] === "Home") s.active = null;
      return send(200, "");
    }
    m = p.match(/^\/launch\/([^/]+)$/);
    if (m) {
      if (!s.apps.some((a) => a.id === decodeURIComponent(m[1]))) return send(404, "");
      s.active = decodeURIComponent(m[1]);
      s.power = "PowerOn";
      return send(200, "");
    }
    if (p === "/search/browse") {
      s.searches.push(url.searchParams.get("keyword"));
      return send(200, "");
    }
    m = p.match(/^\/install\/(\d+)$/);
    if (m) {
      // Opens the channel's page in the Channel Store.
      (s.storePages ||= []).push(m[1]);
      return send(200, "");
    }
    return send(404, "");
  };
}

// ── Sonos ─────────────────────────────────────────────────

export function sonosState(ip) {
  return { ip, uuid: "RINCON_48A6B8F1C2D301400", room: "Kitchen", volume: 22, mute: false, transport: "PLAYING", title: "Dreams", artist: "Fleetwood Mac" };
}

export function sonosHandler(s) {
  const RC = "urn:schemas-upnp-org:service:RenderingControl:1";
  const AVT = "urn:schemas-upnp-org:service:AVTransport:1";
  const ZGT = "urn:schemas-upnp-org:service:ZoneGroupTopology:1";
  const escape = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return async ({ req, url, text, send }) => {
    const p = url.pathname;
    if (p === "/xml/device_description.xml") {
      return send(200, `<?xml version="1.0" encoding="utf-8" ?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><device><deviceType>urn:schemas-upnp-org:device:ZonePlayer:1</deviceType><friendlyName>${s.ip} - Sonos One - RINCON_48A6B8F1C2D301400</friendlyName><manufacturer>Sonos, Inc.</manufacturer><manufacturerURL>http://www.sonos.com</manufacturerURL><modelNumber>S18</modelNumber><modelDescription>Sonos One</modelDescription><modelName>Sonos One</modelName><softwareVersion>80.1-55020</softwareVersion><serialNumber>48-A6-B8-F1-C2-D3:7</serialNumber><UDN>uuid:${s.uuid}</UDN><roomName>${s.room}</roomName><displayName>One</displayName><deviceList><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>${s.room} - Sonos One Media Renderer</friendlyName><manufacturer>Sonos, Inc.</manufacturer><modelName>Sonos One</modelName><UDN>uuid:${s.uuid}_MR</UDN><serviceList><service><serviceType>${RC}</serviceType><serviceId>urn:upnp-org:serviceId:RenderingControl</serviceId><controlURL>/MediaRenderer/RenderingControl/Control</controlURL><eventSubURL>/MediaRenderer/RenderingControl/Event</eventSubURL><SCPDURL>/xml/RenderingControl1.xml</SCPDURL></service><service><serviceType>${AVT}</serviceType><serviceId>urn:upnp-org:serviceId:AVTransport</serviceId><controlURL>/MediaRenderer/AVTransport/Control</controlURL><eventSubURL>/MediaRenderer/AVTransport/Event</eventSubURL><SCPDURL>/xml/AVTransport1.xml</SCPDURL></service></serviceList></device></deviceList></device></root>`, "text/xml");
    }
    if (req.method !== "POST") return send(404, "");
    const { action, args } = soapRequest(req, text);
    const ok = (svc, out) => send(200, soapReply(svc, action, out), 'text/xml; charset="utf-8"');
    if (p === "/MediaRenderer/RenderingControl/Control") {
      if (action === "GetVolume") return ok(RC, { CurrentVolume: s.volume });
      if (action === "SetVolume") {
        s.volume = Math.max(0, Math.min(100, Number(args.DesiredVolume)));
        return ok(RC);
      }
      if (action === "GetMute") return ok(RC, { CurrentMute: s.mute ? 1 : 0 });
      if (action === "SetMute") {
        s.mute = args.DesiredMute === "1";
        return ok(RC);
      }
    }
    if (p === "/MediaRenderer/AVTransport/Control") {
      if (action === "GetTransportInfo") return ok(AVT, { CurrentTransportState: s.transport, CurrentTransportStatus: "OK", CurrentSpeed: 1 });
      if (action === "GetPositionInfo") {
        const didl = s.title ? `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="-1" parentID="-1" restricted="true"><res protocolInfo="sonos.com-http:*:audio/mp4:*" duration="0:04:17"></res><upnp:class>object.item.audioItem.musicTrack</upnp:class><dc:title>${escape(s.title)}</dc:title><dc:creator>${escape(s.artist)}</dc:creator><upnp:album>Rumours</upnp:album></item></DIDL-Lite>` : "NOT_IMPLEMENTED";
        return ok(AVT, { Track: 1, TrackDuration: "0:04:17", TrackMetaData: didl, TrackURI: "x-sonos-spotify:spotify%3atrack%3a0ofHAoxe9vBkTCp2UQIavz", RelTime: "0:01:12" });
      }
      if (["Play", "Pause", "Stop", "Next", "Previous"].includes(action)) {
        if (!s.title) return send(500, soapFault(701, "Transition not available"), "text/xml");
        s.transport = action === "Play" ? "PLAYING" : action === "Pause" ? "PAUSED_PLAYBACK" : action === "Stop" ? "STOPPED" : s.transport;
        if (action === "Next") s.title = "Go Your Own Way";
        if (action === "Previous") s.title = "Dreams";
        return ok(AVT);
      }
    }
    if (p === "/ZoneGroupTopology/Control" && action === "GetZoneGroupState") {
      const zgs = `<ZoneGroupState><ZoneGroups><ZoneGroup Coordinator="${s.uuid}" ID="${s.uuid}:1871"><ZoneGroupMember UUID="${s.uuid}" Location="http://${s.ip}:1400/xml/device_description.xml" ZoneName="${s.room}" SoftwareVersion="80.1-55020"/></ZoneGroup></ZoneGroups><VanishedDevices></VanishedDevices></ZoneGroupState>`;
      return ok(ZGT, { ZoneGroupState: zgs });
    }
    return send(500, soapFault(401, "Invalid Action"), "text/xml");
  };
}

// ── Router with UPnP IGD ──────────────────────────────────

export function routerState() {
  return {
    externalIp: "203.0.113.45",
    uptime: 3 * 86400 + 4 * 3600,
    mappings: [
      { NewRemoteHost: "", NewExternalPort: 32400, NewProtocol: "TCP", NewInternalPort: 32400, NewInternalClient: "127.0.10.23", NewEnabled: 1, NewPortMappingDescription: "Plex Media Server", NewLeaseDuration: 0 },
      { NewRemoteHost: "", NewExternalPort: 8081, NewProtocol: "TCP", NewInternalPort: 80, NewInternalClient: "127.0.10.22", NewEnabled: 1, NewPortMappingDescription: "IPCAM", NewLeaseDuration: 0 },
    ],
  };
}

export function routerHandler(s, { ip }) {
  const WIP = "urn:schemas-upnp-org:service:WANIPConnection:1";
  const CMN = "urn:schemas-upnp-org:service:WANCommonInterfaceConfig:1";
  return async ({ req, url, text, send }) => {
    const p = url.pathname;
    if (p === "/rootDesc.xml") {
      return send(200, `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><friendlyName>NETGEAR Nighthawk RAX50</friendlyName><manufacturer>NETGEAR, Inc.</manufacturer><manufacturerURL>http://www.netgear.com</manufacturerURL><modelDescription>NETGEAR Nighthawk AX6 WiFi Router</modelDescription><modelName>RAX50</modelName><modelNumber>V1.0.12.110</modelNumber><serialNumber>6LA3155A00321</serialNumber><UDN>uuid:824ff22b-8c7d-41c5-a131-44a1b2c3d4e5</UDN><presentationURL>http://${ip}/</presentationURL><deviceList><device><deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType><friendlyName>WANDevice</friendlyName><manufacturer>NETGEAR, Inc.</manufacturer><modelName>RAX50</modelName><UDN>uuid:824ff22b-8c7d-41c5-a131-44a1b2c3d4e6</UDN><serviceList><service><serviceType>${CMN}</serviceType><serviceId>urn:upnp-org:serviceId:WANCommonIFC1</serviceId><controlURL>/ctl/CmnIfCfg</controlURL><eventSubURL>/evt/CmnIfCfg</eventSubURL><SCPDURL>/WANCfg.xml</SCPDURL></service></serviceList><deviceList><device><deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType><friendlyName>WANConnectionDevice</friendlyName><manufacturer>NETGEAR, Inc.</manufacturer><modelName>RAX50</modelName><UDN>uuid:824ff22b-8c7d-41c5-a131-44a1b2c3d4e7</UDN><serviceList><service><serviceType>${WIP}</serviceType><serviceId>urn:upnp-org:serviceId:WANIPConn1</serviceId><controlURL>/ctl/IPConn</controlURL><eventSubURL>/evt/IPConn</eventSubURL><SCPDURL>/WANIPCn.xml</SCPDURL></service></serviceList></device></deviceList></device></deviceList></device></root>`, "text/xml");
    }
    if (req.method === "GET") return send(200, page("NETGEAR Router RAX50", "<p>Login required</p>"));
    const { action, args } = soapRequest(req, text);
    const ok = (svc, out) => send(200, soapReply(svc, action, out), 'text/xml; charset="utf-8"');
    if (p === "/ctl/IPConn") {
      if (action === "GetExternalIPAddress") return ok(WIP, { NewExternalIPAddress: s.externalIp });
      if (action === "GetStatusInfo") return ok(WIP, { NewConnectionStatus: "Connected", NewLastConnectionError: "ERROR_NONE", NewUptime: s.uptime });
      if (action === "GetGenericPortMappingEntry") {
        const m = s.mappings[Number(args.NewPortMappingIndex)];
        return m ? ok(WIP, m) : send(500, soapFault(713, "SpecifiedArrayIndexInvalid"), "text/xml");
      }
      if (action === "DeletePortMapping") {
        const i = s.mappings.findIndex((m) => String(m.NewExternalPort) === args.NewExternalPort && m.NewProtocol === args.NewProtocol);
        if (i === -1) return send(500, soapFault(714, "NoSuchEntryInArray"), "text/xml");
        s.mappings.splice(i, 1);
        return ok(WIP);
      }
    }
    if (p === "/ctl/CmnIfCfg") {
      if (action === "GetCommonLinkProperties") return ok(CMN, { NewWANAccessType: "Ethernet", NewLayer1UpstreamMaxBitRate: 40000000, NewLayer1DownstreamMaxBitRate: 940000000, NewPhysicalLinkStatus: "Up" });
      if (action === "GetTotalBytesSent") return ok(CMN, { NewTotalBytesSent: 48_200_000_000 });
      if (action === "GetTotalBytesReceived") return ok(CMN, { NewTotalBytesReceived: 912_400_000_000 });
    }
    return send(500, soapFault(401, "Invalid Action"), "text/xml");
  };
}

// ── Shelly ────────────────────────────────────────────────

export function shellyPlugState() {
  return { name: "Coffee Maker", id: "shellyplusplugs-a8032ab1c2d3", mac: "A8032AB1C2D3", on: true, power: 3.2, updated: false, rssi: -78, reboots: 0 };
}

export function shellyGen2Handler(s, { ip }) {
  return async ({ req, url, json, send }) => {
    if (url.pathname === "/shelly") return send(200, { name: s.name, id: s.id, mac: s.mac, slot: 0, model: "SNPL-00112EU", gen: 2, fw_id: s.updated ? "20241011-114455/1.4.4-g6d2a586" : "20231107-164738/1.0.8-g8c7bb8d", ver: s.updated ? "1.4.4" : "1.0.8", app: "PlugS", auth_en: false, auth_domain: null });
    if (url.pathname === "/") return send(200, page("Shelly Plus Plug S"));
    if (url.pathname !== "/rpc" || req.method !== "POST") return send(404, { code: 404, message: "No handler" });
    const { id, method, params = {} } = json() || {};
    const r = (result) => send(200, { id, src: s.id, result });
    switch (method) {
      case "Shelly.GetConfig":
        return r({ sys: { device: { name: s.name, mac: s.mac, fw_id: "x", discoverable: true }, location: {} }, "switch:0": { id: 0, name: null, initial_state: "restore_last", auto_on: false } });
      case "Shelly.GetStatus":
        return r({ "switch:0": { id: 0, source: "init", output: s.on, apower: s.on ? s.power : 0, voltage: 230.4, current: s.on ? 0.02 : 0, aenergy: { total: 18234.5 }, temperature: { tC: 38.4, tF: 101.1 } }, sys: { mac: s.mac, restart_required: false, uptime: 482113, available_updates: s.updated ? {} : { stable: { version: "1.4.4" } } }, wifi: { sta_ip: ip, status: "got ip", ssid: "Home", rssi: s.rssi } });
      case "Switch.Set":
        s.on = !!params.on;
        return r({ was_on: !s.on });
      case "Switch.Toggle":
        s.on = !s.on;
        return r({ was_on: !s.on });
      case "Shelly.CheckForUpdate":
        return r(s.updated ? {} : { stable: { version: "1.4.4", build_id: "20241011-114455/1.4.4-g6d2a586" } });
      case "Shelly.Update":
        s.updated = true;
        return r(null);
      case "Shelly.Reboot":
        s.reboots++;
        return r(null);
      case "Sys.SetConfig":
        if (params.config?.device?.name) s.name = params.config.device.name;
        return r({ restart_required: false });
      default:
        return send(200, { id, src: s.id, error: { code: 404, message: `No handler for ${method}` } });
    }
  };
}

export function shellyGen1State() {
  return { name: "Porch Light", mac: "C45BBE6A1B2C", on: false, rssi: -61 };
}

export function shellyGen1Handler(s, { ip }) {
  return async ({ url, send }) => {
    const p = url.pathname;
    if (p === "/shelly") return send(200, { type: "SHSW-1", mac: s.mac, auth: false, fw: "20230913-112003/v1.14.0-gcb84623", discoverable: true, longid: 1, num_outputs: 1 });
    if (p === "/") return send(200, page("Shelly 1"));
    if (p === "/settings") {
      if (url.searchParams.get("name")) s.name = url.searchParams.get("name");
      return send(200, { device: { type: "SHSW-1", mac: s.mac, hostname: `shelly1-${s.mac.slice(-6)}`, num_outputs: 1 }, name: s.name, relays: [{ name: null, ison: s.on, default_state: "off" }] });
    }
    if (p === "/status") return send(200, { wifi_sta: { connected: true, ssid: "Home", ip, rssi: s.rssi }, relays: [{ ison: s.on, has_timer: false, timer_started: 0, timer_duration: 0, timer_remaining: 0, source: "http" }], update: { status: "idle", has_update: false, new_version: "20230913-112003/v1.14.0-gcb84623", old_version: "20230913-112003/v1.14.0-gcb84623" }, uptime: 91234 });
    if (p === "/relay/0") {
      const t = url.searchParams.get("turn");
      if (t === "on") s.on = true;
      else if (t === "off") s.on = false;
      else if (t === "toggle") s.on = !s.on;
      return send(200, { ison: s.on, has_timer: false, timer_started: 0, timer_duration: 0, timer_remaining: 0, source: "http" });
    }
    if (p === "/ota") return send(200, { status: "idle", has_update: false, new_version: "v1.14.0", old_version: "v1.14.0" });
    if (p === "/ota/check") return send(200, { status: "ok" });
    if (p === "/reboot") return send(200, { ok: true });
    return send(404, "Not Found");
  };
}

// ── WLED ──────────────────────────────────────────────────

const EFFECTS = ["Solid", "Blink", "Breathe", "Wipe", "Wipe Random", "Random Colors", "Sweep", "Dynamic", "Colorloop", "Rainbow", "Scan", "Scan Dual", "Fade", "Theater", "Theater Rainbow", "Running", "Saw", "Twinkle", "Dissolve", "Dissolve Rnd", "Sparkle", "Sparkle Dark", "Sparkle+", "Strobe", "Strobe Rainbow", "Strobe Mega", "Blink Rainbow", "Android", "Chase", "Chase Random", "Chase Rainbow", "Chase Flash", "Chase Flash Rnd", "Rainbow Runner", "Colorful", "Traffic Light", "Sweep Random", "Chase 2", "Aurora", "Stream", "Scanner", "Lighthouse", "Fireworks", "Rain", "Tetrix", "Fire Flicker", "Gradient", "Loading", "Rolling Balls", "Fairy", "Two Dots", "Fairytwinkle", "Running Dual", "RSVD", "Chase 3", "Tri Wipe", "Tri Fade", "Lightning", "ICU", "Multi Comet", "Scanner Dual", "Stream 2", "Oscillate", "Pride 2015", "Juggle", "Palette", "Fire 2012", "Colorwaves", "Bpm", "Fill Noise", "Noise 1", "Noise 2", "Noise 3", "Noise 4", "Colortwinkles", "Lake", "Meteor", "Meteor Smooth", "Railway", "Ripple", "Twinklefox", "Twinklecat", "Halloween Eyes", "Solid Pattern", "Solid Pattern Tri", "Spots", "Spots Fade", "Glitter", "Candle", "Fireworks Starburst", "Fireworks 1D", "Bouncing Balls", "Sinelon", "Sinelon Dual", "Sinelon Rainbow", "Popcorn", "Drip", "Plasma", "Percent", "Ripple Rainbow", "Heartbeat", "Pacifica", "Candle Multi", "Solid Glitter", "Sunrise"];

export function wledState() {
  return { name: "Desk LEDs", on: true, bri: 128, col: [255, 160, 0], fx: 0, ps: -1, reboots: 0 };
}

export function wledHandler(s) {
  const state = () => ({ on: s.on, bri: s.bri, transition: 7, ps: s.ps, pl: -1, nl: { on: false, dur: 60, mode: 1, tbri: 0 }, mainseg: 0, seg: [{ id: 0, start: 0, stop: 60, len: 60, grp: 1, spc: 0, of: 0, on: true, frz: false, bri: 255, cct: 127, col: [s.col, [0, 0, 0], [0, 0, 0]], fx: s.fx, sx: 128, ix: 128, pal: 0, sel: true, rev: false, mi: false }] });
  return async ({ req, url, json, send }) => {
    const p = url.pathname;
    if (p === "/") return send(200, page("WLED"));
    if (p === "/json/info") return send(200, { ver: "0.14.4", vid: 2405180, leds: { count: 60, pwr: 840, fps: 42, maxpwr: 850, maxseg: 32, seglc: [1], lc: 1, rgbw: false, wv: 0, cct: 0 }, str: false, name: s.name, udpport: 21324, live: false, ws: 0, fxcount: EFFECTS.length, palcount: 71, wifi: { bssid: "AA:BB:CC:DD:EE:FF", rssi: -58, signal: 84, channel: 6 }, fs: { u: 12, t: 983, pmt: 0 }, ndc: 0, arch: "esp32", core: "v3.3.6-16-gcc5440f6a2", freeheap: 167000, uptime: 81234, brand: "WLED", product: "FOSS", mac: "a4cf12aabbcc", ip: url.hostname });
    if (p === "/json/effects") return send(200, EFFECTS);
    if (p === "/presets.json") return send(200, { 0: {}, 1: { n: "Cozy", on: true, bri: 90, seg: [{ col: [[255, 120, 40]], fx: 0 }] }, 2: { n: "Party", on: true, bri: 220, seg: [{ fx: 9 }] }, 3: { n: "Focus", on: true, bri: 255, seg: [{ col: [[240, 240, 255]], fx: 0 }] } });
    if (p === "/json/state" || p === "/json") {
      if (req.method === "GET") return send(200, p === "/json" ? { state: state(), info: {}, effects: EFFECTS } : state());
      const b = json() || {};
      if (b.rb) {
        s.reboots++;
        return send(200, { success: true });
      }
      if (b.on === "t") s.on = !s.on;
      else if (typeof b.on === "boolean") s.on = b.on;
      if (typeof b.bri === "number") s.bri = b.bri;
      if (typeof b.ps === "number") {
        s.ps = b.ps;
        s.on = true;
        if (b.ps === 1) s.col = [255, 120, 40];
      }
      const seg = b.seg?.[0];
      if (seg?.col?.[0]) s.col = seg.col[0];
      if (typeof seg?.fx === "number") s.fx = seg.fx;
      return send(200, b.v ? state() : { success: true });
    }
    if (p === "/json/cfg" && req.method === "POST") {
      const b = json() || {};
      if (b.id?.name) s.name = b.id.name;
      return send(200, { success: true });
    }
    return send(404, "Not found");
  };
}

// ── Elgato Key Light ──────────────────────────────────────

export function elgatoState() {
  return { displayName: "Desk Key Light", on: 0, brightness: 40, temperature: 213, identified: 0 };
}

export function elgatoHandler(s) {
  return async ({ req, url, json, send }) => {
    const p = url.pathname;
    if (p === "/elgato/accessory-info") {
      if (req.method === "PUT") {
        const b = json() || {};
        if (b.displayName) s.displayName = b.displayName;
      }
      return send(200, { productName: "Elgato Key Light Air", hardwareBoardType: 200, hardwareRevision: 1, macAddress: "3C:6A:9D:12:34:56", firmwareBuildNumber: 218, firmwareVersion: "1.0.3", serialNumber: "CW44J1A00123", displayName: s.displayName, features: ["lights"], "wifi-info": { ssid: "Home", frequencyMHz: 2400, rssi: -55 } });
    }
    if (p === "/elgato/lights") {
      if (req.method === "PUT") {
        const l = (json() || {}).lights?.[0] || {};
        for (const k of ["on", "brightness", "temperature"]) if (l[k] !== undefined) s[k] = l[k];
      }
      return send(200, { numberOfLights: 1, lights: [{ on: s.on, brightness: s.brightness, temperature: s.temperature }] });
    }
    if (p === "/elgato/identify" && req.method === "POST") {
      s.identified++;
      return send(200, "");
    }
    return send(404, "");
  };
}

// ── Home Assistant ────────────────────────────────────────

export function haState() {
  const e = (entity_id, state, attributes) => ({ entity_id, state, attributes, last_changed: new Date().toISOString(), last_updated: new Date().toISOString(), context: {} });
  return {
    token: "demo-token",
    calls: [],
    states: [
      e("climate.living_room", "heat", { friendly_name: "Living Room Thermostat", hvac_modes: ["off", "heat", "cool", "heat_cool"], current_temperature: 19.5, temperature: 20, min_temp: 7, max_temp: 35 }),
      e("lock.front_door", "locked", { friendly_name: "Front Door Lock" }),
      e("cover.garage_door", "closed", { friendly_name: "Garage Door", device_class: "garage" }),
      e("vacuum.robo", "docked", { friendly_name: "Robot Vacuum", battery_level: 100 }),
      e("light.patio", "off", { friendly_name: "Patio Lights", supported_color_modes: ["brightness"], color_mode: null }),
      e("switch.fountain", "on", { friendly_name: "Garden Fountain", device_class: "outlet" }),
      e("scene.movie_night", "2026-11-19T20:00:00", { friendly_name: "Movie Night" }),
      e("update.front_door_lock_firmware", "on", { friendly_name: "Front Door Lock Firmware", installed_version: "1.2.0", latest_version: "1.3.1" }),
      e("sensor.back_door_battery", "12", { friendly_name: "Back Door Sensor Battery", device_class: "battery", unit_of_measurement: "%" }),
      e("sensor.outdoor_temperature", "8.4", { friendly_name: "Outdoor Temperature", device_class: "temperature", unit_of_measurement: "°C" }),
      e("switch.config_led", "on", { friendly_name: "Plug LED", entity_category: "config" }),
    ],
    areas: { "climate.living_room": "Living room", "lock.front_door": "Hallway", "cover.garage_door": "Garage", "light.patio": "Garden", "switch.fountain": "Garden", "vacuum.robo": "Hallway" },
  };
}

export function haHandler(s, { ip, port }) {
  const find = (id) => s.states.find((x) => x.entity_id === id);
  const set = (id, state, attrs = {}) => {
    const x = find(id);
    if (x) {
      x.state = state;
      Object.assign(x.attributes, attrs);
      x.last_changed = new Date().toISOString();
    }
  };
  return async ({ req, url, json, send }) => {
    const p = url.pathname;
    if (p === "/manifest.json") return send(200, { name: "Home Assistant", short_name: "Assistant" });
    if (!p.startsWith("/api")) return send(200, page("Home Assistant"));
    if (req.headers.authorization !== `Bearer ${s.token}`) return send(401, "401: Unauthorized", "text/plain");
    if (p === "/api/") return send(200, { message: "API running." });
    if (p === "/api/config") return send(200, { location_name: "Home", version: "2026.11.2", unit_system: { temperature: "°C", length: "km" }, internal_url: `http://${ip}:${port}`, time_zone: "Europe/London" });
    if (p === "/api/states") return send(200, s.states);
    const m = p.match(/^\/api\/states\/(.+)$/);
    if (m) return find(m[1]) ? send(200, find(m[1])) : send(404, { message: "Entity not found." });
    if (p === "/api/template" && req.method === "POST") return send(200, JSON.stringify(Object.entries(s.areas)), "text/plain");
    const sv = p.match(/^\/api\/services\/(\w+)\/(\w+)$/);
    if (sv && req.method === "POST") {
      const [, domain, service] = sv;
      const b = json() || {};
      s.calls.push({ domain, service, data: b });
      const id = b.entity_id;
      if (service === "turn_on") set(id, domain === "climate" ? "heat" : "on", b.brightness_pct ? { brightness: Math.round(b.brightness_pct * 2.55) } : {});
      if (service === "turn_off") set(id, "off");
      if (service === "toggle") set(id, find(id)?.state === "on" ? "off" : "on");
      if (service === "lock") set(id, "locked");
      if (service === "unlock") set(id, "unlocked");
      if (service === "open_cover") set(id, "open");
      if (service === "close_cover") set(id, "closed");
      if (service === "set_temperature") set(id, find(id)?.state, { temperature: b.temperature });
      if (service === "set_hvac_mode") set(id, b.hvac_mode);
      if (service === "start") set(id, "cleaning");
      if (service === "return_to_base") set(id, "returning");
      if (service === "install") set(id, "off", { installed_version: find(id)?.attributes.latest_version });
      return send(200, [find(id)].filter(Boolean));
    }
    return send(404, { message: "Not found" });
  };
}
