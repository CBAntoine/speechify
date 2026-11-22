// Every device on the Wi-Fi: finding the quiet ones, naming them, checks for common home gear,
// the device inventory, and checking and fixing computers over SSH (with a stand-in ssh).

import assert from "node:assert/strict";
import * as dgram from "node:dgram";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { CHECKS, FIXES } from "../src/checks/index.ts";
import { fail, pass } from "../src/checks/common.ts";
import { auditLocal } from "../src/core/audit.ts";
import { applyFix, planFix, refreshFindings, rollbackChange } from "../src/core/fixer.ts";
import { createHost } from "../src/core/host.ts";
import { markdownReport } from "../src/core/report.ts";
import { allFindings, mergeRemote, runScan } from "../src/core/scan.ts";
import { StateStore } from "../src/core/state.ts";
import type { Check, Finding, Fix, Host, NetDevice, Scan } from "../src/core/types.ts";
import { adviceFor } from "../src/net/advice.ts";
import { mdnsUnicastSweep, nbnsSweep, nbstatQuery, parseNbstat, pingSweep } from "../src/net/discover.ts";
import { appleModel, macosFromDarwin } from "../src/net/identify.ts";
import { applyInventory, deviceKey, labelDevice, type Inventory } from "../src/net/inventory.ts";
import { parseIpNeigh } from "../src/net/local.ts";
import { vendorOf } from "../src/net/oui.ts";
import { classify } from "../src/net/scan.ts";
import { kasaDecode, kasaEncode, tasmotaCheck } from "../src/net/services/home.ts";
import { windowsFromNtlm, windowsIssue } from "../src/net/services/ntlm.ts";
import { scanRemote } from "../src/remote/scan.ts";
import { parseSshTarget, remoteHost, resetSessions, sessionFor, targetId, useStateDir } from "../src/remote/ssh.ts";
import { createApp } from "../src/server.ts";
import { FakeHost } from "./helpers/fake-host.ts";

const FAKE_SSH = fileURLToPath(new URL("./helpers/fake-ssh.mjs", import.meta.url));

// ── finding devices ──

test("ping finds quiet devices, and stops at once where ping isn't allowed", async () => {
  const pinged: string[] = [];
  const host = new FakeHost().command("ping", (args) => {
    const ip = args[args.length - 1];
    pinged.push(ip);
    return ip.endsWith(".7") || ip.endsWith(".9") ? { stdout: "64 bytes from …: icmp_seq=1 ttl=64 time=3.1 ms" } : { code: 1 };
  });
  const up = await pingSweep(host, ["192.168.1.5", "192.168.1.7", "192.168.1.9", "127.0.0.1"]);
  assert.deepEqual([...up].sort(), ["192.168.1.7", "192.168.1.9"]);
  assert.ok(!pinged.includes("127.0.0.1"), "loopback addresses are this computer");

  const denied = new FakeHost().command("ping", () => ({ code: 2, stderr: "ping: socket: Operation not permitted" }));
  let calls = 0;
  denied.on((cmd) => (cmd.endsWith("ping") ? (calls++, undefined) : undefined));
  assert.equal((await pingSweep(denied, ["192.168.1.5", "192.168.1.6", "192.168.1.7"])).size, 0);
  assert.equal(calls, 1);

  const win = new FakeHost({ platform: "win32" }).command("ping.exe", (args) =>
    args.includes("10.0.0.2") ? { stdout: "Reply from 10.0.0.2: bytes=32 time=2ms TTL=128" } : { stdout: "Reply from 10.0.0.1: Destination host unreachable." },
  );
  assert.deepEqual([...(await pingSweep(win, ["10.0.0.2", "10.0.0.3"]))], ["10.0.0.2"], "an 'unreachable' reply from the router doesn't count");
});

test("neighbour tables from `ip neigh` (Android hides /proc/net/arp)", () => {
  const t = parseIpNeigh(
    "192.168.1.1 dev wlan0 lladdr 3c:7c:3f:aa:bb:cc REACHABLE\n192.168.1.23 dev wlan0  FAILED\n192.168.1.40 dev wlan0 lladdr d8:3a:dd:01:02:03 STALE\nfe80::1 dev wlan0 lladdr 3c:7c:3f:aa:bb:cc router STALE\n",
  );
  assert.deepEqual([...t], [
    ["192.168.1.1", "3c:7c:3f:aa:bb:cc"],
    ["192.168.1.40", "d8:3a:dd:01:02:03"],
  ]);
});

function nbstatReply(names: [string, number, boolean][], mac: number[]): Buffer {
  const head = Buffer.from(nbstatQuery(0x1234).subarray(0, 46));
  head.writeUInt16BE(0x8400, 2); // response
  head.writeUInt16BE(0, 4);
  head.writeUInt16BE(1, 6);
  const rr = Buffer.alloc(10);
  rr.writeUInt16BE(0x0021, 0);
  rr.writeUInt16BE(1, 2);
  const entries = names.map(([n, suffix, group]) => {
    const e = Buffer.alloc(18, 0x20);
    e.write(n, 0, "latin1");
    e[15] = suffix;
    e.writeUInt16BE(group ? 0x8400 : 0x0400, 16);
    return e;
  });
  const data = Buffer.concat([Buffer.from([names.length]), ...entries, Buffer.from(mac), Buffer.alloc(40)]);
  rr.writeUInt16BE(data.length, 8);
  return Buffer.concat([head, rr, data]);
}

test("NetBIOS names: what Windows PCs and Samba servers call themselves", () => {
  const q = nbstatQuery();
  assert.equal(q.length, 50);
  assert.equal(q.subarray(13, 15).toString(), "CK", "the name '*' spelled the NetBIOS way");
  assert.equal(q.readUInt16BE(46), 0x21);
  assert.deepEqual(
    parseNbstat(nbstatReply([["FAMILY-PC", 0x00, false], ["WORKGROUP", 0x00, true], ["FAMILY-PC", 0x20, false]], [0x3c, 0x52, 0x82, 0x11, 0x22, 0x33])),
    { name: "FAMILY-PC", workgroup: "WORKGROUP", mac: "3c:52:82:11:22:33" },
  );
  assert.deepEqual(parseNbstat(nbstatReply([["NAS", 0x00, false]], [0, 0, 0, 0, 0, 0])), { name: "NAS" }, "Samba sends no hardware address");
  assert.equal(parseNbstat(Buffer.alloc(20)), null);
});

function dnsName(name: string): Buffer {
  return Buffer.concat([...name.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
}
function rr(name: string, type: number, data: Buffer): Buffer {
  const h = Buffer.alloc(10);
  h.writeUInt16BE(type, 0);
  h.writeUInt16BE(1, 2);
  h.writeUInt32BE(120, 4);
  h.writeUInt16BE(data.length, 8);
  return Buffer.concat([dnsName(name), h, data]);
}

test("asking each address directly finds iPhones and names Windows PCs", async () => {
  // An iPhone-like Bonjour responder and a Windows-like NetBIOS responder, on loopback.
  const iphone = dgram.createSocket("udp4");
  iphone.on("message", (_q, from) => {
    const txt = Buffer.concat(["rpMd=iPhone15,2", "rpVr=510.4"].map((s) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)])));
    const inst = "Sam's iPhone._companion-link._tcp.local";
    const header = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 3, 0, 0, 0, 0]);
    iphone.send(Buffer.concat([header, rr("_companion-link._tcp.local", 12, dnsName(inst)), rr(inst, 16, txt), rr("Sams-iPhone.local", 1, Buffer.from([127, 0, 0, 1]))]), from.port, from.address);
  });
  const pc = dgram.createSocket("udp4");
  pc.on("message", (_q, from) => pc.send(nbstatReply([["FAMILY-PC", 0, false]], [0x3c, 0x52, 0x82, 1, 2, 3]), from.port, from.address));
  await Promise.all([iphone, pc].map((s) => new Promise<void>((r) => s.bind(0, "127.0.0.1", () => r()))));
  try {
    const m = await mdnsUnicastSweep(["127.0.0.1"], { port: (iphone.address() as { port: number }).port, waitMs: 300, loopback: true });
    const d = m.get("127.0.0.1");
    assert.ok(d?.services.has("_companion-link._tcp"));
    assert.equal(d?.txt.get("rpmd"), "iPhone15,2");
    assert.ok(d?.hostnames.has("Sams-iPhone"));
    const n = await nbnsSweep(["127.0.0.1"], { port: (pc.address() as { port: number }).port, waitMs: 300, loopback: true });
    assert.equal(n.get("127.0.0.1")?.name, "FAMILY-PC");
    assert.equal((await nbnsSweep(["127.0.0.1"], { port: (pc.address() as { port: number }).port, waitMs: 100 })).size, 0, "loopback is skipped on real scans");
  } finally {
    iphone.close();
    pc.close();
  }
});

// ── naming them ──

test("makers from hardware addresses, and Apple model codes", () => {
  assert.deepEqual(vendorOf("04:83:08:12:34:56"), { vendor: "Espressif", kind: "Smart home device" });
  assert.deepEqual(vendorOf("00-09-BF-00-11-22"), { vendor: "Nintendo", kind: "Game console" });
  assert.deepEqual(vendorOf("00:03:93:aa:bb:cc"), { vendor: "Apple" });
  assert.equal(vendorOf("da:a1:19:00:11:22"), undefined, "private (made-up) addresses name nobody");
  assert.equal(vendorOf(undefined), undefined);

  assert.deepEqual(appleModel("MacBookPro18,3"), { name: "MacBook Pro", kind: "Computer" });
  assert.deepEqual(appleModel("iPhone15,2"), { name: "iPhone", kind: "Phone or tablet" });
  assert.deepEqual(appleModel("AudioAccessory5,1"), { name: "HomePod", kind: "Speaker" });
  assert.equal(appleModel("Chromecast"), undefined);
  assert.equal(macosFromDarwin(19), "10.15");
  assert.equal(macosFromDarwin(23), "14");
  assert.equal(macosFromDarwin(24), "15");
  assert.equal(macosFromDarwin(25), "26", "Tahoe jumped to year numbers");
});

const dev = (over: Partial<NetDevice> = {}): NetDevice => ({ ip: "192.168.1.50", hostnames: [], kind: "Device", isGateway: false, isSelf: false, services: [], mdnsServices: [], ...over });

test("what kind of device each one is", () => {
  const probe = (open: number[]) => ({ ip: "192.168.1.50", open, services: [], issues: [] });
  assert.equal(classify(dev(), probe([]), undefined, undefined, { vendor: { vendor: "Nintendo", kind: "Game console" } }), "Game console");
  assert.equal(classify(dev(), probe([80]), undefined, undefined, { vendor: { vendor: "Espressif", kind: "Smart home device" } }), "Smart home device");
  assert.equal(classify(dev(), probe([]), undefined, undefined, { apple: { kind: "Phone or tablet" } }), "Phone or tablet");
  assert.equal(classify(dev({ randomMac: true }), probe([]), undefined, undefined), "Phone or laptop");
  assert.equal(classify(dev(), probe([]), undefined, undefined, { netbios: { name: "FAMILY-PC" } }), "Computer");
  assert.equal(classify(dev(), probe([22]), undefined, undefined, { vendor: { vendor: "Raspberry Pi", kind: "Computer" } }), "Computer");
  assert.equal(classify(dev(), probe([9999]), undefined, undefined), "Smart home device", "Kasa's control port");
  for (const kind of ["Router", "Computer", "Phone or tablet", "Phone or laptop", "Camera", "Printer", "TV or streaming device", "Speaker", "Smart home device", "Game console", "NAS", "Device", "Mystery"]) {
    assert.ok(adviceFor({ kind, isSelf: false }).length > 0, kind);
  }
  assert.deepEqual(adviceFor({ kind: "This device", isSelf: true }), []);
});

// ── checks for common home gear ──

test("Windows versions from the SMB handshake, and which are out of support", () => {
  assert.equal(windowsFromNtlm({ major: 6, minor: 1, build: 0 }), null, "Samba reports a made-up 6.1 build 0");
  assert.equal(windowsFromNtlm({ major: 10, minor: 0, build: 0 }), null);
  const win10 = windowsFromNtlm({ major: 10, minor: 0, build: 19045 })!;
  assert.deepEqual(win10, { name: "Windows 10", eol: "2025-10-14", confidence: "likely" });
  const i = windowsIssue(win10, { major: 10, minor: 0, build: 19045, computer: "FAMILY-PC" })!;
  assert.equal(i.severity, "high");
  assert.equal(windowsFromNtlm({ major: 6, minor: 1, build: 7601 })?.name, "Windows 7");
  assert.equal(windowsFromNtlm({ major: 10, minor: 0, build: 19044 })?.confidence, "possible", "21H2 or LTSC 2021: can't tell");
  const server = windowsFromNtlm({ major: 10, minor: 0, build: 20348 })!;
  assert.equal(windowsIssue(server, { major: 10, minor: 0, build: 20348 }), null, "Server 2022 is supported");
  assert.equal(windowsFromNtlm({ major: 10, minor: 0, build: 26200 })?.name, "Windows 11 25H2");
  const win11 = windowsFromNtlm({ major: 10, minor: 0, build: 22631 })!;
  assert.equal(windowsIssue(win11, { major: 10, minor: 0, build: 22631 })?.severity, "medium", "an old Windows 11 version gets the next one through Windows Update");
});

test("smart plugs: Kasa's scrambled protocol and a Tasmota page with no password", () => {
  const msg = '{"system":{"get_sysinfo":{"alias":"Lämp"}}}';
  const enc = kasaEncode(msg);
  assert.equal(enc.readUInt32BE(0), Buffer.byteLength(msg));
  assert.equal(enc[4], "{".charCodeAt(0) ^ 171);
  assert.equal(kasaDecode(enc.subarray(4)), msg);

  const res = (status: number, body: string) => ({ status, statusText: "", headers: {}, body, raw: body });
  const open = tasmotaCheck(res(200, "<html><title>Kitchen</title><div>Tasmota 13.4.0 by Theo Arends</div></html>"), "192.168.1.60", 80);
  assert.equal(open?.version, "13.4.0");
  assert.equal(open?.issues[0].checkId, "tasmota.no-password");
  assert.equal(tasmotaCheck(res(401, "Tasmota"), "192.168.1.60", 80), null, "with a password the page asks for it");
  assert.equal(tasmotaCheck(res(200, "<title>Router</title>"), "192.168.1.1", 80), null);
});

// ── the inventory ──

function netScan(devices: NetDevice[]): Scan {
  return {
    id: "x",
    startedAt: new Date().toISOString(),
    finishedAt: "",
    tool: { name: "Bulwark", version: "test" },
    device: { hostname: "h", platform: "linux", os: "Linux", arch: "x64", isRoot: false, user: "u" },
    network: { targets: ["192.168.1.0/24"], confirmedOwnership: true, devices, findings: [], notes: [], durationMs: 1 },
    scores: { devices: {} },
  };
}

test("the first scan is the baseline; devices that join later are flagged until you say they're yours", () => {
  const router = () => dev({ ip: "192.168.1.1", mac: "3c:7c:3f:aa:bb:cc", isGateway: true, kind: "Router" });
  const tv = () => dev({ ip: "192.168.1.20", mac: "00:04:3c:11:22:33", name: "Living Room", kind: "Speaker", vendor: "Sonos" });
  const inv: Inventory = {};
  const first = netScan([router(), tv()]);
  applyInventory(first, inv, new Date("2026-11-01T10:00:00Z"));
  assert.equal(first.network!.findings.length, 0, "nothing is new on the first scan");
  const network = first.network!.networkId!;
  assert.equal(network, "router:3c:7c:3f:aa:bb:cc", "networks are told apart by their router");

  const stranger = () => dev({ ip: "192.168.1.77", mac: "da:a1:19:00:11:22", randomMac: true, kind: "Phone or laptop" });
  const second = netScan([router(), tv(), stranger()]);
  applyInventory(second, inv, new Date("2026-11-20T10:00:00Z"));
  const flagged = second.network!.findings.filter((f) => f.checkId === "inventory.new-device");
  assert.deepEqual(flagged.map((f) => f.target), ["192.168.1.77"]);
  assert.match(flagged[0].summary, /first showed up on November 20, 2026/);
  assert.equal(second.network!.devices[2].isNew, true);
  assert.ok(second.scores.devices["192.168.1.77"] < 100);
  assert.equal(second.network!.devices[1].firstSeen, "2026-11-01T10:00:00.000Z");

  // Still flagged on the next scan: being seen twice doesn't make it known.
  const third = netScan([router(), stranger()]);
  applyInventory(third, inv);
  assert.equal(third.network!.findings.length, 1);

  assert.ok(labelDevice(inv, third, network, deviceKey(stranger()), { label: "Guest's phone", mine: true }));
  assert.equal(third.network!.findings.length, 0, "saying it's yours clears the warning");
  assert.equal(third.network!.devices[1].label, "Guest's phone");
  assert.equal(third.scores.devices["192.168.1.77"], 100);
  const fourth = netScan([router(), stranger()]);
  applyInventory(fourth, inv);
  assert.equal(fourth.network!.findings.length, 0);
  assert.equal(fourth.network!.devices[1].label, "Guest's phone", "the name sticks");
  assert.equal(labelDevice(inv, null, network, "mac:00:00:00:00:00:01", { mine: true }), false);

  // Another network (another router) has its own baseline.
  const away = netScan([dev({ ip: "10.0.0.1", mac: "00:11:22:33:44:55", isGateway: true }), dev({ ip: "10.0.0.9", mac: "00:11:22:33:44:66" })]);
  applyInventory(away, inv);
  assert.equal(away.network!.findings.length, 0);
  assert.equal(deviceKey({ ip: "1.2.3.4", name: "Kitchen" }), "name:kitchen");
  assert.equal(deviceKey({ ip: "1.2.3.4" }), "ip:1.2.3.4");
});

// ── computers over SSH ──

let dir = "";
let local: Host;
let state: StateStore;
const testCheck: Check = {
  id: "test.world-writable",
  title: "A test file anyone can change",
  category: "Files",
  severity: "medium",
  platforms: ["linux", "darwin"],
  why: "Test only.",
  async run(host) {
    const p = path.join(dir, "remote", "app.conf");
    const st = await host.stat(p);
    if (!st) return [];
    return st.mode & 0o002 ? [fail(`${p} is writable by everyone (${st.mode.toString(8)}).`, { subject: "app.conf", auto: { fixId: "test.chmod", params: { path: p } } })] : [pass(`${p} is fine.`, { subject: "app.conf" })];
  },
};
const testFix: Fix = {
  id: "test.chmod",
  title: () => "Make the test file private",
  needsRoot: true,
  risk: "safe",
  reversible: true,
  async apply(tx, { params }) {
    await tx.chmod(String(params.path), 0o644);
  },
};

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bulwark-ssh-"));
  const shim = path.join(dir, "ssh");
  await fs.writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_SSH}" "$@"\n`, { mode: 0o755 });
  process.env.BULWARK_SSH = shim;
  process.env.FAKE_SSH_LOG = path.join(dir, "ssh.log");
  local = await createHost();
  state = new StateStore(path.join(dir, "state"));
  useStateDir(state.dir);
  CHECKS.push(testCheck);
  FIXES.set(testFix.id, testFix);
});

after(async () => {
  CHECKS.splice(CHECKS.indexOf(testCheck), 1);
  FIXES.delete(testFix.id);
  delete process.env.FAKE_SSH_PASSWORD;
  delete process.env.FAKE_SSH_UID;
  delete process.env.FAKE_SSH_SUDO;
  await fs.rm(dir, { recursive: true, force: true });
});

test("SSH targets: user, address and port, on this network only", async () => {
  assert.deepEqual(parseSshTarget("pi@192.168.1.40"), { user: "pi", host: "192.168.1.40", port: 22 });
  assert.deepEqual(parseSshTarget("ssh:root@nas.local:2222"), { user: "root", host: "nas.local", port: 2222 });
  assert.equal(parseSshTarget("192.168.1.40"), null, "the user name is required");
  assert.equal(parseSshTarget("pi@host;rm -rf /"), null);
  assert.equal(parseSshTarget("pi@-oProxyCommand=x"), null);
  assert.equal(targetId({ user: "pi", host: "192.168.1.40", port: 22 }), "ssh:pi@192.168.1.40");
  const s = await sessionFor(local, { user: "pi", host: "8.8.8.8", port: 22 });
  assert.match((await s.connect()).message, /own network/);
});

test("over SSH, files and commands on the other computer work like local ones", async () => {
  resetSessions();
  const t = { user: "tester", host: "127.0.0.1", port: 22 };
  const s = await sessionFor(local, t);
  assert.equal((await s.connect()).ok, true);
  const rh = await remoteHost(s);
  assert.equal(rh.platform, "linux");
  assert.equal(rh.remote.target, "ssh:tester@127.0.0.1");
  const p = path.join(dir, "files", "new dir", "it's here.txt");
  await rh.writeFile(p, "line one\nline 'two'\n$HOME stays literal\n", 0o600);
  assert.equal(await fs.readFile(p, "utf8"), "line one\nline 'two'\n$HOME stays literal\n");
  assert.equal((await fs.stat(p)).mode & 0o777, 0o600);
  assert.equal(await rh.readFile(p), "line one\nline 'two'\n$HOME stays literal\n");
  await fs.chmod(p, 0o640);
  await rh.writeFile(p, "rewritten\n");
  assert.equal((await fs.stat(p)).mode & 0o777, 0o640, "an existing file keeps its permissions");
  const st = await rh.stat(p);
  assert.equal(st?.mode, 0o640);
  assert.equal(st?.isFile, true);
  assert.equal(st?.size, 10);
  await fs.symlink(p, path.join(dir, "files", "link"));
  assert.equal((await rh.lstat(path.join(dir, "files", "link")))?.isSymlink, true);
  assert.equal(await rh.readlink(path.join(dir, "files", "link")), p);
  assert.deepEqual(await rh.readDir(path.join(dir, "files")), ["link", "new dir"]);
  await rh.chmod(p, 0o644);
  assert.equal((await fs.stat(p)).mode & 0o777, 0o644);
  const r = await rh.exec("sh", ["-c", 'printf "%s|%s|%s" "$GREETING" "$(pwd)" "$(cat)"'], { env: { GREETING: "hi there" }, cwd: dir, input: "from stdin" });
  assert.equal(r.stdout, `hi there|${dir}|from stdin`);
  assert.equal((await rh.exec("no-such-program-here", [])).code, 127);
  assert.equal(await rh.which("sh"), (await local.which("sh")) ?? "/bin/sh");
  assert.equal(await rh.which("no-such-program-here"), null);
  await rh.remove(p);
  assert.equal(await rh.readFile(p), null);
  await rh.mkdirp(path.join(dir, "a", "b"));
  assert.ok((await fs.stat(path.join(dir, "a", "b"))).isDirectory());
});

test("over SSH: admin rights through passwordless sudo, or none", async () => {
  resetSessions();
  process.env.FAKE_SSH_UID = "1000";
  try {
    const s = await sessionFor(local, { user: "pi", host: "127.0.0.1", port: 22 });
    await s.connect();
    assert.equal((await remoteHost(s)).isRoot, false, "no sudo: read-only");
    process.env.FAKE_SSH_SUDO = "1";
    const rh = await remoteHost(s);
    assert.equal(rh.isRoot, true);
    assert.equal(rh.remote.sudo, true);
    await rh.readFile("/etc/hostname");
    const log = (await fs.readFile(process.env.FAKE_SSH_LOG!, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    assert.match(log[log.length - 1].command, /^sudo -n sh -c /, "commands run through sudo");
    assert.equal(log[log.length - 1].opts.BatchMode, "yes", "commands never prompt");
    assert.match(log[log.length - 1].opts.ControlPath, /ssh/);
  } finally {
    delete process.env.FAKE_SSH_UID;
    delete process.env.FAKE_SSH_SUDO;
  }
});

test("over SSH: a password opens the connection once, through ssh's askpass, and isn't kept", async () => {
  resetSessions();
  process.env.FAKE_SSH_PASSWORD = "correct horse";
  try {
    const t = { user: "mum", host: "127.0.0.1", port: 2222 };
    const s = await sessionFor(local, t);
    await s.close();
    const r = await scanRemote(local, t, { checks: [testCheck] });
    assert.match(r.error ?? "", /asked for a password or key/);
    assert.match((await s.connect({ password: "wrong" })).message, /refused that password/);
    assert.equal((await s.connect({ password: "correct horse" })).ok, true);
    assert.equal((await scanRemote(local, t, { checks: [testCheck] })).error, undefined, "later commands reuse the open connection");
    const askpass = await fs.readFile(path.join(state.dir, "ssh", "askpass.sh"), "utf8");
    assert.ok(!askpass.includes("correct horse"), "the password is never written down");
    await s.close();
  } finally {
    delete process.env.FAKE_SSH_PASSWORD;
  }
});

test("over SSH: scan, fix, check and undo on the other computer", async () => {
  resetSessions();
  const file = path.join(dir, "remote", "app.conf");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, "secret=1\n");
  await fs.chmod(file, 0o666);
  const t = { user: "admin", host: "127.0.0.1", port: 22 };
  const r = await scanRemote(local, t, { checks: [testCheck] });
  assert.equal(r.error, undefined);
  assert.equal(r.device?.platform, "linux");
  const [f] = r.findings.filter((x) => x.status === "fail");
  assert.equal(f.id, "test.world-writable@ssh:admin@127.0.0.1#app.conf");
  assert.equal(f.target, "ssh:admin@127.0.0.1");

  const scan = await runScan(local, { local: false });
  mergeRemote(scan, r);
  assert.ok(allFindings(scan).includes(f));
  assert.ok(scan.scores.devices["ssh:admin@127.0.0.1"] < 100);
  await state.saveScan(scan);

  const fresh = await refreshFindings(local, [f]);
  assert.equal(fresh.length, 1);
  const plan = await planFix(local, fresh);
  assert.ok(plan.canApply, plan.blockedReason);
  const change = await applyFix(local, state, fresh);
  assert.equal(change.status, "applied", change.error);
  assert.equal(change.target, "ssh:admin@127.0.0.1");
  assert.equal(change.verification?.status, "pass", change.verification?.summary);
  assert.match(change.verification?.summary ?? "", /admin@127\.0\.0\.1/);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o644);
  assert.equal((await refreshFindings(local, [f])).length, 0, "already fixed");
  await rollbackChange(local, state, change.id);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o666, "undo puts the old permissions back, over SSH");
  assert.match(markdownReport(scan), /Computers checked over SSH/);
});

test("the dashboard checks a computer over SSH and adds it to the last scan, with the same results as here", async () => {
  resetSessions();
  // A handful of real, read-only Linux checks (all of them take minutes through the stand-in ssh).
  const ids = ["linux.files.sensitive", "linux.kernel.sysctl", "linux.accounts.uid0", "linux.reboot-required", "ssh.root-login"];
  const saved = CHECKS.splice(0, CHECKS.length);
  CHECKS.push(...saved.filter((c) => ids.includes(c.id)));
  const token = "e".repeat(48);
  let handler: ReturnType<typeof createApp> = async () => {};
  const server = http.createServer((q, s) => void handler(q, s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  handler = createApp({ host: local, state, port, bind: "127.0.0.1", token });
  const call = (p: string, body?: unknown) =>
    new Promise<{ status: number; json: Record<string, unknown> }>((resolve, reject) => {
      const headers: Record<string, string> = { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${token}` };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const req = http.request({ host: "127.0.0.1", port, path: p, method: body === undefined ? "GET" : "POST", headers }, (res) => {
        let text = "";
        res.on("data", (d) => (text += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(text) }));
      });
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  try {
    assert.equal((await call("/api/state")).json.ssh && ((await call("/api/state")).json.ssh as { available: boolean }).available, true);
    assert.equal((await call("/api/ssh/check", { target: "no-user-here" })).status, 400);
    const { json } = await call("/api/ssh/check", { target: "root@127.0.0.1" });
    let job: Record<string, unknown> = {};
    for (let i = 0; i < 300; i++) {
      job = (await call(`/api/jobs/${json.jobId}`)).json;
      if (job.status !== "running") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(job.status, "done", String(job.error));
    const latest = await state.latestScan();
    const entry = latest?.remote?.find((r) => r.target === "ssh:root@127.0.0.1");
    assert.ok(entry && !entry.error, entry?.error);
    assert.ok(latest?.remote?.some((r) => r.target === "ssh:admin@127.0.0.1"), "earlier results stay");
    // "The other computer" is this one, so the results must match a local run of the same checks.
    const here = (await auditLocal(local, undefined, ids)).map((f) => `${f.checkId} ${f.status} ${f.summary}`).sort();
    const there = entry.findings.map((f) => `${f.checkId} ${f.status} ${f.summary}`).sort();
    assert.ok(here.length >= ids.length);
    assert.deepEqual(there, here);
  } finally {
    CHECKS.splice(0, CHECKS.length, ...saved);
    server.close();
  }
});
