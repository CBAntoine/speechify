// How the copilot sees and works the screen: it lists what's on the page
// (an open panel or dialog first) with short element ids, then clicks, types
// into and points at those elements like a person would.

import { screenForPath } from "@/lib/copilot/screens";

export interface ScreenElement {
  id: string;
  kind: string;
  label: string;
  hint?: string;
  context?: string;
  value?: string;
  checked?: boolean;
  disabled?: boolean;
  options?: string[];
  href?: string;
}

const SELECTOR = 'button, a[href], input:not([type="hidden"]), textarea, select, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], summary';
const MAX_ELEMENTS = 120;

/** Clicks that send, delete, cancel, spend or publish wait for the user's yes. */
export const RISKY = /\b(delete|remove|discard|send|cancel|sign out|log ?out|pay|charge|refund|archive|reset|clear all|unsubscribe|disconnect|publish|run now|save store)\b/i;

let registry = new Map<string, HTMLElement>();

const squash = (s: string | null | undefined, max = 120) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function visible(el: HTMLElement): boolean {
  if (el.closest("[data-copilot-ignore]")) return false;
  if (el.hidden || el.closest("[hidden]")) return false;
  const st = getComputedStyle(el);
  if (st.visibility === "hidden" || st.display === "none") return false;
  const r = el.getBoundingClientRect();
  // A visually hidden checkbox inside a styled switch still counts.
  if (r.width === 0 && r.height === 0) return el instanceof HTMLInputElement && Boolean(el.closest("label"));
  return true;
}

function labelParts(el: HTMLElement): { label: string; hint?: string } {
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return { label: squash(aria, 100) };
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    const t = squash(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" "), 100);
    if (t) return { label: t };
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    const lab = el.labels?.[0] ?? el.closest("label");
    if (lab) {
      const main = squash((lab.querySelector("b") ?? lab.querySelector("span") ?? lab).textContent, 100);
      const hint = squash(lab.querySelector("small")?.textContent, 160) || undefined;
      if (main) return { label: main, hint };
    }
    if ("placeholder" in el && el.placeholder) return { label: squash(el.placeholder, 100) };
    if (el.name) return { label: el.name };
    return { label: "" };
  }
  return { label: squash(el.textContent, 100) || squash(el.getAttribute("title"), 100) };
}

function kindOf(el: HTMLElement): string {
  const role = el.getAttribute("role");
  if (role === "switch") return "switch";
  if (role === "tab") return "tab";
  if (role === "checkbox") return "checkbox";
  if (el instanceof HTMLAnchorElement) return "link";
  if (el instanceof HTMLSelectElement) return "dropdown";
  if (el instanceof HTMLTextAreaElement) return "text area";
  if (el instanceof HTMLInputElement) return el.type === "checkbox" ? "checkbox" : el.type === "radio" ? "radio" : "text field";
  if (el.tagName === "SUMMARY") return "expander";
  return "button";
}

/** The card or row an element belongs to, so "Add" buttons in a list can be told apart. */
function contextOf(el: HTMLElement, label: string): string | undefined {
  const box = el.closest('article, li, tr, .card, .list-item, .kanban-card, .lead-card, .prospect, .offer-card, details, [role="dialog"]');
  if (!box) return undefined;
  const h = box.querySelector("h1, h2, h3, h4, b, strong, summary");
  const t = squash(h?.textContent, 80);
  return t && t !== label ? t : undefined;
}

function rootElement(): HTMLElement {
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')].filter((d) => visible(d));
  if (dialogs.length) return dialogs[dialogs.length - 1];
  return document.querySelector<HTMLElement>("main.main") ?? document.body;
}

export function readScreen(path: string) {
  for (const el of registry.values()) el.removeAttribute("data-copilot-id");
  registry = new Map();
  const root = rootElement();
  const elements: ScreenElement[] = [];
  let total = 0;
  for (const el of root.querySelectorAll<HTMLElement>(SELECTOR)) {
    if (!visible(el)) continue;
    const { label, hint } = labelParts(el);
    if (!label) continue;
    total++;
    if (elements.length >= MAX_ELEMENTS) continue;
    const id = `e${elements.length + 1}`;
    registry.set(id, el);
    el.setAttribute("data-copilot-id", id);
    const item: ScreenElement = { id, kind: kindOf(el), label };
    if (hint) item.hint = hint;
    const ctx = contextOf(el, label);
    if (ctx) item.context = ctx;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) item.checked = el.checked;
    else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) item.value = el.value.slice(0, 200);
    if (el instanceof HTMLSelectElement) {
      item.value = el.selectedOptions[0]?.text;
      item.options = [...el.options].slice(0, 30).map((o) => o.text);
    }
    if (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true") item.checked = true;
    if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") item.disabled = true;
    if (el instanceof HTMLAnchorElement) item.href = el.getAttribute("href") ?? undefined;
    elements.push(item);
  }
  const text = (root.innerText || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 4000);
  return {
    screen: screenForPath(path).label,
    path,
    open_panel: root.matches('[role="dialog"]') ? root.getAttribute("aria-label") || "a panel" : null,
    heading: squash(document.querySelector("main.main h1")?.textContent, 100) || null,
    text,
    elements,
    ...(total > elements.length ? { note: `${total - elements.length} more elements not listed; ask about a specific part of the screen.` } : {}),
  };
}

function find(id: string): HTMLElement | undefined {
  const el = registry.get(id) ?? document.querySelector<HTMLElement>(`[data-copilot-id="${CSS.escape(id)}"]`) ?? undefined;
  return el?.isConnected ? el : undefined;
}

export function spotlight(el: HTMLElement, ms = 1800) {
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  const target = el instanceof HTMLInputElement && el.closest(".toggle-row") ? (el.closest(".toggle-row") as HTMLElement) : el;
  target.classList.remove("copilot-spot");
  void target.offsetWidth;
  target.classList.add("copilot-spot");
  window.setTimeout(() => target.classList.remove("copilot-spot"), ms);
}

export function clickElement(id: string, confirmed: boolean): { ok: boolean; text: string; label?: string } {
  const el = find(id);
  if (!el) return { ok: false, text: `There's no element ${id} on the screen now. Call read_screen again.` };
  const { label } = labelParts(el);
  if (RISKY.test(label) && !confirmed) return { ok: false, text: `"${label}" needs the user's go-ahead. Ask them; if they say yes, call click again with confirmed true.` };
  if ((el as HTMLButtonElement).disabled) return { ok: false, text: `"${label}" is disabled right now.` };
  spotlight(el);
  el.click();
  return { ok: true, text: `Clicked "${label}".`, label };
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function fillElement(id: string, value: string): { ok: boolean; text: string; label?: string } {
  const el = find(id);
  if (!el) return { ok: false, text: `There's no element ${id} on the screen now. Call read_screen again.` };
  const { label } = labelParts(el);
  if (el instanceof HTMLSelectElement) {
    const want = value.trim().toLowerCase();
    const opts = [...el.options];
    const opt = opts.find((o) => o.value.toLowerCase() === want || o.text.trim().toLowerCase() === want) ?? opts.find((o) => o.text.toLowerCase().includes(want));
    if (!opt) return { ok: false, text: `"${label}" has no option "${value}". Options: ${opts.slice(0, 30).map((o) => o.text).join(", ")}.` };
    setNativeValue(el, opt.value);
    spotlight(el);
    return { ok: true, text: `Chose "${opt.text}" in "${label}".`, label };
  }
  if (el instanceof HTMLInputElement && ["checkbox", "radio"].includes(el.type)) return { ok: false, text: `"${label}" is a switch or checkbox: use click.` };
  if (el instanceof HTMLInputElement && el.type === "password") return { ok: false, text: "Passwords are typed by the user, not the copilot." };
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return { ok: false, text: `"${label}" isn't a field you can type into.` };
  if (el.readOnly || el.disabled) return { ok: false, text: `"${label}" can't be edited.` };
  setNativeValue(el, value);
  spotlight(el);
  return { ok: true, text: `Typed into "${label}".`, label };
}

export function pointTo(id: string): { ok: boolean; text: string; label?: string } {
  const el = find(id);
  if (!el) return { ok: false, text: `There's no element ${id} on the screen now. Call read_screen again.` };
  const { label } = labelParts(el);
  spotlight(el, 3200);
  return { ok: true, text: `Highlighted "${label}" on the user's screen.`, label };
}

const STOP = new Set("where which what how do does did the and for you your can could find show point button there here that this get got want need see into onto from with have has is are was were me my mine it its in on of to a an i".split(" "));

/** The element on screen that best matches a question like "where do I add cities?". */
export function findOnScreen(question: string): ScreenElement | undefined {
  const words = question.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return undefined;
  const { elements } = readScreen(window.location.pathname + window.location.search);
  let best: { e: ScreenElement; score: number } | undefined;
  for (const e of elements) {
    const label = e.label.toLowerCase();
    const rest = `${e.hint ?? ""} ${e.context ?? ""}`.toLowerCase();
    const stems = (w: string) => [w, w.replace(/(ies|es|s)$/, "")];
    let score = 0;
    for (const w of words) {
      if (stems(w).some((x) => x.length > 2 && label.includes(x))) score += 2;
      else if (stems(w).some((x) => x.length > 2 && rest.includes(x))) score += 1;
    }
    if (score > (best?.score ?? 0)) best = { e, score };
  }
  return best && best.score >= 2 ? best.e : undefined;
}
