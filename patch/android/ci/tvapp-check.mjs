#!/usr/bin/env node
// On the Android emulator: treat it like a TV. Patch's own ADB client (the one it uses for Fire TV
// and Android TV) connects, gets allowed on the emulator's screen, sends the TV apps Patch made
// (make-tvapps.mjs), installs them, opens them and reads what they show, as Patch does on a TV.
// Usage: node tvapp-check.mjs <dir with the made apps> <out dir for screenshots>
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const PATCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { AdbClient, newAdbKey } = await import(path.join(PATCH, "src/net/adb.mjs"));
const { readUiTree } = await import(path.join(PATCH, "src/net/uitree.mjs"));
const [madeDir, outDir] = process.argv.slice(2);
const made = JSON.parse(fs.readFileSync(path.join(madeDir, "tvapps.json"), "utf8"));
const run = promisify(execFile);
const adb = async (...args) => (await run("adb", args.map(String), { maxBuffer: 20e6, encoding: "buffer" })).stdout;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error(`FAILED: ${msg}`);
  process.exit(1);
};

/** What's on the emulator's screen, read the way Patch reads a TV's. */
async function screen(client) {
  const out = client ? await client.shell("uiautomator dump /data/local/tmp/patch-check.xml >/dev/null 2>&1; cat /data/local/tmp/patch-check.xml", { timeout: 30_000 }) : (await adb("exec-out", "uiautomator", "dump", "/dev/tty")).toString("utf8");
  return readUiTree(out.slice(Math.max(0, out.indexOf("<?xml"))));
}

/** Choose "Always allow" and "Allow" when Android asks about Patch's key. */
async function allowOnScreen() {
  for (let i = 0; i < 40; i++) {
    const s = await screen().catch(() => null);
    const allow = s?.items.find((it) => /^allow$/i.test(it.text));
    if (allow) {
      const always = s.items.find((it) => /always allow/i.test(it.text));
      if (always && !/\bon\b/.test(always.state || "")) await adb("shell", "input", "tap", always.x, always.y);
      await adb("shell", "input", "tap", allow.x, allow.y);
      console.log("Allowed Patch on the emulator's screen (as you would on the TV).");
      return;
    }
    await sleep(1000);
  }
  console.log("Android didn't ask to allow Patch (this emulator may not need it).");
}

async function install(client, file) {
  await client.push(fs.readFileSync(path.join(madeDir, file)), "/data/local/tmp/patch-tvapp.apk");
  const out = await client.shell("pm install -r /data/local/tmp/patch-tvapp.apk", { timeout: 180_000 });
  await client.shell("rm -f /data/local/tmp/patch-tvapp.apk");
  if (!/\bSuccess\b/.test(out)) fail(`${file} didn't install: ${out.trim()}`);
  console.log(`Installed ${file}.`);
}

async function open(client, pkg) {
  const out = await client.shell(`monkey -p ${pkg} -c android.intent.category.LEANBACK_LAUNCHER 1`);
  if (/aborted|No activities/i.test(out)) fail(`${pkg} didn't open: ${out.trim()}`);
  await sleep(6000);
}

async function expectOnScreen(client, pkg, re, label) {
  for (let i = 0; i < 8; i++) {
    const s = await screen(client);
    if (s.package === pkg && s.items.some((it) => re.test(it.text))) {
      console.log(`  ${label}: ${s.items.slice(0, 8).map((it) => it.text).join(" | ")}`);
      return s;
    }
    await sleep(1500);
  }
  const s = await screen(client);
  fail(`${label}: expected ${re} from ${pkg}, saw ${s.package}: ${s.items.map((it) => it.text).join(" | ")}`);
}

const shot = async (name) => fs.writeFileSync(path.join(outDir, name), await adb("exec-out", "screencap", "-p"));

// Turn the emulator sideways, like a TV.
await adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
await adb("shell", "settings", "put", "system", "user_rotation", "1");

let client;
try {
  client = await AdbClient.connect("127.0.0.1", { port: 5555, privateKey: newAdbKey(), allowPrompt: true, timeout: 10_000, promptTimeout: 60_000, onPrompt: () => allowOnScreen() });
} catch (err) {
  fail(`Patch's ADB client couldn't connect to the emulator: ${err.code || ""} ${err.message}`);
}
console.log(`Patch's ADB client is connected (${client.banner?.state || "device"}, ${client.maxData} bytes per message).`);

await install(client, "tvapp-notes.apk");
await open(client, made.notes);
await expectOnScreen(client, made.notes, /Dinner at 7/, "The notes app shows");
await shot("tvapp-notes.png");

// A new version installs over the old one: same app id, same signing key, higher version.
await install(client, "tvapp-notes-v2.apk");
const v = await client.shell(`dumpsys package ${made.notes} | grep -m 1 versionCode`);
if (!/versionCode=2\b/.test(v)) fail(`the update didn't install over the old version: ${v.trim()}`);
await open(client, made.notes);
await expectOnScreen(client, made.notes, /version two/i, "After the update");

// The quiz: OK on the remote starts it.
await install(client, "tvapp-quiz.apk");
await open(client, made.quiz);
await expectOnScreen(client, made.quiz, /^Start$/, "The quiz's first screen");
await client.shell("input keyevent KEYCODE_DPAD_CENTER");
await sleep(2000);
await expectOnScreen(client, made.quiz, /Question 1 of 3/, "After pressing OK");
await shot("tvapp-quiz.png");
// Back leaves the app.
await client.shell("input keyevent KEYCODE_BACK");
await sleep(2000);
const after = await screen(client);
if (after.package === made.quiz) fail("Back didn't leave the quiz");

for (const pkg of [made.notes, made.quiz]) await client.shell(`pm uninstall ${pkg}`);
client.close();
await adb("shell", "settings", "put", "system", "user_rotation", "0");
console.log("TV apps made by Patch install, update, open and answer the remote.");
