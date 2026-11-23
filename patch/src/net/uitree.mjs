// What's on an Android TV's screen, from `uiautomator dump` over ADB: the same numbered list of
// things on screen that the phone's screen reader gives Patch (links, buttons, text…), with the
// spot to select each one and which one the TV's remote is on right now.
import { parseXml } from "./xml.mjs";

const box = (s) => {
  const m = String(s || "").match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
  return m ? { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] } : null;
};

const yes = (v) => v === "true";

function kindOf(node, target) {
  const c = node.attrs.class || "";
  const t = target?.attrs.class || "";
  if (yes(node.attrs.password)) return "Password box";
  if (/EditText|SearchView|AutoComplete/.test(c)) return "Text box";
  if (/Switch|CheckBox|ToggleButton|RadioButton|CheckedTextView/.test(c) || yes(node.attrs.checkable)) return "Switch";
  if (/Button/.test(c) || (target && /Button/.test(t))) return "Button";
  // A picture you can select on its own is a button; inside a tile (an app, a film) it's the tile.
  if (/Image/.test(c)) return target === node ? "Button" : target ? "Item" : "Image";
  if (/Tab/.test(c) || /Tab/.test(t)) return "Tab";
  if (target) return "Item";
  return "Text";
}

/**
 * Parse a uiautomator dump into { package, items: [{ n, kind, text, state, x, y }], more, full, size }.
 * Items are visible nodes with words, de-duplicated; x/y is the middle of the thing to select
 * (the nearest focusable or clickable parent, as that's what a remote press or a tap acts on).
 */
export function readUiTree(xml, { maxItems = 120, maxChars = 6000 } = {}) {
  const root = parseXml(String(xml || ""));
  const items = [];
  const seen = new Set();
  let chars = 0;
  let full = false;
  let more = false;
  let pkg = null;
  let size = null;

  const walk = (node, target) => {
    if (node.local !== "node") {
      for (const c of node.children) walk(c, target);
      return;
    }
    const a = node.attrs;
    const b = box(a.bounds);
    if (!size && b) size = { width: b.x2, height: b.y2 };
    // Off screen or zero-sized: nothing in it can be seen or selected.
    if (!b || b.x2 <= b.x1 || b.y2 <= b.y1 || (size && (b.x2 <= 0 || b.y2 <= 0 || b.x1 >= size.width || b.y1 >= size.height))) return;
    if (!pkg && a.package && !/^com\.android\.systemui$/.test(a.package)) pkg = a.package;
    if (yes(a.scrollable)) more = true;
    const actionable = yes(a.clickable) || yes(a.focusable) || yes(a["long-clickable"]) || yes(a.checkable);
    const here = actionable ? node : target;
    const password = yes(a.password);
    const label = password ? "" : String(a.text || a["content-desc"] || "").replace(/\s+/g, " ").trim();
    if (label || password) {
      const text = password ? "(password)" : label.slice(0, 160);
      const key = `${text.toLowerCase()}`;
      if (!seen.has(key)) {
        if (items.length >= maxItems || chars + text.length > maxChars) full = true;
        else {
          seen.add(key);
          chars += text.length;
          const tb = box((here || node).attrs.bounds) || b;
          const state = [];
          if (yes(node.attrs.focused) || (here && yes(here.attrs.focused))) state.push("selected");
          if (yes(a.checkable)) state.push(yes(a.checked) ? "on" : "off");
          if (a.enabled === "false") state.push("greyed out");
          items.push({ n: items.length + 1, kind: kindOf(node, here), text, ...(state.length ? { state: state.join(", ") } : {}), x: Math.round((tb.x1 + tb.x2) / 2), y: Math.round((tb.y1 + tb.y2) / 2) });
        }
      }
    }
    for (const c of node.children) walk(c, here);
  };
  walk(root, null);
  return { package: pkg, items, more, full, size };
}
