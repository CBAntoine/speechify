// The network scan: find devices, check each one, review the router's port forwards.

import type { Finding, Fix, Host, NetDevice, NetworkScan, Severity, UpnpMapping } from "../core/types.ts";
import { mapLimit, uniq } from "../core/util.ts";
import { allLocalAddresses, arpTable, defaultGateway, isRandomMac, localNetworks } from "./local.ts";
import { mdnsDiscover, type MdnsDevice } from "./mdns.ts";
import { PING_PORTS, probeHost, type HostProbe } from "./probe.ts";
import { byIp, isCgnat, isPrivate, resolveTargets } from "./scope.ts";
import { fetchDescription, ssdpDiscover, type SsdpReply, type UpnpDescription } from "./ssdp.ts";
import { tcpProbe } from "./tcp.ts";
import type { NetIssue } from "./types.ts";
import { addMapping, deleteMapping, externalIp, listMappings, WAN_SERVICES } from "./upnp.ts";

export interface NetScanOptions {
  targets: string[];
  authorized: boolean;
  confirmedOwnership: boolean;
  ports?: number[];
  onProgress?: (p: { phase: string; done: number; total: number; message?: string }) => void;
  /** Skip multicast discovery (tests and the demo). */
  noMulticast?: boolean;
  /** UPnP replies to treat as if they'd arrived by multicast (tests and the demo). */
  extraSsdp?: SsdpReply[];
}

export function defaultTargets(): { targets: string[]; skipped: string[] } {
  const nets = localNetworks();
  const targets: string[] = [];
  const skipped: string[] = [];
  for (const n of nets) {
    if (n.private) targets.push(n.scanCidr);
    else skipped.push(`${n.cidr} on ${n.iface} isn't a private address range, so it isn't scanned automatically. Add it as a target if you own it.`);
  }
  return { targets: uniq(targets), skipped };
}

/** Looks for devices: a quick knock on a few ports (a refusal counts), then the ARP table. */
async function sweep(addresses: string[], onDone: () => void): Promise<Set<string>> {
  const up = new Set<string>();
  await mapLimit(addresses, 32, async (ip) => {
    const states = await Promise.all(PING_PORTS.map((p) => tcpProbe(ip, p, 700)));
    if (states.some((s) => s === "open" || s === "closed")) up.add(ip);
    onDone();
  });
  return up;
}

const RISKY_FORWARD = new Set([21, 22, 23, 139, 445, 1433, 2323, 2375, 3306, 3389, 5432, 5555, 5900, 5901, 6379, 9200, 11211, 27017]);

function forwardIssue(m: UpnpMapping, ext: string | undefined, control: { controlURL: string; serviceType: string }): NetIssue {
  const behindNat = ext ? isPrivate(ext) || isCgnat(ext) : false;
  let severity: Severity = RISKY_FORWARD.has(m.internalPort) ? "high" : "medium";
  if (behindNat) severity = severity === "high" ? "medium" : "low";
  const what = m.description ? ` ("${m.description}")` : "";
  return {
    checkId: "upnp.forward",
    subject: `${m.protocol}-${m.externalPort}`,
    title: `Router forwards internet port ${m.externalPort}/${m.protocol} to ${m.internalClient}`,
    severity,
    summary:
      `A device used UPnP to open port ${m.externalPort}/${m.protocol} on the router and point it at ${m.internalClient}:${m.internalPort}${what}.` +
      (behindNat ? ` The router's own internet address (${ext}) is private, so this may not reach the internet directly.` : " Anyone on the internet can reach that port."),
    why: "Apps (and malware) use UPnP to open ports on your router without asking. Each open port exposes whatever is listening behind it to the whole internet.",
    steps: [
      `If you don't recognise "${m.description || "this forward"}" or don't need it, remove it (Bulwark can do this for you).`,
      "To stop it coming back, turn off UPnP in the router's settings, or in the app that created it.",
    ],
    evidence: [`${m.protocol} ${m.remoteHost || "*"}:${m.externalPort} → ${m.internalClient}:${m.internalPort} enabled=${m.enabled} lease=${m.leaseDuration}s`],
    auto: { fixId: "upnp.delete-mapping", params: { controlUrl: control.controlURL, serviceType: control.serviceType, mapping: m } },
  };
}

function classify(d: NetDevice, probe: HostProbe | undefined, mdns: MdnsDevice | undefined, upnp: UpnpDescription | undefined): string {
  const ports = new Set(probe?.open ?? []);
  const svc = new Set(mdns ? [...mdns.services] : []);
  const text = [d.name, d.model, upnp?.deviceType, upnp?.manufacturer, ...(probe?.services.map((s) => `${s.title ?? ""} ${s.banner ?? ""}`) ?? [])].join(" ").toLowerCase();
  const has = (re: RegExp) => [...svc].some((s) => re.test(s));
  if (d.isGateway || /internetgatewaydevice/.test(text)) return "Router";
  if (has(/_ipps?\.|_printer\.|_pdl-datastream/) || ports.has(9100) || /printer|laserjet|officejet|epson|brother|canon/.test(text)) return "Printer";
  if (ports.has(554) || ports.has(34567) || ports.has(37777) || /camera|ipcam|nvr|dvr|hikvision|dahua|reolink|amcrest/.test(text)) return "Camera";
  if (has(/_googlecast|_androidtvremote|_amzn-wplay/) || ports.has(8060) || probe?.services.some((s) => s.name === "samsung-tv" || s.name === "roku-ecp") || /mediarenderer|chromecast|roku|bravia|webos|tizen|fire ?tv|\[tv\]|smart ?tv|android ?tv|google ?tv/.test(text)) return "TV or streaming device";
  if (has(/_raop|_spotify-connect|_sonos/) && !has(/_companion-link|_device-info/)) return "Speaker";
  if (has(/_hap\.|_homekit|_matter|_esphomelib|_hue/) || ports.has(1883) || ports.has(8123) || /home assistant|homey|hubitat|smartthings|openhab|zigbee/.test(text)) return "Smart home device";
  if (ports.has(62078) || /iphone|ipad/.test(text)) return "Phone or tablet";
  if (/diskstation|synology|qnap|truenas|nas\b|readynas|wd ?my ?cloud/.test(text) || (ports.has(5000) && ports.has(445))) return "NAS";
  if (ports.has(5555)) return "Android device";
  if (ports.has(3389) || ports.has(445) || ports.has(22) || has(/_ssh|_smb|_workstation|_device-info|_companion-link|_afpovertcp/)) return "Computer";
  if (d.randomMac && !ports.size) return "Phone or laptop";
  return "Device";
}

const GENERIC_TITLE = /login|log in|sign in|unauthori[sz]ed|forbidden|not found|index of|error|welcome|redirect|loading|untitled|^\d{3}\b|document|^web ?(ui|admin)?$|^home$|^index/i;

/** A web page title that names the product ("HP LaserJet Pro M404", "Synology DiskStation"). */
function titleModel(probe: HostProbe | undefined): string | undefined {
  for (const s of probe?.services ?? []) {
    const t = s.title?.trim();
    if (t && t.length >= 3 && t.length <= 60 && !GENERIC_TITLE.test(t)) return t;
  }
  return undefined;
}

function nameFor(mdns: MdnsDevice | undefined, upnp: UpnpDescription | undefined, hostnames: string[]): string | undefined {
  return mdns?.txt.get("fn") ?? upnp?.friendlyName ?? [...(mdns?.instances ?? [])][0] ?? [...(mdns?.hostnames ?? [])][0] ?? hostnames[0];
}

function toFinding(ip: string, port: number | undefined, i: NetIssue): Finding {
  const id = `${i.checkId}@${ip}${port ? `:${port}` : ""}${i.subject ? `#${i.subject}` : ""}`;
  return {
    id,
    checkId: i.checkId,
    target: ip,
    title: i.title,
    category: "Network device",
    severity: i.severity,
    status: "fail",
    confidence: i.confidence ?? "confirmed",
    summary: i.summary,
    why: i.why,
    evidence: i.evidence ?? [],
    remedy: { auto: i.auto, steps: i.steps },
    references: i.references ?? [],
    cves: i.cves ?? [],
  };
}

async function reverseName(ip: string): Promise<string | undefined> {
  const { reverse } = await import("node:dns/promises");
  try {
    const names = await Promise.race([reverse(ip), new Promise<string[]>((r) => setTimeout(() => r([]), 1500))]);
    return names[0]?.replace(/\.(lan|home|local|localdomain|home\.arpa)$/i, "");
  } catch {
    return undefined;
  }
}

export async function scanNetwork(host: Host, opts: NetScanOptions): Promise<NetworkScan> {
  const started = Date.now();
  const progress = opts.onProgress ?? (() => {});
  const notes: string[] = [];
  const resolved = await resolveTargets(opts.targets, { authorized: opts.authorized });
  notes.push(...resolved.errors);
  const inScope = new Set(resolved.addresses);
  if (!inScope.size) return { targets: opts.targets, confirmedOwnership: opts.confirmedOwnership, devices: [], findings: [], notes, durationMs: Date.now() - started };

  const self = allLocalAddresses();
  const gateway = await defaultGateway(host);
  const ifaceAddrs = localNetworks().map((n) => n.address);

  progress({ phase: "discover", done: 0, total: inScope.size, message: "Looking for devices" });
  let swept = 0;
  const [up, mdns, ssdp] = await Promise.all([
    sweep([...inScope], () => progress({ phase: "discover", done: ++swept, total: inScope.size, message: "Looking for devices" })),
    opts.noMulticast ? Promise.resolve(new Map<string, MdnsDevice>()) : mdnsDiscover(ifaceAddrs),
    opts.noMulticast ? Promise.resolve([] as SsdpReply[]) : ssdpDiscover(ifaceAddrs),
  ]);
  ssdp.push(...(opts.extraSsdp ?? []));
  const arp = await arpTable(host);
  const live = new Set<string>();
  for (const ip of up) live.add(ip);
  for (const ip of arp.keys()) if (inScope.has(ip)) live.add(ip);
  for (const ip of mdns.keys()) if (inScope.has(ip)) live.add(ip);
  for (const r of ssdp) if (inScope.has(r.ip)) live.add(r.ip);
  for (const ip of self) if (inScope.has(ip)) live.add(ip);

  const order = [...live].sort(byIp);
  let probed = 0;
  progress({ phase: "probe", done: 0, total: order.length, message: `Checking ${order.length} devices` });
  const probes = new Map<string, HostProbe>();
  await mapLimit(order, 6, async (ip) => {
    probes.set(ip, await probeHost(ip, { ports: opts.ports }));
    progress({ phase: "probe", done: ++probed, total: order.length, message: `Checked ${ip}` });
  });

  // UPnP descriptions, and the router's port forwards.
  progress({ phase: "upnp", done: 0, total: 1, message: "Reviewing UPnP and port forwards" });
  const descByIp = new Map<string, UpnpDescription>();
  const seenLoc = new Set<string>();
  const replies = ssdp.filter((r) => inScope.has(r.ip) && r.location && !seenLoc.has(r.location) && seenLoc.add(r.location));
  await mapLimit(replies, 4, async (r) => {
    const d = await fetchDescription(r);
    if (!d) return;
    const prev = descByIp.get(r.ip);
    // Prefer the description that has the gateway services, then the one with a name.
    if (!prev || d.services.some((s) => WAN_SERVICES.test(s.serviceType)) || (!prev.friendlyName && d.friendlyName)) {
      descByIp.set(r.ip, { ...d, services: [...(prev?.services ?? []), ...d.services] });
    }
  });
  const upnpIssues = new Map<string, NetIssue[]>();
  const upnpInfo = new Map<string, NetDevice["upnp"]>();
  for (const [ip, d] of descByIp) {
    const wan = d.services.find((s) => WAN_SERVICES.test(s.serviceType));
    const info: NetDevice["upnp"] = { friendlyName: d.friendlyName, manufacturer: d.manufacturer, model: [d.modelName, d.modelNumber].filter(Boolean).join(" ") || undefined, igd: !!wan };
    upnpInfo.set(ip, info);
    if (!wan || !isPrivate(ip)) continue;
    const ext = await externalIp(wan.controlURL, wan.serviceType).catch(() => undefined);
    info.externalIp = ext;
    const maps = await listMappings(wan.controlURL, wan.serviceType).catch(() => [] as UpnpMapping[]);
    const list: NetIssue[] = [
      {
        checkId: "upnp.enabled",
        title: "The router lets devices open ports by themselves (UPnP)",
        severity: maps.length ? "medium" : "low",
        summary: maps.length ? `UPnP is on and ${maps.length} port forward${maps.length === 1 ? " is" : "s are"} open right now.` : "UPnP is on. No port forwards are open right now.",
        why: "With UPnP, any program on any device on your network, including malware, can open a door from the internet to itself without asking.",
        steps: [
          "Turn off UPnP in the router's settings (often under Advanced, NAT or WAN).",
          "Game consoles and some chat apps use UPnP; if one stops working, forward just the ports it needs by hand.",
        ],
        evidence: d.manufacturer || d.modelName ? [`${d.manufacturer ?? ""} ${d.modelName ?? ""} ${d.modelNumber ?? ""}`.trim()] : [],
      },
      ...maps.map((m) => forwardIssue(m, ext, wan)),
    ];
    upnpIssues.set(ip, list);
  }
  // SSDP SERVER headers carry versions too (old MiniUPnPd).
  const { matchSoftware, parseServerHeader } = await import("./fingerprints.ts");
  for (const r of ssdp) {
    if (!inScope.has(r.ip) || !r.server) continue;
    for (const sw of parseServerHeader(r.server)) {
      for (const v of matchSoftware(sw)) {
        const list = upnpIssues.get(r.ip) ?? [];
        if (list.some((i) => i.checkId === "upnp.version" && i.subject === v.title)) continue;
        list.push({ checkId: "upnp.version", subject: v.title, title: v.title, severity: v.severity, confidence: v.confidence, summary: `The device's UPnP service identifies as "${r.server}".`, why: v.why, steps: v.steps, cves: v.cves });
        upnpIssues.set(r.ip, list);
      }
    }
  }

  progress({ phase: "names", done: 0, total: order.length, message: "Naming devices" });
  const rdns = new Map<string, string | undefined>();
  await mapLimit(order, 16, async (ip) => rdns.set(ip, await reverseName(ip)));

  const devices: NetDevice[] = [];
  const findings: Finding[] = [];
  for (const ip of order) {
    const p = probes.get(ip);
    const m = mdns.get(ip);
    const u = descByIp.get(ip);
    const hostnames = uniq([...(m?.hostnames ?? []), ...(rdns.get(ip) ? [rdns.get(ip)!] : [])]);
    const mac = arp.get(ip);
    const dev: NetDevice = {
      ip,
      mac,
      randomMac: mac ? isRandomMac(mac) : undefined,
      hostnames,
      name: nameFor(m, u, hostnames),
      model: m?.txt.get("model") ?? m?.txt.get("md") ?? m?.txt.get("ty") ?? m?.txt.get("am") ?? (u ? [u.modelName, u.modelNumber].filter(Boolean).join(" ") || undefined : undefined) ?? titleModel(p),
      kind: "Device",
      isGateway: ip === gateway,
      isSelf: self.has(ip),
      services: p?.services ?? [],
      mdnsServices: [...(m?.services ?? [])].map((s) => s.replace(/^_/, "").replace(/\._(tcp|udp)$/, "")),
      upnp: upnpInfo.get(ip),
    };
    dev.kind = dev.isSelf ? "This device" : classify(dev, p, m, u);
    devices.push(dev);
    for (const i of p?.issues ?? []) {
      const f = toFinding(ip, i.port, i);
      if (dev.isSelf) f.remedy!.steps.unshift("This is the computer running Bulwark. Its own checks (under \"This device\") cover this service and can fix it there.");
      findings.push(f);
    }
    for (const i of upnpIssues.get(ip) ?? []) findings.push(toFinding(ip, undefined, i));
  }
  if (gateway && inScope.has(gateway) && !devices.some((d) => d.isGateway)) notes.push(`The router (${gateway}) didn't answer, so it wasn't checked.`);
  progress({ phase: "done", done: 1, total: 1 });
  return { targets: opts.targets, confirmedOwnership: opts.confirmedOwnership, devices, findings, notes, durationMs: Date.now() - started };
}

// ── the router port-forward fix ──

function mappingParam(p: Record<string, unknown>): { controlUrl: string; serviceType: string; mapping: UpnpMapping } {
  const m = p.mapping as UpnpMapping;
  if (!m || typeof p.controlUrl !== "string" || typeof p.serviceType !== "string" || !WAN_SERVICES.test(p.serviceType)) throw new Error("Bad port-forward details.");
  return { controlUrl: p.controlUrl, serviceType: p.serviceType, mapping: m };
}

export const upnpDeleteFix: Fix = {
  id: "upnp.delete-mapping",
  title: (p) => {
    const m = p.mapping as UpnpMapping | undefined;
    return m ? `Remove the router's forward of port ${m.externalPort}/${m.protocol} to ${m.internalClient}` : "Remove a router port forward";
  },
  needsRoot: false,
  risk: "caution",
  reversible: true,
  async preconditions({ params }) {
    const { controlUrl, serviceType, mapping } = mappingParam(params);
    const now = await listMappings(controlUrl, serviceType).catch(() => null);
    if (!now) return [{ ok: false, message: "Couldn't reach the router's UPnP service." }];
    const still = now.some((m) => m.externalPort === mapping.externalPort && m.protocol === mapping.protocol);
    return [{ ok: still, message: still ? "The forward is still there." : "The forward is already gone." }];
  },
  async warnings({ params }) {
    const { mapping } = mappingParam(params);
    return [
      `Whatever uses this forward${mapping.description ? ` ("${mapping.description}")` : ""} stops being reachable from the internet. If it's a game console or app that needs it, it may add it back by itself.`,
    ];
  },
  async apply(tx, { params }) {
    const { controlUrl, serviceType, mapping } = mappingParam(params);
    await tx.network(
      { type: "upnp-delete-mapping", controlUrl, serviceType, mapping },
      { title: `Ask the router to remove port ${mapping.externalPort}/${mapping.protocol} → ${mapping.internalClient}:${mapping.internalPort}`, detail: `UPnP DeletePortMapping on ${new URL(controlUrl).host}` },
    );
  },
  async validate({ params }) {
    const { controlUrl, serviceType, mapping } = mappingParam(params);
    const now = await listMappings(controlUrl, serviceType).catch(() => []);
    return now.some((m) => m.externalPort === mapping.externalPort && m.protocol === mapping.protocol) ? "The router still lists the forward." : null;
  },
};

export async function performNetworkAction(a: { type: "upnp-delete-mapping"; controlUrl: string; serviceType: string; mapping: UpnpMapping }): Promise<void> {
  await deleteMapping(a.controlUrl, a.serviceType, a.mapping);
}

export async function undoNetworkAction(a: { type: "upnp-delete-mapping"; controlUrl: string; serviceType: string; mapping: UpnpMapping }): Promise<void> {
  await addMapping(a.controlUrl, a.serviceType, a.mapping);
}
