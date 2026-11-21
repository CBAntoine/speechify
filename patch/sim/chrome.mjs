// A real browser for tests, when this computer has one: Chrome or Chromium running with no window
// and its debugging port open, which is what a TV's browser offers Patch over ADB. The simulated
// Fire TV hands Patch's connection through to it, so the tests click and type in real pages with
// the same code Patch uses on a TV. Without a browser installed, those tests are skipped.
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/** A Chrome or Chromium on this computer, or null. PATCH_TEST_CHROME names one to use. */
export function findChrome() {
  const named = [process.env.PATCH_TEST_CHROME, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"];
  for (const p of named) if (p && fs.existsSync(p)) return p;
  // The browser Playwright installs, if it's here.
  for (const root of [process.env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers", path.join(os.homedir(), ".cache", "ms-playwright")]) {
    if (!root || !fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).filter((d) => /^chromium(-\d+)?$/.test(d)).sort().reverse()) {
      for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const p = path.join(root, dir, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

/**
 * Start it. Resolves with { port, open, close }: `open()` gives a new connection to its debugging
 * port, as Patch gets one over ADB on a TV. The window is the size of a TV's web page (960 by 540,
 * which a 1080p TV shows at twice the size).
 */
export async function startChrome({ width = 960, height = 540, binary = findChrome() } = {}) {
  if (!binary) throw new Error("No Chrome or Chromium on this computer.");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "patch-chrome-"));
  const child = spawn(
    binary,
    [
      "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking", "--disable-sync", "--mute-audio", "--hide-scrollbars",
      // A TV's WebView keeps a page and the parts from other sites together, as this does.
      "--disable-features=IsolateOrigins,site-per-process,Translate,MediaRouter",
      "--remote-debugging-port=0", `--user-data-dir=${profile}`, `--window-size=${width},${height}`, "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome didn't start: ${stderr.slice(-300)}`)), 20_000);
    child.stderr.on("data", (d) => {
      stderr += d;
      const m = stderr.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome stopped (${code}): ${stderr.slice(-300)}`));
    });
  }).catch((e) => {
    child.kill("SIGKILL");
    fs.rmSync(profile, { recursive: true, force: true });
    throw e;
  });
  child.stderr.removeAllListeners("data");
  child.stderr.resume();
  const open = () =>
    new Promise((resolve, reject) => {
      const s = net.connect(port, "127.0.0.1");
      s.once("connect", () => resolve(s));
      s.once("error", reject);
    });
  const close = () =>
    new Promise((resolve) => {
      // Chrome's helper processes can still be writing as it stops: try a few times, and never fail a test over it.
      const tidy = () => fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {}).then(resolve);
      if (child.exitCode != null) return tidy();
      child.once("exit", tidy);
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode == null && child.kill("SIGKILL"), 3000).unref();
    });
  return { port, open, close, pid: child.pid };
}
