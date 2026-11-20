// Patch dashboard. Plain ES modules, no build step.
import { icon } from "./icons.js";
import { createVoice } from "./voice.js";

const BOOT = JSON.parse(document.getElementById("boot").textContent || "{}");
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

const CATS = [
  { id: "lights", label: "Lights", kinds: ["light", "room"], tint: "var(--c-light)" },
  { id: "media", label: "TV & speakers", kinds: ["tv", "streamer", "speaker", "display", "media", "group"], tint: "var(--c-media)" },
  { id: "power", label: "Plugs & switches", kinds: ["plug", "switch", "strip", "fan"], tint: "var(--c-power)" },
  { id: "home", label: "Climate & security", kinds: ["thermostat", "lock", "garage", "cover", "camera", "vacuum", "sensor", "appliance", "scene"], tint: "var(--c-climate)" },
  { id: "people", label: "Computers & phones", kinds: ["computer", "phone", "tablet", "personal", "console", "nas", "watch"], tint: "var(--c-computer)" },
  { id: "network", label: "Network & hubs", kinds: ["router", "network", "hub"], tint: "var(--c-network)" },
  { id: "printers", label: "Printers", kinds: ["printer"], tint: "var(--c-printer)" },
  { id: "other", label: "Other", kinds: [], tint: "var(--c-other)" },
];
const catOf = (kind) => CATS.find((c) => c.kinds.includes(kind)) || CATS.at(-1);
const KIND_ICON = { room: "room", group: "group", hub: "hub" };
const kindIcon = (d) => KIND_ICON[d.kind] || d.kind;

const ACTION_LABEL = {
  turn_on: "Turn on", turn_off: "Turn off", toggle: "Toggle", reboot: "Restart", update_firmware: "Install update", unlock: "Unlock", lock: "Lock",
  open: "Open", close: "Close", remove_port_forward: "Close port forward", set_mode: "Change mode", identify: "Identify", wake: "Wake", pair: "Pair",
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
  if (d.setup) return d.setup.kind === "button" ? "Ready to pair" : d.setup.kind === "password" ? "Needs its password" : "Waiting to be connected";
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
      return s.on == null ? "" : parts(s.on ? "On" : "Off", s.on && s.power != null && `${s.power} W`);
    case "tv":
    case "streamer":
    case "speaker":
    case "display":
    case "media":
    case "group":
      return parts(s.on === false ? "Off" : null, s.app && s.app !== "Home screen" && s.app, s.playback && s.playback !== "stopped" && cap(s.playback), s.track, s.volume != null && `Vol ${s.volume}${s.muted ? " (muted)" : ""}`) || (s.app === "Home screen" ? "Home screen" : "");
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
      return parts(s.connection, s.uptime && `up ${s.uptime}`, s.portForwards ? `${s.portForwards} open port${s.portForwards > 1 ? "s" : ""}` : null) || d.ip;
    case "hub":
      return d.info?.lights ? `${d.info.lights} lights` : d.ip || "";
    default:
      return parts(d.ip, d.vendor && d.vendor !== d.brand && d.vendor);
  }
}

const has = (d, a) => d.actions?.includes(a);
const isPowered = (d) => typeof d.state?.on === "boolean" && (has(d, "toggle") || (has(d, "turn_on") && has(d, "turn_off")));

function primaryControl(d) {
  const busy = state.busy.has(d.id);
  if ((d.setup?.kind === "button" || d.setup?.kind === "tv-prompt") && has(d, "pair")) return `<button class="btn btn--primary btn--sm" data-act="pair" data-id="${esc(d.id)}">Pair</button>`;
  if (d.setup?.kind === "adb") return `<button class="btn btn--sm" data-ui="open" data-id="${esc(d.id)}">Set up</button>`;
  if (d.setup?.kind === "token") return `<button class="btn btn--primary btn--sm" data-ui="settings" data-focus="ha">Connect</button>`;
  if (d.setup?.kind === "password") return `<button class="btn btn--sm" data-ui="open" data-id="${esc(d.id)}">${icon("key", 15)} Add password</button>`;
  if (d.online === false) return "";
  if (isPowered(d)) return `<button class="switch ${busy ? "is-busy" : ""}" role="switch" aria-checked="${d.state.on}" aria-label="${esc(d.name)} power" data-act="${d.state.on ? "turn_off" : "turn_on"}" data-id="${esc(d.id)}"></button>`;
  if (has(d, "pause") && has(d, "play")) {
    const playing = d.state?.playback === "playing";
    return `<div class="mini">${has(d, "volume_down") ? `<button class="btn btn--sm" data-act="volume_down" data-id="${esc(d.id)}" aria-label="Volume down">−</button>` : ""}<button class="btn btn--sm" data-act="${playing ? "pause" : "play"}" data-id="${esc(d.id)}" aria-label="${playing ? "Pause" : "Play"}">${icon(playing ? "pause" : "play", 15)}</button>${has(d, "volume_up") ? `<button class="btn btn--sm" data-act="volume_up" data-id="${esc(d.id)}" aria-label="Volume up">+</button>` : ""}</div>`;
  }
  if (has(d, "lock")) return `<button class="btn btn--sm" data-act="${d.state?.locked ? "unlock" : "lock"}" data-id="${esc(d.id)}">${d.state?.locked ? "Unlock" : "Lock"}</button>`;
  if (has(d, "set_temperature") && d.state?.targetTemperature != null) {
    return `<div class="mini"><button class="btn btn--sm" data-act="set_temperature" data-value="${d.state.targetTemperature - 0.5}" data-id="${esc(d.id)}" aria-label="Cooler">−</button><button class="btn btn--sm" data-act="set_temperature" data-value="${d.state.targetTemperature + 0.5}" data-id="${esc(d.id)}" aria-label="Warmer">+</button></div>`;
  }
  if (has(d, "open") && has(d, "close")) return `<button class="btn btn--sm" data-act="${/open/.test(d.state?.status || "") ? "close" : "open"}" data-id="${esc(d.id)}">${/open/.test(d.state?.status || "") ? "Close" : "Open"}</button>`;
  if (has(d, "activate")) return `<button class="btn btn--sm" data-act="activate" data-id="${esc(d.id)}">${icon("play", 14)} Run</button>`;
  if (has(d, "start")) return `<button class="btn btn--sm" data-act="${d.state?.status === "cleaning" ? "dock" : "start"}" data-id="${esc(d.id)}">${d.state?.status === "cleaning" ? "Dock" : "Start"}</button>`;
  if (has(d, "wake")) return `<button class="btn btn--sm" data-act="wake" data-id="${esc(d.id)}">${icon("power", 14)} Wake</button>`;
  if (d.webUrl) return `<a class="btn btn--sm btn--ghost" href="${esc(d.webUrl)}" target="_blank" rel="noopener noreferrer" data-ui="link" aria-label="Open ${esc(d.name)}'s web page">${icon("external", 15)}</a>`;
  return "";
}

function cardHtml(d) {
  const cat = catOf(d.kind);
  const on = d.online !== false && (d.state?.on === true || d.state?.playback === "playing");
  const sub = d.what || [d.brand, d.model].filter(Boolean).join(" · ") || d.kindLabel;
  return `<article class="card ${on ? "is-on" : ""} ${d.online === false ? "is-offline" : ""}" style="--tint:${cat.tint}" data-id="${esc(d.id)}" tabindex="0" aria-label="${esc(d.name)}, ${esc(d.kindLabel)}">
    <div class="card__top">
      <div class="kind-icon">${icon(kindIcon(d), 20)}</div>
      <div class="card__name"><strong>${esc(d.name)}</strong><span>${esc(sub)}</span></div>
      <span class="dot ${d.online ? "dot--on" : d.online === false ? "dot--off" : ""}" title="${d.online ? "Online" : d.online === false ? "Offline" : "Checking…"}"></span>
    </div>
    <div class="card__state">${d.isNew ? '<span class="badge badge--new">New</span> ' : ""}${d.setup ? '<span class="badge badge--setup">Setup</span> ' : ""}${esc(stateLine(d))}</div>
    <div class="card__foot">${d.room ? `<span class="room">${esc(d.room)}</span>` : '<span class="room" style="visibility:hidden">-</span>'}${primaryControl(d)}</div>
  </article>`;
}

// ── rendering ─────────────────────────────────────────

const cardCache = new Map();

function visibleDevices() {
  const q = state.query.trim().toLowerCase();
  return state.devices.filter((d) => {
    if (d.hidden) return false;
    if (state.filter !== "all" && catOf(d.kind).id !== state.filter) return false;
    if (!q) return true;
    return [d.name, d.brand, d.model, d.room, d.ip, d.kindLabel, d.vendor].some((x) => x && String(x).toLowerCase().includes(q));
  });
}

function renderDevices() {
  const host = $("#devices");
  if (!state.devices.length) {
    host.innerHTML = `<div class="empty">${icon("scan", 34, 'style="margin:auto;color:var(--accent)"')}<h3>${state.scan.running ? "Looking around your network…" : "No devices yet"}</h3><p>${state.scan.running ? "Listening for lights, speakers, TVs, printers and everything else. This takes about ten seconds." : "Scan to see everything connected to your WiFi."}</p>${state.scan.running ? "" : '<button class="btn btn--primary" data-ui="scan">Scan my network</button>'}</div>`;
    cardCache.clear();
    return;
  }
  const list = visibleDevices();
  let groups;
  if (state.query) groups = [{ label: `Results for “${state.query}”`, items: list }];
  else if (state.filter !== "all") groups = [{ label: CATS.find((c) => c.id === state.filter).label, items: list }];
  else groups = CATS.map((c) => ({ label: c.label, items: list.filter((d) => catOf(d.kind) === c) })).filter((g) => g.items.length);
  if (!list.length) {
    host.innerHTML = `<div class="empty"><h3>Nothing matches</h3><p>Try another word, or clear the filter.</p></div>`;
    return;
  }
  if (state.view === "list") {
    host.innerHTML = tableHtml(groups.flatMap((g) => g.items));
    cardCache.clear();
    return;
  }
  // Rebuild sections, reusing card elements whose HTML didn't change (keeps hover/focus stable).
  const frag = document.createDocumentFragment();
  const seen = new Set();
  for (const g of groups) {
    const sec = document.createElement("section");
    sec.className = "section";
    sec.innerHTML = `<div class="section__head"><h2>${esc(g.label)}</h2><span>${g.items.length}</span></div><div class="grid"></div>`;
    const grid = sec.lastElementChild;
    for (const d of g.items) {
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
  for (const b of document.querySelectorAll("[data-view]")) b.setAttribute("aria-pressed", String(b.dataset.view === state.view));
}

function renderFilters() {
  const counts = Object.fromEntries(CATS.map((c) => [c.id, state.devices.filter((d) => !d.hidden && catOf(d.kind) === c).length]));
  const total = state.devices.filter((d) => !d.hidden).length;
  $("#filters").innerHTML = [
    `<button class="chip" aria-pressed="${state.filter === "all"}" data-filter="all">All <span class="count">${total}</span></button>`,
    ...CATS.filter((c) => counts[c.id]).map((c) => `<button class="chip" aria-pressed="${state.filter === c.id}" data-filter="${c.id}">${esc(c.label)} <span class="count">${counts[c.id]}</span></button>`),
  ].join("");
}

function renderStats() {
  const ds = state.devices.filter((d) => !d.hidden && !d.parent);
  const online = ds.filter((d) => d.online).length;
  const fresh = state.devices.filter((d) => d.isNew).length;
  const t = state.tuneup;
  const attention = [...state.devices.filter((d) => d.setup), ...(t?.findings || []).filter((f) => (f.severity === "high" || f.severity === "medium") && !f.fixed)];
  const tone = (score) => (score >= 80 ? "tone-good" : score >= 55 ? "tone-warn" : "tone-bad");
  const sp = state.speed;
  $("#stats").innerHTML = `
    <button class="stat" data-ui="filter-all"><div class="stat__label">${icon("wifi", 14)} On your WiFi</div><div class="stat__value">${online}<small> / ${ds.length}</small></div><div class="stat__sub">${fresh ? `${fresh} new recently` : state.network ? esc(state.network.cidr) : "devices online"}</div></button>
    <button class="stat ${t ? tone(t.score) : ""}" data-ui="tuneup"><div class="stat__label">${icon("shield", 14)} Network health</div><div class="stat__value">${t ? `${t.score}<small> ${esc(t.grade)}</small>` : "–"}</div><div class="stat__sub">${t ? `${t.findings.filter((f) => f.severity !== "good" && f.severity !== "info").length} things to look at` : "Run a tune-up"}</div></button>
    <button class="stat" data-ui="speed"><div class="stat__label">${icon("speed", 14)} Internet speed</div><div class="stat__value">${sp?.ok ? `${Math.round(sp.downloadMbps)}<small> Mbps</small>` : "–"}</div><div class="stat__sub">${sp?.ok ? `↑ ${Math.round(sp.uploadMbps)} Mbps · ${sp.latencyMs} ms` : state.speedRunning ? "Testing…" : "Tap to test"}</div></button>
    <button class="stat ${attention.length ? "tone-warn" : "tone-good"}" data-ui="attention"><div class="stat__label">${icon("alert", 14)} Needs you</div><div class="stat__value">${attention.length}</div><div class="stat__sub">${attention.length ? esc(attention.map((a) => a.name || a.title).slice(0, 2).join(", ")) : "All clear"}</div></button>`;
}

function renderBanners() {
  const out = [];
  const add = (id, cls, ic, html, action) => {
    if (state.dismissed.has(id)) return;
    out.push(`<div class="banner ${cls}"><div class="banner__icon">${icon(ic, 18)}</div><p>${html}</p>${action || ""}<button class="btn btn--ghost icon-btn" data-dismiss="${esc(id)}" aria-label="Dismiss">${icon("close", 16)}</button></div>`);
  };
  if (state.app.demo) add("demo", "banner--demo", "info", "<strong>Demo mode.</strong> This is a simulated home network so you can try everything. Nothing on your real network is touched. Run <code>npm start</code> to use your own.");
  if (!state.setup.sdk) add("sdk", "banner--warn", "alert", "<strong>Voice isn't installed yet.</strong> In the Patch folder, run <code>npm install</code>, then restart Patch.");
  else if (!state.setup.voice) add("voice", "banner--voice", "mic", "<strong>Talk to your network.</strong> Add your ElevenLabs API key once, and Patch can listen and answer out loud.", '<button class="btn btn--voice btn--sm" data-ui="settings" data-focus="el">Add key</button>');
  for (const d of state.devices.filter((x) => x.setup && x.online !== false)) {
    const btn =
      d.setup.kind === "button" || d.setup.kind === "tv-prompt"
        ? `<button class="btn btn--primary btn--sm" data-act="pair" data-id="${esc(d.id)}">Pair now</button>`
        : d.setup.kind === "token"
          ? `<button class="btn btn--primary btn--sm" data-ui="settings" data-focus="ha">Connect</button>`
          : d.setup.kind === "adb"
            ? `<button class="btn btn--sm" data-ui="open" data-id="${esc(d.id)}">How to</button>`
            : `<button class="btn btn--sm" data-ui="open" data-id="${esc(d.id)}">Add password</button>`;
    add(`setup:${d.id}`, "banner--warn", d.kind === "hub" ? "hub" : "key", `<strong>${esc(d.name)}</strong> found. ${esc(d.setup.message)}`, btn);
  }
  $("#banners").innerHTML = out.join("");
}

function renderTop() {
  const chip = $("#netchip");
  if (state.network) {
    chip.hidden = false;
    chip.innerHTML = `${icon("wifi", 15)} <span>${state.app.demo ? "Demo home" : "Home network"}</span> <code>${esc(state.network.cidr)}</code>`;
  }
  const s = state.scan;
  $("#scanBtn").innerHTML = s.running ? `${icon("refresh", 17, 'class="spin"')} Scanning…` : `${icon("scan", 17)} Scan`;
  $("#scanBtn").disabled = !!s.running;
  $("#tuneBtn").innerHTML = `${icon("tune", 17)} Tune-up`;
  $("#settingsBtn").innerHTML = icon("gear", 18);
  const bar = $("#scanProgress");
  bar.hidden = !s.running;
  bar.firstElementChild.style.width = `${Math.max(4, s.pct || 0)}%`;
}

function renderAll() {
  renderTop();
  renderBanners();
  renderStats();
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
  const el = $(`.card[data-id="${CSS.escape(id)}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  el.classList.add("is-flash");
  setTimeout(() => el.classList.remove("is-flash"), 2200);
}

// ── drawer ────────────────────────────────────────────

const SWATCHES = ["#ff3b30", "#ff9500", "#ffd60a", "#34c759", "#00c7be", "#0a84ff", "#5e5ce6", "#bf5af2", "#ff2d92", "#ffffff"];
const PORT_NAMES = { 21: "FTP", 22: "SSH", 23: "Telnet", 53: "DNS", 80: "Web", 139: "NetBIOS", 443: "Web (secure)", 445: "File sharing", 548: "AFP", 554: "Video stream (RTSP)", 631: "Printing (IPP)", 1400: "Sonos", 1883: "MQTT", 3000: "TV remote (LG)", 3001: "TV remote (LG, secure)", 3389: "Remote Desktop", 5555: "Android debugging (ADB)", 8002: "TV remote (Samsung, secure)", 5000: "Web (alt)", 5001: "Web (alt, secure)", 5900: "Screen sharing (VNC)", 7000: "AirPlay", 8001: "TV remote", 8008: "Cast", 8009: "Cast", 8060: "Roku", 8080: "Web (alt)", 8123: "Home Assistant", 8443: "Web (alt, secure)", 9100: "Printing (raw)", 9123: "Elgato", 9999: "Kasa", 32400: "Plex", 55443: "Yeelight", 62078: "iPhone sync" };

export function openDevice(id) {
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

function controlsHtml(d) {
  const s = d.state || {};
  const id = esc(d.id);
  const rows = [];
  const btn = (act, label, extra = "", value) => `<button class="btn btn--sm ${extra}" data-act="${act}" data-id="${id}"${value != null ? ` data-value="${esc(value)}"` : ""}>${label}</button>`;
  if (d.online === false) rows.push(`<p style="color:var(--muted);margin:0">This device isn't answering right now. ${d.lastSeen ? `Last seen ${ago(d.lastSeen)}.` : ""}</p>`);
  if (isPowered(d)) rows.push(`<div class="control-row"><label>Power</label><button class="switch" role="switch" aria-checked="${s.on}" data-act="${s.on ? "turn_off" : "turn_on"}" data-id="${id}" aria-label="Power"></button></div>`);
  else if (has(d, "turn_on") || has(d, "turn_off")) rows.push(`<div class="control-row"><label>Power</label><div class="btns">${has(d, "turn_on") ? btn("turn_on", `${icon("power", 14)} On`) : ""}${has(d, "turn_off") ? btn("turn_off", "Off") : ""}</div></div>`);
  if (has(d, "set_brightness")) rows.push(`<div class="control-row"><label>Brightness</label><input type="range" min="1" max="100" value="${s.brightness ?? 50}" data-range="set_brightness" data-id="${id}" aria-label="Brightness"><span>${s.brightness ?? "–"}%</span></div>`);
  if (has(d, "set_color_temperature")) rows.push(`<div class="control-row"><label>White tone</label><input class="range-ct" type="range" min="2200" max="6500" step="100" value="${s.colorTemperature ?? 3000}" data-range="set_color_temperature" data-id="${id}" aria-label="White tone"><span>${s.colorTemperature ? `${s.colorTemperature} K` : "–"}</span></div>`);
  if (has(d, "set_color")) rows.push(`<div class="control-row"><label>Colour</label><div class="swatches">${SWATCHES.map((c) => `<button class="swatch" style="background:${c}" data-act="set_color" data-value="${c}" data-id="${id}" aria-label="Colour ${c}"></button>`).join("")}<label class="swatch" style="background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)" title="Any colour"><input type="color" value="${s.color || "#ffaa00"}" data-color="set_color" data-id="${id}" aria-label="Pick a colour"></label></div></div>`);
  if (has(d, "set_scene") && d.info?.scenes?.length) rows.push(`<div class="control-row"><label>Scenes</label><div class="btns">${d.info.scenes.map((n) => btn("set_scene", esc(n), "", n)).join("")}</div></div>`);
  if (has(d, "set_effect")) rows.push(`<div class="control-row"><label>Effect</label><div class="btns">${["Solid", "Rainbow", "Breathe", "Twinkle", "Fire 2012", "Colorloop", "Candle"].map((n) => btn("set_effect", n, "", n)).join("")}</div></div>`);
  if (has(d, "set_preset")) rows.push(`<div class="control-row"><label>Preset</label><form class="inline-form" data-form="set_preset" data-id="${id}"><input name="value" placeholder="Preset name, e.g. Cozy"><button class="btn btn--sm">Apply</button></form></div>`);
  if (has(d, "play") || has(d, "pause")) {
    rows.push(`<div class="control-row"><label>Playback</label><div class="btns">${has(d, "previous") ? btn("previous", icon("prev", 15)) : ""}${has(d, "play") ? btn("play", icon("play", 15)) : ""}${has(d, "pause") ? btn("pause", icon("pause", 15)) : ""}${has(d, "stop") ? btn("stop", icon("stop", 15)) : ""}${has(d, "next") ? btn("next", icon("next", 15)) : ""}</div></div>`);
  }
  if (has(d, "set_volume")) rows.push(`<div class="control-row"><label>Volume</label><input type="range" min="0" max="100" value="${s.volume ?? 20}" data-range="set_volume" data-id="${id}" aria-label="Volume"><span>${s.volume ?? "–"}</span></div>`);
  else if (has(d, "volume_up")) rows.push(`<div class="control-row"><label>Volume</label><div class="btns">${btn("volume_down", "−")}${btn("volume_up", "+")}${has(d, "mute") ? btn("mute", icon("mute", 15)) : ""}</div></div>`);
  if (has(d, "mute") && has(d, "unmute")) rows.push(`<div class="control-row"><label>Sound</label><div class="btns">${btn(s.muted ? "unmute" : "mute", s.muted ? `${icon("volume", 15)} Unmute` : `${icon("mute", 15)} Mute`)}</div></div>`);
  if (has(d, "press_button")) {
    const k = (v, ic, cls = "") => `<button class="btn ${cls}" data-act="press_button" data-value="${v}" data-id="${id}" aria-label="${v}">${ic}</button>`;
    rows.push(`<div class="control-row" style="display:block"><label>Remote</label><div class="remote">${k("back", icon("back", 18))}${k("up", icon("up", 18))}${k("home", icon("home", 18))}${k("left", icon("left", 18))}${k("ok", "OK", "ok")}${k("right", icon("right", 18))}${k("rewind", icon("rewind", 16))}${k("down", icon("down", 18))}${k("fast forward", icon("forward", 16))}</div></div>`);
  }
  if (has(d, "launch_app")) rows.push(`<div class="control-row"><label>Open app</label><div class="btns">${["Netflix", "YouTube", "Disney Plus", "Prime Video"].map((a) => btn("launch_app", a, "", a)).join("")}</div><form class="inline-form" data-form="launch_app" data-id="${id}"><input name="value" placeholder="Any app, e.g. Hulu"><button class="btn btn--sm">Open</button></form></div>`);
  if (has(d, "set_channel") || has(d, "channel_up")) {
    rows.push(
      `<div class="control-row"><label>Channel</label><div class="btns">${has(d, "channel_down") ? btn("channel_down", "−", "", undefined).replace("<button", '<button aria-label="Channel down"') : ""}${has(d, "set_channel") ? `<form class="inline-form inline-form--short" data-form="set_channel" data-id="${id}"><input name="value" placeholder="${s.channel ? esc(s.channel) : "e.g. 7.1"}" aria-label="Channel number or name"><button class="btn btn--sm">Go</button></form>` : ""}${has(d, "channel_up") ? btn("channel_up", "+").replace("<button", '<button aria-label="Channel up"') : ""}</div></div>`,
    );
  }
  if (has(d, "search_youtube"))
    rows.push(`<div class="control-row" style="display:block"><label>YouTube</label><form class="inline-form" data-form="search_youtube" data-id="${id}"><input name="value" placeholder="Search YouTube on ${esc(d.self ? "this computer" : "this TV")}"><button class="btn btn--sm">${icon("search", 14)} Search</button></form><div class="yt-results" id="ytResults">${ytResultsHtml(d.id)}</div></div>`);
  if (has(d, "web_search"))
    rows.push(`<div class="control-row"><label>Web</label><form class="inline-form" data-form="web_search" data-id="${id}"><input name="value" placeholder="Search the web"><button class="btn btn--sm">Search</button></form></div>`);
  if (has(d, "open_website")) rows.push(`<div class="control-row"><label>Website</label><form class="inline-form" data-form="open_website" data-id="${id}"><input name="value" placeholder="e.g. bbc.co.uk"><button class="btn btn--sm">Open</button></form></div>`);
  if (has(d, "type_text")) rows.push(`<div class="control-row"><label>Type</label><form class="inline-form" data-form="type_text" data-id="${id}"><input name="value" placeholder="Types into the box open on the TV"><button class="btn btn--sm">Type</button></form></div>`);
  if (has(d, "search")) rows.push(`<div class="control-row"><label>Search</label><form class="inline-form" data-form="search" data-id="${id}"><input name="value" placeholder="A show or movie"><button class="btn btn--sm">Search</button></form></div>`);
  if (has(d, "switch_input")) rows.push(`<div class="control-row"><label>Input</label><div class="btns">${["HDMI 1", "HDMI 2", "HDMI 3", "Antenna"].map((a) => btn("switch_input", a, "", a)).join("")}</div></div>`);
  if (has(d, "set_temperature")) rows.push(`<div class="control-row"><label>Target</label><div class="btns">${btn("set_temperature", "−", "", (s.targetTemperature ?? 20) - 0.5)}<strong style="min-width:70px;text-align:center;align-self:center">${s.targetTemperature ?? "–"}${s.unit || ""}</strong>${btn("set_temperature", "+", "", (s.targetTemperature ?? 20) + 0.5)}</div></div>`);
  if (has(d, "set_mode") && s.modes?.length) rows.push(`<div class="control-row"><label>Mode</label><div class="btns">${s.modes.map((m) => btn("set_mode", esc(cap(m)), m === s.mode ? "btn--primary" : "", m)).join("")}</div></div>`);
  if (has(d, "open") || has(d, "close")) rows.push(`<div class="control-row"><label>Move</label><div class="btns">${has(d, "open") ? btn("open", "Open") : ""}${has(d, "stop") && !has(d, "play") ? btn("stop", "Stop") : ""}${has(d, "close") ? btn("close", "Close") : ""}</div></div>`);
  if (has(d, "set_position")) rows.push(`<div class="control-row"><label>Position</label><input type="range" min="0" max="100" value="${s.position ?? 50}" data-range="set_position" data-id="${id}"><span>${s.position ?? "–"}%</span></div>`);
  if (has(d, "lock")) rows.push(`<div class="control-row"><label>Lock</label><div class="btns">${btn("lock", `${icon("lock", 14)} Lock`)}${btn("unlock", "Unlock")}</div></div>`);
  if (has(d, "start")) rows.push(`<div class="control-row"><label>Cleaning</label><div class="btns">${btn("start", "Start")}${btn("stop", "Stop")}${has(d, "dock") ? btn("dock", "Dock") : ""}</div></div>`);
  if (has(d, "activate")) rows.push(`<div class="control-row"><label>Run</label>${btn("activate", `${icon("play", 14)} Run now`, "btn--primary")}</div>`);
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
        .map((m) => `<div class="control-row" style="margin:6px 0"><code style="flex:1">${esc(`${m.protocol} ${m.externalPort} → ${m.internalClient}:${m.internalPort}`)}</code><span style="color:var(--muted)">${esc(m.description)}</span>${btn("remove_port_forward", "Close", "btn--danger", `${m.protocol} ${m.externalPort}`)}</div>`)
        .join("")}</div>`,
    );
  }
  const care = [
    has(d, "identify") && btn("identify", `${icon("sparkle", 14)} Identify`),
    has(d, "update_firmware") && btn("update_firmware", `${icon("refresh", 14)} Install update${d.info?.updateAvailable ? " (available)" : ""}`, d.info?.updateAvailable || d.state?.updateAvailable ? "btn--primary" : ""),
    has(d, "enable_auto_updates") && d.state?.autoUpdate === false && btn("enable_auto_updates", "Turn on auto-updates"),
    has(d, "set_led") && btn("set_led", s.ledOff ? "Status light on" : "Status light off", "", s.ledOff ? "on" : "off"),
    has(d, "wake") && btn("wake", `${icon("power", 14)} Wake up`),
    has(d, "pair") && btn("pair", "Pair", "btn--primary"),
    has(d, "reboot") && btn("reboot", `${icon("refresh", 14)} Restart`),
    d.webUrl && `<a class="btn btn--sm" href="${esc(d.webUrl)}" target="_blank" rel="noopener noreferrer">${icon("external", 14)} Settings page</a>`,
    d.ip && `<button class="btn btn--sm" data-ui="diagnose" data-id="${id}">${icon("info", 14)} Diagnose</button>`,
  ].filter(Boolean);
  return `${rows.length ? `<div class="panel"><h3>Controls</h3>${rows.join("")}</div>` : ""}${care.length ? `<div class="panel"><h3>Care</h3><div class="btns">${care.join("")}</div><div id="diagOut"></div></div>` : ""}`;
}

function infoHtml(d) {
  const i = d.info || {};
  const SURE = { exact: "It says so itself", likely: "Strong clues", guess: "Best guess" };
  const rows = [
    ["What it is", d.what && `<strong>${esc(d.what)}</strong>${d.confidence ? ` <span class="badge badge--${d.confidence}">${SURE[d.confidence] || esc(d.confidence)}</span>` : ""}`],
    ["How Patch knows", d.evidence?.length && esc(d.evidence.join("; "))],
    ["Type", d.kindLabel],
    ["Brand", d.brand],
    ["Model", d.model],
    ["Model number", i.modelNumber && `<code>${esc(i.modelNumber)}</code>`],
    ["Software", i.os && esc(i.os)],
    ["Address", d.ip && `<code>${esc(d.ip)}</code>`],
    ["Hardware ID", d.mac && `<code>${esc(d.mac)}</code>${d.vendor ? ` · ${esc(d.vendor)}` : ""}`],
    ["Firmware", i.firmware && esc(i.firmware)],
    ["WiFi signal", typeof i.rssi === "number" && `${i.rssi} dBm (${i.rssi > -60 ? "great" : i.rssi > -67 ? "good" : i.rssi > -75 ? "fair" : "weak"})`],
    ["Power use", d.state?.power != null && `${d.state.power} W`],
    ["Services", d.ports?.length && d.ports.map((p) => `${PORT_NAMES[p] || "port"} <code>${p}</code>`).join(", ")],
    ["Connection", d.info?.linkDownMbps && `${d.info.accessType || "WAN"} · ${d.info.linkDownMbps}/${d.info.linkUpMbps} Mbps line`],
    ["First seen", d.firstSeen && new Date(d.firstSeen).toLocaleString()],
    ["Last seen", d.online ? "Now" : d.lastSeen && ago(d.lastSeen)],
    ["Reported name", d.reportedName && d.reportedName !== d.name && esc(d.reportedName)],
  ].filter(([, v]) => v);
  return `<div class="panel"><h3>About</h3><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${typeof v === "string" && !v.includes("<") ? esc(v) : v}</dd>`).join("")}</dl></div>`;
}

function renderDrawer(fresh = false) {
  const d = state.devices.find((x) => x.id === state.openId);
  const el = $("#drawer");
  if (!d) {
    el.innerHTML = "";
    return;
  }
  const cat = catOf(d.kind);
  const active = document.activeElement;
  if (!fresh && el.contains(active) && (active.tagName === "INPUT" || active.type === "range")) {
    // Don't yank a control out from under the person: refresh only the About panel.
    const info = $("#drawerInfo", el);
    if (info) info.innerHTML = infoHtml(d);
    return;
  }
  el.innerHTML = `
    <div class="drawer__head" style="--tint:${cat.tint}">
      <div class="kind-icon">${icon(kindIcon(d), 26)}</div>
      <div class="drawer__title">
        <input id="nameInput" value="${esc(d.name)}" aria-label="Name" maxlength="48">
        <p>${esc(stateLine(d)) || esc(d.kindLabel)}</p>
      </div>
      <button class="btn btn--ghost icon-btn" data-ui="close" aria-label="Close">${icon("close", 18)}</button>
    </div>
    <div class="drawer__body">
      ${d.setup ? `<div class="banner banner--warn" style="margin-bottom:12px"><div class="banner__icon">${icon("key", 18)}</div><p>${esc(d.setup.message)}</p></div>` : ""}
      ${d.setup?.kind === "password" || d.hasPassword || (d.driver === "shelly" && !d.parent) ? `<div class="panel"><h3>Device password</h3><form class="inline-form" data-form="credentials" data-id="${esc(d.id)}"><input name="password" type="password" placeholder="${d.hasPassword ? "Saved. Type a new one to change it" : "The password set on the device"}" autocomplete="off"><button class="btn btn--sm">Save</button></form><p style="color:var(--muted);font-size:12.5px;margin:8px 0 0">Stored only on this computer, in Patch's data folder.</p></div>` : ""}
      ${controlsHtml(d)}
      <div class="panel"><h3>Where</h3><div class="control-row"><label>Room</label><form class="inline-form" data-form="room" data-id="${esc(d.id)}"><input name="value" value="${esc(d.room || "")}" placeholder="e.g. Living room" list="roomList"><button class="btn btn--sm">Save</button></form><datalist id="roomList">${[...new Set(state.devices.map((x) => x.room).filter(Boolean))].map((r) => `<option value="${esc(r)}">`).join("")}</datalist></div>
      <div class="control-row"><label>Visibility</label><button class="btn btn--sm btn--ghost" data-ui="hide" data-id="${esc(d.id)}">${icon("eyeOff", 14)} ${d.hidden ? "Show on dashboard" : "Hide from dashboard"}</button></div></div>
      <div id="drawerInfo">${infoHtml(d)}</div>
    </div>`;
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
    <div class="score"><div class="ring" style="--p:${t.score};--c:${c}"><strong>${t.score}</strong></div>
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
    renderStats();
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
  renderStats();
  toast("Testing your internet speed… (about 15 seconds)");
  try {
    state.speed = await api("POST", "/api/speedtest", {});
    toast(state.speed.ok ? `${state.speed.downloadMbps} Mbps down, ${state.speed.uploadMbps} Mbps up` : state.speed.message, state.speed.ok ? "ok" : "bad");
  } catch (err) {
    toast(err.message, "bad");
  }
  state.speedRunning = false;
  renderStats();
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
        <small>Create one at <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer">elevenlabs.io → Developers → API keys</a> with the <b>ElevenLabs Agents</b> permission (Write). It's stored only on this computer and is used to start each conversation.${s.elevenlabs.fromEnv ? " It's currently set by the ELEVENLABS_API_KEY environment variable." : ""}</small>
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
        <small>Free from the <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noopener noreferrer">Google Cloud console</a>: create a project, enable <b>YouTube Data API v3</b>, then APIs &amp; Services → Credentials → Create API key. About 100 searches a day are free. The key stays on this computer.</small>
        <div class="check" id="ytCheck"></div>
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
      <label class="field" style="grid-template-columns:auto 1fr;align-items:center"><input type="checkbox" name="lanEnabled" ${s.lan.enabled ? "checked" : ""} style="width:18px;height:18px"><span style="font-weight:500">Let phones and tablets on my WiFi open Patch (asks for an access code${s.lan.active ? `: <code>${esc(s.lan.accessCode)}</code>` : ""}). Needs a restart. Voice works on this computer; other devices can type.</span></label>
      <label class="field" style="grid-template-columns:auto 1fr;align-items:center"><input type="checkbox" name="vendorLookup" ${s.features.vendorLookup ? "checked" : ""} style="width:18px;height:18px"><span style="font-weight:500">Look up who made each device (downloads the public IEEE manufacturer list once; nothing about your network is sent).</span></label>
      <button class="btn">Save</button><div class="check" id="netCheck"></div>
      <p style="color:var(--muted);font-size:12.5px;margin:12px 0 0">Settings and saved passwords live in <code>${esc(s.dataDir)}</code>.</p>
    </form>`,
  );
  const target = focus === "ha" ? 'input[name="haUrl"]' : focus === "el" ? 'input[name="elevenlabsApiKey"]' : null;
  if (target) $(target, $("#modal"))?.focus();
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
  const check = r.checks?.elevenlabs || r.checks?.youtube || r.checks?.homeAssistant || r.checks?.subnet;
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
    renderBanners();
    voice.refresh();
  }
  if (kind === "settings-ha" && check?.ok) state.setup.homeAssistant = true;
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
  const dismiss = e.target.closest("[data-dismiss]");
  if (dismiss) {
    state.dismissed.add(dismiss.dataset.dismiss);
    safeStorage("set", "patch.dismissed", JSON.stringify([...state.dismissed]));
    renderBanners();
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
  const row = e.target.closest("tr[data-id]");
  if (row) {
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
  if ((e.key === "Enter" || e.key === " ") && (e.target.classList?.contains("card") || e.target.matches?.("tr[data-id]"))) {
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

document.addEventListener("input", (e) => {
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
  if (value) doAction(id, kind, String(value));
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
  es.addEventListener("tuneup", (e) => {
    state.tuneup = JSON.parse(e.data);
    renderStats();
  });
  es.addEventListener("notice", (e) => {
    const n = JSON.parse(e.data);
    toast(n.text);
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
  api,
  esc,
  toast,
  flashDevice,
  openDevice,
  openTuneup: (report) => {
    if (report) state.tuneup = report;
    renderStats();
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
    renderStats();
  },
  openSettings,
  stateLine,
};

const voice = createVoice(ui);
// Demo mode only: lets automated checks call the exact tool handlers the voice agent uses.
if (BOOT.demo) window.__patch = { voice, ui };

(async () => {
  try {
    const s = await api("GET", "/api/state");
    Object.assign(state, { devices: s.devices, setup: s.setup, app: s.app, network: s.network, tuneup: s.tuneup, speed: s.speed });
    state.scan.running = s.scan.running;
    renderAll();
    voice.refresh();
  } catch (err) {
    toast(err.message, "bad");
  }
  connectEvents();
})();
