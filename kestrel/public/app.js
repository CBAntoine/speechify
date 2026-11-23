// Kestrel's dashboard. State streams in from the local server; every button calls its API.
import { icon, paintIcons } from "./icons.js";
import { PriceChart, EquityChart, compareChart } from "./charts.js";
import { createVoice } from "./voice.js";

const BOOT = JSON.parse(document.getElementById("boot").textContent);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ── formatting ──
let QUOTE = "USD";
const sym$ = () => (QUOTE === "EUR" ? "€" : QUOTE === "GBP" ? "£" : "$");
export function money(x, { digits = null } = {}) {
  if (x == null || !Number.isFinite(Number(x))) return "—";
  const v = Number(x);
  const d = digits ?? (Math.abs(v) >= 1 || v === 0 ? 2 : Math.abs(v) >= 0.01 ? 4 : 6);
  return `${v < 0 ? "−" : ""}${sym$()}${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}
const price = (x) => (x == null ? "—" : money(x, { digits: x >= 1000 ? 2 : x >= 1 ? 2 : x >= 0.01 ? 4 : 6 }));
const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(d)}%`);
const signedMoney = (x) => (x == null ? "—" : `${x > 0 ? "+" : ""}${money(x)}`);
const cls = (x) => (x > 0 ? "up" : x < 0 ? "down" : "");
const when = (t) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 50) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const dateShort = (t) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const until = (t) => {
  const s = Math.max(0, Math.round((t - Date.now()) / 1000));
  if (s < 60) return "under a minute";
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600);
  return `${h} h ${Math.round((s % 3600) / 60)} min`;
};

// ── API ──
async function api(method, path, body) {
  const res = await fetch(path, { method, headers: { "x-kestrel-token": BOOT.token, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = { ok: false, message: `Kestrel answered ${res.status}.` };
  }
  if (!res.ok || data?.ok === false) {
    const err = new Error(data?.message || data?.error || `Kestrel answered ${res.status}.`);
    err.data = data;
    throw err;
  }
  return data;
}

const ui = { state: null, catalog: null, selected: null, tab: "home", api, esc, money, pct, toast, confirmDialog, BOOT };
window.__kestrel = ui;

// ── toasts and dialogs ──
function toast(text, level = "info", ms = 4200) {
  const el = document.createElement("div");
  el.className = `toast toast--${level}`;
  el.textContent = text;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), ms);
}

const dialog = $("#dialog");
function openDialog(html, { onOpen, dismissable = true } = {}) {
  dialog.innerHTML = html;
  paintIcons(dialog);
  dialog.dataset.dismissable = dismissable ? "1" : "";
  if (!dialog.open) dialog.showModal();
  onOpen?.(dialog);
  return dialog;
}
dialog.addEventListener("cancel", (e) => {
  if (!dialog.dataset.dismissable) e.preventDefault();
});
const closeDialog = () => dialog.open && dialog.close();

function confirmDialog({ title, body, ok = "OK", danger = false, cancel = "Cancel" }) {
  return new Promise((resolve) => {
    openDialog(`<div class="dialog__body"><h2>${esc(title)}</h2><div class="muted">${body}</div></div><div class="dialog__foot"><button class="btn" data-x="no">${esc(cancel)}</button><button class="btn ${danger ? "btn--danger" : "btn--accent"}" data-x="yes">${esc(ok)}</button></div>`);
    dialog.querySelector('[data-x="yes"]').onclick = () => (closeDialog(), resolve(true));
    dialog.querySelector('[data-x="no"]').onclick = () => (closeDialog(), resolve(false));
    dialog.addEventListener("close", () => resolve(false), { once: true });
  });
}

async function act(fn, { ok, busy } = {}) {
  try {
    if (busy) busy.disabled = true;
    const r = await fn();
    if (ok) toast(typeof ok === "function" ? ok(r) : ok, "success");
    return r;
  } catch (e) {
    toast(e.message, "danger", 6500);
    return null;
  } finally {
    if (busy) busy.disabled = false;
  }
}

// ── live updates ──
let es = null;
let lastEventId = null;
function connectStream() {
  es?.close();
  es = new EventSource(`/api/stream?token=${encodeURIComponent(BOOT.token)}`);
  es.addEventListener("state", (e) => {
    ui.state = JSON.parse(e.data);
    QUOTE = ui.state.quote || "USD";
    if (!ui.selected || !ui.state.markets.some((m) => m.symbol === ui.selected)) ui.selected = ui.state.positions[0]?.symbol || ui.state.markets[0]?.symbol || null;
    render();
    maybeWizard();
    showApprovals();
    booted();
  });
  es.addEventListener("activity", (e) => {
    const ev = JSON.parse(e.data);
    if (ev.id === lastEventId) return;
    lastEventId = ev.id;
    if (["trade", "breaker", "daily-limit", "error", "paused"].includes(ev.type)) toast(ev.text, ev.level === "danger" ? "danger" : ev.level === "warning" ? "warning" : "success", 7000);
    voice.onActivity(ev);
  });
  es.addEventListener("job", (e) => onJob(JSON.parse(e.data)));
  es.addEventListener("approvals", () => api("GET", "/api/state").then((s) => ((ui.state = s), showApprovals())));
  es.onerror = () => {
    banner("Lost touch with Kestrel. Is the window that started it still open? Reconnecting…", "danger");
  };
  es.onopen = () => banner(null);
}

let bannerText = null;
function banner(text, level = "warning", buttons = "") {
  const el = $("#banner");
  if (!text) {
    if (bannerText?.startsWith("Lost touch")) bannerText = null;
    return renderBanner();
  }
  bannerText = text;
  el.hidden = false;
  el.className = `banner ${level === "danger" ? "banner--danger" : ""}`;
  el.innerHTML = `${esc(text)}${buttons}`;
}

// ── routing ──
function route() {
  const tab = (location.hash || "#home").slice(1);
  ui.tab = ["home", "test", "connect", "settings"].includes(tab) ? tab : "home";
  for (const v of $$(".view")) v.hidden = v.dataset.view !== ui.tab;
  for (const a of $$(".tabs a")) a.classList.toggle("on", a.dataset.tab === ui.tab);
  if (ui.tab === "test") renderTest();
  if (ui.tab === "connect") renderConnect();
  if (ui.tab === "settings") renderSettings();
  voice.onNavigate(ui.tab, ui.selected);
  if (ui.tab === "home") setTimeout(() => refreshChart(true), 30);
}
window.addEventListener("hashchange", route);

// ── render: top + hero ──
let equityChart = null;
let priceChart = null;
function render() {
  const s = ui.state;
  if (!s) return;
  const badge = $("#modeBadge");
  badge.textContent = s.demo ? "Demo" : s.mode === "live" ? "Real money" : "Practice";
  badge.className = `badge ${s.demo ? "badge--demo" : s.mode === "live" ? "badge--live" : ""}`;
  const run = $("#runBadge");
  run.className = `run ${s.halted ? "halted" : s.running ? "on" : ""}`;
  run.querySelector("span").textContent = s.halted ? "Stopped (safety)" : s.running ? (s.busy ? "Trading…" : "Running") : "Paused";
  renderBanner();
  if (ui.tab !== "home") {
    if (ui.tab === "connect" && !dialog.open) renderConnect(true);
    return;
  }
  const a = s.account;
  $("#heroMode").textContent = s.demo ? "· simulated market" : s.mode === "live" ? `· real money` : `· pretend money, real prices`;
  $("#equity").textContent = money(a.equity);
  $("#pnlTotal").innerHTML = `<span class="${cls(a.pnl)}">${signedMoney(a.pnl)} (${pct(a.pnlPct)})</span>`;
  $("#pnlToday").innerHTML = `<span class="${cls(a.today)}">${signedMoney(a.today)} (${pct(a.todayPct)})</span>`;
  $("#cash").textContent = money(a.cash);
  $("#invested").textContent = `${money(a.invested)} (${Math.round(a.investedPct * 100)}%)`;
  if (!equityChart && window.LightweightCharts) equityChart = new EquityChart($("#equityChart"));
  equityChart?.set(s.equity.length ? s.equity : [{ t: Date.now(), v: a.equity }]);
  renderControls();
  renderMarkets();
  renderWhy();
  renderHoldings();
  renderActivity();
  renderTrades();
  refreshChart(false);
}

function renderBanner() {
  const s = ui.state;
  const el = $("#banner");
  if (bannerText?.startsWith("Lost touch")) return;
  if (!s) return;
  let html = "";
  let level = "warning";
  if (s.halted) {
    level = "danger";
    html = `<b>Kestrel stopped itself.</b> It fell ${(s.halted.drawdown * 100).toFixed(1)}% from its peak, past your ${Math.round(s.risk.maxDrawdown * 100)}% safety limit, so it sold everything and paused. <button class="btn btn--sm" data-act="resume">Resume</button>`;
  } else if (s.mode === "live" && !s.live.connected) {
    level = "danger";
    html = `Real-money mode, but Kestrel can't reach your exchange right now. It stays paused until it can. <a href="#connect">Check the connection</a>`;
  } else if (s.noBuysUntil) {
    html = `Bad day: Kestrel hit its daily loss limit, so it won't buy anything new until ${new Date(s.noBuysUntil).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}. Stops are still on.`;
  } else if (s.demo) {
    level = "info";
    html = `<b>Demo:</b> a simulated market where each 4-hour bar takes about 4 seconds, so you can watch Kestrel trade. Nothing here is real. Run <code>npm start</code> for real prices.`;
  }
  el.hidden = !html;
  el.className = `banner ${level === "danger" ? "banner--danger" : ""}`;
  if (level === "info") el.style.cssText = "border-color: rgba(167,139,250,0.35); background: rgba(167,139,250,0.1); color: #ddd6fe";
  else el.style.cssText = "";
  el.innerHTML = html;
  el.querySelector('[data-act="resume"]')?.addEventListener("click", () => startBot());
}

function renderControls() {
  const s = ui.state;
  const btn = $("#runBtn");
  const running = s.running && !s.halted;
  btn.className = `btn btn--xl ${running ? "btn--pause" : "btn--go"}`;
  btn.innerHTML = running ? `<span data-icon="pause"></span><span>Pause</span>` : `<span data-icon="play"></span><span>${s.halted ? "Resume" : "Start"}${s.mode === "live" ? " (real money)" : ""}</span>`;
  const seg = $("#riskSeg");
  seg.className = "seg seg--risk";
  seg.innerHTML = s.riskLevels.map((r) => `<button type="button" role="radio" aria-checked="${r.id === s.risk.id}" data-risk="${r.id}" class="${r.id === s.risk.id ? "on" : ""}">${esc(r.label)}</button>`).join("");
  $("#riskBlurb").textContent = s.risk.blurb;
  const nextBars = s.markets.map((m) => m.nextBar).filter(Boolean);
  const next = nextBars.length ? Math.min(...nextBars) : null;
  const fee = s.fees ? `${(s.fees.maker * 100).toFixed(2)}% / ${(s.fees.taker * 100).toFixed(2)}%` : "—";
  $("#safety").innerHTML = [
    ["Safety stop", `${Math.round(s.risk.maxDrawdown * 100)}% drop from the peak`],
    ["Daily limit", `no new buys after −${Math.round(s.risk.dailyLoss * 100)}% in a day`],
    ["Most in one market", `${Math.round(s.risk.maxWeight * 100)}% of the bot's money`],
    ["Trailing stops", `${s.risk.stopAtr}× the average daily range`],
    ["Fees (maker / taker)", fee],
    ["Next decision", s.demo ? "every few seconds (demo)" : next ? `in ${until(next + 20_000)}` : "—"],
  ]
    .map(([k, v]) => `<div><span class="muted">${k}</span><span>${esc(v)}</span></div>`)
    .join("");
  paintIcons($(".controls"));
}

function stanceClass(m) {
  if (!m.ready) return "stance--wait";
  return m.score >= 0.1 ? "stance--bull" : m.score <= -0.1 ? "stance--bear" : "";
}

function meter(score) {
  if (score == null) return `<div class="meter"></div>`;
  const w = Math.min(1, Math.abs(score)) * 50;
  const left = score >= 0 ? 50 : 50 - w;
  return `<div class="meter" title="Kestrel's score: ${score.toFixed(2)}"><i style="left:${left}%;width:${w}%;background:${score >= 0 ? "var(--up)" : "var(--down)"}"></i></div>`;
}

function renderMarkets() {
  const s = ui.state;
  const el = $("#markets");
  el.innerHTML =
    s.markets
      .map(
        (m) => `<button type="button" class="mkt ${m.symbol === ui.selected ? "on" : ""}" data-sym="${esc(m.symbol)}">
        ${m.holding > 0 ? `<span class="holdtag">HOLDING</span>` : ""}
        <div class="mkt__top"><span class="mkt__name">${esc(m.name)}</span><span class="mkt__sym">${esc(m.symbol)}</span></div>
        <div class="mkt__row"><span class="mkt__price">${price(m.price)}</span><span class="${cls(m.change24h)}">${pct(m.change24h)}</span></div>
        <div class="mkt__row"><span class="stance ${stanceClass(m)}">${m.ready ? esc(m.stance) : m.status === "error" ? "Problem" : "Warming up"}</span><span class="muted small">${m.ready ? esc(m.regime) : ""}</span></div>
        ${meter(m.score)}
        ${m.status === "error" ? `<div class="small down">${esc(m.message)}</div>` : ""}
      </button>`,
      )
      .join("") || `<div class="empty">No markets yet. Press Add.</div>`;
  for (const b of $$(".mkt", el))
    b.onclick = () => {
      ui.selected = b.dataset.sym;
      renderMarkets();
      renderWhy();
      refreshChart(true);
      voice.onNavigate("home", ui.selected);
    };
}

let chartKey = "";
let chartBusy = false;
async function refreshChart(force) {
  const s = ui.state;
  if (!s || !ui.selected || ui.tab !== "home") return;
  const m = s.markets.find((x) => x.symbol === ui.selected);
  if (!m) return;
  const key = `${m.symbol}|${m.lastBar}|${s.fills.length}|${m.stop}|${s.mode}`;
  if (!force && key === chartKey) return;
  if (chartBusy) return;
  chartBusy = true;
  chartKey = key;
  try {
    const d = await api("GET", `/api/market?symbol=${encodeURIComponent(m.symbol)}&bars=300`);
    if (!priceChart && window.LightweightCharts) priceChart = new PriceChart($("#priceChart"));
    priceChart?.set(d);
    $("#chartTitle").textContent = `${m.name} · ${price(m.price)}`;
    $("#chartSub").textContent = `${m.timeframe === "1d" ? "Daily" : m.timeframe === "1h" ? "Hourly" : "4-hour"} bars · prices from ${venueName(m.venue)}${m.stop ? ` · stop ${price(m.stop)}` : ""}`;
    const holding = m.holding > 0;
    $("#chartActions").innerHTML = `<button class="btn btn--sm" data-a="buy"><span data-icon="plus"></span>Buy</button>${holding ? `<button class="btn btn--sm" data-a="sell"><span data-icon="down"></span>Sell</button>` : ""}<button class="btn btn--sm btn--ghost" data-a="remove"><span data-icon="x"></span>Remove</button>`;
    paintIcons($("#chartActions"));
    $("#chartActions [data-a=buy]").onclick = () => manualOrder(m.symbol, "buy");
    $("#chartActions [data-a=sell]")?.addEventListener("click", () => manualOrder(m.symbol, "sell"));
    $("#chartActions [data-a=remove]").onclick = () => removeMarket(m.symbol);
  } catch (e) {
    $("#chartSub").textContent = e.message;
  } finally {
    chartBusy = false;
  }
}

const venueName = (v) => ({ demo: "the simulated market", kraken: "Kraken", coinbase: "Coinbase", alpaca: "Alpaca" })[v] || ui.catalog?.venues.find((x) => x.id === v)?.name || v || "—";
const EXPERT_NAMES = { trend: "Trend", momentum: "Momentum", breakout: "Breakout", kalman: "Trend filter", macd: "MACD", reversion: "Bounce", learner: "Self-learning" };

function renderWhy() {
  const s = ui.state;
  const m = s.markets.find((x) => x.symbol === ui.selected);
  if (!m) {
    $("#whyStance").innerHTML = "";
    $("#whyReasons").innerHTML = "";
    $("#experts").innerHTML = "";
    return;
  }
  if (!m.ready) {
    $("#whyStance").innerHTML = `<span class="big">${m.status === "error" ? "Problem" : "Warming up"}</span>`;
    $("#whyReasons").innerHTML = `<li>${esc(m.message || "Reading the recent price history…")}</li>`;
    $("#experts").innerHTML = "";
    return;
  }
  $("#whyStance").innerHTML = `<span class="big ${cls(m.score)}">${esc(m.stance)}</span><span class="stance ${stanceClass(m)}">score ${m.score >= 0 ? "+" : ""}${m.score.toFixed(2)}</span><span class="muted small">${esc(m.regime)} · buys above +${s.risk.id === "careful" ? "0.15" : s.risk.id === "bold" ? "0.10" : "0.12"}</span>`;
  $("#whyReasons").innerHTML = m.reasons.length ? m.reasons.map((r) => `<li><b>${esc(r.expert)}</b>${esc(r.text)}</li>`).join("") : `<li>${esc(m.summary)}</li>`;
  $("#experts").innerHTML = m.experts
    .map((e) => {
      const w = Math.min(1, Math.abs(e.score)) * 50;
      const left = e.score >= 0 ? 50 : 50 - w;
      return `<div class="expert"><span>${esc(EXPERT_NAMES[e.id] || e.id)}</span><div class="expert__bar" title="opinion ${e.score.toFixed(2)}"><i style="left:${left}%;width:${w}%;background:${e.score >= 0 ? "var(--up)" : "var(--down)"};opacity:${0.35 + Math.min(1, e.weight * 3) * 0.65}"></i></div><span class="expert__w">${Math.round(e.weight * 100)}%</span></div>`;
    })
    .join("");
}

function renderHoldings() {
  const s = ui.state;
  const el = $("#holdings");
  $("#holdingsNote").textContent = s.positions.length ? `${s.positions.length} position${s.positions.length > 1 ? "s" : ""}` : "all cash";
  if (!s.positions.length) {
    el.innerHTML = `<div class="empty">Nothing held right now. Kestrel buys when its experts agree a market is rising.</div>`;
    return;
  }
  el.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Market</th><th class="r">Value</th><th class="r">Gain</th><th class="r">Stop</th><th></th></tr></thead><tbody>${s.positions
    .map((p) => `<tr><td><b>${esc(p.name)}</b><div class="muted small">bought at ${price(p.entry)}</div></td><td class="r">${money(p.value)}</td><td class="r ${cls(p.pnl)}">${signedMoney(p.pnl)}<div class="small">${pct(p.pnlPct)}</div></td><td class="r">${price(p.stop)}<div class="muted small">${p.stopDistance != null ? `${(p.stopDistance * 100).toFixed(1)}% below` : ""}</div></td><td class="r"><button class="btn btn--sm" data-sell="${esc(p.symbol)}">Sell</button></td></tr>`)
    .join("")}</tbody></table></div>`;
  for (const b of $$("[data-sell]", el)) b.onclick = () => manualOrder(b.dataset.sell, "sell");
}

const EV_ICON = { trade: "bolt", signal: "signal", breaker: "alert", "daily-limit": "alert", error: "alert", warning: "alert", start: "play", pause: "pause", settings: "gear", connect: "link", backtest: "flask", mode: "shield", "sell-all": "stop", resumed: "play", paused: "pause" };
function renderActivity() {
  const s = ui.state;
  const el = $("#activity");
  el.innerHTML = s.events.length
    ? s.events
        .slice(0, 60)
        .map((e) => `<li class="${esc(e.level)}"><span class="dot">${icon(EV_ICON[e.type] || "dot")}</span><div>${esc(e.text)}<time>${when(e.t)}</time></div></li>`)
        .join("")
    : `<li><span></span><div class="muted">Nothing yet.</div></li>`;
}

function renderTrades() {
  const s = ui.state;
  const el = $("#trades");
  if (!s.trades.length) {
    $("#tradesNote").textContent = "";
    el.innerHTML = `<div class="empty">No finished trades yet. A trade finishes when Kestrel sells what it bought.</div>`;
    return;
  }
  const wins = s.trades.filter((t) => t.pnl > 0).length;
  const total = s.trades.reduce((a, t) => a + t.pnl, 0);
  $("#tradesNote").innerHTML = `${s.trades.length} trades · ${Math.round((wins / s.trades.length) * 100)}% winners · <span class="${cls(total)}">${signedMoney(total)}</span>`;
  const why = SOLD_WHY;
  el.innerHTML = `<div class="tablewrap"><table><thead><tr><th>Market</th><th>Held</th><th class="r">Bought</th><th class="r">Sold</th><th class="r">Result</th><th class="r">Fees</th><th>Why it sold</th></tr></thead><tbody>${s.trades
    .slice(0, 40)
    .map((t) => `<tr><td><b>${esc(marketLabel(t.symbol))}</b></td><td class="muted small">${s.demo ? `${t.bars} bars` : `${dateShort(t.entryT)} → ${dateShort(t.exitT)}`}</td><td class="r">${price(t.entry)}</td><td class="r">${price(t.exit)}</td><td class="r ${cls(t.pnl)}">${signedMoney(t.pnl)} <span class="small">(${pct(t.ret)})</span></td><td class="r muted">${money(t.fees)}</td><td class="muted">${esc(why[t.exitReason] || t.exitReason)}</td></tr>`)
    .join("")}</tbody></table></div>`;
}

const SOLD_WHY = { stop: "stop hit", exit: "signal faded", breaker: "safety stop", "sell-all": "you sold all", "manual-sell": "your sale", trim: "trimmed", remove: "market removed" };
const marketLabel = (s) => ui.state?.markets.find((m) => m.symbol === s)?.name || s;

// ── home actions ──
async function startBot() {
  const s = ui.state;
  if (s.mode === "live") {
    const ok = await confirmDialog({ title: "Start trading with real money?", body: `Kestrel will trade your <b>${money(s.live.budget)}</b> budget on your exchange, at the <b>${esc(s.risk.label)}</b> risk level, with orders of at most ${money(s.live.maxOrder)}. You can pause at any time.`, ok: "Start with real money", danger: true });
    if (!ok) return;
  }
  await act(() => api("POST", "/api/bot/start"), { ok: s.halted ? "Resumed." : "Kestrel is running." });
}

$("#runBtn").onclick = async () => {
  const s = ui.state;
  if (!s) return;
  if (s.running && !s.halted) await act(() => api("POST", "/api/bot/pause"), { ok: "Paused. Positions are kept." });
  else await startBot();
};

$("#riskSeg").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-risk]");
  if (!b) return;
  const s = ui.state;
  const order = ["careful", "balanced", "bold"];
  const to = s.riskLevels.find((r) => r.id === b.dataset.risk);
  if (to.id === s.risk.id) return;
  if (s.mode === "live" && order.indexOf(to.id) > order.indexOf(s.risk.id)) {
    const ok = await confirmDialog({ title: `Raise risk to ${to.label}?`, body: `${esc(to.blurb)}<br><br>The safety stop moves to a ${Math.round(to.maxDrawdown * 100)}% drop from the peak.`, ok: `Use ${to.label}` });
    if (!ok) return;
  }
  await act(() => api("POST", "/api/risk", { level: to.id }), { ok: `Risk level: ${to.label}.` });
});

$("#sellAllBtn").onclick = async () => {
  const s = ui.state;
  if (!s.positions.length) return toast("Nothing to sell: the bot holds only cash.");
  const ok = await confirmDialog({ title: "Sell everything and pause?", body: `This sells all ${s.positions.length} position${s.positions.length > 1 ? "s" : ""} (${money(s.account.invested)}) at market prices${s.mode === "live" ? " <b>with real money</b>" : ""} and pauses Kestrel.`, ok: "Sell everything", danger: true });
  if (ok) await act(() => api("POST", "/api/bot/sell-all", { confirm: true }), { ok: "Sold everything and paused." });
};

async function manualOrder(symbol, side) {
  const s = ui.state;
  const m = s.markets.find((x) => x.symbol === symbol);
  const pos = s.positions.find((p) => p.symbol === symbol);
  const live = s.mode === "live";
  openDialog(`<form class="dialog__body" id="ordForm"><h2>${side === "buy" ? "Buy" : "Sell"} ${esc(m?.name || symbol)}</h2>
    <p class="muted">${side === "buy" ? `Kestrel will look after this position like its own: stop, trailing and selling when the signal fades. Cash available: ${money(s.account.cash)}.` : `The bot holds ${money(pos?.value)} of it.`}${live ? " <b class='down'>This uses real money.</b>" : ""}</p>
    <label class="form" style="margin:0">Amount in ${QUOTE} <input id="ordAmt" type="number" min="10" step="1" ${side === "sell" ? `placeholder="Leave empty to sell all"` : `value="${Math.min(500, Math.floor(s.account.cash))}"`} /></label>
    </form><div class="dialog__foot"><button class="btn" data-x="no" type="button">Cancel</button><button class="btn ${live ? "btn--danger" : "btn--accent"}" data-x="yes" type="button">${side === "buy" ? "Buy" : "Sell"}${live ? " with real money" : ""}</button></div>`);
  dialog.querySelector('[data-x="no"]').onclick = closeDialog;
  dialog.querySelector('[data-x="yes"]').onclick = async () => {
    const v = dialog.querySelector("#ordAmt").value;
    const amount = v ? Number(v) : null;
    closeDialog();
    await act(() => api("POST", "/api/orders", { symbol, side, amount, all: side === "sell" && !amount }), { ok: (r) => (r.fill ? `${r.fill.side === "buy" ? "Bought" : "Sold"} ${money(r.fill.value)} of ${marketLabel(symbol)}.` : "Done.") });
  };
}

async function removeMarket(symbol) {
  const s = ui.state;
  const held = s.positions.some((p) => p.symbol === symbol);
  const ok = await confirmDialog({ title: `Stop trading ${marketLabel(symbol)}?`, body: held ? "Kestrel holds some of it, so it sells that first." : "Kestrel stops watching it. You can add it again any time.", ok: held ? "Sell and remove" : "Remove", danger: held });
  if (ok) await act(() => api("POST", "/api/markets/remove", { symbol, sell: true }), { ok: `Removed ${marketLabel(symbol)}.` });
}

$("#addMarketBtn").onclick = () => addMarketDialog();
function addMarketDialog() {
  const s = ui.state;
  const picks = (ui.catalog?.quickPicks || []).filter((p) => !s.markets.some((m) => m.symbol === p.symbol));
  openDialog(`<div class="dialog__body"><h2>Add a market</h2><p class="muted">Pick one, or search by name or ticker (for example "Chainlink", "AVAX" or "MSFT"). Stocks need an Alpaca account.</p>
    <div class="chips">${picks.map((p) => `<button class="chip" data-s="${esc(p.symbol)}">${esc(p.name)} <small>${esc(p.symbol)}</small></button>`).join("")}</div>
    <input id="mktSearch" placeholder="Search…" /><div id="mktResults" class="chips"></div></div>
    <div class="dialog__foot"><button class="btn" data-x="no">Close</button></div>`);
  dialog.querySelector('[data-x="no"]').onclick = closeDialog;
  const add = async (symbol) => {
    closeDialog();
    toast(`Adding ${symbol}… reading its history.`);
    await act(() => api("POST", "/api/markets/add", { symbol }), { ok: (r) => (r.ready ? `Now trading ${marketLabel(r.symbol)}.` : `Added. ${r.message || ""}`) });
  };
  for (const b of $$("[data-s]", dialog)) b.onclick = () => add(b.dataset.s);
  let t = null;
  $("#mktSearch", dialog).oninput = (e) => {
    clearTimeout(t);
    const q = e.target.value.trim();
    t = setTimeout(async () => {
      const box = $("#mktResults", dialog);
      if (!q) return (box.innerHTML = "");
      const local = /^[a-z]{1,5}$/i.test(q) && !q.includes("/") ? [`${q.toUpperCase()}`] : [];
      let results = [];
      try {
        results = (await api("GET", `/api/markets/search?q=${encodeURIComponent(q)}`)).results || [];
      } catch {
        /* the search is a convenience */
      }
      const items = [...results.map((r) => r.symbol), ...local.map((x) => (results.some((r) => r.base === x) ? null : x))].filter(Boolean).slice(0, 18);
      box.innerHTML = items.map((x) => `<button class="chip" data-s="${esc(x)}">${esc(x)}${x.includes("/") ? "" : " <small>stock</small>"}</button>`).join("") || `<span class="muted small">No matches.</span>`;
      for (const b of $$("[data-s]", box)) b.onclick = () => add(b.dataset.s);
    }, 300);
  };
}

// ── approvals: real-money orders the voice agent asked for ──
let shownApproval = null;
function showApprovals() {
  const a = ui.state?.approvals?.[0];
  if (!a || shownApproval === a.id) return;
  shownApproval = a.id;
  openDialog(`<div class="dialog__body"><h2><span data-icon="shield"></span> Approve this real-money order?</h2><p style="font-size:18px">${esc(a.summary)}</p><p class="muted">The voice assistant asked for it and you said yes. Real-money orders always need a tap here as well.</p></div><div class="dialog__foot"><button class="btn" data-x="no">Decline</button><button class="btn btn--danger" data-x="yes">Approve</button></div>`, { dismissable: false });
  const done = async (yes) => {
    closeDialog();
    shownApproval = null;
    await act(() => api("POST", `/api/approvals/${a.id}`, { approve: yes }), { ok: yes ? "Approved. Sending the order…" : "Declined." });
    voice.sendContext(yes ? `The person approved on screen: ${a.summary}.` : `The person declined on screen: ${a.summary}.`);
  };
  dialog.querySelector('[data-x="yes"]').onclick = () => done(true);
  dialog.querySelector('[data-x="no"]').onclick = () => done(false);
}

// ── first-run wizard ──
let wizardShown = false;
function maybeWizard() {
  const s = ui.state;
  if (wizardShown || !s || s.setupDone || !ui.catalog) return;
  wizardShown = true;
  const w = { step: 0, mode: "practice", markets: new Set(s.markets.map((m) => m.symbol)), risk: s.risk.id };
  const steps = () => `<div class="wizard__steps">${[0, 1, 2].map((i) => `<i class="${i <= w.step ? "on" : ""}"></i>`).join("")}</div>`;
  const draw = () => {
    let body = "";
    if (w.step === 0)
      body = `<h1>Welcome to Kestrel</h1><p class="muted">Kestrel trades for you around the clock: it reads every market seven ways, buys clear uptrends, steps aside in downtrends, and guards every position with a stop. Ask it anything, out loud.</p>
      <div class="choice"><button data-mode="practice" class="${w.mode === "practice" ? "on" : ""}"><b>Practice first (recommended)</b><span>$10,000 of pretend money, trading at real prices. No account needed.</span></button>
      <button data-mode="live" class="${w.mode === "live" ? "on" : ""}"><b>I want to use real money</b><span>Start in practice, then connect your exchange and switch on real money from the Connect page.</span></button></div>`;
    if (w.step === 1)
      body = `<h1>What should it trade?</h1><p class="muted">Pick a few. Crypto trades around the clock with no account needed for practice; stocks need a free Alpaca account (Connect page).</p>
      <div class="chips">${ui.catalog.quickPicks.map((p) => `<button class="chip ${w.markets.has(p.symbol) ? "on" : ""}" data-s="${esc(p.symbol)}">${esc(p.name)} <small>${p.assetClass === "stock" ? "stock" : esc(p.symbol)}</small></button>`).join("")}</div>`;
    if (w.step === 2)
      body = `<h1>How bold?</h1><p class="muted">You can change this any time.</p><div class="choice">${ui.catalog.risk.map((r) => `<button data-r="${r.id}" class="${w.risk === r.id ? "on" : ""}"><b>${esc(r.label)}</b><span>${esc(r.blurb)} Safety stop at a ${Math.round(r.maxDrawdown * 100)}% drop.</span></button>`).join("")}</div>`;
    openDialog(`<div class="dialog__body">${steps()}${body}</div><div class="dialog__foot">${w.step ? `<button class="btn" data-x="back">Back</button>` : ""}<button class="btn btn--accent" data-x="next">${w.step === 2 ? "Start Kestrel" : "Next"}</button></div>`, { dismissable: false });
    for (const b of $$("[data-mode]", dialog)) b.onclick = () => ((w.mode = b.dataset.mode), draw());
    for (const b of $$("[data-r]", dialog)) b.onclick = () => ((w.risk = b.dataset.r), draw());
    for (const b of $$("[data-s]", dialog))
      b.onclick = () => {
        const x = b.dataset.s;
        if (w.markets.has(x)) w.markets.delete(x);
        else w.markets.add(x);
        b.classList.toggle("on");
      };
    dialog.querySelector('[data-x="back"]')?.addEventListener("click", () => ((w.step -= 1), draw()));
    dialog.querySelector('[data-x="next"]').onclick = async () => {
      if (w.step === 1 && !w.markets.size) return toast("Pick at least one market.", "warning");
      if (w.step < 2) {
        w.step += 1;
        return draw();
      }
      closeDialog();
      toast("Setting up… reading each market's recent history.");
      await act(() => api("POST", "/api/setup", { markets: [...w.markets], risk: w.risk, start: true }), { ok: "Kestrel is running with practice money." });
      if (w.mode === "live") location.hash = "#connect";
    };
  };
  draw();
}

// ── test tab ──
const bt = { markets: null, days: 365, risk: null, job: null, chart: null };
function renderTest() {
  const s = ui.state;
  if (!s || !ui.catalog) return;
  bt.risk ??= s.risk.id;
  if (!bt.markets) bt.markets = new Set(s.markets.filter((m) => m.assetClass === "crypto").map((m) => m.symbol).slice(0, 3));
  const opts = [...new Set([...s.markets.map((m) => m.symbol), ...ui.catalog.quickPicks.map((p) => p.symbol)])];
  $("#btMarkets").innerHTML = opts.map((x) => `<button type="button" class="chip ${bt.markets.has(x) ? "on" : ""}" data-s="${esc(x)}">${esc(marketLabel(x) === x ? ui.catalog.quickPicks.find((p) => p.symbol === x)?.name || x : marketLabel(x))} <small>${x.includes("/") ? esc(x) : "stock"}</small></button>`).join("");
  for (const b of $$("#btMarkets [data-s]"))
    b.onclick = () => {
      const x = b.dataset.s;
      if (bt.markets.has(x)) bt.markets.delete(x);
      else bt.markets.add(x);
      b.classList.toggle("on");
    };
  $("#btRisk").innerHTML = ui.catalog.risk.map((r) => `<button type="button" data-r="${r.id}" class="${bt.risk === r.id ? "on" : ""}">${esc(r.label)}</button>`).join("");
  for (const b of $$("#btRisk [data-r]")) b.onclick = () => ((bt.risk = b.dataset.r), renderTest());
  for (const b of $$("#btDays [data-days]")) {
    b.classList.toggle("on", Number(b.dataset.days) === bt.days);
    b.onclick = () => ((bt.days = Number(b.dataset.days)), renderTest());
  }
}

$("#btForm").onsubmit = async (e) => {
  e.preventDefault();
  if (!bt.markets?.size) return toast("Pick at least one market to test.", "warning");
  const syms = [...bt.markets];
  if (new Set(syms.map((x) => (x.includes("/") ? "c" : "s"))).size > 1) return toast("Test crypto and stocks separately: they trade on different clocks.", "warning");
  $("#btProgress").textContent = "Starting…";
  const r = await act(() => api("POST", "/api/backtest", { symbols: syms, days: bt.days, risk: bt.risk }));
  if (r) {
    bt.job = r.id;
    pollJob(r.id);
  }
};

async function pollJob(id) {
  for (let i = 0; i < 600 && bt.job === id; i++) {
    const j = await api("GET", `/api/backtest/${id}`).catch(() => null);
    if (!j) break;
    if (j.status !== "running") return showResult(j);
    $("#btProgress").textContent = j.progress || "Working…";
    await new Promise((r) => setTimeout(r, 700));
  }
}

function onJob(j) {
  if (j.id === bt.job && j.status === "running") $("#btProgress").textContent = j.progress || "";
  if (j.status !== "running") voice.onBacktest(j);
}

function showResult(j) {
  $("#btProgress").textContent = "";
  const el = $("#btResult");
  el.hidden = false;
  if (j.status === "error") {
    el.innerHTML = `<div class="card note note--warn">${esc(j.error)}</div>`;
    return;
  }
  const r = j.result;
  const m = r.metrics;
  const b = r.benchmark;
  const mc = r.montecarlo;
  const span = mc ? [Math.min(mc.returnP5, 0) - 0.05, Math.max(mc.returnP95, 0) + 0.05] : [-1, 1];
  const pos = (x) => ((x - span[0]) / (span[1] - span[0])) * 100;
  const lab = (x) => Math.min(90, Math.max(10, pos(x)));
  const feesHigh = r.fees.maker >= 0.005;
  el.innerHTML = `
    <div class="card"><div class="section-head"><h2>${esc(r.symbols.map((x) => r.names[x]).join(" + "))} · ${new Date(r.from).toLocaleDateString()} to ${new Date(r.to).toLocaleDateString()}</h2><span class="muted small">${esc(r.risk)} · fees from ${esc(r.feeVenue)} (${(r.fees.maker * 100).toFixed(2)}% / ${(r.fees.taker * 100).toFixed(2)}%) · prices from ${esc(r.sources.join(", "))}</span></div>
      <div class="vs">
        <div class="stat"><div class="k">Kestrel</div><div class="v ${cls(m.totalReturn)}">${pct(m.totalReturn)}</div><div class="s">${signedMoney(m.end - m.start)} on ${money(m.start, { digits: 0 })} · worst dip ${pct(m.maxDrawdown)}</div></div>
        <div class="stat"><div class="k">Buying and holding</div><div class="v ${cls(b.totalReturn)}">${pct(b.totalReturn)}</div><div class="s">worst dip ${pct(b.maxDrawdown)}</div></div>
        <div class="stat"><div class="k">Difference</div><div class="v ${cls(m.totalReturn - b.totalReturn)}">${pct(m.totalReturn - b.totalReturn)}</div><div class="s">${m.maxDrawdown > b.maxDrawdown ? `dips ${pct(b.maxDrawdown - m.maxDrawdown).replace("−", "")} shallower` : "deeper dips than holding"}</div></div>
      </div>
      <div id="btChart" class="btChart" style="margin-top:14px"></div>
      ${feesHigh ? `<div class="note note--warn" style="margin-top:12px">These fees are high for an active strategy: a lot of the result goes to the exchange. Lower-fee exchanges (Kraken Pro, Alpaca, Binance) usually do much better.</div>` : ""}
    </div>
    <div class="card"><h2>Range of one-year outcomes</h2><p class="muted small">Kestrel's daily results reshuffled 1,000 times (Monte Carlo): what the same edge could plausibly do over a year. Past results don't guarantee future ones.</p>
      ${mc ? `<div class="range"><div class="range__track"></div><div class="range__band" style="left:${pos(mc.returnP5)}%;width:${pos(mc.returnP95) - pos(mc.returnP5)}%"></div><div class="range__zero" style="left:${pos(0)}%"></div><span class="range__mark" style="left:${lab(mc.returnP5)}%">bad year ${pct(mc.returnP5)}</span><span class="range__mark" style="left:${lab(mc.returnP50)}%;top:30px">typical ${pct(mc.returnP50)}</span><span class="range__mark" style="left:${lab(mc.returnP95)}%">good year ${pct(mc.returnP95)}</span></div><p class="small muted">Chance of losing money over a year: ${Math.round(mc.chanceOfLoss * 100)}%. Typical worst dip within a year: ${pct(mc.drawdownP50)}.</p>` : `<p class="muted">Not enough history for a range.</p>`}
    </div>
    <div class="card"><div class="grid4">
      ${[
        ["Trades", m.trades],
        ["Winners", `${Math.round(m.winRate * 100)}%`],
        ["Profit factor", Number.isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : "∞"],
        ["Sharpe ratio", (Math.abs(m.sharpe) < 0.005 ? 0 : m.sharpe).toFixed(2)],
        ["Average win", money(m.avgWin)],
        ["Average loss", money(m.avgLoss)],
        ["Time invested", `${Math.round((m.exposure || 0) * 100)}%`],
        ["Fees paid", money(m.fees)],
      ]
        .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(v)}</div></div>`)
        .join("")}
    </div>${r.events.some((e) => e.type === "breaker") ? `<p class="muted small" style="margin-top:10px">The safety stop tripped ${r.events.filter((e) => e.type === "breaker").length} time(s); the test assumes you resumed a week later each time.</p>` : ""}</div>
    <div class="card"><h2>Trades in the test</h2><div class="tablewrap" style="max-height:360px;overflow:auto"><table><thead><tr><th>Market</th><th>Bought</th><th>Sold</th><th class="r">Result</th><th>Why it sold</th></tr></thead><tbody>${r.trades
      .slice()
      .reverse()
      .slice(0, 150)
      .map((t) => `<tr><td>${esc(r.names[t.symbol] || t.symbol)}</td><td class="small">${dateShort(t.entryT)} at ${price(t.entry)}</td><td class="small">${dateShort(t.exitT)} at ${price(t.exit)}</td><td class="r ${cls(t.pnl)}">${signedMoney(t.pnl)} (${pct(t.ret)})</td><td class="muted small">${esc(SOLD_WHY[t.exitReason] || t.exitReason)}</td></tr>`)
      .join("")}</tbody></table></div></div>`;
  bt.chart?.remove?.();
  bt.chart = compareChart($("#btChart"), r.equity, r.benchmarkEquity);
}

// ── connect tab ──
let connectSig = "";
function renderConnect(passive = false) {
  const s = ui.state;
  if (!s || !ui.catalog) return;
  const sig = JSON.stringify([s.connections, s.mode, s.live]);
  if (passive && sig === connectSig) return;
  connectSig = sig;
  $("#connected").innerHTML = s.connections.length
    ? s.connections
        .map(
          (c) => `<div class="conn"><div><b>${esc(c.name)}</b> <span class="pill ${c.paper || c.sandbox ? "" : "pill--good"}">${c.paper ? "paper account" : c.sandbox ? "test" : "real account"}</span>
      <div class="muted small">${Object.entries(c.balances || {})
        .slice(0, 6)
        .map(([k, v]) => `${esc(k)} ${Number(v.total).toLocaleString("en-US", { maximumFractionDigits: 6 })}`)
        .join(" · ") || "No balances yet"} ${c.fees ? `· fees ${(c.fees.maker * 100).toFixed(2)}% / ${(c.fees.taker * 100).toFixed(2)}% (${esc(c.fees.source || "")})` : ""}</div></div>
      <button class="btn btn--sm btn--ghost" data-disc="${esc(c.id)}">Disconnect</button></div>`,
        )
        .join("")
    : "";
  for (const b of $$("[data-disc]"))
    b.onclick = async () => {
      if (await confirmDialog({ title: "Disconnect?", body: "Kestrel deletes the keys from this computer. Your exchange account isn't touched.", ok: "Disconnect" })) await act(() => api("POST", "/api/disconnect", { id: b.dataset.disc }), { ok: "Disconnected." });
    };
  $("#venues").innerHTML = ui.catalog.venues
    .map(
      (v) => `<div class="venue"><div class="venue__top"><span class="venue__name">${esc(v.name)}</span>${v.recommended ? `<span class="pill pill--good">low fees</span>` : v.feeWarning ? `<span class="pill pill--warn">high fees</span>` : ""}</div>
      <div class="muted small">${esc(v.assets.join(" + "))} · fees ${(v.fees.maker * 100).toFixed(2)}% / ${(v.fees.taker * 100).toFixed(2)}%${v.practiceAccount ? " · free paper account" : v.sandbox ? " · test mode" : ""}</div>
      <p class="small">${esc(v.blurb)}</p>
      <div><button class="btn btn--sm" data-conn="${esc(v.id)}"><span data-icon="link"></span>Connect ${esc(v.name)}</button></div></div>`,
    )
    .join("");
  paintIcons($("#venues"));
  for (const b of $$("[data-conn]")) b.onclick = () => connectDialog(ui.catalog.venues.find((v) => v.id === b.dataset.conn));
  renderLive();
}

function connectDialog(v) {
  const sandboxOpt = v.practiceAccount ? `<label class="check"><input type="checkbox" id="cPaper" checked /> This is a paper (practice) account</label>` : v.sandbox ? `<label class="check"><input type="checkbox" id="cSandbox" /> These keys are for ${esc(v.name)}'s test environment</label>` : "";
  openDialog(`<form class="dialog__body" id="cForm"><h2>Connect ${esc(v.name)}</h2>
    <ol class="steps">${v.steps.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
    ${v.keysUrl ? `<p class="small"><a href="${esc(v.keysUrl)}" target="_blank" rel="noopener noreferrer">Open ${esc(v.name)}'s API key page ↗</a></p>` : ""}
    <div class="form" style="margin:0">${v.fields.map((f) => `<label>${esc(f.label)}${f.multiline ? `<textarea data-f="${esc(f.id)}" spellcheck="false"></textarea>` : `<input data-f="${esc(f.id)}" type="${f.secret ? "password" : "text"}" autocomplete="off" spellcheck="false" />`}</label>`).join("")}${sandboxOpt}</div>
    <p class="muted small">Never give a key withdrawal permission. Kestrel checks the key by reading your balance, then keeps it in a file on this computer that only you can read.</p>
    <p id="cMsg" class="small"></p></form>
    <div class="dialog__foot"><button class="btn" data-x="no" type="button">Cancel</button><button class="btn btn--accent" data-x="yes" type="button">Check and connect</button></div>`);
  dialog.querySelector('[data-x="no"]').onclick = closeDialog;
  dialog.querySelector('[data-x="yes"]').onclick = async (e) => {
    const credentials = Object.fromEntries($$("[data-f]", dialog).map((i) => [i.dataset.f, i.value]));
    const msg = $("#cMsg", dialog);
    msg.className = "small muted";
    msg.textContent = "Checking the key with the exchange…";
    e.target.disabled = true;
    try {
      const r = await api("POST", "/api/connect", { venue: v.id, credentials, paper: !!$("#cPaper", dialog)?.checked, sandbox: !!$("#cSandbox", dialog)?.checked });
      closeDialog();
      toast(`Connected to ${v.name}.`, "success");
      voice.sendContext(`The person connected ${v.name}. Balances: ${Object.entries(r.balances || {}).map(([k, x]) => `${k} ${x.total}`).join(", ") || "empty"}.`);
    } catch (err) {
      msg.className = "small down";
      msg.textContent = err.message;
      e.target.disabled = false;
    }
  };
}

function renderLive() {
  const s = ui.state;
  const el = $("#liveBody");
  if (s.demo) {
    el.innerHTML = `<p class="muted">Demo mode can't use real money. Close it and run <code>npm start</code>.</p>`;
    return;
  }
  if (s.mode === "live") {
    const c = s.connections.find((x) => x.id === s.live.broker);
    el.innerHTML = `<p><b class="down">Real money is on</b> with ${esc(c?.name || s.live.broker)}. Budget ${money(s.live.budget)}, largest single order ${money(s.live.maxOrder)}. Kestrel only trades this budget.</p>
      <div class="form"><label>Largest single order <input id="maxOrder" type="number" min="10" step="10" value="${s.live.maxOrder}" /></label>
      <div class="row"><button class="btn" id="saveMax">Save</button><button class="btn btn--ghost" id="toPractice">Go back to practice</button></div></div>`;
    $("#saveMax").onclick = () => act(() => api("POST", "/api/settings", { maxOrder: Number($("#maxOrder").value) }), { ok: "Saved." });
    $("#toPractice").onclick = async () => {
      if (await confirmDialog({ title: "Back to practice?", body: "Kestrel pauses real trading. Any real positions stay in your account, and Kestrel manages them again if you switch back.", ok: "Back to practice" })) await act(() => api("POST", "/api/live/disable"), { ok: "Practice mode." });
    };
    return;
  }
  const options = s.connections.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.paper ? " (paper account: pretend money at a real broker)" : c.sandbox ? " (test environment)" : " (real account)"}</option>`).join("");
  if (!options) {
    el.innerHTML = `<p class="muted">Connect an exchange above first. Tip: Alpaca's free paper account is a perfect final rehearsal before real money.</p>`;
    return;
  }
  el.innerHTML = `<p class="muted">Kestrel trades only the budget you set here, never anything else in the account. You can go back to practice any time.</p>
    <div class="form"><label>Account <select id="liveConn">${options}</select></label>
    <label>Budget Kestrel may use <input id="liveBudget" type="number" min="20" step="10" value="200" /></label>
    <label>Largest single order <input id="liveMax" type="number" min="10" step="10" value="100" /></label>
    <label>Type <b>REAL MONEY</b> to confirm <input id="liveConfirm" type="text" autocomplete="off" placeholder="REAL MONEY" /></label>
    <div class="row"><button class="btn btn--danger" id="goLive"><span data-icon="shield"></span>Switch on real money</button><span id="liveMsg" class="small"></span></div></div>`;
  paintIcons(el);
  $("#goLive").onclick = async (e) => {
    const body = { connection: $("#liveConn").value, budget: Number($("#liveBudget").value), maxOrder: Number($("#liveMax").value), confirm: $("#liveConfirm").value };
    e.target.disabled = true;
    $("#liveMsg").textContent = "Checking the account…";
    try {
      await api("POST", "/api/live/enable", body);
      toast("Real money is on. Press Start on the Home page when you're ready.", "warning", 8000);
      location.hash = "#home";
    } catch (err) {
      $("#liveMsg").className = "small down";
      $("#liveMsg").textContent = err.message;
    } finally {
      e.target.disabled = false;
    }
  };
}

// ── settings tab ──
async function renderSettings() {
  const s = ui.state;
  if (!s || !ui.catalog) return;
  const v = await api("GET", "/api/voice/settings").catch(() => null);
  if (v) {
    $("#elKey").placeholder = v.hasKey ? `Saved (${v.keyHint})${v.fromEnv ? " from .env" : ""}` : "sk_…";
    $("#elAgent").value = v.agentId || "";
  }
  $("#practiceVenue").innerHTML = ui.catalog.practiceSources.map((p) => `<option value="${p.id}" ${p.id === s.practiceVenue ? "selected" : ""}>${esc(p.name)} (fees ${(p.fees.maker * 100).toFixed(2)}% / ${(p.fees.taker * 100).toFixed(2)}%)</option>`).join("");
  $("#patient").checked = !!s.settings.patientOrders;
  $("#patientSeconds").value = s.settings.patientSeconds;
  $("#tfCrypto").value = s.timeframes.crypto;
  $("#tfStock").value = s.timeframes.stock;
}

$("#voiceForm2").onsubmit = async (e) => {
  e.preventDefault();
  const body = { agentId: $("#elAgent").value };
  if ($("#elKey").value) body.apiKey = $("#elKey").value;
  $("#elMsg").textContent = "Checking…";
  try {
    const r = await api("POST", "/api/voice/settings", body);
    $("#elMsg").textContent = r.message;
    $("#elKey").value = "";
    renderSettings();
  } catch (err) {
    $("#elMsg").textContent = err.message;
  }
};
$("#practiceVenue").onchange = (e) => act(() => api("POST", "/api/settings", { practiceVenue: e.target.value }), { ok: "Practice prices updated." });
$("#practiceReset").onclick = async () => {
  const cash = Number($("#practiceCash").value) || 10000;
  if (await confirmDialog({ title: "Reset the practice account?", body: `This clears practice trades and starts again with ${money(cash, { digits: 0 })} of pretend money.`, ok: "Reset", danger: true })) await act(() => api("POST", "/api/practice/reset", { cash }), { ok: "Practice account reset." });
};
$("#orderForm").onsubmit = (e) => {
  e.preventDefault();
  act(() => api("POST", "/api/settings", { patientOrders: $("#patient").checked, patientSeconds: Number($("#patientSeconds").value), timeframes: { crypto: $("#tfCrypto").value, stock: $("#tfStock").value } }), { ok: "Saved." });
};

// ── voice ──
const voice = createVoice(ui);
for (const b of [$("#talkTop"), $("#voiceFab")]) b.onclick = () => voice.open();

// ── boot ──
paintIcons();
// Pages other than Home need both the state and the catalog before they can draw; draw the
// current page again the first time both are in, whichever arrives last.
let isBooted = false;
function booted() {
  if (isBooted || !ui.state || !ui.catalog) return;
  isBooted = true;
  route();
}
api("GET", "/api/catalog")
  .then((c) => {
    ui.catalog = c;
    maybeWizard();
    booted();
  })
  .catch(() => {});
connectStream();
route();
setInterval(() => ui.tab === "home" && ui.state && renderControls(), 30_000);
