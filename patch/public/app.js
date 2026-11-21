// Patch dashboard. Plain ES modules, no build step.
import { icon } from "./icons.js";
import { createVoice } from "./voice.js";
import { createTvApps } from "./tvapps.js";

const BOOT = JSON.parse(document.getElementById("boot").textContent || "{}");
// Where new versions of the phone app are published (by the build on GitHub).
const PATCH_DOWNLOADS = "https://github.com/CBAntoine/speechify/releases/tag/patch-android";
// Inside the Patch app on an Android phone, Patch (and everything it keeps) lives on the phone.
const HERE = BOOT.phone ? "this phone" : "this computer";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cap = (s) => (s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, " ") : "");

export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { "x-patch-token": BOOT.token, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!data) throw new Error(res.status === 403 ? "Patch restarted. Reload the page." : `Patch answered ${res.status}`);
  return data;
}

// ── state ─────────────────────────────────────────────

const state = {
  devices: [],
  setup: {},
  app: {},
  network: null,
  scan: { running: false, pct: 0, message: "" },
  tuneup: null,
  speed: null,
  filter: "all",
  query: "",
  openId: null,
  busy: new Set(),
  dismissed: new Set(JSON.parse(safeStorage("get", "patch.dismissed") || "[]")),
  view: safeStorage("get", "patch.view") === "list" ? "list" : "cards",
  room: "",
  todoOpen: false,
  drawerTab: null,
};

function safeStorage(op, key, value) {
  try {
    if (op === "get") return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    return null;
  }
  return null;
}

// Kinds of device, grouped the way people think about them. Sections marked rows: their devices are
// listed compactly (there's little to switch), the rest get cards.
const CATS = [
  { id: "lights", label: "Lights", icon: "light", kinds: ["light", "room"], tint: "var(--c-light)" },
  { id: "media", label: "TV & audio", icon: "tv", kinds: ["tv", "streamer", "speaker", "display", "media", "group"], tint: "var(--c-media)" },
  { id: "power", label: "Plugs & switches", short: "Plugs", icon: "plug", kinds: ["plug", "switch", "strip", "fan"], tint: "var(--c-power)" },
  { id: "home", label: "Climate & security", icon: "thermostat", kinds: ["thermostat", "lock", "garage", "cover", "camera", "vacuum", "sensor", "appliance", "scene"], tint: "var(--c-climate)" },
  { id: "people", label: "Computers & phones", short: "Computers", icon: "personal", kinds: ["computer", "phone", "tablet", "personal", "console", "nas", "watch"], tint: "var(--c-computer)", rows: true },
  { id: "other", label: "Router, hubs & printers", short: "Other", icon: "router", kinds: ["router", "network", "hub", "printer"], tint: "var(--c-network)", rows: true },
];
const catOf = (kind) => CATS.find((c) => c.kinds.includes(kind)) || CATS.at(-1);
const KIND_TINT = { printer: "var(--c-printer)", unknown: "var(--c-other)", smart: "var(--c-other)" };
const tintOf = (d) => KIND_TINT[d.kind] || catOf(d.kind).tint;
const KIND_ICON = { room: "room", group: "group", hub: "hub" };
const kindIcon = (d) => KIND_ICON[d.kind] || d.kind;

const ACTION_LABEL = {
  turn_on: "Turn on", turn_off: "Turn off", toggle: "Toggle", reboot: "Restart", update_firmware: "Install update", unlock: "Unlock", lock: "Lock",
  open: "Open", close: "Close", remove_port_forward: "Close port forward", set_mode: "Change mode", identify: "Identify", wake: "Wake", pair: "Connect",
  enable_auto_updates: "Turn on auto-updates",
};

export function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function stateLine(d) {
  const s = d.state || {};
  if (d.setup) return d.setup.kind === "button" || d.setup.kind === "tv-prompt" ? "Ready to connect" : d.setup.kind === "password" ? "Needs its password" : d.setup.kind === "adb" ? "Needs a setting on the TV" : "Waiting to be connected";
  if (d.online === false) return d.lastSeen ? `Offline · seen ${ago(d.lastSeen)}` : "Offline";
  const parts = (...xs) => xs.filter(Boolean).join(" · ");
  switch (d.kind) {
    case "light":
    case "room":
      if (s.on == null) return "";
      return s.on ? parts("On", s.brightness != null && `${s.brightness}%`, s.effect && s.effect !== "Solid" && s.effect, s.colorTemperature && `${s.colorTemperature} K`) : "Off";
    case "plug":
    case "switch":
    case "strip":
    case "fan":
      return s.on == null ? "" : parts(s.on ? "On" : "Off", s.on && typeof s.power === "number" && `${s.power} W`);
    case "tv":
    case "streamer":
    case "speaker":
    case "display":
    case "media":
    case "group":
      return parts(s.on === false ? "Off" : null, s.app && s.app !== "Home screen" && s.app, s.channel && `Channel ${s.channel}`, s.playback && s.playback !== "stopped" && cap(s.playback), s.track, s.volume != null && `Vol ${s.volume}${s.muted ? " (muted)" : ""}`) || (s.app === "Home screen" ? "Home screen" : s.on ? "On" : "");
    case "thermostat":
      return parts(s.currentTemperature != null && `${s.currentTemperature}${s.unit || ""} now`, s.targetTemperature != null && `set to ${s.targetTemperature}${s.unit || ""}`, cap(s.mode));
    case "lock":
      return s.locked == null ? "" : s.locked ? "Locked" : "Unlocked";
    case "garage":
    case "cover":
      return parts(cap(s.status), s.position != null && `${s.position}%`);
    case "vacuum":
      return parts(cap(s.status), s.battery != null && `battery ${s.battery}%`);
    case "printer":
      return parts(cap(s.status), s.summary);
    case "router":
      return parts(s.connection, s.uptime && `up ${s.uptime}`, s.portForwards ? `${s.portForwards} open port${s.portForwards > 1 ? "s" : ""}` : null);
    case "hub":
      return d.info?.lights ? `${d.info.lights} lights` : "";
    default:
      return "";
  }
}

const has = (d, a) => d.actions?.includes(a);
const isPowered = (d) => typeof d.state?.on === "boolean" && (has(d, "toggle") || (has(d, "turn_on") && has(d, "turn_off")));
const NOT_CONTROLS = new Set(["rename", "set_room", "wake", "identify", "reboot", "update_firmware", "enable_auto_updates", "set_led", "remove_port_forward", "pair"]);
const isControllable = (d) => (d.actions || []).some((a) => !NOT_CONTROLS.has(a));
const asCard = (d) => !catOf(d.kind).rows && (isControllable(d) || !!d.setup);
const isTvLike = (d) => ["tv", "streamer"].includes(d.kind) && (has(d, "press_button") || has(d, "set_channel") || has(d, "launch_app") || has(d, "search_youtube"));
const needsPair = (d) => (d.setup?.kind === "button" || d.setup?.kind === "tv-prompt") && has(d, "pair");

/** The one control a card shows: a switch (top right) or a small set of buttons (bottom right). */
function primaryControl(d) {
  const busy = state.busy.has(d.id);
  const id = esc(d.id);
  if (needsPair(d)) return { foot: `<button class="btn btn--primary btn--sm" data-act="pair" data-id="${id}">Connect</button>` };
  if (d.setup?.kind === "token") return { foot: `<button class="btn btn--primary btn--sm" data-ui="settings" data-focus="ha">Connect</button>` };
  if (d.setup?.kind === "password") return { foot: `<button class="btn btn--sm" data-ui="open" data-id="${id}">${icon("key", 15)} Password</button>` };
  if (d.setup?.kind === "adb") return { foot: `<button class="btn btn--sm" data-ui="open" data-id="${id}">Set up</button>` };
  if (d.online === false) return {};
  if (isPowered(d)) return { top: `<button class="switch ${busy ? "is-busy" : ""}" role="switch" aria-checked="${d.state.on}" aria-label="${esc(d.name)} power" data-act="${d.state.on ? "turn_off" : "turn_on"}" data-id="${id}"></button>` };
  if (has(d, "pause") && has(d, "play")) {
    const playing = d.state?.playback === "playing";
    return {
      foot: `<div class="mini">${has(d, "volume_down") ? `<button class="btn btn--sm" data-act="volume_down" data-id="${id}" aria-label="Volume down">−</button>` : ""}<button class="btn btn--sm" data-act="${playing ? "pause" : "play"}" data-id="${id}" aria-label="${playing ? "Pause" : "Play"}">${icon(playing ? "pause" : "play", 15)}</button>${has(d, "volume_up") ? `<button class="btn btn--sm" data-act="volume_up" data-id="${id}" aria-label="Volume up">+</button>` : ""}</div>`,
    };
  }
  if (has(d, "lock")) return { foot: `<button class="btn btn--sm" data-act="${d.state?.locked ? "unlock" : "lock"}" data-id="${id}">${icon("lock", 14)} ${d.state?.locked ? "Unlock" : "Lock"}</button>` };
  if (has(d, "set_temperature") && d.state?.targetTemperature != null) {
    return { foot: `<div class="mini"><button class="btn btn--sm" data-act="set_temperature" data-value="${d.state.targetTemperature - 0.5}" data-id="${id}" aria-label="Cooler">−</button><button class="btn btn--sm" data-act="set_temperature" data-value="${d.state.targetTemperature + 0.5}" data-id="${id}" aria-label="Warmer">+</button></div>` };
  }
  if (has(d, "open") && has(d, "close")) {
    const isOpen = /open/.test(d.state?.status || "");
    return { foot: `<button class="btn btn--sm" data-act="${isOpen ? "close" : "open"}" data-id="${id}">${isOpen ? "Close" : "Open"}</button>` };
  }
  if (has(d, "activate")) return { foot: `<button class="btn btn--sm" data-act="activate" data-id="${id}">${icon("play", 14)} Run</button>` };
  if (has(d, "start")) return { foot: `<button class="btn btn--sm" data-act="${d.state?.status === "cleaning" ? "dock" : "start"}" data-id="${id}">${d.state?.status === "cleaning" ? "Dock" : "Start"}</button>` };
  if (isTvLike(d)) return { foot: `<button class="btn btn--sm" data-ui="open" data-id="${id}">${icon("tv", 14)} Remote</button>` };
  return {};
}

function cardHtml(d) {
  const s = d.state || {};
  const on = d.online !== false && !d.setup && (s.on === true || s.playback === "playing");
  const ctl = primaryControl(d);
  const level = on && (d.kind === "light" || d.kind === "room") ? s.brightness : null;
  const badges = `${d.isNew ? '<span class="badge badge--new">New</span> ' : ""}`;
  return `<article class="card ${on ? "is-on" : ""} ${d.online === false ? "is-offline" : ""}" style="--tint:${tintOf(d)}" data-id="${esc(d.id)}" tabindex="0" aria-label="${esc(d.name)}, ${esc(d.what || d.kindLabel)}">
    <div class="card__top"><div class="kind-icon">${icon(kindIcon(d), 22)}</div>${ctl.top || ""}</div>
    <div class="card__name"><strong>${esc(d.name)}</strong><span>${esc(d.what || d.kindLabel)}</span></div>
    <div class="card__state">${badges}${esc(stateLine(d))}</div>
    ${level != null ? `<div class="meter" aria-hidden="true"><i style="width:${Math.max(4, Math.min(100, level))}%"></i></div>` : ""}
    ${d.room || ctl.foot ? `<div class="card__foot">${d.room ? `<span class="room">${esc(d.room)}</span>` : "<span></span>"}${ctl.foot || ""}</div>` : ""}
  </article>`;
}

function rowSide(d) {
  const id = esc(d.id);
  if (needsPair(d)) return `<button class="btn btn--primary btn--sm" data-act="pair" data-id="${id}">Connect</button>`;
  if (d.setup?.kind === "token") return `<button class="btn btn--primary btn--sm" data-ui="settings" data-focus="ha">Connect</button>`;
  if (d.setup) return `<button class="btn btn--sm" data-ui="open" data-id="${id}">Set up</button>`;
  if (has(d, "wake") && d.online === false) return `<button class="btn btn--sm" data-act="wake" data-id="${id}">${icon("power", 14)} Wake</button>`;
  const line = stateLine(d);
  return `${line ? `<span>${esc(line)}</span>` : `<span class="dot ${d.online === false ? "dot--off" : "dot--on"}"></span><span>${d.online === false ? "Offline" : "Online"}</span>`}`;
}

/** The second line of a row: what it is, or, when Patch can't tell, the best clue it has. */
function rowSubtitle(d) {
  const what = d.what && d.what !== d.name ? d.what : d.vendor ? `Made by ${d.vendor}` : "Patch couldn't tell what this is yet";
  return `${what}${d.room ? ` · ${d.room}` : ""}`;
}

function rowHtml(d) {
  return `<div class="row-item ${d.online === false ? "is-offline" : ""}" style="--tint:${tintOf(d)}" data-id="${esc(d.id)}" tabindex="0" role="button" aria-label="${esc(d.name)}, ${esc(d.what || d.kindLabel)}">
    <div class="kind-icon">${icon(kindIcon(d), 19)}</div>
    <div class="row-item__text"><strong>${esc(d.name)}${d.isNew ? ' <span class="badge badge--new">New</span>' : ""}</strong><span>${esc(rowSubtitle(d))}</span></div>
    <div class="row-item__side">${rowSide(d)}<span class="chevron">${icon("chevronRight", 16)}</span></div>
  </div>`;
}

// ── rendering ─────────────────────────────────────────

const cardCache = new Map();

function visibleDevices() {
  const q = state.query.trim().toLowerCase();
  return state.devices.filter((d) => {
    if (d.hidden) return false;
    if (state.filter !== "all" && catOf(d.kind).id !== state.filter) return false;
    if (state.room && (d.room || "") !== state.room) return false;
    if (!q) return true;
    return [d.name, d.brand, d.model, d.what, d.room, d.ip, d.kindLabel, d.vendor].some((x) => x && String(x).toLowerCase().includes(q));
  });
}

function renderDevices() {
  const host = $("#devices");
  if (!state.devices.length) {
    host.innerHTML = `<div class="empty"><div class="empty__art">${icon(state.scan.running ? "refresh" : "wifi", 34, state.scan.running ? 'class="spin"' : "")}</div><h3>${state.scan.running ? "Looking around your network…" : "Let's see what's on your WiFi"}</h3><p>${state.scan.running ? "Listening for lights, speakers, TVs, printers, phones and everything else. This takes about ten seconds." : "Patch will find everything connected to your WiFi and tell you exactly what each thing is."}</p>${state.scan.running ? "" : `<button class="btn btn--primary" data-ui="scan">${icon("scan", 17)} Scan my network</button>`}</div>`;
    cardCache.clear();
    return;
  }
  const list = visibleDevices();
  if (!list.length) {
    host.innerHTML = `<div class="empty"><div class="empty__art">${icon("search", 30)}</div><h3>Nothing matches</h3><p>Try another word, or show all devices.</p><button class="btn" data-ui="filter-all">Show everything</button></div>`;
    return;
  }
  if (state.view === "list") {
    host.innerHTML = tableHtml(list);
    cardCache.clear();
    return;
  }
  const groups = state.query ? [{ label: `Results for “${state.query}”`, icon: "search", tint: "var(--accent)", items: list }] : CATS.map((c) => ({ ...c, items: list.filter((d) => catOf(d.kind) === c) })).filter((g) => g.items.length);
  // Rebuild sections, reusing card elements whose HTML didn't change (keeps hover/focus stable).
  const frag = document.createDocumentFragment();
  const seen = new Set();
  for (const g of groups) {
    const sec = document.createElement("section");
    sec.className = "section";
    sec.innerHTML = `<div class="section__head"><div class="section__icon" style="--tint:${g.tint}">${icon(g.icon, 16)}</div><h2>${esc(g.label)}</h2><span>${g.items.length}</span></div>`;
    const cards = g.items.filter(asCard);
    const rows = g.items.filter((d) => !asCard(d));
    if (cards.length) {
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const d of cards) {
        const html = cardHtml(d);
        let entry = cardCache.get(d.id);
        if (!entry || entry.html !== html) {
          const t = document.createElement("template");
          t.innerHTML = html.trim();
          entry = { html, el: t.content.firstElementChild };
          cardCache.set(d.id, entry);
        }
        seen.add(d.id);
        grid.appendChild(entry.el);
      }
      sec.appendChild(grid);
    }
    if (rows.length) {
      const box = document.createElement("div");
      box.className = "rows";
      if (cards.length) box.style.marginTop = "14px";
      box.innerHTML = rows.map(rowHtml).join("");
      sec.appendChild(box);
    }
    frag.appendChild(sec);
  }
  for (const id of cardCache.keys()) if (!seen.has(id)) cardCache.delete(id);
  host.replaceChildren(frag);
}

const SURE_SHORT = { exact: "exact", likely: "likely", guess: "guess" };

/** Every device as one table: what exactly it is, where, its address and status. */
function tableHtml(list) {
  const rows = list
    .map(
      (d) => `<tr data-id="${esc(d.id)}" tabindex="0" class="${d.online === false ? "is-offline" : ""}">
      <td><span class="dot ${d.online ? "dot--on" : d.online === false ? "dot--off" : ""}"></span><strong>${esc(d.name)}</strong>${d.isNew ? ' <span class="badge badge--new">New</span>' : ""}</td>
      <td>${esc(d.what || d.kindLabel)} <span class="badge badge--${esc(d.confidence || "guess")}">${SURE_SHORT[d.confidence] || "guess"}</span></td>
      <td class="col-room">${esc(d.room || "")}</td>
      <td class="col-addr">${d.ip ? `<code>${esc(d.ip)}</code>` : '<span style="color:var(--muted)">via hub</span>'}${d.mac ? `<small>${esc(d.mac)}${d.vendor ? ` · ${esc(d.vendor)}` : ""}</small>` : ""}</td>
      <td class="col-state">${esc(stateLine(d) || (d.online === false ? "Offline" : "Online"))}</td>
    </tr>`,
    )
    .join("");
  return `<div class="table-wrap"><table class="dtable"><thead><tr><th>Name</th><th>What it is</th><th class="col-room">Room</th><th class="col-addr">Address</th><th class="col-state">Status</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/** A spreadsheet of everything on the network, for keeping records or sharing with whoever helps you. */
function exportCsv() {
  const cols = [["Name", (d) => d.name], ["What it is", (d) => d.what], ["Type", (d) => d.kindLabel], ["Brand", (d) => d.brand], ["Model", (d) => d.model], ["Model number", (d) => d.info?.modelNumber], ["Software", (d) => d.info?.os], ["How sure", (d) => d.confidence], ["How Patch knows", (d) => (d.evidence || []).join("; ")], ["Room", (d) => d.room], ["IP address", (d) => d.ip], ["Hardware (MAC) address", (d) => d.mac], ["Network chip maker", (d) => d.vendor], ["Online", (d) => (d.online === false ? "no" : "yes")], ["Status", (d) => stateLine(d)], ["First seen", (d) => d.firstSeen && new Date(d.firstSeen).toISOString()], ["Last seen", (d) => d.lastSeen && new Date(d.lastSeen).toISOString()]];
  const cell = (v) => {
    const t = v == null ? "" : String(v);
    // Quote everything; a leading = + - @ would make spreadsheets run it as a formula.
    return `"${(/^[=+\-@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"`;
  };
  const list = state.devices.filter((d) => !d.hidden);
  const csv = [cols.map(([h]) => cell(h)).join(","), ...list.map((d) => cols.map(([, f]) => cell(f(d))).join(","))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `patch-devices-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
  toast(`Exported ${list.length} devices.`);
}

function renderViewToggle() {
  // Spreadsheet downloads need a computer's browser (the phone app can't save them).
  $("#exportBtn").hidden = state.view !== "list" || !!BOOT.phone;
  for (const b of document.querySelectorAll("[data-view]")) {
    b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
    b.innerHTML = icon(b.dataset.view === "list" ? "list" : "grid", 17);
  }
}

function renderFilters() {
  const shown = state.devices.filter((d) => !d.hidden && (!state.room || (d.room || "") === state.room));
  const counts = Object.fromEntries(CATS.map((c) => [c.id, shown.filter((d) => catOf(d.kind) === c).length]));
  $("#filters").innerHTML = [
    `<button class="chip" aria-pressed="${state.filter === "all"}" data-filter="all">All <span class="count">${shown.length}</span></button>`,
    ...CATS.filter((c) => counts[c.id] || state.filter === c.id).map((c) => `<button class="chip" aria-pressed="${state.filter === c.id}" data-filter="${c.id}">${esc(c.short || c.label)} <span class="count">${counts[c.id]}</span></button>`),
  ].join("");
  const rooms = [...new Set(state.devices.filter((d) => !d.hidden).map((d) => d.room).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (state.room && !rooms.includes(state.room)) state.room = "";
  $("#roomWrap").hidden = !rooms.length;
  $("#roomIcon").innerHTML = icon("room", 16);
  $("#roomSelect").innerHTML = [`<option value="">All rooms</option>`, ...rooms.map((r) => `<option value="${esc(r)}" ${r === state.room ? "selected" : ""}>${esc(r)}</option>`)].join("");
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Things the person can act on, most useful first: voice, then devices waiting to be connected. */
function todoItems() {
  const items = [];
  if (!state.setup.sdk) items.push({ id: "sdk", icon: "alert", tint: "var(--warn)", title: "Finish installing voice", text: "In the Patch folder, run npm install, then restart Patch." });
  else if (!state.setup.voice) items.push({ id: "voice", icon: "mic", tint: "var(--voice)", title: "Turn on Patch's voice", text: "Add your ElevenLabs key once to talk or type to Patch.", button: `<button class="btn btn--voice btn--sm" data-ui="settings" data-focus="el">Add key</button>` });
  if (BOOT.phone && window.PatchAndroid?.screenAccess && !window.PatchAndroid.screenAccess()) {
    const greyed = (window.PatchAndroid.androidVersion?.() || 0) >= 33;
    items.push({
      id: "screen",
      icon: "eye",
      tint: "var(--c-computer)",
      title: "Let Patch see and use your screen",
      text: `So it can choose things in your browser, pick songs in Spotify and send music to speakers. In Settings, tap Patch and switch it on.${greyed ? " If it's greyed out, open App info, tap ⋮ (top right), choose Allow restricted settings, then try again." : ""}`,
      button: `<button class="btn btn--primary btn--sm" data-ui="screen-access">Turn on</button>${greyed ? `<button class="btn btn--sm" data-ui="app-info">App info</button>` : ""}`,
    });
  }
  for (const d of state.devices.filter((x) => x.setup && x.online !== false)) {
    const id = esc(d.id);
    const button = needsPair(d)
      ? `<button class="btn btn--primary btn--sm" data-act="pair" data-id="${id}">Connect</button>`
      : d.setup.kind === "token"
        ? `<button class="btn btn--primary btn--sm" data-ui="settings" data-focus="ha">Connect</button>`
        : d.setup.kind === "adb"
          ? `<button class="btn btn--sm" data-ui="open" data-id="${id}">Show me how</button>`
          : `<button class="btn btn--sm" data-ui="open" data-id="${id}">Add password</button>`;
    const title = d.setup.kind === "password" ? `Add ${d.name}'s password` : d.setup.kind === "adb" ? `Let Patch control ${d.name}` : `Connect ${d.name}`;
    items.push({ id: `setup:${d.id}`, icon: kindIcon(d), tint: tintOf(d), title, text: d.setup.message, button });
  }
  return items.filter((i) => !state.dismissed.has(i.id));
}

function renderSetup() {
  const items = todoItems();
  const box = $("#todo");
  box.hidden = !items.length;
  if (!items.length) return;
  const shown = state.todoOpen ? items : items.slice(0, 3);
  box.innerHTML = `<div class="todo__head">${icon("sparkle", 18, 'style="color:var(--warn)"')}<h2>A few things need you</h2><span class="todo__count">${items.length}</span></div>
    <div class="todo__list">${shown
      .map(
        (i) => `<div class="todo__item"><div class="todo__icon" style="--tint:${i.tint}">${icon(i.icon, 19)}</div><div class="todo__text"><strong>${esc(i.title)}</strong><span>${esc(i.text)}</span></div>${i.button ? `<div class="todo__action">${i.button}</div>` : ""}<button class="btn btn--ghost btn--sm icon-btn todo__close" data-dismiss="${esc(i.id)}" aria-label="Not now" title="Not now">${icon("close", 15)}</button></div>`,
      )
      .join("")}</div>
    ${items.length > 3 ? `<button class="todo__more" data-ui="todo-more">${state.todoOpen ? "Show fewer" : `Show ${items.length - 3} more`} ${icon(state.todoOpen ? "up" : "chevronDown", 15)}</button>` : ""}`;
}

function renderHero() {
  const ds = state.devices.filter((d) => !d.hidden && !d.parent);
  const online = ds.filter((d) => d.online !== false).length;
  const switchedOn = state.devices.filter((d) => !d.hidden && d.online !== false && (d.state?.on === true || d.state?.playback === "playing") && (d.kind !== "room")).length;
  const fresh = state.devices.filter((d) => d.isNew).length;
  const todo = todoItems().length;
  const t = state.tuneup;
  const sp = state.speed;
  const tone = (score) => (score >= 80 ? "tone-good" : score >= 55 ? "tone-warn" : "tone-bad");
  let line;
  if (state.scan.running && !ds.length) line = "Looking around your network…";
  else if (!ds.length) line = "Let's see what's on your WiFi.";
  else line = `${online} device${online === 1 ? " is" : "s are"} on your WiFi${switchedOn ? `, ${switchedOn} switched on` : ""}. ${todo ? `${todo} thing${todo === 1 ? " needs" : "s need"} you.` : "Everything's set up."}`;
  $("#hero").innerHTML = `
    <div class="hero__hello">
      <div><h1>${greeting()}</h1><p>${esc(line)}</p>${state.app.demo ? `<p class="hero__demo">${icon("info", 14)} A pretend home for trying Patch out</p>` : ""}</div>
      <button class="btn btn--sm" data-ui="ask">${icon("mic", 15)} Ask Patch</button>
    </div>
    <div class="tiles">
      <button class="tile ${t ? tone(t.score) : "tone-good"}" data-ui="tuneup">
        <span class="tile__label"><span class="tile__icon">${icon("shield", 16)}</span><span class="tile__long">Network health</span><span class="tile__short">Health</span></span>
        <span class="tile__body">${t ? `<span class="tile__value tile__value--score">${t.score}<small>${esc(t.grade)}</small></span><span class="tile__sub">${t.findings.filter((f) => f.severity !== "good" && f.severity !== "info" && !f.fixed).length} things to look at</span>` : `<span class="tile__value tile__value--cta">Check now</span><span class="tile__sub">Risks, updates and fixes</span>`}</span>
      </button>
      <button class="tile" style="--tint:var(--info)" data-ui="speed">
        <span class="tile__label"><span class="tile__icon">${icon("speed", 16)}</span><span class="tile__long">Internet</span><span class="tile__short">Internet</span></span>
        <span class="tile__body">${sp?.ok ? `<span class="tile__value">${Math.round(sp.downloadMbps)}<small>Mbps</small></span><span class="tile__sub">↑ ${Math.round(sp.uploadMbps)} Mbps · ${sp.latencyMs} ms</span>` : `<span class="tile__value tile__value--cta">${state.speedRunning ? "Testing…" : "Test speed"}</span><span class="tile__sub">About 15 seconds</span>`}</span>
      </button>
      <button class="tile" style="--tint:var(--accent)" data-ui="filter-all">
        <span class="tile__label"><span class="tile__icon">${icon("wifi", 16)}</span><span class="tile__long">On your WiFi</span><span class="tile__short">Online</span></span>
        <span class="tile__body"><span class="tile__value">${online}<small>online</small></span>
        <span class="mix" aria-hidden="true">${CATS.map((c) => [c, ds.filter((d) => catOf(d.kind) === c).length]).filter(([, n]) => n).map(([c, n]) => `<i style="flex:${n};background:${c.tint}" title="${esc(c.label)}: ${n}"></i>`).join("")}</span>
        <span class="tile__sub">${fresh ? `${fresh} new this week` : ds.length - online ? `${ds.length - online} offline` : "All answering"}</span></span>
      </button>
    </div>`;
}

function renderTop() {
  const chip = $("#netchip");
  if (state.network) {
    chip.hidden = false;
    chip.innerHTML = `${icon("wifi", 15)} <span>${state.app.demo ? "Demo home" : "Home network"}</span> <code>${esc(state.network.cidr)}</code>`;
  }
  const s = state.scan;
  $("#scanBtn").innerHTML = s.running ? `${icon("refresh", 17, 'class="spin"')}<span class="btn__label">Scanning…</span>` : `${icon("scan", 17)}<span class="btn__label">Scan</span>`;
  $("#scanBtn").disabled = !!s.running;
  $("#scanBtn").title = "Look for devices again";
  $("#scanBtn").setAttribute("aria-label", s.running ? "Scanning" : "Scan for devices");
  $("#tuneBtn").innerHTML = `${icon("tune", 17)}<span class="btn__label">Tune-up</span>`;
  $("#tuneBtn").title = "Check the network for problems";
  $("#tuneBtn").setAttribute("aria-label", "Tune-up");
  $("#settingsBtn").innerHTML = icon("gear", 19);
  $("#exportBtn").innerHTML = icon("download", 18);
  const bar = $("#scanProgress");
  bar.hidden = !s.running;
  bar.firstElementChild.style.width = `${Math.max(4, s.pct || 0)}%`;
}

function renderAll() {
  renderTop();
  renderHero();
  renderSetup();
  tvApps.render();
  renderFilters();
  renderDevices();
  if (state.openId) renderDrawer();
}

// ── device actions ────────────────────────────────────

export function mergeDevice(d) {
  const i = state.devices.findIndex((x) => x.id === d.id);
  if (i >= 0) state.devices[i] = d;
  else state.devices.push(d);
}

async function doAction(id, action, value, { confirmToken } = {}) {
  const d = state.devices.find((x) => x.id === id);
  state.busy.add(id);
  renderDevices();
  let r;
  try {
    r = await api("POST", `/api/devices/${encodeURIComponent(id)}/action`, { action, value, confirmToken });
  } catch (err) {
    r = { ok: false, message: err.message };
  }
  state.busy.delete(id);
  if (r.needsConfirmation) {
    renderDevices();
    const ok = await confirmDialog({ title: `${ACTION_LABEL[action] || cap(action)}: ${d?.name || "this device"}?`, body: r.risk || r.message, confirm: ACTION_LABEL[action] || "Go ahead" });
    if (ok) return doAction(id, action, value, { confirmToken: r.confirmToken });
    return r;
  }
  if (r.device) mergeDevice(r.device);
  if (r.apps) state.tvAppList = { id, apps: r.apps };
  if (r.screen && d?.driver === "androidtv") state.tvScreen = { id, text: r.screen };
  // The screen has changed and the TV didn't say what's on it now: the old list is out of date.
  else if (r.ok && ["tap", "scroll", "press_button", "launch_app", "open_website", "web_search", "search", "type_text"].includes(action) && state.tvScreen?.id === id) state.tvScreen = null;
  if (r.ok && d?.driver === "androidtv" && state.tvShot?.id === id && !["read_screen", "list_apps", "volume_up", "volume_down", "mute"].includes(action)) setTimeout(() => showTvScreen(id, { quiet: true }), 900);
  renderAll();
  toast(r.message || (r.ok ? "Done." : "That didn't work."), r.ok ? "ok" : "bad");
  if (r.ok) voice.uiActivity(`The person used the dashboard: ${r.message}`);
  if (r.results?.length) showYouTubeResults(id, r.results);
  return r;
}

/** Search results under the YouTube box in the device drawer (kept in state so live updates don't wipe them). */
function showYouTubeResults(id, results) {
  state.ytResults = { id, results: results.slice(0, 5) };
  const box = $("#ytResults");
  if (box && state.openId === id) box.innerHTML = ytResultsHtml(id);
}

function ytResultsHtml(id) {
  if (state.ytResults?.id !== id) return "";
  return state.ytResults.results
    .map((x) => `<div class="yt-row"><span>${esc(x.title)}<em>${esc([x.channel, x.live ? "live" : x.duration].filter(Boolean).join(" · "))}</em></span><button class="btn btn--sm" data-act="play_youtube" data-value="${esc(x.id)}" data-id="${esc(id)}">${icon("play", 13)} Play</button></div>`)
    .join("");
}

export function flashDevice(id) {
  const el = $(`.card[data-id="${CSS.escape(id)}"], .row-item[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  el.classList.add("is-flash");
  setTimeout(() => el.classList.remove("is-flash"), 2200);
}

// ── drawer ────────────────────────────────────────────

const SWATCHES = ["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#00c7be", "#0a84ff", "#5e5ce6", "#bf5af2", "#ff2d92", "#ffffff"];
const PORT_NAMES = { 21: "FTP", 22: "SSH", 23: "Telnet", 53: "DNS", 80: "Web", 139: "NetBIOS", 443: "Web (secure)", 445: "File sharing", 548: "AFP", 554: "Video stream (RTSP)", 631: "Printing (IPP)", 1400: "Sonos", 1883: "MQTT", 3000: "TV remote (LG)", 3001: "TV remote (LG, secure)", 3389: "Remote Desktop", 5555: "Android debugging (ADB)", 8002: "TV remote (Samsung, secure)", 5000: "Web (alt)", 5001: "Web (alt, secure)", 5900: "Screen sharing (VNC)", 7000: "AirPlay", 8001: "TV remote", 8008: "Cast", 8009: "Cast", 8060: "Roku", 8080: "Web (alt)", 8123: "Home Assistant", 8443: "Web (alt, secure)", 9100: "Printing (raw)", 9123: "Elgato", 9999: "Kasa", 32400: "Plex", 55443: "Yeelight", 62078: "iPhone sync" };
// Brand colours for the app buttons on the TV remote.
const APP_TILES = [
  ["Netflix", "#e50914"], ["YouTube", "#ff0033"], ["Prime Video", "#00a8e1"], ["Disney Plus", "#113ccf"], ["Hulu", "#14a85f"], ["Spotify", "#1db954"],
];

export function openDevice(id) {
  if (state.openId !== id) state.drawerTab = null;
  state.openId = id;
  $("#drawer").classList.add("is-open");
  $("#drawer").setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("is-open");
  renderDrawer(true);
  api("GET", `/api/devices/${encodeURIComponent(id)}`)
    .then((r) => {
      if (r.device) {
        mergeDevice(r.device);
        if (state.openId === id) renderDrawer();
        renderDevices();
      }
    })
    .catch(() => {});
}

function closeOverlays() {
  state.openId = null;
  $("#drawer").classList.remove("is-open");
  $("#drawer").setAttribute("aria-hidden", "true");
  $("#modal").classList.remove("is-open");
  $("#modal").setAttribute("aria-hidden", "true");
  $("#scrim").classList.remove("is-open");
}

const btn = (id, act, label, extra = "", value) => `<button class="btn btn--sm ${extra}" data-act="${act}" data-id="${id}"${value != null ? ` data-value="${esc(value)}"` : ""}>${label}</button>`;

/** A TV or streaming box as a remote control: power, d-pad, volume and channel rockers, apps, YouTube, the web. */
function remoteHtml(d) {
  const s = d.state || {};
  const id = esc(d.id);
  const key = (v, ic, cls = "", label = v) => `<button class="${cls}" type="button" data-act="press_button" data-value="${v}" data-id="${id}" aria-label="${label}">${ic}</button>`;
  const hasPower = has(d, "turn_on") || has(d, "turn_off");
  const isOff = s.on === false;
  const out = [];
  out.push(`<div class="panel">
    <div class="remote-top">
      ${hasPower ? `<button class="power-btn ${isOff ? "is-off" : ""}" type="button" data-act="${isOff ? "turn_on" : has(d, "turn_off") ? "turn_off" : "turn_on"}" data-id="${id}" aria-label="${isOff ? "Turn on" : "Turn off"}" title="${isOff ? "Turn on" : "Turn off"}">${icon("power", 22)}</button>` : "<span></span>"}
      <span class="pill">${esc(stateLine(d) || (isOff ? "Off" : "On"))}</span>
    </div>
    <div class="remote">
      ${has(d, "volume_up") ? `<div class="rocker"><button type="button" data-act="volume_up" data-id="${id}" aria-label="Volume up">+</button><span>Vol</span><button type="button" data-act="volume_down" data-id="${id}" aria-label="Volume down">−</button></div>` : "<span></span>"}
      ${has(d, "press_button") ? `<div class="dpad">${key("up", icon("up", 22), "up", "Up")}${key("left", icon("left", 22), "left", "Left")}${key("ok", "OK", "ok", "OK")}${key("right", icon("right", 22), "right", "Right")}${key("down", icon("down", 22), "down", "Down")}</div>` : "<span></span>"}
      ${has(d, "channel_up") ? `<div class="rocker"><button type="button" data-act="channel_up" data-id="${id}" aria-label="Channel up">+</button><span>Ch</span><button type="button" data-act="channel_down" data-id="${id}" aria-label="Channel down">−</button></div>` : "<span></span>"}
    </div>
    ${has(d, "press_button") || has(d, "mute") ? `<div class="remote-keys">${has(d, "press_button") ? `${key("back", icon("back", 18), "btn", "Back")}${key("home", icon("home", 18), "btn", "Home")}${key("play pause", icon(s.playback === "playing" ? "pause" : "play", 18), "btn", "Play or pause")}` : ""}${has(d, "mute") ? `<button class="btn" type="button" data-act="${s.muted && has(d, "unmute") ? "unmute" : "mute"}" data-id="${id}" aria-label="Mute">${icon(s.muted ? "volume" : "mute", 18)}</button>` : ""}</div>` : ""}
  </div>`);
  if (has(d, "launch_app")) {
    out.push(`<div class="panel"><h3>Apps</h3><div class="app-tiles">${APP_TILES.map(([name, color]) => `<button class="app-tile ${String(s.app || "").toLowerCase().startsWith(name.toLowerCase().split(" ")[0]) ? "is-current" : ""}" style="--app:${color}" type="button" data-act="launch_app" data-value="${esc(name)}" data-id="${id}">${esc(name === "Disney Plus" ? "Disney+" : name)}</button>`).join("")}</div>
      <form class="search-box" style="margin-top:10px" data-form="launch_app" data-id="${id}">${icon("grid", 17)}<input name="value" placeholder="Open another app, e.g. Plex" aria-label="App name"><button class="btn btn--sm">Open</button></form></div>`);
  }
  if (has(d, "set_channel")) {
    out.push(`<div class="panel"><h3>Channel</h3><form class="search-box" data-form="set_channel" data-id="${id}">${icon("tv", 17)}<input name="value" placeholder="${s.channel ? `Now ${esc(s.channel)}. Type a number or name` : "A number like 7.1, or a name"}" aria-label="Channel"><button class="btn btn--sm btn--primary">Go</button></form></div>`);
  }
  if (has(d, "search_youtube")) {
    out.push(`<div class="panel"><h3>YouTube</h3><form class="search-box search-box--yt" data-form="search_youtube" data-id="${id}">${icon("youtube", 18)}<input name="value" placeholder="Search YouTube on ${esc(d.name)}" aria-label="Search YouTube"><button class="btn btn--sm">Search</button></form><div class="yt-results" id="ytResults">${ytResultsHtml(d.id)}</div></div>`);
  }
  const web = [];
  if (has(d, "web_search")) web.push(`<form class="search-box" data-form="web_search" data-id="${id}">${icon("search", 17)}<input name="value" placeholder="Search the web" aria-label="Search the web"><button class="btn btn--sm">Search</button></form>`);
  if (has(d, "open_website")) web.push(`<form class="search-box" data-form="open_website" data-id="${id}">${icon("globe", 17)}<input name="value" placeholder="Open a website, e.g. bbc.co.uk" aria-label="Website"><button class="btn btn--sm">Open</button></form>`);
  if (has(d, "type_text")) web.push(`<form class="search-box" data-form="type_text" data-id="${id}">${icon("keyboard", 17)}<input name="value" placeholder="Type into the box open on the TV" aria-label="Text to type"><button class="btn btn--sm">Type</button></form>`);
  if (has(d, "search")) web.push(`<form class="search-box" data-form="search" data-id="${id}">${icon("search", 17)}<input name="value" placeholder="Search for a show or movie" aria-label="Search shows"><button class="btn btn--sm">Search</button></form>`);
  if (web.length) out.push(`<div class="panel"><h3>${has(d, "web_search") ? "Web & typing" : "Search & typing"}</h3><div class="stack">${web.join("")}</div></div>`);
  if (has(d, "switch_input")) out.push(`<div class="panel"><h3>Input</h3><div class="btns">${["HDMI 1", "HDMI 2", "HDMI 3", "TV"].map((a) => btn(id, "switch_input", a, "", a)).join("")}</div></div>`);
  if (has(d, "read_screen")) out.push(tvScreenHtml(d));
  if (has(d, "list_apps") || has(d, "install_app")) out.push(tvAppsPanelHtml(d));
  return out.join("");
}

/**
 * What's on an Android TV's screen: a picture of it to look at and tap, and the list Patch reads
 * (in Patch's browser, every link, button and box on the page), as buttons to choose things with.
 */
function tvScreenHtml(d) {
  const id = esc(d.id);
  const shot = state.tvScreen?.id === d.id ? state.tvScreen.text : null;
  const pic = state.tvShot?.id === d.id ? state.tvShot : null;
  const lines = (shot || "").split("\n");
  const rows = lines.slice(1).map((l) => {
    const item = l.match(/^(\d+)\. ([^:]+): (.*)$/);
    if (item) {
      const [, n, kind, text] = item;
      const here = /\((?:[^)]*, )?selected(?:, [^)]*)?\)$/.test(text);
      return `<button class="screen-item${here ? " is-here" : ""}" data-act="tap" data-value="${n}" data-id="${id}"><span class="screen-item__n">${n}</span><span>${esc(text.replace(/ \((?:[^)]*, )?selected(?:, [^)]*)?\)$/, ""))}</span><em>${here ? "remote is here" : esc(kind)}</em></button>`;
    }
    const words = l.match(/^(Heading|Text): (.*)$/);
    if (words) return `<p class="screen-line${words[1] === "Heading" ? " screen-line--head" : ""}">${esc(words[2])}</p>`;
    return /^\(.*\)$/.test(l) ? `<p class="screen-line screen-line--note">${esc(l.slice(1, -1))}</p>` : "";
  }).join("");
  return `<div class="panel"><h3>On the TV's screen</h3>
    <p class="panel__hint">Patch can see ${esc(d.name)}'s screen and use it for you. In Patch's browser it reads every link, button and box on a page; other apps it reads when they say what's on them (some, like Netflix, only draw a picture). Ask it by voice, or use the buttons here.</p>
    <div class="btns"><button class="btn btn--sm" data-act="read_screen" data-id="${id}">${icon("eye", 14)} ${shot ? "Look again" : "What's on the screen?"}</button><button class="btn btn--sm" data-ui="tv-shot" data-id="${id}">${icon("tv", 14)} ${pic ? "New picture" : "Show me the screen"}</button>${btn(id, "scroll", `${icon("down", 14)} Move down`, "", "down")}${btn(id, "scroll", `${icon("up", 14)} Move up`, "", "up")}</div>
    ${pic ? `<div class="tvshot${pic.loading ? " is-loading" : ""}">${pic.url ? `<img src="${pic.url}" alt="${esc(d.name)}'s screen" data-tv-shot="${id}" draggable="false">` : `<span class="tvshot__wait">${icon("refresh", 22, 'class="spin"')}</span>`}<small>${pic.url ? "Tap the picture to tap that spot on the TV." : "Getting a picture of the screen…"}</small></div>` : ""}
    ${shot ? `<p class="screen-title">${esc(lines[0].replace(/^On screen: /, ""))}</p>` : ""}
    ${rows ? `<div class="screen-items">${rows}</div>` : ""}
  </div>`;
}

/** Get a picture of a TV's screen and show it in the TV's card. */
async function showTvScreen(id, { quiet = false } = {}) {
  const old = state.tvShot?.id === id ? state.tvShot : null;
  if (old?.loading) return;
  state.tvShot = { id, url: old?.url || null, loading: true };
  if (!quiet || !old?.url) renderAll();
  try {
    const res = await fetch(`/api/devices/${encodeURIComponent(id)}/screen.png`, { headers: { "x-patch-token": BOOT.token } });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.message || "The TV didn't give a picture of its screen.");
    const url = URL.createObjectURL(await res.blob());
    if (old?.url) URL.revokeObjectURL(old.url);
    // Still wanted? (The person may have closed the card or asked another TV meanwhile.)
    if (state.tvShot?.id !== id) return URL.revokeObjectURL(url);
    state.tvShot = { id, url, loading: false };
  } catch (err) {
    state.tvShot = old?.url ? { id, url: old.url, loading: false } : null;
    if (!quiet) toast(err.message, "bad");
  }
  renderAll();
}

/** A tap on the picture: tap that spot on the TV, then look again. */
async function tapTvScreen(img, e) {
  const id = img.dataset.tvShot;
  const box = img.getBoundingClientRect();
  if (!img.naturalWidth || !box.width) return;
  const x = Math.round(((e.clientX - box.left) / box.width) * img.naturalWidth);
  const y = Math.round(((e.clientY - box.top) / box.height) * img.naturalHeight);
  const r = await api("POST", `/api/devices/${encodeURIComponent(id)}/screen/tap`, { x, y }).catch((err) => ({ ok: false, message: err.message }));
  if (!r.ok) return toast(r.message || "That didn't work.", "bad");
  if (state.tvScreen?.id === id) state.tvScreen = null;
  setTimeout(() => showTvScreen(id, { quiet: true }), 900);
}

/** The TV's apps, adding one (from its store, or an app file on Android TVs), and your own TV apps. */
function tvAppsPanelHtml(d) {
  const id = esc(d.id);
  const list = state.tvAppList?.id === d.id ? state.tvAppList.apps : null;
  const android = d.driver === "androidtv";
  const store = android ? (d.brand === "Amazon" ? "the Amazon Appstore" : "Google Play") : d.driver === "roku" ? "the Roku Channel Store" : "the TV's app store";
  const mine = tvApps.apps.filter((a) => a.tvs.some((t) => t.deviceId === d.id));
  return `<div class="panel"><h3>Apps on this TV</h3>
    ${has(d, "list_apps") ? `<div class="btns">${btn(id, "list_apps", `${icon("grid", 14)} ${list ? "Refresh the list" : "Show all its apps"}`)}</div>` : ""}
    ${list ? `<div class="app-list">${list.map((a) => `<span class="app-chip${a.madeWithPatch ? " app-chip--mine" : ""}"><button data-act="launch_app" data-value="${esc(a.name)}" data-id="${id}" title="Open ${esc(a.name)}">${esc(a.name)}</button>${android && a.removable && !a.madeWithPatch ? `<button class="app-chip__x" data-act="uninstall_app" data-value="${esc(a.name)}" data-id="${id}" aria-label="Remove ${esc(a.name)}">${icon("close", 12)}</button>` : ""}</span>`).join("")}</div>` : ""}
    ${has(d, "install_app") ? `<form class="search-box" style="margin-top:10px" data-form="install_app" data-id="${id}">${icon("plus", 17)}<input name="value" placeholder="Add an app from ${esc(store)}, e.g. Plex" aria-label="App to add"><button class="btn btn--sm btn--primary">Add</button></form>` : ""}
    ${android ? `<div class="btns" style="margin-top:10px"><label class="btn btn--sm">${icon("upload", 14)} Install an app file (APK)<input type="file" accept=".apk,application/vnd.android.package-archive,application/octet-stream" data-apk="${id}" hidden></label></div>` : ""}
    <div class="mine"><h4>Your TV apps${mine.length ? ` on ${esc(d.name)}` : ""}</h4>${mine.length ? `<div class="btns">${mine.map((a) => `<button class="btn btn--sm" data-tv="put" data-app="${esc(a.id)}">${esc(a.emoji)} ${esc(a.name)}</button>`).join("")}</div>` : `<p class="panel__hint">Make your own: a photo frame, a video channel, a clock, a quiz…</p>`}<button class="btn btn--sm btn--primary" data-tv="new">${icon("plus", 14)} Make a TV app</button></div>
  </div>`;
}

const PHONE_APPS = [
  ["Spotify", "#1db954"],
  ["YouTube", "#ff0033"],
  ["Chrome", "#1a73e8"],
];

/** The phone Patch runs on (in the Patch app): its screen, music, apps and the web. */
function phoneHtml(d) {
  const id = esc(d.id);
  const screenOn = !!window.PatchAndroid?.screenAccess?.();
  const greyed = (window.PatchAndroid?.androidVersion?.() || 0) >= 33;
  const out = [];
  out.push(`<div class="panel"><h3>Screen</h3>
    ${
      screenOn
        ? `<p class="phone-note">${icon("check", 16)} Patch can see and use your screen. Ask it what's on screen, or to tap, scroll or type something.</p>`
        : `<div class="note">${icon("eye", 18, 'class="note__icon"')}<p>Let Patch see and use your screen so it can choose things in your browser, pick songs in Spotify and send music to speakers. In Settings, tap <b>Patch</b> and switch it on.${greyed ? " If it's greyed out, open <b>App info</b>, tap <b>⋮</b> (top right), choose <b>Allow restricted settings</b>, then try again." : ""}</p></div>
           <div class="btns" style="margin-bottom:10px"><button class="btn btn--primary btn--sm" data-ui="screen-access">Turn on</button>${greyed ? `<button class="btn btn--sm" data-ui="app-info">App info</button>` : ""}</div>`
    }
    <div class="btns">${btn(id, "press_button", `${icon("back", 15)} Back`, "", "back")}${btn(id, "press_button", `${icon("home", 15)} Home`, "", "home")}${btn(id, "press_button", "Recent apps", "", "recent apps")}</div></div>`);
  out.push(`<div class="panel"><h3>Music</h3>
    <form class="search-box" data-form="play_music" data-id="${id}">${icon("music", 17)}<input name="value" placeholder="A song, artist or playlist" aria-label="What to play"><button class="btn btn--sm btn--primary">Play</button></form>
    <div class="btns" style="margin-top:10px">${btn(id, "previous", icon("prev", 15))}${btn(id, "play", icon("play", 15))}${btn(id, "pause", icon("pause", 15))}${btn(id, "next", icon("next", 15))}<span style="flex:1"></span>${btn(id, "volume_down", "−")}${btn(id, "volume_up", "+")}</div>
    <p class="phone-hint">Plays in Spotify, or another music app if you don't have it. To hear it on a speaker, ask Patch, for example "play it on the kitchen speaker".</p></div>`);
  out.push(`<div class="panel"><h3>Apps</h3><div class="app-tiles">${PHONE_APPS.map(([name, color]) => `<button class="app-tile" style="--app:${color}" type="button" data-act="launch_app" data-value="${esc(name)}" data-id="${id}">${esc(name)}</button>`).join("")}</div>
    <form class="search-box" style="margin-top:10px" data-form="launch_app" data-id="${id}">${icon("grid", 17)}<input name="value" placeholder="Open another app, e.g. Maps" aria-label="App name"><button class="btn btn--sm">Open</button></form></div>`);
  out.push(`<div class="panel"><h3>Web</h3><div class="stack">
    <form class="search-box" data-form="web_search" data-id="${id}">${icon("search", 17)}<input name="value" placeholder="Search the web" aria-label="Search the web"><button class="btn btn--sm">Search</button></form>
    <form class="search-box" data-form="open_website" data-id="${id}">${icon("globe", 17)}<input name="value" placeholder="Open a website, e.g. bbc.co.uk" aria-label="Website"><button class="btn btn--sm">Open</button></form></div></div>`);
  return out.join("");
}

/** The Controls tab: a remote for TVs, sliders and swatches for lights, and so on. */
function controlsHtml(d) {
  const s = d.state || {};
  const id = esc(d.id);
  if (d.online === false && !d.setup) return `<div class="note">${icon("info", 18, 'class="note__icon"')}<p>${esc(d.name)} isn't answering right now.${d.lastSeen ? ` Last seen ${ago(d.lastSeen)}.` : ""} Check it has power and is on your WiFi.</p></div>`;
  if (isTvLike(d)) return remoteHtml(d);
  if (d.self && d.kind === "phone") return phoneHtml(d);
  const rows = [];
  if (isPowered(d)) rows.push(`<div class="control-row"><label>Power</label><button class="switch" role="switch" aria-checked="${s.on}" data-act="${s.on ? "turn_off" : "turn_on"}" data-id="${id}" aria-label="Power"></button></div>`);
  else if (has(d, "turn_on") || has(d, "turn_off")) rows.push(`<div class="control-row"><label>Power</label><div class="btns">${has(d, "turn_on") ? btn(id, "turn_on", `${icon("power", 14)} On`) : ""}${has(d, "turn_off") ? btn(id, "turn_off", "Off") : ""}</div></div>`);
  if (has(d, "set_brightness")) rows.push(`<div class="control-row"><label>Brightness</label><input type="range" min="1" max="100" value="${s.brightness ?? 50}" style="--fill:${s.brightness ?? 50}%" data-range="set_brightness" data-id="${id}" aria-label="Brightness"><span>${s.brightness ?? "–"}%</span></div>`);
  if (has(d, "set_color_temperature")) rows.push(`<div class="control-row"><label>White tone</label><input class="range-ct" type="range" min="2200" max="6500" step="100" value="${s.colorTemperature ?? 3000}" data-range="set_color_temperature" data-id="${id}" aria-label="White tone"><span>${s.colorTemperature ? `${s.colorTemperature} K` : "–"}</span></div>`);
  if (has(d, "set_color")) rows.push(`<div class="control-row control-row--stack"><label>Colour</label><div class="swatches">${SWATCHES.map((c) => `<button class="swatch" style="background:${c}" data-act="set_color" data-value="${c}" data-id="${id}" aria-label="Colour ${c}"></button>`).join("")}<label class="swatch" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" title="Any colour"><input type="color" value="${s.color || "#ffaa00"}" data-color="set_color" data-id="${id}" aria-label="Pick a colour"></label></div></div>`);
  if (has(d, "set_scene") && d.info?.scenes?.length) rows.push(`<div class="control-row control-row--stack"><label>Scenes</label><div class="btns">${d.info.scenes.map((n) => btn(id, "set_scene", esc(n), "", n)).join("")}</div></div>`);
  if (has(d, "set_effect")) rows.push(`<div class="control-row control-row--stack"><label>Effect</label><div class="btns">${["Solid", "Rainbow", "Breathe", "Twinkle", "Fire 2012", "Colorloop", "Candle"].map((n) => btn(id, "set_effect", n, "", n)).join("")}</div></div>`);
  if (has(d, "set_preset")) rows.push(`<div class="control-row"><label>Preset</label><form class="inline-form" data-form="set_preset" data-id="${id}"><input name="value" placeholder="Preset name, e.g. Cozy"><button class="btn btn--sm">Apply</button></form></div>`);
  if (has(d, "play") || has(d, "pause")) {
    rows.push(`<div class="control-row"><label>Playback</label><div class="btns">${has(d, "previous") ? btn(id, "previous", icon("prev", 15)) : ""}${has(d, "play") ? btn(id, "play", icon("play", 15)) : ""}${has(d, "pause") ? btn(id, "pause", icon("pause", 15)) : ""}${has(d, "stop") ? btn(id, "stop", icon("stop", 15)) : ""}${has(d, "next") ? btn(id, "next", icon("next", 15)) : ""}</div></div>`);
  }
  if (has(d, "set_volume")) rows.push(`<div class="control-row"><label>Volume</label><input type="range" min="0" max="100" value="${s.volume ?? 20}" style="--fill:${s.volume ?? 20}%" data-range="set_volume" data-id="${id}" aria-label="Volume"><span>${s.volume ?? "–"}</span></div>`);
  else if (has(d, "volume_up")) rows.push(`<div class="control-row"><label>Volume</label><div class="btns">${btn(id, "volume_down", "−")}${btn(id, "volume_up", "+")}${has(d, "mute") ? btn(id, "mute", icon("mute", 15)) : ""}</div></div>`);
  if (has(d, "mute") && has(d, "unmute")) rows.push(`<div class="control-row"><label>Sound</label><div class="btns">${btn(id, s.muted ? "unmute" : "mute", s.muted ? `${icon("volume", 15)} Unmute` : `${icon("mute", 15)} Mute`)}</div></div>`);
  if (has(d, "launch_app")) rows.push(`<div class="control-row control-row--stack"><label>Open app</label><div class="app-tiles">${APP_TILES.slice(0, 3).map(([name, color]) => `<button class="app-tile" style="--app:${color}" type="button" data-act="launch_app" data-value="${esc(name)}" data-id="${id}">${esc(name)}</button>`).join("")}</div></div>`);
  if (has(d, "set_temperature")) rows.push(`<div class="control-row"><label>Target</label><div class="btns">${btn(id, "set_temperature", "−", "", (s.targetTemperature ?? 20) - 0.5)}<strong style="min-width:70px;text-align:center;align-self:center;font-size:18px">${s.targetTemperature ?? "–"}${s.unit || ""}</strong>${btn(id, "set_temperature", "+", "", (s.targetTemperature ?? 20) + 0.5)}</div></div>`);
  if (has(d, "set_mode") && s.modes?.length) rows.push(`<div class="control-row control-row--stack"><label>Mode</label><div class="btns">${s.modes.map((m) => btn(id, "set_mode", esc(cap(m)), m === s.mode ? "btn--primary" : "", m)).join("")}</div></div>`);
  if (has(d, "open") || has(d, "close")) rows.push(`<div class="control-row"><label>Move</label><div class="btns">${has(d, "open") ? btn(id, "open", "Open") : ""}${has(d, "stop") && !has(d, "play") ? btn(id, "stop", "Stop") : ""}${has(d, "close") ? btn(id, "close", "Close") : ""}</div></div>`);
  if (has(d, "set_position")) rows.push(`<div class="control-row"><label>Position</label><input type="range" min="0" max="100" value="${s.position ?? 50}" style="--fill:${s.position ?? 50}%" data-range="set_position" data-id="${id}" aria-label="Position"><span>${s.position ?? "–"}%</span></div>`);
  if (has(d, "lock")) rows.push(`<div class="control-row"><label>Lock</label><div class="btns">${btn(id, "lock", `${icon("lock", 14)} Lock`)}${btn(id, "unlock", "Unlock")}</div></div>`);
  if (has(d, "start")) rows.push(`<div class="control-row"><label>Cleaning</label><div class="btns">${btn(id, "start", "Start")}${btn(id, "stop", "Stop")}${has(d, "dock") ? btn(id, "dock", "Dock") : ""}</div></div>`);
  if (has(d, "activate")) rows.push(`<div class="control-row"><label>Run</label>${btn(id, "activate", `${icon("play", 14)} Run now`, "btn--primary")}</div>`);
  if (d.kind === "printer" && s.supplies?.length) {
    rows.push(
      `<div>${s.supplies
        .map((x) => `<div class="supply"><span>${esc(x.name)}</span><div class="supply__bar"><i style="width:${x.level ?? 0}%;background:${esc(x.color || "var(--accent)")}"></i></div><span>${x.level != null ? `${x.level}%` : x.someLeft ? "OK" : "?"}</span></div>`)
        .join("")}${s.reasons?.length ? `<p style="color:var(--warn);margin:8px 0 0">${esc(s.reasons.join(", "))}</p>` : ""}</div>`,
    );
  }
  if (d.kind === "router" && d.info?.portForwards?.length) {
    rows.push(
      `<div><p style="margin:0 0 8px;color:var(--text-2)">Open to the internet (opened by apps via UPnP):</p>${d.info.portForwards
        .map((m) => `<div class="control-row" style="margin:6px 0"><code style="flex:1">${esc(`${m.protocol} ${m.externalPort} → ${m.internalClient}:${m.internalPort}`)}</code><span style="color:var(--muted)">${esc(m.description)}</span>${btn(id, "remove_port_forward", "Close", "btn--danger", `${m.protocol} ${m.externalPort}`)}</div>`)
        .join("")}</div>`,
    );
  }
  return rows.length ? `<div class="panel">${rows.join("")}</div>` : "";
}

/** The Details tab: what it is and how Patch knows, where it is, upkeep, and its network details. */
function detailsHtml(d) {
  const i = d.info || {};
  const id = esc(d.id);
  const SURE = { exact: "It says so itself", likely: "Strong clues", guess: "Best guess" };
  const identity = [
    ["What it is", d.what && `<strong>${esc(d.what)}</strong>${d.confidence ? ` <span class="badge badge--${d.confidence}">${SURE[d.confidence] || esc(d.confidence)}</span>` : ""}`],
    ["How Patch knows", d.evidence?.length && esc(d.evidence.join("; "))],
    ["Type", d.kindLabel],
    ["Brand", d.brand],
    ["Model", d.model],
    ["Model number", i.modelNumber && `<code>${esc(i.modelNumber)}</code>`],
    ["Software", i.os && esc(i.os)],
    ["Firmware", i.firmware && esc(i.firmware)],
  ].filter(([, v]) => v);
  const network = [
    ["Address", d.ip && `<code>${esc(d.ip)}</code>`],
    ["Hardware ID", d.mac && `<code>${esc(d.mac)}</code>${d.vendor ? ` · ${esc(d.vendor)}` : ""}`],
    ["WiFi signal", typeof i.rssi === "number" && `${i.rssi} dBm (${i.rssi > -60 ? "great" : i.rssi > -67 ? "good" : i.rssi > -75 ? "fair" : "weak"})`],
    ["Power use", typeof d.state?.power === "number" && `${d.state.power} W`],
    ["Services", d.ports?.length && d.ports.map((p) => `${PORT_NAMES[p] || "port"} <code>${p}</code>`).join(", ")],
    ["Connection", i.linkDownMbps && `${i.accessType || "WAN"} · ${i.linkDownMbps}/${i.linkUpMbps} Mbps line`],
    ["First seen", d.firstSeen && new Date(d.firstSeen).toLocaleString()],
    ["Last seen", d.online ? "Now" : d.lastSeen && ago(d.lastSeen)],
    ["Reported name", d.reportedName && d.reportedName !== d.name && esc(d.reportedName)],
  ].filter(([, v]) => v);
  const kv = (rows) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${typeof v === "string" && !v.includes("<") ? esc(v) : v}</dd>`).join("")}</dl>`;
  const care = [
    has(d, "identify") && btn(id, "identify", `${icon("sparkle", 14)} Identify`),
    has(d, "update_firmware") && btn(id, "update_firmware", `${icon("refresh", 14)} Install update${i.updateAvailable ? " (available)" : ""}`, i.updateAvailable || d.state?.updateAvailable ? "btn--primary" : ""),
    has(d, "enable_auto_updates") && d.state?.autoUpdate === false && btn(id, "enable_auto_updates", "Turn on auto-updates"),
    has(d, "set_led") && btn(id, "set_led", d.state?.ledOff ? "Status light on" : "Status light off", "", d.state?.ledOff ? "on" : "off"),
    has(d, "wake") && btn(id, "wake", `${icon("power", 14)} Wake up`),
    has(d, "pair") && btn(id, "pair", "Connect", "btn--primary"),
    has(d, "reboot") && btn(id, "reboot", `${icon("refresh", 14)} Restart`),
    d.webUrl && `<a class="btn btn--sm" href="${esc(d.webUrl)}" target="_blank" rel="noopener noreferrer">${icon("external", 14)} Settings page</a>`,
    d.ip && `<button class="btn btn--sm" data-ui="diagnose" data-id="${id}">${icon("info", 14)} Diagnose</button>`,
  ].filter(Boolean);
  const rooms = [...new Set(state.devices.map((x) => x.room).filter(Boolean))];
  return `
    <div class="panel"><h3>What it is</h3>${kv(identity)}</div>
    ${care.length ? `<div class="panel"><h3>Care</h3><div class="btns">${care.join("")}</div><div id="diagOut"></div></div>` : ""}
    ${d.setup?.kind === "password" || d.hasPassword || (d.driver === "shelly" && !d.parent) ? `<div class="panel"><h3>Device password</h3><form class="inline-form" data-form="credentials" data-id="${id}"><input name="password" type="password" placeholder="${d.hasPassword ? "Saved. Type a new one to change it" : "The password set on the device"}" autocomplete="off"><button class="btn btn--sm">Save</button></form><p style="color:var(--muted);font-size:12.5px;margin:8px 0 0">Stored only on ${HERE}, in Patch's data folder.</p></div>` : ""}
    <div class="panel"><h3>Where</h3><div class="control-row"><label>Room</label><form class="inline-form" data-form="room" data-id="${id}"><input name="value" value="${esc(d.room || "")}" placeholder="e.g. Living room" list="roomList"><button class="btn btn--sm">Save</button></form><datalist id="roomList">${rooms.map((r) => `<option value="${esc(r)}">`).join("")}</datalist></div>
      <div class="control-row"><label>Dashboard</label><button class="btn btn--sm btn--ghost" data-ui="hide" data-id="${id}">${icon("eyeOff", 14)} ${d.hidden ? "Show on dashboard" : "Hide from dashboard"}</button></div></div>
    ${network.length ? `<div class="panel"><h3>On the network</h3>${kv(network)}</div>` : ""}`;
}

function renderDrawer(fresh = false) {
  const d = state.devices.find((x) => x.id === state.openId);
  const el = $("#drawer");
  if (!d) {
    el.innerHTML = "";
    return;
  }
  const active = document.activeElement;
  if (!fresh && el.contains(active) && (active.tagName === "INPUT" || active.type === "range")) return; // don't yank a control out from under the person
  const controls = controlsHtml(d);
  const tab = controls && state.drawerTab !== "details" ? "controls" : "details";
  const status = d.online === false ? "Offline" : d.setup ? "Needs connecting" : stateLine(d) || "Online";
  const setup = d.setup
    ? `<div class="note">${icon(d.setup.kind === "password" ? "key" : "info", 18, 'class="note__icon"')}<p>${esc(d.setup.message)}</p>${needsPair(d) ? `<button class="btn btn--primary btn--sm" data-act="pair" data-id="${esc(d.id)}">Connect</button>` : d.setup.kind === "token" ? `<button class="btn btn--primary btn--sm" data-ui="settings" data-focus="ha">Connect</button>` : ""}</div>`
    : "";
  el.innerHTML = `
    <div class="drawer__head" style="--tint:${tintOf(d)}">
      <div class="kind-icon">${icon(kindIcon(d), 28)}</div>
      <div class="drawer__title">
        <input id="nameInput" value="${esc(d.name)}" aria-label="Name" maxlength="48">
        <p>${esc(d.what || d.kindLabel)}</p>
        <div class="status"><span class="dot ${d.online === false ? "dot--off" : "dot--on"}"></span>${esc(status)}</div>
      </div>
      <button class="btn btn--ghost icon-btn" data-ui="close" aria-label="Close">${icon("close", 18)}</button>
    </div>
    ${controls ? `<div class="tabs" role="tablist"><button class="tab" role="tab" aria-selected="${tab === "controls"}" data-tab="controls">${isTvLike(d) ? "Remote" : "Controls"}</button><button class="tab" role="tab" aria-selected="${tab === "details"}" data-tab="details">Details</button></div>` : ""}
    <div class="drawer__body" style="--tint:${tintOf(d)}">${setup}${tab === "controls" ? controls : detailsHtml(d)}</div>`;
}

// ── modal: tune-up, settings, confirmations ───────────

function openModal(title, body, { wide } = {}) {
  const m = $("#modal");
  m.style.width = wide ? "min(860px, calc(100vw - 24px))" : "";
  m.innerHTML = `<div class="modal__head"><h2 id="modalTitle">${title}</h2><button class="btn btn--ghost icon-btn" data-ui="close" aria-label="Close">${icon("close", 18)}</button></div><div class="modal__body">${body}</div>`;
  m.classList.add("is-open");
  m.setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("is-open");
}

let confirmResolve = null;
export function confirmDialog({ title, body, confirm = "Go ahead" }) {
  return new Promise((resolve) => {
    confirmResolve = resolve;
    const wrap = document.createElement("div");
    wrap.className = "modal is-open";
    wrap.id = "confirm";
    wrap.style.width = "min(440px, calc(100vw - 24px))";
    wrap.style.zIndex = "90";
    wrap.innerHTML = `<div class="modal__head"><h2>${esc(title)}</h2></div><div class="modal__body"><p style="margin:0;color:var(--text-2)">${esc(body).replace(/ Ask the person to confirm.*$/, "")}</p><div class="dialog-actions"><button class="btn" data-confirm="no">Cancel</button><button class="btn btn--primary" data-confirm="yes">${esc(confirm)}</button></div></div>`;
    document.body.appendChild(wrap);
    $('[data-confirm="yes"]', wrap).focus();
  });
}

function sevIcon(sev) {
  return { high: "alert", medium: "alert", low: "info", info: "info", good: "check" }[sev] || "info";
}

function tuneupHtml(t) {
  if (!t) return "";
  const c = t.score >= 80 ? "var(--accent)" : t.score >= 55 ? "var(--warn)" : "var(--danger)";
  const sp = state.speed;
  const findings = t.findings
    .map((f) => {
      const dev = f.deviceId && state.devices.find((d) => d.id === f.deviceId);
      const buttons = [
        f.fix && !f.fixed && `<button class="btn btn--sm btn--primary" data-fix="${esc(f.id)}">${esc(f.fix.label)}</button>`,
        f.fixed && `<span style="color:var(--accent);font-size:13px">${icon("check", 14, 'style="display:inline;vertical-align:-2px"')} Fixed</span>`,
        f.link && `<a class="btn btn--sm" href="${esc(f.link)}" target="_blank" rel="noopener noreferrer">${icon("external", 14)} Open its settings</a>`,
        dev && `<button class="btn btn--sm btn--ghost" data-ui="open" data-id="${esc(dev.id)}">View ${esc(dev.name)}</button>`,
      ].filter(Boolean);
      return `<div class="finding ${f.fixed ? "is-fixed" : ""}"><div class="finding__sev sev-${f.severity}">${icon(sevIcon(f.severity), 16)}</div><div><strong>${esc(f.title)}</strong>${f.detail ? `<p>${esc(f.detail)}</p>` : ""}${buttons.length ? `<div class="btns">${buttons.join("")}</div>` : ""}</div></div>`;
    })
    .join("");
  return `
    <div class="score"><div class="ring-wrap"><div class="ring" style="--p:${t.score};--c:${c}"></div><strong>${t.score}</strong></div>
      <div><h3>${esc(t.grade)}</h3><p>Checked ${t.devicesChecked} devices ${ago(Date.parse(t.at))}. ${t.counts.high ? `${t.counts.high} urgent, ` : ""}${t.counts.medium ? `${t.counts.medium} important, ` : ""}${t.counts.low} minor.${t.fixable ? ` Patch can fix ${t.fixable} of them for you.` : ""}</p>
      <div class="btns" style="margin-top:10px"><button class="btn btn--sm" data-ui="tuneup-run">${icon("refresh", 14)} Check again</button><button class="btn btn--sm" data-ui="speed">${icon("speed", 14)} ${sp?.ok ? "Test speed again" : "Test internet speed"}</button></div></div></div>
    ${sp?.ok ? `<div class="panel"><h3>Internet speed</h3><p style="margin:0"><strong>${sp.downloadMbps} Mbps</strong> down · <strong>${sp.uploadMbps} Mbps</strong> up · ${sp.latencyMs} ms latency${sp.jitterMs != null ? ` · ${sp.jitterMs} ms jitter` : ""}</p></div>` : ""}
    ${findings}`;
}

async function openTuneup({ run = false } = {}) {
  if (state.tuneup && !run) {
    openModal(`${icon("tune", 18, 'style="display:inline;vertical-align:-3px"')} Tune-up`, tuneupHtml(state.tuneup), { wide: true });
    return;
  }
  openModal(`${icon("tune", 18, 'style="display:inline;vertical-align:-3px"')} Tune-up`, `<div class="empty">${icon("refresh", 30, 'class="spin" style="margin:auto;color:var(--accent)"')}<h3>Checking everything…</h3><p>Updates, risky settings, open ports, WiFi signal, connection quality, printer ink and your internet. About 15 seconds.</p></div>`, { wide: true });
  try {
    state.tuneup = await api("POST", "/api/tuneup", {});
    renderHero();
    if ($("#modal").classList.contains("is-open")) openTuneup();
  } catch (err) {
    toast(err.message, "bad");
  }
}

async function applyFix(fixId, confirmToken) {
  const f = state.tuneup?.findings.find((x) => x.id === fixId);
  const r = await api("POST", `/api/fixes/${encodeURIComponent(fixId)}`, { confirmToken });
  if (r.needsConfirmation) {
    if (await confirmDialog({ title: `${f?.fix?.label || "Apply fix"}?`, body: r.risk || r.message, confirm: f?.fix?.label || "Go ahead" })) return applyFix(fixId, r.confirmToken);
    return;
  }
  toast(r.message, r.ok ? "ok" : "bad");
  if (r.ok && f) f.fixed = true;
  if (r.device) mergeDevice(r.device);
  openTuneup();
  renderAll();
}

async function runSpeed() {
  if (state.speedRunning) return;
  state.speedRunning = true;
  renderHero();
  toast("Testing your internet speed… (about 15 seconds)");
  try {
    state.speed = await api("POST", "/api/speedtest", {});
    toast(state.speed.ok ? `${state.speed.downloadMbps} Mbps down, ${state.speed.uploadMbps} Mbps up` : state.speed.message, state.speed.ok ? "ok" : "bad");
  } catch (err) {
    toast(err.message, "bad");
  }
  state.speedRunning = false;
  renderHero();
  if ($("#modal").classList.contains("is-open") && state.tuneup) openTuneup();
}

async function openSettings(focus) {
  const s = await api("GET", "/api/settings");
  openModal(
    `${icon("gear", 18, 'style="display:inline;vertical-align:-3px"')} Settings`,
    `
    <form data-form="settings-el" class="panel">
      <h3>Voice (ElevenLabs)</h3>
      <label class="field"><span>API key</span>
        <div class="row"><input name="elevenlabsApiKey" type="password" autocomplete="off" placeholder="${s.elevenlabs.hasKey ? `Saved (${esc(s.elevenlabs.keyHint)}). Paste a new one to replace it` : "sk_…"}" ${s.elevenlabs.fromEnv ? "disabled" : ""}><button class="btn btn--voice">Save & test</button></div>
        <small>Create one at <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer">elevenlabs.io → Developers → API keys</a> with the <b>ElevenLabs Agents</b> permission (Write). It's stored only on ${HERE} and is used to start each conversation.${s.elevenlabs.fromEnv ? " It's currently set by the ELEVENLABS_API_KEY environment variable." : ""}</small>
        <div class="check" id="elCheck"></div>
      </label>
      <details><summary style="cursor:pointer;color:var(--muted);font-size:13px">Advanced</summary>
        <label class="field" style="margin-top:10px"><span>Agent ID</span><input name="agentId" value="${s.elevenlabs.customAgent ? esc(s.elevenlabs.agentId) : ""}" placeholder="${esc(s.elevenlabs.agentId)} (built-in)"><small>Leave empty to use the Patch agent that ships with this app.</small></label>
      </details>
    </form>
    <form data-form="settings-yt" class="panel">
      <h3>YouTube search (optional)</h3>
      <p style="margin:0 0 10px;color:var(--text-2);font-size:13.5px">With a free YouTube key, Patch can find videos for you ("play lo-fi beats on the TV") and read out the results. Without one, TVs show YouTube's own search results instead.</p>
      <label class="field"><span>YouTube Data API key</span>
        <div class="row"><input name="youtubeApiKey" type="password" autocomplete="off" placeholder="${s.youtube?.hasKey ? `Saved (${esc(s.youtube.keyHint)}). Paste a new one to replace it` : "AIza…"}" ${s.youtube?.fromEnv ? "disabled" : ""}><button class="btn btn--primary">Save & test</button></div>
        <small>Free from the <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener noreferrer">Google Cloud console</a>: create a project, enable <b>YouTube Data API v3</b>, then APIs &amp; Services → Credentials → Create API key. About 100 searches a day are free. The key stays on ${HERE}.</small>
        <div class="check" id="ytCheck"></div>
      </label>
    </form>
    <form data-form="settings-claude" class="panel">
      <h3>Claude (builds apps for you)</h3>
      <p style="margin:0 0 10px;color:var(--text-2);font-size:13.5px">With your Anthropic API key, Claude writes whole apps for your TVs from a description: games, family boards, tools. Say “ask Claude to build a snake game for the living room TV”, or tap <b>Build with Claude</b> under TV apps. Then ask for changes the same way.</p>
      <label class="field"><span>Anthropic API key</span>
        <div class="row"><input name="anthropicApiKey" type="password" autocomplete="off" placeholder="${s.claude?.hasKey ? `Saved (${esc(s.claude.keyHint)}). Paste a new one to replace it` : "sk-ant-…"}" ${s.claude?.fromEnv ? "disabled" : ""}><button class="btn btn--claude">Save & test</button></div>
        <small>Create one in the <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">Anthropic Console → API keys</a>. Each app Claude builds or changes uses that account (${esc(s.claude?.model || "Claude Opus 5.5")}); a build usually costs well under a dollar, and Patch shows what it cost. <b>Have Claude Max, Ultra or Team?</b> Your membership includes monthly API credits: claim them on claude.ai in a web browser, under Settings → Billing → API credits, then make the key in the Console organization you link (<a href="https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers" target="_blank" rel="noopener noreferrer">how</a>). Otherwise, add credit under Billing in the Console. The key stays on ${HERE} and is only ever sent to Anthropic.${s.claude?.fromEnv ? " It's currently set by the PATCH_ANTHROPIC_API_KEY environment variable." : ""}</small>
        <small>Rather not use a key? Ask Claude in the Claude app to build the app (that uses your membership), save its file, then add it under TV apps → Make a TV app → <b>Your own code</b> → Choose a file.</small>
        <div class="check" id="claudeCheck"></div>
      </label>
    </form>
    <form data-form="settings-ha" class="panel">
      <h3>Home Assistant (optional)</h3>
      <p style="margin:0 0 10px;color:var(--text-2);font-size:13.5px">Already use Home Assistant? Connect it and Patch can control everything it controls, from thermostats and locks to Tapo, Tuya, Nest and ecobee devices.</p>
      <label class="field"><span>Address</span><input name="haUrl" value="${esc(s.homeAssistant.url)}" placeholder="http://homeassistant.local:8123"></label>
      <label class="field"><span>Long-lived access token</span><input name="haToken" type="password" autocomplete="off" placeholder="${s.homeAssistant.hasToken ? "Saved. Paste a new one to replace it" : "From your Home Assistant profile → Security"}"></label>
      <button class="btn btn--primary">Connect</button><div class="check" id="haCheck"></div>
    </form>
    <form data-form="settings-net" class="panel">
      <h3>Network</h3>
      <label class="field"><span>Network to scan</span><input name="subnet" value="${esc(s.network.subnet)}" placeholder="Automatic"><small>Only needed if Patch picks the wrong network, e.g. <code>192.168.1.0/24</code>. Patch only ever scans private home addresses.</small></label>
${BOOT.phone ? "" : `<label class="field" style="grid-template-columns:auto 1fr;align-items:center"><input type="checkbox" name="lanEnabled" ${s.lan.enabled ? "checked" : ""} style="width:18px;height:18px"><span style="font-weight:500">Let phones and tablets on my WiFi open Patch (asks for an access code${s.lan.active ? `: <code>${esc(s.lan.accessCode)}</code>` : ""}). Needs a restart. Voice works on this computer; other devices can type.</span></label>`}
      <label class="field" style="grid-template-columns:auto 1fr;align-items:center"><input type="checkbox" name="vendorLookup" ${s.features.vendorLookup ? "checked" : ""} style="width:18px;height:18px"><span style="font-weight:500">Look up who made each device (downloads the public IEEE manufacturer list once; nothing about your network is sent).</span></label>
      <button class="btn">Save</button><div class="check" id="netCheck"></div>
      <p style="color:var(--muted);font-size:12.5px;margin:12px 0 0">Settings and saved passwords live in <code>${esc(s.dataDir)}</code>.</p>
    </form>
    <div class="panel" id="aboutPatch">
      <h3>About Patch</h3>
      <p style="margin:0;color:var(--text-2);font-size:13.5px">This is Patch ${esc(BOOT.version || "")}${BOOT.phone ? ` for Android. New versions are on the <a href="${PATCH_DOWNLOADS}" target="_blank" rel="noopener noreferrer">Patch for Android page</a>. To update, uninstall this Patch first (press and hold its icon, then Uninstall), then install the new Patch.apk: it won't install over this one. You'll add your keys and connect your TVs again.` : "."}</p>
    </div>`,
  );
  const target = focus === "ha" ? 'input[name="haUrl"]' : focus === "el" ? 'input[name="elevenlabsApiKey"]' : focus === "claude" ? 'input[name="anthropicApiKey"]' : null;
  if (target) $(target, $("#modal"))?.focus();
  if (focus === "about") $("#aboutPatch")?.scrollIntoView({ block: "center" });
}

async function saveSettings(form) {
  const kind = form.dataset.form;
  const fd = new FormData(form);
  const body = {};
  if (kind === "settings-el") {
    if (fd.get("elevenlabsApiKey")) body.elevenlabsApiKey = String(fd.get("elevenlabsApiKey"));
    body.agentId = String(fd.get("agentId") || "");
  }
  if (kind === "settings-yt" && fd.get("youtubeApiKey")) body.youtubeApiKey = String(fd.get("youtubeApiKey"));
  if (kind === "settings-claude" && fd.get("anthropicApiKey")) body.anthropicApiKey = String(fd.get("anthropicApiKey"));
  if (kind === "settings-ha") {
    body.haUrl = String(fd.get("haUrl") || "");
    if (fd.get("haToken")) body.haToken = String(fd.get("haToken"));
  }
  if (kind === "settings-net") {
    body.subnet = String(fd.get("subnet") || "");
    body.lanEnabled = fd.get("lanEnabled") === "on";
    body.vendorLookup = fd.get("vendorLookup") === "on";
  }
  const btn = $("button", form);
  btn.disabled = true;
  const r = await api("POST", "/api/settings", body).catch((err) => ({ ok: false, checks: { x: { ok: false, message: err.message } } }));
  btn.disabled = false;
  const check = r.checks?.elevenlabs || r.checks?.youtube || r.checks?.claude || r.checks?.homeAssistant || r.checks?.subnet;
  const out = $(".check", form);
  if (check) {
    out.className = `check ${check.ok ? "check--ok" : "check--bad"}`;
    out.textContent = check.message;
  } else {
    out.className = "check check--ok";
    out.textContent = r.restartNeeded ? "Saved. Restart Patch to apply." : "Saved.";
  }
  if (kind === "settings-el" && check?.ok) {
    state.setup.voice = true;
    renderSetup();
    renderHero();
    voice.refresh();
  }
  if (kind === "settings-ha" && check?.ok) state.setup.homeAssistant = true;
  if (kind === "settings-claude" && r.settings?.claude) {
    state.setup.claude = r.settings.claude.hasKey;
    tvApps.render();
    voice.refresh();
  }
}

export function toast(text, kind = "ok") {
  if (!text) return;
  const stack = $("#toasts");
  if ([...stack.children].some((t) => t.textContent === text)) return;
  while (stack.children.length >= 3) stack.firstElementChild.remove();
  const el = document.createElement("div");
  el.className = `toast ${kind === "bad" ? "toast--bad" : ""}`;
  el.textContent = text;
  stack.appendChild(el);
  setTimeout(() => el.remove(), kind === "bad" ? 7000 : 4200);
}

async function scan() {
  if (state.scan.running) return;
  state.scan = { running: true, pct: 3, message: "Starting…" };
  renderTop();
  renderDevices();
  try {
    const r = await api("POST", "/api/scan", {});
    if (r.devices) state.devices = r.devices;
    if (r.summary) state.network = r.summary.network;
  } catch (err) {
    toast(err.message, "bad");
  }
  state.scan.running = false;
  renderAll();
}

async function showDiagnosis(id) {
  const out = $("#diagOut");
  if (out) out.innerHTML = `<p style="color:var(--muted);margin:10px 0 0">Testing the connection…</p>`;
  const r = await api("POST", `/api/devices/${encodeURIComponent(id)}/diagnose`, {});
  const box = $("#diagOut");
  if (box) box.innerHTML = `<ul class="findings-mini">${(r.findings || [r.message]).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>`;
}

// ── events ────────────────────────────────────────────

document.addEventListener("click", async (e) => {
  const confirmBtn = e.target.closest("[data-confirm]");
  if (confirmBtn) {
    $("#confirm")?.remove();
    confirmResolve?.(confirmBtn.dataset.confirm === "yes");
    confirmResolve = null;
    return;
  }
  const picture = e.target.closest("img[data-tv-shot]");
  if (picture) return tapTvScreen(picture, e);
  const dismiss = e.target.closest("[data-dismiss]");
  if (dismiss) {
    state.dismissed.add(dismiss.dataset.dismiss);
    safeStorage("set", "patch.dismissed", JSON.stringify([...state.dismissed]));
    renderSetup();
    renderHero();
    return;
  }
  const act = e.target.closest("[data-act]");
  if (act) {
    e.preventDefault();
    e.stopPropagation();
    const d = state.devices.find((x) => x.id === act.dataset.id);
    if (d && act.classList.contains("switch")) {
      // Optimistic toggle; the reply corrects it if the device says no.
      act.setAttribute("aria-checked", String(act.dataset.act === "turn_on"));
    }
    await doAction(act.dataset.id, act.dataset.act, act.dataset.value);
    return;
  }
  const fix = e.target.closest("[data-fix]");
  if (fix) {
    fix.disabled = true;
    await applyFix(fix.dataset.fix);
    return;
  }
  const ui = e.target.closest("[data-ui]");
  if (ui) {
    const what = ui.dataset.ui;
    if (what === "link") return;
    e.preventDefault();
    if (what === "close") closeOverlays();
    else if (what === "scan") scan();
    else if (what === "tuneup") openTuneup();
    else if (what === "tuneup-run") openTuneup({ run: true });
    else if (what === "speed") runSpeed();
    else if (what === "settings") openSettings(ui.dataset.focus);
    else if (what === "ask") voice.open();
    else if (what === "tv-shot") showTvScreen(ui.dataset.id);
    else if (what === "screen-access") window.PatchAndroid?.openScreenSettings?.();
    else if (what === "app-info") window.PatchAndroid?.openAppInfo?.();
    else if (what === "todo-more") {
      state.todoOpen = !state.todoOpen;
      renderSetup();
    }
    else if (what === "open") {
      $("#modal").classList.remove("is-open");
      openDevice(ui.dataset.id);
    } else if (what === "diagnose") showDiagnosis(ui.dataset.id);
    else if (what === "hide") {
      const d = state.devices.find((x) => x.id === ui.dataset.id);
      const r = await api("POST", `/api/devices/${encodeURIComponent(ui.dataset.id)}/meta`, { hidden: !d?.hidden });
      if (r.device) mergeDevice(r.device);
      closeOverlays();
      renderAll();
      toast(r.device?.hidden ? "Hidden. Find it again by searching for it." : "Back on the dashboard.");
    } else if (what === "filter-all") {
      state.filter = "all";
      state.query = "";
      $("#search").value = "";
      renderAll();
    } else if (what === "attention") {
      const setup = state.devices.find((d) => d.setup);
      if (setup && !state.tuneup) openDevice(setup.id);
      else openTuneup();
    }
    return;
  }
  const view = e.target.closest("[data-view]");
  if (view) {
    state.view = view.dataset.view === "list" ? "list" : "cards";
    safeStorage("set", "patch.view", state.view);
    renderViewToggle();
    renderDevices();
    return;
  }
  const tabBtn = e.target.closest("[data-tab]");
  if (tabBtn) {
    state.drawerTab = tabBtn.dataset.tab;
    renderDrawer(true);
    return;
  }
  const row = e.target.closest("tr[data-id], .row-item[data-id]");
  if (row && !e.target.closest("a")) {
    openDevice(row.dataset.id);
    return;
  }
  const filter = e.target.closest("[data-filter]");
  if (filter) {
    state.filter = filter.dataset.filter;
    renderFilters();
    renderDevices();
    return;
  }
  const card = e.target.closest(".card[data-id]");
  if (card && !e.target.closest("a")) openDevice(card.dataset.id);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if ($("#confirm")) {
      $("#confirm").remove();
      confirmResolve?.(false);
    } else closeOverlays();
  }
  if ((e.key === "Enter" || e.key === " ") && (e.target.classList?.contains("card") || e.target.matches?.("tr[data-id], .row-item[data-id]"))) {
    e.preventDefault();
    openDevice(e.target.dataset.id);
  }
});

document.addEventListener("change", (e) => {
  const r = e.target.closest("[data-range]");
  if (r) {
    const v = r.dataset.range === "set_color_temperature" ? `${r.value}K` : r.value;
    r.nextElementSibling && (r.nextElementSibling.textContent = r.dataset.range === "set_color_temperature" ? `${r.value} K` : r.dataset.range === "set_volume" ? r.value : `${r.value}%`);
    doAction(r.dataset.id, r.dataset.range, v);
    return;
  }
  const c = e.target.closest("[data-color]");
  if (c) doAction(c.dataset.id, "set_color", c.value);
});

document.addEventListener("change", async (e) => {
  const apk = e.target.closest?.("input[data-apk]");
  if (!apk || !apk.files?.length) return;
  const file = apk.files[0];
  apk.value = "";
  toast(`Sending ${file.name} to Patch…`);
  try {
    const res = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "x-patch-token": BOOT.token, "content-type": "application/octet-stream" }, body: file });
    const r = await res.json();
    if (!r.ok) throw new Error(r.message);
    await doAction(apk.dataset.apk, "install_app", `upload:${r.upload.id}`);
  } catch (err) {
    toast(err.message, "bad");
  }
});

document.addEventListener("change", (e) => {
  if (e.target.id === "roomSelect") {
    state.room = e.target.value;
    renderFilters();
    renderDevices();
  }
});

document.addEventListener("input", (e) => {
  const range = e.target.closest?.("input[type=range]");
  if (range) range.style.setProperty("--fill", `${((range.value - range.min) / (range.max - range.min)) * 100}%`);
  if (e.target.id === "search") {
    state.query = e.target.value;
    renderDevices();
  }
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("form[data-form]");
  if (!form) return;
  e.preventDefault();
  const kind = form.dataset.form;
  const id = form.dataset.id;
  const value = new FormData(form).get("value");
  if (kind.startsWith("settings-")) return saveSettings(form);
  if (kind === "room") {
    const r = await api("POST", `/api/devices/${encodeURIComponent(id)}/meta`, { room: String(value || "") });
    if (r.device) mergeDevice(r.device);
    toast(r.message || "Saved.");
    renderAll();
    return;
  }
  if (kind === "credentials") {
    const r = await api("POST", `/api/devices/${encodeURIComponent(id)}/credentials`, { password: String(new FormData(form).get("password") || "") });
    toast(r.message, r.ok ? "ok" : "bad");
    form.reset();
    return;
  }
  if (!value) return;
  // Let go of the box (and the phone's keyboard): the card isn't redrawn while someone is typing in it,
  // and what this does (a page's list of things to choose, say) shows in the card.
  if (form.contains(document.activeElement)) document.activeElement.blur();
  doAction(id, kind, String(value));
});

document.addEventListener(
  "blur",
  async (e) => {
    if (e.target.id !== "nameInput" || !state.openId) return;
    const d = state.devices.find((x) => x.id === state.openId);
    const name = e.target.value.trim();
    if (!d || !name || name === d.name) return;
    const r = await api("POST", `/api/devices/${encodeURIComponent(d.id)}/meta`, { name });
    if (r.device) mergeDevice(r.device);
    toast(r.message || "Renamed.");
    renderDevices();
  },
  true,
);
document.addEventListener("keydown", (e) => {
  if (e.target.id === "nameInput" && e.key === "Enter") e.target.blur();
});

$("#scanBtn").addEventListener("click", scan);
$("#tuneBtn").addEventListener("click", () => openTuneup());
$("#settingsBtn").addEventListener("click", () => openSettings());
$("#exportBtn").addEventListener("click", exportCsv);
renderViewToggle();
$("#scrim").addEventListener("click", closeOverlays);
$("#searchIcon").outerHTML = icon("search", 16);

// ── live updates ──────────────────────────────────────

function connectEvents() {
  const es = new EventSource(`/api/events?token=${encodeURIComponent(BOOT.token)}`);
  es.addEventListener("hello", (e) => {
    const d = JSON.parse(e.data);
    state.devices = d.devices;
    state.scan.running = d.scan.running;
    renderAll();
  });
  es.addEventListener("devices", (e) => {
    state.devices = JSON.parse(e.data);
    renderAll();
    voice.devicesChanged(state.devices);
  });
  es.addEventListener("scan", (e) => {
    const p = JSON.parse(e.data);
    if (p.running) state.scan = { running: true, pct: p.pct, message: p.message };
    else {
      state.scan = { running: false, pct: 100 };
      if (p.summary) state.network = p.summary.network;
      if (p.error) toast(`Scan problem: ${p.error}`, "bad");
    }
    renderTop();
    if (!state.devices.length) renderDevices();
  });
  es.addEventListener("tvapps", (e) => {
    tvApps.set(JSON.parse(e.data));
    if (state.openId) renderDrawer();
  });
  // Claude finished building or changing an app (or couldn't): show it, and tell the conversation.
  es.addEventListener("tvapp-built", (e) => {
    const r = JSON.parse(e.data);
    tvApps.built(r);
    voice.appBuilt(r);
  });
  es.addEventListener("tuneup", (e) => {
    state.tuneup = JSON.parse(e.data);
    renderHero();
  });
  es.addEventListener("notice", (e) => {
    const n = JSON.parse(e.data);
    toast(n.text);
  });
  // Phone app: "search the web on this phone" etc. The app hands the page to Android (browser, YouTube app…).
  es.addEventListener("open-url", (e) => {
    const { url } = JSON.parse(e.data);
    if (/^https?:\/\//i.test(url) && window.PatchAndroid?.openUrl) window.PatchAndroid.openUrl(url);
  });
  es.onerror = () => {
    // The browser retries on its own; if Patch was restarted the token changed, so reload.
    fetch("/api/state", { headers: { "x-patch-token": BOOT.token } })
      .then((r) => {
        if (r.status === 403) location.reload();
      })
      .catch(() => {});
  };
}

// ── start ─────────────────────────────────────────────

export const ui = {
  phone: !!BOOT.phone,
  api,
  esc,
  toast,
  flashDevice,
  openDevice,
  openTuneup: (report) => {
    if (report) state.tuneup = report;
    renderHero();
    openTuneup();
  },
  get state() {
    return state;
  },
  mergeDevice: (d) => {
    mergeDevice(d);
    renderAll();
  },
  setDevices: (list) => {
    state.devices = list;
    renderAll();
  },
  setSpeed: (s) => {
    state.speed = s;
    renderHero();
  },
  openSettings,
  stateLine,
  BOOT,
  openModal,
  closeOverlays,
  confirmDialog,
  voiceActivity: (text) => voice.uiActivity(text),
  get tvapps() {
    return tvApps;
  },
};

const tvApps = createTvApps(ui);
const voice = createVoice(ui);
$("#voiceFine").textContent = `Voice by ElevenLabs. Your devices are controlled from ${HERE}, never from the cloud.`;
// Back in Patch after Settings (screen access, permissions): show what changed.
window.__patchResume = () => renderAll();
// The phone's back button (the Patch app asks first): close what's open before leaving Patch.
window.__patchBack = () => {
  if ($("#modal").classList.contains("is-open") || $("#drawer").classList.contains("is-open")) {
    closeOverlays();
    return true;
  }
  return voice.closeSheet();
};
// Demo mode only: lets automated checks call the exact tool handlers the voice agent uses.
if (BOOT.demo) window.__patch = { voice, ui };

(async () => {
  try {
    const s = await api("GET", "/api/state");
    Object.assign(state, { devices: s.devices, setup: s.setup, app: s.app, network: s.network, tuneup: s.tuneup, speed: s.speed });
    tvApps.set(s.tvapps || []);
    tvApps.load();
    state.scan.running = s.scan.running;
    renderAll();
    voice.refresh();
  } catch (err) {
    toast(err.message, "bad");
  }
  connectEvents();
})();
