// On an Android phone, apps can't read the list of addresses the phone has seen on the network, so
// Patch knocks on every address instead. A quiet device (a wall calendar, a laptop, a tablet) has
// nothing listening and turns Patch away, which still proves it's there.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSimulator } from "../sim/simulator.mjs";
import { startApp } from "../src/app.mjs";
import { factsFor } from "../src/identify.mjs";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-quiet-"));
after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test("on a phone, a device that only turns Patch away is still found (like a wall calendar)", async () => {
  const sim = await startSimulator({ prefix: "127.0.15" });
  const calendar = "127.0.15.77";
  // Who answers Patch's knock. On this computer every made-up 127.x address would answer, so the
  // knock is played by a stand-in: "quiet" is a home where one quiet device answers, "all" is a
  // phone whose VPN answers for every address.
  let home = "all";
  const sweep = async (ips) => {
    const answering = home === "all" ? ips : ips.filter((ip) => ip === calendar);
    return new Map(answering.map((ip) => [ip, { ip, open: [] }]));
  };
  const app = await startApp({ port: 0, dataDir, overrides: { ...sim.overrides, arp: async () => [], sweep }, autoScan: false, log: () => {} });
  const call = async (method, p, body) => (await fetch(`http://127.0.0.1:${app.port}${p}`, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
  try {
    // Every address answering is something on the way, not hundreds of devices.
    await call("POST", "/api/scan");
    let devices = (await call("GET", "/api/devices")).devices;
    const announced = devices.length;
    assert.ok(announced > 3, `the devices that announce themselves are found (${announced})`);
    assert.ok(!devices.some((d) => d.ip === calendar || d.ip === "127.0.15.200"), "no made-up devices when every address answers");

    // A home where one quiet device answers: it's on the list now.
    home = "quiet";
    await call("POST", "/api/scan");
    devices = (await call("GET", "/api/devices")).devices;
    const found = devices.find((d) => d.ip === calendar);
    assert.ok(found, `the quiet device is found: ${devices.map((d) => `${d.name} ${d.ip}`).join(", ")}`);
    assert.equal(found.online, true);
    assert.equal(devices.length, announced + 1, "and nothing else new");
  } finally {
    await app.close();
    await sim.stop();
  }
});

test("family calendars are recognised by their network names", () => {
  const named = (n) => factsFor({ ip: "192.168.1.9", mac: null, vendor: null, hostnames: new Set([n]), netbios: null, ports: new Set(), mdns: [], ssdp: [], udp: {}, http: {}, extra: {} });
  assert.deepEqual([named("Cozyla-Calendar.lan").brand, named("Cozyla-Calendar.lan").kind], ["Cozyla", "display"]);
  assert.equal(named("skylight-cal").brand, "Skylight");
  assert.equal(named("android-5f2c9a1b").model, "Android phone or tablet");
});
