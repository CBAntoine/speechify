// The explore tool: a closer look at devices no driver knows (what they are, and why Patch thinks so),
// and talking to them: their web pages and APIs, and messages to their ports. Against the simulator's
// mystery devices (sim/mystery-devices.mjs): a Tasmota plug, a Raspberry Pi, an AV receiver, a
// Hikvision camera, Synology storage that only says what it is over SNMP, and a printer's raw port.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSimulator } from "../sim/simulator.mjs";
import { startApp } from "../src/app.mjs";
import { guessFrom, htmlToText, messageBytes, parseSnmpResponse, snmpGetRequest } from "../src/net/explore.mjs";

const P = "127.0.19";
const at = (n) => `${P}.${n}`;
let sim;
let app;
let dir;
const call = async (method, p, body) => (await fetch(`http://127.0.0.1:${app.port}${p}`, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const explore = (body) => call("POST", "/api/explore", body);
const deviceAt = async (ip) => (await call("GET", "/api/devices")).devices.find((d) => d.ip === ip);

before(async () => {
  sim = await startSimulator({ prefix: P, mystery: true });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-explore-"));
  app = await startApp({ port: 0, dataDir: dir, overrides: sim.overrides, autoScan: false, log: () => {} });
  await call("POST", "/api/scan");
});

after(async () => {
  await app.close();
  await sim.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a closer look names a plug Patch didn't know (Tasmota, from its own page), and it stays named", async () => {
  const first = await deviceAt(at(40));
  assert.ok(first, "the scan found it");
  assert.equal(first.driver, "generic");
  assert.notEqual(first.brand, "Tasmota");
  const r = await explore({ device: at(40), action: "identify" });
  assert.equal(r.ok, true, r.message);
  assert.match(r.what_it_probably_is, /^probably a Tasmota smart plug/);
  assert.equal(r.how_sure, "likely");
  assert.ok(r.why.some((w) => /web page on port 80 is titled “Tasmota”/.test(w)), r.why.join(" | "));
  assert.ok(r.ways_to_talk.some((w) => /^port 80: web page “Tasmota”/.test(w)), r.ways_to_talk.join(" | "));
  const d = await deviceAt(at(40));
  assert.equal(d.kind, "plug");
  assert.equal(d.brand, "Tasmota");
  assert.equal(d.confidence, "likely");
  assert.ok(d.explored.services.some((s) => s.port === 80 && s.title === "Tasmota"));
  await call("POST", "/api/scan");
  const again = await deviceAt(at(40));
  assert.equal(again.brand, "Tasmota", "a new scan keeps what the closer look found");
  assert.ok(again.evidence.some((e) => /^a closer look: /.test(e)));
});

test("reading the plug's own API needs no yes; switching it does, once", async () => {
  let r = await explore({ device: at(40), action: "web", path: "/cm?cmnd=Status" });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.json.Status.FriendlyName[0], "Porch light");
  r = await explore({ device: at(40), action: "web", path: "/cm?cmnd=Power%20On" });
  assert.equal(r.needsConfirmation, true);
  assert.match(r.message, /changes something on it.*Ask the person to confirm/);
  assert.equal(sim.state.mystery.plug.power, "OFF", "nothing is sent before the yes");
  const token = r.confirmToken;
  r = await explore({ device: at(40), action: "web", path: "/cm?cmnd=Power%20On", confirmToken: token });
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(r.json, { POWER: "ON" });
  assert.equal(sim.state.mystery.plug.power, "ON");
  r = await explore({ device: at(40), action: "web", path: "/cm?cmnd=Power%20Off", confirmToken: token });
  assert.equal(r.needsConfirmation, true, "a yes is for that one request");
  // Its page, as words, links and forms.
  r = await explore({ device: at(40), action: "web", path: "/" });
  assert.equal(r.title, "Tasmota");
  assert.match(r.text, /Porch light/);
  assert.ok(r.links.some((l) => l.path === "/cn" && /Configuration/.test(l.text)));
  assert.ok(r.forms.length >= 1);
});

test("the receiver: named from the words on its page, and talked to in its own text commands", async () => {
  let r = await explore({ device: at(42), action: "identify" });
  assert.equal(r.ok, true, r.message);
  assert.match(r.what_it_probably_is, /AV receiver/);
  assert.ok(r.why.some((w) => /mentions Denon/.test(w)), r.why.join(" | "));
  assert.ok(r.ways_to_talk.some((w) => /^port 23: Telnet that takes messages/.test(w)), r.ways_to_talk.join(" | "));
  assert.deepEqual(sim.state.mystery.receiver.heard, [], "the closer look only listened on its command port");
  r = await explore({ device: at(42), action: "send", port: 23, message: "PW?\\r" });
  assert.equal(r.needsConfirmation, true);
  r = await explore({ device: at(42), action: "send", port: 23, message: "PW?\\r", confirmToken: r.confirmToken });
  assert.equal(r.ok, true, r.message);
  assert.match(r.reply, /PWSTANDBY/);
  assert.deepEqual(sim.state.mystery.receiver.heard, ["PW?"]);
});

test("a camera by its video server, a Raspberry Pi by its greeting, storage by what it says over SNMP", async () => {
  const cam = await explore({ device: at(43), action: "identify" });
  assert.match(cam.what_it_probably_is, /Hikvision/);
  assert.equal(cam.kind, "camera");
  assert.ok(cam.ways_to_talk.some((w) => /RTSP/.test(w)));
  assert.ok(cam.open_ports.some((p) => p.port === 80 && /asks for a password/.test(p.what)));
  const pi = await explore({ device: at(41), action: "identify" });
  assert.match(pi.what_it_probably_is, /Raspberry Pi/);
  assert.ok(pi.why.some((w) => /SSH|greeting/.test(w)), pi.why.join(" | "));
  assert.ok(pi.open_ports.some((p) => p.port === 1883 && /MQTT broker that lets anyone connect/.test(p.what)), JSON.stringify(pi.open_ports));
  const nas = await explore({ device: at(44), action: "identify" });
  assert.match(nas.what_it_probably_is, /Synology/);
  assert.equal(nas.how_sure, "likely");
  assert.equal(nas.its_own_name, "FamilyNAS");
  assert.equal(nas.snmp.location, "Basement");
  assert.equal((await deviceAt(at(44))).kind, "nas");
});

test("a deep look knocks on every port, and finds a web app on an odd one", async () => {
  const quick = await explore({ device: at(41), action: "identify" });
  assert.ok(!quick.open_ports.some((p) => p.port === 40888));
  const deep = await explore({ device: at(41), action: "identify", deep: true });
  assert.ok(deep.open_ports.some((p) => p.port === 40888 && /Garden watering/.test(p.what)), JSON.stringify(deep.open_ports));
});

test("every unnamed device at once", async () => {
  const r = await explore({ action: "identify" });
  assert.equal(r.ok, true, r.message);
  const said = r.devices.map((d) => `${d.device}: ${d.what_it_probably_is}`).join("\n");
  for (const re of [/Hikvision/, /Synology/, /Raspberry Pi/]) assert.match(said, re);
  assert.match(r.message, /^Looked closer at \d+ devices?; \d+ now say/);
});

test("only the home network, never passwords, and never the printer's raw port", async () => {
  let r = await explore({ device: "8.8.8.8", action: "identify" });
  assert.equal(r.error, "ENOTHOME");
  r = await explore({ device: "10.9.8.7", action: "web" });
  assert.equal(r.error, "ENOTHOME", "private, but not this home network");
  r = await explore({ device: "127.0.0.1", action: "web" });
  assert.equal(r.error, "ESELF", "not the machine Patch runs on (its own server)");
  r = await explore({ device: "the thing that isn't there", action: "identify" });
  assert.equal(r.error, "ENOTFOUND");
  r = await explore({ device: at(40), action: "web", path: "/login?user=admin&password=admin" });
  assert.equal(r.error, "EPASSWORD");
  r = await explore({ device: at(40), action: "web", method: "POST", path: "/login", body: '{"password":"1234"}' });
  assert.equal(r.error, "EPASSWORD");
  // The printer's raw port prints whatever arrives: a closer look only knocks, and nothing is sent.
  const look = await explore({ device: at(45), action: "identify" });
  assert.ok(look.open_ports.some((p) => p.port === 9100));
  r = await explore({ device: at(45), action: "web", port: 9100 });
  assert.equal(r.ok, false);
  assert.match(r.message, /gets printed/);
  r = await explore({ device: at(45), action: "send", port: 9100, message: "hello" });
  r = await explore({ device: at(45), action: "send", port: 9100, message: "hello", confirmToken: r.confirmToken });
  assert.equal(r.ok, false);
  assert.match(r.message, /gets printed/);
  assert.deepEqual(sim.state.mystery.printer.printed, []);
});

test("the pieces: SNMP, a page as words, messages with escapes, guesses that say why", () => {
  // A GetRequest as Patch sends it, answered the way an SNMP agent does (encoded by hand).
  const req = snmpGetRequest(["1.3.6.1.2.1.1.5.0"], { id: 7 });
  assert.equal(req[0], 0x30);
  const reply = Buffer.from("302902010104067075626c6963a21c020107020100020100301130 0f06082b060102010105000403 4e4153".replace(/\s/g, ""), "hex");
  assert.deepEqual(parseSnmpResponse(reply), { "1.3.6.1.2.1.1.5.0": "NAS" });
  assert.equal(htmlToText("<h1>Hi &amp; welcome</h1><script>alert(1)</script><p>Zone 1</p>"), "Hi & welcome\nZone 1");
  assert.deepEqual([...messageBytes("PW?\\r")], [0x50, 0x57, 0x3f, 0x0d]);
  assert.deepEqual([...messageBytes("hex: 0a ff 00")], [0x0a, 0xff, 0x00]);
  assert.deepEqual([...messageBytes("\\x02on\\x03")], [0x02, 0x6f, 0x6e, 0x03]);
  const g = guessFrom({ open: [22, 80], services: [{ port: 22, service: "ssh", banner: "SSH-2.0-dropbear_2020.81" }, { port: 80, service: "http", title: "Pi-hole Admin Console" }], mdns: [] });
  assert.equal(g.model, "Pi-hole ad blocker", "a name on its page beats a guess from its greeting");
  assert.ok(g.reasons[0].includes("Pi-hole"));
  const none = guessFrom({ open: [], services: [], mdns: [] });
  assert.equal(none.confidence, "guess");
  assert.match(none.reasons[0], /no open ports/);
});
