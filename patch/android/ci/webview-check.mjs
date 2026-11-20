// Looks inside Patch's screen on the emulator through Chrome DevTools (test builds only): the dashboard
// loads without script errors, lists this phone, opens a device's panel, and the back button closes it.
// Saves small screenshots, and prints them into the build log (base64 between PATCH_SHOT markers).
// Usage: node webview-check.mjs <folder for results>   (with the WebView's DevTools forwarded to port 9222)
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const targets = await (await fetch("http://127.0.0.1:9222/json/list")).json();
const page = targets.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:4545"));
if (!page) {
  console.error("Patch's page isn't open:", targets.map((t) => t.url));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 0;
const pending = new Map();
const problems = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id) {
    pending.get(m.id)?.(m);
    pending.delete(m.id);
    return;
  }
  if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    problems.push(`exception: ${d.exception?.description || d.text}`);
  } else if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
    problems.push(`console.${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
  } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
    problems.push(`log: ${m.params.entry.text} ${m.params.entry.url || ""}`.trim());
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const shot = async (name) => {
  const { w, h, dpr } = await run("({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })");
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 62, clip: { x: 0, y: 0, width: w, height: h, scale: 1 / dpr } });
  fs.writeFileSync(path.join(out, `${name}.jpg`), Buffer.from(data, "base64"));
  console.log(`PATCH_SHOT_BEGIN ${name}`);
  for (let i = 0; i < data.length; i += 4000) console.log(data.slice(i, i + 4000));
  console.log(`PATCH_SHOT_END ${name}`);
};

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");
// Load the page again with everything listening, so no early error is missed.
await send("Page.reload", { ignoreCache: true });
await sleep(7000);
// The first capture can come out at the wrong scale; take (and drop) one.
await send("Page.captureScreenshot", { format: "jpeg", quality: 10 }).catch(() => {});

const info = await run(`(() => ({
  phoneApp: !!window.PatchAndroid,
  greeting: document.querySelector(".hero__hello h1")?.textContent,
  summary: document.querySelector(".hero__hello p")?.textContent,
  cards: document.querySelectorAll(".card").length,
  rows: document.querySelectorAll(".row-item").length,
  thisPhone: document.querySelector('[data-id="self:computer"]')?.textContent.replace(/\\s+/g, " ").trim() || null,
  footer: document.querySelector("#voiceFine")?.textContent,
  exportHidden: document.querySelector("#exportBtn")?.hidden,
  screen: innerWidth + "x" + innerHeight + " @" + devicePixelRatio + "x",
  overflow: document.documentElement.scrollWidth - innerWidth,
  webView: navigator.userAgent.match(/Chrome\\/[\\d.]+/)?.[0],
}))()`);
console.log(JSON.stringify(info, null, 2));
await shot("home");

// This phone's own panel.
await run(`document.querySelector('[data-id="self:computer"]')?.click()`);
await sleep(900);
const panel = await run(`document.querySelector("#drawer.is-open .drawer__head")?.textContent.replace(/\\s+/g, " ").trim() || null`);
console.log("Panel:", panel);
await shot("this-phone");
const backClosed = await run("window.__patchBack()");
const stillOpen = await run(`!!document.querySelector("#drawer.is-open")`);

// The chat sheet ("Talk to Patch" on phones).
await run(`document.querySelector("#voiceFab")?.click()`);
await sleep(700);
await shot("chat");
await run("window.__patchBack()");
ws.close();

const checks = [
  [info.phoneApp, "the dashboard can reach the app (window.PatchAndroid)"],
  [/this phone/.test(info.footer || ""), "the dashboard says devices are controlled from this phone"],
  [!!info.thisPhone, "this phone is in the list"],
  [!!panel, "a device's panel opens"],
  [backClosed === true && !stillOpen, "the back button closes the panel"],
  [info.overflow <= 0, "nothing spills off the side of the screen"],
];
for (const [ok, what] of checks) console.log(`${ok ? "ok" : "NOT OK"}: ${what}`);
const exceptions = problems.filter((p) => p.startsWith("exception"));
if (problems.length) console.log("Messages from the page:\n" + problems.map((p) => `  - ${p}`).join("\n"));
process.exit(checks.every(([ok]) => ok) && !exceptions.length ? 0 : 1);
