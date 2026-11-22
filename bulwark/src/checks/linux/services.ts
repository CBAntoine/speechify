import type { Check, CheckOutcome, Fix, Host, Severity } from "../../core/types.ts";
import { sleep } from "../../core/util.ts";
import { clearHostCache } from "../../core/cache.ts";
import { disableUnit, fail, hasSystemd, pass, unitState } from "../common.ts";
import { ufwActive } from "./firewall.ts";
import { isExposed, linuxListeners, linuxProcesses, type Listener } from "./procnet.ts";

type FixKind = "disable" | "firewall" | "redis" | "none";

interface Risky {
  ports: number[];
  proto: "tcp" | "udp";
  name: string;
  severity: Severity;
  why: string;
  fix: FixKind;
  steps: string[];
}

const RISKY: Risky[] = [
  { ports: [23, 2323], proto: "tcp", name: "Telnet", severity: "high", fix: "disable", why: "Telnet sends everything, passwords included, unencrypted, and it's the first thing botnets like Mirai try.", steps: ["Use SSH instead and turn Telnet off: sudo systemctl disable --now telnet.socket inetd"] },
  { ports: [512, 513, 514], proto: "tcp", name: "rsh/rlogin/rexec", severity: "high", fix: "disable", why: "These 1980s remote-login services have no encryption and trust IP addresses that are easy to fake.", steps: ["Remove them: sudo apt purge rsh-server (or the matching package)"] },
  { ports: [21], proto: "tcp", name: "FTP", severity: "medium", fix: "disable", why: "FTP sends passwords and files unencrypted.", steps: ["Use SFTP (part of SSH) instead, then turn the FTP server off."] },
  { ports: [69], proto: "udp", name: "TFTP", severity: "medium", fix: "disable", why: "TFTP has no passwords: anyone on the network can read, and often write, its files.", steps: ["Turn the TFTP server off unless you're network-booting devices."] },
  { ports: [6000, 6001, 6002, 6003, 6004, 6005], proto: "tcp", name: "X11", severity: "high", fix: "none", why: "An X display listening on the network can be watched and typed into from other machines.", steps: ["Start X with -nolisten tcp (the default on modern systems) and use ssh -X for remote apps."] },
  { ports: [2375], proto: "tcp", name: "Docker API (no TLS)", severity: "critical", fix: "none", why: "Anyone who can reach the Docker API without TLS controls every container and, through them, the whole machine.", steps: ["Remove -H tcp://0.0.0.0:2375 from dockerd's settings (/etc/docker/daemon.json or the service file) and use the local socket or SSH (docker -H ssh://host)."] },
  { ports: [5555], proto: "tcp", name: "Android Debug Bridge", severity: "critical", fix: "none", why: "ADB over the network hands a full shell to whoever connects.", steps: ["Turn off network debugging (adb usb, or in Developer options)."] },
  { ports: [10250, 2379, 2380], proto: "tcp", name: "Kubernetes/etcd", severity: "high", fix: "firewall", why: "The kubelet and etcd APIs control the cluster and hold its secrets.", steps: ["Only expose these on the cluster's private network, with authentication on."] },
  { ports: [6379], proto: "tcp", name: "Redis", severity: "high", fix: "redis", why: "Redis has no password by default, and an exposed Redis can be used to write files and take over the machine.", steps: ["In /etc/redis/redis.conf set: bind 127.0.0.1 and protected-mode yes (and requirepass if other devices need it), then restart Redis."] },
  { ports: [11211], proto: "tcp", name: "Memcached", severity: "high", fix: "firewall", why: "Memcached has no passwords: anyone who can reach it reads and changes cached data.", steps: ["Add -l 127.0.0.1 to /etc/memcached.conf and restart memcached."] },
  { ports: [11211], proto: "udp", name: "Memcached (UDP)", severity: "high", fix: "firewall", why: "Memcached over UDP is used for huge reflection attacks and has no passwords.", steps: ["Add -U 0 and -l 127.0.0.1 to /etc/memcached.conf and restart memcached."] },
  { ports: [27017], proto: "tcp", name: "MongoDB", severity: "high", fix: "firewall", why: "Exposed MongoDB servers are wiped and held for ransom by bots every day.", steps: ["Set net.bindIp: 127.0.0.1 in /etc/mongod.conf, turn on authorization, restart mongod."] },
  { ports: [9200, 9300], proto: "tcp", name: "Elasticsearch", severity: "high", fix: "firewall", why: "Exposed Elasticsearch clusters leak and lose data to bots.", steps: ["Set network.host: 127.0.0.1 (or turn on security) in elasticsearch.yml."] },
  { ports: [5984], proto: "tcp", name: "CouchDB", severity: "medium", fix: "firewall", why: "CouchDB's admin API is reachable from the network.", steps: ["Set bind_address = 127.0.0.1 in local.ini."] },
  { ports: [3306], proto: "tcp", name: "MySQL/MariaDB", severity: "medium", fix: "firewall", why: "Databases shouldn't take connections from other devices unless an app elsewhere needs them.", steps: ["Set bind-address = 127.0.0.1 in the [mysqld] section and restart."] },
  { ports: [5432], proto: "tcp", name: "PostgreSQL", severity: "medium", fix: "firewall", why: "Databases shouldn't take connections from other devices unless an app elsewhere needs them.", steps: ["Set listen_addresses = 'localhost' in postgresql.conf and restart."] },
  { ports: [1433], proto: "tcp", name: "SQL Server", severity: "medium", fix: "firewall", why: "Databases shouldn't take connections from other devices unless an app elsewhere needs them.", steps: ["Limit SQL Server to localhost or block port 1433 in the firewall."] },
  { ports: [1883], proto: "tcp", name: "MQTT", severity: "medium", fix: "firewall", why: "An MQTT broker often controls smart-home devices; without a password anyone on the network can.", steps: ["Set allow_anonymous false and a password file in mosquitto.conf, or listen on localhost only."] },
  { ports: [5900, 5901, 5902, 5903], proto: "tcp", name: "VNC", severity: "medium", fix: "firewall", why: "VNC remote desktop is attacked constantly and is often set up with a weak or no password.", steps: ["Use a strong VNC password and reach it through SSH or a VPN instead of opening it to the network."] },
  { ports: [3389], proto: "tcp", name: "Remote Desktop (RDP)", severity: "medium", fix: "firewall", why: "RDP is a favourite target for password guessing.", steps: ["Only allow RDP through a VPN or from specific addresses."] },
  { ports: [2049], proto: "tcp", name: "NFS", severity: "medium", fix: "firewall", why: "NFS shares trust the client's word about who it is.", steps: ["Limit /etc/exports to specific addresses and use root_squash."] },
  { ports: [111], proto: "tcp", name: "rpcbind", severity: "low", fix: "firewall", why: "rpcbind tells anyone which RPC services run here and has been used for reflection attacks.", steps: ["If you don't use NFS: sudo systemctl disable --now rpcbind.socket rpcbind"] },
  { ports: [161], proto: "udp", name: "SNMP", severity: "medium", fix: "firewall", why: "SNMP often uses the community name 'public' and can leak (or change) device settings.", steps: ["Limit snmpd to localhost or set a private community and SNMPv3."] },
];

// Never offered for "turn it off": you'd lose remote access or something the system needs.
const PROTECTED_UNITS = /^(ssh|sshd|systemd-.*|dbus|NetworkManager|networkd|docker|containerd|snapd|cron|rsyslog|polkit|gdm|lightdm|sddm|display-manager|wpa_supplicant|tailscaled|cups)\.(service|socket)$/;

interface SocketUnit {
  listen: string;
  port: number;
  unit: string;
}

async function socketUnits(host: Host): Promise<SocketUnit[]> {
  if (!(await hasSystemd(host))) return [];
  const r = await host.exec("systemctl", ["list-sockets", "--all", "--no-legend", "--no-pager"]);
  const out: SocketUnit[] = [];
  for (const line of r.stdout.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f.length < 2) continue;
    const m = f[0].match(/:(\d+)$/);
    if (m) out.push({ listen: f[0], port: Number(m[1]), unit: f[1] });
  }
  return out;
}

function riskyFor(l: Listener): Risky | undefined {
  return RISKY.find((r) => r.proto === l.proto && r.ports.includes(l.port));
}

async function unitFor(host: Host, l: Listener): Promise<string | undefined> {
  if (l.unit && l.unit.endsWith(".service") && l.process !== "systemd") return l.unit;
  // Socket-activated services are owned by systemd itself; ask systemd which socket unit it is.
  const sock = (await socketUnits(host)).find((s) => s.port === l.port);
  return sock?.unit ?? l.unit;
}

async function redisConfigFor(host: Host, unit: string | undefined): Promise<string | null> {
  if (unit) {
    const r = await host.exec("systemctl", ["show", "-p", "ExecStart", "--no-pager", unit]);
    const conf = r.stdout.match(/argv\[\]=\S*redis-server\s+(\/\S+\.conf)/)?.[1];
    if (conf && (await host.readFile(conf)) !== null) return conf;
  }
  for (const p of ["/etc/redis/redis.conf", "/etc/redis.conf"]) if ((await host.readFile(p)) !== null) return p;
  return null;
}

export const riskyServices: Check = {
  id: "linux.services.risky",
  title: "A risky service is reachable from the network",
  category: "Services",
  severity: "high",
  platforms: ["linux"],
  why: "Some services are unsafe to expose: they send passwords unencrypted, have no passwords at all, or are hunted by bots.",
  async run(host) {
    const listeners = (await linuxListeners(host)).filter(isExposed);
    const seen = new Set<string>();
    const out: CheckOutcome[] = [];
    const ufwOn = await ufwActive(host);
    for (const l of listeners) {
      const r = riskyFor(l);
      if (!r) continue;
      const key = `${l.proto}/${l.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const who = l.process ? ` (${l.process}${l.pid ? `, pid ${l.pid}` : ""})` : "";
      const unit = host.isRoot ? await unitFor(host, l) : l.unit;
      let auto: CheckOutcome["auto"];
      const steps = [...r.steps];
      if (l.process === "docker-proxy") {
        steps.unshift(`This port is published by a Docker container. Publish it on 127.0.0.1 only (for example -p 127.0.0.1:${l.port}:${l.port}); Docker's ports get around ufw.`);
      } else if (r.fix === "disable" && unit && !PROTECTED_UNITS.test(unit) && !/inetd/.test(l.process ?? "")) {
        auto = { fixId: "linux.service.disable", params: { unit, port: l.port, proto: l.proto } };
      } else if (r.fix === "redis" && (await redisConfigFor(host, unit))) {
        auto = { fixId: "linux.redis.bind-localhost", params: { unit: unit ?? "redis-server.service" } };
      } else if ((r.fix === "firewall" || r.fix === "disable" || r.fix === "redis") && ufwOn) {
        auto = { fixId: "linux.firewall.block-port", params: { port: l.port, proto: l.proto } };
      }
      if (/inetd/.test(l.process ?? "")) steps.unshift(`It's started by ${l.process}: comment out its line in /etc/inetd.conf (or set disable = yes in /etc/xinetd.d/), then restart ${l.process}.`);
      out.push(
        fail(`${r.name} is listening on ${l.address === "0.0.0.0" || l.address === "::" ? "all networks" : l.address} port ${l.port}/${l.proto}${who}.`, {
          subject: key,
          title: `${r.name} is reachable from other devices`,
          severity: r.severity,
          evidence: [`${l.address}:${l.port}/${l.proto}${who}${unit ? ` unit ${unit}` : ""}`, r.why],
          auto,
          steps,
        }),
      );
    }
    if (!out.length) {
      if (!host.isRoot && listeners.some((l) => !l.process)) {
        return [pass("No risky services are reachable from the network.", { evidence: ["Run as admin to also see which program owns each port."] })];
      }
      return [pass("No risky services are reachable from the network.")];
    }
    return out;
  },
};

export const disableServiceFix: Fix = {
  id: "linux.service.disable",
  title: (p) => `Turn off ${p.unit}`,
  needsRoot: true,
  risk: "caution",
  reversible: true,
  async preconditions({ host, params }) {
    const unit = String(params.unit);
    if (PROTECTED_UNITS.test(unit)) return [{ ok: false, message: `${unit} is needed by the system or for remote access, so Bulwark won't turn it off.` }];
    const st = await unitState(host, unit);
    return [{ ok: st.exists, message: st.exists ? `${unit} exists (${st.activeState}, ${st.unitFileState}).` : `${unit} doesn't exist anymore.` }];
  },
  async warnings({ params }) {
    return [`Anything that relies on ${params.unit} stops working, on this device too. Undo brings it back.`];
  },
  async apply(tx, { host, params }) {
    const unit = String(params.unit);
    if (!/^[\w@.-]+\.(service|socket)$/.test(unit)) throw new Error("Unexpected unit name.");
    // A service started by a socket comes back on the next connection unless its socket goes too.
    if (unit.endsWith(".service")) {
      const sock = unit.replace(/\.service$/, ".socket");
      const st = await unitState(host, sock);
      if (st.exists && (st.active || st.enabled)) await disableUnit(tx, host, sock);
    } else {
      const svc = unit.replace(/\.socket$/, ".service");
      const st = await unitState(host, svc);
      if (st.exists && st.active) await disableUnit(tx, host, svc);
    }
    await disableUnit(tx, host, unit);
  },
  async validate({ host, params }) {
    clearHostCache(host);
    const still = (await linuxListeners(host)).some((l) => isExposed(l) && l.port === Number(params.port) && l.proto === params.proto);
    return still ? `Port ${params.port}/${params.proto} is still open after turning off ${params.unit}.` : null;
  },
};

export function setRedisBind(conf: string): string {
  const lines = conf.split("\n");
  let sawBind = false;
  let sawProtected = false;
  const out = lines.map((l) => {
    const t = l.trim();
    if (/^bind\s/i.test(t)) {
      if (sawBind) return `# ${l}`;
      sawBind = true;
      return "bind 127.0.0.1";
    }
    if (/^protected-mode\s/i.test(t)) {
      sawProtected = true;
      return "protected-mode yes";
    }
    return l;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  if (!sawBind) out.push("", "# Added by Bulwark: only accept connections from this device.", "bind 127.0.0.1");
  if (!sawProtected) out.push("protected-mode yes");
  return out.join("\n") + "\n";
}

export const redisBindFix: Fix = {
  id: "linux.redis.bind-localhost",
  title: () => "Make Redis only accept connections from this device",
  needsRoot: true,
  risk: "caution",
  reversible: true,
  async warnings() {
    return ["Apps on other devices that use this Redis will lose access. Apps on this device keep working.", "Redis restarts, which empties it unless it saves to disk (the default)."];
  },
  async apply(tx, { host, params }) {
    const unit = String(params.unit);
    if (!/^[\w@.-]+\.service$/.test(unit)) throw new Error("Unexpected unit name.");
    const conf = await redisConfigFor(host, unit);
    if (!conf) throw new Error("Couldn't find Redis's configuration file.");
    const text = (await host.readFile(conf))!;
    await tx.writeFile(conf, setRedisBind(text));
    await tx.exec({ cmd: "systemctl", args: ["restart", unit] }, { title: `Restart ${unit}`, rerunOnRollback: true });
  },
  async validate({ host, params }) {
    await sleep(1500);
    clearHostCache(host);
    const st = await unitState(host, String(params.unit));
    if (!st.active) return `${params.unit} didn't come back up after the change.`;
    const exposed = (await linuxListeners(host)).some((l) => l.port === 6379 && isExposed(l));
    return exposed ? "Redis is still listening on the network." : null;
  },
};

// ── cups-browsed (CVE-2024-47176) ──

export const cupsBrowsed: Check = {
  id: "linux.services.cups-browsed",
  title: "cups-browsed accepts printers from the network (CVE-2024-47176)",
  category: "Services",
  severity: "high",
  platforms: ["linux"],
  why: "cups-browsed listens on UDP port 631 and adds any printer that announces itself. Chained with related bugs, a single packet from the network can get commands run when you print.",
  steps: ["sudo systemctl disable --now cups-browsed", "Printing to printers you add yourself keeps working."],
  references: ["https://www.cve.org/CVERecord?id=CVE-2024-47176", "https://openprinting.github.io/OpenPrinting-News-Flash-cups-browsed-Remote-Code-Execution-vulnerability/"],
  async run(host) {
    const ls = await linuxListeners(host);
    const udp631 = ls.find((l) => l.proto === "udp" && l.port === 631 && isExposed(l));
    const procs = await linuxProcesses(host);
    const running = procs.some((p) => p.comm === "cups-browsed");
    if (!running && !udp631) return [pass("cups-browsed isn't running.")];
    if (!udp631) return [pass("cups-browsed is running but doesn't listen for printer announcements on the network.")];
    // Without root the socket's owner is hidden, but nothing else normally binds UDP 631.
    return [
      fail("cups-browsed is listening for printer announcements on UDP port 631 from any network.", {
        cves: ["CVE-2024-47176", "CVE-2024-47076", "CVE-2024-47175", "CVE-2024-47177"],
        evidence: [`${udp631.address}:631/udp${udp631.process ? ` (${udp631.process})` : ""}`],
        auto: (await hasSystemd(host)) ? { fixId: "linux.service.disable", params: { unit: "cups-browsed.service", port: 631, proto: "udp" } } : undefined,
      }),
    ];
  },
};
