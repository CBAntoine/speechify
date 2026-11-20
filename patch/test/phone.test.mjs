// The Android app: Patch's own server running inside a phone. Android hides the network details from
// ordinary programs, so the app passes them in; pages and videos for "this phone" open through the
// Patch screen, which hands them to Android (the browser or the YouTube app).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { networkFromEnv, phoneIdentity } from "../src/platform.mjs";
import { homeNetwork } from "../src/net/interfaces.mjs";
import { selfDevice } from "../src/scanner.mjs";
import { Inventory } from "../src/inventory.mjs";
import { startSimulator } from "../sim/simulator.mjs";
import { startApp } from "../src/app.mjs";

const PHONE_ENV = {
  PATCH_PLATFORM: "android",
  PATCH_DEVICE_NAME: "Galaxy S24 Ultra",
  PATCH_DEVICE_BRAND: "samsung",
  PATCH_DEVICE_MODEL: "SM-S928B",
  PATCH_ANDROID_VERSION: "15",
};

let sim;
let app;
let base;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-phone-test-"));

const api = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
};

/** Opens the dashboard's live event stream, like the Patch screen does. */
function listen() {
  const queue = [];
  const waiting = [];
  let buf = "";
  const req = http.get(`${base}/api/events?token=${encodeURIComponent(app.token)}`, (res) => {
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const type = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (!type || data == null) continue;
        const ev = { type, data: JSON.parse(data) };
        const w = waiting.findIndex((x) => x.type === type);
        if (w >= 0) waiting.splice(w, 1)[0].resolve(ev.data);
        else queue.push(ev);
      }
    });
  });
  req.on("error", () => {});
  return {
    ready: () => new Promise((resolve) => req.once("response", resolve)),
    next(type, timeout = 3000) {
      const i = queue.findIndex((e) => e.type === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0].data);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`no ${type} event`)), timeout);
        waiting.push({ type, resolve: (d) => (clearTimeout(t), resolve(d)) });
      });
    },
    close: () => req.destroy(),
  };
}

test("reads the Wi-Fi, router and DNS servers the Android app passes in, and ignores anything odd", () => {
  assert.deepEqual(networkFromEnv({ PATCH_WIFI: "192.168.1.23/24", PATCH_GATEWAY: "192.168.1.1", PATCH_DNS: "192.168.1.1, 8.8.8.8 ,fe80::1" }), {
    wifi: { address: "192.168.1.23", prefix: 24, cidr: "192.168.1.0/24" },
    gateway: "192.168.1.1",
    dns: ["192.168.1.1", "8.8.8.8"],
  });
  assert.equal(networkFromEnv({ PATCH_WIFI: "8.8.8.8/24" }).wifi, null, "only private home addresses");
  assert.equal(networkFromEnv({ PATCH_WIFI: "192.168.1.23/31" }).wifi, null);
  assert.equal(networkFromEnv({ PATCH_WIFI: "192.168.1.300/24" }).wifi, null);
  assert.equal(networkFromEnv({}).wifi, null);
  assert.equal(networkFromEnv({ PATCH_GATEWAY: "router.lan" }).gateway, null);
});

test("on a phone, the Wi-Fi from the app wins over mobile data and guesses", async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { PATCH_WIFI: "10.0.0.57/22", PATCH_GATEWAY: "10.0.0.1", PATCH_DNS: "10.0.0.1" });
    const net = await homeNetwork();
    assert.equal(net.address, "10.0.0.57");
    assert.equal(net.cidr, "10.0.0.0/22");
    assert.equal(net.gateway, "10.0.0.1");
    assert.deepEqual(net.dns, ["10.0.0.1"]);
    assert.equal(net.broadcast, "10.0.3.255");
  } finally {
    for (const k of ["PATCH_WIFI", "PATCH_GATEWAY", "PATCH_DNS"]) if (!(k in saved)) delete process.env[k];
  }
});

test("the phone running Patch is “this phone”, with its own name and model", () => {
  const me = selfDevice({ address: "192.168.1.23" }, { phone: true, identity: phoneIdentity(PHONE_ENV) });
  assert.equal(me.kind, "phone");
  assert.equal(me.name, "Galaxy S24 Ultra");
  assert.equal(me.brand, "Samsung");
  assert.equal(me.info.what, "Samsung SM-S928B running Patch (Android 15)");
  assert.equal(selfDevice({ address: "192.168.1.23" }, { phone: true, identity: phoneIdentity({ PATCH_DEVICE_BRAND: "Google", PATCH_DEVICE_MODEL: "Pixel 8" }) }).name, "Google Pixel 8");

  const store = { savedDevices: [], data: { meta: {}, credentials: {}, history: {} }, saveDevices() {}, save() {} };
  const inv = new Inventory(store);
  inv.upsert(me);
  inv.upsert({ id: "host:alex", name: "Alex's iPhone", kind: "phone", driver: "generic", actions: [] });
  for (const said of ["this phone", "my phone", "here", "on here", "my browser"]) assert.equal(inv.resolve(said).device?.id, "self:computer", said);
  assert.equal(inv.resolve("Alex's iPhone").device?.id, "host:alex");

  // On a computer, "my phone" is some other device, never the computer.
  const inv2 = new Inventory({ ...store, data: { meta: {}, credentials: {}, history: {} } });
  inv2.upsert(selfDevice({ address: "192.168.1.23" }, { phone: false }));
  assert.notEqual(inv2.resolve("my phone").device?.id, "self:computer");
  assert.equal(inv2.resolve("this computer").device?.id, "self:computer");
});

before(async () => {
  Object.assign(process.env, PHONE_ENV);
  sim = await startSimulator({ prefix: "127.0.13" });
  app = await startApp({ port: 0, demo: true, dataDir, overrides: sim.overrides, autoScan: false, log: () => {} });
  base = `http://127.0.0.1:${app.port}`; // not "localhost": Node 18 may try IPv6 first
  await api("POST", "/api/scan");
});

after(async () => {
  await app?.close();
  await sim?.stop();
  for (const k of Object.keys(PHONE_ENV)) delete process.env[k];
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("inside the phone app, Patch knows it's on a phone and opens pages through the Patch screen", async () => {
  const html = await (await fetch(`${base}/`)).text();
  assert.match(html, /"phone":true/, "the dashboard is told it's on a phone");
  assert.equal((await api("GET", "/api/state")).app.platform, "android");
  const me = (await api("GET", "/api/devices")).devices.find((d) => d.self);
  assert.equal(me.name, "Galaxy S24 Ultra");
  assert.equal(me.kind, "phone");
  assert.equal(me.what, "Samsung SM-S928B running Patch (Android 15)");

  // No Patch screen open: there's nowhere to show the page, so say what to do.
  let r = await api("POST", "/api/control", { device: "my phone", action: "web_search", value: "weather tomorrow" });
  assert.equal(r.ok, false);
  assert.match(r.message, /Open the Patch app on this phone/);

  // With the Patch screen open, the page goes to it (and from there to Android).
  const events = listen();
  await events.ready();
  r = await api("POST", "/api/control", { device: "this phone", action: "web_search", value: "weather tomorrow" });
  assert.ok(r.ok, r.message);
  assert.match(r.message, /on this phone/);
  assert.deepEqual(await events.next("open-url"), { url: "https://www.google.com/search?q=weather%20tomorrow" });

  r = await api("POST", "/api/control", { device: "here", action: "play_youtube", value: "dQw4w9WgXcQ" });
  assert.ok(r.ok, r.message);
  assert.deepEqual(await events.next("open-url"), { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
  events.close();
});

test("the app keeps the network file current; off Wi-Fi, a phone never scans mobile data", async () => {
  const file = path.join(dataDir, "network.json");
  const env = { PATCH_WIFI: "192.168.1.23/24", PATCH_NETWORK_FILE: file };
  assert.equal(networkFromEnv(env).wifi.address, "192.168.1.23", "start-up values until the file exists");
  fs.writeFileSync(file, JSON.stringify({ wifi: "192.168.50.8/24", gateway: "192.168.50.1", dns: "192.168.50.1" }));
  assert.deepEqual(networkFromEnv(env), { wifi: { address: "192.168.50.8", prefix: 24, cidr: "192.168.50.0/24" }, gateway: "192.168.50.1", dns: ["192.168.50.1"] });
  fs.writeFileSync(file, JSON.stringify({ wifi: "", gateway: "", dns: "" }));
  assert.equal(networkFromEnv(env).wifi, null, "off Wi-Fi");
  fs.rmSync(file);
});

/** A stand-in for the Android app's bridge: answers like the phone does and records what Patch asked. */
async function fakeBridge() {
  const calls = [];
  const items = [
    { n: 1, kind: "Link", text: "Joe's Pizza", tappable: true },
    { n: 2, kind: "Button", text: "Order online", tappable: true },
    { n: 3, kind: "Text box", text: "Search", state: "empty", tappable: true },
  ];
  const state = { screen: true };
  const find = (t) => (/^\d+$/.test(t) ? items[Number(t) - 1] : items.find((i) => i.text.toLowerCase().includes(String(t).toLowerCase())));
  const answer = {
    screen: () => (state.screen ? { ok: true, app: "Chrome", package: "com.android.chrome", items, more: true } : { ok: false, code: "ENOSCREEN", message: "Patch can't see the screen yet. Turn on Patch in your phone's Accessibility settings (Patch shows you how)." }),
    tap: ({ target }) => {
      const it = find(target);
      return it ? { ok: true, n: it.n, text: it.text, kind: it.kind } : { ok: false, code: "ENOTFOUND", message: `I can't find “${target}” on the screen.` };
    },
    open_app: ({ name }) => (/spotify/i.test(name) ? { ok: true, app: "Spotify" } : { ok: false, code: "ENOTFOUND", message: `I can't find an app called “${name}” on this phone.` }),
    play_media: ({ app }) => ({ ok: true, app: app === "spotify" || !app ? "Spotify" : app }),
    volume: () => ({ ok: true, volume: 40 }),
    media: () => ({ ok: true, playing: true }),
  };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.headers["x-patch-phone"] !== "s3cret") return res.end(JSON.stringify({ ok: false, code: "EAUTH", message: "Not allowed." }));
      const cmd = req.url.slice(1);
      const args = body ? JSON.parse(body) : {};
      calls.push({ cmd, args });
      res.end(JSON.stringify(answer[cmd]?.(args) ?? { ok: true }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, state, close: () => server.close() };
}

test("with screen access, Patch reads and uses the phone's screen, opens apps and plays music", async () => {
  const bridge = await fakeBridge();
  Object.assign(process.env, { PATCH_PHONE_BRIDGE: bridge.url, PATCH_PHONE_TOKEN: "s3cret" });
  const control = (b) => api("POST", "/api/control", { device: "this phone", ...b });
  const last = () => bridge.calls.at(-1);
  try {
    let r = await control({ action: "read_screen" });
    assert.ok(r.ok, r.message);
    assert.equal(r.message, "Chrome: 3 things on screen.");
    assert.match(r.screen, /^On screen: Chrome\.\n1\. Link: Joe's Pizza\n2\. Button: Order online\n3\. Text box: Search \(empty\)/);
    assert.match(r.screen, /It scrolls/);

    // By number, words like "the first one", or the words on it.
    r = await control({ action: "tap", value: "the first one" });
    assert.ok(r.ok, r.message);
    assert.equal(r.message, "Tapped “Joe's Pizza”.");
    assert.deepEqual(bridge.calls.slice(-2).map((c) => c.args), [{ target: "1", check: true }, { target: "1", expect: "Joe's Pizza" }]);

    // A button that could spend money: only after the person says yes.
    const before = bridge.calls.length;
    r = await control({ action: "tap", value: "Order online" });
    assert.equal(r.needsConfirmation, true);
    assert.match(r.message, /could buy, send, delete or change something/);
    assert.equal(bridge.calls.length, before + 1, "it only looked; nothing was tapped");
    r = await control({ action: "tap", value: "Order online", confirmToken: r.confirmToken });
    assert.ok(r.ok, r.message);
    assert.deepEqual(last(), { cmd: "tap", args: { target: "2", expect: "Order online" } });

    r = await control({ action: "launch_app", value: "Spotify" });
    assert.equal(r.message, "Opened Spotify.");
    r = await control({ action: "launch_app", value: "Flappy" });
    assert.equal(r.ok, false);
    assert.match(r.message, /can't find an app called “Flappy”/);

    r = await control({ action: "play_music", value: "Bohemian Rhapsody by Queen on Spotify" });
    assert.equal(r.message, "Playing “Bohemian Rhapsody by Queen” in Spotify.");
    assert.deepEqual(last(), { cmd: "play_media", args: { query: "Bohemian Rhapsody by Queen", app: "spotify", kind: null } });
    await control({ action: "play_music", value: "my chill playlist" });
    assert.deepEqual(last().args, { query: "my chill playlist", app: null, kind: "playlist" });

    for (const [action, value, cmd, args, message] of [
      ["scroll", "down", "scroll", { direction: "down" }, "Scrolled down."],
      ["scroll", "back to the top", "scroll", { direction: "up" }, "Scrolled up."],
      ["type_text", "pizza near me", "type", { text: "pizza near me" }, "Typed “pizza near me”."],
      ["press_button", "search", "enter", {}, "Pressed enter."],
      ["press_button", "back", "global", { action: "back" }, "Went back."],
      ["press_button", "home", "global", { action: "home" }, "Went to the home screen."],
      ["next", undefined, "media", { action: "next" }, "Skipped to the next one."],
      ["pause", undefined, "media", { action: "pause" }, "Paused."],
      ["volume_up", undefined, "volume", { action: "up" }, "Volume 40%."],
      ["set_volume", "half", "volume", { action: "set", percent: 50 }, "Volume 40%."],
    ]) {
      r = await control({ action, value });
      assert.ok(r.ok, `${action}: ${r.message}`);
      assert.equal(r.message, message);
      assert.deepEqual(last(), { cmd, args }, action);
    }

    // Web pages go straight to Android, with or without the Patch screen open.
    r = await control({ action: "web_search", value: "weather tomorrow" });
    assert.ok(r.ok, r.message);
    assert.deepEqual(last(), { cmd: "open_url", args: { url: "https://www.google.com/search?q=weather%20tomorrow" } });

    // Screen access switched off: say how to turn it on.
    bridge.state.screen = false;
    r = await control({ action: "read_screen" });
    assert.equal(r.ok, false);
    assert.match(r.message, /Accessibility settings/);
  } finally {
    delete process.env.PATCH_PHONE_BRIDGE;
    delete process.env.PATCH_PHONE_TOKEN;
    bridge.close();
  }
});
