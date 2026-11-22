import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { outcomeToFinding } from "../src/core/audit.ts";
import { applyFix, planFix, rollbackChange } from "../src/core/fixer.ts";
import { StateStore } from "../src/core/state.ts";
import type { Check, Finding } from "../src/core/types.ts";
import { defaultPasswords, emptyPasswords, findNopasswdAll, sudoNopasswd } from "../src/checks/linux/accounts.ts";
import { worldWritable } from "../src/checks/linux/files.ts";
import { linuxFirewall } from "../src/checks/linux/firewall.ts";
import { parseProcNet, unitFromCgroup } from "../src/checks/linux/procnet.ts";
import { cupsBrowsed, riskyServices, setRedisBind } from "../src/checks/linux/services.ts";
import { rootSource } from "../src/checks/linux/system.ts";
import { parseAptSimulation, parseAptConfig } from "../src/checks/linux/updates.ts";
import { aptInstall } from "../src/checks/common.ts";
import { FIXES } from "../src/checks/index.ts";
import { Tx } from "../src/core/tx.ts";
import { BULWARK_DROPIN, effectiveValue, parseSshdConfig, planSshdEdits, sshPasswordAuth, sshRootLogin } from "../src/checks/ssh.ts";
import { classifyMac, classifyNetsh, classifyNmcli, splitTerse } from "../src/checks/wifi.ts";
import { FakeHost } from "./helpers/fake-host.ts";

const run = async (check: Check, host: FakeHost): Promise<Finding[]> => (await check.run(host)).map((o) => outcomeToFinding(check, o));
const tempState = async () => new StateStore(await fs.mkdtemp(path.join(os.tmpdir(), "bulwark-test-")));

// ── SSH ──

const UBUNTU_MAIN = `# Ubuntu-style sshd_config
Include /etc/ssh/sshd_config.d/*.conf

PermitRootLogin yes
KbdInteractiveAuthentication no
UsePAM yes
X11Forwarding yes
Subsystem sftp /usr/lib/openssh/sftp-server

Match User backup
    PasswordAuthentication yes
`;

function sshHost(main = UBUNTU_MAIN): FakeHost {
  return new FakeHost()
    .file("/usr/sbin/sshd", "", 0o755)
    .file("/etc/ssh/sshd_config", main)
    .file("/etc/ssh/sshd_config.d/50-cloud-init.conf", "PasswordAuthentication yes\n")
    .file("/etc/passwd", "root:x:0:0:root:/root:/bin/bash\nalice:x:1000:1000::/home/alice:/bin/bash\nsvc:x:998:998::/var/lib/svc:/usr/sbin/nologin\n")
    .file("/home/alice/.ssh/authorized_keys", "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJx alice@laptop\n", 0o600, [1000, 1000])
    .file("/run/systemd/system/.keep", "")
    .file("/proc/net/tcp", "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 00000000:0016 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 4242 1 0 100 0 0 10 0\n")
    .command("sshd", (args) => (args[0] === "-T" ? { code: 1 } : { code: 0 }))
    .command("systemctl", (args) => (args[0] === "show" && args.includes("ssh.service") ? { stdout: "LoadState=loaded\nActiveState=active\nUnitFileState=enabled\n" } : args[0] === "show" ? { stdout: "LoadState=not-found\n" } : {}));
}

test("sshd config: first value wins, includes are read in place, Match blocks are separate", async () => {
  const host = sshHost();
  const cfg = await parseSshdConfig(host);
  assert.equal(effectiveValue(cfg, "PasswordAuthentication"), "yes"); // from the cloud-init drop-in, read first
  assert.equal(effectiveValue(cfg, "PermitRootLogin"), "yes");
  assert.equal(effectiveValue(cfg, "PermitEmptyPasswords"), "no"); // built-in default
  assert.ok(cfg.directives.some((d) => d.keyword === "passwordauthentication" && d.match === "User backup"));
  assert.deepEqual(cfg.includes[0].matched, ["/etc/ssh/sshd_config.d/50-cloud-init.conf"]);
});

test("ssh checks flag root password login and password authentication", async () => {
  const host = sshHost();
  const root = await run(sshRootLogin, host);
  assert.equal(root[0].status, "fail");
  assert.equal(root[0].severity, "high");
  assert.equal(root[0].remedy?.auto?.fixId, "ssh.root-login");
  const pw = await run(sshPasswordAuth, host);
  assert.equal(pw[0].status, "fail");
});

test("ssh fix writes a drop-in that's read first and comments out the earlier winner", async () => {
  const host = sshHost("PermitRootLogin yes\nInclude /etc/ssh/sshd_config.d/*.conf\nUsePAM yes\n");
  const { edits, notes } = await planSshdEdits(host, { permitrootlogin: "prohibit-password" });
  assert.match(edits.get(BULWARK_DROPIN)!, /^PermitRootLogin prohibit-password$/m);
  assert.match(edits.get("/etc/ssh/sshd_config")!, /^# PermitRootLogin yes {2}# turned off by Bulwark/m);
  assert.ok(notes.some((n) => n.includes("sshd_config:1")));
  // Applying the overlay must give the wanted value.
  const overlay = new Map<string, string | null>(edits);
  assert.equal(effectiveValue(await parseSshdConfig(host, "/etc/ssh/sshd_config", overlay), "permitrootlogin"), "prohibit-password");
});

test("ssh fix falls back to the top of sshd_config when there's no drop-in folder", async () => {
  const host = sshHost("Port 22\nPermitRootLogin yes\n");
  const { edits } = await planSshdEdits(host, { permitrootlogin: "prohibit-password" });
  const main = edits.get("/etc/ssh/sshd_config")!;
  assert.match(main, /^# >>> Bulwark[^\n]*\nPermitRootLogin prohibit-password\n# <<< Bulwark\n/);
  assert.equal(edits.has(BULWARK_DROPIN), false);
  // Running it twice doesn't stack blocks.
  host.file("/etc/ssh/sshd_config", main);
  const again = await planSshdEdits(host, { permitrootlogin: "prohibit-password", permitemptypasswords: "no" });
  assert.equal((again.edits.get("/etc/ssh/sshd_config")!.match(/# >>> Bulwark/g) ?? []).length, 1);
});

test("ssh fix: apply validates with sshd -t, reloads, and rolls back cleanly", async () => {
  const host = sshHost();
  const state = await tempState();
  const [finding] = await run(sshRootLogin, host);
  const change = await applyFix(host, state, [finding]);
  assert.equal(change.status, "applied", change.error);
  assert.ok(host.ran("sshd", "-t"));
  assert.ok(host.ran("systemctl", "reload", "ssh.service"));
  assert.match((await host.readFile(BULWARK_DROPIN))!, /PermitRootLogin prohibit-password/);
  host.execs.length = 0;
  await rollbackChange(host, state, change.id);
  assert.equal(await host.readFile(BULWARK_DROPIN), null);
  assert.ok(host.ran("systemctl", "reload", "ssh.service"), "reloads again after restoring the files");
});

test("ssh fix: a config that fails sshd -t is undone automatically", async () => {
  const host = sshHost();
  host.on((cmd, args) => (cmd.endsWith("sshd") && args[0] === "-t" && host.files.has(BULWARK_DROPIN) ? { code: 255, stdout: "", stderr: "Bad configuration option" } : undefined));
  const state = await tempState();
  const [finding] = await run(sshRootLogin, host);
  const change = await applyFix(host, state, [finding]);
  assert.equal(change.status, "rolled-back");
  assert.equal(await host.readFile(BULWARK_DROPIN), null);
  assert.ok(!host.ran("systemctl", "reload", "ssh.service"), "never reloads a broken config");
});

test("turning off SSH passwords is blocked when nobody has a key", async () => {
  const host = sshHost();
  host.files.delete("/home/alice/.ssh/authorized_keys");
  const [finding] = await run(sshPasswordAuth, host);
  const plan = await planFix(host, [finding]);
  assert.equal(plan.canApply, false);
  assert.match(plan.blockedReason!, /lock everyone out/);
  host.file("/home/alice/.ssh/authorized_keys", "# comment\nno-pty ssh-ed25519 AAAA alice\n");
  const ok = await planFix(host, [finding]);
  assert.ok(ok.canApply, ok.blockedReason);
  assert.ok(ok.preconditions.some((p) => p.ok && p.message.includes("alice")));
});

// ── accounts ──

test("empty and factory passwords are found", async () => {
  const host = new FakeHost()
    .file("/etc/passwd", "root:x:0:0::/root:/bin/bash\npi:x:1000:1000::/home/pi:/bin/bash\nguest:x:1001:1001::/home/guest:/bin/bash\nnobody:x:65534:65534::/:/usr/sbin/nologin\n")
    .file("/etc/shadow", "root:!:19000::::::\npi:$6$salt$hash:19000::::::\nguest::19000::::::\nnobody::19000::::::\n", 0o640)
    .command("perl", (_args, input) => ({
      // Pretend crypt(): pi's hash matches "raspberry".
      stdout: (input ?? "").split("\n").filter(Boolean).map((l) => {
        const [i, , pw] = l.split("\t");
        return `${i}\t${pw === "raspberry" ? 1 : 0}`;
      }).join("\n"),
    }));
  const empty = await run(emptyPasswords, host);
  assert.deepEqual(empty.map((f) => f.id), ["linux.accounts.empty-password:guest"], "nologin accounts don't count");
  const defaults = await run(defaultPasswords, host);
  assert.equal(defaults[0].id, "linux.accounts.default-password:pi");
  assert.match(defaults[0].summary, /factory password \("ra•+"\)/);
  const shown = JSON.stringify([defaults[0].title, defaults[0].summary, defaults[0].evidence, defaults[0].remedy]);
  assert.ok(!shown.includes("raspberry"), "the password itself is never shown");
});

test("passwordless sudo rules are found and the fix keeps sudo working", async () => {
  const sudoers = "Defaults env_reset\n%sudo ALL=(ALL:ALL) ALL\n";
  const host = new FakeHost()
    .file("/etc/sudoers", sudoers, 0o440)
    .file("/etc/sudoers.d/010_pi-nopasswd", "pi ALL=(ALL) NOPASSWD: ALL\n", 0o440)
    .file("/etc/sudoers.d/README.txt", "pi ALL=(ALL) NOPASSWD: ALL\n", 0o440)
    .file("/etc/shadow", "pi:$y$j9T$abc:19000::::::\n", 0o640)
    .command("visudo");
  assert.equal(findNopasswdAll("ci ALL=(ALL) NOPASSWD: /usr/bin/apt\n", "x").length, 0, "only blanket ALL counts");
  const found = await run(sudoNopasswd, host);
  assert.equal(found.length, 1, "files with a dot in the name are ignored, like sudo does");
  const state = await tempState();
  const change = await applyFix(host, state, found);
  assert.equal(change.status, "applied", change.error);
  const after = (await host.readFile("/etc/sudoers.d/010_pi-nopasswd"))!;
  assert.match(after, /^pi ALL=\(ALL\) ALL$/m);
  assert.match(after, /^# Bulwark removed NOPASSWD/m);
  assert.equal((await host.stat("/etc/sudoers.d/010_pi-nopasswd"))!.mode, 0o440, "permissions untouched");
  assert.ok(host.ran("visudo", "-c"));
});

test("passwordless sudo fix is blocked when the user has no password", async () => {
  const host = new FakeHost()
    .file("/etc/sudoers", "", 0o440)
    .file("/etc/sudoers.d/90-cloud-init-users", "ubuntu ALL=(ALL) NOPASSWD:ALL\n", 0o440)
    .file("/etc/shadow", "ubuntu:!:19000::::::\n", 0o640)
    .command("visudo");
  const found = await run(sudoNopasswd, host);
  const plan = await planFix(host, found);
  assert.equal(plan.canApply, false);
  assert.match(plan.blockedReason!, /no password/);
});

// ── files ──

test("world-writable system files are found; sticky folders and symlinks are not", async () => {
  const host = new FakeHost()
    .dir("/etc")
    .file("/etc/cron.d/job", "* * * * * root /x\n", 0o666)
    .file("/etc/ok.conf", "", 0o644)
    .dir("/etc/shared", 0o1777)
    .link("/etc/alternatives", "/var/lib/alts")
    .dir("/usr/local/bin")
    .file("/usr/local/bin/backup.sh", "#!/bin/sh\n", 0o777);
  const found = (await run(worldWritable, host)).filter((f) => f.status === "fail");
  assert.deepEqual(found.map((f) => f.id).sort(), ["linux.files.world-writable:/etc/cron.d/job", "linux.files.world-writable:/usr/local/bin/backup.sh"]);
  assert.equal(found.find((f) => f.id.endsWith("cron.d/job"))!.severity, "high");
  assert.deepEqual(found[0].remedy!.auto!.params, { items: [{ path: found[0].id.split(":")[1], mode: found[0].id.includes("cron") ? 0o664 : 0o775 }] });
});

// ── services, firewall ──

test("/proc/net parsing (IPv4, IPv6, UDP)", () => {
  const tcp = "header\n   0: 0100007F:1F90 00000000:0000 0A 0 0 0 0 0 0 0 111 1\n   1: 00000000:0017 00000000:0000 0A 0 0 0 0 0 0 0 222 1\n   2: 0100007F:9C40 0200A8C0:01BB 01 0 0 0 0 0 0 0 333 1\n";
  const l = parseProcNet(tcp, "tcp", 4);
  assert.deepEqual(l.map((x) => `${x.address}:${x.port}`), ["127.0.0.1:8080", "0.0.0.0:23"]);
  const v6 = "header\n   0: 00000000000000000000000001000000:0016 00000000000000000000000000000000:0000 0A 0 0 0 0 0 0 0 9 1\n   1: 00000000000000000000000000000000:0277 00000000000000000000000000000000:0000 07 0 0 0 0 0 0 0 8 1\n";
  assert.equal(parseProcNet(v6, "tcp", 6)[0].address, "::1");
  assert.equal(parseProcNet(v6, "udp", 6)[0].address, "::");
  assert.equal(unitFromCgroup("0::/system.slice/redis-server.service\n"), "redis-server.service");
  assert.equal(unitFromCgroup("0::/user.slice/user-1000.slice/session-2.scope\n"), undefined);
});

function procHost(listeners: { port: number; proto: "tcp" | "udp"; addr: string; pid: number; comm: string; unit: string }[]): FakeHost {
  const host = new FakeHost();
  const hex = (ip: string) => ip.split(".").reverse().map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase();
  const lines = { tcp: ["header"], udp: ["header"] };
  listeners.forEach((l, i) => {
    // Same columns as the kernel: sl local rem st tx:rx tr:when retrnsmt uid timeout inode …
    lines[l.proto].push(`   ${i}: ${hex(l.addr)}:${l.port.toString(16).toUpperCase().padStart(4, "0")} 00000000:0000 ${l.proto === "tcp" ? "0A" : "07"} 00000000:00000000 00:00000000 00000000 0 0 ${9000 + i} 1`);
    host.file(`/proc/${l.pid}/comm`, l.comm + "\n").file(`/proc/${l.pid}/cgroup`, `0::/system.slice/${l.unit}\n`).link(`/proc/${l.pid}/fd/3`, `socket:[${9000 + i}]`);
  });
  host.file("/proc/net/tcp", lines.tcp.join("\n") + "\n").file("/proc/net/udp", lines.udp.join("\n") + "\n").file("/run/systemd/system/.keep", "");
  const units = new Set(listeners.map((l) => l.unit));
  host.command("systemctl", (args) => {
    if (args[0] !== "show") return {};
    const unit = args[args.length - 1];
    return { stdout: units.has(unit) ? "LoadState=loaded\nActiveState=active\nUnitFileState=enabled\n" : "LoadState=not-found\nActiveState=inactive\n" };
  });
  return host;
}

test("risky services: telnet gets a 'turn it off' fix, ssh is never offered", async () => {
  const host = procHost([
    { port: 23, proto: "tcp", addr: "0.0.0.0", pid: 101, comm: "in.telnetd", unit: "telnetd.service" },
    { port: 22, proto: "tcp", addr: "0.0.0.0", pid: 102, comm: "sshd", unit: "ssh.service" },
    { port: 6379, proto: "tcp", addr: "127.0.0.1", pid: 103, comm: "redis-server", unit: "redis-server.service" },
  ]);
  const found = (await run(riskyServices, host)).filter((f) => f.status === "fail");
  assert.equal(found.length, 1, "redis on localhost is fine");
  assert.equal(found[0].title, "Telnet is reachable from other devices");
  assert.deepEqual(found[0].remedy?.auto, { fixId: "linux.service.disable", params: { unit: "telnetd.service", port: 23, proto: "tcp" } });
});

test("cups-browsed listening on UDP 631 is flagged with its CVEs", async () => {
  const host = procHost([{ port: 631, proto: "udp", addr: "0.0.0.0", pid: 201, comm: "cups-browsed", unit: "cups-browsed.service" }]);
  const [f] = await run(cupsBrowsed, host);
  assert.equal(f.status, "fail");
  assert.ok(f.cves.includes("CVE-2024-47176"));
  assert.equal(f.remedy?.auto?.fixId, "linux.service.disable");
});

test("firewall check: off with exposed services", async () => {
  const host = procHost([{ port: 8080, proto: "tcp", addr: "0.0.0.0", pid: 301, comm: "node", unit: "app.service" }]);
  host.command("nft", { stdout: "" }).command("iptables", { stdout: "-P INPUT ACCEPT\n" }).file("/etc/os-release", 'ID=ubuntu\nID_LIKE=debian\n');
  const [f] = await run(linuxFirewall, host);
  assert.equal(f.status, "fail");
  assert.match(f.summary, /8080\/tcp \(node\)/);
  assert.equal(f.remedy?.auto?.fixId, "linux.firewall.enable");
});

test("redis bind edit keeps the rest of the file", () => {
  const out = setRedisBind("# comment\nbind 0.0.0.0 ::\nport 6379\nprotected-mode no\nbind 10.0.0.1\n");
  assert.equal(out, "# comment\nbind 127.0.0.1\nport 6379\nprotected-mode yes\n# bind 10.0.0.1\n");
});

// ── parsers ──

test("apt simulation and apt-config parsing", () => {
  const sim = [
    "Inst libssl3t64 [3.0.13-0ubuntu3.1] (3.0.13-0ubuntu3.4 Ubuntu:24.04/noble-updates, Ubuntu:24.04/noble-security [amd64])",
    "Inst tzdata [2024a-2ubuntu1] (2024b-0ubuntu0.24.04 Ubuntu:24.04/noble-updates [all])",
    "Inst openssh-server [1:9.2p1-2+deb12u2] (1:9.2p1-2+deb12u3 Debian-Security:12/stable-security [arm64])",
    "Conf libssl3t64 (3.0.13-0ubuntu3.4 Ubuntu:24.04/noble-updates)",
  ].join("\n");
  const p = parseAptSimulation(sim);
  assert.deepEqual(p.map((x) => [x.name, x.security]), [["libssl3t64", true], ["tzdata", false], ["openssh-server", true]]);
  assert.equal(parseAptConfig('APT::Periodic::Unattended-Upgrade "1";\nAPT::Periodic::Update-Package-Lists "0";', "APT::Periodic::Update-Package-Lists"), "0");
});

test("root filesystem from /proc/mounts", () => {
  assert.deepEqual(rootSource("sysfs /sys sysfs rw 0 0\n/dev/mapper/vg-root / ext4 rw 0 0\n"), { source: "/dev/mapper/vg-root", fstype: "ext4" });
});

test("wifi security classification", () => {
  assert.equal(classifyNmcli(""), "open");
  assert.equal(classifyNmcli("WEP"), "wep");
  assert.equal(classifyNmcli("WPA1"), "wpa1");
  assert.equal(classifyNmcli("WPA1 WPA2"), "wpa2-mixed");
  assert.equal(classifyNmcli("WPA2 WPA3"), "wpa3");
  assert.equal(classifyNmcli("WPA2 802.1X"), "enterprise");
  assert.equal(classifyMac("spairport_security_mode_wpa2_personal"), "wpa2");
  assert.equal(classifyMac("spairport_security_mode_none"), "open");
  assert.equal(classifyNetsh("Open", "WEP"), "wep");
  assert.equal(classifyNetsh("WPA2-Personal", "CCMP"), "wpa2");
  assert.deepEqual(splitTerse("yes:My\\:Net:WPA2"), ["yes", "My:Net", "WPA2"]);
});

// ── packages ──

test("installing a package as part of a fix is undone exactly", async () => {
  const fresh = new FakeHost().command("dpkg-query", { code: 1, stdout: "" }).command("apt-get");
  const tx = new Tx(fresh, { dryRun: false });
  await aptInstall(tx, fresh, "ufw", "Install ufw");
  assert.deepEqual(tx.actions[0].type === "exec" && tx.actions[0].undo?.args, ["purge", "-y", "ufw"], "never installed before: purge");

  const leftovers = new FakeHost().command("dpkg-query", { stdout: "deinstall ok config-files" }).command("apt-get");
  const tx2 = new Tx(leftovers, { dryRun: false });
  await aptInstall(tx2, leftovers, "ufw", "Install ufw");
  assert.deepEqual(tx2.actions[0].type === "exec" && tx2.actions[0].undo?.args, ["remove", "-y", "ufw"], "old settings were there: keep them");

  const present = new FakeHost().command("dpkg-query", { stdout: "install ok installed" }).command("apt-get");
  const tx3 = new Tx(present, { dryRun: false });
  await aptInstall(tx3, present, "ufw", "Install ufw");
  assert.equal(tx3.actions.length, 0, "already installed: nothing to do");
});

test("fixes that install software or change logins are never in the one-click batch", () => {
  for (const id of ["linux.updates.enable-automatic", "linux.updates.install-security", "linux.firewall.enable", "ssh.password-auth", "linux.sudo.require-password", "linux.accounts.expire-password", "linux.service.disable", "upnp.delete-mapping"]) {
    assert.equal(FIXES.get(id)?.risk, "caution", id);
  }
});
