// Checks the dashboard's file buttons on the emulator, the way a person uses them on their phone:
// - "Install an app file (APK)" opens Android's file picker for app files;
// - backing out of the picker leaves the button working (it opens the picker again);
// - the file chosen reaches Patch's server whole (that's how an app file gets to a TV);
// - "Add photos" opens a picker for several photos.
// Usage: node file-picker-check.mjs <folder for results> <a file to choose>
import { execFileSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate } from "./cdp.mjs";

const [OUT, FILE] = process.argv.slice(2);
const PKG = "app.patch.home";
const NAME = "patch-test.apk";
const APK_TYPES = ".apk,application/vnd.android.package-archive,application/octet-stream"; // as the dashboard's button
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", timeout: 60_000, maxBuffer: 32 << 20 });

function fail(message) {
  console.error(`FAILED: ${message}`);
  shot("file-picker-failure.png");
  try {
    writeFileSync(join(OUT, "file-picker-failure.xml"), adb("shell", "cat", "/sdcard/patch-ui.xml"));
  } catch {}
  process.exit(1);
}

function shot(name) {
  try {
    writeFileSync(join(OUT, name), execFileSync("adb", ["exec-out", "screencap", "-p"], { timeout: 30_000, maxBuffer: 64 << 20 }));
  } catch {}
}

/** The app in front. */
function front() {
  const activities = adb("shell", "dumpsys", "activity", "activities");
  const m = activities.match(/(?:topResumedActivity=|ResumedActivity: )ActivityRecord\{\S+ u\d+ ([^\s/}]+)\//);
  if (m) return m[1];
  const focus = adb("shell", "dumpsys", "window").match(/mCurrentFocus=Window\{\S+ u\d+ ([^\s/}]+)/);
  return focus ? focus[1] : "";
}

async function waitFor(problem, test, seconds = 25) {
  for (let i = 0; i < seconds * 2; i++) {
    const v = await test();
    if (v) return v;
    await sleep(500);
  }
  if (problem) fail(problem);
  return null;
}

/** Back out of whatever's in front until Patch is (a picker deep in a folder takes more than one Back). */
async function backToPatch(problem) {
  for (let i = 0; i < 4; i++) {
    adb("shell", "input", "keyevent", "KEYCODE_BACK");
    if (await waitFor(null, () => front() === PKG, 5)) return;
  }
  fail(problem);
}

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** What's on the screen, from Android's own UI dump (the dump fails while the screen is still moving). */
async function screen() {
  for (let attempt = 1; ; attempt++) {
    try {
      adb("shell", "uiautomator", "dump", "/sdcard/patch-ui.xml");
      const xml = adb("shell", "cat", "/sdcard/patch-ui.xml");
      if (!xml.includes("<hierarchy")) throw new Error("no dump");
      return [...xml.matchAll(/<node\b[^>]*>/g)].map(([tag]) => {
        const attr = (n) => unescape((tag.match(new RegExp(`\\s${n}="([^"]*)"`)) || [])[1] || "");
        const b = attr("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/) || [0, 0, 0, 0, 0];
        return { text: attr("text"), desc: attr("content-desc"), x: (+b[1] + +b[3]) >> 1, y: (+b[2] + +b[4]) >> 1 };
      });
    } catch (err) {
      if (attempt >= 5) fail(`couldn't read the screen: ${err.message}`);
      await sleep(1000);
    }
  }
}

const tap = (n) => adb("shell", "input", "tap", String(n.x), String(n.y));
const isFilePicker = (app) => /documentsui/i.test(app);
// Photos may open Android's photo picker, or first ask which app to choose them with.
const isPhotoPicker = (app) => /documentsui|photopicker|providers\.media|intentresolver|^android$/i.test(app);

/** Adds a file button to the dashboard and presses it. */
async function pressButton(accept, multiple) {
  const code = `(() => {
    document.getElementById("patch-test-pick")?.remove();
    const i = document.createElement("input");
    i.type = "file";
    i.id = "patch-test-pick";
    i.hidden = true;
    i.accept = ${JSON.stringify(accept)};
    i.multiple = ${multiple};
    document.body.append(i);
    window.__picked = null;
    i.addEventListener("cancel", () => { window.__picked = { cancelled: true }; });
    i.addEventListener("change", async () => {
      const files = [...i.files];
      if (!files.length) return void (window.__picked = { cancelled: true });
      const f = files[0];
      try {
        const head = [...new Uint8Array(await f.slice(0, 2).arrayBuffer())];
        const token = JSON.parse(document.getElementById("boot").textContent).token;
        const res = await fetch("/api/uploads?name=" + encodeURIComponent(f.name), { method: "POST", headers: { "x-patch-token": token, "content-type": "application/octet-stream" }, body: f });
        const r = await res.json();
        window.__picked = { count: files.length, name: f.name, size: f.size, head, upload: r.upload || null, message: r.message || "" };
      } catch (e) {
        window.__picked = { error: String((e && e.message) || e) };
      }
    });
    i.click();
    return "pressed";
  })()`;
  await evaluate(code, { gesture: true });
}

async function patchInFront() {
  adb("shell", "am", "start", "-W", "-n", `${PKG}/.MainActivity`);
  await waitFor("Patch didn't come to the front", () => front() === PKG);
  await sleep(1000);
}

/** In Android's file picker: the file, found in the list shown or in Downloads. */
async function choose(name) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    let items = await screen();
    const file = items.find((n) => n.text === name || n.text === name.replace(/\.apk$/, ""));
    if (file) {
      console.log(`  Tapping ${name} in the picker.`);
      tap(file);
      return;
    }
    const places = items.find((n) => /^show roots$/i.test(n.desc));
    if (places) {
      tap(places);
      await sleep(1500);
      items = await screen();
    }
    const downloads = items.find((n) => /^downloads?$/i.test(n.text));
    if (downloads) {
      console.log("  Opening Downloads in the picker.");
      tap(downloads);
    }
    await sleep(2000);
  }
  shot("file-picker-list.png");
  fail(`${name} isn't in Android's file picker`);
}

// Patch's log lines since a moment on the emulator's clock (older lines can fall out of the log).
let logFrom = "0.000";
const patchLog = () => adb("logcat", "-d", "-T", logFrom, "-s", "Patch:I").split("\n");
const markLog = () => (logFrom = `${adb("shell", "date", "+%s").trim()}.000`);

// The file to choose, where Android keeps downloads (as if the person had downloaded the app file).
adb("push", FILE, `/sdcard/Download/${NAME}`);
const size = statSync(FILE).size;

console.log("Pressing the dashboard's app file button…");
await patchInFront();
markLog();
await pressButton(APK_TYPES, false);
const picker = await waitFor("Android's file picker didn't open", () => {
  const app = front();
  return isFilePicker(app) && app;
});
console.log(`  The picker opened (${picker}).`);
const asked = patchLog().find((l) => /Choosing a file/.test(l));
if (!asked || !/application\/vnd\.android\.package-archive/.test(asked)) fail(`the picker wasn't asked for app files: ${asked || "nothing in the log"}`);
await sleep(1500);
shot("file-picker.png");

console.log("Backing out of the picker…");
markLog();
await backToPatch("Patch didn't come back after backing out of the picker");
await waitFor("the page wasn't told nothing was chosen", () => patchLog().some((l) => /No file chosen/.test(l)), 10);
console.log("  Back in Patch, nothing chosen.");

console.log("Pressing the button again and choosing the app file…");
await sleep(1000);
await pressButton(APK_TYPES, false);
await waitFor("the picker didn't open a second time (the first time was never answered)", () => isFilePicker(front()));
await sleep(1500);
await choose(NAME);
const picked = await waitFor(
  "the chosen file never reached the page",
  async () => {
    const p = await evaluate("window.__picked");
    return p && !p.cancelled ? p : null;
  },
  40,
);
console.log(`  The page got ${picked.name} (${picked.size} bytes) and sent it to Patch: ${JSON.stringify(picked.upload)}`);
if (picked.error) fail(`the page couldn't read or send the file: ${picked.error}`);
if (picked.name !== NAME) fail(`the page got ${picked.name}, not ${NAME}`);
if (picked.size !== size) fail(`the page got ${picked.size} bytes, not ${size}`);
if (picked.head.join() !== "80,75") fail(`the file doesn't start like an app file: ${picked.head}`);
if (!picked.upload || picked.upload.size !== size) fail(`Patch's server didn't get the whole file: ${picked.message || JSON.stringify(picked.upload)}`);
if (front() !== PKG) fail("Patch isn't in front after choosing the file");

console.log("Pressing a photo button (several photos at once)…");
markLog();
await pressButton("image/*", true);
const photos = await waitFor("no picker opened for photos", () => {
  const app = front();
  return isPhotoPicker(app) && app;
});
const askedPhotos = patchLog().find((l) => /Choosing files/.test(l));
if (!askedPhotos || !/image\/\*/.test(askedPhotos)) fail(`the picker wasn't asked for several photos: ${askedPhotos || "nothing in the log"}`);
console.log(`  A picker for photos opened (${photos}).`);
await sleep(1500);
shot("photo-picker.png");
await backToPatch("Patch didn't come back after the photo picker");
adb("shell", "rm", "-f", `/sdcard/Download/${NAME}`, "/sdcard/patch-ui.xml");
console.log("The dashboard's file buttons work on the phone.");
