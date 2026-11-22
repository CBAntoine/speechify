#!/usr/bin/env node
// Bulwark launcher. Checks the Node.js version, then runs the TypeScript sources directly
// (Node 22.18+ understands TypeScript on its own; older 22.x needs a flag, added here).

import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 6)) {
  console.error(`Bulwark needs Node.js 22.6 or newer, and this is ${process.versions.node}. Get the current LTS from https://nodejs.org.`);
  process.exit(1);
}

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
if (process.features.typescript) {
  const { main } = await import(pathToFileURL(cli).href);
  await main(process.argv.slice(2));
} else {
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", cli, ...process.argv.slice(2)], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
