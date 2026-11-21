// Runs in the page's own world (page.js keeps to one of its own). While Patch is carrying out a
// step, the page's message boxes (alert, confirm, prompt) are answered here and noted for Patch,
// instead of stopping the page and being drawn on the TV. On a TV the box is drawn by the app
// around the page, and it stays on the screen even after Patch has answered it through DevTools:
// a box nobody asked for, covering the page until someone presses OK on the remote.
//
// At any other time the boxes work as they always do, for the person holding the remote.
// Written in old-browser JavaScript, as page.js is.
(function () {
  if (window.__patchBoxes) return;
  var KEY = "__patchBoxes";
  var b = { until: 0, yes: false, seen: [] };
  try {
    Object.defineProperty(window, "__patchBoxes", { value: b });
  } catch (e) {
    window.__patchBoxes = b;
  }
  // A box is often the last thing a page does before it loads the next one ("Saved!", then on to
  // the list). What was said is left in the tab's own storage for the next page of the same site
  // to pick up, so Patch still hears of it. The person's yes is not passed on: it's good once.
  try {
    var left = JSON.parse(window.sessionStorage.getItem(KEY) || "null");
    window.sessionStorage.removeItem(KEY);
    if (left && Date.now() - left.at < 15000 && left.seen && left.seen.length <= 8) {
      b.seen = left.seen;
      b.until = Number(left.until) || 0;
    }
  } catch (e) { /* a page with no storage of its own */ }
  var real = { alert: window.alert, confirm: window.confirm, prompt: window.prompt };
  // "until" is a time by this page's own clock, set when a step begins: a step that never ends
  // (Patch went away) doesn't keep the boxes from the person for good.
  function mine() {
    return Date.now() < b.until;
  }
  function note(type, message, accepted) {
    if (b.seen.length < 8) b.seen.push({ type: type, message: String(message === undefined ? "" : message).slice(0, 300), accepted: accepted });
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), until: b.until, seen: b.seen }));
    } catch (e) { /* no storage: Patch hears of it unless the page moves on first */ }
  }
  window.alert = function (message) {
    if (!mine()) return real.alert.apply(window, arguments);
    note("alert", message, true);
  };
  // A question gets "no" unless the person has already said yes to this step.
  window.confirm = function (message) {
    if (!mine()) return real.confirm.apply(window, arguments);
    note("confirm", message, !!b.yes);
    return !!b.yes;
  };
  window.prompt = function (message) {
    if (!mine()) return real.prompt.apply(window, arguments);
    note("prompt", message, false);
    return null;
  };
})();
