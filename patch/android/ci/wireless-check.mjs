#!/usr/bin/env node
// Wireless debugging on a real Android (the emulator, Android 14), with Patch's own code: pairing,
// then the encrypted connection, as Patch does with a wall calendar, a tablet or a phone.
//
// Android's "Pair device with pairing code" window needs a person, so this starts pairing the way
// Android Studio's QR code does: Android's own debugging service, given a password chosen here
// (IAdbManager: 4 = allowWirelessDebugging(always, network), 9 = enablePairingByQrCode(name,
// password)). It's the same pairing protocol, and the same pairing server inside Android.
// Usage: node wireless-check.mjs <out dir>
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const PATCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { AdbClient, newAdbKey, pairAdb } = await import(path.join(PATCH, "src/net/adb.mjs"));
const { isPairingWindow, isWirelessAdb } = await import(path.join(PATCH, "src/net/adbfind.mjs"));
const { certificateFor, certificatePem } = await import(path.join(PATCH, "src/apk/sign.mjs"));
const [outDir] = process.argv.slice(2);
const run = promisify(execFile);
const adb = async (...args) => (await run("adb", args.map(String), { maxBuffer: 40e6 })).stdout.toString();
const sh = async (cmd) => (await adb("shell", cmd)).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAIR_LOCAL = 37811;
const TLS_LOCAL = 37812;
const report = {};

let finished = false;
const finish = async (ok, msg) => {
  if (finished) return;
  finished = true;
  report.result = msg;
  fs.writeFileSync(path.join(outDir, "wireless.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const p of [PAIR_LOCAL, TLS_LOCAL]) await adb("forward", "--remove", `tcp:${p}`).catch(() => {});
  await sh("service call adb 11").catch(() => {}); // disablePairing
  await sh("settings put global adb_wifi_enabled 0").catch(() => {});
  console.log(ok ? msg : `FAILED: ${msg}`);
  if (!ok) fs.writeFileSync(path.join(outDir, "why-it-failed.txt"), `${msg}\n`);
  process.exit(ok ? 0 : 1);
};
process.on("unhandledRejection", (e) => finish(false, `the check itself broke: ${e?.stack || e}`));

/** Wireless debugging's encrypted port: as Android's debugging service knows it (IAdbManager 10), else adbd's property. */
async function tlsPortNow() {
  const r = (await sh("service call adb 10").catch(() => "")).match(/Parcel\(\s*([0-9a-f]{8})\s+([0-9a-f]{8})/i);
  const port = r && parseInt(r[1], 16) === 0 ? parseInt(r[2], 16) : 0;
  if (port > 0 && port < 65536) return port;
  return Number(await sh("getprop service.adb.tls.port").catch(() => "0")) || 0;
}

/** What Android says about Wireless debugging, for a failure to explain itself. */
async function diagnose() {
  const get = async (cmd) => (await sh(cmd).catch((e) => `(${String(e.message).split("\n")[0]})`)).slice(0, 1500);
  return {
    tlsServerEnable: await get("getprop persist.adb.tls_server.enable"),
    adbWifiEnabled: await get("settings get global adb_wifi_enabled"),
    serviceCallPort: await get("service call adb 10"),
    portProperty: await get("getprop service.adb.tls.port"),
    log: await get("logcat -d -t 600 | grep -iE 'adbd|AdbDebugging|adb wifi|TlsServer|pairing' | tail -n 20"),
  };
}

/** TCP ports something on the device is listening on (from /proc/net). */
async function listening() {
  const text = await sh("cat /proc/net/tcp /proc/net/tcp6 2>/dev/null").catch(() => "");
  const ports = new Set();
  for (const line of text.split("\n")) {
    const f = line.trim().split(/\s+/);
    if (f[3] === "0A" && f[1]?.includes(":")) ports.add(parseInt(f[1].split(":").pop(), 16));
  }
  return ports;
}

/** Start a pairing session with this password; resolves its port (Android announces it only on its own network). */
async function startPairing(password, tlsPort) {
  const before = await listening();
  if (!before.size) return -1;
  await sh(`service call adb 9 s16 studio-patchcheck s16 ${password}`);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const fresh = [...(await listening())].filter((p) => !before.has(p) && p !== tlsPort);
    if (fresh.length) return fresh[0];
  }
  return null;
}

async function main() {
  // Android's system process, before: pairing must never take it down (it holds the pairing server).
  report.systemBefore = await sh("pidof system_server").catch(() => "");
  const supported = await sh("cmd adb is-wifi-supported").catch(() => "");
  report.supported = supported;
  if (supported !== "true") return finish(false, `this Android says it can't do Wireless debugging ("${supported}")`);

  // Wireless debugging on, on this network ("Always allow on this network"), as a person would.
  const wifi = await sh("dumpsys wifi").catch(() => "");
  const bssid = wifi.match(/mWifiInfo[^\n]*?BSSID: ([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i)?.[1] || (await sh("cmd wifi status").catch(() => "")).match(/BSSID[=:]\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i)?.[1];
  report.bssid = bssid || null;
  if (!bssid) return finish(false, "the emulator isn't on Wi-Fi, so Wireless debugging can't be switched on");
  await sh(`service call adb 4 i32 1 s16 ${bssid}`);
  let tlsPort = 0;
  for (let i = 0; i < 60 && !tlsPort; i++) {
    tlsPort = await tlsPortNow();
    if (!tlsPort) await sleep(500);
  }
  report.tlsPort = tlsPort;
  if (!tlsPort) {
    report.diagnosis = await diagnose();
    return finish(false, `Wireless debugging didn't give a port: ${JSON.stringify(report.diagnosis)}`);
  }
  await adb("forward", `tcp:${TLS_LOCAL}`, `tcp:${tlsPort}`);

  const key = newAdbKey();
  const keys = { key, cert: certificatePem(certificateFor(key, "adb")) };

  // 1. Before pairing, Android turns Patch's key away on the encrypted connection, where it checks
  //    keys at all: adbd only does when ro.adb.secure is 1 (real devices); emulator images often set 0.
  const secure = (await sh("getprop ro.adb.secure").catch(() => "")) === "1";
  report.adbSecure = secure;
  try {
    const c = await AdbClient.connect("127.0.0.1", { port: TLS_LOCAL, privateKey: key, tls: keys, timeout: 10_000 });
    c.close();
    report.beforePairing = "let in";
    if (secure) return finish(false, "Android let in a key that never paired");
    console.log("This emulator doesn't check keys (ro.adb.secure isn't 1), so it lets any key in; Patch's own tests check the refusal.");
  } catch (e) {
    report.beforePairing = e.code;
    if (e.code !== "EPAIR") return finish(false, `before pairing, expected Android to turn the key away, got ${e.code}: ${e.message}`);
  }

  // 2. A wrong password: the key exchange fails and Android keeps nothing.
  if (!(await listening()).size) {
    report.root = (await adb("root").catch((e) => String(e.message))).trim();
    await adb("wait-for-device").catch(() => {});
    await sleep(3000);
    tlsPort = 0;
    for (let i = 0; i < 40 && !tlsPort; i++) {
      tlsPort = await tlsPortNow();
      if (!tlsPort) await sleep(500);
    }
    report.tlsPortAfterRoot = tlsPort;
    await adb("forward", `tcp:${TLS_LOCAL}`, `tcp:${tlsPort}`).catch(() => {});
  }
  const pairPort = await startPairing("patch-right-password-482913", tlsPort);
  if (pairPort === -1) return finish(false, `the device's list of listening ports can't be read, so the pairing port can't be found (${JSON.stringify(await diagnose())})`);
  report.pairingPort = pairPort;
  if (!pairPort) return finish(false, "Android's pairing server didn't open a port");
  await adb("forward", `tcp:${PAIR_LOCAL}`, `tcp:${pairPort}`);
  // How Patch tells Android's two ports apart when it has to knock on every port (no announcement heard):
  // the pairing window speaks TLS at once with adb's own certificate; adbd asks for TLS after adb's hello.
  report.pairingLooksRight = await isPairingWindow("127.0.0.1", PAIR_LOCAL, { key, cert: keys.cert });
  report.pairingNotAdbd = !(await isWirelessAdb("127.0.0.1", PAIR_LOCAL));
  report.adbdLooksRight = await isWirelessAdb("127.0.0.1", TLS_LOCAL);
  report.adbdNotPairing = !(await isPairingWindow("127.0.0.1", TLS_LOCAL, { key, cert: keys.cert }));
  if (!report.pairingLooksRight || !report.pairingNotAdbd) return finish(false, `Patch wouldn't recognise Android's pairing window by knocking (${JSON.stringify({ pairing: report.pairingLooksRight, notAdbd: report.pairingNotAdbd })})`);
  if (!report.adbdLooksRight || !report.adbdNotPairing) return finish(false, `Patch wouldn't recognise Wireless debugging's encrypted port by knocking (${JSON.stringify({ adbd: report.adbdLooksRight, notPairing: report.adbdNotPairing })})`);
  try {
    await pairAdb("127.0.0.1", PAIR_LOCAL, "patch-wrong-password-000000", { privateKey: key, cert: keys.cert });
    return finish(false, "a wrong password paired");
  } catch (e) {
    report.wrongPassword = e.code;
    if (e.code !== "EPAIRCODE") return finish(false, `a wrong password should say the code didn't match, got ${e.code}: ${e.message}`);
  }

  // 3. The right password in the same pairing window, as when someone misreads the code and reads it again:
  //    Android keeps the window open through a wrong try (up to 20). (Starting a second window while the first
  //    still waits trips a bug in Android's own pairing service, which takes the whole system down.)
  let paired;
  try {
    paired = await pairAdb("127.0.0.1", PAIR_LOCAL, "patch-right-password-482913", { privateKey: key, cert: keys.cert });
  } catch (e) {
    return finish(false, `after a wrong password, the right one in the same pairing window failed: ${e.code} ${e.message}`);
  }
  report.guid = paired.guid;
  if (!/^adb-/.test(paired.guid || "")) return finish(false, `paired, but Android's name for itself looks wrong: ${paired.guid}`);

  // 4. Now the encrypted connection works, and Patch runs commands and takes a picture of the screen.
  let client;
    try {
      client = await AdbClient.connect("127.0.0.1", { port: TLS_LOCAL, privateKey: key, tls: keys, timeout: 15_000 });
    } catch (e) {
      return finish(false, `after pairing, the encrypted connection failed: ${e.code} ${e.message}`);
    }
  report.banner = client.banner;
  const release = (await client.shell("getprop ro.build.version.release")).trim();
  report.android = release;
  const png = await client.exec("screencap -p", { timeout: 30_000 });
  fs.writeFileSync(path.join(outDir, "wireless-screen.png"), png);
  client.close();
  if (release !== "14") return finish(false, `over the encrypted connection, Android said its version is "${release}"`);
  if (png.length < 1000 || png.readUInt32BE(0) !== 0x89504e47) return finish(false, "the picture of the screen over the encrypted connection wasn't a PNG");
  await sleep(1500);
  report.systemAfter = await sh("pidof system_server").catch(() => "");
  if (report.systemBefore && report.systemAfter !== report.systemBefore) return finish(false, `Android's system process restarted during pairing (${report.systemBefore} → ${report.systemAfter || "gone"})`);
  return finish(true, `Wireless debugging works with Patch's own code on Android ${release}: Patch recognises its pairing window and its encrypted port by what answers on them, a wrong password is refused, the right one then pairs in the same window (${paired.guid}), and the encrypted connection runs commands and takes a ${png.length}-byte picture of the screen.`);
}

await main();
