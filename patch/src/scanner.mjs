// A network scan, start to finish:
//  1. listen: NetBIOS, mDNS (Bonjour), SSDP (UPnP), Kasa, LIFX and Yeelight discovery, all at once
//  2. the ARP table now lists every live address (the NetBIOS packets made the OS resolve them all)
//  3. check a short list of service ports on each live device, look up names
//  4. read UPnP descriptions and web-page titles, then let each driver identify what it knows
import os from "node:os";
import dns from "node:dns";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { homeNetwork } from "./net/interfaces.mjs";
import { readArpTable } from "./net/arp.mjs";
import { nbstatSweep, probePorts, tcpSweep } from "./net/probe.mjs";
import * as mdns from "./net/mdns.mjs";
import * as ssdp from "./net/ssdp.mjs";
import { fingerprint } from "./net/lanhttp.mjs";
import { ensureOui, vendorOf } from "./net/oui.mjs";
import { kasaDiscover } from "./drivers/kasa.mjs";
import { lifxDiscover } from "./drivers/lifx.mjs";
import { yeelightDiscover } from "./drivers/yeelight.mjs";
import { DRIVERS } from "./drivers/index.mjs";
import { webUrlFor } from "./drivers/generic.mjs";
import { inCidr, isPrivateIPv4, isRandomizedMac, mapLimit, prettyHostname, settleWithin, sortIps, subnetHosts } from "./util.mjs";

export const SERVICE_PORTS = [21, 22, 23, 53, 80, 139, 443, 445, 548, 554, 631, 1400, 1883, 3389, 5000, 5001, 5900, 7000, 8001, 8008, 8009, 8060, 8080, 8123, 8443, 9100, 9123, 9999, 32400, 55443, 62078];

function newHost(ip) {
  return { ip, mac: null, vendor: null, randomMac: false, hostnames: new Set(), netbios: null, ports: new Set(), mdns: [], ssdp: [], udp: {}, http: {}, isGateway: false, rtt: null };
}

const PLATFORM = { darwin: "Mac", win32: "Windows PC", linux: "Linux computer" };

export class Scanner extends EventEmitter {
  /**
   * overrides (used by demo mode and tests): { network, arp, mdnsTarget, ssdpTarget, broadcasts,
   * multicastYeelight, skipNetbios, skipReverseDns, includeSelf }
   */
  constructor({ store, inventory, controller, overrides = {} }) {
    super();
    this.store = store;
    this.inventory = inventory;
    this.controller = controller;
    this.o = overrides;
    this.running = null;
    this.network = null;
    this.lastScan = null;
  }

  progress(message, pct) {
    this.emit("progress", { message, pct, running: true });
  }

  async currentNetwork() {
    if (this.o.network) return this.o.network;
    this.network = (await homeNetwork({ override: this.store.subnet })) || this.network;
    return this.network;
  }

  scan(opts = {}) {
    if (this.running) return this.running;
    this.running = this.#scan(opts)
      .then((summary) => {
        this.lastScan = summary;
        this.emit("done", summary);
        return summary;
      })
      .catch((err) => {
        this.emit("failed", { message: err.message });
        throw err;
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async #reverseDns(ips, net) {
    const out = new Map();
    if (this.o.skipReverseDns) return out;
    const servers = [...new Set([net.gateway, ...(net.dns || []).filter(isPrivateIPv4)].filter(Boolean))];
    const r = new dns.promises.Resolver({ timeout: 1200, tries: 1 });
    try {
      r.setServers(servers);
    } catch {
      return out;
    }
    await mapLimit(ips, 16, async (ip) => {
      try {
        const names = await r.reverse(ip);
        if (names?.[0]) out.set(ip, names[0]);
      } catch {
        /* no PTR record */
      }
    });
    return out;
  }

  async #identify(h, ctx) {
    for (const driver of DRIVERS) {
      if (driver.id === "generic") {
        // The device's own API didn't answer this time: keep what we already know instead of
        // demoting it to "unknown device".
        const known = this.inventory.all({ includeHidden: true }).find((d) => d.driver !== "generic" && !d.parent && !d.self && d.driver !== "homeassistant" && ((h.mac && d.mac === h.mac) || d.ip === h.ip));
        if (known) {
          const kids = this.inventory.all({ includeHidden: true }).filter((d) => d.parent === known.id);
          return [{ ...known, online: true, ports: [...h.ports].sort((a, b) => a - b) }, ...kids.map((k) => ({ ...k, online: k.online ?? true }))];
        }
      }
      let devs = null;
      try {
        devs = await settleWithin(driver.detect(h, ctx), 12_000, null);
      } catch {
        devs = null;
      }
      if (!devs?.length) continue;
      return devs.map((d, i) => {
        const primary = i === 0 && !d.parent && !d.extra;
        d.ip ??= h.ip;
        if (primary) {
          d.mac ??= h.mac;
          d.vendor = h.vendor;
          d.ports = [...h.ports].sort((a, b) => a - b);
          d.hostnames = [...h.hostnames];
          d.isGateway = h.isGateway;
          d.rtt = h.rtt;
          if (d.webUrl === undefined) d.webUrl = webUrlFor(h);
        }
        return d;
      });
    }
    return [];
  }

  async #scan({ deep = false } = {}) {
    const t0 = Date.now();
    const scanId = crypto.randomUUID();
    const o = this.o;
    this.progress("Finding your network…", 2);
    const net = await this.currentNetwork();
    if (!net) throw new Error("This computer doesn't seem to be on a home network: it has no private IPv4 address.");
    this.network = net;
    const ips = subnetHosts(net.cidr, { max: 1024, around: net.address || net.gateway }).filter((ip) => ip !== net.address);
    const hosts = new Map();
    const host = (ip) => {
      if (!ip || !inCidr(ip, net.cidr) || ip === net.address) return null;
      if (!hosts.has(ip)) hosts.set(ip, newHost(ip));
      return hosts.get(ip);
    };
    const bcast = o.broadcasts ?? [...new Set([net.broadcast, "255.255.255.255"])];
    const mTarget = o.mdnsTarget ? { target: o.mdnsTarget } : {};
    const sTarget = o.ssdpTarget ? { target: o.ssdpTarget } : {};
    const vendorTask = this.store.data.features.vendorLookup ? ensureOui(this.store.dir).catch(() => null) : null;

    this.progress("Listening for devices…", 8);
    const [nb, md, ss, kasa, lifx, yee] = await Promise.all([
      o.skipNetbios ? new Map() : nbstatSweep(ips),
      mdns.browse({ iface: net.address || undefined, ...mTarget }),
      ssdp.search({ iface: net.address || undefined, ...sTarget }),
      kasaDiscover({ broadcasts: bcast }),
      lifxDiscover({ broadcasts: bcast }),
      yeelightDiscover({ target: o.multicastYeelight === false ? null : "239.255.255.250" }),
    ]);

    const arp = (await (o.arp ? o.arp() : readArpTable())).filter((e) => inCidr(e.ip, net.cidr));
    for (const e of arp) {
      const h = host(e.ip);
      if (h) h.mac = e.mac;
    }
    for (const [ip, r] of nb) {
      const h = host(ip);
      if (!h) continue;
      if (r.name) h.netbios = r.name;
      h.mac ??= r.mac;
    }
    for (const s of md.services) {
      for (const ip of s.addresses) {
        const h = host(ip);
        if (!h) continue;
        h.mdns.push(s);
        if (s.host) h.hostnames.add(s.host);
      }
    }
    for (const r of ss) host(r.address)?.ssdp.push(r);
    for (const [ip, info] of kasa) {
      const h = host(ip);
      if (h) h.udp.kasa = info;
    }
    for (const [ip, info] of lifx) {
      const h = host(ip);
      if (h) h.udp.lifx = info;
    }
    for (const [ip, info] of yee) {
      const h = host(ip);
      if (h) h.udp.yeelight = info;
    }
    const gw = host(net.gateway);
    if (gw) gw.isGateway = true;

    if (!arp.length || deep) {
      this.progress("Knocking on every address…", 25);
      const rest = ips.filter((ip) => !hosts.has(ip));
      const found = await tcpSweep(rest, { ports: deep ? [80, 443, 22, 62078, 8080, 445, 554, 7000, 8008, 9100] : [80, 443, 22, 62078, 8080], timeout: 650 });
      for (const [ip, r] of found) r.open.forEach((p) => host(ip)?.ports.add(p));
    }

    const alive = [...hosts.keys()].sort(sortIps);
    this.progress(`Checking ${alive.length} devices…`, 40);
    const need = (key) => alive.filter((ip) => !hosts.get(ip).udp[key]);
    const [, rdns, mrev, kasa2, lifx2, yee2] = await Promise.all([
      mapLimit(alive, 24, async (ip) => {
        const r = await probePorts(ip, SERVICE_PORTS, { timeout: 900, concurrency: 16 });
        const h = hosts.get(ip);
        r.open.forEach((p) => h.ports.add(p));
        h.rtt = r.rtt;
      }),
      this.#reverseDns(alive, net),
      mdns.reverseLookup(alive.filter((ip) => !hosts.get(ip).hostnames.size), { iface: net.address || undefined, ...mTarget }),
      kasaDiscover({ broadcasts: [], unicast: need("kasa") }),
      lifxDiscover({ broadcasts: [], unicast: need("lifx") }),
      yeelightDiscover({ target: null, unicast: need("yeelight") }),
    ]);
    for (const [ip, name] of [...rdns, ...mrev]) hosts.get(ip)?.hostnames.add(name);
    for (const [ip, info] of kasa2) if (hosts.get(ip)) hosts.get(ip).udp.kasa = info;
    for (const [ip, info] of lifx2) if (hosts.get(ip)) hosts.get(ip).udp.lifx = info;
    for (const [ip, info] of yee2) if (hosts.get(ip)) hosts.get(ip).udp.yeelight = info;

    await settleWithin(vendorTask, 8000);
    for (const h of hosts.values()) {
      h.vendor = vendorOf(h.mac);
      h.randomMac = isRandomizedMac(h.mac);
    }

    this.progress("Reading device descriptions…", 60);
    const locations = [...new Set(ss.map((r) => r.location))];
    const descs = new Map();
    await mapLimit(locations, 8, async (loc) => descs.set(loc, await ssdp.fetchDescription(loc)));
    for (const h of hosts.values()) for (const r of h.ssdp) r.desc = descs.get(r.location) || null;
    await mapLimit(alive, 12, async (ip) => {
      const h = hosts.get(ip);
      for (const p of [80, 443, 8080, 5000]) {
        if (h.ports.has(p)) h.http[p] = await fingerprint(`${p === 443 ? "https" : "http"}://${ip}${p === 80 || p === 443 ? "" : `:${p}`}/`);
      }
    });

    this.progress("Identifying devices…", 75);
    const ctx = this.controller.ctx(net);
    const results = [];
    await mapLimit(alive, 12, async (ip) => results.push(...(await this.#identify(hosts.get(ip), ctx))));
    for (const d of DRIVERS) if (d.extra) results.push(...(await settleWithin(d.extra(ctx), 20_000, [])));
    if (net.address && o.includeSelf !== false) {
      results.push({
        id: "self:computer",
        driver: "self",
        self: true,
        kind: "computer",
        name: prettyHostname(os.hostname()) || "This computer",
        brand: PLATFORM[process.platform] || null,
        model: "This computer (running Patch)",
        ip: net.address,
        mac: net.mac || null,
        state: {},
        info: { platform: `${os.type()} ${os.release()}` },
        actions: ["rename", "set_room"],
      });
    }

    const first = !this.store.data.history.firstScanAt;
    for (const dev of results) this.inventory.upsert(dev, { scanId });
    this.inventory.finishScan(scanId);
    if (first) {
      this.store.data.history.firstScanAt = t0;
      this.store.save();
    }
    const publicList = this.inventory.list();
    const summary = {
      at: new Date().toISOString(),
      durationMs: Date.now() - t0,
      network: { cidr: net.cidr, gateway: net.gateway, address: net.address, iface: net.iface || null },
      hosts: alive.length,
      devices: publicList.length,
      online: publicList.filter((d) => d.online).length,
      newDevices: publicList.filter((d) => d.isNew).map((d) => d.name),
      identified: publicList.filter((d) => d.driver !== "generic" && !d.self).length,
      needsSetup: publicList.filter((d) => d.setup).map((d) => ({ name: d.name, message: d.setup.message })),
    };
    this.emit("progress", { message: `Found ${summary.devices} devices`, pct: 100, running: false });
    return summary;
  }
}
