// Builds src/net/oui-data.ts: which company each network card prefix (OUI) belongs to, for the
// makers you're likely to find on a home network. The source is the IEEE registry, as published
// at https://standards-oui.ieee.org (or the copy arp-scan keeps, in the same <prefix><TAB><name>
// form: https://raw.githubusercontent.com/royhills/arp-scan/master/ieee-oui.txt).
//
//   node scripts/build-oui.ts path/to/ieee-oui.txt

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Registry name → the name people know, and what kind of device it usually is (if it says).
const VENDORS: [RegExp, string, string?][] = [
  [/^Apple, Inc/i, "Apple"],
  [/^Samsung Electronics|^SAMSUNG ELECTRO/i, "Samsung"],
  [/^Google, Inc|^Google LLC/i, "Google"],
  [/^Nest Labs/i, "Google Nest", "Smart home device"],
  [/^Amazon Technologies|^Amazon\.com/i, "Amazon"],
  [/^Ring LLC/i, "Ring", "Camera"],
  [/^Espressif/i, "Espressif", "Smart home device"],
  [/^Tuya Smart/i, "Tuya", "Smart home device"],
  [/^Sonos/i, "Sonos", "Speaker"],
  [/^Roku/i, "Roku", "TV or streaming device"],
  [/^LG Electronics|^LG Innotek/i, "LG"],
  [/^Sony Interactive Entertainment/i, "Sony PlayStation", "Game console"],
  [/^Sony Corporation|^Sony Mobile|^Sony Visual/i, "Sony"],
  [/^Nintendo/i, "Nintendo", "Game console"],
  [/^Microsoft/i, "Microsoft"],
  [/^Valve Corporation/i, "Valve"],
  [/^Meta Platforms|^Oculus VR/i, "Meta"],
  [/^Intel Corporat/i, "Intel"],
  [/^Raspberry Pi/i, "Raspberry Pi", "Computer"],
  [/^Hewlett Packard$|^HP Inc/i, "HP"],
  [/^Dell Inc/i, "Dell", "Computer"],
  [/^LCFC|^Lenovo/i, "Lenovo"],
  [/^Brother Industries/i, "Brother", "Printer"],
  [/^Canon Inc/i, "Canon"],
  [/^Seiko Epson/i, "Epson", "Printer"],
  [/^Xerox/i, "Xerox", "Printer"],
  [/^Lexmark/i, "Lexmark", "Printer"],
  [/Hikvision/i, "Hikvision", "Camera"],
  [/Ezviz/i, "EZVIZ", "Camera"],
  [/Dahua/i, "Dahua", "Camera"],
  [/Reolink/i, "Reolink", "Camera"],
  [/^Wyze/i, "Wyze", "Camera"],
  [/^Arlo Technolog/i, "Arlo", "Camera"],
  [/^Ubiquiti/i, "Ubiquiti"],
  [/^TP-LINK|^TP-Link/i, "TP-Link"],
  [/^MERCUSYS/i, "Mercusys", "Router"],
  [/Tenda Technology/i, "Tenda", "Router"],
  [/^NETGEAR/i, "Netgear"],
  [/^ASUSTek/i, "ASUS"],
  [/^Belkin/i, "Belkin"],
  [/^Linksys/i, "Linksys", "Router"],
  [/^D-Link/i, "D-Link"],
  [/^eero inc/i, "eero", "Router"],
  [/^AVM Audiovisuelles|^AVM GmbH/i, "AVM FRITZ!", "Router"],
  [/^Sagemcom/i, "Sagemcom", "Router"],
  [/^Arcadyan/i, "Arcadyan", "Router"],
  [/^Technicolor|^Vantiva/i, "Technicolor", "Router"],
  [/^ARRIS|^Commscope/i, "ARRIS", "Router"],
  [/^ASKEY COMPUTER/i, "Askey", "Router"],
  [/^Fiberhome/i, "FiberHome", "Router"],
  [/^Zyxel/i, "Zyxel"],
  [/^HUAWEI|^Huawei/i, "Huawei"],
  [/^zte corporation/i, "ZTE"],
  [/^Xiaomi|^Beijing Xiaomi/i, "Xiaomi"],
  [/^GUANGDONG OPPO/i, "OPPO", "Phone or tablet"],
  [/^vivo Mobile/i, "vivo", "Phone or tablet"],
  [/^OnePlus/i, "OnePlus", "Phone or tablet"],
  [/^Motorola Mobility/i, "Motorola", "Phone or tablet"],
  [/^Realme/i, "realme", "Phone or tablet"],
  [/^Honor Device/i, "Honor", "Phone or tablet"],
  [/^Nothing Technology/i, "Nothing", "Phone or tablet"],
  [/^Fairphone/i, "Fairphone", "Phone or tablet"],
  [/^Nokia Corporation|^HMD Global/i, "Nokia"],
  [/^Signify|^Philips Lighting/i, "Philips Hue", "Smart home device"],
  [/^TP Vision/i, "Philips TV", "TV or streaming device"],
  [/^ecobee/i, "ecobee", "Smart home device"],
  [/^iRobot/i, "iRobot", "Smart home device"],
  [/Roborock/i, "Roborock", "Smart home device"],
  [/^Dreame/i, "Dreame", "Smart home device"],
  [/^ECOVACS/i, "Ecovacs", "Smart home device"],
  [/^Chamberlain/i, "Chamberlain myQ", "Smart home device"],
  [/^SimpliSafe/i, "SimpliSafe", "Smart home device"],
  [/^Lumi United/i, "Aqara", "Smart home device"],
  [/Meross Technology/i, "Meross", "Smart home device"],
  [/^LIFI Labs/i, "LIFX", "Smart home device"],
  [/Intellirocks/i, "Govee", "Smart home device"],
  [/^BSH Hausger/i, "Bosch/Siemens appliance", "Smart home device"],
  [/^Miele/i, "Miele", "Smart home device"],
  [/^Whirlpool/i, "Whirlpool", "Smart home device"],
  [/^Logitech/i, "Logitech"],
  [/^Bose Corporation/i, "Bose", "Speaker"],
  [/^D&M Holdings/i, "Denon/Marantz", "Speaker"],
  [/^Yamaha Corporation/i, "Yamaha"],
  [/^Synology/i, "Synology", "NAS"],
  [/^QNAP/i, "QNAP", "NAS"],
  [/^Western Digital/i, "Western Digital"],
  [/^Vizio/i, "Vizio", "TV or streaming device"],
  [/^Hisense/i, "Hisense", "TV or streaming device"],
  [/^TCL King|^TCL Technoly|^TCL Commun/i, "TCL"],
  [/^Panasonic/i, "Panasonic"],
  [/^NVIDIA/i, "NVIDIA"],
  [/^Tesla/i, "Tesla"],
  [/^Fitbit/i, "Fitbit"],
  [/^Garmin/i, "Garmin"],
  [/^Peloton/i, "Peloton"],
  [/^Withings/i, "Withings", "Smart home device"],
  [/^Anker Innovations/i, "Anker eufy"],
];

const [src] = process.argv.slice(2);
if (!src) {
  console.error("Usage: node scripts/build-oui.ts path/to/ieee-oui.txt");
  process.exit(2);
}

const groups = new Map<string, string[]>();
for (const line of fs.readFileSync(src, "utf8").split("\n")) {
  if (!line || line.startsWith("#")) continue;
  const [prefix, name] = line.split("\t");
  if (!prefix || !name || !/^[0-9A-F]{6}([0-9A-F]|[0-9A-F]{3})?$/i.test(prefix)) continue;
  const hit = VENDORS.find(([re]) => re.test(name.trim()));
  if (!hit) continue;
  const key = hit[2] ? `${hit[1]}~${hit[2]}` : hit[1];
  groups.set(key, [...(groups.get(key) ?? []), prefix.toLowerCase()]);
}

const lines = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, list]) => `${k}|${list.sort().join(",")}`);
const out = `// Generated by scripts/build-oui.ts from the IEEE registry of network card prefixes. Don't edit.
// Each line: name[~usual kind of device]|prefixes (6, 7 or 9 hex digits).
export const OUI_DATA = \`
${lines.join("\n")}
\`;
`;
const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "net", "oui-data.ts");
fs.writeFileSync(dest, out);
console.log(`${[...groups.values()].reduce((n, l) => n + l.length, 0)} prefixes from ${groups.size} makers → ${path.relative(process.cwd(), dest)} (${out.length} bytes)`);
