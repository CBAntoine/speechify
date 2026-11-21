// Patch's eyes and hands inside a web page on a TV. Patch's server sends this script to the TV's
// browser (over the browser's debugging channel) and calls it to list what's on the page, find
// things by their words, and get them ready to click or type in. It runs in a world of its own next
// to the page: it sees the same page, but the page's own scripts can't see or change it.
//
// Written for old TV browsers (Chrome 55 and later): no async/await, no "?.", no "??", no spread.
(function () {
  "use strict";
  var VERSION = 4;
  var MAX_ITEMS = 45;
  var MAX_TEXT = 1500;
  var doc = document;
  var win = window;

  // Things a person can click, choose or type in.
  var CLICKABLE = [
    "a[href]", "button", "input", "select", "textarea", "summary", "label", "area[href]", "video", "audio",
    "[role=button]", "[role=link]", "[role=tab]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]", "[role=option]",
    "[role=checkbox]", "[role=radio]", "[role=switch]", "[role=combobox]", "[role=textbox]", "[role=searchbox]", "[role=slider]", "[role=treeitem]",
    "[contenteditable]:not([contenteditable=false])", "[onclick]", "[tabindex]:not([tabindex^='-'])"
  ].join(",");
  var BLOCKS = /^(P|LI|H[1-6]|TD|TH|DD|DT|BLOCKQUOTE|PRE|FIGCAPTION|CAPTION|DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|ASIDE|NAV|FORM|LABEL|DETAILS|BODY|TR|UL|OL|DL|TABLE|FIELDSET|LEGEND|ADDRESS)$/;
  // Blocks that hold one run of words (a paragraph); the others are containers, read row by row.
  var LEAF = /^(P|LI|H[1-6]|TD|TH|DD|DT|BLOCKQUOTE|PRE|FIGCAPTION|CAPTION|LABEL|LEGEND|ADDRESS)$/;
  var SECRET = /pass(word|code)?|pwd|secret|pin\b|card.?(number|no)|cc.?(num|number|csc|cvc|exp)|cvv|cvc|security.?code|iban|routing|account.?number|ssn|social.?security/i;

  function clean(s, max) {
    var t = String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, " ").replace(/\s+/g, " ").trim();
    return max && t.length > max ? t.slice(0, max - 1).trim() + "…" : t;
  }
  function norm(s) {
    return clean(s).toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, " ").trim();
  }
  function parentOf(node) {
    return node.parentNode || node.host || null;
  }
  function inside(node, ancestor) {
    for (var n = node; n; n = parentOf(n)) if (n === ancestor) return true;
    return false;
  }
  function style(el) {
    try {
      return win.getComputedStyle(el);
    } catch (e) {
      return null;
    }
  }
  function view() {
    var vv = win.visualViewport;
    return { w: win.innerWidth || doc.documentElement.clientWidth, h: win.innerHeight || doc.documentElement.clientHeight, ox: vv ? vv.offsetLeft : 0, oy: vv ? vv.offsetTop : 0 };
  }
  function scroller() {
    return doc.scrollingElement || doc.documentElement;
  }

  /** The top-most element at a point, looking inside components that keep their parts to themselves. */
  function topAt(x, y) {
    var el = doc.elementFromPoint(x, y);
    for (var i = 0; el && el.shadowRoot && i < 8; i++) {
      var inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  /** Where an element is on screen, or null if it can't be seen at all. */
  function box(el) {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) {
      // A link whose own box is empty but whose picture or text isn't.
      var kid = el.firstElementChild;
      if (kid) r = kid.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
    }
    return r;
  }
  function shown(el) {
    var s = style(el);
    return !s || (s.visibility !== "hidden" && s.visibility !== "collapse" && s.display !== "none" && Number(s.opacity) > 0.05);
  }
  /** The point to click: the middle of the part that's on screen, if something else isn't on top of it. */
  function clickPoint(el, r, v) {
    var x1 = Math.max(r.left, 0), y1 = Math.max(r.top, 0), x2 = Math.min(r.right, v.w), y2 = Math.min(r.bottom, v.h);
    if (x2 - x1 < 2 || y2 - y1 < 2) return null;
    var spots = [[(x1 + x2) / 2, (y1 + y2) / 2], [x1 + Math.min(12, (x2 - x1) / 2), (y1 + y2) / 2], [(x1 + x2) / 2, y1 + Math.min(8, (y2 - y1) / 2)]];
    for (var i = 0; i < spots.length; i++) {
      var top = topAt(spots[i][0], spots[i][1]);
      if (top && (inside(top, el) || inside(el, top) || labelFor(top) === el)) return { x: spots[i][0], y: spots[i][1] };
    }
    return null;
  }
  function labelFor(el) {
    var l = el && el.closest ? el.closest("label") : null;
    return l && l.control ? l.control : null;
  }

  // -- What each thing is, and what to call it --

  function role(el) {
    return (el.getAttribute("role") || "").toLowerCase();
  }
  function isSecret(el) {
    if (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") return false;
    if ((el.type || "").toLowerCase() === "password") return true;
    var hint = [el.getAttribute("autocomplete"), el.name, el.id, el.getAttribute("aria-label"), el.placeholder].join(" ");
    return SECRET.test(hint);
  }
  function kindOf(el) {
    var tag = el.tagName, r = role(el), type = (el.getAttribute("type") || "").toLowerCase();
    if (tag === "INPUT") {
      if (type === "password") return "Password box";
      if (type === "checkbox") return r === "switch" ? "Switch" : "Checkbox";
      if (type === "radio") return "Option";
      if (type === "submit" || type === "button" || type === "reset" || type === "image") return "Button";
      if (type === "range") return "Slider";
      if (type === "file") return "File chooser";
      if (type === "hidden") return null;
      return "Text box";
    }
    if (tag === "TEXTAREA" || r === "textbox" || r === "searchbox" || el.isContentEditable) return "Text box";
    if (tag === "SELECT" || r === "combobox") return "Menu";
    if (tag === "BUTTON" || r === "button" || tag === "SUMMARY") return "Button";
    if (r === "checkbox" || r === "menuitemcheckbox") return "Checkbox";
    if (r === "switch") return "Switch";
    if (r === "radio" || r === "menuitemradio") return "Option";
    if (r === "tab") return "Tab";
    if (r === "slider") return "Slider";
    if (tag === "VIDEO") return "Video";
    if (tag === "AUDIO") return el.controls ? "Sound" : null;
    if (tag === "A" || tag === "AREA" || r === "link") return "Link";
    return "Item";
  }
  function textOfIds(ids) {
    return clean(String(ids || "").split(/\s+/).map(function (id) {
      var e = id ? doc.getElementById(id) : null;
      return e ? e.textContent : "";
    }).join(" "));
  }
  function nameOf(el, kind, quick) {
    var a = clean(el.getAttribute("aria-label")) || textOfIds(el.getAttribute("aria-labelledby"));
    if (a) return a;
    var tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (kind === "Button") return clean(el.value) || clean(el.getAttribute("alt")) || clean(el.title) || (el.type === "submit" ? "Submit" : "");
      var label = "";
      if (el.labels && el.labels.length) label = clean(el.labels[0].textContent);
      if (!label && el.id) {
        var l = doc.querySelector("label[for=" + JSON.stringify(el.id) + "]");
        if (l) label = clean(l.textContent);
      }
      return label || clean(el.placeholder) || clean(el.title) || clean(el.name).replace(/[_\-\[\]]+/g, " ") || "";
    }
    // innerText leaves out hidden words and keeps the spaces between parts, but it's slow: when
    // looking through a whole page for some words, the plain text is enough.
    var text = clean(quick ? el.textContent : el.innerText || el.textContent);
    if (text) return text;
    var img = el.querySelector ? el.querySelector("img[alt], svg[aria-label], [title]") : null;
    if (img) text = clean(img.getAttribute("alt") || img.getAttribute("aria-label") || img.getAttribute("title"));
    if (text) return text;
    if (clean(el.title)) return clean(el.title);
    if (kind === "Video" || kind === "Sound") return clean(el.getAttribute("title")) || (kind === "Video" ? "Video" : "Sound");
    if (kind === "Link" && el.href) {
      // An icon with no words: say where it goes.
      try {
        var u = new URL(el.href, doc.baseURI);
        var last = decodeURIComponent(u.pathname.replace(/\/+$/, "").split("/").pop() || "").replace(/[-_+]+/g, " ").replace(/\.\w{2,5}$/, "");
        return clean(last) || u.hostname.replace(/^www\./, "");
      } catch (e) {
        return "";
      }
    }
    return "";
  }
  function stateOf(el, kind) {
    var out = [], tag = el.tagName;
    if (kind === "Checkbox" || kind === "Switch" || kind === "Option") {
      var on = tag === "INPUT" ? el.checked : /^(true|mixed)$/.test(el.getAttribute("aria-checked") || el.getAttribute("aria-selected") || "");
      out.push(kind === "Option" ? (on ? "chosen" : "not chosen") : on ? "on" : "off");
    } else if (kind === "Menu" && tag === "SELECT") {
      var opt = el.options[el.selectedIndex];
      out.push("now: " + (opt ? clean(opt.text, 60) : "nothing") + ", " + el.options.length + " choices");
    } else if (kind === "Text box") {
      var value = tag === "INPUT" || tag === "TEXTAREA" ? el.value : clean(el.textContent);
      out.push(isSecret(el) ? (value ? "filled in" : "empty") : value ? "says: " + clean(value, 80) : "empty");
    } else if (kind === "Password box") {
      out.push(el.value ? "filled in" : "empty");
    } else if (kind === "Tab") {
      if (el.getAttribute("aria-selected") === "true") out.push("showing");
    } else if (kind === "Video" || kind === "Sound") {
      out.push(el.paused ? "paused" : "playing");
    }
    if (el.getAttribute("aria-expanded") === "true") out.push("open");
    if (el.disabled || el.getAttribute("aria-disabled") === "true") out.push("greyed out");
    if (doc.activeElement === el && editable(el)) out.push("typing goes here");
    return out.join(", ");
  }

  // -- Finding everything --

  /** Every element in the page that matches, including inside components' own trees. */
  function queryDeep(root, selector, out, depth) {
    var found = root.querySelectorAll(selector);
    for (var i = 0; i < found.length; i++) out.push(found[i]);
    if (depth > 4) return out;
    var all = root.querySelectorAll("*");
    for (var j = 0; j < all.length && j < 20000; j++) if (all[j].shadowRoot) queryDeep(all[j].shadowRoot, selector, out, depth + 1);
    return out;
  }

  /** The things a person could click or type in, outermost only (a button's inner spans aren't separate). */
  function candidates() {
    var els = queryDeep(doc, CLICKABLE, [], 0);
    var set = typeof WeakSet === "function" ? new WeakSet() : null;
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i], nested = false;
      if (el.tagName === "LABEL") {
        // A label is the name of its box; the box itself is the thing to choose, unless the box is
        // hidden (styled checkboxes hide the real one and draw their own): then the label is.
        var c = el.control;
        if (!c) continue;
        var cb = c.getBoundingClientRect();
        if (cb.width >= 6 && cb.height >= 6 && shown(c)) continue;
        if (/^(INPUT|SELECT|TEXTAREA)$/.test(c.tagName) && (c.type || "").toLowerCase() === "hidden") continue;
        standIn.set(el, c);
      }
      if (set) {
        for (var p = parentOf(el); p; p = parentOf(p)) if (p.nodeType === 1 && set.has(p)) { nested = true; break; }
        // A box inside a link or a label is its own thing; other nested things belong to their parent.
        if (nested && !/^(INPUT|SELECT|TEXTAREA|BUTTON|A|VIDEO|AUDIO)$/.test(el.tagName)) continue;
        set.add(el);
      }
      out.push(el);
    }
    return out;
  }

  // A label standing in for its box (a styled checkbox whose real box is hidden): label -> box.
  var standIn = typeof WeakMap === "function" ? new WeakMap() : { get: function () {}, set: function () {}, has: function () { return false; } };

  function describe(el, quick) {
    var real = standIn.get(el);
    var kind = kindOf(real || el);
    if (!kind) return null;
    var name = clean(real ? (quick ? el.textContent : el.innerText || el.textContent) : nameOf(el, kind, quick), 110);
    if (!name && real) name = clean(nameOf(real, kind, quick), 110);
    if (!name && kind === "Item") return null;
    return { kind: kind, text: name || (kind === "Text box" ? "(no name)" : kind), state: quick ? "" : stateOf(real || el, kind) };
  }

  /** Words on screen that aren't part of something clickable: headings and paragraphs, in order. */
  function texts(v, taken) {
    var out = [], blocks = typeof Map === "function" ? new Map() : null, budget = MAX_TEXT, seen = 0;
    if (!blocks || !doc.body || !doc.createTreeWalker) return out;
    var walker = doc.createTreeWalker(doc.body, 4, null, false);
    var range = doc.createRange();
    for (var node = walker.nextNode(); node && seen < 40000; node = walker.nextNode()) {
      seen++;
      var raw = node.nodeValue;
      if (!raw || !/\S/.test(raw)) continue;
      var parent = node.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|TITLE)$/.test(parent.tagName)) continue;
      var block = parent;
      while (block && !BLOCKS.test(block.tagName)) block = block.parentElement;
      block = block || parent;
      var info = blocks.get(block);
      if (info === null) continue;
      if (info === undefined) {
        // Decided once per block: most of a long page is off screen, and skipped here.
        var br = block.getBoundingClientRect();
        if (br.width < 1 || br.height < 1 || br.bottom < 0 || br.top > v.h || br.right < 0 || br.left > v.w || !shown(block)) {
          blocks.set(block, null);
          continue;
        }
        info = { entry: null, big: br.height > v.h * 1.5, heading: false, rows: !LEAF.test(block.tagName), bottom: 0 };
        for (var a = block; a && a !== doc.body; a = a.parentElement) {
          if (/^H[1-6]$/.test(a.tagName) || role(a) === "heading") info.heading = true;
        }
        blocks.set(block, info);
      }
      // Words inside a link or a button belong to it, and a label's words name its box.
      var skip = false;
      for (var q = parent; q && q !== doc.body; q = q.parentElement) if (taken.has(q) || (q.tagName === "LABEL" && q.control)) { skip = true; break; }
      if (skip) continue;
      if (!info.entry || info.big || info.rows) {
        range.selectNodeContents(node);
        var r = range.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > v.h || r.right < 0 || r.left > v.w) continue;
        // Loose words on a new row of a container start a new line.
        if (info.entry && info.rows && r.top >= info.bottom - 2) info.entry = null;
        info.bottom = Math.max(info.rows && info.entry ? info.bottom : 0, r.bottom);
        if (!info.entry) {
          var cx = Math.min(Math.max(r.left + Math.min(r.width / 2, 40), 1), v.w - 1), cy = Math.min(Math.max(r.top + r.height / 2, 1), v.h - 1);
          var top = topAt(cx, cy);
          if (top && !inside(top, block) && !inside(block, top)) {
            if (!info.big) blocks.set(block, null); // something is on top of it
            continue;
          }
          info.entry = { heading: info.heading, text: "", top: r.top, left: r.left, h: r.height };
          out.push(info.entry);
        }
      }
      if (info.entry.text.length < 300) info.entry.text += raw;
    }
    var kept = [];
    for (var i = 0; i < out.length && budget > 0; i++) {
      var t = clean(out[i].text, out[i].heading ? 140 : 260);
      if (t.length < 2 || (!out[i].heading && !/[a-z0-9\u00c0-\uffff]{2}/i.test(t))) continue;
      budget -= t.length;
      kept.push({ heading: out[i].heading, text: t, top: out[i].top, left: out[i].left, h: out[i].h });
    }
    return kept;
  }

  /** Reading order: rows from the top, and left to right within a row. Each thing has top, left and h. */
  function inReadingOrder(list) {
    var sorted = list.slice().sort(function (a, b) { return a.top - b.top || a.left - b.left; });
    var out = [], row = [], bottom = 0;
    var flush = function () {
      row.sort(function (a, b) { return a.left - b.left; });
      for (var i = 0; i < row.length; i++) out.push(row[i]);
      row = [];
    };
    for (var i = 0; i < sorted.length; i++) {
      var it = sorted[i], h = it.h || 16;
      // In the same row if its middle is above the bottom of the row so far.
      if (row.length && it.top + h / 2 > bottom) flush();
      if (!row.length) bottom = it.top + h;
      else bottom = Math.min(bottom, it.top + h);
      row.push(it);
    }
    flush();
    return out;
  }

  var state = { items: [], watch: null, id: Math.random().toString(36).slice(2, 10) };
  // When the page last changed what it shows, so Patch can wait for it to finish redrawing.
  var changedAt = Date.now();
  try {
    new MutationObserver(function () { changedAt = Date.now(); }).observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  } catch (e) { /* no observer: Patch just waits a moment instead */ }

  /** What's on screen now: numbered things to choose, and the words around them, top to bottom. */
  function snapshot() {
    var v = view(), sc = scroller(), els = candidates();
    var inView = [], above = 0, below = 0, taken = typeof WeakSet === "function" ? new WeakSet() : { has: function () { return false; }, add: function () {} };
    for (var i = 0; i < els.length; i++) {
      var el = els[i], r = box(el);
      taken.add(el);
      if (!r) continue;
      if (r.bottom <= 0) { above++; continue; }
      if (r.top >= v.h) { below++; continue; }
      if (r.right <= 0 || r.left >= v.w || !shown(el)) continue;
      var pt = clickPoint(el, r, v);
      if (!pt) continue; // covered by something else (a pop-up, a sticky bar)
      var d = describe(el);
      if (!d) continue;
      inView.push({ el: el, d: d, top: r.top, left: r.left, h: r.height });
    }
    inView = inReadingOrder(inView);
    // The same link twice in a row (a picture and its title): once is enough.
    var listed = [], last = null;
    for (var j = 0; j < inView.length; j++) {
      var it = inView[j];
      var key = it.d.kind + "|" + norm(it.d.text) + "|" + (it.el.href || "");
      if (last && key === last) continue;
      last = key;
      listed.push(it);
    }
    var extra = Math.max(0, listed.length - MAX_ITEMS);
    listed = listed.slice(0, MAX_ITEMS);
    state.items = listed.map(function (x) { return x.el; });
    var lines = listed.map(function (x, n) {
      return { n: n + 1, kind: x.d.kind, text: x.d.text, state: x.d.state || undefined, top: x.top, left: x.left, h: x.h };
    });
    var words = texts(v, taken);
    for (var k = 0; k < words.length; k++) lines.push({ kind: words[k].heading ? "Heading" : "Text", text: words[k].text, top: words[k].top, left: words[k].left, h: words[k].h });
    lines = inReadingOrder(lines);
    for (var m = 0; m < lines.length; m++) { delete lines[m].top; delete lines[m].left; delete lines[m].h; }
    var frames = [], fr = doc.querySelectorAll("iframe");
    for (var f = 0; f < fr.length && frames.length < 4; f++) {
      var fb = fr[f].getBoundingClientRect();
      if (fb.width < 150 || fb.height < 60 || fb.bottom < 0 || fb.top > v.h) continue;
      try {
        var from = new URL(fr[f].src || "", doc.baseURI);
        var host = from.hostname.replace(/^www\./, "");
        if (host && from.host !== location.host && frames.indexOf(host) === -1) frames.push(host);
      } catch (e) { /* no address */ }
    }
    var max = Math.max(0, sc.scrollHeight - v.h);
    return {
      v: VERSION, id: state.id, url: location.href, title: clean(doc.title, 120), ready: doc.readyState,
      lines: lines, shown: state.items.length, extra: extra, above: above, below: below,
      scroll: { y: Math.round(sc.scrollTop), max: Math.round(max), page: v.h },
      frames: frames
    };
  }

  // -- Choosing something --

  function describeFor(el) {
    var d = describe(el) || { kind: "Item", text: clean(el.innerText || el.textContent, 110) || "item", state: "" };
    var href = "";
    try {
      if (el.href) href = new URL(el.href, doc.baseURI).href;
    } catch (e) { /* not an address */ }
    var form = el.form || (el.closest ? el.closest("form") : null);
    var out = { kind: d.kind, text: d.text, state: d.state, href: href, secret: isSecret(el), inForm: !!form, tag: el.tagName, type: (el.getAttribute("type") || "").toLowerCase() };
    if (el.tagName === "SELECT") {
      // A drop-down list: its choices, so one can be picked by its words (opening it would hide them from Patch).
      out.choices = [];
      for (var i = 0; i < el.options.length && i < 20; i++) out.choices.push(clean(el.options[i].text, 40));
    }
    return out;
  }

  /** Bring something to the middle of the screen at once (pages that scroll smoothly would still be moving). */
  function jumpTo(el) {
    try {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    } catch (e) {
      try {
        el.scrollIntoView({ block: "center", inline: "nearest" });
      } catch (e2) {
        el.scrollIntoView();
      }
    }
  }

  /** The thing with this number in the last list, or the best match for these words anywhere on the page. */
  function pick(target) {
    if (typeof target === "number") {
      var el = state.items[target - 1];
      if (!el) return { error: "number", count: state.items.length };
      if (!el.isConnected) return { error: "gone" };
      return { el: el };
    }
    var want = norm(target);
    if (!want) return { error: "none" };
    var els = candidates(), best = null, bestScore = 0, names = [];
    var v = view();
    for (var i = 0; i < els.length; i++) {
      var d = describe(els[i], true);
      if (!d) continue;
      var name = norm(d.text), score = 0;
      if (!name) continue;
      if (name === want) score = 100;
      else if (name.indexOf(want) === 0) score = 80;
      else if ((" " + name + " ").indexOf(" " + want + " ") !== -1) score = 70;
      else if (name.indexOf(want) !== -1) score = 55;
      else if (want.indexOf(name) !== -1 && name.length > 3) score = 45;
      else {
        var words = want.split(" "), hit = 0;
        for (var w = 0; w < words.length; w++) if (words[w].length > 1 && (" " + name + " ").indexOf(" " + words[w] + " ") !== -1) hit++;
        if (hit && hit >= Math.ceil(words.length * 0.6)) score = 30 + (hit / words.length) * 20;
      }
      if (!score) continue;
      var r = box(els[i]);
      if (!r || !shown(els[i])) continue;
      // Prefer what's on screen now, and things that really are buttons and links.
      if (r.bottom > 0 && r.top < v.h) score += 6;
      if (d.kind !== "Item") score += 2;
      if (names.length < 6) names.push(d.text);
      if (score > bestScore) { best = els[i]; bestScore = score; }
    }
    return best ? { el: best } : { error: "none", close: names };
  }

  /** Bring something into view and say where to click it. */
  function locate(target) {
    var p = pick(target);
    if (p.error) return p;
    var el = p.el, v = view(), r = box(el);
    if (!r) return { error: "hidden" };
    var moved = false;
    if (r.top < 60 || r.bottom > v.h - 40) {
      jumpTo(el);
      r = box(el) || r;
      moved = true;
    }
    var pt = clickPoint(el, r, v);
    state.target = el;
    var info = describeFor(el);
    info.moved = moved;
    info.x = pt ? Math.round(pt.x - v.ox) : null;
    info.y = pt ? Math.round(pt.y - v.oy) : null;
    if (!pt) {
      var top = topAt(Math.min(Math.max(r.left + r.width / 2, 1), v.w - 1), Math.min(Math.max(r.top + r.height / 2, 1), v.h - 1));
      info.covered = top ? clean(top.innerText || top.textContent, 80) || top.tagName.toLowerCase() : "something";
    }
    return info;
  }

  /** Watch for the click arriving, to check that the right thing got it. */
  function watch() {
    var seen = { clicked: false, hit: false, key: false, move: null };
    var target = state.target;
    var onMove = function (e) {
      seen.move = { x: e.clientX, y: e.clientY };
    };
    var onClick = function (e) {
      seen.clicked = true;
      var t = e.composedPath ? e.composedPath()[0] : e.target;
      if (target && t && (inside(t, target) || inside(target, t) || labelFor(t) === target)) seen.hit = true;
    };
    var onKey = function (e) {
      if (e.key === "Enter" || e.keyCode === 13) seen.key = true;
    };
    if (state.unwatch) state.unwatch();
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("mousemove", onMove, true);
    state.unwatch = function () {
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("mousemove", onMove, true);
      state.unwatch = null;
    };
    state.watch = seen;
    return true;
  }
  /** What has arrived so far (the watching goes on). */
  function seenSoFar() {
    return state.watch || { clicked: false, hit: false, key: false, move: null };
  }
  function watched() {
    var seen = seenSoFar();
    if (state.unwatch) state.unwatch();
    return seen;
  }
  /** Click it from here (when a click sent to the screen didn't land on it). */
  function clickNow() {
    var el = state.target;
    if (!el || !el.isConnected) return false;
    if (typeof el.click === "function") el.click();
    else el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: win }));
    return true;
  }

  // -- Typing --

  function editable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly;
    if (el.tagName === "INPUT") return !el.disabled && !el.readOnly && !/^(checkbox|radio|submit|button|reset|image|file|range|color|hidden)$/i.test(el.type);
    return !!el.isContentEditable || /^(textbox|searchbox|combobox)$/.test(role(el));
  }
  function deepActive() {
    var el = doc.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
  /** The box typing should go in: the one given, the one in use, or the page's search or first text box. */
  function field(target) {
    var el = null;
    if (target != null) {
      var p = pick(target);
      if (p.error) return p;
      el = p.el;
      if (el.tagName === "LABEL" && el.control) el = el.control;
      if (!editable(el)) {
        var inner = el.querySelector ? el.querySelector("input,textarea,[contenteditable]") : null;
        if (inner && editable(inner)) el = inner;
        else return { error: "nottext", kind: (describe(el) || {}).kind, text: (describe(el) || {}).text };
      }
    } else {
      el = deepActive();
      if (!editable(el)) {
        var v = view(), boxes = queryDeep(doc, "input,textarea,[contenteditable]:not([contenteditable=false]),[role=searchbox],[role=textbox]", [], 0), search = null, first = null;
        for (var i = 0; i < boxes.length; i++) {
          var b = boxes[i], r = box(b);
          if (!editable(b) || !r || !shown(b) || isSecret(b)) continue;
          var onScreen = r.bottom > 0 && r.top < v.h;
          var hint = [b.type, b.name, b.id, b.placeholder, b.getAttribute("aria-label"), role(b)].join(" ");
          if (!search && /search|query|\bq\b|find/i.test(hint)) search = b;
          if (!first && onScreen) first = b;
        }
        el = search || first;
        if (!el) return { error: "nofield" };
      }
    }
    var info = describeFor(el);
    if (info.secret) return { error: "secret", text: info.text };
    jumpTo(el);
    el.focus();
    try {
      if (typeof el.select === "function") el.select();
      else if (el.isContentEditable) {
        var range = doc.createRange();
        range.selectNodeContents(el);
        var sel = win.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } catch (e) { /* number and email boxes don't select */ }
    state.field = el;
    state.target = el;
    info.focused = deepActive() === el;
    return info;
  }
  function fieldValue() {
    var el = state.field;
    if (!el) return null;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" ? String(el.value) : clean(el.textContent);
  }
  /** Put the words in directly (when typing sent to the screen didn't arrive), telling the page as typing would. */
  function setValue(text) {
    var el = state.field;
    if (!el || !el.isConnected) return false;
    el.focus();
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      var proto = el.tagName === "INPUT" ? win.HTMLInputElement.prototype : win.HTMLTextAreaElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) setter.set.call(el, text);
      else el.value = text;
    } else if (!doc.execCommand || !doc.execCommand("insertText", false, text)) el.textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  /** Where Enter would go, and what it would do: the form's own button says. */
  function enterTarget() {
    var el = deepActive();
    var form = el && (el.form || (el.closest ? el.closest("form") : null));
    var button = form ? form.querySelector("button[type=submit],input[type=submit],button:not([type])") : null;
    state.field = editable(el) ? el : state.field;
    return { inField: editable(el), inForm: !!form, button: button ? clean(nameOf(button, "Button"), 60) : "", secret: !!el && isSecret(el), text: el && el !== doc.body ? (describe(el) || {}).text || "" : "" };
  }
  /** Send the form the box is in (when the Enter key sent to the screen didn't arrive). */
  function submitNow() {
    var el = state.field || deepActive();
    var form = el && (el.form || (el.closest ? el.closest("form") : null));
    if (!form) {
      if (!el) return false;
      var init = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyboardEvent("keydown", init));
      el.dispatchEvent(new KeyboardEvent("keyup", init));
      return true;
    }
    var button = form.querySelector("button[type=submit],input[type=submit],button:not([type])");
    if (button && typeof button.click === "function") button.click();
    else if (typeof form.requestSubmit === "function") form.requestSubmit();
    else form.submit();
    return true;
  }
  /** Choose from a menu by its words. */
  function choose(target, words) {
    var p = pick(target);
    if (p.error) return p;
    var el = p.el;
    if (el.tagName !== "SELECT") return { error: "notmenu" };
    var want = norm(words), best = -1, bestScore = 0;
    for (var i = 0; i < el.options.length; i++) {
      var name = norm(el.options[i].text), score = name === want ? 3 : name.indexOf(want) === 0 ? 2 : name.indexOf(want) !== -1 ? 1 : 0;
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best < 0) {
      var names = [];
      for (var j = 0; j < el.options.length && j < 12; j++) names.push(clean(el.options[j].text, 40));
      return { error: "nochoice", choices: names };
    }
    el.selectedIndex = best;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { chosen: clean(el.options[best].text, 60), text: (describe(el) || {}).text || "menu" };
  }

  // -- Moving around --

  function scroll(dir) {
    var v = view(), sc = scroller(), before = sc.scrollTop, beforeX = sc.scrollLeft;
    var step = Math.round(v.h * 0.8), side = Math.round(v.w * 0.8);
    // Set directly, so pages that scroll smoothly have moved by the time Patch looks again.
    if (dir === "top") sc.scrollTop = 0;
    else if (dir === "bottom") sc.scrollTop = sc.scrollHeight;
    else if (dir === "left" || dir === "right") sc.scrollLeft = beforeX + (dir === "left" ? -side : side);
    else sc.scrollTop = before + (dir === "up" ? -step : step);
    if (sc.scrollTop !== before || sc.scrollLeft !== beforeX) return { moved: true };
    // The page itself doesn't scroll: find the biggest part of it that does.
    var all = doc.querySelectorAll("main,section,article,div,ul,ol,nav,aside,[role=main],[role=feed],[role=list]"), best = null, bestArea = 0;
    for (var i = 0; i < all.length && i < 5000; i++) {
      var el = all[i];
      if (el.scrollHeight - el.clientHeight < 40 || el.clientHeight < 120) continue;
      var s = style(el);
      if (!s || !/(auto|scroll)/.test(s.overflowY)) continue;
      var r = el.getBoundingClientRect(), area = Math.max(0, Math.min(r.right, v.w) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, v.h) - Math.max(r.top, 0));
      if (area > bestArea) { best = el; bestArea = area; }
    }
    if (!best) return { moved: false };
    var was = best.scrollTop;
    best.scrollTop = dir === "top" ? 0 : dir === "bottom" ? best.scrollHeight : was + (dir === "up" ? -1 : dir === "down" ? 1 : 0) * Math.round(best.clientHeight * 0.8);
    return { moved: best.scrollTop !== was };
  }

  /** Where these words are on the page (for "find … on the page"): scrolls to the first and counts the rest. */
  function find(words) {
    var want = clean(words).toLowerCase();
    if (!want || !doc.body) return { count: 0 };
    var walker = doc.createTreeWalker(doc.body, 4, null, false), count = 0, first = null, seen = 0;
    for (var node = walker.nextNode(); node && seen < 20000; node = walker.nextNode()) {
      seen++;
      if (node.nodeValue.toLowerCase().indexOf(want) === -1) continue;
      var parent = node.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(parent.tagName) || !box(parent) || !shown(parent)) continue;
      count++;
      if (!first) first = parent;
    }
    if (first) jumpTo(first);
    return { count: count, text: first ? clean(first.innerText || first.textContent, 300) : "" };
  }

  /** The words of the page from where the screen is, for reading aloud. */
  function read(max) {
    if (!doc.body) return "";
    var main = doc.querySelector("article, main, [role=main]") || doc.body;
    var v = view(), walker = doc.createTreeWalker(main, 4, null, false), out = [], total = 0, seen = 0, range = doc.createRange(), started = false;
    for (var node = walker.nextNode(); node && seen < 20000 && total < max; node = walker.nextNode()) {
      seen++;
      if (!/\S/.test(node.nodeValue)) continue;
      var parent = node.parentElement;
      if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|OPTION|BUTTON|NAV)$/.test(parent.tagName) || (parent.closest && parent.closest("nav,header,footer,aside,[aria-hidden=true]"))) continue;
      if (!started) {
        range.selectNodeContents(node);
        var r = range.getBoundingClientRect();
        if (r.height < 1 || r.bottom < 0) continue; // above the screen, or hidden
        started = true;
      } else if (!box(parent)) continue;
      var t = clean(node.nodeValue);
      if (t) { out.push(t); total += t.length + 1; }
    }
    return clean(out.join(" "), max);
  }

  /** How the page is doing: where it is, and whether it has finished loading. */
  function status() {
    return { id: state.id, url: location.href, title: clean(doc.title, 120), ready: doc.readyState, quiet: Date.now() - changedAt };
  }

  var api = { v: VERSION, snapshot: snapshot, locate: locate, watch: watch, seenSoFar: seenSoFar, watched: watched, clickNow: clickNow, field: field, fieldValue: fieldValue, setValue: setValue, enterTarget: enterTarget, submitNow: submitNow, choose: choose, scroll: scroll, find: find, read: read, status: status };
  try {
    Object.defineProperty(self, "__patch", { value: api, configurable: true, enumerable: false, writable: true });
  } catch (e) {
    self.__patch = api;
  }
  return VERSION;
})();
