// The kinds of TV app Patch can make, and turning what the person (or the voice agent) asked for
// into each app's settings: titles of YouTube links, a town for the weather, radio stations by
// name, quiz questions, a countdown's date. Everything from the web is trimmed to plain text.
import { searchYouTube, videoIdFrom, websiteUrl } from "../net/youtube.mjs";
import { mapLimit, normalizeText } from "../util.mjs";

export const KINDS = {
  videos: { label: "Video channel", emoji: "🎬", about: "Your own channel of YouTube videos, playlists or video links." },
  photos: { label: "Photo frame", emoji: "🖼️", about: "A slideshow of photos from your phone, with the time." },
  clock: { label: "Clock & weather", emoji: "🕰️", about: "A big clock with the weather where you are." },
  notes: { label: "Notes board", emoji: "📝", about: "Notes and reminders for everyone at home." },
  countdown: { label: "Countdown", emoji: "⏳", about: "Days to go until something special." },
  radio: { label: "Radio", emoji: "📻", about: "Internet radio stations you pick." },
  shortcuts: { label: "App shortcuts", emoji: "🧩", about: "Big buttons for the TV apps you use most (Android TV and Fire TV).", androidOnly: true },
  quiz: { label: "Quiz", emoji: "❓", about: "A quiz to play with the remote." },
  website: { label: "Website", emoji: "🌐", about: "Any website as an app, full screen." },
  custom: { label: "Your own code", emoji: "💻", about: "An app written in HTML, by you or by Patch.", androidOnly: false },
};

export class ContentError extends Error {}

const clip = (s, n) => {
  const t = String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const byLine = (text) => String(text ?? "").split(/\r?\n/).map((s) => s.replace(/^\s*(?:[-*•]|\d{1,2}[.)])\s+/, "").trim()).filter(Boolean);
const byLineOrComma = (text) => byLine(text).flatMap((l) => l.split(/\s*[,;]\s*/)).map((s) => s.trim()).filter(Boolean);

async function getJson(url, timeout = 6000) {
  const res = await fetch(url, { headers: { "user-agent": "Patch/1 (home network helper)", accept: "application/json" }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Videos ─────────────────────────────────────────────────────────────────

function cleanVideo(v) {
  if (!v || typeof v !== "object") return null;
  if (v.type === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(v.id || "")) return { type: "youtube", id: v.id, title: clip(v.title, 120) || null, channel: clip(v.channel, 60) || null };
  if (v.type === "playlist" && /^[A-Za-z0-9_-]{10,64}$/.test(v.id || "")) return { type: "playlist", id: v.id, title: clip(v.title, 120) || null, channel: clip(v.channel, 60) || null };
  const url = v.type === "video" && websiteUrl(v.url);
  return url ? { type: "video", url, title: clip(v.title, 120) || null } : null;
}

async function videos(input, ctx) {
  const given = Array.isArray(input.settings?.items) ? input.settings.items.map(cleanVideo).filter(Boolean) : [];
  const items = given;
  const missing = [];
  for (const s of byLine(input.content).flatMap((l) => l.split(/\s*,\s*(?=https?:|www\.|youtu)/)).slice(0, 60)) {
    const list = s.match(/[?&]list=([A-Za-z0-9_-]{10,64})/);
    const id = videoIdFrom(s);
    if (list && !/[?&]v=/.test(s)) items.push({ type: "playlist", id: list[1] });
    else if (id) items.push({ type: "youtube", id });
    else {
      const url = websiteUrl(s);
      if (url && /\.(mp4|webm|m3u8|mov|m4v)(\?|$)/i.test(url)) items.push({ type: "video", url, title: clip(decodeURIComponent(url.split("/").pop().split("?")[0]), 120) });
      else if (ctx.youtube?.apiKey) {
        const found = await searchYouTube(s, { apiKey: ctx.youtube.apiKey, base: ctx.youtube.base, max: 1 }).catch(() => []);
        if (found[0]) items.push({ type: "youtube", id: found[0].id, title: clip(found[0].title, 120), channel: clip(found[0].channel, 60) });
        else missing.push(s);
      } else missing.push(s);
    }
  }
  // Names for YouTube links from YouTube's oEmbed (no key needed).
  await mapLimit(items.filter((i) => i.type !== "video" && !i.title), 4, async (it) => {
    const watch = it.type === "youtube" ? `https://www.youtube.com/watch?v=${it.id}` : `https://www.youtube.com/playlist?list=${it.id}`;
    try {
      const j = await getJson(`${ctx.web.oembed}?format=json&url=${encodeURIComponent(watch)}`, 5000);
      it.title = clip(j.title, 120) || null;
      it.channel = clip(j.author_name, 60) || null;
    } catch {
      /* the TV shows "Video" */
    }
  });
  const seen = new Set();
  const unique = items.filter((i) => {
    const k = `${i.type}:${i.id || i.url}`;
    return seen.has(k) ? false : seen.add(k);
  });
  return {
    settings: { items: unique.slice(0, 60) },
    notes: missing.length ? [`I need a link for ${missing.length === 1 ? "this one" : "these"}${ctx.youtube?.apiKey ? " (YouTube found nothing)" : " (or a free YouTube key in Settings, so I can search)"}: ${missing.join(", ")}.`] : [],
  };
}

// ── Photos ─────────────────────────────────────────────────────────────────

function photos(input, ctx, prev) {
  const s = { interval: 8, clock: true, shuffle: false, fit: "contain", ...(prev?.settings || {}) };
  const t = String(input.content || "");
  const secs = t.match(/(\d{1,3})\s*(?:s\b|sec|second)/i);
  const mins = t.match(/(\d{1,2})\s*(?:m\b|min|minute)/i);
  if (secs) s.interval = Number(secs[1]);
  else if (mins) s.interval = Number(mins[1]) * 60;
  if (/\bno clock\b|without (the )?(clock|time)/i.test(t)) s.clock = false;
  if (/\b(shuffle|random|mix)/i.test(t)) s.shuffle = true;
  if (/\b(fill|zoom|crop)/i.test(t)) s.fit = "cover";
  const g = input.settings || {};
  if (g.interval != null) s.interval = Number(g.interval);
  if (typeof g.clock === "boolean") s.clock = g.clock;
  if (typeof g.shuffle === "boolean") s.shuffle = g.shuffle;
  if (g.fit === "cover" || g.fit === "contain") s.fit = g.fit;
  s.interval = Math.min(600, Math.max(3, Math.round(Number(s.interval) || 8)));
  return { settings: s, notes: [] };
}

// ── Clock and weather ──────────────────────────────────────────────────────

const TWELVE_HOUR = new Set(["US", "CA", "AU", "NZ", "PH", "IN", "PK", "BD", "EG", "SA", "CO", "MX"]);

async function clock(input, ctx, prev) {
  const s = { ...(prev?.settings || {}) };
  const t = String(input.content || "");
  const g = input.settings || {};
  if (/fahrenheit|°\s*f\b/i.test(t)) s.units = "F";
  if (/celsius|centigrade|°\s*c\b/i.test(t)) s.units = "C";
  if (/12[- ]?hour|am\/pm/i.test(t)) s.hours = 12;
  if (/24[- ]?hour/i.test(t)) s.hours = 24;
  if (g.units === "F" || g.units === "C") s.units = g.units;
  if (g.hours === 12 || g.hours === 24) s.hours = g.hours;
  const place = clip(g.place ?? t.replace(/\b(the )?(weather|clock|time)\b|\b(in|for|at)\b|fahrenheit|celsius|centigrade|°\s*[fc]\b|12[- ]?hour|24[- ]?hour|am\/pm/gi, " "), 80);
  const notes = [];
  if (place && normalizeText(place) !== normalizeText(s.placeAsked || "")) {
    let hit = null;
    try {
      const j = await getJson(`${ctx.web.geocode}?count=1&language=en&format=json&name=${encodeURIComponent(place)}`);
      hit = j.results?.[0] || null;
    } catch {
      notes.push("I couldn't look up the weather's location just now, so it shows the time only. Try again later.");
    }
    if (hit) {
      Object.assign(s, { placeAsked: place, place: [hit.name, hit.admin1 && hit.admin1 !== hit.name ? hit.admin1 : null, hit.country].filter(Boolean).join(", "), lat: Math.round(hit.latitude * 1000) / 1000, lon: Math.round(hit.longitude * 1000) / 1000 });
      if (!s.units) s.units = ["US", "LR", "MM"].includes(hit.country_code) ? "F" : "C";
      if (!s.hours) s.hours = TWELVE_HOUR.has(hit.country_code) ? 12 : 24;
    } else if (!notes.length) notes.push(`I couldn't find a place called “${place}”, so it shows the time only.`);
  }
  return { settings: s, notes };
}

// ── Notes ──────────────────────────────────────────────────────────────────

function notes(input, ctx, prev) {
  const g = input.settings || {};
  const list = Array.isArray(g.notes) ? g.notes : input.content != null ? byLine(input.content) : prev?.settings?.notes || [];
  return { settings: { title: clip(g.title ?? prev?.settings?.title ?? "", 60) || null, notes: list.map((n) => clip(n, 300)).filter(Boolean).slice(0, 40) }, notes: [] };
}

// ── Countdown ──────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, "0");
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

/** "2026-12-25", "December 25", "25 Dec 2026 18:00" → a local date-time like 2026-12-25T00:00:00. */
export function parseWhen(text, now = new Date()) {
  const s = String(text ?? "").trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1").replace(/\bat\b/gi, " ");
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?$/);
  let d;
  if (iso) d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] || 0), Number(iso[5] || 0));
  else {
    const hasYear = /\b\d{4}\b/.test(s);
    d = new Date(Date.parse(hasYear ? s : `${s} ${now.getFullYear()}`));
    if (!hasYear && !Number.isNaN(d.getTime()) && d < now) d.setFullYear(d.getFullYear() + 1);
  }
  return Number.isNaN(d.getTime()) ? null : localIso(d);
}

function countdown(input, ctx, prev) {
  const g = input.settings || {};
  let title = g.title ?? prev?.settings?.title ?? null;
  let date = g.date ? parseWhen(g.date) : null;
  let done = g.done ?? prev?.settings?.done ?? null;
  if (input.content) {
    const parts = String(input.content).split("|").map((p) => p.trim());
    if (parts.length >= 2) {
      title = parts[0] || title;
      date = parseWhen(parts[1]) || date;
      done = parts[2] || done;
    } else {
      const on = String(input.content).match(/^(.*?)\s+(?:on|is on|is)\s+(.+)$/i);
      date = (on && parseWhen(on[2])) || parseWhen(input.content) || date;
      if (on && parseWhen(on[2])) title = on[1] || title;
    }
  }
  date = date || prev?.settings?.date || null;
  if (!date) throw new ContentError("A countdown needs a date, like “Our holiday | 2027-07-14”.");
  return { settings: { title: clip(title, 60) || null, date, done: clip(done, 80) || null }, notes: [] };
}

// ── Radio ──────────────────────────────────────────────────────────────────

function cleanStation(st) {
  const url = st && websiteUrl(st.url);
  if (!url) return null;
  const fav = st.favicon && websiteUrl(st.favicon);
  return { name: clip(st.name, 60) || new URL(url).hostname, url, favicon: fav || null, country: clip(st.country, 30) || null, tags: clip(st.tags, 40) || null };
}

async function findStation(name, ctx) {
  for (const base of ctx.web.radio) {
    try {
      const list = await getJson(`${base}/json/stations/search?name=${encodeURIComponent(name)}&limit=8&hidebroken=true&order=votes&reverse=true`, 6000);
      if (!Array.isArray(list)) continue;
      const n = normalizeText(name);
      const pick = list.find((r) => normalizeText(r.name) === n) || list.find((r) => normalizeText(r.name).startsWith(n)) || list[0];
      if (!pick) return null;
      return cleanStation({ name: pick.name, url: pick.url_resolved || pick.url, favicon: /^https?:/.test(pick.favicon || "") ? pick.favicon : null, country: pick.countrycode || pick.country, tags: String(pick.tags || "").split(",").slice(0, 2).join(", ") });
    } catch {
      /* try the next server */
    }
  }
  throw new ContentError("The radio station directory isn't answering right now. Try again in a minute.");
}

async function radio(input, ctx) {
  const stations = Array.isArray(input.settings?.stations) ? input.settings.stations.map(cleanStation).filter(Boolean) : [];
  const missing = [];
  for (const s of byLineOrComma(input.content).slice(0, 30)) {
    const url = /^https?:\/\//i.test(s) && websiteUrl(s);
    if (url) stations.push(cleanStation({ name: new URL(url).hostname, url }));
    else {
      const st = await findStation(s, ctx);
      if (st) stations.push(st);
      else missing.push(s);
    }
  }
  return { settings: { stations: stations.slice(0, 30) }, notes: missing.length ? [`I couldn't find ${missing.join(", ")} in the radio directory.`] : [] };
}

// ── The rest ───────────────────────────────────────────────────────────────

function shortcuts(input, ctx, prev) {
  const g = input.settings || {};
  const apps = Array.isArray(g.apps) ? g.apps.map((a) => (typeof a === "string" ? { name: a } : a)) : input.content != null ? byLineOrComma(input.content).map((name) => ({ name })) : prev?.settings?.apps || [];
  return { settings: { apps: apps.map((a) => ({ name: clip(a.name, 40), ...(a.emoji ? { emoji: clip(a.emoji, 4) } : {}) })).filter((a) => a.name).slice(0, 24) }, notes: [] };
}

function quiz(input, ctx, prev) {
  const g = input.settings || {};
  let qs = Array.isArray(g.questions) ? g.questions : [];
  if (!qs.length && input.content) {
    try {
      const j = JSON.parse(input.content);
      if (Array.isArray(j)) qs = j;
    } catch {
      qs = byLine(input.content)
        .map((l) => l.split("|").map((p) => p.trim()).filter(Boolean))
        .filter((p) => p.length >= 3)
        .map(([q, ...answers]) => ({ q, answers }));
    }
  }
  if (!qs.length && prev) qs = prev.settings.questions || [];
  qs = qs
    .map((q) => ({ q: clip(q.q ?? q.question, 300), answers: (Array.isArray(q.answers) ? q.answers : [q.answer, ...(q.wrong || [])]).map((a) => clip(a, 120)).filter(Boolean).slice(0, 6) }))
    .filter((q) => q.q && q.answers.length >= 2 && new Set(q.answers).size === q.answers.length)
    .slice(0, 60);
  if (!qs.length) throw new ContentError("A quiz needs questions, one per line: question | right answer | wrong answer | wrong answer.");
  return { settings: { questions: qs, shuffle: g.shuffle !== false }, notes: [] };
}

function website(input, ctx, prev) {
  const url = websiteUrl(input.settings?.url ?? input.content ?? prev?.settings?.url);
  if (!url) throw new ContentError("Which website? Tell me its address, like bbc.co.uk.");
  return { settings: { url }, notes: [] };
}

const MAX_HTML = 400 * 1024;

function custom(input, ctx, prev) {
  const html = input.content ?? input.settings?.html;
  if (html == null && prev) return { settings: {}, notes: [], html: null };
  const text = String(html ?? "");
  if (!/<\w/.test(text)) throw new ContentError("Your own app needs its HTML (a web page). Paste it, or describe the app and I'll write it.");
  if (Buffer.byteLength(text) > MAX_HTML) throw new ContentError("That page is too big for a TV app (the most is 400 KB).");
  return { settings: {}, notes: [], html: /<html[\s>]/i.test(text) ? text : `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${text}</body></html>` };
}

const MAKERS = { videos, photos, clock, notes, countdown, radio, shortcuts, quiz, website, custom };

/** The settings for a kind of app from { content, settings } (plus what the app had before, when changing it). */
export async function makeSettings(kind, input, ctx, prev = null) {
  const make = MAKERS[kind];
  if (!make) throw new ContentError(`I can make these kinds of TV app: ${Object.values(KINDS).map((k) => k.label.toLowerCase()).join(", ")}.`);
  return make(input || {}, ctx, prev);
}

/** One line about what's in an app, for lists and for the voice agent. */
export function summary(app) {
  const s = app.settings || {};
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  switch (app.kind) {
    case "videos": return n((s.items || []).length, "video", "videos");
    case "photos": return `${n((app.photos || []).length, "photo", "photos")}, a new one every ${s.interval} seconds`;
    case "clock": return s.place ? `The time and weather in ${s.place}` : "The time";
    case "notes": return n((s.notes || []).length, "note", "notes");
    case "countdown": return `${s.title ? `${s.title}: ` : ""}${s.date ? s.date.slice(0, 10) : "no date"}`;
    case "radio": return n((s.stations || []).length, "station", "stations");
    case "shortcuts": return (s.apps || []).length ? (s.apps || []).map((a) => a.name).join(", ") : "All the TV's apps";
    case "quiz": return n((s.questions || []).length, "question", "questions");
    case "website": return s.url || "";
    default: return "Your own HTML";
  }
}
