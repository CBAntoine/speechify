// Checks one device: which of the ports Bulwark cares about are open, and what's behind each.

import type { ServiceInfo } from "../core/types.ts";
import { mapLimit } from "../core/util.ts";
import { probeAdb, probeMongo, probeMqtt, probeRdp, probeSmb, probeVnc } from "./services/binary.ts";
import { probeHttp } from "./services/http.ts";
import { probeSsh } from "./services/ssh.ts";
import { exposureProbe, probeFtp, probeMemcached, probeMysql, probePostgres, probeRedis, probeRtsp, probeTelnet } from "./services/text.ts";
import { tcpProbe } from "./tcp.ts";
import type { NetIssue, Probe } from "./types.ts";

const http: Probe = (ip, port) => probeHttp(ip, port);
const https: Probe = (ip, port) => probeHttp(ip, port, { tls: true });

const exposed = (name: string, title: string, severity: NetIssue["severity"], why: string, steps: string[], confidence?: NetIssue["confidence"], cves?: string[]) =>
  exposureProbe(name, {
    checkId: `${name}.exposed`,
    title,
    severity,
    summary: `${title}.`,
    why,
    steps,
    confidence,
    cves,
  });

/** Ports worth checking on home and small-office networks, and how to look at each. */
export const PORT_PROBES: Record<number, Probe> = {
  21: probeFtp,
  22: probeSsh,
  23: probeTelnet,
  80: http,
  111: exposed("rpcbind", "rpcbind is reachable", "low", "rpcbind lists the RPC services a machine runs and has been abused for reflection attacks.", ["If you don't share folders over NFS, turn rpcbind off."]),
  139: async (_ip, port) => ({ service: { port, proto: "tcp", name: "netbios-ssn" }, issues: [] }),
  443: https,
  445: probeSmb,
  554: probeRtsp,
  631: http,
  1433: exposed("mssql", "SQL Server port is reachable", "medium", "Databases shouldn't take connections from other devices unless an app elsewhere needs them.", ["Limit SQL Server to localhost or block port 1433 in the firewall."], "likely"),
  1883: probeMqtt,
  2049: exposed("nfs", "NFS file sharing is reachable", "medium", "NFS trusts the client's word about who it is, so a wide-open export lets any device read the files.", ["Limit /etc/exports to specific addresses and keep root_squash on."]),
  2323: probeTelnet,
  2375: http,
  3000: http,
  3306: probeMysql,
  3389: probeRdp,
  4443: https,
  5000: http,
  5001: https,
  5432: probePostgres,
  5555: probeAdb,
  5900: probeVnc,
  5901: probeVnc,
  5984: http,
  6379: probeRedis,
  8000: http,
  8008: http,
  8080: http,
  8081: http,
  8123: http,
  8443: https,
  8888: http,
  9000: http,
  9100: exposed("jetdirect", "Raw printing port is open", "low", "Anyone on the network can send print jobs and printer commands (PJL) straight to the printer, bypassing any print server.", ["If the printer has a setting for \"raw port 9100\" or \"JetDirect\", turn it off and print over IPP instead."]),
  9200: http,
  9443: https,
  11211: probeMemcached,
  27017: probeMongo,
  32400: http,
  34567: exposed("xiongmai", "Xiongmai DVR/camera control port is open", "high", "Port 34567 belongs to Xiongmai-made cameras and recorders (sold under many brands), which have shipped with hard-coded passwords and backdoors.", ["Update the firmware, never forward this port on your router, and keep the device on a separate network."], "likely"),
  37777: exposed("dahua", "Dahua camera/DVR control port is open", "medium", "Dahua's control protocol has had login bypass flaws.", ["Update the firmware and never forward this port on your router."], "possible", ["CVE-2021-33044"]),
  62078: async (_ip, port) => ({ service: { port, proto: "tcp", name: "iphone-sync" }, issues: [] }),
};

export const SCAN_PORTS = Object.keys(PORT_PROBES).map(Number);
/** Ports for finding out whether a device is there at all. */
export const PING_PORTS = [80, 443, 22, 445, 139, 62078, 8080, 5000];

export interface HostProbe {
  ip: string;
  open: number[];
  services: ServiceInfo[];
  issues: (NetIssue & { port: number })[];
}

export async function probeHost(ip: string, opts: { ports?: number[]; timeoutMs?: number } = {}): Promise<HostProbe> {
  const ports = opts.ports ?? SCAN_PORTS;
  const states = await mapLimit(ports, 48, (p) => tcpProbe(ip, p, opts.timeoutMs ?? 1200));
  const open = ports.filter((_, i) => states[i] === "open");
  const services: ServiceInfo[] = [];
  const issues: (NetIssue & { port: number })[] = [];
  await mapLimit(open, 4, async (port) => {
    const probe = PORT_PROBES[port];
    let res = null;
    try {
      res = probe ? await probe(ip, port) : null;
    } catch {
      res = null;
    }
    services.push(res?.service ?? { port, proto: "tcp", name: "unknown" });
    for (const i of res?.issues ?? []) issues.push({ ...i, port });
  });
  services.sort((a, b) => a.port - b.port);
  return { ip, open, services, issues };
}
