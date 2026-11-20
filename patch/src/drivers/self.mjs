// The computer (or phone) Patch runs on: web searches, websites and YouTube open in its default browser.
// On a phone the Patch app hands the address to Android, which opens the browser or the YouTube app.
// With screen access turned on, Patch can also see and use the phone's screen (any app, the browser
// included), open apps by name, and play songs in Spotify or another music app.
import { execFile } from "node:child_process";
import { onPhone, openOnPhone } from "../platform.mjs";
import { describeResults, searchYouTube, videoIdFrom, watchUrl, webSearchUrl, youtubeSearchUrl } from "../net/youtube.mjs";
import { describeScreen, hasPhoneBridge, parseMusicRequest, phone, riskyButton } from "../net/phone.mjs";
import { normalizeText, parsePercent } from "../util.mjs";
import { DeviceError, done, need, unsupported } from "./common.mjs";
import { pickIndex, websiteOrSearch } from "./tv.mjs";

/** Opens a web address in this computer's default browser (no shell involved, so nothing in the URL runs). */
export function openInBrowser(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new DeviceError("I only open web pages (http or https).");
  if (onPhone()) {
    if (hasPhoneBridge()) return phone("open_url", { url: u.href }).then(() => {});
    if (!openOnPhone(u.href)) throw new DeviceError("Open the Patch app on this phone, then ask again.");
    return Promise.resolve();
  }
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [u.href]] : process.platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", u.href]] : ["xdg-open", [u.href]];
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 15_000, windowsHide: true }, (err) => {
      if (err && !err.killed) reject(new DeviceError(err.code === "ENOENT" ? "This computer has no way to open a browser from Patch." : "Couldn't open the browser on this computer."));
      else resolve();
    });
  });
}

export const SELF_ACTIONS = ["web_search", "open_website", "search_youtube", "play_youtube", "rename", "set_room"];

/** What the phone running Patch can do besides: see and use its screen, apps, music, media keys and volume. */
export const PHONE_ACTIONS = ["read_screen", "tap", "scroll", "type_text", "press_button", "launch_app", "play_music", "play", "pause", "next", "previous", "volume_up", "volume_down", "mute", "unmute", "set_volume"];

const PHONE_BUTTONS = { back: "back", "go back": "back", home: "home", "home screen": "home", recents: "recents", "recent apps": "recents", "app switcher": "recents", overview: "recents", notifications: "notifications", "quick settings": "quick_settings" };

/** "3", "the third one", "last" → the item's number on screen; anything else is the words to look for. */
function tapTarget(value, ctx) {
  const idx = pickIndex(value);
  if (idx === null) return String(value).trim();
  if (idx >= 0) return String(idx + 1);
  return String(ctx.memory?.get("phone:screen")?.items?.length || 1);
}

/** Everything the phone (inside the Patch app) does through the app's bridge. */
async function phoneAct(device, action, value, ctx) {
  switch (action) {
    case "read_screen": {
      const s = await phone("screen");
      ctx.memory?.set("phone:screen", s);
      const d = describeScreen(s);
      return done(d.summary, { screen: d.text });
    }
    case "tap": {
      const target = tapTarget(need(value, "thing on the screen"), ctx);
      const found = await phone("tap", { target, check: true });
      // Buttons that buy, send or delete need the person's own yes, whatever the screen says.
      if (!ctx.confirmed && riskyButton(found.text)) throw new DeviceError(`Tapping “${found.text}” could buy, send, delete or change something.`, { code: "ECONFIRM" });
      const r = await phone("tap", { target: String(found.n), expect: found.text });
      return done(`Tapped “${r.text}”.`);
    }
    case "scroll": {
      const v = normalizeText(value || "down");
      const direction = /\b(up|top|back)\b/.test(v) ? "up" : /\bleft\b/.test(v) ? "left" : /\bright\b/.test(v) ? "right" : "down";
      await phone("scroll", { direction });
      return done(`Scrolled ${direction}.`);
    }
    case "type_text": {
      const text = String(need(value, "words to type"));
      await phone("type", { text });
      return done(`Typed “${text}”.`);
    }
    case "press_button": {
      const b = normalizeText(need(value, "button"));
      if (/\b(enter|search|go|submit|done|return)\b/.test(b)) {
        await phone("enter");
        return done("Pressed enter.");
      }
      const g = PHONE_BUTTONS[b];
      if (!g) throw new DeviceError("On the phone I can press back, home, recent apps, notifications or enter.", { code: "EVALUE" });
      await phone("global", { action: g });
      return done(g === "back" ? "Went back." : g === "home" ? "Went to the home screen." : `Opened ${b}.`);
    }
    case "launch_app": {
      const r = await phone("open_app", { name: String(need(value, "app")) });
      return done(`Opened ${r.app}.`);
    }
    case "play_music": {
      const { query, app, kind } = parseMusicRequest(need(value, "song, artist or playlist"));
      const r = await phone("play_media", { query, app, kind });
      return done(`Playing “${query}” in ${r.app || "the music app"}.`);
    }
    case "play":
    case "pause":
    case "next":
    case "previous": {
      await phone("media", { action });
      return done(action === "play" ? "Playing." : action === "pause" ? "Paused." : action === "next" ? "Skipped to the next one." : "Back to the previous one.");
    }
    case "volume_up":
    case "volume_down":
    case "mute":
    case "unmute": {
      const r = await phone("volume", { action: action.replace("volume_", "") });
      return done(action === "mute" ? "Muted." : `Volume ${r.volume}%.`);
    }
    case "set_volume": {
      const percent = parsePercent(value);
      if (percent == null) throw new DeviceError("What volume, from 0 to 100?", { code: "EVALUE" });
      const r = await phone("volume", { action: "set", percent });
      return done(`Volume ${r.volume}%.`);
    }
    default:
      return null;
  }
}

// "in this computer's browser" / "on this phone"
const where = () => (onPhone() ? "on this phone" : "in this computer's browser");

export default {
  id: "self",
  get label() {
    return onPhone() ? "This phone" : "This computer";
  },

  async act(device, action, value, ctx) {
    if (onPhone() && PHONE_ACTIONS.includes(action)) {
      const r = await phoneAct(device, action, value, ctx);
      if (r) return r;
    }
    const open = ctx.openUrl || openInBrowser;
    switch (action) {
      case "web_search": {
        const q = String(need(value, "search"));
        await open(webSearchUrl(q));
        return done(`Searching the web for “${q}” ${where()}.`);
      }
      case "open_website": {
        const url = websiteOrSearch(value);
        await open(url);
        return done(`Opened ${url.replace(/^https:\/\//, "").replace(/\/$/, "")} ${where()}.`);
      }
      case "search_youtube": {
        const q = String(need(value, "search"));
        await open(youtubeSearchUrl(q));
        let results = null;
        if (ctx.youtube?.apiKey) {
          results = await searchYouTube(q, { apiKey: ctx.youtube.apiKey, base: ctx.youtube.base, max: 5 }).catch(() => null);
          if (results) {
            ctx.memory?.set(`yt:${device.id}`, results);
            ctx.memory?.set("yt:last", results);
          }
        }
        return done(`YouTube's results for “${q}” are open ${where()}.${results?.length ? ` The top ones are: ${describeResults(results, 3)}.` : ""}`, { results: results?.map(({ id, title, channel, duration }) => ({ id, title, channel, duration })) });
      }
      case "play_youtube": {
        const v = String(need(value, "video")).trim();
        let id = videoIdFrom(v);
        let title = null;
        const idx = id ? null : pickIndex(v);
        if (idx != null) {
          const last = ctx.memory?.get(`yt:${device.id}`) || ctx.memory?.get("yt:last");
          const hit = last && (idx === -1 ? last.at(-1) : last[idx]);
          if (!hit) throw new DeviceError("I don't have search results to pick from. What should I look for?", { code: "EVALUE" });
          ({ id, title } = hit);
        }
        if (!id && ctx.youtube?.apiKey) {
          const results = await searchYouTube(v, { apiKey: ctx.youtube.apiKey, base: ctx.youtube.base, max: 5 }).catch((err) => {
            throw new DeviceError(err.message, { code: err.code || "EYTSEARCH" });
          });
          if (results[0]) ({ id, title } = results[0]);
        }
        if (!id) {
          await open(youtubeSearchUrl(v));
          return done(`I opened YouTube's results for “${v}” ${where()}; ${onPhone() ? "tap" : "click"} the one you want. (With a YouTube key in Settings I can pick it for you.)`);
        }
        await open(watchUrl(id));
        return done(`Playing ${title ? `“${title}”` : "the video"} ${where()}.`);
      }
      default:
        throw unsupported(device, action);
    }
  },
};
