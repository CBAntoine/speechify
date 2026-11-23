// YouTube and web links: turning "that video", a YouTube link or a search into what a TV or browser
// needs. Searching YouTube uses the official YouTube Data API with the person's own free API key
// (Settings); without one, TVs that can show YouTube's own search are asked to do it themselves.
import { decodeEntities } from "./xml.mjs";

export const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
const ID = /^[A-Za-z0-9_-]{11}$/;

/** A YouTube video id from an id, a youtube.com / youtu.be link, or null. */
export function videoIdFrom(value) {
  const s = String(value ?? "").trim();
  if (ID.test(s)) return s;
  let u;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^(www|m|music)\./, "");
  if (host === "youtu.be") return ID.test(u.pathname.slice(1, 12)) && u.pathname.length <= 13 ? u.pathname.slice(1, 12) : null;
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  const v = u.searchParams.get("v");
  if (v && ID.test(v)) return v;
  const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})(?:[/?]|$)/);
  return m ? m[1] : null;
}

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
export const youtubeSearchUrl = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
/**
 * A request for the YouTube app on a TV, the way a TV's own voice assistant hands it one: "search
 * for this" or "play this". They are start-up parameters the app reads (va: what to do, vq: the
 * words), and the same on every make of TV because YouTube on TVs is one app everywhere. With
 * `play` the app picks the closest match itself and starts it.
 */
export const youtubeVoiceParams = (q, { play = false } = {}) => `${play ? "va=play&launch=voice" : "va=search&launch=voice&launch=search"}&vq=${encodeURIComponent(String(q).trim())}`;
export const youtubeVoiceUrl = (q, opts) => `https://www.youtube.com/tv?${youtubeVoiceParams(q, opts)}`;
export const webSearchUrl = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

/**
 * "bbc.co.uk", "https://example.com/x", "weather dot com" → a safe https/http URL, or null when the
 * value doesn't look like a web address (the caller can search for it instead).
 */
export function websiteUrl(value) {
  let s = String(value ?? "").trim();
  if (!s) return null;
  s = s.replace(/\s+dot\s+/gi, ".").replace(/\s+slash\s+/gi, "/");
  if (!/^https?:\/\//i.test(s)) {
    if (/\s/.test(s) || !/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(s)) return null;
    s = `https://${s}`;
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return null;
  return u.toString();
}

/** "PT1H2M3S" → "1:02:03" */
export function formatIsoDuration(iso) {
  const m = String(iso || "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const h = Number(m[1] || 0) * 24 + Number(m[2] || 0);
  const min = Number(m[3] || 0);
  const sec = Number(m[4] || 0);
  if (!h && !min && !sec) return null;
  return h ? `${h}:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${min}:${String(sec).padStart(2, "0")}`;
}

function apiError(status, body) {
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || "";
  if (/keyInvalid|API_KEY_INVALID|badRequest/i.test(reason) || status === 400) return Object.assign(new Error("YouTube didn't accept the API key. Check it in Patch's Settings."), { code: "EYTKEY" });
  if (/quota/i.test(reason)) return Object.assign(new Error("Your YouTube key has used up today's free searches. They reset at midnight Pacific time."), { code: "EYTQUOTA" });
  if (/accessNotConfigured|SERVICE_DISABLED|forbidden/i.test(reason) || status === 403) return Object.assign(new Error("Your Google project needs the YouTube Data API turned on (Google Cloud console → APIs → YouTube Data API v3 → Enable)."), { code: "EYTKEY" });
  return Object.assign(new Error(`YouTube search failed (HTTP ${status}).`), { code: "EYTSEARCH" });
}

/**
 * Search YouTube videos. Returns [{ id, title, channel, duration, live, url }].
 * `base` can point at a test server.
 */
export async function searchYouTube(query, { apiKey, max = 5, base = YOUTUBE_API, timeout = 8000 } = {}) {
  const q = String(query ?? "").trim();
  if (!q) throw Object.assign(new Error("What should I search YouTube for?"), { code: "EVALUE" });
  if (!apiKey) throw Object.assign(new Error("Searching YouTube needs a free YouTube API key in Patch's Settings."), { code: "ENOYTKEY" });
  const params = new URLSearchParams({ part: "snippet", type: "video", maxResults: String(Math.min(Math.max(max, 1), 10)), q, key: apiKey });
  let res;
  try {
    res = await fetch(`${base}/search?${params}`, { signal: AbortSignal.timeout(timeout) });
  } catch {
    throw Object.assign(new Error("Couldn't reach YouTube. Check the internet connection."), { code: "ENETWORK" });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw apiError(res.status, body);
  const items = (body?.items || []).filter((it) => it?.id?.videoId);
  const out = items.map((it) => ({
    id: it.id.videoId,
    title: decodeEntities(it.snippet?.title || "").trim(),
    channel: decodeEntities(it.snippet?.channelTitle || "").trim() || null,
    live: it.snippet?.liveBroadcastContent === "live",
    duration: null,
    url: watchUrl(it.id.videoId),
  }));
  if (out.length) {
    // Lengths come from a second, cheap call; the results are still useful without them.
    try {
      const r2 = await fetch(`${base}/videos?${new URLSearchParams({ part: "contentDetails", id: out.map((v) => v.id).join(","), key: apiKey })}`, { signal: AbortSignal.timeout(timeout) });
      const b2 = r2.ok ? await r2.json() : null;
      for (const v of b2?.items || []) {
        const hit = out.find((x) => x.id === v.id);
        if (hit) hit.duration = formatIsoDuration(v.contentDetails?.duration);
      }
    } catch {
      /* no durations */
    }
  }
  return out;
}

/** How a result list reads out loud: "1. Title (channel, 4:12)". */
export function describeResults(results, limit = 5) {
  return results
    .slice(0, limit)
    .map((r, i) => `${i + 1}. ${r.title}${r.channel || r.duration || r.live ? ` (${[r.channel, r.live ? "live now" : r.duration].filter(Boolean).join(", ")})` : ""}`)
    .join(" ");
}
