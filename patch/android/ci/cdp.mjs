// Runs JavaScript in Patch's dashboard on the emulator (test builds only, through Chrome DevTools
// forwarded to port 9222). The DevTools connection can drop for a moment (the emulator is busy), so it
// tries a few times. With { gesture: true } the code runs as if the person had just tapped the page,
// which a file button needs before it may open Android's file picker.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(expression, gesture) {
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
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true, userGesture: gesture } }));
    });
  } finally {
    ws.close();
  }
}

/** The expression's value; throws with the page's error if it threw. */
export async function evaluate(expression, { gesture = false } = {}) {
  let result;
  for (let attempt = 1; ; attempt++) {
    try {
      result = await once(expression, gesture);
      break;
    } catch (err) {
      if (attempt >= 5) throw new Error(`DevTools: ${err.message}`);
      await sleep(1500);
    }
  }
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value ?? null;
}
