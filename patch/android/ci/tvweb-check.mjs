#!/usr/bin/env node
// On the Android emulator, treated as a TV: Patch itself (its server, its Android TV driver and its
// ADB client) puts its own browser on the "TV" from the template this build just made, opens a
// pretend shop in it and carries out a task there, as it would when someone says "open the shop
// on the TV and put three HDMI cables in the basket". This is the real thing end to end: the real
// template app, Android's own WebView, and the WebView's debugging socket over ADB.
// Usage: node tvweb-check.mjs <template.apk> <out dir for screenshots>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const PATCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { startApp } = await import(path.join(PATCH, "src/app.mjs"));
const { startWebsite } = await import(path.join(PATCH, "sim/website.mjs"));
const { actionsFor } = await import(path.join(PATCH, "src/drivers/androidtv.mjs"));
const { readUiTree } = await import(path.join(PATCH, "src/net/uitree.mjs"));
const { pngSize } = await import(path.join(PATCH, "src/apk/index.mjs"));
const { stats } = await import(path.join(PATCH, "src/tvweb/session.mjs"));
const [templatePath, outDir] = process.argv.slice(2);
const run = promisify(execFile);
const adb = async (...args) => (await run("adb", args.map(String), { maxBuffer: 40e6, encoding: "buffer" })).stdout;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let app;
let site;
const reversed = [];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-tvweb-"));
const tidy = async () => {
  for (const port of reversed) await adb("reverse", "--remove", `tcp:${port}`).catch(() => {});
  await app?.close().catch(() => {});
  await site?.close().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
};
let failing = false;
const fail = async (msg) => {
  if (failing) process.exit(1);
  failing = true;
  console.error(`FAILED: ${msg}`);
  try {
    // The test script prints this again as the last line of its report, under its long diagnostics.
    fs.writeFileSync(path.join(outDir, "why-it-failed.txt"), `${msg}\n`);
    fs.writeFileSync(path.join(outDir, "tvweb-failure.png"), await adb("exec-out", "screencap", "-p").catch(() => Buffer.alloc(0)));
    await tidy();
  } catch {
    /* the reason is already printed */
  }
  process.exit(1);
};
process.on("uncaughtException", (err) => fail(`the check itself broke: ${err?.stack || err}`));
process.on("unhandledRejection", (err) => fail(`the check itself broke: ${err?.stack || err}`));
const check = async (ok, msg) => {
  if (!ok) await fail(msg);
};

/** Choose "Always allow" and "Allow" when Android asks about Patch's key (as the person does on a TV),
 *  for as long as Patch is still waiting for that answer. */
async function allowOnScreen(waiting) {
  for (let i = 0; i < 40 && waiting(); i++) {
    const out = (await adb("exec-out", "uiautomator", "dump", "/dev/tty").catch(() => Buffer.alloc(0))).toString("utf8");
    const s = readUiTree(out.slice(Math.max(0, out.indexOf("<?xml"))));
    const allow = s.items.find((it) => /^allow$/i.test(it.text));
    if (allow) {
      const always = s.items.find((it) => /always allow/i.test(it.text));
      if (always && !/\bon\b/.test(always.state || "")) await adb("shell", "input", "tap", always.x, always.y);
      await adb("shell", "input", "tap", allow.x, allow.y);
      console.log("Allowed Patch on the emulator's screen (as you would on the TV).");
      return;
    }
    await sleep(1000);
  }
}

// The pretend shop runs on this machine; the emulator reaches it at the same address through ADB.
site = await startWebsite();
for (const port of [new URL(site.url).port, site.state.otherPort]) {
  await adb("reverse", `tcp:${port}`, `tcp:${port}`);
  reversed.push(port);
}

app = await startApp({ port: 0, dataDir, autoScan: false, overrides: { tvappTemplate: fs.readFileSync(templatePath) }, log: () => {} });
const id = "androidtv:emulator";
app.inventory.upsert({ id, driver: "androidtv", kind: "tv", brand: "Google", model: "Android emulator", name: "Test TV", ip: "127.0.0.1", ref: { ip: "127.0.0.1", adbPort: 5555, cast: null }, state: {}, info: {}, online: true, actions: actionsFor({ kind: "tv", paired: false }), setup: { kind: "tv-prompt", message: "Press Connect, then choose Allow." } });

/** How a step reached the page: as a real click, key press or typing, or told to the page from inside it. */
const how = (was) => {
  const d = (k) => stats[k] - was[k];
  const said = [d("clicks") && "a real click", d("clicksInside") && "a click told to the page", d("strays") && "it landed on something else", d("typed") && "real typing", d("typedInside") && "typing told to the page", d("enters") && "a real Enter", d("entersInside") && "Enter told to the page"].filter(Boolean);
  return said.length ? ` [${said.join(", ")}]` : "";
};
let step = 0;
const act = async (action, value, { confirmToken, quiet = false } = {}) => {
  const t = Date.now();
  const was = { ...stats };
  const r = await app.controller.act(id, action, value, { confirmToken });
  if (!quiet) console.log(`${String(++step).padStart(2)}. ${action}${value ? ` “${value}”` : ""} (${Date.now() - t} ms): ${r.ok ? "" : r.needsConfirmation ? "[asks first] " : `[${r.error}] `}${r.message}${how(was)}`);
  return r;
};

let pairing = true;
const [paired] = await Promise.all([act("pair").finally(() => (pairing = false)), allowOnScreen(() => pairing)]);
await check(paired.ok, `Patch couldn't connect to the emulator: ${paired.message}`);

let r = await act("open_website", `${site.url}/`);
await check(r.ok, `the shop didn't open in Patch's browser: ${r.message}`);
await check(/I put Patch's browser on Test TV/.test(r.message), "Patch's browser should have been installed for this");
console.log(r.screen.split("\n").map((l) => `      ${l}`).join("\n"));
await check(/1\. Button: Accept all\n2\. Button: Only what's needed/.test(r.screen), "Patch should see the cookie box, and only that, on the shop's first page");
await check(!/AA batteries/.test(r.screen), "what's under the cookie box shouldn't be listed");
fs.writeFileSync(path.join(outDir, "tvweb-shop.png"), await adb("exec-out", "screencap", "-p"));

r = await act("tap", "Only what's needed");
await check(r.ok && /Text box: Search the shop \(empty\)/.test(r.screen), `the cookie box should be gone: ${r.message}`);
r = await act("search", "hdmi");
await check(r.ok && site.state.searches.join() === "hdmi", `the shop's server should have got the search, once (it got ${JSON.stringify(site.state.searches)}): ${r.message}`);
await check(/Link: HDMI cable, 2 metres/.test(r.screen), "the results should list the HDMI cable");
r = await act("tap", "HDMI cable");
await check(r.ok && /Menu: How many \(now: 1, 3 choices\)/.test(r.screen), `the product page should show its menu: ${r.message}`);
console.log(r.screen.split("\n").map((l) => `      ${l}`).join("\n"));
r = await act("tap", "3 in How many");
await check(r.ok && /Menu: How many \(now: 3 \(save 10%\)/.test(r.screen), `choosing from the menu didn't work: ${r.message}`);
r = await act("tap", "Gift wrap it");
await check(r.ok && /Checkbox: Gift wrap it \(on\)/.test(r.screen), `ticking the box didn't work: ${r.message}`);
r = await act("tap", "Add to basket");
await check(r.ok && JSON.stringify(site.state.basket) === JSON.stringify([{ id: "hdmi-cable", qty: 3, gift: true }]), `the shop's basket is ${JSON.stringify(site.state.basket)}: ${r.message}`);
fs.writeFileSync(path.join(outDir, "tvweb-basket.png"), await adb("exec-out", "screencap", "-p"));
r = await act("press_button", "back");
await check(r.ok && /It's showing “HDMI cable, 2 metres”/.test(r.message), `Back should return to the product: ${r.message}`);

// Buying waits for the person's yes.
r = await act("tap", "Buy now");
await check(r.needsConfirmation && site.state.bought.length === 0, `Patch should ask before buying: ${r.message}`);
r = await act("tap", "Buy now", { confirmToken: r.confirmToken });
await check(r.ok && site.state.bought.join() === "hdmi-cable", `after the yes, the shop should have the order: ${r.message}`);

// Passwords are the person's to type.
r = await act("open_website", `${site.url}/signin`);
r = await act("type_text", "hunter2 into the Password box");
await check(!r.ok && r.error === "ESECRET", `Patch shouldn't type into a password box: ${r.message}`);
r = await act("type_text", "me@example.com into the Email box");
await check(r.ok && /Text box: Email \(says: me@example\.com/.test(r.screen), `typing into the email box didn't work: ${r.message}`);

// A page that redraws itself, a message box, a long page.
r = await act("open_website", `${site.url}/offers`);
r = await act("tap", "Clearance");
await check(r.ok && /Last year's remote: half price/.test(r.screen) && !/20% off/.test(r.screen), `the page's own tabs should work: ${r.message}`);
r = await act("tap", "When do offers end?");
await check(r.ok && /The page said: “Offers end on Sunday\.”/.test(r.message), `the page's message box should be read out: ${r.message}`);
r = await act("open_website", `${site.url}/article`);
r = await act("scroll", "down");
await check(r.ok && /part of the way down/.test(r.screen), `scrolling should move down the page: ${r.message}`);
r = await act("read_screen", "find best cable");
await check(r.ok && /is on the page once/.test(r.message), `finding words on the page didn't work: ${r.message}`);
r = await act("scroll", "top");
r = await act("tap", "See the HDMI cable");
await check(r.ok && /It's showing “HDMI cable, 2 metres”/.test(r.message), `a link far below the screen should be found by its words: ${r.message}`);

// Enter sends the form it's in, once: the page that follows has a form of its own, which is left alone.
r = await act("open_website", `${site.url}/delivery`);
r = await act("type_text", "AB1 2CD");
await check(r.ok, `typing into the box that's ready didn't work: ${r.message}`);
r = await act("press_button", "enter");
await check(r.ok && /^On screen: One more thing/.test(r.screen || ""), `Enter should have sent the first form and stopped at the next page: ${r.message}\n${r.screen}`);
await sleep(1000);
await check(site.state.steps.join() === "delivery:AB1 2CD", `only the first form should have been sent, got ${JSON.stringify(site.state.steps)}`);

// The picture of the screen, for the dashboard: the size Android says its screen is, whichever way up.
r = await act("open_website", `${site.url}/product/hdmi-cable`);
await check(r.ok && /Button: Add to basket/.test(r.screen || ""), `the product page should be showing: ${r.message}`);
const png = await app.controller.picture(id);
const size = pngSize(png);
const real = ((await adb("shell", "wm", "size")).toString().match(/(\d+)x(\d+)\s*$/) || []).slice(1).map(Number);
await check(size && png.length > 2000, `the picture of the screen should be a PNG, got ${png.length} bytes, ${JSON.stringify(size)}`);
if (real.length === 2) await check([size.width, size.height].sort().join() === [...real].sort().join(), `the picture should be the screen's size (${real.join(" by ")}), got ${size.width} by ${size.height}`);
fs.writeFileSync(path.join(outDir, "tvweb-picture.png"), png);
console.log(`A picture of the screen: ${size.width} by ${size.height}, ${Math.round(png.length / 1024)} KB.`);

// A tap on that picture (as in the dashboard) lands on the TV: on the product page's "Add to basket".
// Where that button is on the screen comes from Android's own list of what's showing, read the
// way Patch reads a TV's screen.
const listed = async () => (await adb("shell", "uiautomator dump /data/local/tmp/patch-tvweb.xml >/dev/null 2>&1; cat /data/local/tmp/patch-tvweb.xml; rm -f /data/local/tmp/patch-tvweb.xml").catch(() => Buffer.alloc(0))).toString("utf8");
const before = site.state.basket.length;
let spot = null;
let xml = "";
for (let i = 0; i < 10 && !spot; i++) {
  xml = await listed();
  const m = xml.match(/<node[^>]*(?:text|content-desc)="Add to basket"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  if (m) spot = { x: Math.round((Number(m[1]) + Number(m[3])) / 2), y: Math.round((Number(m[2]) + Number(m[4])) / 2) };
  else await sleep(1000);
}
await check(spot, `Android should list the page's “Add to basket” button, to know where to tap. It listed ${(xml.match(/<node /g) || []).length} things: ${[...xml.matchAll(/(?:text|content-desc)="([^"]{1,40})"/g)].map((m) => m[1]).slice(0, 30).join(" | ") || "(nothing with words)"}`);
const tapped = await app.controller.tapAt(id, spot.x, spot.y);
for (let i = 0; i < 24 && site.state.basket.length === before; i++) await sleep(250);
await check(tapped.ok && site.state.basket.length === before + 1, `a tap at ${spot.x}, ${spot.y} on the picture should have pressed “Add to basket”: ${tapped.message}`);
console.log(`A tap on the picture at ${spot.x}, ${spot.y} pressed “Add to basket” on the TV.`);

// With another app in front, Patch reads the screen the usual way again.
await act("press_button", "home", { quiet: true });
for (let i = 0; i < 4; i++) {
  await sleep(1500);
  r = await act("read_screen", "", { quiet: i < 3 });
  if (r.ok) break;
}
await check(r.ok && !/in Patch Browser/.test(r.screen || ""), `with the home screen in front, Patch should read the home screen: ${r.message}`);
console.log("With the home screen in front, Patch reads the home screen again.");

console.log(`How the steps went in: ${stats.clicks} clicks as real ones and ${stats.clicksInside} told to the page (${stats.strays} landed on something else); typing ${stats.typed} real, ${stats.typedInside} told; Enter ${stats.enters} real, ${stats.entersInside} told.`);
await check(stats.clicks >= 8 && stats.clicksInside === 0 && stats.strays === 0 && stats.typed >= 3 && stats.typedInside === 0 && stats.enters >= 2 && stats.entersInside === 0, `in Android's own WebView every step should go in as a real click, key press or typing: ${JSON.stringify(stats)}`);
const browser = app.tvapps.list().find((a) => a.kind === "browser");
if (browser) await adb("shell", "pm", "uninstall", browser.package).catch(() => {});
await tidy();
console.log("Patch's browser on the TV: Patch reads pages in it, chooses, types, searches and scrolls, and asks before buying.");
process.exit(0);
