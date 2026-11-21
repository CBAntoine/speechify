// A web page on a TV, the way Patch uses one: open a site, list what's on it, choose things by
// number or by their words, type, press Enter, scroll and go back, and say what the page shows after
// each step. It talks to the browser through Chrome's DevTools Protocol (src/net/cdp.mjs) and to
// the page through page.js, which Patch sends into the page.
//
// Clicks and typing go in as real ones (the browser treats them as the person's own), and each is
// checked from inside the page; when one doesn't arrive, the page is told directly instead.
import fs from "node:fs";
import { connectPage } from "../net/cdp.mjs";
import { riskyButton } from "../net/phone.mjs";
import { DeviceError } from "../drivers/common.mjs";
import { sleep } from "../util.mjs";

const PAGE_JS = fs.readFileSync(new URL("./page.js", import.meta.url), "utf8");
export const PAGE_VERSION = Number(PAGE_JS.match(/var VERSION = (\d+);/)?.[1]);
// The page's message boxes, while Patch is carrying out a step (see boxes.js).
const BOXES_JS = fs.readFileSync(new URL("./boxes.js", import.meta.url), "utf8");
// How long one step may keep the boxes for itself, by the page's own clock.
const STEP_MS = 9000;
const forget = `try{window.sessionStorage.removeItem("__patchBoxes")}catch(e){}`;
const takeBoxes = (yes) => `(function(){var b=window.__patchBoxes;if(!b)return "none";b.until=Date.now()+${STEP_MS};b.yes=${yes ? "true" : "false"};b.seen.length=0;${forget};return "ok"})()`;
const GIVE_BOXES = `(function(){var b=window.__patchBoxes;if(!b)return "[]";b.until=0;b.yes=false;${forget};return JSON.stringify(b.seen.splice(0,b.seen.length))})()`;
// How long to wait for the page to hear of a pointer move (it hears with its next frame, which a
// busy TV can take a while to draw), and of a press.
const MOVE_WAIT = 720;
const PRESS_WAIT = 900;

// The page's own world went away (it's moving to another page): wait and look again.
const gone = (e) => e?.code === "ECDP" && /context|navigat|destroyed|detached|closed/i.test(e.message || "");
const jsArg = (a) => JSON.stringify(a ?? null).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
// Links only go somewhere, so fewer of them need the person's yes than buttons do.
const RISKY_LINK = /\b(buy|pay|payment|purchase|checkout|check out|place order|subscribe|donate|delete|sign out|log out|logout)\b/i;
const risky = (info) => (info.kind === "Link" ? RISKY_LINK.test(info.text || "") : riskyButton(info.text));

/**
 * How steps have gone in since Patch started: as real clicks and typing (the browser's own input),
 * or told to the page directly when those didn't arrive. The Android build prints these after
 * using a real WebView, to show which way a real TV takes them.
 */
export const stats = { clicks: 0, clicksInside: 0, strays: 0, aims: 0, typed: 0, typedInside: 0, enters: 0, entersInside: 0, boxes: 0, boxesOutside: 0, misses: [] };
const missed = (what, why) => {
  if (stats.misses.length < 30) stats.misses.push(`${what}: ${why}`);
};

export const hostOf = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "about:" || u.protocol === "data:" ? "" : u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** A page's own id, from a script that gives one (the pretend browser in old tests didn't). */
const pageId = (v) => (typeof v === "string" && v ? v : null);

const more = (n) => (n === 1 ? "1 more link or button" : `${n} more links and buttons`);

/** The page as words: a title line, then what's on screen from the top, numbered where it can be chosen. */
export function describePage(m, { where = "Patch's browser" } = {}) {
  const host = hostOf(m.url);
  const title = m.title || host || "A page";
  const lines = (m.lines || []).map((l) => `${l.n ? `${l.n}. ` : ""}${l.kind}: ${l.text}${l.state ? ` (${l.state})` : ""}`);
  const tail = [];
  const atTop = m.scroll.y < 8;
  const atEnd = m.scroll.y >= m.scroll.max - 8;
  if (m.scroll.max < 8) tail.push("That's the whole page.");
  else if (atTop) tail.push(`This is the top of the page; it goes on below${m.below ? ` (${more(m.below)})` : ""}.`);
  else if (atEnd) tail.push("This is the bottom of the page.");
  else tail.push(`This is part of the way down the page${m.below ? `; ${more(m.below)} below` : ""}.`);
  if (m.extra) tail.push(`Only the first ${m.shown} things on screen are listed; ${m.extra} more are there. Say the words of the one you want.`);
  if (m.frames?.length) tail.push(`Part of it comes from ${m.frames.join(", ")}, which I can't read.`);
  if (m.ready !== "complete") tail.push("It's still loading.");
  return {
    title,
    host,
    summary: `“${title}”${host ? ` (${host})` : ""}: ${m.shown} ${m.shown === 1 ? "thing" : "things"} to choose on screen.`,
    text: [`On screen: ${title}${host ? ` (${host})` : ""}, in ${where}.`, ...lines, `(${tail.join(" ")})`].join("\n"),
  };
}

export class WebSession {
  constructor(cdp) {
    this.cdp = cdp;
    this.frameId = null;
    this.contextId = null;
    this.mainWorld = false;
    this.loading = false;
    this.dialog = null;
    cdp.on("Page.frameStartedLoading", ({ frameId }) => {
      if (frameId === this.frameId) this.loading = true;
    });
    cdp.on("Page.frameStoppedLoading", ({ frameId }) => {
      if (frameId === this.frameId) this.loading = false;
    });
    cdp.on("Page.frameNavigated", ({ frame }) => {
      if (frame && !frame.parentId) {
        this.frameId = frame.id;
        this.contextId = null;
      }
    });
    // A page's own message box stops the page until it's answered. During a step, boxes.js answers
    // them inside the page. One that gets past it (a box from another frame, or as a page loads) is
    // answered here at once if Patch is in the middle of a step: an "OK" box is accepted, a question
    // ("Are you sure?") gets Cancel unless the person has already said yes to this step. At any
    // other time the box is the person's, with the remote; Patch answers it only if it's still up
    // when Patch next needs the page.
    this.sayYes = false;
    this.busyUntil = 0;
    this.pending = null;
    this.moveWait = MOVE_WAIT;
    cdp.on("Page.javascriptDialogOpening", ({ type, message }) => {
      const box = { type, message: String(message || "").slice(0, 300) };
      if (Date.now() < this.busyUntil) this.#answer(box);
      else this.pending = box;
    });
    cdp.on("Page.javascriptDialogClosed", () => {
      this.pending = null;
    });
  }

  #answer(box) {
    const accept = box.type === "alert" || box.type === "beforeunload" || (box.type === "confirm" && this.sayYes);
    this.pending = null;
    this.dialog = { ...box, accepted: accept };
    stats.boxesOutside++;
    return this.cdp.send("Page.handleJavaScriptDialog", { accept }, { timeout: 4000 }).catch(() => {});
  }

  /** Connect to the page the browser is showing. `open` opens a new stream to the browser's debugging socket. */
  static async connect(open, { timeout = 6000 } = {}) {
    const { session } = await connectPage(open, { timeout });
    const s = new WebSession(session);
    try {
      await session.send("Page.enable");
      const tree = await session.send("Page.getFrameTree");
      s.frameId = tree.frameTree.frame.id;
    } catch (e) {
      session.close();
      throw e;
    }
    // boxes.js goes into every page from now on, before the page's own scripts, and into this one.
    await session.send("Page.addScriptToEvaluateOnNewDocument", { source: BOXES_JS }).catch(() => session.send("Page.addScriptToEvaluateOnLoad", { scriptSource: BOXES_JS }).catch(() => {}));
    await s.#main(BOXES_JS);
    return s;
  }

  get alive() {
    return this.cdp.open;
  }

  close() {
    this.cdp.close();
  }

  // ── Talking to the page ──────────────────────────────────────────────────

  async #world() {
    if (this.mainWorld) return 0;
    if (this.contextId) return this.contextId;
    try {
      const r = await this.cdp.send("Page.createIsolatedWorld", { frameId: this.frameId, worldName: "patch" });
      this.contextId = r.executionContextId;
    } catch (e) {
      if (gone(e) || e.code !== "ECDP") throw e;
      // A browser too old for a world of Patch's own: share the page's.
      this.mainWorld = true;
      return 0;
    }
    return this.contextId;
  }

  /** Run something in the page's own world, where its scripts live. Undefined if the page can't answer just now. */
  async #main(expression) {
    try {
      const r = await this.cdp.send("Runtime.evaluate", { expression, returnByValue: true }, { timeout: 4000 });
      return r.exceptionDetails ? undefined : r.result?.value;
    } catch (e) {
      if (e?.code === "ECDP" || e?.code === "ETIMEDOUT") return undefined;
      throw e;
    }
  }

  /** A step begins: until it's done, the page's message boxes are answered and noted, not shown (boxes.js). */
  async #begin(yes = false, ms = STEP_MS) {
    this.sayYes = yes;
    this.busyUntil = Date.now() + ms;
    if ((await this.#main(takeBoxes(yes))) === "none") {
      await this.#main(BOXES_JS);
      await this.#main(takeBoxes(yes));
    }
  }

  /** The step is over: the boxes are the person's again. Resolves with the ones the page showed meanwhile. */
  async #end() {
    this.busyUntil = 0;
    this.sayYes = false;
    try {
      return JSON.parse((await this.#main(GIVE_BOXES)) || "[]");
    } catch {
      return [];
    }
  }

  async #eval(expression) {
    // A message box left up on the page (one the person hasn't answered) stops the page: answer it first.
    if (this.pending) await this.#answer(this.pending);
    const contextId = await this.#world();
    const r = await this.cdp.send("Runtime.evaluate", { expression, returnByValue: true, ...(contextId ? { contextId } : {}) }, { timeout: 8000 });
    if (r.exceptionDetails) throw new DeviceError(`The page didn't let Patch look at it (${String(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "script error").split("\n")[0].slice(0, 120)}).`, { code: "EPAGE" });
    return r.result?.value;
  }

  /** Call one of page.js's functions in the page, sending page.js first if the page doesn't have it yet. */
  async call(method, ...args) {
    const expr = `(function(){var p=self.__patch;if(!p||p.v!==${PAGE_VERSION})return "\\u0000";var r=p.${method}(${args.map(jsArg).join(",")});return r===undefined?"null":JSON.stringify(r)})()`;
    for (let attempt = 0; ; attempt++) {
      try {
        let out = await this.#eval(expr);
        if (out === "\u0000") {
          await this.#eval(PAGE_JS);
          out = await this.#eval(expr);
        }
        return JSON.parse(out);
      } catch (e) {
        if (!gone(e) || attempt >= 4) throw e;
        this.contextId = null;
        await sleep(150 * (attempt + 1));
      }
    }
  }

  /**
   * Waits for the page to finish what it's doing: loading another page, or redrawing itself after a
   * click. `min` is how long to give a click to start something before believing nothing will.
   */
  async settle({ min = 0, timeout = 12_000 } = {}) {
    const start = Date.now();
    let st = null;
    for (;;) {
      try {
        st = await this.call("status");
      } catch (e) {
        if (!gone(e) && e.code !== "ETIMEDOUT") throw e;
        st = null;
      }
      const waited = Date.now() - start;
      if (waited >= min && st && !this.loading) {
        if (st.ready === "complete" && st.quiet >= 300) return st;
        // Pages that never stop changing (tickers, adverts): once they're usable, that's enough.
        if (st.ready !== "loading" && waited >= min + 2500) return st;
      }
      if (waited > timeout) return st || { ready: "loading", url: "", title: "" };
      await sleep(120);
    }
  }

  async snapshot() {
    return this.call("snapshot");
  }

  /** What a step did, and the page as it is afterwards. */
  async #after(result, opts) {
    await this.settle(opts);
    const said = await this.#end();
    stats.boxes += said.length;
    // A question that got "no" comes first (the person decides it); else the last thing the page said.
    const dialog = said.find((d) => d.type === "confirm" && !d.accepted) || said[said.length - 1] || this.dialog;
    this.dialog = null;
    return { ...result, ...(dialog ? { dialog } : {}), page: await this.snapshot() };
  }

  // ── Steps ────────────────────────────────────────────────────────────────

  async goto(url) {
    this.dialog = null;
    if (this.pending) await this.#answer(this.pending);
    // Leaving a page that asks "are you sure you want to leave?": yes, the person asked for another.
    this.busyUntil = Date.now() + 20_000;
    const r = await this.cdp.send("Page.navigate", { url }, { timeout: 20_000 });
    if (r.errorText && !/ERR_ABORTED/.test(r.errorText)) {
      const why = /NAME_NOT_RESOLVED/.test(r.errorText) ? "there's no site at that address" : /INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/.test(r.errorText) ? "the TV isn't on the internet" : /CONNECTION_REFUSED|CONNECTION_RESET|TIMED_OUT/.test(r.errorText) ? "the site didn't answer" : /CERT|SSL/.test(r.errorText) ? "the site's security certificate isn't right" : "it wouldn't load";
      throw new DeviceError(`${hostOf(url) || "That page"} didn't open: ${why}.`, { code: "ENAVIGATE" });
    }
    this.contextId = null;
    return this.#after({}, { min: 300, timeout: 20_000 });
  }

  /** Find something by its number in the last list, or by its words, and bring it into view. */
  async #locate(target) {
    let info = await this.call("locate", target);
    if (info.moved && !info.error) {
      // It was scrolled into view: let the page settle (pictures loading in), then aim again.
      await sleep(180);
      info = await this.call("locate", target);
    }
    if (!info.error) return info;
    const page = await this.snapshot().catch(() => null);
    const screen = page ? describePage(page).text : undefined;
    if (info.error === "number") throw Object.assign(new DeviceError(info.count ? `There are only ${info.count} numbered things on the page.` : "I need to look at the page first, so the numbers are right.", { code: info.count ? "EVALUE" : "ESTALE" }), { screen });
    if (info.error === "gone") throw Object.assign(new DeviceError("The page has changed since I listed it. Here's what it shows now.", { code: "ESTALE" }), { screen });
    if (info.error === "hidden") throw Object.assign(new DeviceError("That's on the page but hidden right now (it may be inside a menu that needs opening first).", { code: "EHIDDEN" }), { screen });
    throw Object.assign(new DeviceError(`I can't find “${String(target).slice(0, 60)}” on the page.${info.close?.length ? ` The closest are: ${info.close.join(", ")}.` : ""}`, { code: "ENOTFOUND" }), { screen });
  }

  /**
   * What the page saw of the step just sent to it. `id` is the page the step was sent to: if
   * another page has loaded in its place (the step opened it), the answer is { changed: true },
   * and that page is left alone.
   */
  async #seen(method, id) {
    try {
      return await this.call(method, id);
    } catch (e) {
      if (!gone(e)) throw e;
      return { changed: true };
    }
  }

  /**
   * A real click on a spot of the page, checked from inside the page. (x, y) is where to send it;
   * `want` is where the page should then say the pointer is. Resolves "sent"; "missed" when a
   * click can't be sent this way here; or "changed" when another page loaded before the press.
   */
  async #clickAt(x, y, id, want) {
    try {
      // Move the pointer first and see where the page says it arrived. If that isn't the spot (the
      // browser counts positions its own way on a zoomed page), aim again by how far off it was,
      // at the scale the last two moves show, before pressing.
      let sx = x;
      let sy = y;
      let last = null;
      for (let aim = 0; ; aim++) {
        const seen = await this.#moveTo(sx, sy, id, last && { x: last.mx, y: last.my });
        if (seen.changed) return "changed";
        const m = seen.move;
        if (!m) {
          // A browser that never passes the pointer on: stop waiting so long for it.
          this.moveWait = Math.max(160, Math.round(this.moveWait / 2));
          this.why = "the pointer's move didn't reach the page";
          return "missed";
        }
        this.moveWait = MOVE_WAIT;
        if (Math.abs(m.x - want.x) <= 3 && Math.abs(m.y - want.y) <= 3) break;
        this.why = `the pointer arrived at ${m.x}, ${m.y}, not ${want.x}, ${want.y}`;
        if (aim >= 3) return "missed";
        const scale = (sent, was, now, before) => (last && sent !== was && now !== before ? (now - before) / (sent - was) : 1) || 1;
        const ax = scale(sx, last?.sx, m.x, last?.mx);
        const ay = scale(sy, last?.sy, m.y, last?.my);
        last = { sx, sy, mx: m.x, my: m.y };
        sx = Math.round(sx + (want.x - m.x) / ax);
        sy = Math.round(sy + (want.y - m.y) / ay);
        if (!(sx >= 0 && sy >= 0 && sx < 20_000 && sy < 20_000)) return "missed";
      }
      this.why = "";
      await this.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: sx, y: sy, button: "left", buttons: 1, clickCount: 1 }, { timeout: 4000 });
      await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: sx, y: sy, button: "left", buttons: 0, clickCount: 1 }, { timeout: 4000 });
      return "sent";
    } catch (e) {
      if (gone(e)) return "sent"; // the page is already on its way somewhere else
      this.why = `the browser wouldn't take a click (${String(e?.message || e).slice(0, 80)})`;
      return "missed";
    }
  }

  /** Move the pointer and wait for the page to say where it arrived. `old` is where it was said to be before. */
  async #moveTo(x, y, id, old = null) {
    stats.aims++;
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, { timeout: 4000 });
    let seen = {};
    for (let waited = 0; waited < this.moveWait; waited += 40) {
      await sleep(40);
      seen = await this.#seen("seenSoFar", id);
      if (seen.changed || (seen.move && !(old && seen.move.x === old.x && seen.move.y === old.y))) break;
    }
    return seen;
  }

  /** Choose something on the page. Text boxes are made ready for typing rather than clicked. */
  async click(target, { confirmed = false } = {}) {
    const info = await this.#locate(target);
    if (risky(info) && !confirmed) throw new DeviceError(`“${info.text}” on this page could buy, send or delete something.`, { code: "ECONFIRM" });
    if (info.state && /greyed out/.test(info.state)) throw new DeviceError(`“${info.text}” is greyed out, so it can't be chosen right now.`, { code: "EDISABLED" });
    if (info.choices) return { ...(await this.#after({}, {})), chose: info, menu: info.choices };
    if (info.kind === "Text box" || info.kind === "Password box") {
      if (info.kind === "Password box" || info.secret) return { ...(await this.#after({}, {})), chose: info, secretBox: true };
      const f = await this.call("field", target);
      if (f.error) throw new DeviceError(`I couldn't get “${info.text}” ready for typing.`, { code: "EFIELD" });
      return { ...(await this.#after({}, {})), chose: info, ready: true };
    }
    if (info.x == null) {
      const page = await this.snapshot().catch(() => null);
      throw Object.assign(new DeviceError(`“${info.text}” is behind something else on the page${info.covered ? ` (“${info.covered}”)` : ""}. Deal with that first: it may have a Close or Accept button.`, { code: "ECOVERED" }), { screen: page ? describePage(page).text : undefined });
    }
    this.dialog = null;
    await this.#begin(confirmed);
    const id = pageId(await this.call("watch"));
    this.why = "";
    const sent = await this.#clickAt(info.x, info.y, id, { x: info.cx ?? info.x, y: info.cy ?? info.y });
    if (sent === "changed") {
      // Another page loaded by itself before the press: nothing was chosen, and the numbers are old.
      await this.#end();
      const page = await this.snapshot().catch(() => null);
      throw Object.assign(new DeviceError(`The page changed just as I went to choose “${info.text}”. Here's what it shows now.`, { code: "ESTALE" }), { screen: page ? describePage(page).text : undefined });
    }
    let seen = null;
    if (sent === "sent") {
      for (let waited = 0; waited < PRESS_WAIT; waited += 60) {
        await sleep(60);
        seen = await this.#seen("seenSoFar", id);
        if (seen.changed || seen.clicked) break;
      }
      if (!seen.changed) seen = await this.#seen("watched", id);
      if (!seen.clicked && !seen.changed) this.why = "the press didn't reach the page";
    }
    // It arrived if this page saw it, or if another page has loaded in its place (the click opened it).
    let stray = false;
    if (seen?.clicked || seen?.changed) {
      stats.clicks++;
      // The page moved under the click and something else got it. Clicking again could do a second
      // thing, so say so and show the page instead.
      if (!seen.changed && !seen.hit) {
        stray = true;
        stats.strays++;
      }
    } else {
      // The real click didn't arrive (an old browser, or the page was covered at the last moment):
      // click it from inside. Only ever on the page it was meant for.
      stats.clicksInside++;
      missed(`“${info.text}”`, this.why || "the click didn't reach the page");
      await this.call("clickNow", id).catch((e) => {
        if (!gone(e)) throw e;
      });
    }
    const after = await this.#after({}, { min: 400 }).finally(() => {
      this.sayYes = false;
      this.busyUntil = 0;
    });
    // The page asked a question and got Cancel: the person decides, then the same step says yes.
    if (after.dialog?.type === "confirm" && !after.dialog.accepted) {
      this.asked = { text: info.text, message: after.dialog.message };
      throw new DeviceError(`After “${info.text}”, the page asks: “${after.dialog.message}”`, { code: "ECONFIRM" });
    }
    // The yes took the page somewhere its note of the question couldn't follow (another site): Patch remembers it.
    if (confirmed && !after.dialog && this.asked?.text === info.text) after.dialog = { type: "confirm", message: this.asked.message, accepted: true };
    this.asked = null;
    return { ...after, chose: info, ...(stray ? { stray: true } : {}) };
  }

  /** Type into the box given (number or words), or the one in use, or the page's search box. Replaces what's there. */
  async type(text, target = null) {
    const f = await this.call("field", target);
    if (f.error === "secret") throw new DeviceError(`“${f.text || "That box"}” is for a password or card details. I don't type those: type it yourself with the TV's remote.`, { code: "ESECRET" });
    if (f.error === "nofield") throw new DeviceError("There's no box to type in on this page. Tell me which one, by its name or number.", { code: "ENOFIELD" });
    if (f.error === "nottext") throw new DeviceError(`“${f.text}” is a ${String(f.kind || "thing").toLowerCase()}, not a box to type in.`, { code: "ENOFIELD" });
    if (f.error) throw new DeviceError(`I can't find a box called “${String(target).slice(0, 60)}” on the page.`, { code: "ENOTFOUND" });
    const id = pageId(f.pid);
    let arrived = false;
    if (f.focused) {
      try {
        await this.cdp.send("Input.insertText", { text }, { timeout: 4000 });
        await sleep(60);
        const now = await this.call("fieldValue", id);
        arrived = now != null && String(now).replace(/\s+/g, " ").includes(text.replace(/\s+/g, " ").trim());
      } catch (e) {
        if (gone(e)) throw e;
      }
    }
    if (arrived) stats.typed++;
    else {
      stats.typedInside++;
      await this.call("setValue", text, id);
    }
    return { ...(await this.#after({}, { min: 150 })), typed: text, box: f };
  }

  /** Press Enter where typing goes (which sends a search or a form). */
  async enter({ confirmed = false } = {}) {
    const t = await this.call("enterTarget");
    if (t.button && riskyButton(t.button) && !confirmed) throw new DeviceError(`Pressing Enter here chooses “${t.button}”, which could buy, send or delete something.`, { code: "ECONFIRM" });
    this.dialog = null;
    await this.#begin(confirmed);
    const id = pageId(await this.call("watch"));
    const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    let seen = null;
    try {
      await this.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...key, text: "\r", unmodifiedText: "\r" }, { timeout: 4000 });
      await this.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key }, { timeout: 4000 });
      for (let waited = 0; waited < 480; waited += 60) {
        await sleep(60);
        seen = await this.#seen("seenSoFar", id);
        if (seen.changed || seen.key) break;
      }
      if (!seen.changed) seen = await this.#seen("watched", id);
    } catch (e) {
      if (gone(e)) seen = { changed: true };
    }
    // The key did its job if another page loaded in this one's place, or the form went, or the page
    // took the key for itself. If the key arrived and the page left it for the browser, but the form
    // it should have sent stayed where it was, this browser doesn't send forms on a key from Patch.
    const unsent = seen?.key && seen.keyLeft && t.sends && !seen.sent;
    if (seen?.changed || (seen?.key && !unsent)) stats.enters++;
    else {
      stats.entersInside++;
      missed("Enter", unsent ? "the key arrived, but the form it should have sent stayed put" : "the key didn't reach the page");
      await this.call("submitNow", id).catch((e) => {
        if (!gone(e)) throw e;
      });
    }
    return { ...(await this.#after({}, { min: 450 })), entered: t };
  }

  async scroll(dir = "down") {
    const d = /top|start|beginning/.test(dir) ? "top" : /bottom|end/.test(dir) ? "bottom" : /up/.test(dir) ? "up" : /left/.test(dir) ? "left" : /right/.test(dir) ? "right" : "down";
    const r = await this.call("scroll", d);
    return { ...(await this.#after({}, { min: 200 })), moved: !!r.moved, dir: d };
  }

  async back() {
    if (this.pending) await this.#answer(this.pending);
    const h = await this.cdp.send("Page.getNavigationHistory");
    if (!(h.currentIndex > 0)) return null;
    this.busyUntil = Date.now() + 10_000; // a page that asks before it's left: yes, go back
    await this.cdp.send("Page.navigateToHistoryEntry", { entryId: h.entries[h.currentIndex - 1].id });
    this.contextId = null;
    return this.#after({}, { min: 300 });
  }

  /** Choose an entry in a menu (a drop-down list) by its words. */
  async choose(target, words) {
    const r = await this.call("choose", target, words);
    if (r.error === "nochoice") throw new DeviceError(`That menu has no “${words}”. It has: ${r.choices.join(", ")}.`, { code: "EVALUE" });
    if (r.error) return null; // not a menu, or not on the page: the caller treats the words as something to click
    return { ...(await this.#after({}, { min: 300 })), chosen: r };
  }

  /** Find some words on the page and bring the first place into view. */
  async find(words) {
    const r = await this.call("find", words);
    return { ...(await this.#after({}, { min: 150 })), found: r };
  }

  /** The page's words from where the screen is, for reading out. */
  async read(max = 2500) {
    return this.call("read", max);
  }
}
