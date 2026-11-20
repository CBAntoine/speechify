#!/usr/bin/env node
// Copies MapLibre's web worker into /public so it is served at a stable URL.
// (MapLibre v6 resolves its worker relative to its own module URL, which breaks
// once a bundler moves the library into a hashed chunk.) Also copies the fonts
// the map draws its street and place labels with (style "font-faces"), so
// labels need no glyph server.
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

const fonts = [
  ["@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "inter-latin.woff2"],
  ["@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2", "inter-latin-ext.woff2"],
  ["@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2", "unbounded-latin.woff2"],
  ["@fontsource-variable/unbounded/files/unbounded-latin-ext-wght-normal.woff2", "unbounded-latin-ext.woff2"],
];
for (const [from, to] of fonts) {
  const file = resolve(root, "node_modules", from);
  if (!existsSync(file)) continue;
  const out = resolve(root, "public/vendor/fonts", to);
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(file, out);
}
