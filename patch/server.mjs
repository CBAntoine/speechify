#!/usr/bin/env node
// Patch: talk to the devices on your WiFi. Start with `npm start` (or double-click a start file).
//   --demo      use a simulated home network instead of yours (nothing on your network is touched)
//   --lan       let phones and tablets on your WiFi open Patch too (asks for an access code)
//   --port N    listen on another port (default 4545)
//   --no-open   don't open the browser automatically
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startApp } from "./src/app.mjs";
import { DEFAULT_PORT } from "./src/defaults.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const value = (f) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

if (Number(process.versions.node.split(".")[0]) < 20) {
  console.error(`Patch needs Node.js 20 or newer (you have ${process.version}). Get the LTS version from https://nodejs.org`);
  process.exit(1);
}

// Optional .env file next to this script (ELEVENLABS_API_KEY=..., PATCH_SUBNET=...)
const envFile = path.join(HERE, ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") process.loadEnvFile(envFile);

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    /* no browser available */
  }
}

const demo = flag("--demo") || process.env.PATCH_DEMO === "1";
let overrides = {};
let sim = null;
if (demo) {
  const { startSimulator } = await import("./sim/simulator.mjs");
  try {
    sim = await startSimulator();
  } catch (err) {
    console.error(`Couldn't start the simulated network (${err.message}).`);
    if (process.platform === "darwin") console.error("On macOS, add the demo addresses first:\n  for i in $(seq 1 31); do sudo ifconfig lo0 alias 127.0.10.$i up; done");
    process.exit(1);
  }
  overrides = sim.overrides;
}

const port = Number(value("--port") || process.env.PATCH_PORT || DEFAULT_PORT);
let app;
try {
  app = await startApp({ port, demo, lan: flag("--lan") || process.env.PATCH_LAN === "1", dataDir: process.env.PATCH_DATA_DIR || undefined, overrides });
} catch (err) {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is busy. Patch may already be running: open http://localhost:${port}/ or start with --port 4546.`);
    process.exit(1);
  }
  throw err;
}

if (demo) {
  // The demo comes with its simulated Home Assistant already connected.
  const ha = app.store.data.homeAssistant;
  if (!ha.url) {
    app.store.data.homeAssistant = { url: `http://${sim.prefix}.14:8123`, token: "demo-token" };
    await app.store.save();
  }
}

console.log(`\n  Patch is running${demo ? " (demo network)" : ""}: ${app.url}`);
if (app.lanUrls.length) console.log(`  On your phone or tablet: ${app.lanUrls.join("  or  ")}   access code ${app.accessCode}`);
console.log("  Keep this window open while you use Patch. Press Ctrl+C to stop.\n");
if (!flag("--no-open") && !process.env.CI) openBrowser(app.url);

const stop = async () => {
  await app.close().catch(() => {});
  await sim?.stop().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
