// Chrome's DevTools Protocol: how Chrome's own "inspect" page looks inside a browser on another
// device. Android's WebView offers it on a socket of its own ("webview_devtools_remote_<pid>") when
// an app allows debugging, and only to ADB. Patch's TV browser allows it, which is how Patch reads
// a web page on the TV and clicks and types in it.
//
// The browser speaks plain HTTP on that socket (a list of its pages, as JSON) and a WebSocket per
// page (requests with an id, answers with the same id, and events in between). `open` below is
// whatever opens a new stream to the socket: over ADB for a TV, over TCP for a test browser.
import { EventEmitter } from "node:events";
import { wsUpgrade } from "./websocket.mjs";

const err = (message, code, extra = {}) => Object.assign(new Error(message), { code, ...extra });

/** One HTTP GET on a fresh stream; resolves with the JSON it answers. */
export function httpJson(open, path, { timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let socket = null;
    let done = false;
    let buf = Buffer.alloc(0);
    const finish = (e, v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket?.destroy();
      e ? reject(e) : resolve(v);
    };
    const timer = setTimeout(() => finish(err("The browser on the TV didn't answer.", "ETIMEDOUT")), timeout);
    const parse = (final) => {
      const end = buf.indexOf("\r\n\r\n");
      if (end === -1) return final ? finish(err("The browser on the TV answered with something unexpected.", "EPROTO")) : null;
      const head = buf.subarray(0, end).toString("latin1");
      const status = Number(head.split(" ")[1]);
      const length = Number(head.match(/^content-length:\s*(\d+)/im)?.[1] ?? NaN);
      const body = buf.subarray(end + 4);
      if (!final && (Number.isNaN(length) || body.length < length)) return null;
      if (status !== 200) return finish(err(`The browser on the TV refused that (HTTP ${status}).`, "EREFUSED", { status }));
      try {
        finish(null, JSON.parse(body.subarray(0, Number.isNaN(length) ? body.length : length).toString("utf8")));
      } catch {
        finish(err("The browser on the TV answered with something unexpected.", "EPROTO"));
      }
      return null;
    };
    Promise.resolve()
      .then(open)
      .then((s) => {
        socket = s;
        if (done) return s.destroy();
        s.on("data", (d) => {
          buf = Buffer.concat([buf, d]);
          if (buf.length > 4 * 1024 * 1024) return finish(err("The browser on the TV sent too much.", "EPROTO"));
          parse(false);
        });
        s.on("error", (e) => finish(e));
        s.on("close", () => parse(true));
        // Chrome only answers when the Host is "localhost" or an address (not a name from the internet).
        s.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
      })
      .catch((e) => finish(e));
  });
}

/** A DevTools session with one page: send(method, params) and events by name. */
export class CdpSession extends EventEmitter {
  constructor(ws) {
    super();
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.open = true;
    ws.on("message", (text) => {
      ws.inbox.length = 0; // every message is handled here; nothing waits for them later
      let m;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (m.id != null) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.reject(err(m.error.message || "The browser refused that.", "ECDP", { cdp: m.error.code, method: p.method }));
        else p.resolve(m.result || {});
      } else if (m.method) {
        this.emit("event", m.method, m.params || {});
        this.emit(m.method, m.params || {});
      }
    });
    ws.on("error", () => {});
    ws.on("close", () => {
      this.open = false;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(err("The browser on the TV closed the connection.", "ECONNRESET"));
      }
      this.pending.clear();
      this.emit("close");
    });
  }

  send(method, params = {}, { timeout = 10_000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.open) return reject(err("The browser on the TV closed the connection.", "ECONNRESET"));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(err("The browser on the TV took too long to answer.", "ETIMEDOUT", { method }));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  close() {
    this.open = false;
    this.ws.close();
  }
}

/** A page's own note about itself on Android ({ attached, visible, empty, width, height }), if it has one. */
function pageNote(p) {
  try {
    return p.description ? JSON.parse(p.description) : {};
  } catch {
    return {};
  }
}

/** The pages the browser has open, the one on screen first. */
export async function listPages(open, opts) {
  const list = await httpJson(open, "/json", opts);
  if (!Array.isArray(list)) throw err("The browser on the TV answered with something unexpected.", "EPROTO");
  const score = (p) => {
    const n = pageNote(p);
    return (n.visible === false ? 0 : 4) + (n.attached === false ? 0 : 2) + (n.empty ? 0 : 1);
  };
  return list.filter((p) => p.type === "page" && p.webSocketDebuggerUrl).sort((a, b) => score(b) - score(a));
}

/** Connect to the page the browser is showing. Resolves with { session, page: { id, url, title } }. */
export async function connectPage(open, { timeout = 6000 } = {}) {
  const pages = await listPages(open, { timeout });
  if (!pages.length) throw err("The browser on the TV has no page open.", "ENOPAGE");
  const page = pages[0];
  const path = new URL(page.webSocketDebuggerUrl).pathname;
  const ws = await wsUpgrade(await open(), { path, host: "localhost", timeout });
  return { session: new CdpSession(ws), page: { id: page.id, url: page.url, title: page.title } };
}
