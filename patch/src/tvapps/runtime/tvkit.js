/* The TV apps made with Patch: one small runtime for every kind (videos, photos, clock and weather,
   notes, countdown, radio, app shortcuts, quiz, website). The app's own settings are in window.APP.
   It runs in Patch's Android TV app (with window.PatchTV to open other apps and keep the screen on),
   in a TV's web browser, and in Patch's preview. Remote: arrows move, OK chooses, Back goes back;
   a pointer (LG's Magic Remote, a mouse) works too. Written for older TV browsers: no optional
   chaining or other new syntax, and text from the web always goes in as text, never as HTML. */
(function () {
  "use strict";
  var APP = window.APP || {};
  var S = APP.settings || {};
  var bridge = window.PatchTV || null;
  var root = document.getElementById("app");
  var view = { onKey: null, back: null };
  var overlay = null;

  // ── Small helpers ───────────────────────────────────────────────────────
  function h(tag, props, kids) {
    var el = document.createElement(tag);
    if (props) {
      for (var k in props) {
        if (!Object.prototype.hasOwnProperty.call(props, k) || props[k] == null) continue;
        if (k === "text") el.textContent = props[k];
        else if (k === "cls") el.className = props[k];
        else if (k === "style") el.setAttribute("style", props[k]);
        else if (k === "bg") el.style.backgroundImage = "url(" + JSON.stringify(String(props[k])) + ")";
        else if (k.indexOf("on") === 0) el.addEventListener(k.slice(2), props[k]);
        else el.setAttribute(k, props[k]);
      }
    }
    (kids || []).forEach(function (c) {
      if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }
  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }
  var hour12 = S.hours ? S.hours === 12 : /en-(US|CA|AU|PH)|hi|ur/.test(navigator.language || "");
  function timeText(d, seconds) {
    var hr = d.getHours();
    var t = hour12 ? ((hr % 12) || 12) + ":" + pad(d.getMinutes()) : pad(hr) + ":" + pad(d.getMinutes());
    return seconds ? t + ":" + pad(d.getSeconds()) : t;
  }
  function dateText(d) {
    try {
      return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    } catch (e) {
      return d.toDateString();
    }
  }
  var toastTimer = null;
  function toast(text) {
    var t = document.querySelector(".toast") || document.body.appendChild(h("div", { cls: "toast" }));
    t.textContent = text;
    t.className = "toast show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.className = "toast";
    }, 2400);
  }
  function keepAwake(on) {
    try {
      if (bridge && bridge.keepAwake) bridge.keepAwake(!!on);
    } catch (e) {}
  }
  function topBar(extra, noClock) {
    var clock = noClock ? null : h("div", { cls: "clock" });
    var tick = function () {
      clock.textContent = timeText(new Date());
    };
    if (clock) {
      tick();
      setInterval(tick, 10000);
    }
    return h("div", { cls: "top" }, [h("span", { cls: "emoji", text: APP.emoji || "" }), h("h1", { text: APP.name || "" }), extra || null, clock]);
  }
  function hint(text) {
    return h("div", { cls: "hint", text: text });
  }
  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }
  function openOutside(url) {
    if (bridge && bridge.openUrl) {
      bridge.openUrl(url);
      return true;
    }
    return false;
  }

  // ── Moving around with the remote ───────────────────────────────────────
  var current = null;
  function focusables() {
    var scope = overlay || root;
    return Array.prototype.slice.call(scope.querySelectorAll("[data-focus]")).filter(function (el) {
      return el.offsetWidth > 0 && el.offsetHeight > 0;
    });
  }
  function focus(el) {
    if (!el) return;
    if (current) current.classList.remove("on");
    current = el;
    el.classList.add("on");
    // Keep it in view inside its scrolling area.
    var box = el.closest ? el.closest(".scroll") : null;
    if (box) {
      var r = el.getBoundingClientRect();
      var b = box.getBoundingClientRect();
      if (r.bottom > b.bottom - 20) box.scrollTop += r.bottom - b.bottom + 40;
      else if (r.top < b.top + 20) box.scrollTop -= b.top - r.top + 40;
    }
  }
  function firstFocus() {
    var list = focusables();
    if (list.length && list.indexOf(current) < 0) focus(list[0]);
  }
  function move(dir) {
    var list = focusables();
    if (!list.length) return false;
    if (!current || list.indexOf(current) < 0) {
      focus(list[0]);
      return true;
    }
    var a = current.getBoundingClientRect();
    var ax = a.left + a.width / 2;
    var ay = a.top + a.height / 2;
    var best = null;
    var bestScore = Infinity;
    list.forEach(function (el) {
      if (el === current) return;
      var b = el.getBoundingClientRect();
      var bx = b.left + b.width / 2;
      var by = b.top + b.height / 2;
      var dx = bx - ax;
      var dy = by - ay;
      var main = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy;
      if (main <= 1) return;
      var side = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
      var score = main + side * 2.5;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    });
    if (best) focus(best);
    return !!best;
  }
  function choose() {
    if (current && current.__choose) current.__choose();
  }
  function focusable(el, onChoose) {
    el.setAttribute("data-focus", "");
    el.__choose = onChoose;
    el.addEventListener("mouseenter", function () {
      focus(el);
    });
    el.addEventListener("click", function () {
      focus(el);
      onChoose();
    });
    return el;
  }

  // ── Back: close what's open, otherwise leave the app ────────────────────
  function closeOverlay() {
    if (!overlay) return false;
    var o = overlay;
    overlay = null;
    if (o.__close) o.__close();
    if (o.parentNode) o.parentNode.removeChild(o);
    current = null;
    firstFocus();
    return true;
  }
  function back() {
    if (closeOverlay()) return true;
    if (view.back && view.back()) return true;
    return false;
  }
  function showOverlay(el, onClose) {
    closeOverlay();
    overlay = el;
    el.__close = onClose;
    document.body.appendChild(el);
    // In a TV's browser, Back walks the history: give it a step to take.
    if (!bridge && window.history && history.pushState) history.pushState({ overlay: true }, "");
  }
  window.addEventListener("popstate", function () {
    closeOverlay();
  });
  window.tvkit = { back: back };

  var KEYS = { 37: "left", 38: "up", 39: "right", 40: "down", 13: "ok", 27: "back", 8: "back", 10009: "back", 461: "back", 179: "playpause", 415: "play", 19: "pause", 413: "stop", 417: "forward", 412: "rewind", 228: "forward", 227: "rewind" };
  var NAMES = { ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", Enter: "ok", Escape: "back", GoBack: "back", BrowserBack: "back", MediaPlayPause: "playpause", MediaPlay: "play", MediaPause: "pause", MediaStop: "stop", MediaFastForward: "forward", MediaRewind: "rewind" };
  document.addEventListener("keydown", function (e) {
    var k = NAMES[e.key] || KEYS[e.keyCode];
    if (!k) return;
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName) && k !== "back" && k !== "ok") return;
    if (view.onKey && !overlay && view.onKey(k, e)) {
      e.preventDefault();
      return;
    }
    if (overlay && overlay.__key && overlay.__key(k)) {
      e.preventDefault();
      return;
    }
    if (k === "left" || k === "right" || k === "up" || k === "down") {
      move(k);
      e.preventDefault();
    } else if (k === "ok") {
      choose();
      e.preventDefault();
    } else if (k === "back") {
      if (back()) e.preventDefault();
      else if (!bridge && overlay == null && e.keyCode === 8) e.preventDefault();
    }
  });

  // ── Videos ──────────────────────────────────────────────────────────────
  function playVideo(item) {
    if (item.type === "youtube" || item.type === "playlist") {
      var watch = item.type === "youtube" ? "https://www.youtube.com/watch?v=" + encodeURIComponent(item.id) : "https://www.youtube.com/playlist?list=" + encodeURIComponent(item.id);
      if (openOutside(watch)) return; // the TV's own YouTube app
      var src = item.type === "youtube" ? "https://www.youtube.com/embed/" + encodeURIComponent(item.id) + "?autoplay=1&rel=0" : "https://www.youtube.com/embed/videoseries?list=" + encodeURIComponent(item.id) + "&autoplay=1";
      showOverlay(h("div", { cls: "overlay" }, [h("iframe", { src: src, allow: "autoplay; fullscreen; encrypted-media", allowfullscreen: "" })]));
      return;
    }
    var video = h("video", { src: item.url, autoplay: "", playsinline: "" });
    var o = h("div", { cls: "overlay" }, [video]);
    o.__key = function (k) {
      if (k === "ok" || k === "playpause" || k === "play" || k === "pause") {
        if (video.paused) video.play();
        else video.pause();
        toast(video.paused ? "Paused" : "Playing");
        return true;
      }
      if (k === "left" || k === "rewind" || k === "right" || k === "forward") {
        video.currentTime = Math.max(0, video.currentTime + (k === "left" || k === "rewind" ? -10 : 10));
        return true;
      }
      return false;
    };
    video.addEventListener("error", function () {
      toast("That video wouldn't play.");
    });
    showOverlay(o, function () {
      video.pause();
      video.removeAttribute("src");
    });
    keepAwake(true);
    if (item.title) toast(item.title);
  }
  function videos() {
    var items = S.items || [];
    var grid = h("div", { cls: "grid" });
    items.forEach(function (it) {
      var thumb = it.type === "youtube" ? "https://i.ytimg.com/vi/" + it.id + "/hqdefault.jpg" : it.thumb || null;
      var card = h("div", { cls: "card" }, [
        h("div", { cls: "thumb", bg: thumb, style: thumb ? null : "background-image:linear-gradient(135deg,var(--accent),#111)" }, [h("div", { cls: "play", text: "▶" }), it.type === "playlist" ? h("div", { cls: "badge", text: "Playlist" }) : null]),
        h("div", { cls: "meta" }, [h("div", { cls: "title", text: it.title || "Video" }), it.channel ? h("div", { cls: "sub", text: it.channel }) : null]),
      ]);
      grid.appendChild(focusable(card, function () {
        playVideo(it);
      }));
    });
    root.appendChild(topBar());
    root.appendChild(items.length ? h("div", { cls: "scroll" }, [grid]) : h("div", { cls: "empty" }, [h("span", { cls: "big", text: "🎬" }), "No videos yet. Add some in Patch."]));
    root.appendChild(hint("Arrows to move · OK to play · Back to leave"));
  }

  // ── Photos ──────────────────────────────────────────────────────────────
  function photos() {
    var list = S.shuffle ? shuffle(APP.photos || []) : (APP.photos || []).slice();
    if (!list.length) {
      root.appendChild(topBar());
      root.appendChild(h("div", { cls: "empty" }, [h("span", { cls: "big", text: "🖼️" }), "No photos yet. Add some in Patch on your phone."]));
      return;
    }
    keepAwake(true);
    var slides = [h("div", { cls: "slide" + (S.fit === "cover" ? " cover" : "") }), h("div", { cls: "slide" + (S.fit === "cover" ? " cover" : "") })];
    slides.forEach(function (s) {
      s.appendChild(h("div", { cls: "fill" }));
      s.appendChild(h("div", { cls: "pic" }));
      root.appendChild(s);
    });
    var caption = h("div", { cls: "caption" });
    root.appendChild(caption);
    if (S.clock !== false) {
      var t = h("div", { cls: "t" });
      var d = h("div", { cls: "d" });
      var tick = function () {
        var now = new Date();
        t.textContent = timeText(now);
        d.textContent = dateText(now);
      };
      tick();
      setInterval(tick, 10000);
      root.appendChild(h("div", { cls: "photo-clock" }, [t, d]));
    }
    var i = -1;
    var front = 0;
    var paused = false;
    var timer = null;
    var seconds = Math.max(3, Math.min(600, Number(S.interval) || 8));
    function show(n) {
      i = (n + list.length) % list.length;
      var p = list[i];
      var src = typeof p === "string" ? p : p.src;
      var next = slides[1 - front];
      next.querySelector(".fill").style.backgroundImage = "url(" + JSON.stringify(src) + ")";
      next.querySelector(".pic").style.backgroundImage = "url(" + JSON.stringify(src) + ")";
      next.className = next.className.replace(" show", "");
      void next.offsetWidth;
      next.className += " show";
      slides[front].className = slides[front].className.replace(" show", "");
      front = 1 - front;
      caption.textContent = (typeof p === "object" && p.caption) || "";
      schedule();
    }
    function schedule() {
      clearTimeout(timer);
      if (!paused) timer = setTimeout(function () {
        show(i + 1);
      }, seconds * 1000);
    }
    // Load the next picture before it's needed.
    var cache = new Image();
    setInterval(function () {
      var p = list[(i + 1) % list.length];
      cache.src = typeof p === "string" ? p : p.src;
    }, 4000);
    view.onKey = function (k) {
      if (k === "right" || k === "forward") show(i + 1);
      else if (k === "left" || k === "rewind") show(i - 1);
      else if (k === "ok" || k === "playpause" || k === "play" || k === "pause") {
        paused = !paused;
        toast(paused ? "Paused ⏸" : "Playing ▶");
        schedule();
      } else return false;
      return true;
    };
    document.addEventListener("click", function () {
      show(i + 1);
    });
    show(0);
  }

  // ── Clock and weather ───────────────────────────────────────────────────
  var WMO = [
    [[0], "☀️", "Clear"], [[1], "🌤️", "Mostly clear"], [[2], "⛅", "Partly cloudy"], [[3], "☁️", "Cloudy"], [[45, 48], "🌫️", "Fog"],
    [[51, 53, 55, 56, 57], "🌦️", "Drizzle"], [[61, 63, 65, 66, 67], "🌧️", "Rain"], [[71, 73, 75, 77], "🌨️", "Snow"],
    [[80, 81, 82], "🌦️", "Showers"], [[85, 86], "🌨️", "Snow showers"], [[95, 96, 99], "⛈️", "Thunderstorms"],
  ];
  function wmo(code, day) {
    for (var i = 0; i < WMO.length; i++) if (WMO[i][0].indexOf(code) >= 0) return { icon: code === 0 && day === 0 ? "🌙" : WMO[i][1], words: WMO[i][2] };
    return { icon: "🌡️", words: "" };
  }
  function clockKind() {
    keepAwake(true);
    var time = h("div", { cls: "time" });
    var date = h("div", { cls: "date" });
    var now = h("div", { cls: "weather-now" });
    var days = h("div", { cls: "days" });
    root.appendChild(topBar(S.place ? h("span", { style: "margin-left:1rem;color:var(--muted);font-size:1.3rem", text: S.place }) : null, true));
    root.appendChild(h("div", { cls: "clock-face" }, [time, date, now, days]));
    var tick = function () {
      var d = new Date();
      clear(time);
      time.appendChild(document.createTextNode(timeText(d)));
      time.appendChild(h("small", { text: pad(d.getSeconds()) }));
      date.textContent = dateText(d);
      var hr = d.getHours();
      document.body.style.background = hr < 6 || hr >= 21 ? "radial-gradient(ellipse at 30% 0%, #1b2347, #070a16 70%)" : hr < 9 ? "radial-gradient(ellipse at 30% 0%, #5a3d6b, #1a1530 70%)" : hr < 18 ? "radial-gradient(ellipse at 30% 0%, #23508f, #0d1a33 70%)" : "radial-gradient(ellipse at 30% 0%, #7a3b4f, #1a1328 70%)";
    };
    tick();
    setInterval(tick, 1000);
    if (S.lat == null || S.lon == null) return;
    var unit = S.units === "F" ? "fahrenheit" : "celsius";
    function weather() {
      var url = "https://api.open-meteo.com/v1/forecast?latitude=" + S.lat + "&longitude=" + S.lon + "&current=temperature_2m,weather_code,is_day&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=6&temperature_unit=" + unit;
      fetch(url)
        .then(function (r) {
          return r.json();
        })
        .then(function (w) {
          var c = w.current || {};
          var nowW = wmo(c.weather_code, c.is_day);
          clear(now);
          now.appendChild(h("span", { cls: "icon", text: nowW.icon }));
          now.appendChild(h("span", { cls: "temp", text: Math.round(c.temperature_2m) + "°" }));
          var dl = w.daily || {};
          now.appendChild(h("span", { cls: "words" }, [nowW.words, h("br"), dl.temperature_2m_max ? "High " + Math.round(dl.temperature_2m_max[0]) + "° · Low " + Math.round(dl.temperature_2m_min[0]) + "°" : ""]));
          clear(days);
          (dl.time || []).slice(1, 6).forEach(function (day, n) {
            var dd = new Date(day + "T12:00:00");
            var name;
            try {
              name = dd.toLocaleDateString(undefined, { weekday: "short" });
            } catch (e) {
              name = day.slice(5);
            }
            var x = wmo(dl.weather_code[n + 1], 1);
            days.appendChild(h("div", { cls: "day" }, [h("div", { cls: "n", text: name }), h("div", { cls: "i", text: x.icon }), h("div", { cls: "r", text: Math.round(dl.temperature_2m_max[n + 1]) + "° / " + Math.round(dl.temperature_2m_min[n + 1]) + "°" })]));
          });
        })
        .catch(function () {
          clear(now);
          now.appendChild(h("span", { cls: "words", text: "Weather isn't available right now." }));
        });
    }
    weather();
    setInterval(weather, 15 * 60 * 1000);
  }

  // ── Notes ───────────────────────────────────────────────────────────────
  function notes() {
    keepAwake(true);
    var list = S.notes || [];
    var box = h("div", { cls: "notes" });
    list.forEach(function (n) {
      box.appendChild(focusable(h("div", { cls: "note", text: n }), function () {}));
    });
    root.appendChild(topBar(S.title ? h("span", { style: "margin-left:1rem;color:var(--muted);font-size:1.4rem", text: S.title }) : null));
    root.appendChild(list.length ? h("div", { cls: "scroll" }, [box]) : h("div", { cls: "empty" }, [h("span", { cls: "big", text: "📝" }), "No notes yet."]));
  }

  // ── Countdown ───────────────────────────────────────────────────────────
  function countdown() {
    keepAwake(true);
    var target = new Date(S.date);
    var box = h("div", { cls: "count" });
    root.appendChild(topBar());
    root.appendChild(box);
    var celebrated = false;
    function tick() {
      var ms = target - new Date();
      clear(box);
      if (isNaN(ms)) {
        box.appendChild(h("div", { cls: "what", text: "No date set yet." }));
        return;
      }
      if (ms <= 0) {
        box.appendChild(h("div", { cls: "party", text: "🎉" }));
        box.appendChild(h("div", { cls: "big-title", text: S.done || "It's here!" }));
        box.appendChild(h("div", { cls: "what", text: S.title || "" }));
        if (!celebrated) {
          celebrated = true;
          for (var c = 0; c < 26; c++) {
            var bit = h("div", { cls: "confetti", text: ["🎉", "🎊", "✨", "🥳", "⭐"][c % 5], style: "left:" + Math.random() * 100 + "%;animation-duration:" + (4 + Math.random() * 5) + "s;animation-delay:" + Math.random() * 4 + "s" });
            document.body.appendChild(bit);
          }
        }
        return;
      }
      var days = Math.floor(ms / 86400000);
      var hrs = Math.floor((ms % 86400000) / 3600000);
      var mins = Math.floor((ms % 3600000) / 60000);
      var secs = Math.floor((ms % 60000) / 1000);
      box.appendChild(h("div", { cls: "what", text: S.title ? "Until " + S.title : "Counting down" }));
      if (days >= 1) {
        box.appendChild(h("div", { cls: "num", text: String(days) }));
        box.appendChild(h("div", { cls: "unit", text: days === 1 ? "day" : "days" }));
        box.appendChild(h("div", { cls: "rest", text: hrs + " h " + pad(mins) + " m " + pad(secs) + " s" }));
      } else {
        box.appendChild(h("div", { cls: "num", text: pad(hrs) + ":" + pad(mins) + ":" + pad(secs) }));
        box.appendChild(h("div", { cls: "unit", text: "to go" }));
      }
      var when;
      try {
        when = target.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      } catch (e) {
        when = target.toDateString();
      }
      box.appendChild(h("div", { cls: "when", text: when }));
    }
    tick();
    setInterval(tick, 1000);
  }

  // ── Radio ───────────────────────────────────────────────────────────────
  function radio() {
    var stations = S.stations || [];
    var audio = new Audio();
    var playing = null;
    var bar = h("div", { cls: "nowplaying", style: "display:none" });
    var grid = h("div", { cls: "grid", style: "grid-template-columns:repeat(3,1fr)" });
    var cards = [];
    function stop() {
      audio.pause();
      audio.removeAttribute("src");
      playing = null;
      bar.style.display = "none";
      cards.forEach(function (c) {
        c.classList.remove("playing");
      });
      keepAwake(false);
    }
    function play(st, card) {
      if (playing === st) return stop();
      stop();
      playing = st;
      card.classList.add("playing");
      audio.src = st.url;
      var p = audio.play();
      if (p && p.catch) p.catch(function () {});
      clear(bar);
      bar.appendChild(h("span", { cls: "eq" }, [h("i"), h("i"), h("i"), h("i")]));
      bar.appendChild(h("span", { text: "Now playing: " + st.name }));
      bar.style.display = "flex";
      keepAwake(true);
    }
    audio.addEventListener("error", function () {
      if (playing) toast("Couldn't play " + playing.name + ". Try another station.");
      stop();
    });
    stations.forEach(function (st) {
      var logo = h("div", { cls: "logo", bg: st.favicon || null, text: st.favicon ? "" : "📻" });
      var card = h("div", { cls: "station" }, [logo, h("div", null, [h("div", { cls: "name", text: st.name }), h("div", { cls: "sub", text: [st.country, st.tags].filter(Boolean).join(" · ") })])]);
      if (st.favicon) {
        var probe = new Image();
        probe.onerror = function () {
          logo.style.backgroundImage = "";
          logo.textContent = "📻";
        };
        probe.src = st.favicon;
      }
      cards.push(card);
      grid.appendChild(focusable(card, function () {
        play(st, card);
      }));
    });
    view.onKey = function (k) {
      if ((k === "playpause" || k === "pause" || k === "stop") && playing) {
        stop();
        return true;
      }
      return false;
    };
    root.appendChild(topBar());
    root.appendChild(stations.length ? h("div", { cls: "scroll" }, [grid]) : h("div", { cls: "empty" }, [h("span", { cls: "big", text: "📻" }), "No stations yet."]));
    root.appendChild(bar);
  }

  // ── App shortcuts (Patch's Android TV app only) ─────────────────────────
  function norm(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function shortcuts() {
    root.appendChild(topBar());
    // In Patch's Android TV app the tiles open the TV's own apps; elsewhere (Patch's preview, a
    // TV's browser) they're shown, but can't open anything.
    var live = !!(bridge && bridge.apps);
    var installed = [];
    if (live) {
      try {
        installed = JSON.parse(bridge.apps()) || [];
      } catch (e) {}
    }
    var wanted = (S.apps || []).map(function (a) {
      return typeof a === "string" ? { name: a } : a;
    });
    if (!live && !wanted.length) {
      root.appendChild(h("div", { cls: "empty" }, [h("span", { cls: "big", text: "🧩" }), "On Android TV and Fire TV this shows all the TV's apps, as big buttons."]));
      return;
    }
    var list = wanted.length
      ? wanted.map(function (w) {
          var n = norm(w.name);
          var hit = null;
          installed.forEach(function (a) {
            if (!hit && (norm(a.name) === n || a.package === w.package)) hit = a;
          });
          installed.forEach(function (a) {
            var an = norm(a.name);
            if (!hit && n && (an.indexOf(n) === 0 || n.indexOf(an) === 0)) hit = a;
          });
          return { name: (hit && hit.name) || w.name, package: hit ? hit.package : null, emoji: w.emoji };
        })
      : installed;
    var colors = ["#5b6cff", "#ff7a59", "#2ec4b6", "#e84393", "#f9c74f", "#43aa8b", "#9b5de5", "#00bbf9"];
    var grid = h("div", { cls: "grid" });
    list.forEach(function (a, n) {
      var tile = h("div", { cls: "tile" + (a.package || !live ? "" : " missing") }, [h("div", { cls: "glyph", style: "background:" + colors[n % colors.length], text: a.emoji || (a.name || "?").charAt(0).toUpperCase() }), h("div", { cls: "label", text: a.name })]);
      grid.appendChild(focusable(tile, function () {
        if (!live) return toast("On the TV, this opens " + a.name + ".");
        if (!a.package) return toast(a.name + " isn't installed on this TV.");
        bridge.launch(a.package);
      }));
    });
    root.appendChild(h("div", { cls: "scroll" }, [grid]));
    root.appendChild(hint(live ? "Arrows to move · OK to open" : "On Android TV and Fire TV, these open the TV's own apps"));
  }

  // ── Quiz ────────────────────────────────────────────────────────────────
  function quiz() {
    var all = (S.questions || []).filter(function (q) {
      return q && q.q && q.answers && q.answers.length >= 2;
    });
    var box = h("div", { cls: "quiz" });
    var scoreEl = h("div", { cls: "score" });
    root.appendChild(topBar(null, true));
    root.appendChild(box);
    root.appendChild(scoreEl);
    var order;
    var at;
    var score;
    var locked = false;
    function start() {
      order = S.shuffle === false ? all.slice() : shuffle(all);
      at = 0;
      score = 0;
      ask();
    }
    function intro() {
      clear(box);
      scoreEl.textContent = "";
      box.appendChild(h("div", { cls: "big-title", text: APP.name || "Quiz" }));
      box.appendChild(h("div", { cls: "lead", text: all.length ? all.length + (all.length === 1 ? " question" : " questions") + ". Ready?" : "No questions yet." }));
      if (all.length) {
        var go = h("button", { cls: "btn", text: "Start" });
        box.appendChild(h("div", null, [focusable(go, start)]));
        current = null;
        focus(go);
      }
    }
    function ask() {
      locked = false;
      var item = order[at];
      clear(box);
      scoreEl.textContent = "Score " + score;
      box.appendChild(h("div", { cls: "progress", text: "Question " + (at + 1) + " of " + order.length }));
      box.appendChild(h("div", { cls: "q", text: item.q }));
      var answers = h("div", { cls: "answers" });
      var right = item.answers[0];
      var shown = shuffle(item.answers.slice(0, 6));
      var buttons = [];
      shown.forEach(function (ans, n) {
        var b = h("button", { cls: "answer" }, [h("span", { cls: "letter", text: "ABCDEF".charAt(n) }), h("span", { text: ans })]);
        buttons.push(b);
        answers.appendChild(focusable(b, function () {
          if (locked) return next();
          locked = true;
          var ok = ans === right;
          if (ok) score++;
          scoreEl.textContent = "Score " + score;
          buttons.forEach(function (x, m) {
            if (shown[m] === right) x.classList.add("right");
            else if (x === b) x.classList.add("wrong");
          });
          toast(ok ? "Right! 🎉" : "The answer was: " + right);
          setTimeout(function () {
            if (locked && order[at] === item) next();
          }, 2600);
        }));
      });
      box.appendChild(answers);
      current = null;
      focus(buttons[0]);
    }
    function next() {
      at++;
      if (at < order.length) return ask();
      clear(box);
      scoreEl.textContent = "";
      var ratio = score / order.length;
      box.appendChild(h("div", { cls: "big-title", text: (ratio === 1 ? "🏆 " : ratio >= 0.7 ? "🌟 " : ratio >= 0.4 ? "👍 " : "🙂 ") + score + " out of " + order.length }));
      box.appendChild(h("div", { cls: "lead", text: ratio === 1 ? "A perfect score!" : ratio >= 0.7 ? "Great job!" : ratio >= 0.4 ? "Nicely done." : "Better luck next time!" }));
      var again = h("button", { cls: "btn", text: "Play again" });
      box.appendChild(h("div", null, [focusable(again, start)]));
      current = null;
      focus(again);
    }
    intro();
  }

  // ── Website (the TV app opens the site itself; this is for the preview) ──
  function website() {
    root.appendChild(topBar());
    var open = h("button", { cls: "btn", text: "Open the site" });
    root.appendChild(h("div", { cls: "site" }, [h("div", { cls: "lead", text: "On the TV this app opens the site full screen, with a pointer you move with the remote." }), h("div", { cls: "url", text: S.url || "" }), focusable(open, function () {
      if (S.url && !openOutside(S.url)) window.location.href = S.url;
    })]));
  }

  var KINDS = { videos: videos, photos: photos, clock: clockKind, notes: notes, countdown: countdown, radio: radio, shortcuts: shortcuts, quiz: quiz, website: website };
  if (APP.color) document.documentElement.style.setProperty("--accent", APP.color);
  document.title = APP.name || "TV app";
  try {
    (KINDS[APP.kind] || notes)();
  } catch (e) {
    clear(root);
    root.appendChild(h("div", { cls: "empty" }, [h("span", { cls: "big", text: "😕" }), "Something went wrong in this app: " + e.message]));
  }
  setTimeout(firstFocus, 50);
})();
