// End to end against the simulated home network: discovery, control by spoken name, the confirmation
// rule, tune-up fixes, and the local server's security checks.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startSimulator } from "../sim/simulator.mjs";
import { startApp } from "../src/app.mjs";
import * as mdns from "../src/net/mdns.mjs";
import * as ssdp from "../src/net/ssdp.mjs";

let sim;
let app;
let base;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-test-"));

const api = async (method, p, body, headers = {}) => {
  const r = await fetch(base + p, { method, headers: { "x-patch-token": app.token, "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: r.status, json, text };
};
const control = async (b) => (await api("POST", "/api/control", b)).json;
const device = async (name) => (await api("POST", "/api/resolve", { query: name })).json.device;

before(async () => {
  sim = await startSimulator({ prefix: "127.0.10" });
  app = await startApp({ port: 0, demo: true, dataDir, overrides: sim.overrides, autoScan: false, log: () => {} });
  app.store.data.homeAssistant = { url: "http://127.0.10.14:8123", token: "demo-token" };
  base = `http://localhost:${app.port}`;
  const r = await api("POST", "/api/scan");
  assert.equal(r.status, 200);
});

after(async () => {
  await app?.close();
  await sim?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("a scan finds and identifies every kind of device", async () => {
  const { devices } = (await api("GET", "/api/devices")).json;
  const by = (driver) => devices.filter((d) => d.driver === driver);
  for (const drv of ["router", "hue", "roku", "sonos", "cast", "shelly", "wled", "elgato", "kasa", "lifx", "yeelight", "printer", "homeassistant", "generic"]) {
    assert.ok(by(drv).length, `found a ${drv} device`);
  }
  const named = (n) => devices.find((d) => d.name === n);
  assert.equal(named("Living Room TV").kind, "tv");
  assert.equal(named("Kitchen").kind, "speaker");
  assert.equal(named("Bedroom TV").kind, "streamer");
  assert.equal(named("Kitchen iPad").kind, "tablet");
  assert.equal(named("OFFICE-PC").kind, "computer");
  assert.equal(named("Camera").kind, "camera");
  assert.equal(named("Living Room Thermostat").kind, "thermostat");
  assert.ok(named("NETGEAR Nighthawk RAX50").info.portForwards.length === 2);
  assert.equal(named("Philips hue").setup.kind, "button", "the Hue Bridge waits for its button");
  assert.ok(devices.every((d) => d.online), "everything is online");
  assert.ok(!devices.some((d) => d.name === "Plug LED"), "Home Assistant config entities are hidden");
});

test("pairing the Hue Bridge needs its button, then loads lights and rooms", async () => {
  let r = await control({ device: "hue bridge", action: "pair" });
  assert.equal(r.ok, false);
  assert.match(r.message, /round button/);
  r = await control({ device: "hue bridge", action: "pair" });
  assert.equal(r.ok, true);
  for (let i = 0; i < 50 && (await api("GET", "/api/state")).json.scan.running; i++) await new Promise((res) => setTimeout(res, 100));
  await new Promise((res) => setTimeout(res, 200));
  for (let i = 0; i < 50 && (await api("GET", "/api/state")).json.scan.running; i++) await new Promise((res) => setTimeout(res, 100));
  const { devices } = (await api("GET", "/api/devices")).json;
  const hue = devices.filter((d) => d.driver === "hue");
  assert.ok(hue.some((d) => d.name === "Kitchen 1" && d.room === "Kitchen"));
  assert.ok(hue.some((d) => d.kind === "room" && d.name === "Living room"));
  assert.ok(hue.find((d) => d.name === "Garden spot").online === false, "an unreachable bulb shows as offline");
});

test("controlling devices by the names people say", async () => {
  let r = await control({ device: "kitchen lights", action: "turn_off" });
  assert.ok(r.ok, r.message);
  assert.equal(sim.state.hue.lights[1].state.on, false);
  r = await control({ device: "living room", action: "set_scene", value: "relax" });
  assert.ok(r.ok, r.message);
  r = await control({ device: "desk leds", action: "set_effect", value: "rainbow" });
  assert.ok(r.ok);
  assert.equal(sim.state.wled.fx, 9);
  r = await control({ device: "living room tv", action: "launch_app", value: "you tube" });
  assert.ok(r.ok);
  assert.equal(sim.state.roku.active, "837");
  r = await control({ device: "kitchen speaker", action: "set_volume", value: "40" });
  assert.equal(sim.state.sonos.volume, 40);
  r = await control({ device: "bedroom tv", action: "pause" });
  assert.equal(sim.state.cast.playerState, "PAUSED");
  r = await control({ device: "bedroom tv", action: "mute" });
  assert.equal(sim.state.cast.muted, true);
  r = await control({ device: "bedroom lamp", action: "set_color", value: "purple" });
  assert.ok(r.ok);
  assert.ok(sim.state.lifx.saturation > 60000);
  r = await control({ device: "nursery light", action: "set_brightness", value: "10%" });
  assert.equal(sim.state.yeelight.bright, 10);
  r = await control({ device: "key light", action: "turn_on" });
  assert.equal(sim.state.elgato.on, 1);
  r = await control({ device: "space heater", action: "turn_on" });
  assert.equal(sim.state.kasa.on, true);
  r = await control({ device: "porch light", action: "turn_on" });
  assert.equal(sim.state.shelly1.on, true);
  r = await control({ device: "thermostat", action: "set_temperature", value: "22" });
  assert.equal(sim.state.ha.states.find((s) => s.entity_id === "climate.living_room").attributes.temperature, 22);
  r = await control({ device: "printer", action: "identify" });
  assert.equal(sim.state.printer.identified, 1);
});

test("unclear or unknown names get a question back, not a guess", async () => {
  let r = await control({ device: "lamp", action: "turn_on" });
  assert.equal(r.error, "EAMBIGUOUS");
  assert.match(r.message, /Bedroom Lamp/);
  r = await control({ device: "toaster", action: "turn_on" });
  assert.equal(r.error, "ENOTFOUND");
  r = await control({ device: "kitchen speaker", action: "set_color", value: "red" });
  assert.equal(r.error, "EUNSUPPORTED");
});

test("risky actions wait for a yes, and confirmation tokens can't be forged or reused", async () => {
  let r = await control({ device: "coffee maker", action: "turn_off" });
  assert.equal(r.needsConfirmation, true);
  assert.equal(sim.state.plug.on, true, "nothing happened yet");
  const bogus = await control({ device: "coffee maker", action: "turn_off", confirmToken: "made-up" });
  assert.equal(bogus.needsConfirmation, true);
  const ok = await control({ device: "coffee maker", action: "turn_off", confirmToken: r.confirmToken });
  assert.equal(ok.ok, true);
  assert.equal(sim.state.plug.on, false);
  const replay = await control({ device: "coffee maker", action: "turn_off", confirmToken: r.confirmToken });
  assert.equal(replay.needsConfirmation, true, "a token works once");
  r = await control({ device: "front door", action: "unlock" });
  assert.equal(r.needsConfirmation, true);
  const wrongAction = await control({ device: "garage", action: "open", confirmToken: r.confirmToken });
  assert.equal(wrongAction.needsConfirmation, true, "a token only covers the action it was issued for");
  assert.equal(sim.state.ha.states.find((s) => s.entity_id === "lock.front_door").state, "locked");
});

test("bulk commands cover a room or a kind of device", async () => {
  let r = await control({ room: "kitchen", kind: "lights", action: "turn_on" });
  assert.ok(r.ok, r.message);
  assert.equal(sim.state.hue.lights[1].state.on, true);
  assert.equal(sim.state.hue.lights[2].state.on, true);
  r = await control({ kind: "lights", action: "turn_off" });
  assert.equal(r.needsConfirmation, true, "more than six devices at once needs a yes");
  r = await control({ kind: "lights", action: "turn_off", confirmToken: r.confirmToken });
  assert.ok(r.ok);
  assert.match(r.message, /skipped/, "offline bulbs are skipped and mentioned");
  assert.equal(sim.state.wled.on, false);
  assert.equal(sim.state.lifx.power, 0);
});

test("renaming works in Patch and on devices that support it", async () => {
  const d = await device("desk leds");
  const r = await api("POST", `/api/devices/${encodeURIComponent(d.id)}/meta`, { name: "Desk Glow", room: "Study" });
  assert.ok(r.json.ok);
  assert.equal(sim.state.wled.name, "Desk Glow");
  assert.equal(r.json.device.room, "Study");
  assert.equal((await device("desk glow")).id, d.id);
});

test("tune-up finds the problems and fixes the fixable ones", async () => {
  const t = (await api("POST", "/api/tuneup", { skipInternet: true, skipWifi: true })).json;
  const titles = t.findings.map((f) => `${f.severity}: ${f.title}`);
  const has = (re) => titles.some((x) => re.test(x));
  assert.ok(has(/^high: Camera has Telnet/), titles.join("\n"));
  assert.ok(has(/Open to the internet: IPCAM/));
  assert.ok(has(/Open to the internet: Plex/));
  assert.ok(has(/Update available for Coffee Maker/));
  assert.ok(has(/Hue system update ready/));
  assert.ok(has(/Hue automatic updates are off/));
  assert.ok(has(/weak WiFi signal/));
  assert.ok(has(/Black Toner is low/));
  assert.ok(has(/Back Door Sensor Battery is at 12%/));
  assert.ok(has(/Front Door Lock Firmware/));
  assert.ok(has(/can't identify/));
  assert.ok(t.score < 60 && t.grade);
  const cam = t.findings.find((f) => /IPCAM/.test(f.title));
  let r = (await api("POST", `/api/fixes/${cam.id}`, {})).json;
  assert.equal(r.needsConfirmation, true);
  r = (await api("POST", `/api/fixes/${cam.id}`, { confirmToken: r.confirmToken })).json;
  assert.ok(r.ok, r.message);
  assert.deepEqual(sim.state.router.mappings.map((m) => m.NewExternalPort), [32400]);
  const auto = t.findings.find((f) => /automatic updates/.test(f.title));
  r = (await api("POST", `/api/fixes/${auto.id}`, {})).json;
  assert.ok(r.ok, "safe fixes apply straight away");
  assert.equal(sim.state.hue.swupdate2.autoinstall.on, true);
  const ha = t.findings.find((f) => /Front Door Lock Firmware/.test(f.title));
  r = (await api("POST", `/api/fixes/${ha.id}`, {})).json;
  r = (await api("POST", `/api/fixes/${ha.id}`, { confirmToken: r.confirmToken })).json;
  assert.ok(r.ok, r.message);
  assert.ok(sim.state.ha.calls.some((c) => c.domain === "update" && c.service === "install"));
});

test("diagnose explains reachability and risky services", async () => {
  const cam = await device("camera");
  const d = (await api("POST", `/api/devices/${encodeURIComponent(cam.id)}/diagnose`, {})).json;
  assert.equal(d.reachable, true);
  assert.ok(d.findings.some((f) => /Telnet/.test(f)));
});

test("the local server refuses other websites and wrong addresses", async () => {
  assert.equal((await api("GET", "/api/state", null, { "x-patch-token": "nope" })).status, 403);
  assert.equal((await api("POST", "/api/scan", {}, { origin: "https://evil.example" })).status, 403);
  assert.equal((await fetch(base + "/api/state", { headers: { "x-patch-token": app.token } }).then((r) => r.status)), 200);
  const rebinding = await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: app.port, path: "/", headers: { host: `attacker.example:${app.port}` } }, (res) => resolve(res.statusCode)).on("error", () => resolve(0));
  });
  assert.equal(rebinding, 421, "DNS-rebinding style Host headers are rejected");
  const form = await fetch(base + "/api/scan", { method: "POST", headers: { "x-patch-token": app.token, "content-type": "text/plain" }, body: "{}" });
  assert.equal(form.status, 415, "only JSON bodies are accepted");
  const traversal = await new Promise((resolve) => {
    http.get({ host: "127.0.0.1", port: app.port, path: "/..%2f..%2fpackage.json", headers: { host: `localhost:${app.port}` } }, (res) => resolve(res.statusCode));
  });
  assert.equal(traversal, 404);
  const page = await fetch(base + "/").then((r) => r.text());
  assert.ok(page.includes(app.token), "the page carries this run's token");
  assert.ok(!page.includes("%%PATCH_BOOT%%"));
});

test("voice needs an ElevenLabs key and says so plainly", async () => {
  const r = (await api("POST", "/api/voice/session", { mode: "voice" })).json;
  assert.equal(r.ok, false);
  assert.equal(r.error, "nokey");
  const s = (await api("GET", "/api/settings")).json;
  assert.equal(s.elevenlabs.hasKey, false);
  assert.ok(!JSON.stringify(s).includes("demo-token"), "settings never echo secrets back");
});

test("multicast discovery (the path real networks use)", async (t) => {
  const msim = await startSimulator({ prefix: "127.0.11", multicast: true });
  try {
    const { services } = await mdns.browse({ timeout: 1500 });
    if (!services.length) return t.skip("no multicast-capable interface here");
    assert.ok(services.some((s) => s.type === "_googlecast._tcp" && s.txt.fn === "Bedroom TV" && s.addresses[0] === "127.0.11.13"));
    const found = await ssdp.search({ timeout: 1500 });
    assert.ok(found.some((r) => r.sts.includes("roku:ecp") && r.address === "127.0.11.3"));
  } finally {
    await msim.stop();
  }
});
