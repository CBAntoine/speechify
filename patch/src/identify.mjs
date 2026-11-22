// "What exactly is that?" Collects every clue a device gives away about itself and turns them into
// a maker, model, operating system and a plain description, with how sure Patch is and why.
//
// Clues, most exact first: the device's own announcements (Bonjour/mDNS records, UPnP descriptions,
// Spotify Connect, ONVIF camera discovery, PlayStation discovery, the device's own API through its
// driver), then its name on the network (hostname, NetBIOS), then who made its network chip.
import { request } from "./net/lanhttp.mjs";
import { appleModel, fireTvModel, SPOTIFY_TYPES } from "./net/models.mjs";
import { safeJson } from "./util.mjs";

const txtOf = (host, type) => host.mdns.find((s) => s.type === type)?.txt || null;
const svc = (host, type) => host.mdns.find((s) => s.type === type) || null;
const clean = (s) => (s == null ? null : String(s).replace(/\s+/g, " ").trim() || null);

// Hostnames people's devices pick by default, and what they say about the device.
const HOSTNAME_HINTS = [
  [/^(.*[-_ ])?iphone([-_ ]|$)/i, { kind: "phone", brand: "Apple", model: "iPhone" }],
  [/^(.*[-_ ])?ipad([-_ ]|$)/i, { kind: "tablet", brand: "Apple", model: "iPad" }],
  [/macbook[-_ ]?air/i, { kind: "computer", brand: "Apple", model: "MacBook Air" }],
  [/macbook[-_ ]?pro/i, { kind: "computer", brand: "Apple", model: "MacBook Pro" }],
  [/\bimac\b|^imac/i, { kind: "computer", brand: "Apple", model: "iMac" }],
  [/mac[-_ ]?mini/i, { kind: "computer", brand: "Apple", model: "Mac mini" }],
  [/galaxy[-_ ]?(tab[-_ ]?)?[a-z]?\d{1,3}[a-z]?([-_ ](ultra|plus|fe|edge|lite|5g))?|galaxy[-_ ]?z[-_ ]?(fold|flip)\d?/i, (m) => ({ kind: /tab/i.test(m[0]) ? "tablet" : "phone", brand: "Samsung", model: tidy(m[0]) })],
  [/pixel[-_ ]?\d{0,2}[a-z]?([-_ ](pro|xl|fold|a))?/i, (m) => ({ kind: /tablet/i.test(m[0]) ? "tablet" : "phone", brand: "Google", model: tidy(m[0]) })],
  [/oneplus/i, { kind: "phone", brand: "OnePlus", model: null }],
  [/(redmi|xiaomi|poco)/i, { kind: "phone", brand: "Xiaomi", model: null }],
  [/(moto[-_ ]?[a-z]|motorola)/i, { kind: "phone", brand: "Motorola", model: null }],
  [/^android[-_]/i, { kind: "phone", brand: null, model: "Android phone or tablet" }],
  [/^(desktop|laptop)-[a-z0-9]{6,}$/i, (m) => ({ kind: "computer", brand: null, model: /^laptop/i.test(m[0]) ? "Windows laptop" : "Windows PC", os: "Windows" })],
  [/^(xbox|xboxone|xbox-series)/i, { kind: "console", brand: "Microsoft", model: "Xbox" }],
  [/^ps[45]-/i, (m) => ({ kind: "console", brand: "Sony", model: `PlayStation ${m[0][2]}` })],
  [/nintendo[-_ ]?switch|^switch$/i, { kind: "console", brand: "Nintendo", model: "Switch" }],
  [/^(echo|amazon)[-_ ](show|dot|studio|pop)?/i, (m) => ({ kind: m[2] && /show/i.test(m[2]) ? "display" : "speaker", brand: "Amazon", model: `Echo${m[2] ? ` ${m[2][0].toUpperCase()}${m[2].slice(1).toLowerCase()}` : ""}` })],
  [/^kindle/i, { kind: "tablet", brand: "Amazon", model: "Kindle" }],
  // Family calendars on the wall (they run Android, and are otherwise quiet on the network).
  [/cozyla/i, { kind: "display", brand: "Cozyla", model: "Family calendar" }],
  [/skylight/i, { kind: "display", brand: "Skylight", model: "Calendar or photo frame" }],
  [/^(ring|ringdoorbell)[-_]/i, { kind: "camera", brand: "Ring", model: "Doorbell or camera" }],
  [/^(wyze|wyzecam)/i, { kind: "camera", brand: "Wyze", model: "Camera" }],
  [/^(raspberrypi|raspberry)/i, { kind: "computer", brand: "Raspberry Pi", model: "Raspberry Pi" }],
  [/^(esp[-_]|espressif)/i, { kind: "smart", brand: null, model: "Smart-home gadget (Espressif chip)" }],
  [/^(hs1\d\d|kp\d{3}|ep\d\d|tapo)/i, { kind: "plug", brand: "TP-Link", model: "Kasa / Tapo plug" }],
  [/^(chromecast)/i, { kind: "streamer", brand: "Google", model: "Chromecast" }],
  [/^(google-home|google-nest|nest-)/i, { kind: "speaker", brand: "Google", model: "Nest speaker or display" }],
  [/^(roku)/i, { kind: "streamer", brand: "Roku", model: null }],
  [/^(lgwebostv|lg-tv|webos)/i, { kind: "tv", brand: "LG", model: "webOS TV" }],
  [/^(samsung|tizen)/i, { kind: "tv", brand: "Samsung", model: null }],
  [/(brw|brn)[0-9a-f]{12}/i, { kind: "printer", brand: "Brother", model: null }],
  [/^(hp|npi)[0-9a-f]{6}/i, { kind: "printer", brand: "HP", model: null }],
  [/^(epson)/i, { kind: "printer", brand: "Epson", model: null }],
];

/** "galaxy-s23-ultra" → "Galaxy S23 Ultra" */
const tidy = (s) =>
  String(s)
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((w) => (/^[a-z]\d/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ")
    .replace(/\b(\d+)([a-z])\b/gi, (x, n, l) => `${n}${l.toLowerCase()}`);

function fromHostname(names) {
  for (const raw of names) {
    const n = String(raw).replace(/\.(local|lan|home|localdomain)$/i, "");
    for (const [re, v] of HOSTNAME_HINTS) {
      const m = n.match(re);
      if (m) return { ...(typeof v === "function" ? v(m) : v), via: `its network name (“${n}”)` };
    }
  }
  return null;
}

/**
 * Active checks that only make sense for some hosts: Spotify Connect's getInfo (exact speaker/TV
 * model) and Sony's Bravia info endpoint. Adds host.extra.spotify / host.extra.sony.
 */
export async function probeIdentity(host) {
  host.extra ||= {};
  const sp = svc(host, "_spotify-connect._tcp");
  if (sp?.port) {
    const path = String(sp.txt?.cpath || "/zc").replace(/^([^/])/, "/$1");
    try {
      const res = await request({ url: `http://${host.ip}:${sp.port}${path}?action=getInfo&version=2.7.1`, timeout: 2000 });
      const j = res.status === 200 ? safeJson(res.text()) : null;
      if (j && (j.modelDisplayName || j.remoteName || j.deviceType)) host.extra.spotify = j;
    } catch {
      /* not answering */
    }
  }
  if (host.ports.has(80) && (/sony/i.test(host.vendor || "") || host.ssdp.some((r) => /sony|bravia|ScalarWebAPI/i.test(`${r.server} ${r.st} ${r.desc?.manufacturer || ""}`)))) {
    try {
      const res = await request({ url: `http://${host.ip}/sony/system`, method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "getInterfaceInformation", id: 1, params: [], version: "1.0" }), timeout: 2000 });
      const r = safeJson(res.text())?.result?.[0];
      if (r?.modelName) host.extra.sony = r;
    } catch {
      /* not a Bravia */
    }
  }
}

/**
 * Everything the host told us, boiled down. Returns
 * { kind, brand, model, modelNumber, os, name, exact, evidence: [..] } (fields may be null).
 */
export function factsFor(host) {
  const f = { kind: null, brand: null, model: null, modelNumber: null, os: null, name: null, room: null, exact: false, evidence: [] };
  const set = (vals, via, exact = false) => {
    let used = false;
    for (const [k, v] of Object.entries(vals)) {
      if (v == null || v === "" || k === "via") continue;
      if (f[k] == null || (exact && !f.exact && ["model", "kind", "brand"].includes(k))) {
        f[k] = v;
        used = true;
      }
    }
    if (exact && (vals.model || vals.modelNumber)) f.exact = true;
    if (used && via && !f.evidence.includes(via)) f.evidence.push(via);
  };

  // Apple devices name their exact model in several Bonjour records.
  for (const t of ["_companion-link._tcp", "_device-info._tcp", "_airplay._tcp", "_raop._tcp"]) {
    const txt = txtOf(host, t);
    const code = txt?.rpmd || txt?.model || txt?.am;
    const am = code && appleModel(code);
    if (am) {
      set({ kind: am.kind, brand: "Apple", model: am.name, modelNumber: am.code, os: { phone: "iOS", tablet: "iPadOS", streamer: "tvOS", speaker: "HomePod software", computer: "macOS" }[am.kind] || null }, "its Apple Bonjour announcement", am.exact);
      break;
    }
  }
  // Third-party AirPlay speakers and TVs say who made them.
  const air = txtOf(host, "_airplay._tcp");
  if (air?.manufacturer && !/apple/i.test(air.manufacturer)) set({ brand: clean(air.manufacturer), model: clean(air.model) }, "its AirPlay announcement", !!air.model);

  const cast = svc(host, "_googlecast._tcp");
  if (cast?.txt?.md) set({ brand: /google|nest|chromecast/i.test(cast.txt.md) ? "Google" : null, model: clean(cast.txt.md), name: clean(cast.txt.fn) }, "its Google Cast announcement", true);

  const sp = host.extra?.spotify;
  if (sp) set({ kind: SPOTIFY_TYPES[sp.deviceType] || null, brand: clean(sp.brandDisplayName), model: clean(sp.modelDisplayName), name: clean(sp.remoteName) }, "Spotify Connect", !!sp.modelDisplayName);

  const sony = host.extra?.sony;
  if (sony) set({ kind: sony.productCategory === "tv" ? "tv" : null, brand: "Sony", model: clean(`${sony.productName || ""} ${sony.modelName}`), modelNumber: clean(sony.modelName) }, "Sony's device API", true);

  const hap = txtOf(host, "_hap._tcp");
  if (hap?.md) set({ model: clean(hap.md) }, "its HomeKit announcement", true);

  const ipp = txtOf(host, "_ipp._tcp") || txtOf(host, "_ipps._tcp") || txtOf(host, "_printer._tcp") || txtOf(host, "_pdl-datastream._tcp");
  if (ipp?.ty || ipp?.usb_mdl) set({ kind: "printer", brand: clean(ipp.usb_mfg) || clean(String(ipp.ty || "").split(" ")[0]), model: clean(ipp.ty || `${ipp.usb_mfg || ""} ${ipp.usb_mdl}`) }, "its printer announcement", true);

  const esp = txtOf(host, "_esphomelib._tcp");
  if (esp) set({ kind: "smart", brand: "ESPHome", model: clean(esp.project_name?.replace(/\./g, " ")) || clean(esp.board) || "ESPHome device", name: clean(esp.friendly_name), os: esp.version ? `ESPHome ${esp.version}` : "ESPHome" }, "its ESPHome announcement", !!esp.project_name);

  const amzn = txtOf(host, "_amzn-wplay._tcp");
  if (amzn) {
    const ft = fireTvModel(amzn.ad || amzn.md);
    set({ kind: ft?.kind || "streamer", brand: "Amazon", model: ft?.name || "Fire TV", name: clean(amzn.n), os: "Fire OS" }, "its Fire TV announcement", !!ft?.exact);
  }
  if (svc(host, "_androidtvremote2._tcp")) set({ kind: "tv", os: "Android TV / Google TV", name: clean(svc(host, "_androidtvremote2._tcp").name) }, "its Android TV announcement");

  const thread = txtOf(host, "_meshcop._udp");
  if (thread?.vn || thread?.mn) set({ brand: clean(thread.vn), model: clean(thread.mn) }, "its Thread border-router announcement", !!thread.mn);

  const nano = txtOf(host, "_nanoleafapi._tcp");
  if (nano) set({ kind: "light", brand: "Nanoleaf", model: clean(nano.md) || "Nanoleaf light panels" }, "its Nanoleaf announcement", !!nano.md);

  // UPnP descriptions: manufacturer and model straight from the device.
  for (const r of host.ssdp) {
    const d = r.desc;
    if (!d?.modelName && !d?.manufacturer) continue;
    const brand = clean(d.manufacturer)?.replace(/\b(Corporation|Corp\.?|Inc\.?|Co\.,? ?Ltd\.?|Ltd\.?|Electronics|International)\b/gi, "").replace(/[,\s]+$/, "").trim();
    // Some routers put their firmware version in modelNumber; that isn't a model.
    const number = clean(d.modelNumber) && d.modelNumber !== d.modelName && !/^v?\d+(\.\d+)+$/i.test(d.modelNumber.trim()) ? clean(d.modelNumber) : null;
    set({ brand, model: clean(d.modelName), modelNumber: number, name: clean(d.friendlyName) }, "its UPnP description", !!d.modelName);
    const ft = fireTvModel(d.modelName);
    if (ft) set({ kind: ft.kind, brand: "Amazon", model: ft.name, os: "Fire OS" }, "its UPnP description", true);
    break;
  }

  const cam = host.extra?.wsd?.onvif;
  if (cam) set({ kind: "camera", brand: clean(cam.name || cam.manufacturer), model: clean(cam.hardware), room: clean(cam.location) }, "its ONVIF camera announcement", !!cam.hardware);
  else if (host.extra?.wsd?.types?.some((t) => /Print/i.test(t))) set({ kind: "printer" }, "its WS-Discovery announcement");

  const ps = host.extra?.ddp;
  if (ps) set({ kind: "console", brand: "Sony", model: ps.type === "PS5" ? "PlayStation 5" : ps.type === "PS4" ? "PlayStation 4" : ps.type, name: clean(ps.name), os: ps.systemVersion ? `System software ${ps.systemVersion}` : null }, "PlayStation discovery", true);

  const fromName = fromHostname([...host.hostnames, ...(host.netbios ? [host.netbios] : [])]);
  if (fromName) set(fromName, fromName.via);
  return f;
}

const KIND_WORD = {
  tv: "TV", streamer: "streaming player", speaker: "speaker", display: "smart display", phone: "phone", tablet: "tablet", computer: "computer",
  printer: "printer", camera: "camera", console: "games console", router: "router", network: "network equipment", nas: "network storage",
  light: "light", plug: "smart plug", switch: "switch", strip: "power strip", thermostat: "thermostat", lock: "lock", hub: "smart-home hub",
  watch: "watch", vacuum: "robot vacuum", smart: "smart-home device", personal: "phone, tablet or laptop", group: "speaker group", room: "room of lights",
  sensor: "sensor", fan: "fan", cover: "blinds", garage: "garage door", appliance: "appliance", media: "media player", scene: "scene",
};

/** Words that say what kind of thing a name already is ("Fire TV Stick" is clearly a streamer). */
const SELF_DESCRIBING = /\b(tv|television|stick|cube|chromecast|speaker|soundbar|homepod|sonos|echo|printer|camera|cam|doorbell|router|iphone|ipad|macbook|imac|mac mini|mac studio|mac pro|playstation|xbox|switch|bulb|lamp|light|lights|plug|strip|thermostat|hub|bridge|vacuum|roku|kindle|pixel|galaxy|watch|display|nest|pc|computer|laptop|server|raspberry pi|nas|diskstation|streamer|player|receiver)\b/i;

/**
 * One line that says exactly what a device is, e.g. "Samsung 65\" Q80B Smart TV (model QN65Q80BAFXZA)",
 * "Apple iPhone 14 Pro", "Amazon Fire TV Stick 4K Max". Works on public device records.
 */
export function describeDevice(d) {
  if (d.driver === "homeassistant" && d.parent) {
    // An entity in Home Assistant: say what it is and where it lives.
    const w = /script/i.test(d.model || "") ? "script" : KIND_WORD[d.kind] || "device";
    return `${w.charAt(0).toUpperCase()}${w.slice(1)} in Home Assistant`;
  }
  const brand = d.brand && d.brand !== "Home Assistant" ? d.brand : null;
  let model = d.model && !/^via Home Assistant$/i.test(d.model) ? d.model : null;
  const word = KIND_WORD[d.kind] || null;
  if (model && d.info?.guess && model === d.info.guess) {
    // A guess from indirect clues: say what it probably is, then why.
    return `${(word || "Device").replace(/^./, (c) => c.toUpperCase())} (${model.charAt(0).toLowerCase()}${model.slice(1)})`;
  }
  if (model && brand) {
    if (model.toLowerCase().startsWith(brand.toLowerCase())) model = model.slice(brand.length).trim();
    // "Philips Hue" + "Hue Bridge" → "Philips Hue Bridge"
    const last = brand.split(" ").at(-1).toLowerCase();
    if (model.toLowerCase().startsWith(`${last} `)) model = model.slice(last.length + 1);
  }
  let text = [brand, model].filter(Boolean).join(" ");
  if (word && !SELF_DESCRIBING.test(text)) text = text ? `${text} ${word}` : word.charAt(0).toUpperCase() + word.slice(1);
  if (!text) text = "Unknown device";
  const number = d.info?.modelNumber && !text.includes(d.info.modelNumber) ? d.info.modelNumber : null;
  if (number && !/^[a-f0-9]{12,}$/i.test(number)) text += text.endsWith(")") ? `, model ${number}` : ` (model ${number})`;
  if (!brand && !model && d.vendor && d.kind !== "personal") text += `, network chip by ${d.vendor}`;
  return text.replace(/\s+/g, " ").trim();
}

/** How sure Patch is about what a device is: "exact" (it said so), "likely" (strong clues) or "guess". */
export function confidenceOf(d) {
  if (d.self) return "exact";
  if (d.driver && !["generic", "upnp"].includes(d.driver)) return "exact";
  if (d.info?.identity?.exact) return "exact";
  if (d.brand && d.model && d.kind !== "unknown") return "likely";
  if (d.kind && d.kind !== "unknown" && (d.brand || d.model)) return "likely";
  return "guess";
}
