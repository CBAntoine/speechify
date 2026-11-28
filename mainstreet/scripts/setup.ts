import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `npm run setup`: checks Node, FFmpeg and a headless browser, creates .env
// and builds the dashboard. Safe to run again.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ok = (s: string) => console.log(`  ✓ ${s}`);
const bad = (s: string) => console.log(`  ✗ ${s}`);
const has = (cmd: string, args = ["-version"]) => spawnSync(cmd, args, { stdio: "ignore" }).status === 0;

console.log("\nSetting up Mainstreet\n");
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  bad(`Node ${process.versions.node} is too old. Install Node 22.13 or newer (nodejs.org).`);
  process.exit(1);
}
ok(`Node ${process.versions.node}`);

if (has(process.env.FFMPEG_PATH || "ffmpeg")) ok("FFmpeg");
else bad("FFmpeg isn't installed (videos need it). macOS: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg · Windows: winget install Gyan.FFmpeg");

const { browserAvailable, closeBrowser } = await import("../src/providers/browser.ts");
let br = await browserAvailable();
if (!br.ok) {
  console.log("  … installing headless Chromium for screenshots and videos (one time)");
  spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["playwright", "install", "chromium"], { stdio: "inherit", cwd: root });
  br = await browserAvailable();
}
if (br.ok) ok(`Headless browser (${br.how})`);
else bad(`No headless browser: ${br.error}`);
await closeBrowser();

const env = path.join(root, ".env");
if (!fs.existsSync(env)) {
  fs.copyFileSync(path.join(root, ".env.example"), env);
  ok("Created .env from .env.example (add your keys there)");
} else ok(".env exists");

console.log("  … building the dashboard");
const build = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--config", "web/vite.config.ts", "--logLevel", "warn"], { stdio: "inherit", cwd: root });
if (build.status === 0) ok("Dashboard built");
else bad("The dashboard didn't build. Run npm run build to see why.");

console.log(`
Next:
  npm run demo      try it on fictional businesses (nothing is sent)
  npm start         run it for real, after adding keys to .env
  npm run doctor    see which keys and tools are working
  npm run voice:sync   create Atlas in your ElevenLabs workspace
`);
