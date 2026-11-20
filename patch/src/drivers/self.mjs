// The computer Patch runs on: web searches, websites and YouTube open in its default browser.
import { execFile } from "node:child_process";
import { describeResults, searchYouTube, videoIdFrom, watchUrl, webSearchUrl, youtubeSearchUrl } from "../net/youtube.mjs";
import { DeviceError, done, need, unsupported } from "./common.mjs";
import { pickIndex, websiteOrSearch } from "./tv.mjs";

/** Opens a web address in this computer's default browser (no shell involved, so nothing in the URL runs). */
export function openInBrowser(url) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new DeviceError("I only open web pages (http or https).");
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

export default {
  id: "self",
  label: "This computer",

  async act(device, action, value, ctx) {
    const open = ctx.openUrl || openInBrowser;
    switch (action) {
      case "web_search": {
        const q = String(need(value, "search"));
        await open(webSearchUrl(q));
        return done(`Searching the web for “${q}” in this computer's browser.`);
      }
      case "open_website": {
        const url = websiteOrSearch(value);
        await open(url);
        return done(`Opened ${url.replace(/^https:\/\//, "").replace(/\/$/, "")} in this computer's browser.`);
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
        return done(`YouTube's results for “${q}” are open in this computer's browser.${results?.length ? ` The top ones are: ${describeResults(results, 3)}.` : ""}`, { results: results?.map(({ id, title, channel, duration }) => ({ id, title, channel, duration })) });
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
          return done(`I opened YouTube's results for “${v}” in this computer's browser; click the one you want. (With a YouTube key in Settings I can pick it for you.)`);
        }
        await open(watchUrl(id));
        return done(`Playing ${title ? `“${title}”` : "the video"} in this computer's browser.`);
      }
      default:
        throw unsupported(device, action);
    }
  },
};
