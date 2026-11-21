// Which network is "the WiFi"? Finds this computer's address, subnet and router on macOS, Windows and Linux,
// and on Android phones (where the Patch app passes in what Android hides: see platform.mjs).
import os from "node:os";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import dns from "node:dns";
import { inCidr, intToIp, ipToInt, isPrivateIPv4, normalizeMac, parseCidr, prefixFromNetmask } from "../util.mjs";
import { networkFromEnv, onPhone } from "../platform.mjs";

export function run(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err && !stdout ? null : String(stdout));
    });
  });
}

// Virtual adapters (VPNs, Docker, VMs) and a phone's mobile-data and Wi-Fi Direct links: never the home WiFi.
const VIRTUAL = /^(docker|br-|veth|virbr|vboxnet|vmnet|utun|tun|tap|wg|tailscale|zt|ham|llw|awdl|anpi|ap\d|bridge|gif|stf|lo|rmnet|r_rmnet|ccmni|ccinet|clat|v4-|dummy|p2p|seth|pdp|rndis|ifb|sit|ip6tnl|ipsec|epdg|aware|nan\d)/i;
const VIRTUAL_WIN = /(virtual|vmware|virtualbox|hyper-v|vethernet|wsl|loopback|tailscale|zerotier|wireguard|vpn|bluetooth)/i;

/** Private IPv4 networks this computer is on, best guess first. */
export function localNetworks() {
  const out = [];
  let interfaces = {};
  try {
    interfaces = os.networkInterfaces();
  } catch {
    // Newer Android versions refuse to list network interfaces to apps; the Patch app passes the Wi-Fi in.
  }
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" && a.family !== 4) continue;
      if (a.internal || !isPrivateIPv4(a.address) || a.address.startsWith("127.")) continue;
      const prefix = prefixFromNetmask(a.netmask);
      const c = parseCidr(`${a.address}/${prefix}`);
      out.push({
        iface: name,
        address: a.address,
        netmask: a.netmask,
        prefix,
        cidr: c.cidr,
        broadcast: intToIp(c.broadcast),
        mac: normalizeMac(a.mac),
        virtual: VIRTUAL.test(name) || VIRTUAL_WIN.test(name),
        linkLocal: a.address.startsWith("169.254."),
        wireless: /^(wl|wlan|wifi|wi-fi|en0$|wlp|ath|ra\d)/i.test(name) || /wi-?fi|wireless|wlan/i.test(name),
      });
    }
  }
  // The Android app knows which network is the Wi-Fi for certain: trust it over guesses.
  const { wifi } = networkFromEnv();
  if (wifi) {
    const seen = out.find((n) => n.address === wifi.address);
    if (seen) seen.fromApp = true;
    else {
      const c = parseCidr(wifi.cidr);
      out.push({ iface: "wlan0", address: wifi.address, netmask: null, prefix: wifi.prefix, cidr: c.cidr, broadcast: intToIp(c.broadcast), mac: null, virtual: false, linkLocal: false, wireless: true, fromApp: true });
    }
  }
  const score = (n) => (n.fromApp ? 50 : 0) + (n.virtual ? -100 : 0) + (n.linkLocal ? -50 : 0) + (n.wireless ? 10 : 0) + (n.address.startsWith("192.168.") ? 3 : 0) + (n.prefix >= 16 ? 2 : 0);
  return out.sort((a, b) => score(b) - score(a));
}

// ── Default gateway ─────────────────────────────────────────

export function parseLinuxRoute(text) {
  // /proc/net/route: Iface Destination Gateway Flags ... (hex, little-endian)
  for (const line of String(text).split("\n").slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 3 || f[1] !== "00000000" || f[2] === "00000000") continue;
    const g = f[2].match(/../g).reverse().map((h) => parseInt(h, 16)).join(".");
    return { gateway: g, iface: f[0] };
  }
  return null;
}

export function parseMacRoute(text) {
  const gw = String(text).match(/gateway:\s*([\d.]+)/)?.[1];
  const iface = String(text).match(/interface:\s*(\S+)/)?.[1];
  return gw ? { gateway: gw, iface } : null;
}

export function parseWindowsRoute(text) {
  // "          0.0.0.0          0.0.0.0      192.168.1.1     192.168.1.23     35"
  let best = null;
  for (const m of String(text).matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+([\d.]+)\s+([\d.]+)\s+(\d+)/gm)) {
    const metric = Number(m[3]);
    if (!best || metric < best.metric) best = { gateway: m[1], via: m[2], metric };
  }
  return best ? { gateway: best.gateway, via: best.via } : null;
}

export async function defaultGateway() {
  const fromApp = networkFromEnv().gateway;
  if (fromApp) return { gateway: fromApp, iface: null };
  try {
    if (process.platform === "linux") {
      const r = parseLinuxRoute(await fs.readFile("/proc/net/route", "utf8"));
      if (r) return r;
      const t = await run("ip", ["route", "show", "default"]);
      const m = t?.match(/default via ([\d.]+)(?: dev (\S+))?/);
      return m ? { gateway: m[1], iface: m[2] } : null;
    }
    if (process.platform === "darwin") return parseMacRoute(await run("route", ["-n", "get", "default"]));
    if (process.platform === "win32") return parseWindowsRoute(await run("route", ["print", "-4", "0.0.0.0"]));
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * The home network to work on: { iface, address, cidr, prefix, broadcast, gateway, dns }.
 * `override` (from settings or PATCH_SUBNET) forces a subnet, e.g. "192.168.50.0/24".
 */
export async function homeNetwork({ override, gatewayOverride } = {}) {
  const nets = localNetworks();
  const gw = await defaultGateway();
  let net = null;
  if (override) {
    const c = parseCidr(override);
    if (c) {
      const mine = nets.find((n) => inCidr(n.address, c));
      net = {
        iface: mine?.iface ?? null,
        address: mine?.address ?? null,
        cidr: c.cidr,
        prefix: c.prefix,
        broadcast: intToIp(c.broadcast),
        mac: mine?.mac ?? null,
        overridden: true,
      };
    }
  }
  if (!net && gw) net = nets.find((n) => inCidr(gw.gateway, n.cidr)) ?? null;
  // A phone off Wi-Fi only has mobile data: never scan the phone company's network.
  if (!net) net = nets.find((n) => !n.virtual) ?? (onPhone() ? null : nets[0]) ?? null;
  if (!net) return null;
  let gateway = gatewayOverride || (gw && inCidr(gw.gateway, net.cidr) ? gw.gateway : null);
  if (!gateway) {
    // Most home routers sit at .1 (or .254).
    const c = parseCidr(net.cidr);
    gateway = intToIp(c.network + 1);
  }
  const appDns = networkFromEnv().dns;
  return { ...net, gateway, dns: appDns.length ? appDns : dns.getServers().filter((s) => /^\d+\.\d+\.\d+\.\d+$/.test(s)) };
}

export const sameSubnet = (ip, net) => !!net && inCidr(ip, net.cidr);
export { ipToInt };
