// Talking to Kestrel: an ElevenLabs agent whose "client tools" run here in the browser and call
// Kestrel's local API, so the agent can see and do everything the dashboard can (within the
// safety rules), while your keys and your account never leave this computer.
//
// The agent is kept up to date as things happen: a full briefing when the conversation starts,
// then a short note for every trade, stop, safety event, signal change, finished test and screen
// you open.
import { icon, paintIcons } from "./icons.js";

const QUICK = ["How am I doing?", "Why did you make the last trade?", "What's the riskiest thing right now?", "Test Ethereum over the last year", "What would you buy right now?", "Pause trading"];

const TOOL_LABELS = {
  get_overview: "Checking the dashboard",
  get_positions: "Looking at holdings",
  get_trades: "Reading the trade history",
  get_activity: "Reading recent activity",
  get_market: "Reading the market",
  explain_decision: "Working out why",
  run_backtest: "Running a test on history",
  get_backtest: "Checking the test",
  control_bot: "Controlling the bot",
  set_risk: "Changing the risk level",
  manage_markets: "Updating markets",
  place_order: "Preparing the order",
  get_setup: "Checking connections",
  show_on_screen: "Showing it on screen",
};

function loadSdk() {
  if (window.ElevenLabsClient) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/elevenlabs-client.js";
    s.onload = () => (window.ElevenLabsClient ? resolve() : reject(new Error("The voice library didn't load. Run npm install in the kestrel folder.")));
    s.onerror = () => reject(new Error("The voice library is missing. Run npm install in the kestrel folder."));
    document.head.appendChild(s);
  });
}

export function friendlyError(msg) {
  const m = String(msg || "");
  if (/Client tool with name \S+ is not defined/i.test(m)) return "This copy of Kestrel is older than the voice assistant. Get the newest Kestrel, then start it again.";
  if (/permission|NotAllowed|denied/i.test(m)) return "Microphone access was blocked. Allow the microphone for this page in your browser, or type instead.";
  if (/NotFound|Requested device not found/i.test(m)) return "No microphone found. You can still type to Kestrel.";
  if (/401|403|auth/i.test(m)) return "ElevenLabs didn't accept the session. Check your API key in Settings.";
  if (/trying to reach is not available|quota/i.test(m)) return "ElevenLabs wouldn't start the conversation. The usual reason is that the account's credits for this month are used up.";
  if (/closed unexpectedly|before session|non-101|WebSocket/i.test(m)) return "Couldn't open a live connection to ElevenLabs. Check this computer's internet connection (some office, school or VPN networks block live connections), then try again.";
  return m.length < 180 ? m : "Couldn't reach the voice service. Check the internet connection and try again.";
}

export function createVoice(ui) {
  const $ = (s) => document.querySelector(s);
  const els = { panel: $("#voice"), log: $("#voiceLog"), status: $("#voiceStatus"), orb: $("#orb"), notice: $("#voiceNotice"), quick: $("#voiceQuick"), talk: $("#voiceTalk"), form: $("#voiceForm"), text: $("#voiceText"), mute: $("#voiceMute"), end: $("#voiceEnd"), close: $("#voiceClose"), fab: $("#voiceFab") };
  let conv = null;
  let mode = null; // "voice" | "text"
  let status = "idle"; // idle | connecting | connected
  let speaking = false;
  let muted = false;
  let pendingText = null;
  let lines = 0;
  let raf = 0;
  let lastScreen = "";

  // ── transcript ──
  function add(role, text, { html = false } = {}) {
    if (!lines) els.log.innerHTML = "";
    lines++;
    const el = document.createElement("div");
    el.className = `msg msg--${role}`;
    if (html) el.innerHTML = text;
    else el.textContent = text;
    els.log.appendChild(el);
    els.log.scrollTo({ top: els.log.scrollHeight, behavior: "smooth" });
    return el;
  }
  const toolLine = (name) => add("tool", `${icon("bolt", 12)}<span>${ui.esc(TOOL_LABELS[name] || name)}…</span>`, { html: true });

  function notice(text) {
    els.notice.hidden = !text;
    els.notice.innerHTML = text ? `${ui.esc(text)}${/API key|Settings/.test(text) ? ` <a href="#settings">Open Settings</a>` : ""}` : "";
  }

  function render() {
    els.status.textContent = status === "connected" ? (mode === "voice" ? (speaking ? "Speaking…" : muted ? "Muted" : "Listening…") : "Chatting (typed)") : status === "connecting" ? "Connecting…" : "Not connected";
    els.orb.className = `orb ${status === "connected" ? (speaking ? "speaking" : "live") : ""}`;
    els.talk.innerHTML = status === "connected" && mode === "voice" ? `${icon("phoneOff", 18)}<span>End the call</span>` : status === "connecting" ? `<span>Connecting…</span>` : `${icon("mic", 18)}<span>${status === "connected" ? "Switch to voice" : "Start talking"}</span>`;
    els.talk.className = `btn btn--wide ${status === "connected" && mode === "voice" ? "" : "btn--accent"}`;
    els.talk.disabled = status === "connecting";
    els.mute.hidden = !(status === "connected" && mode === "voice");
    els.mute.classList.toggle("on", muted);
    els.end.hidden = status !== "connected";
    els.fab.classList.toggle("hide", els.panel.classList.contains("is-open"));
  }

  function animate() {
    cancelAnimationFrame(raf);
    const loop = () => {
      if (!conv || status !== "connected") return;
      try {
        const lvl = speaking ? conv.getOutputVolume?.() ?? 0 : conv.getInputVolume?.() ?? 0;
        els.orb.style.setProperty("--lvl", Math.min(1, lvl * 2.2).toFixed(3));
        els.orb.style.transform = `scale(${1 + Math.min(0.18, lvl * 0.5)})`;
      } catch {
        /* volume isn't available in text chat */
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  // ── what the agent is told ──
  function send(text) {
    if (conv && status === "connected") {
      try {
        conv.sendContextualUpdate(text);
      } catch {
        /* the conversation is closing */
      }
    }
  }

  function screenText(tab, symbol) {
    const names = { home: "the Home dashboard", test: "the Test page (backtests)", connect: "the Connect page (exchanges and real money)", settings: "Settings" };
    const m = ui.state?.markets.find((x) => x.symbol === symbol);
    return `The person is looking at ${names[tab] || tab}${tab === "home" && m ? `, with the ${m.name} chart selected` : ""}.`;
  }

  async function sendBriefing() {
    try {
      const b = await ui.api("GET", "/api/briefing");
      send(`[Live state of the app right now]\n${b.text}\n${screenText(ui.tab, ui.selected)}\nTimes are UTC: ${new Date().toISOString()}.`);
    } catch {
      /* the tools still work */
    }
  }

  // ── the agent's tools ──
  const SERVER_TOOLS = ["get_overview", "get_positions", "get_trades", "get_activity", "get_market", "explain_decision", "run_backtest", "get_backtest", "control_bot", "set_risk", "manage_markets", "place_order", "get_setup"];
  const tools = {};
  for (const name of SERVER_TOOLS) {
    tools[name] = async (params) => {
      toolLine(name);
      try {
        const r = await ui.api("POST", "/api/agent/tool", { name, params: params || {} });
        afterTool(name, params, r);
        return JSON.stringify(r);
      } catch (e) {
        return JSON.stringify({ ok: false, error: e.data?.error || e.message });
      }
    };
  }
  tools.show_on_screen = async ({ view = "home", symbol } = {}) => {
    toolLine("show_on_screen");
    const tab = ["home", "test", "connect", "settings"].includes(view) ? view : "home";
    if (symbol) {
      const m = ui.state?.markets.find((x) => x.symbol.toLowerCase() === String(symbol).toLowerCase() || x.name.toLowerCase() === String(symbol).toLowerCase() || x.symbol.split("/")[0].toLowerCase() === String(symbol).toLowerCase());
      if (m) ui.selected = m.symbol;
    }
    if (location.hash !== `#${tab}`) location.hash = `#${tab}`;
    else window.dispatchEvent(new HashChangeEvent("hashchange"));
    return JSON.stringify({ ok: true, showing: tab, selected: ui.selected });
  };

  function afterTool(name, params, r) {
    // Keep the screen in step with what the agent is talking about.
    if ((name === "get_market" || name === "explain_decision") && r?.symbol && ui.state?.markets.some((m) => m.symbol === r.symbol)) {
      ui.selected = r.symbol;
      if (ui.tab === "home") window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    if (name === "run_backtest" && r?.status === "done") {
      lastScreen = "";
    }
  }

  // ── conversation lifecycle ──
  async function begin(nextMode) {
    if (status !== "idle") return;
    notice(null);
    status = "connecting";
    render();
    try {
      await loadSdk();
      const r = await ui.api("POST", nextMode === "text" ? "/api/voice/text-session" : "/api/voice/session").catch((e) => e.data || { ok: false, message: e.message });
      if (!r.ok) {
        status = "idle";
        render();
        notice(r.message || "Couldn't start the conversation.");
        if (pendingText) {
          add("system", "Not sent: the voice assistant isn't set up yet.");
          pendingText = null;
        }
        return;
      }
      mode = nextMode;
      const auth = r.auth.conversationToken ? { conversationToken: r.auth.conversationToken, connectionType: "webrtc" } : { signedUrl: r.auth.signedUrl, connectionType: "websocket" };
      await window.ElevenLabsClient.Conversation.startSession({
        ...auth,
        textOnly: nextMode === "text",
        clientTools: tools,
        onConversationCreated: (c) => {
          conv = c;
        },
        onConnect: () => {
          status = "connected";
          render();
          add("system", nextMode === "voice" ? "Connected. Start talking." : "Connected.");
          sendBriefing().then(() => {
            if (pendingText) {
              const t = pendingText;
              pendingText = null;
              conv?.sendUserMessage(t);
            }
          });
          animate();
        },
        onDisconnect: () => {
          status = "idle";
          conv = null;
          mode = null;
          speaking = false;
          muted = false;
          add("system", "Conversation ended.");
          render();
        },
        onMessage: ({ message, role }) => {
          if (!message?.trim()) return;
          if (role === "user") {
            const last = els.log.lastElementChild;
            if (last?.classList.contains("msg--user") && last.textContent === message) return;
            add("user", message);
          } else add("agent", message);
        },
        onModeChange: ({ mode: m }) => {
          speaking = m === "speaking";
          render();
        },
        onError: (msg) => {
          console.warn("[kestrel voice]", msg);
          notice(friendlyError(msg));
        },
      });
    } catch (err) {
      status = "idle";
      conv = null;
      render();
      notice(friendlyError(err?.message || err));
    }
  }

  async function end() {
    try {
      await conv?.endSession();
    } catch {
      /* already closed */
    }
  }

  async function say(text) {
    const t = text.trim();
    if (!t) return;
    open();
    if (status === "connected" && conv) {
      add("user", t);
      conv.sendUserMessage(t);
      return;
    }
    add("user", t);
    pendingText = t;
    await begin("text");
  }

  function open() {
    els.panel.classList.add("is-open");
    render();
    if (!els.quick.childElementCount) {
      els.quick.innerHTML = QUICK.map((q) => `<button type="button">${ui.esc(q)}</button>`).join("");
      for (const b of els.quick.querySelectorAll("button")) b.onclick = () => say(b.textContent);
    }
  }

  // ── wiring ──
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const t = els.text.value;
    els.text.value = "";
    say(t);
  });
  els.talk.onclick = async () => {
    if (status === "connected" && mode === "voice") return end();
    if (status === "connected") await end();
    await new Promise((r) => setTimeout(r, status === "idle" ? 0 : 400));
    begin("voice");
  };
  els.mute.onclick = () => {
    muted = !muted;
    conv?.setMicMuted(muted);
    render();
  };
  els.end.onclick = end;
  els.close.onclick = () => {
    els.panel.classList.remove("is-open");
    render();
  };
  paintIcons(els.panel);
  render();

  return {
    open,
    say,
    sendContext: send,
    /** New activity in the app: the agent hears about it straight away. */
    onActivity(ev) {
      if (!["trade", "breaker", "daily-limit", "error", "paused", "signal", "start", "pause", "sell-all", "mode", "connect", "settings", "resumed", "warning"].includes(ev.type)) return;
      send(`[Live update from the app, ${new Date(ev.t).toISOString()}] ${ev.text}`);
    },
    onNavigate(tab, symbol) {
      const text = screenText(tab, symbol);
      if (text === lastScreen) return;
      lastScreen = text;
      send(`[Screen] ${text}`);
    },
    onBacktest(job) {
      if (job.status === "done") send(`[Live update] The backtest (job ${job.id}) finished. Call get_backtest with that job id for the results.`);
      else if (job.status === "error") send(`[Live update] The backtest (job ${job.id}) failed: ${job.error}`);
    },
  };
}
