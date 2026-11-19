#!/usr/bin/env node
// Copies MapLibre's web worker into /public so it is served at a stable URL.
// (MapLibre v6 resolves its worker relative to its own module URL, which breaks
// once a bundler moves the library into a hashed chunk.)
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
const dest = resolve(root, "public/vendor/maplibre-gl-worker.mjs");
if (existsSync(src)) {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
