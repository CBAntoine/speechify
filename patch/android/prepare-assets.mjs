#!/usr/bin/env node
// Copies Patch's server and dashboard into the Android app (app/src/main/assets/patch), with a version
// stamp so the app knows when to unpack a fresh copy. Run before building: node android/prepare-assets.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const PATCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(PATCH, "android/app/src/main/assets/patch");
// What the phone needs: the server, the dashboard, the ElevenLabs voice library (one file), and the
// template Patch makes TV apps from (tvapp/template.apk, built first by the Android build).
const ITEMS = ["server.mjs", "package.json", "src", "public", "tvapp/template.apk", "node_modules/@elevenlabs/client/dist/lib.iife.js", "node_modules/@elevenlabs/client/LICENSE"];

const sdk = path.join(PATCH, "node_modules/@elevenlabs/client/dist/lib.iife.js");
if (!fs.existsSync(sdk)) {
  console.error("The ElevenLabs voice library is missing: run `npm install` in the patch folder first.");
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
const hash = crypto.createHash("sha256");
let files = 0;
const copy = (rel) => {
  const from = path.join(PATCH, rel);
  if (!fs.existsSync(from)) return;
  if (fs.statSync(from).isDirectory()) {
    for (const name of fs.readdirSync(from).sort()) copy(path.join(rel, name));
    return;
  }
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  hash.update(rel.split(path.sep).join("/")).update("\0").update(fs.readFileSync(from));
  files++;
};
ITEMS.forEach(copy);
if (!fs.existsSync(path.join(PATCH, "tvapp/template.apk"))) console.warn("No TV app template (tvapp/template.apk): TV apps will download it when first made.");

const version = hash.digest("hex").slice(0, 16);
fs.writeFileSync(path.join(OUT, "version.txt"), `${version}\n`);
fs.writeFileSync(
  path.join(OUT, "NOTICE.txt"),
  [
    "Patch for Android includes:",
    "- Node.js (MIT License and the licenses of its bundled parts: https://github.com/nodejs/node/blob/main/LICENSE),",
    "  built for Android by the nodejs-mobile project (https://github.com/nodejs-mobile/nodejs-mobile).",
    "- @elevenlabs/client (MIT License, see node_modules/@elevenlabs/client/LICENSE).",
    "",
  ].join("\n"),
);
console.log(`Copied ${files} files into the app (version ${version}).`);
