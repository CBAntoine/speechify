// Runs one JavaScript expression in Patch's dashboard on the emulator (test builds only, through Chrome
// DevTools forwarded to port 9222) and prints the result as JSON.
// Usage: node cdp-eval.mjs "window.PatchAndroid.screenAccess()"
const expression = process.argv[2];
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
const result = await new Promise((resolve) => {
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === 1) resolve(m.result);
  };
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
});
ws.close();
if (result.exceptionDetails) {
  console.error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  process.exit(1);
}
console.log(JSON.stringify(result.result.value ?? null));
