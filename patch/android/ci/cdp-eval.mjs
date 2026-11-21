// Runs one JavaScript expression in Patch's dashboard on the emulator (test builds only, through Chrome
// DevTools forwarded to port 9222) and prints the result as JSON. The DevTools connection can drop
// for a moment (the emulator is busy), so it tries a few times.
// Usage: node cdp-eval.mjs "window.PatchAndroid.screenAccess()"
const expression = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate() {
  const targets = await (await fetch("http://127.0.0.1:9222/json/list", { signal: AbortSignal.timeout(5000) })).json();
  const page = targets.find((t) => t.type === "page" && t.url.startsWith("http://127.0.0.1:4545"));
  if (!page) throw new Error(`Patch's page isn't open: ${targets.map((t) => t.url).join(", ")}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("DevTools didn't accept the connection"));
  });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("DevTools didn't answer")), 15_000);
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === 1) {
          clearTimeout(timer);
          resolve(m.result);
        }
      };
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
    });
  } finally {
    ws.close();
  }
}

let result;
for (let attempt = 1; ; attempt++) {
  try {
    result = await evaluate();
    break;
  } catch (err) {
    if (attempt >= 5) {
      console.error(`DevTools: ${err.message}`);
      process.exit(1);
    }
    await sleep(1500);
  }
}
if (result.exceptionDetails) {
  console.error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  process.exit(1);
}
console.log(JSON.stringify(result.result.value ?? null));
