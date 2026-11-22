// Android phones and TVs: the checks (fed canned device answers), the whole scan → fix → verify →
// undo cycle against a stand-in adb, TV recognition on the network, and the TV sign-in code.

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { adbConnect, adbPair, checkDeviceAddress, findAdb, parseAdbDevices, parseGetprop, type AndroidShell } from "../src/android/adb.ts";
import { ANDROID_SUPPORT, auditAndroid, localAndroidChecks, parseInstallers, termuxPackages } from "../src/android/checks.ts";
import { isSelfSerial } from "../src/android/scan.ts";
import { applyFix, planFix, refreshFindings, rollbackChange, safeBatches } from "../src/core/fixer.ts";
import { createHost } from "../src/core/host.ts";
import { markdownReport } from "../src/core/report.ts";
import { allFindings, runScan } from "../src/core/scan.ts";
import { StateStore } from "../src/core/state.ts";
import type { ExecResult, Finding, Host } from "../src/core/types.ts";
import { localNetworks, parseIpRoute } from "../src/net/local.ts";
import { probeRoku, probeSamsungTv } from "../src/net/services/tv.ts";
import { createApp, LoginCode } from "../src/server.ts";
import { FakeHost } from "./helpers/fake-host.ts";

const FAKE_ADB = fileURLToPath(new URL("./helpers/fake-adb.mjs", import.meta.url));
const SERIAL = "192.168.1.60:5555";
const DAY = 86_400_000;
const isoDay = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 10);
const NEWEST_SDK = Math.max(...Object.keys(ANDROID_SUPPORT).map(Number));

/** A device that answers from a table: `getprop` from `props`, everything else from `answers`. */
function deviceShell(props: Record<string, string>, answers: Record<string, string | ExecResult> = {}, privileged = true): AndroidShell & { calls: string[] } {
  const calls: string[] = [];
  const getprop = Object.entries(props).map(([k, v]) => `[${k}]: [${v}]`).join("\n");
  return {
    kind: privileged ? "adb" : "local",
    serial: privileged ? SERIAL : undefined,
    privileged,
    calls,
    spec: (cmd, args) => ({ cmd, args }),
    async run(cmd, args = []) {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      if (line === "getprop") return { code: 0, stdout: getprop, stderr: "" };
      const a = answers[cmd === "sh" ? "sh" : line];
      if (a === undefined) return cmd === "sh" ? { code: 0, stdout: "", stderr: "" } : { code: 1, stdout: "", stderr: "unknown command" };
      return typeof a === "string" ? { code: 0, stdout: a, stderr: "" } : a;
    },
  };
}

const byCheck = (fs: Finding[], id: string) => fs.filter((f) => f.checkId === id);

// ── parsing ──

test("getprop, adb devices, installers and ip route are read correctly", () => {
  const props = parseGetprop("[ro.build.version.sdk]: [34]\n[ro.product.model]: [Pixel 8]\n[persist.empty]: []\n");
  assert.equal(props.get("ro.build.version.sdk"), "34");
  assert.equal(props.get("ro.product.model"), "Pixel 8");
  assert.equal(props.get("persist.empty"), "");

  const devices = parseAdbDevices(
    "List of devices attached\n192.168.1.60:5555\tdevice product:sabrina model:Chromecast_HD device:sabrina transport_id:1\nR58M123ABC   unauthorized usb:1-1 transport_id:2\n127.0.0.1:41234\toffline\n\n",
  );
  assert.deepEqual(
    devices.map((d) => [d.serial, d.state, d.model]),
    [
      ["192.168.1.60:5555", "device", "Chromecast HD"],
      ["R58M123ABC", "unauthorized", undefined],
      ["127.0.0.1:41234", "offline", undefined],
    ],
  );
  assert.ok(isSelfSerial("127.0.0.1:41234") && isSelfSerial("localhost:5555"));
  assert.ok(!isSelfSerial("192.168.1.60:5555") && !isSelfSerial("R58M123ABC"));

  assert.deepEqual(parseInstallers("package:com.netflix.ninja  installer=com.android.vending\npackage:com.example.iptv  installer=null\njunk\n"), [
    { pkg: "com.netflix.ninja", installer: "com.android.vending" },
    { pkg: "com.example.iptv", installer: null },
  ]);

  assert.equal(parseIpRoute("default via 192.168.1.1 dev wlan0 proto dhcp src 192.168.1.23 metric 600\n"), "192.168.1.1");
  assert.equal(parseIpRoute("8.8.8.8 via 10.0.0.1 dev wlan0 table 1021 src 10.0.0.5 uid 10234\n    cache\n"), "10.0.0.1");
  assert.equal(parseIpRoute(""), null);
});

test("a phone's mobile data connection is never treated as the home network", () => {
  const v4 = (address: string, netmask = "255.255.255.0") => [{ address, netmask, family: "IPv4" as const, mac: "02:00:00:00:00:00", internal: false, cidr: `${address}/24` }];
  const nets = localNetworks({
    wlan0: v4("192.168.1.23"),
    rmnet_data0: v4("10.143.2.7", "255.255.255.252"),
    ccmni1: v4("10.22.3.4"),
    "v4-rmnet_data0": v4("192.0.0.4", "255.255.255.248"),
    r_rmnet_data1: v4("10.9.9.9"),
    lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4" as const, mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }],
  });
  assert.deepEqual(nets.map((n) => n.iface), ["wlan0"]);
  assert.equal(nets[0].scanCidr, "192.168.1.0/24");
});

// ── checks ──

const TV_PROPS = {
  "ro.product.model": "Chromecast HD",
  "ro.product.manufacturer": "Google",
  "ro.build.characteristics": "tv,nosdcard",
  "ro.build.version.release": "12",
  "ro.build.version.sdk": "31",
  "ro.build.version.security_patch": "2024-08-01",
  "ro.boot.verifiedbootstate": "green",
  "ro.boot.flash.locked": "1",
  "ro.crypto.state": "encrypted",
  "ro.crypto.type": "file",
  "init.svc.adbd": "running",
  "service.adb.tcp.port": "5555",
};

test("an Android TV over adb: open network debugging, old patches, Play Protect off, risky installers", async () => {
  const sh = deviceShell(TV_PROPS, {
    "settings get global device_name": "Living Room TV",
    "settings get global adb_enabled": "1",
    "settings get global adb_wifi_enabled": "null",
    getenforce: "Enforcing",
    "pm path com.android.vending": "package:/product/app/Phonesky/Phonesky.apk",
    "settings get global package_verifier_enable": "0",
    "settings get global verifier_verify_adb_installs": "null",
    "cmd appops query-op REQUEST_INSTALL_PACKAGES allow": "com.android.vending\ncom.example.browser\n",
    "pm list packages -3 -i": "package:com.netflix.ninja  installer=com.android.vending\npackage:com.example.iptv  installer=null\n",
    "dumpsys package com.google.android.webview": `    versionName=120.0.6099.230\n    lastUpdateTime=${isoDay(400 * DAY)} 08:00:00\n`,
  });
  const res = await auditAndroid(sh, `adb:${SERIAL}`);
  assert.ok(res);
  assert.equal(res.info.kind, "tv");
  assert.equal(res.info.name, "Living Room TV");
  const fails = res.findings.filter((f) => f.status === "fail");

  const [dbg] = byCheck(fails, "android.debugging");
  assert.equal(dbg.severity, "critical", "network debugging on a TV is the worst case");
  assert.equal(dbg.id, `android.debugging@adb:${SERIAL}`);
  assert.equal(dbg.remedy?.auto?.fixId, "android.debugging-off");

  assert.equal(byCheck(fails, "android.patch-level")[0].severity, "high");
  assert.match(byCheck(fails, "android.patch-level")[0].summary, /this TV/);
  assert.equal(byCheck(fails, "android.version").length, 1, "Android 12 no longer gets fixes");

  const [pp] = byCheck(fails, "android.play-protect");
  assert.equal(pp.id, `android.play-protect@adb:${SERIAL}#scanning`);
  assert.deepEqual(pp.remedy?.auto, { fixId: "android.setting", params: { serial: SERIAL, items: [{ namespace: "global", key: "package_verifier_enable", value: "1", prev: "0", label: "Turn on Play Protect app scanning" }] } });

  const [inst] = byCheck(fails, "android.install-sources");
  assert.deepEqual(inst.evidence, ["com.example.browser"], "app stores are allowed to install apps");
  assert.equal(inst.remedy?.auto?.fixId, "android.appops");

  const [side] = byCheck(fails, "android.sideloaded");
  assert.match(side.summary, /com\.example\.iptv/);
  assert.doesNotMatch(side.summary, /netflix/);
  assert.equal(byCheck(fails, "android.webview").length, 1);

  assert.equal(byCheck(res.findings, "android.screen-lock")[0].status, "skipped", "TVs have no screen lock");
  for (const id of ["android.bootloader", "android.selinux", "android.encryption", "android.root"]) assert.equal(byCheck(res.findings, id)[0].status, "pass", id);
  assert.ok(!sh.calls.some((c) => c.startsWith("settings put")), "checking never changes anything");
});

test("a phone with no screen lock, an unlocked bootloader, SELinux off and root", async () => {
  const sh = deviceShell(
    {
      "ro.product.model": "Pixel 9",
      "ro.product.manufacturer": "Google",
      "ro.build.characteristics": "nosdcard",
      "ro.build.version.release": "16",
      "ro.build.version.sdk": String(NEWEST_SDK),
      "ro.build.version.security_patch": isoDay(20 * DAY),
      "ro.boot.verifiedbootstate": "orange",
      "ro.boot.flash.locked": "0",
      "ro.crypto.state": "unencrypted",
    },
    {
      getenforce: "Permissive",
      sh: "/system/bin/su\n",
      "cmd lock_settings get-disabled": "false",
      "dumpsys lock_settings": "  CredentialType: NONE\n",
      "settings get global adb_enabled": "0",
      "settings get global adb_wifi_enabled": "0",
      "pm path com.android.vending": "",
      "cmd appops query-op REQUEST_INSTALL_PACKAGES allow": "",
      "pm list packages -3 -i": "",
    },
  );
  const res = await auditAndroid(sh, `adb:${SERIAL}`);
  assert.ok(res);
  assert.equal(res.info.kind, "phone");
  const status = (id: string) => byCheck(res.findings, id)[0];
  assert.equal(status("android.screen-lock").status, "fail");
  assert.equal(status("android.bootloader").status, "fail");
  assert.equal(status("android.selinux").severity, "critical");
  assert.equal(status("android.root").status, "fail");
  assert.equal(status("android.encryption").severity, "high");
  assert.equal(status("android.patch-level").status, "pass");
  assert.equal(status("android.version").status, "pass");
  assert.equal(status("android.debugging").status, "pass");
  assert.equal(status("android.play-protect").status, "skipped", "no Google Play");
  assert.equal(status("android.install-sources").status, "pass");
  assert.equal(status("android.sideloaded").status, "pass");
});

test("in Termux, Bulwark checks what an app can see, says what needs adb, and checks Termux's packages", async () => {
  const props = Object.entries({ ...TV_PROPS, "ro.build.characteristics": "nosdcard", "service.adb.tcp.port": "" })
    .map(([k, v]) => `[${k}]: [${v}]`)
    .join("\n");
  const host = new FakeHost({ platform: "android", isRoot: false })
    .command("getprop", { stdout: props })
    .command("apt", (args) => (args[0] === "list" ? { stdout: "Listing...\nopenssl/stable 3.3.2 aarch64 [upgradable from: 3.3.1]\nnodejs-lts/stable 22.11.0 aarch64 [upgradable from: 22.10.0]\n" } : undefined));
  host.env.TERMUX_VERSION = "0.118.1";
  const results = new Map<string, string>();
  for (const c of localAndroidChecks) results.set(c.id, (await c.run(host))[0].status);
  assert.equal(results.get("android.patch-level"), "fail");
  assert.equal(results.get("android.bootloader"), "pass");
  for (const id of ["android.screen-lock", "android.play-protect", "android.install-sources", "android.sideloaded", "android.webview"]) assert.equal(results.get(id), "skipped", id);
  const skipped = await localAndroidChecks.find((c) => c.id === "android.play-protect")!.run(host);
  assert.match(skipped[0].summary, /Needs an ADB connection/);
  assert.ok(localAndroidChecks.every((c) => c.platforms.join() === "android"));

  const termux = await termuxPackages.run(host);
  assert.equal(termux[0].status, "fail");
  assert.match(termux[0].summary, /2 Termux packages have updates waiting \(openssl, nodejs-lts\)/);
  assert.equal(termux[0].auto?.fixId, "android.termux-upgrade");
  delete host.env.TERMUX_VERSION;
  assert.equal((await termuxPackages.run(host))[0].status, "skipped");
});

test("BULWARK_ADB picks the adb to use, and no other", async () => {
  const host = new FakeHost().command("adb").file("/opt/tools/adb", "");
  host.env.BULWARK_ADB = "";
  assert.equal(await findAdb(host), null, "empty means: no adb, even if one is installed");
  host.env.BULWARK_ADB = "/opt/tools/adb";
  assert.equal(await findAdb(host), "/opt/tools/adb");
  host.env.BULWARK_ADB = "/missing/adb";
  assert.equal(await findAdb(host), null);
});

test("fixes that combine findings do so one device at a time", () => {
  const f = (target: string, checkId = "android.play-protect"): Finding =>
    ({ id: `${checkId}@${target}`, checkId, target, status: "fail", severity: "high", remedy: { steps: [], auto: { fixId: "android.setting", params: { serial: target.slice(4), items: [] } } } }) as unknown as Finding;
  const batches = safeBatches([f("adb:192.168.1.60:5555"), f("adb:127.0.0.1:41234"), f("adb:192.168.1.60:5555", "android.install-sources")]);
  assert.deepEqual(
    batches.map((b) => b.map((x) => x.target)),
    [["adb:192.168.1.60:5555", "adb:192.168.1.60:5555"], ["adb:127.0.0.1:41234"]],
  );
});

// ── over a stand-in adb ──

let dir = "";
let shim = "";
let host: Host;
let state: StateStore;

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "bulwark-adb-"));
  shim = path.join(dir, "adb");
  await fs.writeFile(shim, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_ADB}" "$@"\n`, { mode: 0o755 });
  process.env.BULWARK_ADB = shim;
  process.env.FAKE_ADB_STATE = path.join(dir, "tv.json");
  host = await createHost();
  state = new StateStore(path.join(dir, "state"));
});

after(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const tv = async () => JSON.parse(await fs.readFile(path.join(dir, "tv.json"), "utf8")) as { settings: Record<string, string>; appops: Record<string, string>; connected: boolean };

test("over adb: scan a TV, fix Play Protect, check it took, undo it, and close the app loophole", async () => {
  const scan = await runScan(host, { local: false, android: true });
  assert.ok(scan.android);
  assert.equal(scan.android.devices.length, 1);
  const [d] = scan.android.devices;
  assert.equal(d.name, "Living Room TV");
  assert.equal(d.kind, "tv");
  assert.equal(d.self, false);
  assert.ok(scan.scores.devices[`adb:${SERIAL}`] < 50);
  assert.match(markdownReport(scan), /## Phones and TVs \(over ADB\): 1 checked[\s\S]*Living Room TV/);

  // Only the Play Protect setting is a low-risk fix; the rest need a look first.
  assert.deepEqual(safeBatches(allFindings(scan)).map((b) => b.map((f) => f.checkId)), [["android.play-protect"]]);

  const pp = scan.android.findings.find((f) => f.checkId === "android.play-protect" && f.status === "fail")!;
  const fresh = await refreshFindings(host, [pp]);
  assert.equal(fresh.length, 1);
  const plan = await planFix(host, fresh);
  assert.ok(plan.canApply, plan.blockedReason);
  assert.equal(plan.title, "Turn on Play Protect app scanning");
  assert.match(plan.steps[0].detail ?? "", /settings put global package_verifier_enable 1 +\(on 192\.168\.1\.60:5555, over adb\)/);
  assert.equal((await tv()).settings["global/package_verifier_enable"], "0", "planning changes nothing");

  const change = await applyFix(host, state, fresh);
  assert.equal(change.status, "applied", change.error);
  assert.equal(change.verification?.status, "pass", change.verification?.summary);
  assert.equal((await tv()).settings["global/package_verifier_enable"], "1");
  assert.equal((await refreshFindings(host, [pp])).length, 0, "already fixed");

  await rollbackChange(host, state, change.id);
  assert.equal((await tv()).settings["global/package_verifier_enable"], "0", "undo puts the old value back");

  const inst = scan.android.findings.find((f) => f.checkId === "android.install-sources" && f.status === "fail")!;
  const ops = await applyFix(host, state, await refreshFindings(host, [inst]));
  assert.equal(ops.verification?.status, "pass", ops.verification?.summary);
  assert.equal((await tv()).appops["com.example.browser"], "default");
  assert.equal((await tv()).appops["com.android.vending"], "allow", "the app store keeps its permission");
});

test("over adb: turning debugging off ends the connection, and Bulwark checks that it did", async () => {
  const scan = await runScan(host, { local: false, android: true });
  const dbg = scan.android!.findings.find((f) => f.checkId === "android.debugging" && f.status === "fail")!;
  const plan = await planFix(host, [dbg]);
  assert.equal(plan.reversible, false);
  assert.match(plan.warnings.join(" "), /do it last/);
  const change = await applyFix(host, state, await refreshFindings(host, [dbg]));
  assert.equal(change.status, "applied", change.error);
  assert.equal(change.verification?.status, "pass", change.verification?.summary);
  assert.equal((await tv()).connected, false);
  const after = await runScan(host, { local: false, android: true });
  assert.equal(after.android!.devices.length, 0);
  assert.match(after.android!.notes.join(" "), /No phone or TV is connected/);
});

test("connecting and pairing only reach devices on this network", async () => {
  assert.match((await checkDeviceAddress("8.8.8.8")) ?? "", /own network/);
  assert.match((await checkDeviceAddress("100.64.1.2")) ?? "", /own network/, "carrier-grade NAT isn't your network");
  assert.equal(await checkDeviceAddress("192.168.1.60"), null);
  assert.equal(await checkDeviceAddress("127.0.0.1:41234"), null, "the phone Bulwark runs on");
  assert.equal(await checkDeviceAddress("localhost:41234"), null);
  assert.match((await checkDeviceAddress("192.168.1.20", { needPort: true })) ?? "", /port/);
  assert.match((await checkDeviceAddress("192.168.1.60:99999")) ?? "", /port/);
  assert.match((await checkDeviceAddress("192.168.1.60; reboot")) ?? "", /doesn't look like/);

  const bad = await adbConnect(host, shim, "203.0.113.9");
  assert.equal(bad.ok, false);
  const ok = await adbConnect(host, shim, " 192.168.1.60 ");
  assert.ok(ok.ok, ok.message);
  assert.match(ok.message, /192\.168\.1\.60:5555/, "the TV's default port is added");
  assert.ok((await adbPair(host, shim, "192.168.1.20:37123", "123 456")).ok);
  assert.match((await adbPair(host, shim, "192.168.1.20:37123", "12345")).message, /6 digits/);
  assert.match((await adbPair(host, shim, "192.168.1.20", "123456")).message, /port/);
});

test("the dashboard lists, connects and scans phones and TVs", async () => {
  const token = "c".repeat(48);
  let handler: ReturnType<typeof createApp> = async () => {};
  const server = http.createServer((q, s) => void handler(q, s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  handler = createApp({ host, state, port, bind: "127.0.0.1", token });
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
    const st = await call("/api/state");
    assert.deepEqual((st.json.android as { adb: boolean }).adb, true);
    assert.ok((st.json.rootFixes as string[]).length > 0 && !(st.json.rootFixes as string[]).includes("android.setting"));
    const refused = await call("/api/android/connect", { address: "8.8.8.8" });
    assert.equal(refused.json.ok, false);
    assert.equal((await call("/api/android/connect", { address: 42 })).status, 400);
    assert.equal((await call("/api/android/connect", { address: "192.168.1.60" })).json.ok, true);
    const list = await call("/api/android");
    assert.deepEqual((list.json.devices as { serial: string; state: string; self: boolean }[]).map((d) => [d.serial, d.state, d.self]), [[SERIAL, "device", false]]);
    const { json } = await call("/api/scan", { local: false, android: true });
    let job: Record<string, unknown> = {};
    for (let i = 0; i < 100; i++) {
      job = (await call(`/api/jobs/${json.jobId}`)).json;
      if (job.status !== "running") break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(job.status, "done", String(job.error));
    const latest = await state.latestScan();
    assert.equal(latest?.android?.devices[0].serial, SERIAL);
    assert.equal(latest?.local, undefined);
  } finally {
    server.close();
  }
});

// ── TVs that don't run Android ──

test("Roku and Samsung TVs are recognised from the network", async () => {
  let roku = 200;
  const server = http.createServer((req, res) => {
    if (req.url === "/query/device-info") {
      if (roku === 403) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "text/xml" });
      res.end(
        `<?xml version="1.0" encoding="UTF-8" ?><device-info><vendor-name>Roku</vendor-name><model-name>Roku Express</model-name><user-device-name>Bedroom Roku</user-device-name><software-version>11.5.0</software-version><developer-enabled>true</developer-enabled></device-info>`,
      );
    } else if (req.url === "/api/v2/") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ device: { name: "[TV] Samsung Q60 Series (55)", modelName: "QE55Q60", OS: "Tizen", firmwareVersion: "T-KSU2EDEUC-1340.5" }, name: "[TV] Samsung Q60 Series (55)", type: "Samsung SmartTV" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  try {
    const r = await probeRoku("127.0.0.1", port);
    assert.equal(r?.service.name, "roku-ecp");
    assert.equal(r?.service.title, "Bedroom Roku");
    assert.equal(r?.service.version, "11.5.0");
    assert.deepEqual(r?.issues.map((i) => i.checkId), ["roku.ecp-open", "roku.developer-mode"]);
    roku = 403;
    const limited = await probeRoku("127.0.0.1", port);
    assert.deepEqual(limited?.issues, [], "with network control limited, there's nothing to report");
    assert.deepEqual(limited?.service.notes, ["control limited"]);
    const s = await probeSamsungTv("127.0.0.1", port);
    assert.equal(s?.service.name, "samsung-tv");
    assert.equal(s?.service.title, "Samsung Q60 Series (55)");
    assert.equal(s?.service.product, "Samsung Tizen");
  } finally {
    server.close();
  }
});

// ── signing in from a TV ──

test("a TV browser signs in with a one-time code; guessing switches it off", async () => {
  const code = new LoginCode("123456", 60_000);
  assert.equal(code.pretty, "123 456");
  assert.equal(code.check("000000"), "wrong");
  assert.equal(code.check("123 456"), "ok");
  assert.equal(code.check("123456"), "off", "it works once");
  const guessed = new LoginCode("654321");
  for (let i = 0; i < 4; i++) assert.equal(guessed.check(String(111111 + i)), "wrong");
  assert.equal(guessed.check("999999"), "off");
  assert.equal(guessed.check("654321"), "off", "five wrong guesses switch it off, even for the right code");
  assert.equal(new LoginCode("123456", -1).check("123456"), "off", "it expires");
  assert.match(new LoginCode().code, /^\d{6}$/);

  const token = "d".repeat(48);
  let handler: ReturnType<typeof createApp> = async () => {};
  const server = http.createServer((q, s) => void handler(q, s));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  handler = createApp({ host, state, port, bind: "127.0.0.1", token, loginCode: new LoginCode("246810"), lanAddresses: ["192.168.1.23"] });
  const call = (p: string, hostHeader: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port, path: p, method: init.method ?? "GET", headers: { Host: hostHeader, ...init.headers } }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      });
      req.on("error", reject);
      req.end(init.body);
    });
  const lan = `192.168.1.23:${port}`;
  const login = (c: string) => call("/api/login", lan, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c }) });
  try {
    assert.equal((await call("/", lan)).status, 200, "the TV can load the page at the phone's Wi-Fi address");
    assert.equal((await call("/", `192.168.1.99:${port}`)).status, 421, "but not under any other name");
    const wrong = await login("135790");
    assert.equal(wrong.status, 403);
    assert.equal(JSON.parse(wrong.body).code, "wrong-code");
    const ok = await login("246 810");
    assert.equal(ok.status, 200);
    assert.equal(JSON.parse(ok.body).key, token);
    assert.equal((await call("/api/scans", lan, { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    assert.equal(JSON.parse((await login("246810")).body).code, "codes-off", "used up");
  } finally {
    server.close();
  }
});
