// MAC address → manufacturer ("Espressif", "Sonos", "Apple"…). The first three bytes of a hardware
// address identify the company that made the network chip. The public IEEE registry is downloaded once
// (about 3 MB, no personal data is sent) and cached in the data folder.
import fs from "node:fs/promises";
import path from "node:path";
import { isRandomizedMac, normalizeMac } from "../util.mjs";

const SOURCES = [
  { url: "https://standards-oui.ieee.org/oui/oui.csv", parse: parseIeeeCsv },
  { url: "https://www.wireshark.org/download/automated/data/manuf", parse: parseWiresharkManuf },
];

// A handful of prefixes that matter for identifying smart-home gear before the registry is downloaded.
const BUILTIN = {
  "001788": "Philips Lighting",
  b827eb: "Raspberry Pi",
  dca632: "Raspberry Pi",
  e45f01: "Raspberry Pi",
  "000e58": "Sonos",
};

let table = null;
let loading = null;

function csvRow(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseIeeeCsv(text) {
  const map = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.startsWith("MA-L,")) continue;
    const [, hex, org] = csvRow(line);
    if (/^[0-9A-F]{6}$/i.test(hex) && org) map[hex.toLowerCase()] = shortVendor(org);
  }
  return map;
}

export function parseWiresharkManuf(text) {
  const map = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (!line || line[0] === "#") continue;
    const f = line.split("\t");
    const prefix = f[0].trim();
    if (!/^[0-9A-F]{2}:[0-9A-F]{2}:[0-9A-F]{2}$/i.test(prefix)) continue; // skip /28 and /36 blocks
    const name = (f[2] || f[1] || "").trim();
    if (name) map[prefix.replace(/:/g, "").toLowerCase()] = shortVendor(name);
  }
  return map;
}

const SPECIAL = [
  [/^tp-?link/i, "TP-Link"], [/^asustek|^asus/i, "ASUS"], [/^hon hai|foxconn/i, "Foxconn"], [/^samsung/i, "Samsung"],
  [/^lg electronics|^lg innotek/i, "LG"], [/^sony/i, "Sony"], [/^apple/i, "Apple"], [/^google/i, "Google"],
  [/^amazon/i, "Amazon"], [/^espressif/i, "Espressif"], [/^raspberry pi/i, "Raspberry Pi"], [/^sonos/i, "Sonos"],
  [/^roku/i, "Roku"], [/^netgear/i, "Netgear"], [/^ubiquiti/i, "Ubiquiti"], [/^eero/i, "eero"], [/^intel/i, "Intel"],
  [/^microsoft/i, "Microsoft"], [/^nintendo/i, "Nintendo"], [/^hewlett|^hp inc/i, "HP"], [/^dell/i, "Dell"],
  [/^lenovo/i, "Lenovo"], [/^xiaomi|^beijing xiaomi/i, "Xiaomi"], [/^huawei/i, "Huawei"], [/^murata/i, "Murata"],
  [/^signify|^philips lighting/i, "Philips Lighting"], [/^arcadyan/i, "Arcadyan"], [/^sagemcom/i, "Sagemcom"],
  [/^technicolor/i, "Technicolor"], [/^nest labs/i, "Nest"], [/^ring llc/i, "Ring"], [/^wyze/i, "Wyze"],
  [/^tuya/i, "Tuya"], [/^shenzhen/i, null], [/^seiko epson|^epson/i, "Epson"], [/^brother/i, "Brother"], [/^canon/i, "Canon"],
  [/^synology/i, "Synology"], [/^qnap/i, "QNAP"], [/^hikvision|hangzhou hikvision/i, "Hikvision"], [/^dahua|zhejiang dahua/i, "Dahua"],
  [/^ecobee/i, "ecobee"], [/^belkin/i, "Belkin"], [/^lifi labs/i, "LIFX"], [/^logitech/i, "Logitech"], [/^nvidia/i, "NVIDIA"],
];

/** "TP-LINK TECHNOLOGIES CO.,LTD." → "TP-Link", "Espressif Inc." → "Espressif" */
export function shortVendor(org) {
  const s = String(org).trim();
  for (const [re, name] of SPECIAL) if (re.test(s) && name) return name;
  let n = s
    .replace(/\(.*?\)/g, " ")
    .replace(/[,.]?\s*\b(inc|incorporated|ltd|limited|llc|l\.l\.c|co|corp|corporation|company|gmbh|ag|bv|b\.v|sa|s\.a|s\.p\.a|spa|plc|pty|kg|oy|ab|as|srl|sas|kk|k\.k)\b\.?/gi, " ")
    .replace(/\b(technologies|technology|tech|electronics|electronic|electric|international|holdings|trading|communications|communication|systems|industrial|manufacturing|group)\b/gi, " ")
    .replace(/^shenzhen\s+|^guangzhou\s+|^hangzhou\s+|^beijing\s+|^shanghai\s+/i, "")
    .replace(/[,.\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!n) n = s;
  if (n === n.toUpperCase() && n.length > 4) n = n.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return n.slice(0, 40);
}

export async function loadOui(dataDir) {
  if (table) return table;
  try {
    table = JSON.parse(await fs.readFile(path.join(dataDir, "oui.json"), "utf8"));
  } catch {
    table = null;
  }
  return table;
}

/** Download the registry once. Safe to call repeatedly; failures leave the built-in list in place. */
export function ensureOui(dataDir, { enabled = true } = {}) {
  if (table || !enabled) return Promise.resolve(table);
  loading ??= (async () => {
    if (await loadOui(dataDir)) return table;
    for (const src of SOURCES) {
      try {
        const res = await fetch(src.url, { signal: AbortSignal.timeout(25_000), headers: { "user-agent": "Patch/1.0 (home network assistant)" } });
        if (!res.ok) continue;
        const map = src.parse(await res.text());
        if (Object.keys(map).length < 1000) continue;
        table = map;
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(path.join(dataDir, "oui.json"), JSON.stringify(map));
        return table;
      } catch {
        /* try the next source */
      }
    }
    return null;
  })().finally(() => {
    loading = null;
  });
  return loading;
}

export function vendorOf(mac) {
  const m = normalizeMac(mac);
  if (!m) return null;
  if (isRandomizedMac(m)) return null;
  const key = m.replace(/:/g, "").slice(0, 6);
  return table?.[key] ?? BUILTIN[key] ?? null;
}

export function setOuiTable(map) {
  table = map;
}
