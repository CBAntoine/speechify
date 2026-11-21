// A pretend browser for the simulated Fire TV, for demo mode and for tests on computers with no
// Chrome: it answers Patch's DevTools connection for a small pretend website, so Patch can open a
// page, list it, choose links, type in its search box and go back. It doesn't run Patch's page
// script (src/tvweb/page.js): it answers for it, with the same replies the script gives.
//
// Every address shows the same kind of page: a few links, a search box and some words. Tests that
// need real pages put a real Chrome behind the simulated TV instead (sim/chrome.mjs).
import http from "node:http";
import net from "node:net";
import { acceptUpgrade } from "../src/net/websocket.mjs";

const SECTIONS = ["News", "Weather", "Sport"];
const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "start";
  } catch {
    return "start";
  }
};

/** What an address shows: { title, items: [{ kind, text, state?, goes? }], words: [...] }. */
function pageAt(url, value = "") {
  let u;
  try {
    u = new URL(url);
  } catch {
    u = new URL("about:blank");
  }
  const host = hostOf(url);
  if (u.protocol === "about:" || u.hostname === "appassets.androidplatform.net") {
    return { title: "Patch's browser", items: [{ kind: "Text box", text: "Search the web, or type an address", state: value ? `says: ${value}` : "empty", search: "https://www.google.com/search?q=" }, { kind: "Button", text: "Go" }], words: [["Heading", "Patch's browser"], ["Text", "Patch can see the pages you open here, and click, type and scroll for you."]] };
  }
  const search = `${u.origin}/search?q=`;
  const box = { kind: "Text box", text: `Search ${host}`, state: value ? `says: ${value}` : "empty", search };
  const q = u.pathname === "/search" ? u.searchParams.get("q") || "" : null;
  if (q != null) {
    return {
      title: `${q} - ${host} search`,
      items: [{ kind: "Link", text: host, goes: `${u.origin}/` }, { ...box, state: `says: ${value || q}` }, ...[1, 2, 3].map((n) => ({ kind: "Link", text: `Result ${n} for ${q}`, goes: `${u.origin}/result-${n}?about=${encodeURIComponent(q)}` }))],
      words: [["Heading", `Results for “${q}”`], ["Text", "3 found. (A pretend page: Patch's demo doesn't open the real web.)"]],
    };
  }
  const section = SECTIONS.find((s) => u.pathname === `/${s.toLowerCase()}`);
  const result = u.pathname.match(/^\/result-(\d)$/);
  if (section || result) {
    const name = section || `Result ${result[1]} for ${u.searchParams.get("about") || "your search"}`;
    return { title: `${name} - ${host}`, items: [{ kind: "Link", text: host, goes: `${u.origin}/` }, { kind: "Link", text: "Back to the front page", goes: `${u.origin}/` }], words: [["Heading", name], ["Text", `This is the ${name} page of ${host}. (A pretend page: Patch's demo doesn't open the real web.)`]] };
  }
  return {
    title: `${host}: front page`,
    items: [...SECTIONS.map((s) => ({ kind: "Link", text: s, goes: `${u.origin}/${s.toLowerCase()}` })), box, { kind: "Button", text: "Search" }, { kind: "Button", text: "Buy now", stays: true }],
    words: [["Heading", `Welcome to ${host}`], ["Text", "A pretend page: Patch's demo doesn't open the real web."]],
  };
}

/** Start it. Resolves with { open, close, state }: open() is a new connection to its debugging port. */
export async function startPretendBrowser() {
  const state = { url: "about:blank", history: ["about:blank"], index: 0, clicks: [], typed: [] };
  const server = http.createServer((req, res) => {
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "")) return res.writeHead(403).end();
    if (req.url === "/json" || req.url === "/json/list") {
      const body = JSON.stringify([{ description: JSON.stringify({ attached: true, empty: false, visible: true, width: 960, height: 540 }), id: "PAGE1", title: pageAt(state.url).title, type: "page", url: state.url, webSocketDebuggerUrl: "ws://localhost/devtools/page/PAGE1" }]);
      return res.writeHead(200, { "content-type": "application/json; charset=UTF-8", "content-length": Buffer.byteLength(body) }).end(body);
    }
    res.writeHead(404).end();
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/devtools/page/PAGE1") return socket.destroy();
    const ws = acceptUpgrade(req, socket, head);
    if (!ws) return;
    // What the page's own copy of Patch's script would remember.
    const page = { hasScript: false, value: "", target: null, watching: null, focused: false, id: "p1" };
    const event = (method, params) => ws.open && ws.send({ method, params });
    const go = (url, { push = true } = {}) => {
      state.url = url;
      if (push) {
        state.history = [...state.history.slice(0, state.index + 1), url];
        state.index = state.history.length - 1;
      }
      Object.assign(page, { hasScript: false, value: "", target: null, watching: null, focused: false, id: `p${Date.now() % 100000}` });
      event("Page.frameStartedLoading", { frameId: "MAIN" });
      event("Page.frameNavigated", { frame: { id: "MAIN", url } });
      setTimeout(() => event("Page.frameStoppedLoading", { frameId: "MAIN" }), 20);
    };
    const now = () => pageAt(state.url, page.value);
    const spot = (i) => ({ x: 120, y: 60 + i * 40 });
    const find = (target) => {
      const items = now().items;
      if (typeof target === "number") return items[target - 1] ? { item: items[target - 1], i: target - 1 } : { error: "number", count: items.length };
      const want = String(target).toLowerCase().trim();
      const i = items.findIndex((it) => it.text.toLowerCase() === want);
      const j = i >= 0 ? i : items.findIndex((it) => it.text.toLowerCase().includes(want));
      return j >= 0 ? { item: items[j], i: j } : { error: "none", close: items.slice(0, 4).map((it) => it.text) };
    };
    const info = (it, i) => ({ kind: it.kind, text: it.text, state: it.state || "", href: it.goes || "", secret: false, inForm: !!it.search, tag: it.kind === "Link" ? "A" : it.kind === "Text box" ? "INPUT" : "BUTTON", type: "", ...spot(i), moved: false });
    const press = (it) => {
      state.clicks.push(it.text);
      if (page.watching) Object.assign(page.watching, { clicked: true, hit: true });
      if (it.goes) setTimeout(() => go(it.goes), 10);
      else if (it.text === "Search" || it.text === "Go") submit();
    };
    const submit = () => {
      const box = now().items.find((it) => it.search);
      if (box && page.value) setTimeout(() => go(box.search + encodeURIComponent(page.value)), 10);
    };
    // The functions of src/tvweb/page.js that Patch calls, answered for this pretend page. As there,
    // a check that names another page's id is told only that the page has changed.
    const same = (id) => !id || id === page.id;
    const nothing = () => ({ clicked: false, hit: false, key: false, keyLeft: false, sent: false, move: null });
    const script = {
      status: () => ({ id: page.id, url: state.url, title: now().title, ready: "complete", quiet: 999 }),
      snapshot: () => {
        const p = now();
        let n = 0;
        const lines = [...p.words.map(([kind, text]) => ({ kind, text })), ...p.items.map((it) => ({ n: ++n, kind: it.kind, text: it.text, state: it.state }))];
        return { v: 0, id: page.id, url: state.url, title: p.title, ready: "complete", lines, shown: p.items.length, extra: 0, above: 0, below: 0, scroll: { y: 0, max: 0, page: 540 }, frames: [] };
      },
      locate: (target) => {
        const f = find(target);
        if (f.error) return f;
        page.target = f;
        return info(f.item, f.i);
      },
      watch: () => {
        page.watching = nothing();
        return page.id;
      },
      seenSoFar: (id) => (same(id) ? page.watching || nothing() : { changed: true }),
      watched: (id) => {
        if (!same(id)) return { changed: true };
        const seen = page.watching || nothing();
        page.watching = null;
        return seen;
      },
      clickNow: (id) => {
        if (!same(id) || !page.target) return false;
        press(page.target.item);
        return true;
      },
      field: (target) => {
        const f = target == null ? find(now().items.find((it) => it.kind === "Text box")?.text ?? "\u0000") : find(target);
        if (f.error) return target == null ? { error: "nofield" } : f;
        if (f.item.kind !== "Text box") return { error: "nottext", kind: f.item.kind, text: f.item.text };
        page.focused = true;
        return { ...info(f.item, f.i), focused: true, pid: page.id };
      },
      fieldValue: (id) => (same(id) && page.focused ? page.value : null),
      setValue: (text, id) => {
        if (!same(id)) return false;
        page.value = String(text);
        return true;
      },
      enterTarget: () => ({ inField: page.focused, inForm: page.focused, button: page.focused ? "Search" : "", secret: false, sends: page.focused, text: "" }),
      submitNow: (id) => {
        if (!same(id)) return false;
        submit();
        return true;
      },
      choose: () => ({ error: "notmenu" }),
      scroll: () => ({ moved: false }),
      find: (words) => {
        const hit = now().words.find(([, text]) => text.toLowerCase().includes(String(words).toLowerCase()));
        return { count: hit ? 1 : 0, text: hit ? hit[1] : "" };
      },
      read: () => now().words.map(([, text]) => text).join(" "),
    };
    const methods = {
      "Page.enable": () => ({}),
      "Page.addScriptToEvaluateOnNewDocument": () => ({ identifier: "1" }),
      "Page.getFrameTree": () => ({ frameTree: { frame: { id: "MAIN", url: state.url } } }),
      "Page.createIsolatedWorld": () => ({ executionContextId: 7 }),
      "Page.navigate": ({ url }) => {
        if (/\.invalid(\/|$)/.test(hostOf(url))) return { frameId: "MAIN", errorText: "net::ERR_NAME_NOT_RESOLVED" };
        go(url);
        return { frameId: "MAIN" };
      },
      "Page.getNavigationHistory": () => ({ currentIndex: state.index, entries: state.history.map((url, id) => ({ id, url })) }),
      "Page.navigateToHistoryEntry": ({ entryId }) => {
        state.index = entryId;
        go(state.history[entryId], { push: false });
        return {};
      },
      "Page.handleJavaScriptDialog": () => ({}),
      "Runtime.evaluate": ({ expression }) => {
        // The page's message boxes (src/tvweb/boxes.js): this pretend page never shows any.
        if (expression.includes("__patchBoxes")) return { result: { type: "string", value: expression.includes("b.seen.splice") ? "[]" : "ok" } };
        if (expression.includes("var VERSION =")) {
          page.hasScript = true;
          return { result: { type: "number", value: 1 } };
        }
        const call = expression.match(/p\.(\w+)\((.*)\);return r===undefined/s);
        if (!call || !script[call[1]]) return { result: { type: "undefined" }, exceptionDetails: { text: "Uncaught", exception: { description: "ReferenceError: the pretend page can't run that" } } };
        if (!page.hasScript) return { result: { type: "string", value: "\u0000" } };
        const r = script[call[1]](...JSON.parse(`[${call[2]}]`));
        return { result: { type: "string", value: r === undefined ? "null" : JSON.stringify(r) } };
      },
      "Input.dispatchMouseEvent": ({ type, x, y }) => {
        if (type === "mouseMoved" && page.watching) page.watching.move = { x, y };
        if (type === "mouseReleased" && page.target) {
          const at = spot(page.target.i);
          if (Math.abs(at.x - x) < 6 && Math.abs(at.y - y) < 6) press(page.target.item);
        }
        return {};
      },
      "Input.insertText": ({ text }) => {
        if (page.focused) page.value = text;
        state.typed.push(text);
        return {};
      },
      "Input.dispatchKeyEvent": ({ type, key }) => {
        if (type === "keyDown" && key === "Enter") {
          if (page.watching) Object.assign(page.watching, { key: true, keyLeft: true, sent: page.focused && !!page.value });
          submit();
        }
        return {};
      },
    };
    ws.on("message", (text) => {
      let m;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      const fn = methods[m.method];
      if (!fn) return ws.send({ id: m.id, error: { code: -32601, message: `'${m.method}' wasn't found` } });
      ws.send({ id: m.id, result: fn(m.params || {}) });
    });
    ws.on("error", () => {});
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const sockets = new Set();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return {
    state,
    open: () =>
      new Promise((resolve, reject) => {
        const s = net.connect(port, "127.0.0.1");
        s.once("connect", () => resolve(s));
        s.once("error", reject);
      }),
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}
