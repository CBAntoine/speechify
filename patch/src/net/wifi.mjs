// This computer's own WiFi link (network name, signal, channel, band) and the networks around it,
// used to spot weak signal and crowded channels. Best effort: each OS exposes this differently.
import { run } from "./interfaces.mjs";

export function bandOf(channel, freqMhz) {
  if (freqMhz) return freqMhz >= 5925 ? "6 GHz" : freqMhz >= 4900 ? "5 GHz" : "2.4 GHz";
  const c = Number(channel);
  if (!c) return null;
  return c <= 14 ? "2.4 GHz" : "5 GHz";
}

const pctFromDbm = (dbm) => Math.max(0, Math.min(100, 2 * (dbm + 100)));
const dbmFromPct = (pct) => Math.round(pct / 2 - 100);

/** `netsh wlan show interfaces` */
export function parseNetshInterfaces(text) {
  const get = (label) => String(text).match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im"))?.[1]?.trim() ?? null;
  const ssid = get("SSID");
  if (!ssid) return null;
  const signalPct = Number(get("Signal")?.replace("%", "")) || null;
  const channel = Number(get("Channel")) || null;
  const bandText = get("Band");
  return {
    ssid,
    signalPct,
    rssi: get("Rssi") ? Number(get("Rssi")) : signalPct ? dbmFromPct(signalPct) : null,
    channel,
    band: bandText ? bandText.replace(/\s*GHz/i, " GHz") : bandOf(channel),
    phy: get("Radio type"),
    rateMbps: Number(get("Receive rate \\(Mbps\\)")) || null,
    security: get("Authentication"),
  };
}

/** `netsh wlan show networks mode=bssid` */
export function parseNetshNetworks(text) {
  const out = [];
  let ssid = null;
  let cur = null;
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.match(/^SSID \d+\s*:\s*(.*)$/i);
    if (s) {
      ssid = s[1].trim() || null;
      continue;
    }
    if (/^\s*BSSID \d+/i.test(line)) {
      cur = { ssid, signalPct: null, channel: null, band: null };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const kv = line.match(/^\s*([A-Za-z ]+?)\s*:\s*(.+)$/);
    if (!kv) continue;
    const k = kv[1].toLowerCase();
    if (k === "signal") cur.signalPct = Number(kv[2].replace("%", "")) || null;
    else if (k === "channel") cur.channel = Number(kv[2]) || null;
    else if (k === "band") cur.band = kv[2].replace(/\s*GHz/i, " GHz").trim();
  }
  for (const n of out) n.band ??= bandOf(n.channel);
  return out;
}

/** `nmcli -t -f ACTIVE,SSID,SIGNAL,CHAN,FREQ,RATE,SECURITY dev wifi list` (":"-separated, "\:" escaped) */
export function parseNmcli(text) {
  const rows = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const f = line.split(/(?<!\\):/).map((x) => x.replace(/\\:/g, ":"));
    if (f.length < 6) continue;
    const freq = Number(String(f[4]).replace(/\D/g, "")) || null;
    rows.push({
      active: f[0] === "yes" || f[0] === "*",
      ssid: f[1] || null,
      signalPct: Number(f[2]) || null,
      channel: Number(f[3]) || null,
      band: bandOf(f[3], freq),
      rateMbps: Number(String(f[5]).replace(/[^\d.]/g, "")) || null,
      security: f[6] || null,
    });
  }
  const cur = rows.find((r) => r.active);
  if (!cur) return null;
  return { ssid: cur.ssid, signalPct: cur.signalPct, rssi: cur.signalPct ? dbmFromPct(cur.signalPct) : null, channel: cur.channel, band: cur.band, rateMbps: cur.rateMbps, security: cur.security, neighbors: rows.filter((r) => !r.active) };
}

/** `system_profiler SPAirPortDataType -json` (macOS) */
export function parseSystemProfiler(json) {
  const root = typeof json === "string" ? JSON.parse(json) : json;
  for (const block of root?.SPAirPortDataType || []) {
    for (const iface of block.spairport_airport_interfaces || []) {
      const cur = iface.spairport_current_network_information;
      if (!cur) continue;
      const chan = (s) => {
        const m = String(s || "").match(/^(\d+)(?:\s*\((\d(?:\.\d)?)\s*GHz)?/i);
        // macOS writes "6 (2GHz, 20MHz)" for the 2.4 GHz band.
        return m ? { channel: Number(m[1]), band: m[2] ? (m[2].startsWith("2") ? "2.4 GHz" : `${m[2]} GHz`) : bandOf(m[1]) } : { channel: null, band: null };
      };
      const sig = (s) => Number(String(s || "").match(/(-?\d+)\s*dBm/)?.[1]) || null;
      const c = chan(cur.spairport_network_channel);
      const rssi = sig(cur.spairport_signal_noise);
      return {
        ssid: cur._name && !/redacted/i.test(cur._name) ? cur._name : null,
        rssi,
        signalPct: rssi ? pctFromDbm(rssi) : null,
        channel: c.channel,
        band: c.band,
        phy: cur.spairport_network_phymode || null,
        rateMbps: Number(cur.spairport_network_rate) || null,
        security: cur.spairport_security_mode || null,
        neighbors: (iface.spairport_airport_other_local_wireless_networks || []).map((n) => {
          const nc = chan(n.spairport_network_channel);
          const r = sig(n.spairport_signal_noise);
          return { ssid: n._name || null, channel: nc.channel, band: nc.band, signalPct: r ? pctFromDbm(r) : null };
        }),
      };
    }
  }
  return null;
}

export async function wifiInfo() {
  try {
    if (process.platform === "win32") {
      const cur = parseNetshInterfaces((await run("netsh", ["wlan", "show", "interfaces"])) || "");
      if (!cur) return null;
      cur.neighbors = parseNetshNetworks((await run("netsh", ["wlan", "show", "networks", "mode=bssid"], 8000)) || "");
      return cur;
    }
    if (process.platform === "linux") {
      return parseNmcli((await run("nmcli", ["-t", "-f", "ACTIVE,SSID,SIGNAL,CHAN,FREQ,RATE,SECURITY", "dev", "wifi", "list", "--rescan", "no"], 6000)) || "");
    }
    if (process.platform === "darwin") {
      const out = await run("system_profiler", ["SPAirPortDataType", "-json"], 20000);
      return out ? parseSystemProfiler(out) : null;
    }
  } catch {
    /* best effort */
  }
  return null;
}

/**
 * How crowded is our channel, and is there a clearly better one?
 * 2.4 GHz channels overlap (only 1, 6 and 11 are independent); 5 GHz ones mostly don't.
 */
export function channelAdvice(info) {
  if (!info?.channel || !info.neighbors?.length) return null;
  const sameBand = info.neighbors.filter((n) => n.band === info.band && n.channel);
  const weight = (n) => 0.3 + (n.signalPct ?? 50) / 100;
  const load = (ch) =>
    sameBand.reduce((sum, n) => {
      const overlap = info.band === "2.4 GHz" ? Math.abs(n.channel - ch) < 5 : n.channel === ch;
      return sum + (overlap ? weight(n) : 0);
    }, 0);
  const candidates = info.band === "2.4 GHz" ? [1, 6, 11] : info.band === "5 GHz" ? [36, 40, 44, 48, 149, 153, 157, 161] : [];
  const here = load(info.channel);
  const ranked = candidates.map((ch) => ({ channel: ch, load: load(ch) })).sort((a, b) => a.load - b.load);
  const best = ranked[0];
  const competing = sameBand.filter((n) => (info.band === "2.4 GHz" ? Math.abs(n.channel - info.channel) < 5 : n.channel === info.channel)).length;
  return {
    channel: info.channel,
    band: info.band,
    competing,
    load: Math.round(here * 10) / 10,
    better: best && best.channel !== info.channel && best.load + 1 < here ? best.channel : null,
    neighbors: sameBand.length,
  };
}
