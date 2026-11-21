// What every TV driver shares: understanding "channel 7.1" / "next channel" / "ESPN", app names on
// each platform, and the YouTube and web flows (search, pick a result, play it on the TV).
import { normalizeText } from "../util.mjs";
import { describeResults, searchYouTube, videoIdFrom, webSearchUrl, websiteUrl } from "../net/youtube.mjs";
import { DeviceError, done, need } from "./common.mjs";

export const TV_ACTIONS = ["set_channel", "channel_up", "channel_down", "launch_app", "search_youtube", "play_youtube", "web_search", "open_website", "type_text", "press_button"];

const SMALL = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "seven" → 7, "twenty one" → 21, "two hundred six" → 206; null when it isn't a number in words. */
export function wordsToNumber(text) {
  const words = normalizeText(text).replace(/\band\b/g, " ").split(" ").filter(Boolean);
  if (!words.length) return null;
  let total = 0;
  let cur = 0;
  for (const w of words) {
    if (Object.hasOwn(SMALL, w)) cur += SMALL[w];
    else if (Object.hasOwn(TENS, w)) cur += TENS[w];
    else if (w === "hundred") cur = (cur || 1) * 100;
    else if (w === "thousand") {
      total += (cur || 1) * 1000;
      cur = 0;
    } else if (/^\d+$/.test(w)) cur += Number(w);
    else return null;
  }
  return total + cur;
}

/**
 * Channel requests → { dir: "up"|"down" } | { major, minor, number } | { name }.
 * Understands "7", "7.1", "7-1", "7 dash 1", "channel 206", "seven point one", "next", "previous", "ESPN".
 */
export function parseChannel(value) {
  let s = normalizeText(need(value, "channel")).replace(/\bchannel\b/g, " ").replace(/\s+/g, " ").trim();
  if (/^(up|next|plus|higher|forward)( one)?$/.test(s)) return { dir: "up" };
  if (/^(down|previous|prev|back|minus|lower|last)( one)?$/.test(s)) return { dir: "down" };
  const raw = String(value).trim();
  const digits = raw.match(/^(?:ch(?:annel)?\.?\s*)?(\d{1,4})(?:\s*(?:[.\-–_ ]|dash|point|dot)\s*(\d{1,3}))?$/i);
  if (digits) return channelNumber(Number(digits[1]), digits[2] != null ? Number(digits[2]) : null);
  const parts = s.split(/ (?:dash|point|dot) /);
  if (parts.length <= 2) {
    const major = wordsToNumber(parts[0]);
    const minor = parts[1] != null ? wordsToNumber(parts[1]) : null;
    if (major != null && (parts[1] == null || minor != null)) return channelNumber(major, minor);
  }
  s = String(value).replace(/^\s*(the\s+)?channel\s+/i, "").trim();
  return { name: s };
}

function channelNumber(major, minor) {
  return { major, minor, number: minor != null ? `${major}.${minor}` : String(major) };
}

/** Well-known apps and their ids on each platform (the TV's own app list is always checked first). */
export const APPS = [
  { key: "youtube", names: ["youtube"], roku: "837", samsung: ["111299001912"], lg: ["youtube.leanback.v4"], android: ["com.google.android.youtube.tv", "com.amazon.firetv.youtube", "com.google.android.youtube.googletv"] },
  { key: "netflix", names: ["netflix"], roku: "12", samsung: ["3201907018807", "11101200001"], lg: ["netflix"], android: ["com.netflix.ninja"] },
  { key: "prime", names: ["prime video", "amazon prime", "prime", "amazon video", "amazon prime video"], roku: "13", samsung: ["3201910019365", "3201512006785"], lg: ["amazon"], android: ["com.amazon.amazonvideo.livingroom", "com.amazon.avod"] },
  { key: "disney", names: ["disney plus", "disney+", "disney"], roku: "291097", samsung: ["3201901017640"], lg: ["com.disney.disneyplus-prod"], android: ["com.disney.disneyplus"] },
  { key: "hulu", names: ["hulu"], roku: "2285", samsung: ["3201601007625"], lg: ["hulu"], android: ["com.hulu.livingroomplus", "com.hulu.plus"] },
  { key: "max", names: ["max", "hbo max", "hbo"], roku: "61322", samsung: ["3201601007230"], lg: ["com.hbo.hbomax"], android: ["com.wbd.stream", "com.hbo.hbonow"] },
  { key: "appletv", names: ["apple tv", "apple tv plus", "apple tv+"], roku: "551012", samsung: ["3201807016597"], lg: ["com.apple.appletv"], android: ["com.apple.atve.amazon.appletv", "com.apple.atve.androidtv.appletv"] },
  { key: "spotify", names: ["spotify"], roku: "22297", samsung: ["3201606009684"], lg: ["spotify-beehive"], android: ["com.spotify.tv.android"] },
  { key: "plex", names: ["plex"], roku: "13535", samsung: ["3201512006963"], lg: ["cdp-30"], android: ["com.plexapp.android"] },
  { key: "pluto", names: ["pluto tv", "pluto"], roku: "74519", samsung: ["3201808016802"], lg: [], android: ["tv.pluto.android"] },
  { key: "peacock", names: ["peacock"], roku: "593099", samsung: [], lg: [], android: ["com.peacocktv.peacockandroid"] },
  { key: "paramount", names: ["paramount plus", "paramount+", "paramount"], roku: "31440", samsung: [], lg: [], android: ["com.cbs.ott"] },
  { key: "youtubetv", names: ["youtube tv"], roku: "195316", samsung: [], lg: [], android: ["com.google.android.youtube.tvunplugged"] },
  { key: "youtubemusic", names: ["youtube music"], roku: "", samsung: [], lg: [], android: ["com.google.android.youtube.tvmusic"] },
  { key: "kodi", names: ["kodi"], roku: "", samsung: [], lg: [], android: ["org.xbmc.kodi"] },
  { key: "browser", names: ["browser", "web browser", "internet", "silk", "chrome"], roku: "", samsung: ["org.tizen.browser"], lg: ["com.webos.app.browser"], android: ["com.amazon.cloud9", "com.android.chrome", "org.chromium.chrome"] },
  { key: "livetv", names: ["live tv", "tv", "antenna", "tv guide", "guide"], roku: "tvinput.dtv", samsung: [], lg: ["com.webos.app.livetv"], android: ["com.google.android.tv", "com.android.tv", "com.amazon.tv.livetv"] },
  { key: "settings", names: ["settings"], roku: "", samsung: [], lg: ["com.palm.app.settings"], android: ["com.android.tv.settings", "com.amazon.tv.settings.v2"] },
  { key: "vlc", names: ["vlc", "vlc player", "vlc media player"], roku: "", samsung: [], lg: [], android: ["org.videolan.vlc"] },
  { key: "twitch", names: ["twitch"], roku: "", samsung: [], lg: [], android: ["tv.twitch.android.app", "tv.twitch.android.viewer"] },
  { key: "tubi", names: ["tubi", "tubi tv"], roku: "41468", samsung: [], lg: [], android: ["com.tubitv"] },
  { key: "crunchyroll", names: ["crunchyroll"], roku: "2595", samsung: [], lg: [], android: ["com.crunchyroll.crunchyroid"] },
  { key: "sling", names: ["sling", "sling tv"], roku: "46041", samsung: [], lg: [], android: ["com.sling"] },
  { key: "espn", names: ["espn"], roku: "34376", samsung: [], lg: [], android: ["com.espn.score_center", "com.espn.gtv"] },
  { key: "iplayer", names: ["bbc iplayer", "iplayer"], roku: "", samsung: [], lg: [], android: ["uk.co.bbc.iplayer"] },
  { key: "itvx", names: ["itvx", "itv x", "itv"], roku: "", samsung: [], lg: [], android: ["air.ITVMobilePlayer"] },
  { key: "youtubekids", names: ["youtube kids"], roku: "", samsung: [], lg: [], android: ["com.google.android.youtube.tvkids"] },
  { key: "amazonmusic", names: ["amazon music"], roku: "", samsung: [], lg: [], android: ["com.amazon.music.tv", "com.amazon.mp3"] },
  { key: "steamlink", names: ["steam link", "steam"], roku: "", samsung: [], lg: [], android: ["com.valvesoftware.steamlink"] },
  { key: "moonlight", names: ["moonlight"], roku: "", samsung: [], lg: [], android: ["com.limelight"] },
  { key: "jellyfin", names: ["jellyfin"], roku: "592369", samsung: [], lg: [], android: ["org.jellyfin.androidtv"] },
  { key: "downloader", names: ["downloader"], roku: "", samsung: [], lg: [], android: ["com.esaba.downloader"] },
  { key: "tvbro", names: ["tv bro", "tvbro"], roku: "", samsung: [], lg: [], android: ["com.phlox.tvwebbrowser"] },
];

/** Names of the TV apps made with Patch, by their app id (kept up to date by Patch's app maker). */
// ── The remote's buttons ─────────────────────────────────────────────────────
// One way of naming buttons for every TV, and of saying several at once: "down three times",
// "down, down, right, OK", "hold Home". Each driver turns the names into its own codes.

/** What people call each button. The key is the name the drivers use. */
const BUTTON_WORDS = {
  up: ["up", "arrow up", "up arrow"],
  down: ["down", "arrow down", "down arrow"],
  left: ["left", "arrow left", "left arrow"],
  right: ["right", "arrow right", "right arrow"],
  ok: ["ok", "okay", "select", "enter", "center", "centre", "confirm", "choose", "click", "middle"],
  back: ["back", "return", "go back"],
  home: ["home", "home screen"],
  menu: ["menu", "options", "option", "three lines", "star"],
  settings: ["settings", "setup", "gear", "quick settings"],
  exit: ["exit", "close"],
  info: ["info", "information", "details", "display"],
  guide: ["guide", "tv guide", "programme guide", "program guide"],
  search: ["search", "find", "magnifying glass"],
  play: ["play", "resume"],
  pause: ["pause"],
  "play pause": ["play pause", "playpause", "pause play", "play or pause"],
  stop: ["stop"],
  rewind: ["rewind", "rw", "reverse", "skip back", "go back ten seconds"],
  "fast forward": ["fast forward", "fastforward", "ff", "forward", "fwd", "skip forward", "skip ahead"],
  next: ["next", "skip", "next track", "next one"],
  previous: ["previous", "prev", "previous track", "last track"],
  replay: ["replay", "instant replay"],
  "volume up": ["volume up", "vol up", "louder"],
  "volume down": ["volume down", "vol down", "quieter"],
  mute: ["mute", "unmute", "silence"],
  "channel up": ["channel up", "ch up", "channel plus"],
  "channel down": ["channel down", "ch down", "channel minus"],
  "previous channel": ["previous channel", "last channel", "recall"],
  power: ["power", "power button", "on off"],
  input: ["input", "source", "inputs", "sources"],
  recent: ["recent", "recents", "recent apps", "app switcher"],
  apps: ["apps", "all apps", "app list"],
  captions: ["captions", "subtitles", "closed captions", "cc"],
  backspace: ["backspace", "delete", "erase"],
  dash: ["dash", "hyphen"],
  dot: ["dot", "point", "period"],
  red: ["red", "red button"],
  green: ["green", "green button"],
  yellow: ["yellow", "yellow button"],
  blue: ["blue", "blue button"],
};
const BUTTON_BY_WORDS = new Map();
for (const [name, words] of Object.entries(BUTTON_WORDS)) for (const w of words) BUTTON_BY_WORDS.set(w, name);
const COUNT_WORDS = { once: 1, twice: 2, thrice: 3, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
// Words that only join buttons together, or mean "press".
const BUTTON_FILLER = new Set(["press", "push", "hit", "tap", "the", "a", "button", "buttons", "key", "keys", "then", "and", "arrow", "please", "go", "move", "on", "remote", "it", "to", "now", "after", "that", "followed", "by"]);
// Buttons people press over and over, so "3 down" is down three times, not the 3 button and then down.
const BUTTON_REPEATS = new Set(["up", "down", "left", "right", "back", "volume up", "volume down", "channel up", "channel down", "rewind", "fast forward", "next", "previous", "replay", "backspace"]);
export const MAX_PRESSES = 40;

/** How a button is said to a person: "OK", "Home", "volume up". */
export const buttonLabel = (name) => (name === "ok" ? "OK" : name === "play pause" ? "Play/Pause" : / /.test(name) || /^(up|down|left|right|\d)$/.test(name) ? name : name[0].toUpperCase() + name.slice(1));

/**
 * What to press, from what was asked: [{ button, times, hold }], in order.
 * "down 3", "down three times", "right x2 then ok", "down, down, ok", "hold home", "7 1" (digits).
 * A number after a button is how many times, and so is one just before a button that's pressed
 * over and over ("3 down"); a number by itself is that number's button.
 */
export function parseButtons(value) {
  const said = need(value, "button");
  const steps = [];
  const unknown = [];
  // Commas, "then" and "and" keep buttons apart: "OK, 7" is two buttons, "OK 7" is OK seven times.
  for (const part of String(said).split(/[,;>\n\u2192]|\bthen\b|\band\b|\bfollowed by\b/i)) buttonsIn(part, steps, unknown);
  if (unknown.length || !steps.length) {
    throw new DeviceError(`I don't know the button “${unknown.join(" ") || said}”. The buttons I know are up, down, left, right, OK, back, home, menu, play, pause, rewind, fast forward, volume up and down, mute, channel up and down, info, guide, search, settings, power, input and the numbers. Say several with commas (“down, down, OK”) or a count (“right 3”).`, { code: "EVALUE" });
  }
  // "down, down, down" is "down three times".
  for (let k = steps.length - 1; k > 0; k--) {
    if (steps[k].button === steps[k - 1].button && steps[k].hold === steps[k - 1].hold && !steps[k].hold && !/^\d$/.test(steps[k].button)) {
      steps[k - 1].times += steps[k].times;
      steps.splice(k, 1);
    }
  }
  const total = steps.reduce((n, st) => n + st.times, 0);
  if (steps.some((st) => st.times > 20) || total > MAX_PRESSES) throw new DeviceError(`That's ${total} presses, more than I'll do in one go (${MAX_PRESSES}). Ask for fewer at a time.`, { code: "EVALUE" });
  return steps;
}

/** The buttons in one part of what was said (between commas), added to `steps`. */
function buttonsIn(part, steps, unknown) {
  const words = normalizeText(String(part).replace(/(\d)\s*x\b/gi, "$1 times").replace(/\bx\s*(\d)/gi, " times $1")).split(" ").filter(Boolean);
  let hold = false;
  let ahead = 0; // "3 times down": a count said before its button
  let i = 0;
  const first = steps.length; // nothing from this part yet
  const count = (w) => (/^\d{1,2}$/.test(w) ? Number(w) : Object.hasOwn(COUNT_WORDS, w) ? COUNT_WORDS[w] : null);
  // The longest button name that starts at word `at`.
  const nameAt = (at) => {
    for (let len = Math.min(4, words.length - at); len >= 1; len--) {
      const name = BUTTON_BY_WORDS.get(words.slice(at, at + len).join(" "));
      if (name) return { name, len };
    }
    return null;
  };
  while (i < words.length) {
    const w = words[i];
    // "hold home", "long press ok", "press and hold select", "hold down the home button".
    if (w === "hold" || w === "holding" || (w === "long" && /^(press|pressing|hold)$/.test(words[i + 1] || ""))) {
      hold = true;
      i += w === "long" ? 2 : 1;
      // "hold down <button>": the "down" belongs to "hold", unless nothing else follows.
      if (words[i] === "down" && words.slice(i + 1).some((x) => !BUTTON_FILLER.has(x))) i++;
      continue;
    }
    if (w === "times" || w === "time") {
      // "3 times" after a button was taken with the number; "times 3" (from "x3") counts the last button.
      const n = count(words[i + 1] || "");
      if (n != null && steps.length) {
        steps[steps.length - 1].times = n;
        i += 2;
      } else i++;
      continue;
    }
    const hit = nameAt(i);
    if (hit) {
      const said = ahead;
      steps.push({ button: hit.name, times: ahead || 1, hold });
      hold = false;
      ahead = 0;
      i += hit.len;
      // How many: "down 3", "down three times", "down twice".
      const n = count(words[i] || "");
      const counted = n != null && !said && (/^(times?|x)$/.test(words[i + 1] || "") || !/^\d$/.test(words[i]) || !/^\d$/.test(words[i + 1] || ""));
      if (n != null && counted && n >= 1) {
        steps[steps.length - 1].times = n;
        i += /^(times?)$/.test(words[i + 1] || "") ? 2 : 1;
      }
      continue;
    }
    // "3 times down", "twice right": the count comes first.
    if (count(w) != null && /^(times?)$/.test(words[i + 1] || "") && words.slice(i + 2).some((x) => BUTTON_BY_WORDS.has(x))) {
      ahead = count(w);
      i += 2;
      continue;
    }
    // "3 down", "two right": the same, said shorter. Only at the start of a part and only for buttons
    // pressed over and over, so "7 1" and "1 2 3 ok" stay number buttons.
    if (count(w) != null && count(w) >= 1 && steps.length === first && !ahead && BUTTON_REPEATS.has(nameAt(i + 1)?.name)) {
      ahead = count(w);
      i++;
      continue;
    }
    if (/^\d+$/.test(w)) {
      // A number by itself: its digits are buttons ("7 1", "206").
      for (const d of w) steps.push({ button: d, times: 1, hold });
      hold = false;
      i++;
      continue;
    }
    if (Object.hasOwn(COUNT_WORDS, w) && !/^(once|twice|thrice)$/.test(w)) {
      // "seven" by itself is the 7 button; "ten" is 1 then 0.
      for (const d of String(COUNT_WORDS[w])) steps.push({ button: d, times: 1, hold });
      hold = false;
      i++;
      continue;
    }
    if (!BUTTON_FILLER.has(w) && !/^(once|twice|thrice)$/.test(w)) unknown.push(w);
    else if (/^(twice|thrice)$/.test(w) && steps.length) steps[steps.length - 1].times = COUNT_WORDS[w];
    i++;
  }
}

/** "Pressed down three times, then OK" / "Held Home". */
export function describeButtons(steps) {
  const many = (n) => (n === 1 ? "" : n === 2 ? " twice" : ` ${["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] || n} times`);
  const parts = steps.map((st, i) => `${st.hold ? (i ? "held " : "Held ") : i ? "" : "Pressed "}${buttonLabel(st.button)}${many(st.times)}`);
  return parts.length > 4 && steps.every((st) => /^\d$/.test(st.button)) ? `Pressed ${steps.map((st) => st.button).join(" ")}` : parts.join(", then ");
}

/** Each step as a driver's own code: `codes` is { button name: code } and `digit` makes a code for 0-9. Throws for a button this TV's remote doesn't have. */
export function buttonCodes(steps, codes, { digit = null, device = "This TV" } = {}) {
  return steps.map((st) => {
    const code = /^\d$/.test(st.button) ? (digit ? digit(st.button) : null) : Object.hasOwn(codes, st.button) ? codes[st.button] : null;
    if (!code) throw new DeviceError(`${device} doesn't have ${/^\d$/.test(st.button) ? "number buttons" : `a ${buttonLabel(st.button)} button`} that I can press.`, { code: "EUNSUPPORTED" });
    return { ...st, code };
  });
}

export const customAppNames = new Map();

/**
 * What to look for in a TV's app store: "Plex", a Google Play link, market://details?id=…,
 * amzn://apps/android?p=… or an app id like "org.videolan.vlc" → { pkg, query }.
 */
export function storeLink(value) {
  const v = String(value ?? "").trim();
  let m = v.match(/^(?:https?:\/\/play\.google\.com\/store\/apps\/details|market:\/\/details)\?(?:.*&)?id=([A-Za-z][\w]*(?:\.[\w]+)+)/i);
  if (m) return { pkg: m[1], query: m[1] };
  m = v.match(/^amzn:\/\/apps\/android\?(?:.*&)?p=([A-Za-z][\w]*(?:\.[\w]+)+)/i);
  if (m) return { pkg: m[1], query: m[1] };
  if (/^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$/i.test(v) && !/\.(com|org|net|co|uk|tv|io|de|fr)$/i.test(v)) return { pkg: v, query: v };
  return { pkg: null, query: v.replace(/^(the|an?)\s+/i, "").replace(/\s+app$/i, "") };
}

/** The well-known app a spoken name refers to ("disney plus" → the Disney+ entry), or null. */
export function knownApp(name) {
  const n = normalizeText(name).replace(/\bapp\b/g, "").trim();
  if (!n) return null;
  return APPS.find((a) => a.names.some((x) => normalizeText(x) === n)) || APPS.find((a) => a.names.some((x) => n.startsWith(`${normalizeText(x)} `) && normalizeText(x).length > 3)) || null;
}

const ORDINALS = { first: 1, top: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, last: -1 };

/** "2", "#2", "the second one", "number 3" → index into the last results, or null. */
export function pickIndex(value) {
  const s = normalizeText(value).replace(/\b(the|one|video|result|number|no|please|play)\b/g, " ").trim();
  if (/^#?\d{1,2}$/.test(s)) return Number(s.replace("#", "")) - 1;
  if (Object.hasOwn(ORDINALS, s)) return ORDINALS[s] === -1 ? -1 : ORDINALS[s] - 1;
  return null;
}

/**
 * Search YouTube for a TV.
 *  - showOnTv(query): the TV's own YouTube app shows the results; resolves true (or a phrase like
 *    "in YouTube") if it could.
 *  - browserSearch(query): fallback that opens YouTube's results page in the TV's web browser.
 *  - openYouTube(): just opens the YouTube app.
 * With a YouTube key, the top results also come back so the person can pick one to play.
 */
export async function youtubeSearch(device, query, ctx, { showOnTv, browserSearch, openYouTube } = {}) {
  const q = String(need(query, "search")).trim();
  let results = null;
  let keyProblem = null;
  if (ctx.youtube?.apiKey) {
    try {
      results = await searchYouTube(q, { apiKey: ctx.youtube.apiKey, base: ctx.youtube.base, max: 5 });
      ctx.memory?.set(`yt:${device.id}`, results);
      ctx.memory?.set("yt:last", results);
    } catch (err) {
      keyProblem = err.message;
    }
  }
  const where = (w) => (typeof w === "string" ? ` ${w}` : "");
  let shown = false;
  if (showOnTv) shown = await showOnTv(q).catch(() => false);
  const list = results?.length ? describeResults(results, 3) : "";
  const extra = { results: results?.map(({ id, title, channel, duration, live }) => ({ id, title, channel, duration, live })) };
  if (shown) return done(`Showing YouTube results for “${q}” on ${device.name}${where(shown)}.${list ? ` The top ones are: ${list}.` : ""}`, extra);
  if (results?.length) return done(`Top YouTube results for “${q}”: ${list}. Which one should I play on ${device.name}?`, extra);
  if (results && !results.length) return done(`YouTube found nothing for “${q}”.`, extra);
  if (browserSearch) {
    const w = await browserSearch(q);
    return done(`Showing YouTube results for “${q}” on ${device.name}${where(w)}.${keyProblem ? ` (YouTube search through Patch didn't work: ${keyProblem})` : " With a free YouTube API key in Patch's Settings I could also read out the results and play the one you pick in the YouTube app."}`);
  }
  if (openYouTube) await openYouTube();
  throw new DeviceError(
    `${openYouTube ? `YouTube is open on ${device.name}, but this TV can't take a search from Patch` : `${device.name} can't search YouTube from Patch`}${keyProblem ? ` and the YouTube search didn't work: ${keyProblem}` : ""}. ${keyProblem ? "" : "Add a free YouTube API key in Patch's Settings and I'll find videos and play the one you pick. "}Or use the TV remote's microphone to search.`,
    { code: keyProblem ? "EYTSEARCH" : "ENOYTKEY", hint: "Settings → YouTube search key" },
  );
}

/**
 * Work out which video to play: a link or id, "the second one" from the last search, or the top
 * search result for a phrase. Returns { id, title } or { query } when there's no way to pick.
 */
export async function youtubeVideo(device, value, ctx) {
  const v = String(need(value, "video")).trim();
  const id = videoIdFrom(v);
  if (id) {
    const known = [...(ctx.memory?.get(`yt:${device.id}`) || []), ...(ctx.memory?.get("yt:last") || [])].find((r) => r.id === id);
    return { id, title: known?.title || null };
  }
  const idx = pickIndex(v);
  if (idx != null) {
    const last = ctx.memory?.get(`yt:${device.id}`) || ctx.memory?.get("yt:last");
    if (!last?.length) throw new DeviceError("I don't have any search results to pick from yet. What should I look for?", { code: "EVALUE" });
    const hit = idx === -1 ? last.at(-1) : last[idx];
    if (!hit) throw new DeviceError(`There were only ${last.length} results.`, { code: "EVALUE" });
    return { id: hit.id, title: hit.title };
  }
  if (!ctx.youtube?.apiKey) return { query: v };
  const results = await searchYouTube(v, { apiKey: ctx.youtube.apiKey, base: ctx.youtube.base, max: 5 }).catch((err) => {
    throw new DeviceError(err.message, { code: err.code || "EYTSEARCH" });
  });
  if (!results.length) throw new DeviceError(`YouTube found nothing for “${v}”.`, { code: "ENOTHING" });
  ctx.memory?.set(`yt:${device.id}`, results);
  ctx.memory?.set("yt:last", results);
  return { id: results[0].id, title: results[0].title, results };
}

/**
 * play_youtube for a TV: playVideo(id) starts it. Without a YouTube key a phrase can't be turned into
 * a video, so the TV shows YouTube's results instead (showOnTv, then browserSearch).
 */
export async function youtubePlay(device, value, ctx, { playVideo, showOnTv, browserSearch }) {
  const pick = await youtubeVideo(device, value, ctx);
  if (pick.query) {
    for (const show of [showOnTv, browserSearch]) {
      if (!show) continue;
      const w = await show(pick.query).catch(() => false);
      if (w) return done(`I can't pick a video by name without a YouTube key, so YouTube's results for “${pick.query}” are on ${device.name}${typeof w === "string" ? ` ${w}` : ""} now. Choose one with the remote, or add a free YouTube key in Settings so I can pick for you.`);
    }
    throw new DeviceError(`To play something by name I need a free YouTube API key in Patch's Settings. With a link or video id I can play it right away.`, { code: "ENOYTKEY", hint: "Settings → YouTube search key" });
  }
  await playVideo(pick.id);
  return done(`Playing ${pick.title ? `“${pick.title}”` : "the video"} on ${device.name}.`, { state: { ...device.state, on: true, app: "YouTube" } });
}

/** A web address for open_website (or a search when it isn't an address). */
export function websiteOrSearch(value) {
  const v = String(need(value, "website")).trim();
  return websiteUrl(v) || webSearchUrl(v);
}

export { webSearchUrl };
