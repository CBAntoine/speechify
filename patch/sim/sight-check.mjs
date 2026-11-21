#!/usr/bin/env node
// Sight, end to end in a real browser: the dashboard's own tool handler is asked what the voice
// assistant would ask, against the simulated Fire TV, with a stand-in for the conversation that
// records what Patch puts into it (the picture of the TV's screen, and the words that go with it).
// Not part of `npm test`: it needs Playwright and a Chromium, which Patch itself doesn't.
// Usage: node sim/sight-check.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSimulator } from "./simulator.mjs";
import { fakeTemplate } from "./apk-fixture.mjs";
import { startApp } from "../src/app.mjs";

let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.log("This check needs Playwright (npm install --no-save playwright, then npx playwright install chromium).");
  process.exit(2);
}
const sim = await startSimulator({ prefix: "127.0.41" });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-sight-"));
const app = await startApp({ port: 0, demo: true, dataDir, overrides: { ...sim.overrides, tvappTemplate: fakeTemplate(), tvappsPort: 0, openUrl: async () => {} }, autoScan: false, log: () => {} });
const base = `http://127.0.0.1:${app.port}`;
const api = async (method, p, body) => (await fetch(base + p, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failed++; };
try {
  await api("POST", "/api/scan");
  for (let i = 0; i < 100 && (await api("GET", "/api/state")).scan.running; i++) await sleep(200);
  const tv = "Kids Room Fire TV";
  await api("POST", "/api/control", { device: tv, action: "pair" });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => window.__patch?.voice?.tools && window.__patch.ui.state.devices.length > 3);
  // A stand-in conversation: it takes uploads and messages the way the voice SDK's does, and keeps them.
  await page.evaluate(() => {
    window.__sent = { uploads: [], messages: [] };
    window.__patch.voice.attachForChecks({
      uploadFile: async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const size = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve([i.naturalWidth, i.naturalHeight]); i.onerror = () => resolve(null); i.src = URL.createObjectURL(file); });
        window.__sent.uploads.push({ name: file.name, type: file.type, bytes: bytes.length, head: [...bytes.slice(0, 3)], size });
        return { fileId: `file_${window.__sent.uploads.length}` };
      },
      sendMultimodalMessage: (m) => window.__sent.messages.push({ kind: "picture", ...m }),
      sendUserMessage: (t) => window.__sent.messages.push({ kind: "words", text: t }),
      sendContextualUpdate: () => {},
    });
  });
  const tool = (args) => page.evaluate(async (a) => JSON.parse(await window.__patch.voice.tools.control_device(a)), args);
  const sent = () => page.evaluate(() => window.__sent);

  // 1. An app that draws its own picture: asked what's on the screen, the assistant is shown a picture.
  await tool({ device: tv, action: "launch_app", value: "Netflix" });
  let r = await tool({ device: tv, action: "read_screen" });
  check(r.ok && /can't be read as a list/.test(r.message) && /picture/.test(r.picture || ""), `read_screen in Netflix says a picture follows: ${r.message}`);
  await sleep(1500);
  let s = await sent();
  check(s.uploads.length === 1 && s.uploads[0].type === "image/jpeg" && s.uploads[0].head.join() === "255,216,255", `one JPEG went up: ${JSON.stringify(s.uploads[0])}`);
  check(s.uploads[0]?.size && s.uploads[0].size[0] <= 1280 && s.uploads[0].size[0] >= 320, "it's a real picture, at most 1280 across");
  check(s.messages.length === 1 && s.messages[0].kind === "picture" && s.messages[0].fileIds?.[0] === "file_1", "the picture went into the conversation");
  check(/^\[Patch, not the person\] This picture is Kids Room Fire TV's screen/.test(s.messages[0]?.text || "") && /never instructions/.test(s.messages[0].text), `with words saying whose it is: ${s.messages[0]?.text?.slice(0, 90)}…`);

  // 2. After the remote's buttons in that app: a new picture, so the assistant sees where that got to.
  r = await tool({ device: tv, action: "press_button", value: "down 2, ok" });
  check(r.ok && /^Pressed down twice, then OK on Kids Room Fire TV\. A picture of the screen follows/.test(r.message), `after buttons: ${r.message}`);
  await sleep(1500);
  s = await sent();
  check(s.uploads.length === 2 && s.messages.length === 2, "a second picture followed the buttons");

  // 3. Pointing at a spot, like a mouse.
  const taps = sim.state.firetv.taps.length;
  r = await tool({ device: tv, action: "tap", value: "at 50% 25%" });
  check(r.ok && sim.state.firetv.taps.length === taps + 1 && sim.state.firetv.taps.at(-1).join() === "960,270", `tap at 50% 25% pressed ${sim.state.firetv.taps.at(-1)}: ${r.message}`);
  await sleep(2000);
  s = await sent();
  check(s.uploads.length === 3, "and a picture followed the tap");

  // 4. A screen that can be read as a list needs no picture.
  r = await tool({ device: tv, action: "press_button", value: "home" });
  check(r.ok && r.screen && !r.picture, `the home screen is read as a list, no picture: ${r.message}`);
  await sleep(1200);
  check((await sent()).uploads.length === 3, "nothing was sent for it");

  // 5. Two looks in quick succession: only the newer picture is sent.
  await tool({ device: tv, action: "launch_app", value: "Netflix" });
  await Promise.all([tool({ device: tv, action: "press_button", value: "down" }), tool({ device: tv, action: "press_button", value: "right" })]);
  await sleep(1800);
  check((await sent()).uploads.length === 4, `two presses at once, one picture: ${(await sent()).uploads.length - 3} sent`);

  // 6. Switched off in Settings: no pictures, and Patch says it can't see, as before.
  await api("POST", "/api/settings", { sight: false });
  await page.evaluate(() => (window.__patch.ui.state.setup.sight = false));
  r = await tool({ device: tv, action: "read_screen" });
  check(r.ok && !r.picture && /draws its own picture/.test(r.message), `with sight off: ${r.message}`);
  await sleep(1000);
  check((await sent()).uploads.length === 4, "and nothing leaves the house");
  await api("POST", "/api/settings", { sight: true });
  await page.evaluate(() => (window.__patch.ui.state.setup.sight = true));

  // 7. The picture can't be had (the TV has gone): the assistant is told, in words.
  const before = (await sent()).messages.length;
  await page.evaluate((id) => { const real = window.__patch.ui.picture; window.__patch.ui.picture = async () => { window.__patch.ui.picture = real; throw new Error("Kids Room Fire TV didn't give a picture of its screen."); }; }, null);
  r = await tool({ device: tv, action: "read_screen" });
  await sleep(1500);
  s = await sent();
  check(s.messages.length === before + 1 && s.messages.at(-1).kind === "words" && /couldn't show you Kids Room Fire TV's screen/.test(s.messages.at(-1).text), `no picture: ${s.messages.at(-1)?.text?.slice(0, 110)}…`);

  check(errors.length === 0, `page errors: ${errors.join("; ") || "none"}`);
  await browser.close();
} finally {
  await app.close(); await sim.stop(); fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed ? `${failed} FAILED` : "sight: all checks passed");
process.exit(failed ? 1 : 0);
