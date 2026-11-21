// End to end: knowing exactly what each device is, and running TVs by name. Pairing on Samsung, LG
// and Fire TV, channels, apps, YouTube search and play, web search and typing, against simulated
// TVs that speak the real protocols.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { startSimulator } from "../sim/simulator.mjs";
import { fakeTemplate, fakeThirdPartyApk } from "../sim/apk-fixture.mjs";
import { startApp } from "../src/app.mjs";
import { apkInfo } from "../src/apk/index.mjs";
import { encodePng } from "../src/apk/png.mjs";
import { verifyV2 } from "../src/apk/sign.mjs";
import { entryData, readZip } from "../src/apk/zip.mjs";

let sim;
let app;
let base;
let web; // stands in for YouTube's oEmbed, the weather's place search and the radio directory
const opened = [];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-tv-test-"));

const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const control = (b) => api("POST", "/api/control", b);
const devices = async () => (await api("GET", "/api/devices")).devices;
const named = async (n) => (await devices()).find((d) => d.name === n);

const upload = async (buf, name) => (await (await fetch(`${base}/api/uploads?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "x-patch-token": app.token, "content-type": "application/octet-stream" }, body: buf })).json()).upload;

before(async () => {
  sim = await startSimulator({ prefix: "127.0.12" });
  web = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const json = (o) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(o));
    if (u.pathname === "/oembed") return json(/dQw4w9WgXcQ/.test(u.searchParams.get("url")) ? { title: "Never Gonna Give You Up <script>alert(1)</script>", author_name: "Rick Astley" } : { title: "Cooking for kids", author_name: "Quick Eats" });
    if (u.pathname === "/geo") return json(/nowhere/i.test(u.searchParams.get("name")) ? {} : { results: [{ name: "Portland", admin1: "Oregon", country: "United States", country_code: "US", latitude: 45.52345, longitude: -122.67621 }] });
    if (u.pathname === "/json/stations/search") return json(/kexp/i.test(u.searchParams.get("name")) ? [{ name: "KEXP 90.3 FM", url_resolved: "https://kexp.streamguys1.com/kexp160.aac", favicon: "https://www.kexp.org/favicon.ico", countrycode: "US", tags: "indie,alternative,seattle" }] : []);
    res.writeHead(404).end();
  });
  await new Promise((r) => web.listen(0, "127.0.0.1", r));
  const w = `http://127.0.0.1:${web.address().port}`;
  const tvapps = { tvappTemplate: fakeTemplate(), oembedBase: `${w}/oembed`, geocodeBase: `${w}/geo`, radioBases: [w], tvappsPort: 0 };
  app = await startApp({ port: 0, demo: true, dataDir, overrides: { ...sim.overrides, ...tvapps, openUrl: async (u) => opened.push(u) }, autoScan: false, log: () => {} });
  base = `http://127.0.0.1:${app.port}`; // not "localhost": Node 18 may try IPv6 first
  await api("POST", "/api/scan");
});

after(async () => {
  await app?.close();
  await sim?.stop();
  web?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("every device gets an exact description, and says how Patch knows", async () => {
  const list = await devices();
  const what = (n) => list.find((d) => d.name === n)?.what;
  assert.equal(what("Family Room TV"), 'Samsung 65" Q80B Smart TV (model QN65Q80BAFXZA)');
  assert.equal(what("LG TV"), 'LG 55" OLED C1 webOS TV (model OLED55C1PUB)');
  assert.equal(what("Kids Room Fire TV"), "Amazon Fire TV Stick 4K Max (model AFTKA)");
  assert.equal(what("Alex's iPhone"), "Apple iPhone 14 Pro (model iPhone15,2)");
  assert.match(what("Alex's MacBook Pro"), /^Apple MacBook Pro 14-inch \(2021\)/);
  assert.match(what("Den"), /^Apple TV 4K \(3rd generation\)/);
  assert.equal(what("Bathroom Speaker"), "Bose Smart Speaker 500");
  assert.equal(what("PS5-773"), "Sony PlayStation 5");
  assert.equal(what("Reolink RLC-510A"), "Reolink RLC-510A camera");
  assert.equal(what("Galaxy S24 Ultra"), "Samsung Galaxy S24 Ultra");
  const iphone = list.find((d) => d.name === "Alex's iPhone");
  assert.equal(iphone.confidence, "exact");
  assert.ok(iphone.evidence.some((e) => /Bonjour/.test(e)));
  assert.equal(list.find((d) => d.name === "Galaxy S24 Ultra").confidence, "likely", "a name on the network is a strong clue, not proof");
  assert.equal(list.find((d) => d.name === "Phone, tablet or laptop").what, "Phone, tablet or laptop (uses a private Wi-Fi address)");
});

test("Samsung TV: asks to be allowed once, then takes channels, apps, YouTube, the web and typing", async () => {
  let r = await control({ device: "Family Room TV", action: "set_channel", value: "7" });
  assert.equal(r.ok, false, "nothing works before the TV has allowed Patch");
  assert.match(r.message, /needs to be connected to Patch first\. Press Connect/, "it says how to connect instead of \"it can't\"");
  const tv = await named("Family Room TV");
  assert.equal(tv.setup.kind, "tv-prompt");
  r = await control({ device: "Family Room TV", action: "pair" });
  assert.ok(r.ok, r.message);
  assert.ok(app.store.data.pairings[tv.id].token, "the TV's token is kept for next time");
  r = await control({ device: "family room tv", action: "set_channel", value: "seven point one" });
  assert.ok(r.ok, r.message);
  assert.deepEqual(sim.state.samsung.keys.slice(-4), ["KEY_7", "KEY_PLUS100", "KEY_1", "KEY_ENTER"]);
  r = await control({ device: "Family Room TV", action: "channel_up" });
  assert.equal(sim.state.samsung.keys.at(-1), "KEY_CHUP");
  r = await control({ device: "Family Room TV", action: "launch_app", value: "disney plus" });
  assert.ok(r.ok, r.message);
  assert.equal(sim.state.samsung.launched.at(-1).appId, "3201901017640");
  r = await control({ device: "Family Room TV", action: "web_search", value: "weather tomorrow" });
  assert.deepEqual(sim.state.samsung.launched.at(-1), { appId: "org.tizen.browser", type: "NATIVE_LAUNCH", metaTag: "https://www.google.com/search?q=weather%20tomorrow" });
  r = await control({ device: "Family Room TV", action: "type_text", value: "the bear" });
  assert.equal(sim.state.samsung.texts.at(-1), "the bear");
  r = await control({ device: "Family Room TV", action: "play_youtube", value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  assert.ok(r.ok, r.message);
  assert.deepEqual(sim.state.samsung.launched.at(-1), { appId: "111299001912", type: "DEEP_LINK", metaTag: "v=dQw4w9WgXcQ" });
  // "YouTube" is the TV's YouTube app: a search is handed to the app (the way the TV's own voice search does), not to the TV's web browser.
  r = await control({ device: "Family Room TV", action: "search_youtube", value: "cooking videos" });
  assert.equal(r.message, "Searching for “cooking videos” in the YouTube app on Family Room TV.");
  assert.deepEqual(sim.state.samsung.launched.at(-1), { appId: "111299001912", type: "DEEP_LINK", metaTag: "va=search&launch=voice&launch=search&vq=cooking%20videos" });
  assert.match(r.next, /press_button "ok" plays what the remote is on/, "the assistant is told how to carry on in the app");
  // "Play this" by name, with no YouTube key: the app picks the closest match itself.
  r = await control({ device: "Family Room TV", action: "play_youtube", value: "baby shark" });
  assert.equal(r.message, "Asked the YouTube app on Family Room TV to play “baby shark”. It picks the closest match itself.");
  assert.equal(sim.state.samsung.launched.at(-1).metaTag, "va=play&launch=voice&vq=baby%20shark");
  const connects = sim.state.samsung.connects;
  r = await control({ device: "Family Room TV", action: "turn_off" });
  assert.ok(r.ok);
  assert.equal(sim.state.samsung.power, "standby");
  assert.equal(sim.state.samsung.connects, connects, "commands reuse one connection");
});

test("LG TV: client key, channels by number and by name, inputs, remote buttons, browser", async () => {
  let r = await control({ device: "LG TV", action: "pair" });
  assert.ok(r.ok, r.message);
  const tv = await named("LG TV");
  assert.equal(app.store.data.pairings[tv.id].clientKey, sim.state.lg.clientKey);
  r = await control({ device: "LG TV", action: "set_channel", value: "9-1" });
  assert.ok(r.ok, r.message);
  assert.equal(sim.state.lg.channel.channelName, "PBS Kids");
  r = await control({ device: "LG TV", action: "set_channel", value: "CBS" });
  assert.match(r.message, /CBS \(11-1\)/);
  r = await control({ device: "LG TV", action: "set_volume", value: "22" });
  assert.equal(sim.state.lg.volume, 22);
  r = await control({ device: "LG TV", action: "switch_input", value: "xbox" });
  assert.equal(sim.state.lg.app, "com.webos.app.hdmi1");
  r = await control({ device: "LG TV", action: "press_button", value: "home" });
  assert.deepEqual(sim.state.lg.buttons, ["HOME"]);
  r = await control({ device: "LG TV", action: "play_youtube", value: "youtu.be/dQw4w9WgXcQ" });
  assert.deepEqual(sim.state.lg.launched.at(-1).params, { contentTarget: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  r = await control({ device: "LG TV", action: "open_website", value: "bbc.co.uk" });
  assert.deepEqual(sim.state.lg.opened.at(-1), "https://bbc.co.uk/");
  // Without a YouTube key, a search goes into the TV's own YouTube app, the way LG's voice search hands it one (not the TV's browser).
  const pages = sim.state.lg.opened.length;
  r = await control({ device: "LG TV", action: "search_youtube", value: "pancakes" });
  assert.ok(r.ok, r.message);
  assert.equal(r.message, "Searching for “pancakes” in the YouTube app on LG TV.");
  assert.deepEqual(sim.state.lg.launched.at(-1), { id: "youtube.leanback.v4", contentId: null, params: { contentTarget: "inApp=true&vs=9&va=search&launch=voice&launch=search&vq=pancakes" } });
  assert.equal(sim.state.lg.opened.length, pages, "nothing opened in the TV's browser");
  r = await control({ device: "LG TV", action: "play_youtube", value: "how to make pancakes" });
  assert.equal(r.message, "Asked the YouTube app on LG TV to play “how to make pancakes”. It picks the closest match itself.");
  assert.equal(sim.state.lg.launched.at(-1).params.contentTarget, "inApp=true&vs=9&va=play&launch=voice&vq=how%20to%20make%20pancakes");
});

test("Fire TV over ADB: the allow prompt, then apps, YouTube, browser and typing", async () => {
  let r = await control({ device: "Kids Room Fire TV", action: "launch_app", value: "netflix" });
  assert.equal(r.ok, false);
  r = await control({ device: "Kids Room Fire TV", action: "pair" });
  assert.ok(r.ok, r.message);
  assert.equal(sim.state.firetv.prompts, 1, "the TV asked once");
  assert.ok(app.store.data.adbKey.includes("PRIVATE KEY"), "Patch's ADB key stays on this computer");
  r = await control({ device: "Kids Room Fire TV", action: "launch_app", value: "Disney+" });
  assert.ok(r.ok, r.message);
  assert.match(sim.state.firetv.focus, /^com\.disney\.disneyplus\//);
  // A YouTube search goes to the TV's YouTube app the way the TV's own voice assistant hands it one: on a Fire TV, Alexa's link.
  r = await control({ device: "Kids Room Fire TV", action: "search_youtube", value: "paw patrol" });
  assert.ok(r.ok, r.message);
  assert.equal(r.message, "Searching for “paw patrol” in the YouTube app on Kids Room Fire TV.");
  assert.deepEqual(sim.state.firetv.lastIntent, { action: "android.intent.action.VIEW", data: "youtube://search?query=paw+patrol&isVoice=true", query: null, pkg: "com.amazon.firetv.youtube" });
  // A YouTube app that doesn't take that is asked the next way (Google Assistant's link), and so on down to a plain search.
  sim.state.firetv.ytTakes = ["assistant", "results", "search"];
  await control({ device: "Kids Room Fire TV", action: "search_youtube", value: "bluey" });
  assert.equal(sim.state.firetv.lastIntent.data, "https://www.youtube.com/tv?va=search&launch=voice&launch=search&vq=bluey");
  sim.state.firetv.ytTakes = ["results", "search"];
  await control({ device: "Kids Room Fire TV", action: "search_youtube", value: "bluey" });
  assert.equal(sim.state.firetv.lastIntent.data, "https://www.youtube.com/results?search_query=bluey");
  sim.state.firetv.ytTakes = ["search"];
  await control({ device: "Kids Room Fire TV", action: "search_youtube", value: "bluey" });
  assert.deepEqual(sim.state.firetv.lastIntent, { action: "android.intent.action.SEARCH", data: null, query: "bluey", pkg: "com.amazon.firetv.youtube" });
  sim.state.firetv.ytTakes = ["alexa", "assistant", "results", "search"];
  // "Play this" by name, with no YouTube key: the app picks the closest match, and Patch says what started (the TV tells it).
  r = await control({ device: "Kids Room Fire TV", action: "play_youtube", value: "baby shark" });
  assert.equal(r.message, "Asked the YouTube app on Kids Room Fire TV to play “baby shark”. It's playing “Baby shark (Official Video)”.");
  assert.equal(sim.state.firetv.lastIntent.data, "youtube://search?query=baby+shark&isVoice=true&method=play");
  sim.state.firetv.playing = null;
  r = await control({ device: "Kids Room Fire TV", action: "play_youtube", value: "dQw4w9WgXcQ" });
  assert.equal(sim.state.firetv.lastIntent.data, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  r = await control({ device: "Kids Room Fire TV", action: "type_text", value: "it's bluey" });
  assert.equal(sim.state.firetv.lastText, "it's bluey");
  // The web: the first time, Patch puts its own browser on the TV (the one it can see into) and opens the page in it.
  r = await control({ device: "Kids Room Fire TV", action: "web_search", value: "how tall is everest" });
  assert.ok(r.ok, r.message);
  assert.equal(Object.values(sim.state.firetv.installed).find((a) => a.kind === "browser")?.label, "Patch Browser");
  assert.match(sim.state.firetv.focus, /^app\.patch\.tvapp\./, "Patch's browser is in front");
  assert.equal(sim.state.firetv.browser.state.url, "https://www.google.com/search?q=how%20tall%20is%20everest");
  assert.match(r.screen, /Heading: Results for “how tall is everest”/, "and Patch says what the page shows");
  assert.ok(sim.state.firetv.commands.every((c) => !/;|&&|\|\|/.test(c.replace(/'[^']*'/g, "")) || /^(echo|monkey|dumpsys|pidof) /.test(c)), "spoken text never becomes shell syntax");
  r = await control({ device: "Kids Room Fire TV", action: "turn_off" });
  assert.equal(sim.state.firetv.awake, false);
  // A new connection uses the remembered key: no second prompt.
  r = await control({ device: "Kids Room Fire TV", action: "turn_on" });
  assert.equal(sim.state.firetv.prompts, 1);
});

test("Roku: live TV channels, Roku 'channels' (apps), typing and YouTube by link", async () => {
  let r = await control({ device: "Living Room TV", action: "set_channel", value: "5.1" });
  assert.ok(r.ok, r.message);
  r = await control({ device: "Living Room TV", action: "set_channel", value: "Hulu" });
  assert.match(r.message, /Opening Hulu/);
  r = await control({ device: "Living Room TV", action: "type_text", value: "ok" });
  assert.deepEqual(sim.state.roku.keys.slice(-2), ["Lit_o", "Lit_k"]);
  r = await control({ device: "Living Room TV", action: "play_youtube", value: "https://youtu.be/dQw4w9WgXcQ" });
  assert.ok(r.ok, r.message);
  // Without a YouTube key, the Roku's YouTube app is asked by name: it picks the closest match itself.
  r = await control({ device: "Living Room TV", action: "play_youtube", value: "never gonna give you up" });
  assert.equal(r.message, "Asked the YouTube app on Living Room TV to play “never gonna give you up”. It picks the closest match itself.");
  assert.deepEqual(sim.state.roku.launches.at(-1), { id: "837", params: { va: "play", launch: "voice", vq: "never gonna give you up" }, query: "va=play&launch=voice&vq=never%20gonna%20give%20you%20up" });
  r = await control({ device: "Living Room TV", action: "search_youtube", value: "trains" });
  assert.equal(r.message, "Searching for “trains” in the YouTube app on Living Room TV.");
  assert.equal(sim.state.roku.launches.at(-1).query, "va=search&launch=voice&launch=search&vq=trains");
});

test("with a YouTube key: results to choose from, then 'play the second one'", async () => {
  r0: {
    const r = await api("POST", "/api/settings", { youtubeApiKey: "wrong-key" });
    assert.equal(r.checks.youtube.ok, false);
    assert.equal(app.store.data.youtube.apiKey, "", "a key YouTube rejects isn't saved");
  }
  let r = await api("POST", "/api/settings", { youtubeApiKey: sim.youtubeKey });
  assert.equal(r.checks.youtube.ok, true, r.checks.youtube.message);
  r = await control({ device: "Living Room TV", action: "search_youtube", value: "lofi beats" });
  assert.ok(r.ok, r.message);
  assert.equal(r.results.length, 2);
  assert.match(r.message, /^Searching for “lofi beats” in the YouTube app on Living Room TV\. The top results are: /, "the app shows them, and Patch can read them out");
  r = await control({ device: "Living Room TV", action: "play_youtube", value: "the second one" });
  assert.ok(r.ok, r.message);
  assert.match(r.message, /Lo-fi Beats for Focus & Study/, "titles come back with their HTML entities decoded");
  r = await control({ device: "Living Room TV", action: "play_youtube", value: "despacito" });
  assert.match(r.message, /Despacito/);
});

test("this computer: searches and websites open in its browser", async () => {
  let r = await control({ device: "this computer", action: "web_search", value: "best pizza near me" });
  assert.ok(r.ok, r.message);
  r = await control({ device: "my browser", action: "open_website", value: "weather dot com" });
  assert.ok(r.ok, r.message);
  r = await control({ device: "this computer", action: "play_youtube", value: "gangnam style" });
  assert.match(r.message, /GANGNAM STYLE/);
  assert.deepEqual(opened, ["https://www.google.com/search?q=best%20pizza%20near%20me", "https://weather.com/", "https://www.youtube.com/watch?v=9bZkp7q19f0"]);
  r = await control({ device: "this computer", action: "open_website", value: "javascript:alert(1)" });
  assert.equal(opened.at(-1), "https://www.google.com/search?q=javascript%3Aalert(1)", "anything that isn't a web address becomes a search, never a script");
});

test("Chromecast opens YouTube; spoken TV commands find the right TV", async () => {
  let r = await control({ device: "Bedroom TV", action: "launch_app", value: "youtube" });
  assert.ok(r.ok, r.message);
  assert.deepEqual(sim.state.cast.launched, ["233637DE"]);
  r = await control({ device: "samsung", action: "channel_down" });
  assert.ok(r.ok, r.message);
  assert.equal(sim.state.samsung.keys.at(-1), "KEY_CHDOWN");
  r = await control({ device: "the fire tv", action: "press_button", value: "home" });
  assert.ok(r.ok, r.message);
});

test("Fire TV apps: what's on it, adding from its store or a file, seeing and using its screen, removing", async () => {
  const tv = "Kids Room Fire TV";
  let r = await control({ device: tv, action: "list_apps" });
  assert.ok(r.ok, r.message);
  assert.ok(r.apps.some((a) => a.name === "Netflix"), r.message);
  assert.ok(!r.apps.some((a) => /launcher/.test(a.id)), "the home screen itself isn't an app");

  // From the Appstore: Patch opens Plex's page and chooses Get (it's free).
  r = await control({ device: tv, action: "install_app", value: "Plex" });
  assert.ok(r.ok, r.message);
  assert.match(r.message, /Plex is installed on Kids Room Fire TV/);
  assert.equal(sim.state.firetv.store.pkg, "com.plexapp.android");
  assert.ok(sim.state.firetv.packages.includes("com.plexapp.android"));
  r = await control({ device: tv, action: "install_app", value: "plex" });
  assert.match(r.message, /already on/);

  // An app file sent from the phone: Patch asks first, installs it, remembers its name and tidies up.
  const up = await upload(fakeThirdPartyApk({ pkg: "org.example.coolapp", name: "My Cool App" }), "cool-app.apk");
  assert.ok(up?.id);
  r = await control({ device: tv, action: "install_app", value: `upload:${up.id}` });
  assert.equal(r.needsConfirmation, true, "an app from outside the store needs a yes");
  assert.match(r.message, /doesn't come from Kids Room Fire TV's app store/);
  r = await control({ device: tv, action: "install_app", value: `upload:${up.id}`, confirmToken: r.confirmToken });
  assert.ok(r.ok, r.message);
  assert.match(r.message, /My Cool App is installed/);
  assert.equal(sim.state.firetv.installed["org.example.coolapp"].versionCode, 21);
  assert.deepEqual(Object.keys(sim.state.firetv.files), [], "the copy on the TV was deleted");
  r = await control({ device: tv, action: "list_apps" });
  assert.ok(r.apps.some((a) => a.name === "My Cool App"), "it's listed by its own name");
  const junk = await upload(Buffer.from("not an app at all"), "notes.apk");
  r = await control({ device: tv, action: "install_app", value: `upload:${junk.id}` });
  r = await control({ device: tv, action: "install_app", value: `upload:${junk.id}`, confirmToken: r.confirmToken });
  assert.equal(r.ok, false);
  assert.match(r.message, /isn't an Android app file/);

  // The TV's screen: what's on it, where the remote is, and choosing things.
  await control({ device: tv, action: "press_button", value: "home" });
  r = await control({ device: tv, action: "read_screen" });
  assert.ok(r.ok, r.message);
  assert.match(r.screen, /^On screen: Home screen\./);
  assert.match(r.screen, /Item: YouTube \(selected\)/, "it says where the remote is");
  assert.match(r.screen, /My Cool App/);
  const taps = sim.state.firetv.taps.length;
  r = await control({ device: tv, action: "tap", value: "Netflix" });
  assert.ok(r.ok, r.message);
  assert.equal(sim.state.firetv.taps.length, taps + 1);
  r = await control({ device: tv, action: "tap", value: "2" });
  assert.equal(r.ok, false, "numbers need a fresh look at the screen");
  r = await control({ device: tv, action: "read_screen" });
  r = await control({ device: tv, action: "tap", value: "the second one" });
  assert.ok(r.ok, r.message);
  await control({ device: tv, action: "launch_app", value: "Netflix" });
  r = await control({ device: tv, action: "read_screen" });
  assert.match(r.message, /draws its own picture/, "apps like Netflix can't be read, and Patch says so");

  // Searching inside an app.
  r = await control({ device: tv, action: "search", value: "bluey in youtube" });
  assert.ok(r.ok, r.message);
  assert.deepEqual(sim.state.firetv.lastIntent, { action: "android.intent.action.SEARCH", data: null, query: "bluey", pkg: "com.amazon.firetv.youtube" });

  // Removing: a yes first; apps that came with the TV can't be removed.
  r = await control({ device: tv, action: "uninstall_app", value: "My Cool App" });
  assert.equal(r.needsConfirmation, true);
  r = await control({ device: tv, action: "uninstall_app", value: "My Cool App", confirmToken: r.confirmToken });
  assert.ok(r.ok, r.message);
  assert.ok(!sim.state.firetv.packages.includes("org.example.coolapp"));
  r = await control({ device: tv, action: "uninstall_app", value: "Silk" });
  r = await control({ device: tv, action: "uninstall_app", value: "Silk", confirmToken: r.confirmToken });
  assert.equal(r.ok, false);
  assert.match(r.message, /came with Kids Room Fire TV/);
});

test("Samsung, LG and Roku: their apps, and adding one from their store", async () => {
  let r = await control({ device: "Family Room TV", action: "list_apps" });
  assert.ok(r.ok, r.message);
  assert.ok(r.apps.some((a) => a.name === "Netflix"));
  r = await control({ device: "Family Room TV", action: "install_app", value: "Spotify" });
  assert.ok(r.ok, r.message);
  assert.equal(sim.state.samsung.installing, "3201606009684");
  r = await control({ device: "Family Room TV", action: "install_app", value: "netflix" });
  assert.match(r.message, /already on/);
  r = await control({ device: "Family Room TV", action: "install_app", value: "Grandpa's Garden Planner" });
  assert.equal(r.ok, false);
  assert.match(r.message, /open Apps, search for/);

  r = await control({ device: "LG TV", action: "list_apps" });
  assert.ok(r.apps.some((a) => a.name === "Spotify"));
  r = await control({ device: "LG TV", action: "install_app", value: "Plex" });
  assert.ok(r.ok, r.message);
  assert.deepEqual(sim.state.lg.launched.at(-1), { id: "com.webos.app.discovery", contentId: null, params: { query: "Plex" } });

  r = await control({ device: "Living Room TV", action: "list_apps" });
  assert.match(r.message, /channels: Netflix, YouTube/);
  r = await control({ device: "Living Room TV", action: "install_app", value: "Tubi" });
  assert.ok(r.ok, r.message);
  assert.deepEqual(sim.state.roku.storePages, ["41468"]);
  r = await control({ device: "Living Room TV", action: "install_app", value: "Some Rare Channel" });
  assert.equal(sim.state.roku.searches.at(-1), "Some Rare Channel");
});

test("TV app maker: every kind of app, previews, installing on Fire TV and opening on Samsung", async () => {
  const make = (b) => api("POST", "/api/tvapps", b);
  // A video channel: YouTube links get their titles, kept as plain text.
  let r = await make({ name: "Rick's channel", kind: "videos", content: "https://youtu.be/dQw4w9WgXcQ\nhttps://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG\nsomething without a link" });
  assert.ok(r.ok, r.message);
  const videos = r.app;
  assert.equal(videos.settings.items[0].title, "Never Gonna Give You Up <script>alert(1)</script>");
  assert.equal(videos.settings.items[1].type, "playlist");
  assert.match(r.message, /I need a link for this one/);
  // Clock and weather: the town is found, and in the US it's Fahrenheit and 12-hour.
  r = await make({ name: "Kitchen clock", kind: "clock", content: "Portland" });
  assert.ok(r.ok, r.message);
  assert.deepEqual([r.app.settings.place, r.app.settings.units, r.app.settings.hours, r.app.settings.lat], ["Portland, Oregon, United States", "F", 12, 45.523]);
  r = await make({ name: "Nowhere clock", kind: "clock", content: "Nowheresville" });
  assert.match(r.message, /couldn't find a place/);
  // Radio by station name.
  r = await make({ name: "Radio", kind: "radio", content: "KEXP, Imaginary FM" });
  assert.equal(r.app.settings.stations[0].name, "KEXP 90.3 FM");
  assert.match(r.message, /couldn't find Imaginary FM/);
  // A quiz, a countdown, notes, a website; bad ones explain what's needed.
  r = await make({ name: "90s quiz", kind: "quiz", content: "Who sang Wannabe? | Spice Girls | Oasis | Blur\nWhat year did the Euro start? | 1999 | 1995 | 2002" });
  assert.equal(r.app.settings.questions.length, 2);
  r = await make({ name: "Bad quiz", kind: "quiz", content: "no answers here" });
  assert.equal(r.ok, false);
  assert.match(r.message, /question \| right answer/);
  r = await make({ name: "Holiday", kind: "countdown", content: "Our holiday | 2099-07-14" });
  assert.equal(r.app.settings.date, "2099-07-14T00:00:00");
  r = await make({ name: "Family notes", kind: "notes", content: "Dinner at 7\nBins out on Tuesday" });
  assert.deepEqual(r.app.settings.notes, ["Dinner at 7", "Bins out on Tuesday"]);
  r = await make({ name: "News", kind: "website", content: "bbc.co.uk" });
  assert.equal(r.app.settings.url, "https://bbc.co.uk/");
  r = await make({ name: "Mystery", kind: "hologram" });
  assert.equal(r.ok, false);

  // A photo frame with photos from the phone (only real pictures are kept).
  r = await make({ name: "Family Photos", kind: "photos", content: "every 12 seconds, shuffle", emoji: "📷", color: "#ff7a59" });
  const photos = r.app;
  assert.deepEqual([photos.settings.interval, photos.settings.shuffle], [12, true]);
  const png = encodePng(4, 4, Buffer.alloc(64, 200));
  const a1 = await upload(png, "beach.png");
  const a2 = await upload(Buffer.from("not a picture"), "x.jpg");
  r = await api("POST", `/api/tvapps/${photos.id}/photos`, { files: [{ upload: a1.id, caption: "At the beach" }, { upload: a2.id }] });
  assert.ok(r.ok, r.message);
  assert.equal(r.app.photos.length, 1);
  assert.equal(r.app.version, 2);

  // The preview the dashboard shows: sandboxed elsewhere, but served here with its own token.
  const boot = await (await fetch(`${base}/`)).text();
  const preview = JSON.parse(boot.match(/<script id="boot" type="application\/json">(.*?)<\/script>/)[1]).tvPreview;
  assert.ok(preview, "the dashboard is given a preview token");
  let page = await fetch(`${base}/tvapp-preview/${preview}/${videos.id}/index.html`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(!html.includes("<script>alert(1)"), "a video's title can't add a script to the page");
  assert.match(html, /\\u003cscript>alert/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'self'/);
  assert.equal((await fetch(`${base}/tvapp-preview/wrong-token/${videos.id}/index.html`)).status, 404);
  assert.equal((await fetch(`${base}/tvapp-preview/${preview}/${photos.id}/photos/${r.app.photos[0].name}`)).status, 200);

  // Put the photo frame on the Fire TV: a real app with its own id, name and signature, opened at once.
  r = await api("POST", `/api/tvapps/${photos.id}/tv`, { device: "Kids Room Fire TV" });
  assert.ok(r.ok, r.message);
  assert.match(r.message, /Family Photos is on Kids Room Fire TV now/);
  const pkg = `app.patch.tvapp.${photos.id}`;
  assert.equal(sim.state.firetv.installed[pkg].label, "Family Photos");
  assert.match(sim.state.firetv.focus, new RegExp(`^${pkg.replace(/\./g, "\\.")}/`));
  assert.ok(r.app.tvs.some((t) => t.name === "Kids Room Fire TV" && t.upToDate));
  // A change makes a new version that installs over the old one.
  r = await api("POST", `/api/tvapps/${photos.id}`, { name: "Family Photos", content: "every 20 seconds" });
  assert.equal(r.app.tvs[0].upToDate, false);
  r = await api("POST", `/api/tvapps/${photos.id}/open`, { device: "Kids Room Fire TV" });
  assert.ok(r.ok, r.message);
  assert.equal(sim.state.firetv.installed[pkg].versionCode, 3);
  // It's in the TV's apps list by name, and opens by name.
  r = await control({ device: "Kids Room Fire TV", action: "list_apps" });
  assert.ok(r.apps.some((a) => a.name === "Family Photos" && a.madeWithPatch));
  r = await control({ device: "Kids Room Fire TV", action: "launch_app", value: "family photos" });
  assert.ok(r.ok, r.message);
  // What was built: signed, with the photos and the page inside.
  const built = (await app.tvapps.apk(photos.id)).apk;
  assert.ok(verifyV2(built).ok);
  assert.equal(apkInfo(built).package, pkg);
  const names = readZip(built).entries.map((e) => e.name);
  assert.ok(names.includes("assets/app/index.html") && names.includes("assets/app/tvkit.js") && names.some((n) => /^assets\/app\/photos\//.test(n)));
  const appJson = JSON.parse(entryData(readZip(built).entries.find((e) => e.name === "assets/app/app.json")));
  assert.deepEqual([appJson.kind, appJson.name], ["photos", "Family Photos"]);

  // On a Samsung TV it opens in the TV's browser, served by Patch over the WiFi.
  const clock = (await api("GET", "/api/tvapps")).apps.find((a) => a.name === "Kitchen clock");
  r = await api("POST", `/api/tvapps/${clock.id}/tv`, { device: "Family Room TV" });
  assert.ok(r.ok, r.message);
  assert.match(r.message, /open in Family Room TV's web browser/);
  const url = sim.state.samsung.launched.at(-1).metaTag;
  assert.match(url, new RegExp(`^http://127\\.0\\.12\\.100:\\d+/[\\w-]+/${clock.id}/$`));
  page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /"kind":"clock"/);
  assert.equal((await fetch(url.replace(/\/[\w-]+\/(a[0-9a-f]+)\/$/, "/guess/$1/"))).status, 404, "the address has a secret in it");
  // Shortcuts only make sense on Android TVs.
  r = await make({ name: "Grandma's TV", kind: "shortcuts", content: "Netflix, YouTube, BBC iPlayer" });
  r = await api("POST", `/api/tvapps/${r.app.id}/tv`, { device: "Family Room TV" });
  assert.equal(r.ok, false);
  assert.match(r.message, /only work on Android TV/);

  // Deleting an app removes it from the Fire TV too.
  r = await api("POST", `/api/tvapps/${photos.id}/remove`, {});
  assert.ok(r.ok, r.message);
  assert.match(r.message, /Kids Room Fire TV: removed/);
  assert.ok(!sim.state.firetv.packages.includes(pkg));
});

test("the remote: any button, several in a row, a count, or one held down, on each kind of TV", async () => {
  // Samsung: its own key names, in order. A held button is a press, a wait and a release.
  let from = sim.state.samsung.keys.length;
  let r = await control({ device: "Family Room TV", action: "press_button", value: "home, down 2, right, OK" });
  assert.ok(r.ok, r.message);
  assert.equal(r.message, "Pressed Home, then down twice, then right, then OK on Family Room TV.");
  assert.deepEqual(sim.state.samsung.keys.slice(from), ["KEY_HOME", "KEY_DOWN", "KEY_DOWN", "KEY_RIGHT", "KEY_ENTER"]);
  from = sim.state.samsung.keys.length;
  r = await control({ device: "Family Room TV", action: "press_button", value: "hold back" });
  assert.equal(r.message, "Held Back on Family Room TV.");
  assert.deepEqual(sim.state.samsung.keys.slice(from), ["Press KEY_RETURN", "Release KEY_RETURN"]);
  from = sim.state.samsung.keys.length;
  r = await control({ device: "Family Room TV", action: "press_button", value: "7, 1" });
  assert.deepEqual(sim.state.samsung.keys.slice(from), ["KEY_7", "KEY_1"]);
  // Not a button; a button this remote doesn't have; far too many presses. Nothing is sent for any of them.
  from = sim.state.samsung.keys.length;
  r = await control({ device: "Family Room TV", action: "press_button", value: "wiggle" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "EVALUE");
  assert.match(r.message, /I don't know the button “wiggle”/);
  r = await control({ device: "Family Room TV", action: "press_button", value: "next" });
  assert.equal(r.error, "EUNSUPPORTED");
  assert.equal(r.message, "Family Room TV doesn't have a Next button that I can press.");
  r = await control({ device: "Family Room TV", action: "press_button", value: "down 50" });
  assert.match(r.message, /That's 50 presses, more than I'll do in one go/);
  assert.equal(sim.state.samsung.keys.length, from);

  // LG: presses only.
  from = sim.state.lg.buttons.length;
  r = await control({ device: "LG TV", action: "press_button", value: "back twice then menu" });
  assert.equal(r.message, "Pressed Back twice, then Menu on LG TV.");
  assert.deepEqual(sim.state.lg.buttons.slice(from), ["BACK", "BACK", "MENU"]);
  r = await control({ device: "LG TV", action: "press_button", value: "hold ok" });
  assert.equal(r.message, "Pressed OK on LG TV. (This TV doesn't take a held button from Patch, so I pressed it once.)");
  assert.equal(sim.state.lg.buttons.at(-1), "ENTER");

  // Roku: its own names; number buttons; a held button is a key down and a key up.
  from = sim.state.roku.keys.length;
  r = await control({ device: "Living Room TV", action: "press_button", value: "rewind 3, play, hold home, 5" });
  assert.equal(r.message, "Pressed Rewind three times, then Play, then held Home, then 5 on Living Room TV.");
  assert.deepEqual(sim.state.roku.keys.slice(from), ["Rev", "Rev", "Rev", "Play", "down Home", "up Home", "Lit_5"]);

  // Fire TV and Android TV: a run of buttons goes as one command, and whoever asked by voice or in
  // the chat is told where the remote is now, with what's on screen.
  const tv = "Kids Room Fire TV";
  await control({ device: tv, action: "press_button", value: "home" });
  const home = (await control({ device: tv, action: "read_screen" })).screen;
  // The apps on its home screen, in rows of eight under the word "Home"; the remote starts on the first.
  const names = [...home.matchAll(/^\d+\. [^:]+: (.+?)(?: \((?:[^)]*)\))?$/gm)].map((m) => m[1]).filter((n) => n !== "Home");
  assert.ok(names.length >= 4, home);
  assert.match(home, new RegExp(`^\\d+\\. [^:]+: ${names[0]} \\(selected\\)$`, "m"));
  from = sim.state.firetv.keys.length;
  const sent = sim.state.firetv.commands.length;
  r = await control({ device: tv, action: "press_button", value: "right 3, left" });
  assert.ok(r.ok, r.message);
  assert.deepEqual(sim.state.firetv.keys.slice(from), ["KEYCODE_DPAD_RIGHT", "KEYCODE_DPAD_RIGHT", "KEYCODE_DPAD_RIGHT", "KEYCODE_DPAD_LEFT"]);
  assert.ok(sim.state.firetv.commands.slice(sent).includes("input keyevent KEYCODE_DPAD_RIGHT KEYCODE_DPAD_RIGHT KEYCODE_DPAD_RIGHT KEYCODE_DPAD_LEFT"), "one command for the four presses");
  assert.equal(r.message, `Pressed right three times, then left on Kids Room Fire TV. The remote is on “${names[2]}” now.`);
  assert.match(r.screen, new RegExp(`^\\d+\\. [^:]+: ${names[2]} \\(selected\\)$`, "m"));
  assert.equal((r.screen.match(/\(selected\)/g) || []).length, 1);
  // OK opens what the remote is on.
  r = await control({ device: tv, action: "press_button", value: "ok" });
  assert.ok(r.ok, r.message);
  assert.match(r.message, /^Pressed OK on Kids Room Fire TV\./);
  assert.doesNotMatch(sim.state.firetv.focus, /launcher/);
  // A held button.
  from = sim.state.firetv.keys.length;
  r = await control({ device: tv, action: "press_button", value: "hold home" });
  assert.match(r.message, /^Held Home on Kids Room Fire TV\./);
  assert.deepEqual(sim.state.firetv.keys.slice(from), ["hold KEYCODE_HOME"]);
  // A button this TV's Android won't press: said plainly, never "Pressed". The ones before it in a run did go.
  sim.state.firetv.refuseKey = "KEYCODE_GUIDE";
  from = sim.state.firetv.keys.length;
  r = await control({ device: tv, action: "press_button", value: "guide" });
  assert.equal(r.ok, false);
  assert.equal(r.error, "EUNSUPPORTED");
  assert.equal(r.message, "Kids Room Fire TV wouldn't take that button. Its remote may not have it.");
  r = await control({ device: tv, action: "press_button", value: "down, guide, ok" });
  assert.equal(r.message, "Kids Room Fire TV wouldn't take those buttons. Its remote may not have one of them.");
  assert.deepEqual(sim.state.firetv.keys.slice(from), ["KEYCODE_DPAD_DOWN"]);
  // A TV whose maker keeps button presses from ADB until one more switch is on.
  sim.state.firetv.refuseKey = "all";
  r = await control({ device: tv, action: "press_button", value: "down" });
  assert.equal(r.error, "EREFUSED");
  assert.match(r.message, /^Kids Room Fire TV won't let Patch press its buttons\. If its Developer options have “USB debugging \(Security settings\)”/);
  sim.state.firetv.refuseKey = null;
  // The remote in Patch's own window isn't made to wait for the screen to be read after every press.
  await control({ device: tv, action: "press_button", value: "home" });
  const d = await named(tv);
  r = await api("POST", `/api/devices/${encodeURIComponent(d.id)}/action`, { action: "press_button", value: "down" });
  assert.equal(r.message, "Pressed down on Kids Room Fire TV.");
  assert.equal(r.screen, undefined);
});

test("“YouTube” with no TV named means the YouTube app on the TV, at once", async () => {
  // One TV is the one "the TV" means: the one used last.
  await control({ device: "LG TV", action: "press_button", value: "info" });
  let list = await devices();
  assert.deepEqual(list.filter((d) => d.defaultTv).map((d) => d.name), ["LG TV"]);
  // No device, "the TV", "tv": no "which one do you mean?", it goes to that TV's YouTube app.
  let from = sim.state.lg.launched.length;
  let r = await control({ action: "launch_app", value: "YouTube" });
  assert.ok(r.ok, r.message);
  assert.match(r.message, /YouTube on LG TV/);
  r = await control({ device: "the TV", action: "search_youtube", value: "cat videos" });
  assert.match(r.message, /^Searching for “cat videos” in the YouTube app on LG TV\./);
  r = await control({ device: "tv", action: "play_youtube", value: "https://youtu.be/dQw4w9WgXcQ" });
  assert.match(r.message, /on LG TV\.$/);
  assert.equal(sim.state.lg.launched.length, from + 3);
  // A TV they name still wins, and is then the one used last.
  r = await control({ device: "Family Room TV", action: "launch_app", value: "YouTube" });
  assert.ok(r.ok, r.message);
  r = await control({ action: "search_youtube", value: "dinosaurs" });
  assert.match(r.message, /in the YouTube app on Family Room TV\./);
  list = await devices();
  assert.deepEqual(list.filter((d) => d.defaultTv).map((d) => d.name), ["Family Room TV"]);
  // "On my computer" is still this computer, and other things still ask which TV when it isn't clear.
  r = await control({ device: "this computer", action: "search_youtube", value: "dinosaurs" });
  assert.doesNotMatch(r.message, /Family Room TV/);
  r = await control({ device: "the TV", action: "volume_up" });
  assert.equal(r.error, "EAMBIGUOUS", r.message);
});
