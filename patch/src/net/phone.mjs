// Talking to the Android app that Patch runs inside: it reads and uses the phone's screen, opens apps
// and web pages, plays music and presses media keys. The app gives Patch's server a private address
// and secret (PATCH_PHONE_BRIDGE, PATCH_PHONE_TOKEN) for this.
import { DeviceError } from "../drivers/common.mjs";

/** True when the Android app's bridge is there to ask. */
export const hasPhoneBridge = (env = process.env) => !!(env.PATCH_PHONE_BRIDGE && env.PATCH_PHONE_TOKEN);

/** Sends one command to the phone. Throws a DeviceError with the phone's own explanation if it can't. */
export async function phone(command, body = {}, { timeout = 12_000, env = process.env } = {}) {
  if (!hasPhoneBridge(env)) throw new DeviceError("That only works in the Patch app on an Android phone.", { code: "ENOPHONE" });
  let r;
  try {
    const res = await fetch(`${env.PATCH_PHONE_BRIDGE}/${command}`, {
      method: "POST",
      headers: { "x-patch-phone": env.PATCH_PHONE_TOKEN, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    r = await res.json();
  } catch {
    throw new DeviceError("The phone didn't answer. Try again in a moment.", { code: "EPHONE" });
  }
  if (!r.ok) throw new DeviceError(r.message || "The phone couldn't do that.", { code: r.code || "EPHONE" });
  return r;
}

/** What's on the screen, as a short numbered list for the voice agent (and a one-line summary). */
export function describeScreen(s) {
  const items = s.items || [];
  const lines = items.map((it) => `${it.n}. ${it.kind}: ${it.text}${it.state ? ` (${it.state})` : ""}`);
  const app = s.app || "the screen";
  const tail = s.full ? "(There's more; I only listed the first part.)" : s.more ? "(It scrolls: there's more above or below.)" : "";
  return {
    summary: items.length ? `${app}: ${items.length} things on screen.` : `Nothing readable on ${app} right now.`,
    text: [`On screen: ${app}.`, ...lines, tail].filter(Boolean).join("\n"),
  };
}

// Buttons that can spend money, send something, delete something or change who can do what:
// Patch asks the person before tapping these, even when the agent is sure.
const RISKY = /\b(buy|pay|payment|purchase|order|checkout|check out|subscribe|donate|send|transfer|delete|remove|erase|uninstall|install|sign out|log out|logout|reset|confirm|book|call|dial|post|publish|allow)\b/i;

export const riskyButton = (text) => RISKY.test(String(text || ""));

const MUSIC_APPS = ["spotify", "youtube music", "yt music", "amazon music", "apple music", "deezer", "tidal", "pandora", "soundcloud"];

/**
 * "Bohemian Rhapsody by Queen on Spotify" → { query: "Bohemian Rhapsody by Queen", app: "spotify", kind: null }.
 * Also notices "playlist" and "album" so the music app looks for the right thing.
 */
export function parseMusicRequest(value) {
  let query = String(value ?? "").trim();
  let app = null;
  const m = query.match(new RegExp(`\\s+(?:on|in|with|using|from)\\s+(${MUSIC_APPS.join("|")})\\s*$`, "i"));
  if (m) {
    app = m[1].toLowerCase();
    query = query.slice(0, m.index).trim();
  }
  const kind = /\bplaylist\b/i.test(query) ? "playlist" : /\balbum\b/i.test(query) ? "album" : null;
  return { query, app, kind };
}
