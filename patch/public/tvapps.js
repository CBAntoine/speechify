// The TV app maker in the dashboard: your TV apps, making and changing them (photos come from this
// phone or computer), a live preview, and putting them on your TVs. Claude can also build an app
// from a description, and change it when asked; its progress shows here as it works.
import { icon } from "./icons.js";

const COLORS = ["#5b6cff", "#ff7a59", "#2ec4b6", "#e84393", "#f4a261", "#43aa8b", "#9b5de5", "#00a6fb", "#ef476f", "#118ab2"];
const CLAUDE_EMOJI = ["✨", "🎮", "🐍", "🧩", "📋", "🎨", "🧠", "🚀"];
const EMOJI = { videos: ["🎬", "📺", "🍿", "🎵", "👶", "🍳"], photos: ["🖼️", "📷", "🏖️", "👨‍👩‍👧", "🐶", "🎄"], clock: ["🕰️", "☀️", "🌦️", "⏰"], notes: ["📝", "📌", "🏠", "❤️"], countdown: ["⏳", "🎄", "🎂", "✈️", "🎃"], radio: ["📻", "🎶", "🎧", "🎙️"], shortcuts: ["🧩", "⭐", "👵", "🧸"], quiz: ["❓", "🧠", "🏆", "🎲"], website: ["🌐", "📰", "🍲", "⚽"], custom: ["💻", "✨", "🚀", "🎨"] };

export function createTvApps(ui) {
  const { api, esc, toast, BOOT } = ui;
  const $ = (s, el = document) => el.querySelector(s);
  let apps = [];
  let kinds = [];
  let editing = null; // { id?, kind, ... } while the maker is open
  let pendingPhotos = []; // { file, url } chosen before the app exists

  const tvs = () => ui.state.devices.filter((d) => !d.hidden && (d.driver === "androidtv" || ((d.driver === "samsung" || d.driver === "lgwebos") && d.kind === "tv")));
  const ready = (d) => !d.setup && d.online !== false;
  const claudeOn = () => !!ui.state.setup?.claude;
  // Where an app Claude builds can go: the TVs, and this phone or computer (in its browser).
  const targets = () => [...tvs(), ...ui.state.devices.filter((d) => d.self && d.actions?.includes("open_website"))];
  let ticker = null;

  /** A short name from a description, as Patch's server makes one ("a snake game for the kids" → "Snake game"). */
  function nameFrom(text) {
    const skip = /^(a|an|the|make|build|create|write|me|us|my|our|please|app|for|that|which|with)$/i;
    const words = String(text).replace(/[\x21-\x26\x28-\x2c\x2e\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u00a1-\u00bf\u2000-\u206f\u3000-\u303f]+/g, " ").split(/\s+/).filter(Boolean);
    while (words.length && skip.test(words[0])) words.shift();
    const cut = words.findIndex((w, i) => i > 0 && skip.test(w));
    const name = (cut > 0 ? words.slice(0, cut) : words).slice(0, 3).join(" ");
    return name ? name[0].toUpperCase() + name.slice(1, 40) : "New app";
  }
  const kindOf = (k) => kinds.find((x) => x.id === k) || { id: k, label: k, emoji: "📺", about: "" };

  async function load() {
    try {
      const r = await api("GET", "/api/tvapps");
      apps = r.apps || [];
      kinds = r.kinds || [];
    } catch {
      /* shown next time */
    }
    render();
  }

  function set(list) {
    apps = list || [];
    render();
    if (editing?.id && $("#modal.is-open .tvmaker")) {
      const a = apps.find((x) => x.id === editing.id);
      if (!a) return ui.closeOverlays();
      const where = $("#tvWhere");
      if (where) where.innerHTML = whereHtml(a);
      // Claude's progress, and the new version once it's done.
      const key = `${a.version}|${a.job?.status}|${a.job?.phase}|${a.job?.kb}`;
      if (key !== editing.jobKey) {
        const box = $("#tvJob");
        if (box) box.innerHTML = claudeBox(a);
        if (a.version !== editing.version) {
          const frame = $("#tvPrev iframe");
          if (frame) frame.src = previewUrl(a);
          const tvBox = $(".tvmaker__tvs");
          if (tvBox && a.built) tvBox.innerHTML = `<h3>Put it on a TV</h3>${tvButtons(a)}`;
        }
        editing.jobKey = key;
        editing.version = a.version;
      }
    }
  }

  /** Claude finished (or couldn't): say so, and show the result. */
  function built(r) {
    toast(r.message, r.ok ? "ok" : "bad");
    load();
  }

  // ── The "TV apps" section on the dashboard ─────────────────────────────

  function whereHtml(a) {
    if (!a.built) return a.job?.status === "failed" ? "Not built" : "Being built";
    if (!a.tvs.length) return "Not on a TV yet";
    return a.tvs.map((t) => `${t.how === "browser" ? "Opens on" : "On"} ${esc(t.name)}${t.upToDate ? "" : " (needs the new version)"}`).join(" · ");
  }

  // What Claude is doing with an app: planning, writing (and how much), installing, or what went wrong.
  function jobHtml(a) {
    const j = a.job;
    if (!j) return "";
    if (j.status === "failed") {
      return `<div class="tvjob is-bad">${icon("alert", 15)}<span>${esc(j.error || "That didn't work.")}</span><span class="tvjob__btns"><button type="button" class="btn btn--sm" data-tv="retry" data-app="${esc(a.id)}">Try again</button><button type="button" class="btn btn--sm btn--ghost" data-tv="cancel" data-app="${esc(a.id)}">${a.built ? "Dismiss" : "Remove"}</button></span></div>`;
    }
    const doing = j.phase === "installing" ? "Putting it on the TV" : j.phase === "writing" ? `Claude is writing it (${j.kb} KB so far)` : j.phase === "thinking" ? `Claude is planning ${j.kind === "change" ? "the change" : "it"}` : "Asking Claude";
    return `<div class="tvjob" aria-live="polite"><span class="tvjob__spin" aria-hidden="true"></span><span>${doing}… <small data-job-since="${Number(j.started) || 0}">${since(j.started)}</small></span>${j.phase === "installing" ? "" : `<span class="tvjob__btns"><button type="button" class="btn btn--sm btn--ghost" data-tv="cancel" data-app="${esc(a.id)}">Stop</button></span>`}</div>`;
  }

  function since(t) {
    const s = Math.max(0, Math.floor((Date.now() - (Number(t) || Date.now())) / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  }

  // While Claude works, the times count up without redrawing anything else.
  function tick() {
    const busy = apps.some((a) => a.job && a.job.status !== "failed");
    if (busy && !ticker) ticker = setInterval(() => document.querySelectorAll("[data-job-since]").forEach((el) => (el.textContent = since(el.dataset.jobSince))), 1000);
    if (!busy && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function render() {
    const host = $("#tvapps");
    if (!host) return;
    const show = apps.length || tvs().length;
    host.hidden = !show;
    tick();
    if (!show) return;
    const cards = apps
      .map(
        (a) => `<article class="tvapp">
          <button class="tvapp__art" style="--c:${esc(a.color)}" data-tv="edit" data-app="${esc(a.id)}" aria-label="Change ${esc(a.name)}">${esc(a.emoji)}</button>
          <div class="tvapp__text"><strong>${esc(a.name)}</strong><span>${esc(a.kindLabel)}${a.summary ? ` · ${esc(a.summary)}` : ""}</span><span class="tvapp__where">${whereHtml(a)}</span></div>
          ${a.job ? jobHtml(a) : ""}
          <div class="tvapp__actions">${a.built ? `<button class="btn btn--sm btn--primary" data-tv="put" data-app="${esc(a.id)}">${icon("tv", 14)} ${a.tvs.length ? "Open on TV" : "Put on TV"}</button>` : ""}<button class="btn btn--sm" data-tv="edit" data-app="${esc(a.id)}">${a.built ? "Change" : "Details"}</button></div>
        </article>`,
      )
      .join("");
    host.innerHTML = `<div class="tvapps__head"><div><h2>${icon("tv", 18)} TV apps</h2><p>${apps.length ? "Apps you made for your TVs." : "Make your own apps for your TVs: a photo frame, your own video channel, a clock with the weather, a quiz… or describe any app and Claude builds it."}</p></div><div class="btns"><button class="btn btn--sm btn--claude" data-tv="claude">✨ Build with Claude</button><button class="btn btn--sm btn--primary" data-tv="new">${icon("plus", 15)} Make a TV app</button></div></div>${apps.length ? `<div class="tvapps__list">${cards}</div>` : ""}`;
  }

  // ── Pictures for the TV's app list (drawn here, where emoji and fonts look right) ──

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c * (1 + k))));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  function art(w, h, { name, emoji, color }, banner) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, color);
    grad.addColorStop(1, shade(color, -0.5));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const glow = g.createRadialGradient(w * 0.25, h * 0.15, 0, w * 0.25, h * 0.15, Math.max(w, h) * 0.9);
    glow.addColorStop(0, "rgba(255,255,255,0.30)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glow;
    g.fillRect(0, 0, w, h);
    const emojiFont = (px) => `${px}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.textBaseline = "middle";
    if (!banner) {
      g.textAlign = "center";
      g.font = emojiFont(Math.round(w * 0.56));
      g.fillText(emoji || "📺", w / 2, h * 0.54);
    } else {
      g.textAlign = "center";
      g.font = emojiFont(Math.round(h * 0.5));
      g.fillText(emoji || "📺", h * 0.52, h * 0.53);
      g.textAlign = "left";
      g.fillStyle = "#fff";
      let size = Math.round(h * 0.2);
      const text = String(name || "").slice(0, 40);
      const room = w - h * 1.0 - 14;
      do g.font = `700 ${size}px system-ui,"Segoe UI",Roboto,sans-serif`;
      while (g.measureText(text).width > room && --size > 12);
      g.shadowColor = "rgba(0,0,0,0.35)";
      g.shadowBlur = 6;
      g.fillText(text, h * 1.0, h / 2);
    }
    return c.toDataURL("image/png");
  }

  const pictures = (look) => ({ icon: art(512, 512, look, false), banner: art(320, 180, look, true) });

  // ── Photos from this device, made the right size for a TV ──────────────

  async function resizePhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error(`${file.name} isn't a picture this browser can open.`));
        i.src = url;
      });
      const k = Math.min(1, 1920 / img.naturalWidth, 1080 / img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * k));
      c.height = Math.max(1, Math.round(img.naturalHeight * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return await new Promise((resolve) => c.toBlob(resolve, "image/jpeg", 0.86));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function upload(blob, name) {
    const res = await fetch(`/api/uploads?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "x-patch-token": BOOT.token, "content-type": blob.type || "application/octet-stream" }, body: blob });
    const r = await res.json().catch(() => ({ ok: false, message: `Patch answered ${res.status}` }));
    if (!r.ok) throw new Error(r.message);
    return r.upload;
  }

  async function addPhotos(appId, files) {
    const out = [];
    let n = 0;
    for (const f of files) {
      n++;
      setStatus(`Getting photo ${n} of ${files.length} ready…`);
      try {
        const blob = await resizePhoto(f);
        const up = await upload(blob, f.name.replace(/\.\w+$/, "") + ".jpg");
        out.push({ upload: up.id });
      } catch (err) {
        toast(err.message, "bad");
      }
    }
    if (!out.length) return null;
    setStatus("Adding the photos…");
    return api("POST", `/api/tvapps/${encodeURIComponent(appId)}/photos`, { files: out });
  }

  // ── The maker ──────────────────────────────────────────────────────────

  function setStatus(text, bad = false) {
    const s = $("#tvStatus");
    if (s) {
      s.textContent = text || "";
      s.classList.toggle("is-bad", !!bad);
    }
  }

  function openPicker() {
    editing = null;
    pendingPhotos = [];
    ui.openModal(
      "Make a TV app",
      `<div class="tvmaker"><p class="tvmaker__lead">What kind of app? You can change everything later.</p><div class="kind-grid"><button class="kind kind--claude" data-tv="claude"><span class="kind__emoji">✨</span><strong>Build with Claude</strong><span>Describe any app, like a game, a family board or a tool, and Claude writes all of it for you.</span></button>${kinds
        .map((k) => `<button class="kind" data-tv-kind="${esc(k.id)}"><span class="kind__emoji">${esc(k.emoji)}</span><strong>${esc(k.label)}</strong><span>${esc(k.about)}</span></button>`)
        .join("")}</div><p class="tvmaker__fine">${icon("info", 14)} On Android TV, Google TV and Fire TV your app is installed with its own icon. Samsung and LG TVs open it in their web browser.</p></div>`,
      { wide: true },
    );
  }

  const field = (label, html, hint = "") => `<label class="field"><span>${label}</span>${html}${hint ? `<small>${hint}</small>` : ""}</label>`;
  const lines = (list) => (list || []).join("\n");

  function contentFields(kind, s = {}, a = null) {
    switch (kind) {
      case "videos":
        return field("Videos", `<textarea name="content" rows="6" placeholder="One per line: YouTube links, playlist links, or links to video files">${esc((s.items || []).map((v) => (v.type === "youtube" ? `https://youtu.be/${v.id}` : v.type === "playlist" ? `https://www.youtube.com/playlist?list=${v.id}` : v.url)).join("\n"))}</textarea>`, "Patch finds each video's name. With a YouTube key in Settings you can also type what to search for.");
      case "photos":
        return `${field("Photos", `<div class="photo-pick">${(a?.photos || []).map((p) => `<span class="photo-thumb" style="background-image:url('${previewUrl(a, `photos/${p.name}`)}')"><button type="button" data-tv="photo-remove" data-name="${esc(p.name)}" aria-label="Remove this photo">${icon("close", 12)}</button></span>`).join("")}${pendingPhotos.map((p) => `<span class="photo-thumb" style="background-image:url('${p.url}')"></span>`).join("")}<label class="photo-add">${icon("plus", 18)}<span>Add photos</span><input type="file" accept="image/*" multiple data-tv="photos" hidden></label></div>`, `${(a?.photos?.length || 0) + pendingPhotos.length} photos. Patch makes each one TV-sized.`)}
          <div class="field-row">${field("New photo every", `<select name="interval">${[5, 8, 12, 20, 30, 60, 300].map((n) => `<option value="${n}" ${Number(s.interval || 8) === n ? "selected" : ""}>${n < 60 ? `${n} seconds` : `${n / 60} minute${n > 60 ? "s" : ""}`}</option>`).join("")}</select>`)}
          <label class="check"><input type="checkbox" name="clock" ${s.clock !== false ? "checked" : ""}> Show the time</label><label class="check"><input type="checkbox" name="shuffle" ${s.shuffle ? "checked" : ""}> Shuffle</label></div>`;
      case "clock":
        return `${field("Where for the weather", `<input name="place" value="${esc(s.placeAsked || s.place || "")}" placeholder="Town or city, e.g. Portland">`, s.place ? `Now: ${esc(s.place)}` : "Leave empty for just the time.")}
          <div class="field-row">${field("Temperature", `<select name="units"><option value="">Usual for there</option><option value="C" ${s.units === "C" ? "selected" : ""}>°C</option><option value="F" ${s.units === "F" ? "selected" : ""}>°F</option></select>`)}${field("Clock", `<select name="hours"><option value="">Usual for there</option><option value="12" ${s.hours === 12 ? "selected" : ""}>12-hour</option><option value="24" ${s.hours === 24 ? "selected" : ""}>24-hour</option></select>`)}</div>`;
      case "notes":
        return `${field("Title (optional)", `<input name="title" value="${esc(s.title || "")}" placeholder="e.g. This week">`)}${field("Notes", `<textarea name="content" rows="6" placeholder="One note per line">${esc(lines(s.notes))}</textarea>`)}`;
      case "countdown":
        return `${field("Counting down to", `<input name="title" value="${esc(s.title || "")}" placeholder="e.g. Our holiday">`)}<div class="field-row">${field("Date", `<input type="date" name="date" value="${esc((s.date || "").slice(0, 10))}" required>`)}${field("Time", `<input type="time" name="time" value="${esc((s.date || "").slice(11, 16) || "")}">`)}</div>${field("When it's here, say", `<input name="done" value="${esc(s.done || "")}" placeholder="It's here!">`)}`;
      case "radio":
        return field("Stations", `<textarea name="content" rows="5" placeholder="One per line: a station's name (KEXP, BBC Radio 2…) or a stream link">${esc((s.stations || []).map((x) => x.name).join("\n"))}</textarea>`, a ? "Type the stations again to change them." : "Patch looks each one up in the free Radio Browser directory.");
      case "shortcuts":
        return field("Apps to show", `<textarea name="content" rows="5" placeholder="One per line, e.g. Netflix, YouTube, BBC iPlayer">${esc((s.apps || []).map((x) => x.name).join("\n"))}</textarea>`, "Leave it empty to show all the TV's apps. Works on Android TV and Fire TV.");
      case "quiz":
        return field("Questions", `<textarea name="content" rows="7" placeholder="One per line: question | right answer | wrong answer | wrong answer">${esc((s.questions || []).map((q) => [q.q, ...q.answers].join(" | ")).join("\n"))}</textarea>`, "Or ask Patch to write the questions for you: “make a 90s music quiz”.");
      case "website":
        return field("Website", `<input name="content" value="${esc(s.url || "")}" placeholder="e.g. bbc.co.uk" inputmode="url" required>`, "On Android TV and Fire TV it opens full screen with a pointer you move with the remote.");
      default:
        if (a && (a.madeBy === "claude" || claudeOn())) {
          return `<div class="claude-box" id="tvJob">${claudeBox(a)}</div>
            <details class="code-details"><summary>Or replace its code yourself</summary>${field("The app's HTML", `<textarea name="content" rows="8" class="code" placeholder="<!doctype html>…"></textarea>`, "Leave it empty to keep what's there.")}</details>`;
        }
        return field("Your app's HTML", `<textarea name="content" rows="10" class="code" placeholder="<!doctype html>…">${a ? "" : ""}</textarea>`, a ? "Leave it empty to keep the current page." : "A single page. It should work with the arrow keys and Enter (the remote).");
    }
  }

  /** For an app Claude built: what it does, what's happening, and a box to ask Claude for a change. */
  function claudeBox(a) {
    if (a.job && a.job.status !== "failed") return jobHtml(a);
    const cost = a.lastBuild?.cost;
    return `${a.about ? `<p class="claude-about">${esc(a.about)}</p>` : ""}
      ${a.job ? jobHtml(a) : ""}
      ${a.built ? `${field("Ask Claude to change it", `<textarea name="instruction" rows="3" placeholder="e.g. make it faster, add a pause button, use bigger letters"></textarea>`, claudeOn() ? "Claude rewrites the app with your change, then Patch updates it on your TVs." : "Add your Anthropic API key in Settings → Claude to ask for changes.")}
      <div class="btns"><button type="button" class="btn btn--sm btn--claude" data-tv="improve" data-app="${esc(a.id)}" ${claudeOn() ? "" : "disabled"}>✨ Ask Claude</button></div>` : ""}
      ${a.requests?.length ? `<details class="claude-asked"><summary>What you've asked Claude for (${a.requests.length})</summary><ol>${a.requests.map((t) => `<li>${esc(t)}</li>`).join("")}</ol></details>` : ""}
      ${cost ? `<p class="tvmaker__fine">${icon("info", 14)} The last ${a.lastBuild.kind === "change" ? "change" : "build"} cost about $${Number(cost.dollars).toFixed(2)} (${Math.round((cost.inputTokens + cost.outputTokens) / 1000)}k tokens).</p>` : ""}`;
  }

  // ── Build with Claude ──────────────────────────────────────────────────

  function openClaude() {
    editing = { kind: "claude", emoji: "✨", color: COLORS[apps.length % COLORS.length] };
    const list = targets();
    ui.openModal(
      "✨ Build with Claude",
      `<form class="tvmaker" data-tv-claude>
        <p class="tvmaker__lead">Describe the app you want, as you'd tell a friend. Claude writes all of it, then Patch puts it on your TV. It takes two to four minutes.</p>
        ${claudeOn() ? "" : `<p class="tvmaker__warn">${icon("info", 14)}<span>First add your Anthropic API key in <button type="button" class="linkish" data-ui="settings" data-focus="claude">Settings → Claude</button>.</span></p>`}
        ${field("What should it do?", `<textarea name="description" rows="5" required placeholder="A snake game for the kids with a high score… A chores board where we tick things off with the remote… A big clock with the weather in Leeds…"></textarea>`, "The more you say, the closer it gets. You can ask Claude to change it afterwards.")}
        <div class="field-row">${field("Name", `<input name="name" maxlength="40" placeholder="Optional">`)}${field("Picture", `<input name="emoji" value="✨" maxlength="8" class="emoji-in" aria-label="Emoji for the app">`)}</div>
        <div class="emoji-row">${CLAUDE_EMOJI.map((e) => `<button type="button" class="emoji-btn" data-tv="emoji" data-emoji="${esc(e)}">${esc(e)}</button>`).join("")}</div>
        <div class="swatches">${COLORS.map((c) => `<button type="button" class="swatch ${c === editing.color ? "is-on" : ""}" style="background:${c}" data-tv="color" data-color="${c}" aria-label="Colour ${c}"></button>`).join("")}</div>
        ${field("Put it on", `<select name="device">${list.map((d) => `<option value="${esc(d.id)}" ${ready(d) ? "" : "disabled"}>${esc(d.name)}${d.self ? " (in its browser)" : d.driver === "androidtv" ? "" : " (in its web browser)"}${ready(d) ? "" : " (not connected)"}</option>`).join("")}<option value="">Not yet: I'll choose later</option></select>`)}
        <p class="tvmaker__fine">${icon("info", 14)} Claude uses your Anthropic account. A build usually costs well under a dollar, and Patch shows what it cost.</p>
        <p class="tvmaker__status" id="tvStatus" role="status"></p>
        <div class="dialog-actions"><button class="btn btn--claude" ${claudeOn() ? "" : "disabled"}>✨ Build it</button></div>
      </form>`,
      { wide: true },
    );
    setTimeout(() => $("textarea[name=description]", $("#modal"))?.focus(), 60);
  }

  async function buildWithClaude(form) {
    const f = new FormData(form);
    const description = String(f.get("description") || "").trim();
    if (description.length < 3) return setStatus("Describe the app first.", true);
    const look = { name: String(f.get("name") || "").trim() || nameFrom(description), emoji: String(f.get("emoji") || "").trim() || "✨", color: editing.color };
    const button = $(".dialog-actions .btn", form);
    button.disabled = true;
    setStatus("Asking Claude…");
    const r = await api("POST", "/api/tvapps/build", { description, ...look, ...pictures(look), device: String(f.get("device") || "") || undefined }).catch((err) => ({ ok: false, message: err.message }));
    if (!r.ok) {
      setStatus(r.message, true);
      button.disabled = false;
      return;
    }
    toast(r.message);
    ui.voiceActivity?.(`The person asked Claude to build a TV app, “${r.app.name}”: ${description}`);
    ui.closeOverlays();
    await load();
    $("#tvapps")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function claudeAction(what, appId, body) {
    const r = await api("POST", `/api/tvapps/${encodeURIComponent(appId)}/${what}`, body || {}).catch((err) => ({ ok: false, message: err.message }));
    if ($("#tvStatus")) setStatus(r.message, !r.ok);
    toast(r.message, r.ok ? "ok" : "bad");
    await load();
    return r;
  }

  function previewUrl(a, file = "index.html") {
    return `/tvapp-preview/${encodeURIComponent(BOOT.tvPreview || "")}/${encodeURIComponent(a.id)}/${file}?v=${a.version}`;
  }

  function tvButtons(a) {
    const list = (a.madeBy === "claude" ? targets() : tvs()).filter((d) => !(a.kind === "shortcuts" && d.driver !== "androidtv"));
    if (!list.length) return `<p class="tvmaker__fine">${icon("info", 14)} I haven't found a TV that can take apps yet. Android TV, Google TV and Fire TV install them; Samsung and LG TVs open them. Scan for devices, then come back.</p>`;
    return `<div class="btns">${list
      .map((d) => {
        const on = a.tvs.find((t) => t.deviceId === d.id);
        const label = d.driver === "androidtv" ? (on ? (on.upToDate ? "Open on" : "Update on") : "Install on") : "Open on";
        return `<button class="btn btn--sm ${on?.upToDate ? "" : "btn--primary"}" data-tv="install" data-app="${esc(a.id)}" data-dev="${esc(d.id)}" ${ready(d) ? "" : "disabled"} title="${ready(d) ? "" : esc(d.setup?.message || "It isn't answering")}">${icon("tv", 14)} ${label} ${esc(d.name)}</button>`;
      })
      .join("")}</div>`;
  }

  function openForm(kind, a = null) {
    const k = kindOf(kind);
    editing = a ? { ...a, jobKey: `${a.version}|${a.job?.status}|${a.job?.phase}|${a.job?.kb}` } : { kind, name: k.label, emoji: (EMOJI[kind] || ["📺"])[0], color: COLORS[apps.length % COLORS.length] };
    const s = a?.settings || {};
    const look = editing;
    ui.openModal(
      a ? `Change “${esc(a.name)}”` : `${esc(k.emoji)} ${esc(k.label)}`,
      `<form class="tvmaker" data-tv-form="${esc(kind)}">
        ${a ? `${a.built ? `<div class="tvprev" id="tvPrev"><iframe sandbox="allow-scripts" src="${previewUrl(a)}" title="Preview of ${esc(a.name)}" tabindex="-1"></iframe></div>` : ""}<p class="tvmaker__where" id="tvWhere">${whereHtml(a)}</p>` : `<p class="tvmaker__lead">${esc(k.about)}</p>`}
        <div class="field-row">${field("Name", `<input name="name" value="${esc(look.name)}" maxlength="40" required>`)}${field("Picture", `<input name="emoji" value="${esc(look.emoji)}" maxlength="8" class="emoji-in" aria-label="Emoji for the app">`)}</div>
        <div class="emoji-row">${(a?.madeBy === "claude" ? CLAUDE_EMOJI : EMOJI[kind] || []).map((e) => `<button type="button" class="emoji-btn" data-tv="emoji" data-emoji="${esc(e)}">${esc(e)}</button>`).join("")}</div>
        <div class="swatches">${COLORS.map((c) => `<button type="button" class="swatch ${c === look.color ? "is-on" : ""}" style="background:${c}" data-tv="color" data-color="${c}" aria-label="Colour ${c}"></button>`).join("")}</div>
        ${contentFields(kind, s, a)}
        <p class="tvmaker__status" id="tvStatus" role="status"></p>
        <div class="dialog-actions">${a ? `<button type="button" class="btn btn--danger btn--sm" data-tv="delete" data-app="${esc(a.id)}">Delete</button>` : ""}<button class="btn btn--primary">${a ? "Save changes" : "Make it"}</button></div>
        ${a?.built ? `<div class="tvmaker__tvs"><h3>Put it on a TV</h3>${tvButtons(a)}</div>` : ""}
      </form>`,
      { wide: true },
    );
    fitPreview();
  }

  function fitPreview() {
    const box = $("#tvPrev");
    if (!box) return;
    const fit = () => box.style.setProperty("--s", String(box.clientWidth / 1280));
    fit();
    new ResizeObserver(fit).observe(box);
  }

  function readForm(form) {
    const f = new FormData(form);
    const kind = form.dataset.tvForm;
    const out = { name: String(f.get("name") || "").trim(), emoji: String(f.get("emoji") || "").trim() || editing.emoji, color: editing.color, kind };
    const content = f.get("content");
    switch (kind) {
      case "photos":
        out.settings = { interval: Number(f.get("interval")) || 8, clock: f.get("clock") === "on", shuffle: f.get("shuffle") === "on" };
        break;
      case "clock":
        out.settings = { place: String(f.get("place") || "").trim(), ...(f.get("units") ? { units: f.get("units") } : {}), ...(f.get("hours") ? { hours: Number(f.get("hours")) } : {}) };
        break;
      case "notes":
        out.settings = { title: String(f.get("title") || ""), notes: String(content || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean) };
        break;
      case "countdown":
        out.settings = { title: String(f.get("title") || ""), date: `${f.get("date")}${f.get("time") ? `T${f.get("time")}` : ""}`, done: String(f.get("done") || "") };
        break;
      case "custom":
        if (String(content || "").trim()) out.content = String(content);
        break;
      default:
        out.content = String(content ?? "");
    }
    return out;
  }

  async function save(form) {
    const input = readForm(form);
    const button = $(".dialog-actions .btn--primary", form);
    button.disabled = true;
    setStatus(editing?.id ? "Saving…" : "Making your app…");
    try {
      const look = { name: input.name, emoji: input.emoji, color: input.color };
      const lookChanged = !editing?.id || look.name !== editing.name || look.emoji !== editing.emoji || look.color !== editing.color;
      const body = { ...input, ...(lookChanged ? pictures(look) : {}) };
      let r = editing?.id ? await api("POST", `/api/tvapps/${encodeURIComponent(editing.id)}`, body) : await api("POST", "/api/tvapps", body);
      if (!r.ok) {
        setStatus(r.message, true);
        button.disabled = false;
        return;
      }
      if (pendingPhotos.length) {
        const p = await addPhotos(r.app.id, pendingPhotos.map((x) => x.file));
        if (p?.ok) r = { ...p, message: `${r.message} ${p.message}` };
        pendingPhotos.forEach((x) => URL.revokeObjectURL(x.url));
        pendingPhotos = [];
      }
      toast(r.message);
      await load();
      openForm(r.app.kind, apps.find((x) => x.id === r.app.id) || r.app);
      setStatus(r.app.tvs.length ? "Saved. Put it on the TV again to send this version." : "Done. Put it on a TV below.");
    } catch (err) {
      setStatus(err.message, true);
      button.disabled = false;
    }
  }

  async function install(appId, deviceId) {
    setStatus("Putting it on the TV… (installing takes a few seconds)");
    const r = await api("POST", `/api/tvapps/${encodeURIComponent(appId)}/${apps.find((a) => a.id === appId)?.tvs.some((t) => t.deviceId === deviceId && t.upToDate) ? "open" : "tv"}`, { device: deviceId }).catch((err) => ({ ok: false, message: err.message }));
    setStatus(r.message, !r.ok);
    toast(r.message, r.ok ? "ok" : "bad");
    if (r.ok) ui.voiceActivity?.(`The person put the TV app “${r.app?.name}” on a TV: ${r.message}`);
    await load();
    const a = apps.find((x) => x.id === appId);
    const tvBox = $(".tvmaker__tvs");
    if (a && tvBox) tvBox.innerHTML = `<h3>Put it on a TV</h3>${tvButtons(a)}`;
  }

  async function put(appId) {
    const a = apps.find((x) => x.id === appId);
    if (!a) return;
    const list = tvs().filter(ready);
    if (list.length === 1) {
      toast(`Putting “${a.name}” on ${list[0].name}…`);
      const r = await api("POST", `/api/tvapps/${encodeURIComponent(appId)}/${a.tvs.some((t) => t.deviceId === list[0].id && t.upToDate) ? "open" : "tv"}`, { device: list[0].id }).catch((err) => ({ ok: false, message: err.message }));
      toast(r.message, r.ok ? "ok" : "bad");
      await load();
      return;
    }
    openForm(a.kind, a);
  }

  // ── Events ─────────────────────────────────────────────────────────────

  document.addEventListener("click", async (e) => {
    const k = e.target.closest("[data-tv-kind]");
    if (k) {
      e.preventDefault();
      openForm(k.dataset.tvKind);
      return;
    }
    const t = e.target.closest("[data-tv]");
    if (!t || t.tagName === "INPUT") return;
    const what = t.dataset.tv;
    if (what === "new") {
      e.preventDefault();
      if (!kinds.length) await load();
      openPicker();
    } else if (what === "claude") {
      e.preventDefault();
      openClaude();
    } else if (what === "improve") {
      e.preventDefault();
      const box = t.closest("form");
      const instruction = String(box?.elements.instruction?.value || "").trim();
      if (!instruction) return setStatus("Say what Claude should change first.", true);
      t.disabled = true;
      const r = await claudeAction("improve", t.dataset.app, { instruction });
      if (r.ok) ui.voiceActivity?.(`The person asked Claude to change the TV app “${r.app.name}”: ${instruction}`);
      else t.disabled = false;
    } else if (what === "retry") {
      e.preventDefault();
      t.disabled = true;
      await claudeAction("retry", t.dataset.app);
    } else if (what === "cancel") {
      e.preventDefault();
      t.disabled = true;
      await claudeAction("cancel", t.dataset.app);
    } else if (what === "edit") {
      e.preventDefault();
      const a = apps.find((x) => x.id === t.dataset.app);
      if (a) openForm(a.kind, a);
    } else if (what === "put") {
      e.preventDefault();
      put(t.dataset.app);
    } else if (what === "install") {
      e.preventDefault();
      t.disabled = true;
      await install(t.dataset.app, t.dataset.dev);
    } else if (what === "emoji") {
      e.preventDefault();
      $(".emoji-in").value = t.dataset.emoji;
    } else if (what === "color") {
      e.preventDefault();
      editing.color = t.dataset.color;
      document.querySelectorAll(".swatch.is-on").forEach((x) => x.classList.remove("is-on"));
      t.classList.add("is-on");
    } else if (what === "photo-remove") {
      e.preventDefault();
      const r = await api("POST", `/api/tvapps/${encodeURIComponent(editing.id)}/photos/remove`, { name: t.dataset.name });
      if (r.ok) {
        await load();
        openForm("photos", apps.find((x) => x.id === editing.id));
      } else toast(r.message, "bad");
    } else if (what === "delete") {
      e.preventDefault();
      const a = apps.find((x) => x.id === t.dataset.app);
      const ok = await ui.confirmDialog({ title: `Delete “${a?.name}”?`, body: `It's removed from Patch${a?.tvs.some((x) => x.how === "app") ? " and from the TVs it's installed on" : ""}.${a?.kind === "photos" ? " The photos in it are deleted too (the originals on your phone stay)." : ""}`, confirm: "Delete" });
      if (!ok) return;
      const r = await api("POST", `/api/tvapps/${encodeURIComponent(t.dataset.app)}/remove`, {});
      toast(r.message, r.ok ? "ok" : "bad");
      ui.closeOverlays();
      await load();
    }
  });

  document.addEventListener("change", async (e) => {
    if (e.target.dataset?.tv !== "photos") return;
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    if (editing?.id) {
      const r = await addPhotos(editing.id, files);
      if (r) {
        toast(r.message, r.ok ? "ok" : "bad");
        await load();
        openForm("photos", apps.find((x) => x.id === editing.id));
        setStatus(r.message, !r.ok);
      } else setStatus("");
    } else {
      // Kept until the app is made.
      const form = $("form[data-tv-form]");
      const values = form ? readForm(form) : null;
      pendingPhotos.push(...files.map((file) => ({ file, url: URL.createObjectURL(file) })));
      openForm("photos");
      if (values) {
        const f = $("form[data-tv-form]");
        f.name.value = values.name;
        f.emoji.value = values.emoji;
      }
    }
  });

  document.addEventListener("submit", (e) => {
    const claude = e.target.closest("form[data-tv-claude]");
    if (claude) {
      e.preventDefault();
      buildWithClaude(claude);
      return;
    }
    const form = e.target.closest("form[data-tv-form]");
    if (!form) return;
    e.preventDefault();
    save(form);
  });

  return {
    load,
    set,
    built,
    render,
    openPicker,
    openClaude,
    openForm: (id) => {
      const a = apps.find((x) => x.id === id);
      if (a) openForm(a.kind, a);
    },
    pictures,
    nameFrom,
    nextColor: () => COLORS[apps.length % COLORS.length],
    get apps() {
      return apps;
    },
  };
}
