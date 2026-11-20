// End to end: knowing exactly what each device is, and running TVs by name. Pairing on Samsung, LG
// and Fire TV, channels, apps, YouTube search and play, web search and typing, against simulated
// TVs that speak the real protocols.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSimulator } from "../sim/simulator.mjs";
import { startApp } from "../src/app.mjs";

let sim;
let app;
let base;
const opened = [];
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-tv-test-"));

const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};
const control = (b) => api("POST", "/api/control", b);
const devices = async () => (await api("GET", "/api/devices")).devices;
const named = async (n) => (await devices()).find((d) => d.name === n);

before(async () => {
  sim = await startSimulator({ prefix: "127.0.12" });
  app = await startApp({ port: 0, demo: true, dataDir, overrides: { ...sim.overrides, openUrl: async (u) => opened.push(u) }, autoScan: false, log: () => {} });
  base = `http://localhost:${app.port}`;
  await api("POST", "/api/scan");
});

after(async () => {
  await app?.close();
  await sim?.stop();
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
  // Without a YouTube key, a search opens YouTube's results in the TV's browser.
  r = await control({ device: "LG TV", action: "search_youtube", value: "pancakes" });
  assert.ok(r.ok, r.message);
  assert.equal(sim.state.lg.opened.at(-1), "https://www.youtube.com/results?search_query=pancakes");
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
  r = await control({ device: "Kids Room Fire TV", action: "search_youtube", value: "paw patrol" });
  assert.ok(r.ok, r.message);
  assert.deepEqual(sim.state.firetv.lastIntent, { action: "android.intent.action.SEARCH", data: null, query: "paw patrol", pkg: "com.amazon.firetv.youtube" });
  r = await control({ device: "Kids Room Fire TV", action: "play_youtube", value: "dQw4w9WgXcQ" });
  assert.equal(sim.state.firetv.lastIntent.data, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  r = await control({ device: "Kids Room Fire TV", action: "web_search", value: "how tall is everest" });
  assert.equal(sim.state.firetv.lastIntent.pkg, "com.amazon.cloud9", "web pages open in the Fire TV's browser");
  r = await control({ device: "Kids Room Fire TV", action: "type_text", value: "it's bluey" });
  assert.equal(sim.state.firetv.lastText, "it's bluey");
  assert.ok(sim.state.firetv.commands.every((c) => !/;|&&|\|\|/.test(c.replace(/'[^']*'/g, "")) || c.startsWith("echo") || c.startsWith("monkey") || c.startsWith("dumpsys")), "spoken text never becomes shell syntax");
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
  r = await control({ device: "Living Room TV", action: "play_youtube", value: "never gonna give you up" });
  assert.equal(r.ok, false, "without a YouTube key a phrase can't be turned into a video on a Roku");
  assert.match(r.message, /YouTube API key/);
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
  assert.match(r.message, /Which one should I play/);
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
