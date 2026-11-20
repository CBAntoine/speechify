// Everything else on the network: works out what a device probably is from the clues it gives away
// (manufacturer, services it advertises, open ports, its name) and offers what's possible for any
// device: naming it, putting it in a room, opening its web page, and Wake-on-LAN for computers.
import { isRandomizedMac, prettyHostname } from "../util.mjs";

const APPLE = [
  [/^iPhone/, "phone", "iPhone"], [/^iPad/, "tablet", "iPad"], [/^AppleTV/, "streamer", "Apple TV"],
  [/^AudioAccessory5/, "speaker", "HomePod mini"], [/^AudioAccessory/, "speaker", "HomePod"], [/^Watch/, "watch", "Apple Watch"],
  [/^MacBook/, "computer", "MacBook"], [/^(iMac|Macmini|MacPro|Mac\d)/, "computer", "Mac"], [/^TimeCapsule|^AirPort/, "network", "AirPort"],
];

const HAP = { 2: "hub", 3: "fan", 4: "garage", 5: "light", 6: "lock", 7: "plug", 8: "switch", 9: "thermostat", 10: "sensor", 11: "camera", 12: "sensor", 13: "sensor", 14: "cover", 15: "switch", 16: "network", 17: "camera", 18: "camera", 19: "appliance", 20: "appliance", 21: "appliance", 22: "appliance", 23: "appliance", 28: "appliance", 31: "tv", 33: "network", 34: "speaker", 35: "streamer", 36: "streamer" };

const VENDOR_KIND = [
  [/hikvision|dahua|reolink|amcrest|lorex|wyze|arlo|eufy|blink|ring|annke|swann|uniview|foscam|tapo cam/i, "camera"],
  [/raspberry pi/i, "computer"],
  [/espressif|tuya|itead|sonoff|shelly|belkin|wemo|meross|lifi|govee|nanoleaf|ecovacs|broadlink|wiz|signify|philips lighting/i, "smart"],
  [/sonos|bose|denon|marantz|yamaha|harman|bang|bluesound/i, "speaker"],
  [/roku|vizio|hisense|tcl|sharp|panasonic|tp vision|skyworth|funai/i, "tv"],
  [/nintendo|sony interactive|valve/i, "console"],
  [/synology|qnap|western digital|seagate|asustor|terramaster|buffalo/i, "nas"],
  [/ecobee|nest|honeywell|resideo|tado|netatmo/i, "thermostat"],
  [/irobot|roborock|ecovacs|dreame|shark/i, "vacuum"],
  [/brother|canon|epson|lexmark|xerox|kyocera|ricoh|konica|oki data/i, "printer"],
  [/netgear|ubiquiti|eero|linksys|arris|technicolor|sagemcom|arcadyan|plume|avm|zyxel|mikrotik|cisco|d-link|tenda|mercusys|actiontec|calix|nokia shanghai|commscope|askey|sercomm/i, "network"],
  [/intel|dell|lenovo|acer|micro-star|msi|gigabyte|realtek|liteon|lite-on|azurewave|chicony|compal|quanta|wistron|pegatron|framework|system76|clevo/i, "computer"],
];

export const KIND_LABEL = {
  router: "Router", network: "Network equipment", computer: "Computer", phone: "Phone", tablet: "Tablet", personal: "Phone, tablet or laptop",
  tv: "TV", streamer: "Streaming player", speaker: "Speaker", display: "Smart display", light: "Light", plug: "Smart plug", switch: "Switch",
  strip: "Power strip", sensor: "Sensor", thermostat: "Thermostat", camera: "Camera", printer: "Printer", nas: "Network storage",
  console: "Game console", hub: "Smart-home hub", smart: "Smart-home device", media: "Media player", fan: "Fan", cover: "Blinds",
  garage: "Garage door", lock: "Lock", vacuum: "Robot vacuum", scene: "Scene", room: "Room", group: "Speaker group", watch: "Watch",
  appliance: "Appliance", unknown: "Unknown device",
};

function appleModel(host) {
  for (const s of host.mdns) {
    const m = s.txt?.model || s.txt?.am || s.txt?.rpmd;
    if (typeof m === "string" && /^(iPhone|iPad|AppleTV|AudioAccessory|Watch|MacBook|iMac|Macmini|MacPro|Mac\d|TimeCapsule|AirPort)/.test(m)) return m;
  }
  return null;
}

/** Best guess at { kind, brand, model, nameHint } for a host with no dedicated driver. */
export function classify(host) {
  const types = new Set(host.mdns.map((s) => s.type));
  const ports = host.ports;
  const vendor = host.vendor || "";
  const title = `${host.http?.[80]?.title || ""} ${host.http?.[443]?.title || ""} ${host.http?.[5000]?.title || ""} ${host.http?.[8080]?.title || ""}`;
  const apple = appleModel(host);
  if (apple) {
    const hit = APPLE.find(([re]) => re.test(apple));
    if (hit) return { kind: hit[1], brand: "Apple", model: hit[2] };
  }
  const hap = host.mdns.find((s) => s.type === "_hap._tcp");
  if (hap?.txt?.ci && HAP[hap.txt.ci]) return { kind: HAP[hap.txt.ci], brand: vendor || null, model: hap.txt.md || "HomeKit accessory" };
  if (host.isGateway) return { kind: "router", brand: vendor || null, model: null };
  if ([...types].some((t) => /_ipps?\._tcp|_printer|_pdl-datastream|_uscan|_scanner/.test(t)) || ports.has(9100) || ports.has(631)) return { kind: "printer", brand: vendor || null, model: null };
  if (types.has("_amzn-wplay._tcp")) return { kind: "streamer", brand: "Amazon", model: "Fire TV" };
  if (types.has("_androidtvremote2._tcp")) return { kind: "tv", brand: vendor || null, model: "Android / Google TV" };
  if (types.has("_home-assistant._tcp") || ports.has(8123)) return { kind: "hub", brand: "Home Assistant", model: null };
  if (types.has("_esphomelib._tcp")) return { kind: "smart", brand: "ESPHome", model: null };
  if (/synology|diskstation/i.test(title) || /synology/i.test(vendor)) return { kind: "nas", brand: "Synology", model: null };
  if (/qnap/i.test(`${title} ${vendor}`)) return { kind: "nas", brand: "QNAP", model: null };
  if (types.has("_plexmediasvr._tcp") || ports.has(32400)) return { kind: "computer", brand: vendor || null, model: "Plex media server" };
  if (ports.has(62078)) return { kind: "phone", brand: vendor || "Apple", model: "iPhone or iPad" };
  if (ports.has(554) && !ports.has(8009)) return { kind: "camera", brand: vendor || null, model: null };
  if (ports.has(3389)) return { kind: "computer", brand: vendor || null, model: "Windows PC" };
  if (types.has("_device-info._tcp") || types.has("_workstation._tcp") || types.has("_rdlink._tcp") || types.has("_nvstream_dbd._tcp")) return { kind: "computer", brand: vendor || null, model: null };
  for (const [re, kind] of VENDOR_KIND) if (re.test(vendor)) return { kind, brand: vendor, model: kind === "computer" && /raspberry/i.test(vendor) ? "Raspberry Pi" : null };
  if (ports.has(445) || ports.has(139) || ports.has(548) || ports.has(5900)) return { kind: "computer", brand: vendor || null, model: null };
  if (types.has("_airplay._tcp") || types.has("_raop._tcp") || types.has("_spotify-connect._tcp")) return { kind: "speaker", brand: vendor || null, model: null };
  if (/^(apple)$/i.test(vendor)) return { kind: "personal", brand: "Apple", model: null };
  if (/^(samsung|lg|sony)$/i.test(vendor)) return { kind: ports.has(8001) || ports.has(8002) || ports.has(9197) || ports.has(3000) || ports.has(3001) ? "tv" : "personal", brand: vendor, model: null };
  if (/^(google)$/i.test(vendor)) return { kind: "smart", brand: "Google", model: null };
  if (/^(amazon)$/i.test(vendor)) return { kind: "smart", brand: "Amazon", model: "Echo, Fire TV or Ring" };
  if (/^(microsoft)$/i.test(vendor)) return { kind: ports.size ? "computer" : "console", brand: "Microsoft", model: null };
  if (ports.has(22)) return { kind: "computer", brand: vendor || null, model: null };
  if (host.randomMac) return { kind: "personal", brand: null, model: "Uses a private Wi-Fi address" };
  return { kind: "unknown", brand: vendor || null, model: null };
}

/** The most human name the device gives away about itself. */
export function nameHint(host) {
  const svcName = (t) => host.mdns.find((s) => s.type === t)?.name;
  const candidates = [
    svcName("_companion-link._tcp"),
    svcName("_device-info._tcp"),
    svcName("_airplay._tcp"),
    svcName("_raop._tcp")?.replace(/^[0-9A-F]{12}@/i, ""),
    svcName("_workstation._tcp")?.replace(/\s*\[[0-9a-f:]+\]$/i, ""),
    svcName("_smb._tcp"),
    svcName("_spotify-connect._tcp"),
    svcName("_hap._tcp"),
    host.netbios,
    ...[...host.hostnames].map(prettyHostname),
  ].filter((n) => n && n.length > 1 && !/^(localhost|unknown|android|espressif|esp_[0-9a-f]+)$/i.test(n));
  return candidates[0] || null;
}

const WEB_PORTS = [
  [443, (ip) => `https://${ip}/`], [80, (ip) => `http://${ip}/`], [5001, (ip) => `https://${ip}:5001/`], [5000, (ip) => `http://${ip}:5000/`],
  [8080, (ip) => `http://${ip}:8080/`], [8443, (ip) => `https://${ip}:8443/`], [32400, (ip) => `http://${ip}:32400/web`], [8123, (ip) => `http://${ip}:8123/`],
];

export function webUrlFor(host) {
  // Prefer plain HTTP when both are open: home devices' HTTPS pages nearly always use self-signed certificates.
  if (host.ports.has(80) && host.http?.[80]?.status && host.http[80].status < 500) return `http://${host.ip}/`;
  for (const [p, f] of WEB_PORTS) if (host.ports.has(p)) return f(host.ip);
  return null;
}

export default {
  id: "generic",
  label: "Generic",

  async detect(host) {
    const c = classify(host);
    const hint = nameHint(host);
    const label = KIND_LABEL[c.kind] || "Device";
    const name =
      hint ||
      (c.kind === "personal" ? (c.brand ? `${c.brand} phone, tablet or laptop` : "Phone, tablet or laptop") : null) ||
      (c.model && c.brand && !c.model.includes(c.brand) ? `${c.brand} ${c.model}` : c.model) ||
      (c.brand ? `${c.brand} ${c.kind === "unknown" ? "device" : label.toLowerCase()}` : label);
    const wakeable = !!host.mac && !isRandomizedMac(host.mac) && ["computer", "nas", "console", "unknown"].includes(c.kind);
    return [
      {
        id: `host:${(host.mac || host.ip).replace(/:/g, "")}`,
        driver: "generic",
        kind: c.kind,
        brand: c.brand,
        model: c.model,
        name,
        ip: host.ip,
        ref: { ip: host.ip },
        state: {},
        info: {},
        webUrl: webUrlFor(host),
        actions: [...(wakeable ? ["wake"] : []), "rename", "set_room"],
      },
    ];
  },
};
