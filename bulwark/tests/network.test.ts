import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { applyFix, rollbackChange } from "../src/core/fixer.ts";
import { createHost } from "../src/core/host.ts";
import { StateStore } from "../src/core/state.ts";
import type { Host, NetworkScan } from "../src/core/types.ts";
import { matchSoftware, parseServerHeader, parseSshBanner } from "../src/net/fingerprints.ts";
import { isRandomMac, parseArp, parseProcRoute } from "../src/net/local.ts";
import { absorb, buildQuery, parseResponse, type MdnsDevice } from "../src/net/mdns.ts";
import { expandTarget, isPrivate, resolveTargets } from "../src/net/scope.ts";
import { parseRdpNegotiation, smb1Accepted, smb1Negotiate } from "../src/net/services/binary.ts";
import { parseKexInit, terrapinVulnerable } from "../src/net/services/ssh.ts";
import { stripTelnet } from "../src/net/services/text.ts";
import { scanNetwork } from "../src/net/scan.ts";
import { parseDescription, parseSsdp } from "../src/net/ssdp.ts";
import { createApp } from "../src/server.ts";
import { startFakeLan, type FakeLan } from "./helpers/fake-lan.ts";

// ── scope ──

test("only private networks are scanned without explicit permission", async () => {
  assert.ok(isPrivate("192.168.1.10") && isPrivate("10.1.2.3") && isPrivate("172.20.0.1") && isPrivate("127.0.0.5"));
  assert.ok(!isPrivate("100.64.0.1"), "carrier-grade NAT belongs to the ISP's other customers");
  assert.ok(!isPrivate("8.8.8.8") && !isPrivate("172.32.0.1"));
  assert.equal(expandTarget("192.168.1.0/24").length, 254);
  assert.deepEqual(expandTarget("192.168.1.10-12"), ["192.168.1.10", "192.168.1.11", "192.168.1.12"]);
  assert.throws(() => expandTarget("10.0.0.0/8"), /too big/);
  assert.throws(() => expandTarget("hello there"), /isn't an IPv4/);

  const pub = await resolveTargets(["192.168.1.1", "203.0.113.5"], { authorized: false });
  assert.deepEqual(pub.addresses, ["192.168.1.1"]);
  assert.match(pub.errors.join(), /public internet/);
  const ok = await resolveTargets(["203.0.113.5"], { authorized: true });
  assert.deepEqual(ok.addresses, ["203.0.113.5"]);
  const big = await resolveTargets(["198.51.100.0/23"], { authorized: true });
  assert.equal(big.addresses.length, 0, "at most 256 public addresses");
  const multicast = await resolveTargets(["224.0.0.251"], { authorized: true });
  assert.equal(multicast.addresses.length, 0);
});

// ── parsers ──

test("ARP tables and the default route on each platform", () => {
  assert.deepEqual([...parseArp("linux", "IP address HW type Flags HW address Mask Device\n192.168.1.1 0x1 0x2 aa:bb:cc:00:11:22 * wlan0\n192.168.1.9 0x1 0x0 00:00:00:00:00:00 * wlan0\n")], [["192.168.1.1", "aa:bb:cc:00:11:22"]]);
  assert.deepEqual([...parseArp("darwin", "? (192.168.1.1) at 0:1b:2c:3:4:5 on en0 ifscope [ethernet]\n")], [["192.168.1.1", "00:1b:2c:03:04:05"]]);
  assert.deepEqual([...parseArp("win32", "  192.168.1.1          aa-bb-cc-dd-ee-ff     dynamic\n  192.168.1.255        ff-ff-ff-ff-ff-ff     static\n")], [["192.168.1.1", "aa:bb:cc:dd:ee:ff"]]);
  assert.equal(parseProcRoute("Iface\tDestination\tGateway \nwlan0\t00000000\t0101A8C0\t0003\n"), "192.168.1.1");
  assert.ok(isRandomMac("da:a1:19:00:00:01"));
  assert.ok(!isRandomMac("b8:27:eb:00:00:01"));
});

function dnsName(name: string): Buffer {
  return Buffer.concat([...name.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
}
function rr(name: string, type: number, data: Buffer): Buffer {
  const h = Buffer.alloc(10);
  h.writeUInt16BE(type, 0);
  h.writeUInt16BE(0x8001, 2);
  h.writeUInt32BE(120, 4);
  h.writeUInt16BE(data.length, 8);
  return Buffer.concat([dnsName(name), h, data]);
}

test("mDNS answers become device names and services", () => {
  const q = buildQuery(["_googlecast._tcp.local"]);
  assert.equal(q.readUInt16BE(4), 1);
  const inst = "Living Room TV._googlecast._tcp.local";
  const txt = Buffer.concat(["md=Chromecast", "fn=Living Room TV"].map((s) => Buffer.concat([Buffer.from([s.length]), Buffer.from(s)])));
  const srv = Buffer.concat([Buffer.from([0, 0, 0, 0, 0x1f, 0x49]), dnsName("chromecast-1234.local")]);
  const header = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 4, 0, 0, 0, 0]);
  const pkt = Buffer.concat([header, rr("_googlecast._tcp.local", 12, dnsName(inst)), rr(inst, 16, txt), rr(inst, 33, srv), rr("chromecast-1234.local", 1, Buffer.from([192, 168, 1, 50]))]);
  const records = parseResponse(pkt);
  assert.equal(records.length, 4);
  const map = new Map<string, MdnsDevice>();
  absorb(map, "192.168.1.50", records);
  const d = map.get("192.168.1.50")!;
  assert.ok(d.services.has("_googlecast._tcp"));
  assert.ok(d.instances.has("Living Room TV"));
  assert.equal(d.txt.get("fn"), "Living Room TV");
  assert.ok(d.hostnames.has("chromecast-1234"));
});

test("SSDP replies and device descriptions", () => {
  const r = parseSsdp("HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.1:5000/rootDesc.xml\r\nSERVER: Linux/3.4 UPnP/1.0 MiniUPnPd/1.8\r\nST: upnp:rootdevice\r\n\r\n", "192.168.1.1");
  assert.equal(r?.location, "http://192.168.1.1:5000/rootDesc.xml");
  const d = parseDescription(
    `<root><URLBase>http://192.168.1.1:5000</URLBase><device><friendlyName>Router</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ctl/IPConn</controlURL></service></serviceList></device></root>`,
    "http://192.168.1.1:5000/rootDesc.xml",
  );
  assert.equal(d.friendlyName, "Router");
  assert.equal(d.services[0].controlURL, "http://192.168.1.1:5000/ctl/IPConn");
});

function kexPacket(kex: string[], ciphers: string[], macs: string[]): Buffer {
  const list = (l: string[]) => {
    const b = Buffer.from(l.join(","));
    const n = Buffer.alloc(4);
    n.writeUInt32BE(b.length);
    return Buffer.concat([n, b]);
  };
  const payload = Buffer.concat([Buffer.from([20]), Buffer.alloc(16), list(kex), list(["ssh-ed25519"]), list(ciphers), list(ciphers), list(macs), list(macs), list(["none"]), list(["none"]), list([]), list([]), Buffer.from([0, 0, 0, 0, 0])]);
  const pad = 8 - ((payload.length + 5) % 8) + 4;
  const len = Buffer.alloc(5);
  len.writeUInt32BE(payload.length + pad + 1);
  len[4] = pad;
  return Buffer.concat([len, payload, Buffer.alloc(pad)]);
}

test("SSH: KEXINIT parsing and the Terrapin check", () => {
  const vulnerable = parseKexInit(kexPacket(["curve25519-sha256"], ["chacha20-poly1305@openssh.com", "aes128-ctr"], ["hmac-sha2-256"]))!;
  assert.deepEqual(vulnerable.kex, ["curve25519-sha256"]);
  assert.ok(terrapinVulnerable(vulnerable));
  const fixed = parseKexInit(kexPacket(["curve25519-sha256", "kex-strict-s-v00@openssh.com"], ["chacha20-poly1305@openssh.com"], ["hmac-sha2-256"]))!;
  assert.ok(!terrapinVulnerable(fixed));
  const cbcEtm = parseKexInit(kexPacket(["curve25519-sha256"], ["aes128-cbc"], ["hmac-sha2-256-etm@openssh.com"]))!;
  assert.ok(terrapinVulnerable(cbcEtm));
});

test("known-vulnerable versions, with distribution patches respected", () => {
  const ssh = (banner: string) => matchSoftware(parseSshBanner(banner)).map((m) => m.title);
  assert.match(ssh("SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13")[0], /regreSSHion/, "Ubuntu build before the fix");
  assert.deepEqual(ssh("SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5"), [], "Ubuntu build with the fix");
  assert.deepEqual(ssh("SSH-2.0-OpenSSH_9.2p1 Debian-2+deb12u3"), []);
  assert.match(ssh("SSH-2.0-OpenSSH_9.3p1")[0], /regreSSHion/, "upstream build");
  assert.deepEqual(ssh("SSH-2.0-OpenSSH_9.6"), [], "OpenBSD/macOS builds aren't affected");
  assert.match(ssh("SSH-2.0-OpenSSH_8.4p1 Debian-5+deb11u3").join(), /Debian 11, which no longer gets security updates/);
  assert.match(ssh("SSH-2.0-OpenSSH_7.9p1 Raspbian-10+deb10u2+rpt1").join(), /Debian 10/);
  const drop = matchSoftware(parseSshBanner("SSH-2.0-dropbear_2014.63"));
  assert.equal(drop.length, 1, "several rules for one product become one finding");
  assert.equal(drop[0].severity, "critical");
  assert.ok(drop[0].cves.includes("CVE-2016-7406") && drop[0].cves.includes("CVE-2020-36254"));
  assert.equal(matchSoftware({ product: "Redis", version: "7.2.10" }).length, 1);
  assert.equal(matchSoftware({ product: "Redis", version: "7.2.11" }).length, 0);
  assert.equal(matchSoftware({ product: "Redis", version: "7.0.15" }).length, 1, "a branch with no fix is vulnerable");
  assert.equal(matchSoftware({ product: "Redis", version: "8.4.0" }).length, 0);
  const apache = parseServerHeader("Apache/2.4.49 (Unix) OpenSSL/1.0.1e PHP/7.4.3");
  assert.deepEqual(apache.map((s) => s.product), ["Apache", "OpenSSL", "PHP"]);
  assert.ok(apache.flatMap((s) => matchSoftware(s)).some((m) => m.cves.includes("CVE-2021-41773")));
  assert.equal(parseServerHeader("nginx/1.18.0 (Ubuntu)").flatMap((s) => matchSoftware(s)).length, 0);
});

test("SMBv1, RDP and Telnet wire formats", () => {
  const neg = smb1Negotiate();
  assert.equal(neg.readUInt32BE(0), neg.length - 4);
  assert.equal(neg.toString("latin1", 4, 8), "\xffSMB");
  const ok = Buffer.alloc(4 + 32 + 3);
  ok.writeUInt32BE(35, 0);
  ok.writeUInt32BE(0xff534d42, 4);
  ok[8] = 0x72;
  ok[36] = 17;
  assert.ok(smb1Accepted(ok));
  ok.writeUInt16LE(0xffff, 37);
  assert.ok(!smb1Accepted(ok), "dialect 0xFFFF means no SMB1");
  assert.ok(!smb1Accepted(null));
  const rsp = (type: number, value: number) => {
    const b = Buffer.from([0x03, 0, 0, 0x13, 0x0e, 0xd0, 0, 0, 0, 0, 0, type, 0, 8, 0, 0, 0, 0, 0]);
    b.writeUInt32LE(value, 15);
    return b;
  };
  assert.equal(parseRdpNegotiation(rsp(0x02, 0)), "standard-rdp");
  assert.equal(parseRdpNegotiation(rsp(0x03, 5)), "nla-required");
  assert.equal(parseRdpNegotiation(rsp(0x02, 2)), "tls-or-nla");
  const t = stripTelnet(Buffer.concat([Buffer.from([0xff, 0xfd, 0x18, 0xff, 0xfb, 0x01]), Buffer.from("login: ")]));
  assert.equal(t.text, "login: ");
  assert.deepEqual([...t.reply], [0xff, 0xfc, 0x18, 0xff, 0xfe, 0x01]);
});

// ── the pretend network, end to end ──

let lan: FakeLan;
let host: Host;
let result: NetworkScan;

before(async () => {
  lan = await startFakeLan();
  host = await createHost();
  result = await scanNetwork(host, {
    targets: [...Object.values(lan.ips), "127.0.0.19"],
    authorized: false,
    confirmedOwnership: true,
    noMulticast: true,
    extraSsdp: [{ ip: lan.ips.router, location: lan.upnpLocation, server: "Linux/3.4 UPnP/1.0 MiniUPnPd/1.8" }],
  });
});

after(async () => {
  await lan.stop();
});

const ids = (ip: string) => result.findings.filter((f) => f.target === ip).map((f) => f.checkId);

test("every pretend device is found and recognised", () => {
  const kinds = Object.fromEntries(result.devices.map((d) => [d.ip, d.kind]));
  assert.equal(kinds[lan.ips.router], "Router");
  assert.equal(kinds[lan.ips.camera], "Camera");
  assert.equal(kinds[lan.ips.nas], "NAS");
  assert.equal(kinds[lan.ips.printer], "Printer");
  assert.equal(kinds[lan.ips.tvbox], "Android device");
  assert.equal(kinds[lan.ips.hub], "Smart home device");
  // On loopback every address answers with a reset, so 127.0.0.19 shows up; it just has nothing to report.
  assert.deepEqual(ids("127.0.0.19"), []);
  assert.equal(result.devices.find((d) => d.ip === lan.ips.router)?.name, "HomeHub 3000");
});

test("each device's holes are found", () => {
  assert.deepEqual(ids(lan.ips.camera).sort(), ["http.plaintext-login", "http.version", "rtsp.open-stream", "ssh.version", "telnet.no-login"]);
  assert.ok(ids(lan.ips.nas).includes("smb.v1"));
  assert.ok(ids(lan.ips.nas).includes("redis.no-auth") && ids(lan.ips.nas).includes("redis.version"));
  assert.ok(ids(lan.ips.nas).includes("mysql.exposed") && ids(lan.ips.nas).includes("mysql.version"));
  assert.deepEqual(ids(lan.ips.pc), ["rdp.no-nla"], "SMB without v1 is fine");
  assert.ok(ids(lan.ips.tvbox).includes("adb.open"));
  assert.ok(ids(lan.ips.hub).includes("mqtt.anonymous") && ids(lan.ips.hub).includes("vnc.no-auth"));
  assert.ok(ids(lan.ips.printer).includes("jetdirect.exposed"));
  assert.ok(ids(lan.ips.docker).includes("docker.no-auth") && ids(lan.ips.docker).includes("elasticsearch.no-auth") && ids(lan.ips.docker).includes("memcached.no-auth"));
  assert.ok(!ids(lan.ips.docker).includes("ssh.version"), "a patched Ubuntu OpenSSH isn't flagged");
  const router = ids(lan.ips.router);
  assert.ok(router.includes("upnp.enabled") && router.includes("upnp.version") && router.includes("http.plaintext-login"));
  assert.equal(router.filter((c) => c === "upnp.forward").length, 2);
  const rdpForward = result.findings.find((f) => f.id === `upnp.forward@${lan.ips.router}#TCP-3389`)!;
  assert.equal(rdpForward.severity, "high", "forwarding Remote Desktop to the internet is serious");
});

test("removing a router port forward works, is checked, and can be undone", async () => {
  const state = new StateStore(await fs.mkdtemp(path.join(os.tmpdir(), "bulwark-test-")));
  const f = result.findings.find((x) => x.id === `upnp.forward@${lan.ips.router}#TCP-3389`)!;
  const change = await applyFix(host, state, [f]);
  assert.equal(change.status, "applied", change.error);
  assert.equal(change.verification?.status, "pass");
  assert.deepEqual(lan.mappings.map((m) => m.externalPort), [32400]);
  await rollbackChange(host, state, change.id);
  assert.deepEqual(lan.mappings.map((m) => m.externalPort).sort((a, b) => a - b), [3389, 32400]);
});

// ── the dashboard's guards ──

test("dashboard refuses wrong hosts, missing keys and non-JSON requests", async () => {
  const state = new StateStore(await fs.mkdtemp(path.join(os.tmpdir(), "bulwark-test-")));
  const token = await state.token();
  let handler: ReturnType<typeof createApp> = async () => {};
  const server = http.createServer((q, s) => void handler(q, s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  handler = createApp({ host, state, port, bind: "127.0.0.1", token, demo: { targets: [lan.ips.camera], extraSsdp: [] } });
  const call = (p: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: p, method: init.method ?? "GET", headers: { Host: `127.0.0.1:${port}`, ...init.headers } }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.end(init.body);
    });
  try {
    const page = await call("/");
    assert.equal(page.status, 200);
    assert.match(String(page.headers["content-security-policy"]), /script-src 'self'/);
    assert.equal(page.headers["x-frame-options"], "DENY");
    assert.equal((await call("/", { headers: { Host: "evil.example:80" } })).status, 421, "DNS rebinding is refused");
    assert.equal((await call("/api/state")).status, 401);
    assert.equal((await call("/api/state", { headers: { Authorization: "Bearer " + "0".repeat(48) } })).status, 401);
    const auth = { Authorization: `Bearer ${token}` };
    assert.equal((await call("/api/state", { headers: auth })).status, 200);
    assert.equal((await call("/api/scan", { method: "POST", headers: { ...auth, "Content-Type": "text/plain" }, body: "{}" })).status, 415);
    assert.equal((await call("/../../etc/passwd", { headers: auth })).status, 404);
    // A scan in demo mode only ever covers the pretend network.
    const started = await call("/api/scan", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ network: true, targets: ["8.8.8.8"], confirmOwnership: true }) });
    assert.equal(started.status, 200);
    const { jobId } = JSON.parse(started.body);
    let job: { status: string; result?: { scanId: string } };
    do {
      await new Promise((r) => setTimeout(r, 200));
      job = JSON.parse((await call(`/api/jobs/${jobId}`, { headers: auth })).body);
    } while (job.status === "running");
    assert.equal(job.status, "done");
    const scan = JSON.parse((await call(`/api/scans/${job.result!.scanId}`, { headers: auth })).body);
    assert.deepEqual(scan.network.targets, [lan.ips.camera]);
    // Fixes are chosen by finding id; parameters in the request are ignored.
    const bogus = await call("/api/fix", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ findingIds: ["not-a-finding"], params: { cmd: "rm" } }) });
    assert.equal(bogus.status, 404);
  } finally {
    server.close();
  }
});
