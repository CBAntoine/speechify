// Using web pages on a TV for the person: Patch's own browser on a (simulated) Fire TV, which Patch
// sees into over ADB and the browser's DevTools socket. The first tests run anywhere, against the
// simulator's pretend browser. The last ones put a real Chrome behind the simulated TV, when this
// computer has one, and carry out whole tasks on a pretend shop with the same code a real TV gets.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSimulator } from "../sim/simulator.mjs";
import { fakeTemplate } from "../sim/apk-fixture.mjs";
import { findChrome, startChrome } from "../sim/chrome.mjs";
import { startWebsite } from "../sim/website.mjs";
import { startApp } from "../src/app.mjs";
import { TEMPLATE, templateLevel } from "../src/apk/index.mjs";
import { pngSize } from "../src/apk/index.mjs";
import { AdbClient, newAdbKey } from "../src/net/adb.mjs";
import { connectPage, httpJson } from "../src/net/cdp.mjs";
import { PAGE_VERSION, describePage, stats } from "../src/tvweb/session.mjs";

const TV = "Kids Room Fire TV";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const rigs = [];

/** A pretend home with Patch running in it, and the Fire TV connected. */
async function startRig(prefix, { template = fakeTemplate(), webTries } = {}) {
  const sim = await startSimulator({ prefix });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-tvweb-test-"));
  const app = await startApp({ port: 0, demo: true, dataDir, overrides: { ...sim.overrides, tvappTemplate: template, tvappsPort: 0, webTries, openUrl: async () => {} }, autoScan: false, log: () => {} });
  const base = `http://127.0.0.1:${app.port}`;
  const api = async (method, p, body) => (await fetch(base + p, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
  const rig = {
    sim,
    app,
    base,
    api,
    tv: sim.state.firetv,
    act: (action, value, extra = {}) => api("POST", "/api/control", { device: TV, action, value, ...extra }),
    /** The same step again after the person said yes. */
    async yes(r, action, value) {
      assert.ok(r.needsConfirmation, `expected Patch to ask first: ${r.message}`);
      return rig.act(action, value, { confirmToken: r.confirmToken });
    },
    async stop() {
      await app.close();
      await sim.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
  rigs.push(rig);
  await api("POST", "/api/scan");
  const r = await rig.act("pair");
  assert.ok(r.ok, r.message);
  return rig;
}

let home; // Patch with the simulator's pretend browser behind the TV

before(async () => {
  home = await startRig("127.0.23");
});

after(async () => {
  for (const r of rigs) await r.stop().catch(() => {});
});

test("a page is described the way Patch says it: numbered things to choose, the words around them, and where you are", () => {
  const page = {
    url: "https://www.example.com/shop?x=1",
    title: "Example shop",
    ready: "complete",
    lines: [{ kind: "Heading", text: "Offers" }, { n: 1, kind: "Link", text: "Batteries" }, { kind: "Text", text: "Two for one this week." }, { n: 2, kind: "Text box", text: "Search", state: "empty" }],
    shown: 2,
    extra: 0,
    above: 0,
    below: 14,
    scroll: { y: 0, max: 2000, page: 540 },
    frames: ["maps.example.net"],
  };
  const d = describePage(page);
  assert.equal(d.summary, "“Example shop” (example.com): 2 things to choose on screen.");
  assert.equal(d.text, ["On screen: Example shop (example.com), in Patch's browser.", "Heading: Offers", "1. Link: Batteries", "Text: Two for one this week.", "2. Text box: Search (empty)", "(This is the top of the page; it goes on below (14 more links and buttons). Part of it comes from maps.example.net, which I can't read.)"].join("\n"));
  assert.match(describePage({ ...page, scroll: { y: 1995, max: 2000, page: 540 }, below: 0, frames: [] }).text, /\(This is the bottom of the page\.\)$/);
  assert.match(describePage({ ...page, scroll: { y: 0, max: 0, page: 540 }, frames: [], ready: "interactive", extra: 7, shown: 45 }).text, /That's the whole page\. Only the first 45 things on screen are listed; 7 more are there\. Say the words of the one you want\. It's still loading\.\)$/);
});

test("the scripts Patch runs inside pages are written for old TV browsers", () => {
  assert.ok(PAGE_VERSION > 0, "page.js says which version it is");
  for (const file of ["page.js", "boxes.js"]) {
    const src = fs.readFileSync(path.join(HERE, "../src/tvweb", file), "utf8");
    // No syntax newer than 2015 (a Fire TV stick from 2016 has Chrome 59 inside): the page would fail to load it.
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/\/(?![*/])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[gimuy]*/g, "/x/");
    for (const [what, re] of [["optional chaining (?.)", /\?\.[a-zA-Z_(\[]/], ["nullish (??)", /\?\?/], ["async or await", /\b(async|await)\b/], ["spread or rest (...)", /\.\.\./], ["exponent (**)", /\*\*/], ["arrow functions", /=>/], ["template strings", /`/], ["let or const", /\b(let|const)\s/]]) {
      assert.doesNotMatch(code, re, `${file} uses ${what}`);
    }
    // And nothing that isn't plain text: a stray invisible character once broke its patterns.
    assert.deepEqual([...new Set(src.match(/[^\x09\x0a\x20-\x7e…]/g) || [])], [], file);
    // Each defines itself and nothing else.
    assert.match(src, file === "page.js" ? /Object\.defineProperty\(self, "__patch"/ : /Object\.defineProperty\(window, "__patchBoxes"/);
  }
});

test("the TV app template says what it can do, and apps made from it keep that", async () => {
  assert.equal(templateLevel(fakeTemplate()), TEMPLATE.level);
  assert.equal(templateLevel(fakeTemplate({ level: 1 })), 1, "a template from before the browser");
  assert.equal(templateLevel(Buffer.from("not a zip")), 1);
  const real = path.join(HERE, "../android/tvapp/src/main/assets/patch-template.json");
  assert.equal(JSON.parse(fs.readFileSync(real, "utf8")).level, TEMPLATE.level, "the real template's level matches what Patch expects");
  const java = fs.readFileSync(path.join(HERE, "../android/tvapp/src/main/java/app/patch/tvapp/AppActivity.java"), "utf8");
  assert.match(java, /WebView\.setWebContentsDebuggingEnabled\(true\)/, "the real template opens its pages to Patch over ADB");
});

test("Patch's ADB connection can hold a stream open to a program on the TV, and fetch a picture byte for byte", async () => {
  const client = await AdbClient.connect("127.0.23.17", { privateKey: newAdbKey(), allowPrompt: true, promptTimeout: 5000 });
  try {
    // Nothing listening: refused, not left hanging.
    await assert.rejects(client.openStream("localabstract:webview_devtools_remote_1"), { code: "EREFUSED" });
    await assert.rejects(client.openStream("tcp:9"), { code: "EREFUSED" });
    // A picture of the screen: about 8 KB here, but sent in pieces with each one acknowledged.
    const png = await client.exec("screencap -p");
    assert.deepEqual(pngSize(png), { width: 1920, height: 1080 });
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "the bytes arrive unchanged (a terminal would have altered the line endings in them)");
    // Shell commands still work alongside.
    assert.match(await client.shell("dumpsys power"), /mWakefulness=/);
  } finally {
    client.close();
  }
});

test("on a TV, a website opens in Patch's own browser (put there the first time), and Patch says what the page shows", async () => {
  let r = await home.act("open_website", "bbc.co.uk");
  assert.ok(r.ok, r.message);
  assert.match(r.message, /^bbc\.co\.uk is open on Kids Room Fire TV: “bbc\.co\.uk: front page” \(bbc\.co\.uk\)\. \(I put Patch's browser on Kids Room Fire TV for this/);
  const browser = Object.entries(home.tv.installed).find(([, a]) => a.kind === "browser");
  assert.ok(browser, "the browser app was installed on the TV");
  assert.equal(browser[1].label, "Patch Browser");
  assert.equal(browser[1].level, TEMPLATE.level);
  assert.equal(home.tv.focus.split("/")[0], browser[0], "and it's in front");
  assert.equal(home.tv.browser.state.url, "https://bbc.co.uk/");
  assert.match(r.screen, /^On screen: bbc\.co\.uk: front page \(bbc\.co\.uk\), in Patch Browser\.\nHeading: Welcome to bbc\.co\.uk\n/);
  assert.match(r.screen, /\n1\. Link: News\n2\. Link: Weather\n3\. Link: Sport\n4\. Text box: Search bbc\.co\.uk \(empty\)\n5\. Button: Search\n/);
  assert.equal(r.device.state.app, "Patch Browser");
  // It's one of the person's TV apps now, on that TV.
  const apps = (await home.api("GET", "/api/tvapps")).apps;
  const mine = apps.find((a) => a.kind === "browser");
  assert.equal(mine.kindLabel, "Web browser");
  assert.deepEqual(mine.tvs.map((t) => t.name), [TV]);

  // The second time it's just a page: nothing is installed again.
  const installs = home.tv.commands.filter((c) => c.startsWith("pm install")).length;
  r = await home.act("open_website", "example.org");
  assert.ok(r.ok, r.message);
  assert.doesNotMatch(r.message, /I put Patch's browser/);
  assert.equal(home.tv.commands.filter((c) => c.startsWith("pm install")).length, installs);
  // An address that isn't there says so plainly.
  r = await home.act("open_website", "nowhere.invalid");
  assert.equal(r.ok, false);
  assert.match(r.message, /nowhere\.invalid didn't open: there's no site at that address\./);
});

test("choosing by number or by words, searching a site, going back, reading and finding words", async () => {
  let r = await home.act("open_website", "bbc.co.uk");
  r = await home.act("tap", "Weather");
  assert.ok(r.ok, r.message);
  assert.match(r.message, /^Chose “Weather” on Kids Room Fire TV\. It's showing “Weather - bbc\.co\.uk” \(bbc\.co\.uk\) now\.$/);
  assert.match(r.screen, /Heading: Weather\n/);
  assert.deepEqual(home.tv.browser.state.clicks.slice(-1), ["Weather"]);
  r = await home.act("press_button", "back");
  assert.match(r.message, /^Went back on Kids Room Fire TV\. It's showing “bbc\.co\.uk: front page”/);
  r = await home.act("tap", "the third one");
  assert.match(r.message, /^Chose “Sport”/);
  r = await home.act("press_button", "back");
  // Typing goes to the page's search box, then Enter sends it.
  r = await home.act("type_text", "doctor who");
  assert.ok(r.ok, r.message);
  assert.match(r.message, /^Typed “doctor who” in “Search bbc\.co\.uk” on Kids Room Fire TV\./);
  assert.match(r.screen, /Text box: Search bbc\.co\.uk \(says: doctor who\)/);
  r = await home.act("press_button", "enter");
  assert.match(r.message, /^Pressed Enter on Kids Room Fire TV\. It's showing “doctor who - bbc\.co\.uk search”/);
  assert.equal(home.tv.browser.state.url, "https://bbc.co.uk/search?q=doctor%20who");
  assert.match(r.screen, /Link: Result 2 for doctor who/);
  // Or in one step.
  r = await home.act("search", "bluey");
  assert.match(r.message, /^Searched for “bluey” in “Search bbc\.co\.uk” on Kids Room Fire TV\./);
  assert.equal(home.tv.browser.state.url, "https://bbc.co.uk/search?q=bluey");
  // Asking what's on the screen reads the page; "text" reads its words; "find" looks for some.
  r = await home.act("read_screen");
  assert.match(r.message, /^“bluey - bbc\.co\.uk search” \(bbc\.co\.uk\): 5 things to choose on screen\.$/);
  r = await home.act("read_screen", "text");
  assert.match(r.screen, /^Results for “bluey” 3 found\./);
  r = await home.act("read_screen", "find 3 found");
  assert.match(r.message, /^“3 found” is on the page once\./);
  // Something that isn't there: Patch says what is.
  r = await home.act("tap", "Horoscopes");
  assert.equal(r.ok, false);
  assert.match(r.message, /I can't find “Horoscopes” on the page\. The closest are: bbc\.co\.uk, Search bbc\.co\.uk, Result 1 for bluey/);
  assert.match(r.screen, /^On screen: bluey - bbc\.co\.uk search/, "and the page as it is comes back with the answer");
  // With another app in front, the same words go back to the TV's own screen reader.
  await home.act("press_button", "home");
  r = await home.act("read_screen");
  assert.match(r.screen, /^On screen: Home screen\./);
  assert.match(r.screen, /Item: Patch Browser/);
});

test("Patch asks before choosing something that could buy, and the person's yes is good once", async () => {
  await home.act("open_website", "shop.example");
  const before = home.tv.browser.state.clicks.length;
  let r = await home.act("tap", "Buy now");
  assert.equal(r.ok, false);
  assert.ok(r.needsConfirmation);
  assert.match(r.message, /“Buy now” on this page could buy, send or delete something\./);
  assert.equal(home.tv.browser.state.clicks.length, before, "nothing was pressed yet");
  r = await home.yes(r, "tap", "Buy now");
  assert.ok(r.ok, r.message);
  assert.deepEqual(home.tv.browser.state.clicks.slice(before), ["Buy now"]);
  // The same token again doesn't work.
  r = await home.act("tap", "Buy now", { confirmToken: "nope" });
  assert.ok(r.needsConfirmation);
});

test("the person can see the TV's screen in Patch and tap on the picture", async () => {
  const tv = (await home.api("GET", "/api/devices")).devices.find((d) => d.name === TV);
  const res = await fetch(`${home.base}/api/devices/${encodeURIComponent(tv.id)}/screen.png`, { headers: { "x-patch-token": home.app.token } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual(pngSize(Buffer.from(await res.arrayBuffer())), { width: 1920, height: 1080 });
  // Not without Patch's token, and not for a device that has no screen to show.
  assert.equal((await fetch(`${home.base}/api/devices/${encodeURIComponent(tv.id)}/screen.png`)).status, 403);
  const light = (await home.api("GET", "/api/devices")).devices.find((d) => d.kind === "light");
  assert.equal((await fetch(`${home.base}/api/devices/${encodeURIComponent(light.id)}/screen.png`, { headers: { "x-patch-token": home.app.token } })).status, 400);
  // A tap on the picture is a tap at that spot on the TV.
  home.tv.taps.length = 0;
  let r = await home.api("POST", `/api/devices/${encodeURIComponent(tv.id)}/screen/tap`, { x: 961.4, y: 540 });
  assert.ok(r.ok, r.message);
  assert.deepEqual(home.tv.taps, [[961, 540]]);
  r = await home.api("POST", `/api/devices/${encodeURIComponent(tv.id)}/screen/tap`, { x: "1; reboot", y: 5 });
  assert.equal(r.ok, false, "only numbers are a spot on the screen");
  assert.deepEqual(home.tv.taps, [[961, 540]]);
});

test("the DevTools channel itself: the list of pages, a session, and events, through the TV's ADB connection", async () => {
  await home.act("open_website", "example.org");
  const pkg = home.tv.focus.split("/")[0];
  const client = await AdbClient.connect("127.0.23.17", { privateKey: newAdbKey(), allowPrompt: true, promptTimeout: 5000 });
  try {
    const out = await client.shell(`pidof ${pkg} 2>/dev/null; echo; cat /proc/net/unix 2>/dev/null`);
    const socket = out.match(/webview_devtools_remote_\d+/)[0];
    assert.equal(socket, `webview_devtools_remote_${out.split("\n")[0]}`, "the socket is named after the browser's process");
    const open = () => client.openStream(`localabstract:${socket}`);
    const pages = await httpJson(open, "/json");
    assert.equal(pages[0].type, "page");
    await assert.rejects(httpJson(open, "/nope"), { code: "EREFUSED", status: 404 });
    const { session, page } = await connectPage(open);
    assert.equal(page.url, "https://example.org/");
    const events = [];
    session.on("event", (name) => events.push(name));
    assert.equal((await session.send("Page.getFrameTree")).frameTree.frame.id, "MAIN");
    await session.send("Page.navigate", { url: "https://example.org/news" });
    await new Promise((r) => setTimeout(r, 80));
    assert.deepEqual(events, ["Page.frameStartedLoading", "Page.frameNavigated", "Page.frameStoppedLoading"]);
    await assert.rejects(session.send("Nope.nothing"), { code: "ECDP" });
    // When the connection goes, whatever is waiting is told, rather than left waiting.
    const waiting = session.send("Page.enable");
    client.close();
    await waiting.catch(() => {});
    await assert.rejects(session.send("Page.enable"), { code: "ECONNRESET" });
  } finally {
    client.close();
  }
});

test("with a template from before the browser, or a TV Patch can't see into, the page still opens", async () => {
  // An older template (kept from before, with no internet to fetch the newer one): the TV's own browser gets the page.
  const old = await startRig("127.0.24", { template: fakeTemplate({ level: 1 }) });
  let r = await old.act("open_website", "bbc.co.uk");
  assert.ok(r.ok, r.message);
  assert.match(r.message, /^Opening bbc\.co\.uk on Kids Room Fire TV, in its own browser, which Patch can't see into\.$/);
  assert.equal(old.tv.lastIntent.pkg, "com.amazon.cloud9");
  assert.equal(Object.values(old.tv.installed).some((a) => a.kind === "browser"), false, "no browser app is made from a template that can't do it");
  await old.stop();

  // A TV where the browser's debugging socket never appears: Patch's browser still shows the page, by its link.
  const blind = await startRig("127.0.25", { webTries: 1 });
  blind.tv.browser = null;
  r = await blind.act("web_search", "weather tomorrow");
  assert.ok(r.ok, r.message);
  assert.match(r.message, /^Searching the web for “weather tomorrow” on Kids Room Fire TV, in Patch's browser\. I can't see into the page on this TV, so use the remote/);
  assert.equal(blind.tv.lastIntent.data, "https://www.google.com/search?q=weather%20tomorrow");
  assert.match(blind.tv.lastIntent.pkg, /^app\.patch\.tvapp\./);
  // And asking what's on the screen falls back to the TV's own reader.
  r = await blind.act("read_screen");
  assert.ok(r.ok, r.message);
  await blind.stop();
});

test("a TV that won't list its sockets: Patch tries the browser's socket by its usual name", async () => {
  const shy = await startRig("127.0.27", { webTries: 2 });
  shy.tv.noSocketList = true;
  const r = await shy.act("open_website", "bbc.co.uk");
  assert.ok(r.ok, r.message);
  assert.match(r.screen || "", /^On screen: bbc\.co\.uk: front page \(bbc\.co\.uk\), in Patch Browser\./, "Patch sees the page all the same");
  await shy.stop();
});

// ── A real browser behind the simulated TV ──────────────────────────────────

const chromePath = findChrome();
const needsChrome = chromePath ? {} : { skip: "no Chrome or Chromium on this computer (set PATCH_TEST_CHROME to one)" };
let real; // { rig, chrome, site }

async function realRig() {
  if (real) return real;
  const chrome = await startChrome({ binary: chromePath });
  const site = await startWebsite();
  const rig = await startRig("127.0.26");
  rig.tv.browser = { open: chrome.open };
  const stop = rig.stop;
  rig.stop = async () => {
    await stop();
    await chrome.close();
    await site.close();
  };
  real = { rig, chrome, site };
  return real;
}

test("a whole task in a real browser: past the cookie box, search the shop, open a result, choose how many, add it to the basket", needsChrome, async () => {
  const { rig, site } = await realRig();
  let r = await rig.act("open_website", `${site.url}/`);
  assert.ok(r.ok, r.message);
  // Only what a person could reach is listed: the cookie box is on top of everything else.
  assert.match(r.screen, /Heading: We value your privacy\nText: We use cookies to run the shop\.\n1\. Button: Accept all\n2\. Button: Only what's needed\n/);
  assert.doesNotMatch(r.screen, /AA batteries/);
  r = await rig.act("tap", "AA batteries, pack of 12");
  assert.equal(r.ok, false);
  assert.equal(r.error, "ECOVERED");
  assert.match(r.message, /“AA batteries, pack of 12” is behind something else on the page \(“We value your privacy/);
  r = await rig.act("tap", "Only what's needed");
  assert.ok(r.ok, r.message);
  assert.match(r.screen, /Text box: Search the shop \(empty\)/);

  r = await rig.act("search", "hdmi");
  assert.ok(r.ok, r.message);
  assert.deepEqual(site.state.searches, ["hdmi"], "the shop's server got the search, typed and sent as a person would");
  assert.match(r.screen, /Heading: Results for “hdmi”\n/);
  assert.match(r.screen, /Text: 1 found\.\n\d+\. Link: HDMI cable, 2 metres\nText: £7\.99\n/);
  const n = r.screen.match(/(\d+)\. Link: HDMI cable/)[1];
  r = await rig.act("tap", n);
  assert.match(r.message, /^Chose “HDMI cable, 2 metres” on Kids Room Fire TV\. It's showing “HDMI cable, 2 metres”/);
  assert.match(r.screen, /Text: Price: £7\.99\. In stock\.\n\d+\. Menu: How many \(now: 1, 3 choices\)\n\d+\. Checkbox: Gift wrap it \(off\)\n\d+\. Button: Add to basket\n\d+\. Button: Buy now\n/);

  // A menu says its choices; one is picked by its words.
  r = await rig.act("tap", "How many");
  assert.match(r.message, /“How many” is a menu with these choices: 1, 2, 3 \(save 10%\)\. To pick one, tap with “<choice> in How many”\./);
  r = await rig.act("tap", "3 in How many");
  assert.match(r.message, /^Chose “3 \(save 10%\)” in “How many”/);
  assert.match(r.screen, /Menu: How many \(now: 3 \(save 10%\), 3 choices\)/);
  // A checkbox drawn by the page (the real one is hidden) is still a checkbox.
  r = await rig.act("tap", "Gift wrap it");
  assert.match(r.screen, /Checkbox: Gift wrap it \(on\)/);
  r = await rig.act("tap", "Add to basket");
  assert.ok(r.ok, r.message);
  assert.deepEqual(site.state.basket, [{ id: "hdmi-cable", qty: 3, gift: true }], "the shop's server has exactly what was chosen");
  assert.match(r.screen, /Heading: Your basket\nText: 3 × HDMI cable, 2 metres \(gift wrapped\)/);

  // Buying needs the person's yes.
  r = await rig.act("press_button", "back");
  assert.match(r.message, /It's showing “HDMI cable, 2 metres”/);
  r = await rig.act("tap", "Buy now");
  assert.ok(r.needsConfirmation);
  assert.deepEqual(site.state.bought, []);
  r = await rig.yes(r, "tap", "Buy now");
  assert.ok(r.ok, r.message);
  assert.deepEqual(site.state.bought, ["hdmi-cable"]);
  assert.match(r.screen, /Heading: Thank you for your order/);
});

test("in a real browser: a step that opens another page is done once, even when that page has a form waiting", needsChrome, async () => {
  const { rig, site } = await realRig();
  // Enter sends this page's form. The next page has a form of its own, with its box ready for
  // typing and a button: it must be left alone (it isn't the page the person was talking about).
  let r = await rig.act("open_website", `${site.url}/delivery`);
  assert.match(r.screen, /Text box: Postcode \(empty, typing goes here\)/);
  r = await rig.act("type_text", "AB1 2CD");
  assert.ok(r.ok, r.message);
  const was = { ...stats };
  r = await rig.act("press_button", "enter");
  assert.ok(r.ok, r.message);
  assert.match(r.screen, /^On screen: One more thing/);
  await sleep(600);
  assert.deepEqual(site.state.steps, ["delivery:AB1 2CD"], "only the first form was sent");
  assert.match((await rig.act("read_screen")).screen, /^On screen: One more thing/, "and Patch is still on the page that followed");
  assert.equal(stats.enters - was.enters, 1, "Enter went in as a real key press");
  assert.equal(stats.entersInside - was.entersInside, 0, "and wasn't done a second way");

  // The same for a click: a link that opens another page was a real click, not one that had to be redone.
  r = await rig.act("open_website", `${site.url}/article`);
  const clicks = { ...stats };
  r = await rig.act("tap", "Offers");
  assert.match(r.message, /It's showing “Offers”/);
  assert.equal(stats.clicks - clicks.clicks, 1);
  assert.equal(stats.clicksInside - clicks.clicksInside, 0);
});

test("in a real browser: on a busy front page, only what a person could see and reach is listed", needsChrome, async () => {
  const { rig, site } = await realRig();
  let r = await rig.act("open_website", `${site.url}/news`);
  assert.ok(r.ok, r.message);
  // Not the links hidden every way a page can hide them, the menu kept off to the side, or the slides waiting their turn.
  assert.doesNotMatch(r.screen, /Hidden|Skip to content|Section \d|Slide [2-8]/);
  assert.match(r.screen, /\d+\. Button: Menu\n\d+\. Link: Sport\n\d+\. Link: Weather\n\d+\. Link: Slide 1\n\d+\. Link: Story number 1 about the day's events\n/);
  assert.match(r.screen, /it goes on below \(2\d\d more links and buttons\)/);
  // It's quick to read, hundreds of links or not.
  const t = Date.now();
  r = await rig.act("read_screen");
  assert.ok(Date.now() - t < 1500, `reading the page took ${Date.now() - t} ms`);

  // A menu that slides in over the page: its links are listed once it's open, and what it covers isn't.
  r = await rig.act("tap", "Menu");
  assert.match(r.screen, /1\. Button: Close menu\n/);
  assert.match(r.screen, /\d+\. Link: Section 1\n/);
  assert.doesNotMatch(r.screen, /Link: The Daily Example|Story number 1 about/);
  r = await rig.act("tap", "Close menu");
  assert.doesNotMatch(r.screen, /Section \d/);

  // Something far down the page, by its words: the bar that stays at the top isn't in the way.
  r = await rig.act("tap", "Local elections");
  assert.match(r.message, /^Chose “Local elections: what you need to know” on Kids Room Fire TV\. It's showing “Story 150”/);
  // A slide waiting its turn is brought round and chosen, when it's asked for by name.
  r = await rig.act("press_button", "back");
  r = await rig.act("tap", "Slide 3");
  assert.match(r.message, /It's showing “Slide 3”/);
  // What isn't there for a person isn't there for Patch.
  r = await rig.act("press_button", "back");
  r = await rig.act("tap", "Hidden by display none");
  assert.equal(r.error, "ENOTFOUND");
  r = await rig.act("tap", "Hidden by being see-through");
  assert.equal(r.error, "ENOTFOUND");
});

test("in a real browser: no passwords or card numbers, pages that redraw themselves, message boxes, long pages and parts from other sites", needsChrome, async () => {
  const { rig, site } = await realRig();
  // Passwords and card details are the person's to type.
  let r = await rig.act("open_website", `${site.url}/signin`);
  r = await rig.act("type_text", "hunter2 into the Password box");
  assert.equal(r.error, "ESECRET");
  assert.match(r.message, /“Password” is for a password or card details\. I don't type those/);
  r = await rig.act("type_text", "4111 1111 1111 1111 into the Card number box");
  assert.equal(r.error, "ESECRET");
  r = await rig.act("type_text", "me@example.com into the Email box");
  assert.ok(r.ok, r.message);
  assert.match(r.screen, /Text box: Email \(says: me@example\.com, typing goes here\)/);
  assert.match(r.screen, /Password box: Password \(empty\)/);
  assert.doesNotMatch(r.screen, /hunter2|4111/);
  r = await rig.act("tap", "Password");
  assert.match(r.message, /“Password” is for a password or card details/);

  // A page that draws itself and changes without loading another page.
  r = await rig.act("open_website", `${site.url}/offers`);
  assert.match(r.screen, /Text: HDMI cable: 20% off\nText: AA batteries: 3 for 2\n/);
  r = await rig.act("tap", "Clearance");
  assert.match(r.screen, /Text: Last year's remote: half price\n/);
  assert.doesNotMatch(r.screen, /20% off/);
  // The page's own message box: an OK box is read out; a question waits for the person.
  r = await rig.act("tap", "When do offers end?");
  assert.match(r.message, /The page said: “Offers end on Sunday\.”\.$/);
  r = await rig.act("tap", "Clear basket");
  assert.ok(r.needsConfirmation);
  assert.match(r.message, /After “Clear basket”, the page asks: “Clear your basket\?”/);
  assert.match((await rig.act("read_screen")).screen, /^On screen: Offers/, "Cancel was the answer: still the same page");
  r = await rig.yes(r, "tap", "Clear basket");
  assert.match(r.message, /The page asked “Clear your basket\?” and I answered OK\.$/);
  assert.match(r.screen, /Heading: Your basket is empty now/);
  // Those boxes were answered inside the page, so none was drawn on the TV for someone to clear away.
  assert.equal(stats.boxes, 3);
  assert.equal(stats.boxesOutside, 0);
  // A box the page puts up by itself is the person's to answer. If it's still up when Patch next
  // needs the page, Patch answers it then, rather than wait for ever.
  r = await rig.act("open_website", `${site.url}/nag`);
  assert.match(r.screen, /^On screen: Still there\?/);
  await sleep(2200);
  const t = Date.now();
  r = await rig.act("read_screen");
  assert.ok(r.ok, r.message);
  assert.ok(Date.now() - t < 3000, `it took ${Date.now() - t} ms`);
  assert.match(r.screen, /^On screen: Welcome back/, "the page went on once its box was answered");
  assert.equal(stats.boxesOutside, 1);

  // A long page: scrolling, finding words further down, and something to choose that's off screen.
  r = await rig.act("open_website", `${site.url}/article`);
  assert.match(r.screen, /\(This is the top of the page; it goes on below \(1 more link or button\)\.\)$/);
  r = await rig.act("scroll", "down");
  assert.match(r.message, /^Moved down on the page/);
  assert.match(r.screen, /\(This is part of the way down the page/);
  r = await rig.act("read_screen", "find best cable");
  assert.match(r.message, /“best cable” is on the page once\. The first place says: “Paragraph 31\. The best cable for most people/);
  assert.match(r.screen, /Text: Paragraph 31\./, "and it's on screen now");
  r = await rig.act("read_screen", "text");
  assert.match(r.screen, /^Paragraph \d+\. /);
  r = await rig.act("scroll", "top");
  r = await rig.act("tap", "See the HDMI cable");
  assert.match(r.message, /^Chose “See the HDMI cable” on Kids Room Fire TV\. It's showing “HDMI cable, 2 metres”/, "found by its words though it was far below the screen");
  r = await rig.act("scroll", "up");
  assert.match(r.message, /doesn't go any further up/);

  // Part of a page from another site is named, not read.
  r = await rig.act("open_website", `${site.url}/apps`);
  assert.match(r.screen, /Part of it comes from 127\.0\.0\.1, which I can't read\.\)$/);
  assert.doesNotMatch(r.screen, /Directions/);
  // In all of these, every click landed on the thing it was meant for.
  assert.equal(stats.strays, 0);
  // When a page moves under the click, Patch doesn't claim it chose the thing, and doesn't press again.
  r = await rig.act("open_website", `${site.url}/tricky`);
  assert.match(r.screen, /\d+\. Button: Catch me\n/);
  r = await rig.act("tap", "Catch me");
  assert.ok(r.ok, r.message);
  assert.match(r.message, /^I pressed where “Catch me” was on Kids Room Fire TV, but the page moved just then, and something else may have been pressed instead\./);
  assert.match(r.screen, /^On screen: A page that moves/, "the button wasn't pressed a second way behind the person's back");
  assert.equal(stats.strays, 1);
});
