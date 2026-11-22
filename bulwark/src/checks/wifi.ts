import type { Check, CheckOutcome, Host } from "../core/types.ts";
import { fail, pass, skip } from "./common.ts";

export type WifiSecurity = "open" | "wep" | "wpa1" | "wpa2-mixed" | "wpa2" | "wpa3" | "enterprise" | "owe" | "unknown";

export function classifyNmcli(sec: string): WifiSecurity {
  const s = sec.toUpperCase();
  if (!s.trim() || s.trim() === "--") return "open";
  if (s.includes("OWE")) return "owe";
  if (s.includes("WEP")) return "wep";
  if (s.includes("802.1X")) return "enterprise";
  if (s.includes("WPA3") || s.includes("SAE")) return "wpa3";
  if (s.includes("WPA2") && s.includes("WPA1")) return "wpa2-mixed";
  if (s.includes("WPA2")) return "wpa2";
  if (s.includes("WPA")) return "wpa1";
  return "unknown";
}

export function classifyMac(mode: string): WifiSecurity {
  const s = mode.toLowerCase();
  if (/none|open/.test(s) && !/owe/.test(s)) return "open";
  if (/owe/.test(s)) return "owe";
  if (/wep/.test(s)) return "wep";
  if (/enterprise/.test(s)) return "enterprise";
  if (/wpa3/.test(s)) return "wpa3";
  if (/wpa2/.test(s) && /mixed|wpa1|wpa_wpa2/.test(s)) return "wpa2-mixed";
  if (/wpa2/.test(s)) return "wpa2";
  if (/wpa/.test(s)) return "wpa1";
  return "unknown";
}

export function classifyNetsh(auth: string, cipher: string): WifiSecurity {
  const a = auth.toLowerCase();
  const c = cipher.toLowerCase();
  if (c.includes("wep")) return "wep";
  if (a === "open" && (c === "none" || c === "")) return "open";
  if (a.includes("owe")) return "owe";
  if (a.includes("enterprise")) return "enterprise";
  if (a.includes("wpa3")) return "wpa3";
  if (a.includes("wpa2")) return c.includes("tkip") ? "wpa2-mixed" : "wpa2";
  if (a.includes("wpa")) return "wpa1";
  return "unknown";
}

/** Splits nmcli's terse output, where ":" inside a value is escaped as "\:". */
export function splitTerse(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) {
      cur += line[++i];
    } else if (line[i] === ":") {
      out.push(cur);
      cur = "";
    } else cur += line[i];
  }
  out.push(cur);
  return out;
}

async function currentWifi(host: Host): Promise<{ ssid: string; security: WifiSecurity; raw: string } | null | "none"> {
  if (host.platform === "linux") {
    if (!(await host.which("nmcli"))) return null;
    const r = await host.exec("nmcli", ["-t", "-f", "ACTIVE,SSID,SECURITY", "dev", "wifi", "list", "--rescan", "no"]);
    if (r.code !== 0) return null;
    for (const line of r.stdout.split("\n")) {
      const [active, ssid, sec] = splitTerse(line);
      if (active === "yes") return { ssid, security: classifyNmcli(sec ?? ""), raw: sec ?? "" };
    }
    return "none";
  }
  if (host.platform === "darwin") {
    const r = await host.exec("system_profiler", ["SPAirPortDataType", "-json"], { timeoutMs: 30_000 });
    if (r.code !== 0) return null;
    try {
      const data = JSON.parse(r.stdout) as { SPAirPortDataType?: { spairport_airport_interfaces?: { spairport_current_network_information?: { _name?: string; spairport_security_mode?: string } }[] }[] };
      for (const block of data.SPAirPortDataType ?? []) {
        for (const iface of block.spairport_airport_interfaces ?? []) {
          const cur = iface.spairport_current_network_information;
          if (cur?.spairport_security_mode) return { ssid: cur._name ?? "", security: classifyMac(cur.spairport_security_mode), raw: cur.spairport_security_mode };
        }
      }
      return "none";
    } catch {
      return null;
    }
  }
  const r = await host.exec("netsh", ["wlan", "show", "interfaces"]);
  if (r.code !== 0) return null;
  const get = (k: string) => r.stdout.match(new RegExp(`^\\s*${k}\\s*:\\s*(.*)$`, "mi"))?.[1]?.trim() ?? "";
  const ssid = get("SSID");
  const auth = get("Authentication");
  if (!ssid || !auth) return "none";
  return { ssid, security: classifyNetsh(auth, get("Cipher")), raw: `${auth} / ${get("Cipher")}` };
}

export const wifiSecurity: Check = {
  id: "wifi.security",
  title: "Your Wi-Fi uses weak or no encryption",
  category: "Wi-Fi",
  severity: "high",
  platforms: ["linux", "darwin", "win32"],
  why: "Wi-Fi without strong encryption lets anyone within range read what your devices send and join your network.",
  steps: [
    "Open your router's settings page (usually the address of your router, for example http://192.168.1.1).",
    "Under Wireless security, choose WPA2-Personal (AES) or WPA3-Personal and set a long password.",
    "Reconnect your devices with the new password.",
  ],
  async run(host): Promise<CheckOutcome[]> {
    const cur = await currentWifi(host);
    if (cur === null) return [skip("Couldn't read Wi-Fi details on this device.")];
    if (cur === "none") return [skip("This device isn't connected to Wi-Fi.")];
    const name = cur.ssid ? `"${cur.ssid}"` : "The Wi-Fi network";
    const evidence = [`${cur.ssid || "(hidden)"}: ${cur.raw || "no security"}`];
    switch (cur.security) {
      case "open":
        return [fail(`${name} has no password or encryption.`, { evidence, steps: ["If this is your network, turn on WPA2 or WPA3 in the router.", "If it's public Wi-Fi, use a VPN and stick to HTTPS sites."] })];
      case "wep":
        return [fail(`${name} uses WEP, which can be cracked in minutes.`, { evidence })];
      case "wpa1":
        return [fail(`${name} uses WPA (version 1), which is broken.`, { evidence, severity: "medium" })];
      case "wpa2-mixed":
        return [fail(`${name} still allows the old WPA/TKIP mode next to WPA2.`, { evidence, severity: "low" })];
      case "unknown":
        return [skip(`Couldn't tell how ${name} is protected (${cur.raw}).`)];
      default:
        return [pass(`${name} uses ${cur.security === "owe" ? "Enhanced Open (OWE)" : cur.security.toUpperCase()} encryption.`, { evidence })];
    }
  },
};
