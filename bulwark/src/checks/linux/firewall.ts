import type { Check, ExecSpec, Fix, Host } from "../../core/types.ts";
import { aptInstall, enableUnit, fail, hasSystemd, isDebianLike, needsAdmin, pass, unitState } from "../common.ts";
import { isExposed, linuxListeners, type Listener } from "./procnet.ts";

export interface FirewallState {
  kind: "ufw" | "firewalld" | "nftables" | "iptables" | "none" | "unknown";
  active: boolean;
  installed: { ufw: boolean; firewalld: boolean };
  detail: string;
}

const ufw = (...args: string[]): ExecSpec => ({ cmd: "ufw", args });

export async function firewallState(host: Host): Promise<FirewallState> {
  const hasUfw = (await host.stat("/usr/sbin/ufw")) !== null || (await host.which("ufw")) !== null;
  const fwd = (await hasSystemd(host)) ? await unitState(host, "firewalld.service") : null;
  const installed = { ufw: hasUfw, firewalld: !!fwd?.exists };

  if (fwd?.active) return { kind: "firewalld", active: true, installed, detail: "firewalld is running." };
  if (hasUfw) {
    if (host.isRoot) {
      const r = await host.exec("ufw", ["status"]);
      if (/Status:\s*active/i.test(r.stdout)) return { kind: "ufw", active: true, installed, detail: "ufw is on." };
    } else {
      const conf = (await host.readFile("/etc/ufw/ufw.conf")) ?? "";
      if (/^\s*ENABLED\s*=\s*yes/im.test(conf)) return { kind: "ufw", active: true, installed, detail: "ufw is set to on (/etc/ufw/ufw.conf)." };
    }
  }
  if (!host.isRoot) {
    return { kind: hasUfw ? "ufw" : "unknown", active: false, installed, detail: hasUfw ? "ufw is installed but turned off." : "Can't read firewall rules without admin rights." };
  }
  // Hand-written rules count too, if they actually filter incoming traffic.
  const nft = await host.exec("nft", ["list", "ruleset"]);
  if (nft.code === 0 && /hook input[^}]*policy drop|hook input[\s\S]*?\b(drop|reject)\b/.test(nft.stdout)) {
    return { kind: "nftables", active: true, installed, detail: "nftables rules filter incoming traffic." };
  }
  const ipt = await host.exec("iptables", ["-S", "INPUT"]);
  if (ipt.code === 0 && (/^-P INPUT (DROP|REJECT)/m.test(ipt.stdout) || /^-A INPUT .*-j (DROP|REJECT)/m.test(ipt.stdout))) {
    return { kind: "iptables", active: true, installed, detail: "iptables rules filter incoming traffic." };
  }
  return { kind: hasUfw ? "ufw" : "none", active: false, installed, detail: hasUfw ? "ufw is installed but turned off." : "No firewall is filtering incoming connections." };
}

// DHCP and mDNS are expected to listen on every network.
const BENIGN_UDP = new Set([68, 546, 5353, 323]);

export function exposedListeners(ls: Listener[]): Listener[] {
  const seen = new Set<string>();
  return ls
    .filter(isExposed)
    .filter((l) => !(l.proto === "udp" && (BENIGN_UDP.has(l.port) || l.port >= 32768)))
    .filter((l) => {
      const k = `${l.proto}/${l.port}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.port - b.port);
}

export const describeListener = (l: Listener) => `${l.port}/${l.proto}${l.process ? ` (${l.process})` : ""}`;

function sshPorts(ls: Listener[]): number[] {
  return [...new Set(ls.filter((l) => l.proto === "tcp" && isExposed(l) && (l.process === "sshd" || l.unit === "ssh.socket" || l.unit === "sshd.socket" || (l.port === 22 && !l.process))).map((l) => l.port))];
}

export const linuxFirewall: Check = {
  id: "linux.firewall",
  title: "The firewall is off",
  category: "Firewall",
  severity: "high",
  platforms: ["linux"],
  why: "Without a firewall, every program that listens for connections can be reached by every device on the network, including ones you forget are running.",
  steps: [
    "Debian, Ubuntu, Raspberry Pi OS: sudo apt install ufw && sudo ufw allow OpenSSH && sudo ufw enable",
    "Fedora and RHEL: sudo systemctl enable --now firewalld",
  ],
  references: ["https://help.ubuntu.com/community/UFW"],
  async run(host) {
    const st = await firewallState(host);
    if (st.active) return [pass(st.detail)];
    if (st.kind === "unknown") return [needsAdmin("the firewall")];
    const exposed = exposedListeners(await linuxListeners(host));
    const list = exposed.map(describeListener);
    const auto = st.installed.ufw || st.installed.firewalld || (await isDebianLike(host)) ? { fixId: "linux.firewall.enable" } : undefined;
    if (exposed.length) {
      return [
        fail(`${st.detail} ${exposed.length} service${exposed.length === 1 ? " is" : "s are"} reachable from other devices: ${list.slice(0, 6).join(", ")}${list.length > 6 ? "…" : ""}.`, {
          evidence: list,
          auto,
        }),
      ];
    }
    return [
      fail(`${st.detail} Nothing is listening for outside connections right now, but anything you install later will be reachable.`, {
        severity: "low",
        auto,
      }),
    ];
  },
};

export const linuxFirewallFix: Fix = {
  id: "linux.firewall.enable",
  title: () => "Turn on the firewall (keeping SSH reachable)",
  needsRoot: true,
  risk: "caution",
  reversible: true,
  async preconditions({ host }) {
    const st = await firewallState(host);
    if (st.active) return [{ ok: false, message: "The firewall is already on." }];
    if (!st.installed.ufw && !st.installed.firewalld && !(await isDebianLike(host))) {
      return [{ ok: false, message: "Neither ufw nor firewalld is installed, and Bulwark only installs ufw on Debian-based systems." }];
    }
    return [{ ok: true, message: st.installed.ufw ? "ufw is installed." : st.installed.firewalld ? "firewalld is installed." : "ufw will be installed with apt." }];
  },
  async warnings({ host }) {
    const ls = await linuxListeners(host);
    const ssh = sshPorts(ls);
    const others = exposedListeners(ls).filter((l) => !(l.proto === "tcp" && ssh.includes(l.port)));
    const w: string[] = [];
    if (ssh.length) w.push(`SSH (port ${ssh.join(", ")}) stays reachable, so you won't be locked out.`);
    for (const l of others.slice(0, 10)) {
      w.push(`${describeListener(l)} will no longer be reachable from other devices. If you need it: sudo ufw allow ${l.port}/${l.proto}`);
    }
    if (ls.some((l) => l.process === "docker-proxy") || (await host.stat("/var/run/docker.sock"))) {
      w.push("Docker publishes container ports around ufw, so those stay reachable. Publish them on 127.0.0.1 instead (-p 127.0.0.1:8080:80) if they shouldn't be.");
    }
    return w;
  },
  async apply(tx, { host }) {
    const st = await firewallState(host);
    const ls = await linuxListeners(host);
    if (!st.installed.ufw && st.installed.firewalld) {
      await enableUnit(tx, host, "firewalld.service", "Start firewalld and turn it on at boot");
      tx.note("firewalld's default zone allows SSH on port 22 and blocks other incoming connections.");
      return;
    }
    if (!st.installed.ufw) await aptInstall(tx, host, "ufw", "Install ufw");
    const added = host.isRoot && st.installed.ufw ? (await host.exec("ufw", ["show", "added"])).stdout : "";
    for (const port of sshPorts(ls)) {
      if (new RegExp(`ufw (allow|limit) (in )?${port}(/tcp)?\\b`).test(added) || (port === 22 && /ufw (allow|limit) (OpenSSH|ssh)\b/i.test(added))) continue;
      await tx.exec(ufw("allow", `${port}/tcp`, "comment", "Bulwark: keep SSH reachable"), {
        title: `Allow SSH on port ${port}`,
        undo: ufw("delete", "allow", `${port}/tcp`),
      });
    }
    const defaults = (await host.readFile("/etc/default/ufw")) ?? "";
    const policy = defaults.match(/^\s*DEFAULT_INPUT_POLICY\s*=\s*"?(\w+)"?/m)?.[1]?.toUpperCase() ?? "DROP";
    if (policy === "ACCEPT") {
      await tx.exec(ufw("default", "deny", "incoming"), { title: "Block incoming connections by default", undo: ufw("default", "allow", "incoming") });
    }
    await tx.exec(ufw("--force", "enable"), { title: "Turn ufw on (now and at boot)", undo: ufw("disable") });
  },
  async validate({ host }) {
    const st = await firewallState(host);
    return st.active ? null : "The firewall still isn't on after enabling it.";
  },
};

export const linuxBlockPortFix: Fix = {
  id: "linux.firewall.block-port",
  title: (p) => `Block port ${p.port}/${p.proto} from other devices`,
  needsRoot: true,
  risk: "caution",
  reversible: true,
  async preconditions({ host }) {
    const st = await firewallState(host);
    if (st.kind !== "ufw" || !st.active) {
      return [{ ok: false, message: "This needs ufw turned on. Fix \"The firewall is off\" first." }];
    }
    return [{ ok: true, message: "ufw is on." }];
  },
  async warnings({ params }) {
    return [`Programs on this device can still use port ${params.port}; only other devices are blocked.`];
  },
  async apply(tx, { host, params }) {
    const rule = `${Number(params.port)}/${params.proto === "udp" ? "udp" : "tcp"}`;
    const numbered = host.isRoot ? (await host.exec("ufw", ["status", "numbered"])).stdout : "";
    const hasRules = /^\[\s*1\]/m.test(numbered);
    // Rules are checked in order, so the block goes first in case an earlier rule allows the port.
    const spec = hasRules ? ufw("insert", "1", "deny", rule, "comment", "Bulwark") : ufw("deny", rule, "comment", "Bulwark");
    await tx.exec(spec, { title: `Block ${rule} for other devices`, undo: ufw("delete", "deny", rule) });
  },
};

export async function ufwActive(host: Host): Promise<boolean> {
  const st = await firewallState(host);
  return st.kind === "ufw" && st.active;
}
