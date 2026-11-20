// Fire TV, Android TV and Google TV devices (sticks, boxes, and TVs from Sony, TCL, Hisense,
// Philips…), controlled over ADB once "ADB debugging" / "Network debugging" is switched on in the
// device's developer options. Volume and play/pause also work over Google Cast when the device
// has it, with or without ADB.
import { AdbClient, newAdbKey, shellQuote } from "../net/adb.mjs";
import { fireTvModel } from "../net/models.mjs";
import { watchUrl, youtubeSearchUrl } from "../net/youtube.mjs";
import { fuzzyPick, normalizeText, sleep } from "../util.mjs";
import cast from "./cast.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";
import { APPS, knownApp, parseChannel, webSearchUrl, websiteOrSearch, youtubePlay, youtubeSearch } from "./tv.mjs";

const KEYS = {
  power: "KEYCODE_POWER", home: "KEYCODE_HOME", back: "KEYCODE_BACK", menu: "KEYCODE_MENU", settings: "KEYCODE_SETTINGS", up: "KEYCODE_DPAD_UP",
  down: "KEYCODE_DPAD_DOWN", left: "KEYCODE_DPAD_LEFT", right: "KEYCODE_DPAD_RIGHT", ok: "KEYCODE_DPAD_CENTER", select: "KEYCODE_DPAD_CENTER",
  enter: "KEYCODE_DPAD_CENTER", play: "KEYCODE_MEDIA_PLAY", pause: "KEYCODE_MEDIA_PAUSE", "play pause": "KEYCODE_MEDIA_PLAY_PAUSE",
  stop: "KEYCODE_MEDIA_STOP", rewind: "KEYCODE_MEDIA_REWIND", "fast forward": "KEYCODE_MEDIA_FAST_FORWARD", forward: "KEYCODE_MEDIA_FAST_FORWARD",
  next: "KEYCODE_MEDIA_NEXT", previous: "KEYCODE_MEDIA_PREVIOUS", "volume up": "KEYCODE_VOLUME_UP", "volume down": "KEYCODE_VOLUME_DOWN",
  mute: "KEYCODE_VOLUME_MUTE", "channel up": "KEYCODE_CHANNEL_UP", "channel down": "KEYCODE_CHANNEL_DOWN", search: "KEYCODE_SEARCH",
  guide: "KEYCODE_GUIDE", info: "KEYCODE_INFO", input: "KEYCODE_TV_INPUT", source: "KEYCODE_TV_INPUT", recent: "KEYCODE_APP_SWITCH", apps: "KEYCODE_ALL_APPS",
};

const failed = (out) => /(^|\n)\s*(Error|Exception)\b|unable to resolve|No activities found|does not exist|monkey aborted|not found/i.test(out || "");
const safePkg = (p) => /^[A-Za-z0-9_.]+$/.test(p);

/** Friendly names for package ids (the TV only tells us the ids). */
const PKG_NAMES = Object.fromEntries(APPS.flatMap((a) => (a.android || []).map((p) => [p, a.names[0].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Youtube/, "YouTube").replace(/Tv\b/, "TV")])));
const appName = (pkg) => PKG_NAMES[pkg] || pkg.split(".").filter((x) => !/^(com|tv|org|android|amazon|google|app|apps|firetv|livingroom|leanback)$/.test(x)).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(" ") || pkg;

// Live connections, closed after a minute of quiet.
const clients = new Map();

function closeLater(id) {
  const c = clients.get(id);
  if (!c) return;
  clearTimeout(c.timer);
  c.timer = setTimeout(() => {
    c.client.close();
    clients.delete(id);
  }, 60_000);
  c.timer.unref?.();
}

async function adbKey(ctx) {
  if (ctx.secrets.adbKey) return ctx.secrets.adbKey;
  const pem = newAdbKey();
  await ctx.saveSecret(["adbKey"], pem);
  return pem;
}

function setupMessage(device) {
  const fire = /fire tv/i.test(`${device.brand} ${device.model}`) || device.brand === "Amazon";
  return fire
    ? `To let Patch open apps, YouTube and websites on ${device.name}: on the Fire TV go to Settings → My Fire TV → Developer options and turn on ADB debugging (no Developer options? Settings → My Fire TV → About, then select the device name 7 times). Then press Pair.`
    : `To let Patch open apps, YouTube and websites on ${device.name}: on the TV go to Settings → System → About and select "Android TV OS build" 7 times, then in Settings → System → Developer options turn on USB debugging and Network debugging. Then press Pair.`;
}

async function connect(device, ctx, { pairing = false } = {}) {
  const live = clients.get(device.id);
  if (live?.client.open) {
    closeLater(device.id);
    return live.client;
  }
  const key = await adbKey(ctx);
  let client;
  try {
    client = await AdbClient.connect(device.ref.ip, { port: device.ref.adbPort || 5555, privateKey: key, allowPrompt: pairing, promptTimeout: 45_000 });
  } catch (err) {
    if (err.code === "ECONNREFUSED") throw new DeviceError(setupMessage(device), { code: "ESETUP" });
    if (err.code === "ESETUP") {
      if (!pairing) await ctx.forgetSecret(["pairings", device.id]);
      throw new DeviceError(pairing ? `Nobody allowed Patch on ${device.name}. Press Pair again, then on the TV tick "Always allow from this computer" and choose Allow.` : `${device.name} hasn't allowed Patch yet. Press Pair, then choose Allow on the TV.`, { code: "ESETUP" });
    }
    throw err;
  }
  if (!ctx.secrets.pairings?.[device.id]?.adb) await ctx.saveSecret(["pairings", device.id], { adb: true, paired: true });
  clients.set(device.id, { client, timer: null });
  client.on("close", () => clients.get(device.id)?.client === client && clients.delete(device.id));
  closeLater(device.id);
  return client;
}

const sh = (client, cmd, timeout) => client.shell(cmd, { timeout });

async function packages(client, device) {
  const out = await sh(client, "pm list packages", 10_000);
  const list = out.split("\n").map((l) => l.replace(/^package:/, "").trim()).filter(safePkg);
  device.ref.packages = list;
  return list;
}

/** The package for a spoken app name, among what's installed. */
async function findPackage(client, device, name) {
  const list = device.ref.packages?.length ? device.ref.packages : await packages(client, device);
  const known = knownApp(name);
  const pkg = known?.android?.find((p) => list.includes(p));
  if (pkg) return pkg;
  const named = list.map((p) => ({ name: appName(p), pkg: p })).filter((x) => !/^com\.android\.|^android$/.test(x.pkg));
  const hit = fuzzyPick(name, named);
  if (hit) return hit.pkg;
  throw new DeviceError(`${name} doesn't seem to be installed on ${device.name}.`, { code: "ENOTINSTALLED" });
}

async function launchPkg(client, pkg) {
  if (!safePkg(pkg)) throw new DeviceError("That isn't an app name I can open.");
  let out = await sh(client, `monkey -p ${pkg} -c android.intent.category.LEANBACK_LAUNCHER 1`);
  if (failed(out)) out = await sh(client, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  if (failed(out)) throw new DeviceError(`The TV couldn't open ${appName(pkg)}.`, { code: "ENOTINSTALLED" });
}

async function view(client, url, pkg) {
  const out = await sh(client, `am start -a android.intent.action.VIEW -d ${shellQuote(url)}${pkg && safePkg(pkg) ? ` ${pkg}` : ""}`);
  return !failed(out);
}

async function key(client, ...codes) {
  for (const c of codes) await sh(client, `input keyevent ${c}`);
}

async function youtubePkg(client, device) {
  const list = device.ref.packages?.length ? device.ref.packages : await packages(client, device);
  return APPS.find((a) => a.key === "youtube").android.find((p) => list.includes(p)) || null;
}

async function liveState(client, device) {
  const [power, focus] = await Promise.all([sh(client, "dumpsys power | grep -m 1 mWakefulness=").catch(() => ""), sh(client, "dumpsys window | grep -m 2 -E 'mCurrentFocus|mFocusedApp'").catch(() => "")]);
  const wake = power.match(/mWakefulness=(\w+)/)?.[1];
  const pkg = focus.match(/\s([A-Za-z0-9_.]+)\/[A-Za-z0-9_.$]+/)?.[1];
  const st = { ...device.state, on: wake ? wake === "Awake" : true };
  if (pkg) st.app = /launcher|tvlauncher|amazon\.tv\.launcher|leanbacklauncher|com\.google\.android\.apps\.tv\.launcherx/i.test(pkg) ? "Home screen" : appName(pkg);
  return st;
}

/** Facts about the device from ADB (exact model, manufacturer, Android version). */
async function deviceFacts(client) {
  const props = client.banner?.props || {};
  const out = await sh(client, 'echo "$(getprop ro.product.manufacturer)|$(getprop ro.product.model)|$(getprop ro.build.version.release)|$(settings get global device_name)"').catch(() => "");
  const [maker, model, android, name] = out.trim().split("|");
  return { maker: maker || null, model: model || props["ro.product.model"] || null, android: android || null, name: name && name !== "null" ? name : null };
}

const CAST_ACTIONS = ["set_volume", "volume_up", "volume_down", "mute", "unmute", "play", "pause", "stop"];
const ADB_ACTIONS = ["turn_on", "turn_off", "launch_app", "press_button", "type_text", "search_youtube", "play_youtube", "web_search", "open_website", "volume_up", "volume_down", "mute", "play", "pause"];
const TV_EXTRA = ["set_channel", "channel_up", "channel_down"];

export function actionsFor({ kind, paired, cast: hasCast }) {
  const list = new Set();
  if (paired) ADB_ACTIONS.forEach((a) => list.add(a));
  if (paired && kind === "tv") TV_EXTRA.forEach((a) => list.add(a));
  if (hasCast) CAST_ACTIONS.forEach((a) => list.add(a));
  if (!paired) list.add("pair");
  return [...list, "rename", "set_room"];
}

export default {
  id: "androidtv",
  label: "Android TV / Fire TV",

  async detect(host, ctx) {
    const svc = (t) => host.mdns.find((s) => s.type === t);
    const amzn = svc("_amzn-wplay._tcp");
    const atv = svc("_androidtvremote2._tcp");
    const gcast = host.mdns.find((s) => s.type === "_googlecast._tcp" && s.txt?.id && !(Number(s.txt.ca) & 32));
    const dial = host.ssdp.map((r) => r.desc).find((d) => d && /amazon/i.test(d.manufacturer || "") && /^AFT/i.test(d.modelName || ""));
    const adbOpen = host.ports.has(5555);
    if (!amzn && !atv && !dial && !(adbOpen && /amazon|google|nvidia|xiaomi|sony|tcl|hisense|philips|tp vision|onn|walmart/i.test(host.vendor || ""))) return null;

    const fire = fireTvModel(dial?.modelName || amzn?.txt?.ad || amzn?.txt?.md);
    const isFire = !!(amzn || dial || fire || /amazon/i.test(host.vendor || ""));
    const md = gcast?.txt?.md || "";
    const kind = fire ? fire.kind : isFire ? "streamer" : /chromecast|shield|streamer|box|stick|mi box|onn/i.test(md) ? "streamer" : "tv";
    const name = gcast?.txt?.fn || atv?.name || amzn?.txt?.n || dial?.friendlyName || (isFire ? "Fire TV" : "Android TV");
    const id = `androidtv:${String(host.mac || gcast?.txt?.id || host.ip).replace(/:/g, "").toLowerCase()}`;
    const paired = !!ctx?.secrets.pairings?.[id]?.adb;
    const device = {
      id,
      driver: "androidtv",
      kind,
      brand: isFire ? "Amazon" : gcast ? (/google|chromecast/i.test(md) ? "Google" : host.vendor || null) : host.vendor || null,
      model: fire?.name || (md || (isFire ? "Fire TV" : "Android TV")),
      name,
      ip: host.ip,
      ref: { ip: host.ip, adbPort: 5555, cast: gcast ? { ip: host.ip, port: gcast.port || 8009 } : null },
      state: {},
      info: { os: isFire ? "Fire OS" : "Android TV / Google TV", modelNumber: fire?.code || null },
      actions: [],
    };
    device.setup = paired ? null : { kind: adbOpen ? "tv-prompt" : "adb", message: adbOpen ? `Press Pair, then on ${name} tick "Always allow from this computer" and choose Allow.` : setupMessage(device) };
    device.actions = actionsFor({ kind, paired, cast: !!gcast });
    if (paired && adbOpen) {
      // Exact model and current app straight from the device.
      try {
        const client = await connect(device, ctx);
        const facts = await deviceFacts(client);
        const ft = fireTvModel(facts.model);
        if (ft) Object.assign(device, { model: ft.name, kind: ft.kind });
        else if (facts.model) device.model = facts.maker && !facts.model.toLowerCase().includes(facts.maker.toLowerCase()) ? `${facts.maker} ${facts.model}` : facts.model;
        if (facts.maker && !isFire && !device.brand) device.brand = facts.maker;
        device.info = { ...device.info, modelNumber: facts.model, os: `${isFire ? "Fire OS" : "Android"}${facts.android ? ` (Android ${facts.android})` : ""}` };
        if (facts.name && !gcast?.txt?.fn) device.name = facts.name;
        device.state = await liveState(client, device);
        device.actions = actionsFor({ kind: device.kind, paired, cast: !!gcast });
      } catch {
        /* keep what discovery said; it may be asleep */
      }
    }
    return [device];
  },

  async refresh(device, ctx) {
    if (!ctx.secrets.pairings?.[device.id]?.adb) {
      if (device.ref.cast) {
        const r = await cast.refresh({ ...device, ref: device.ref.cast });
        return { state: { ...device.state, ...r.state } };
      }
      return null;
    }
    const client = await connect(device, ctx);
    return { state: await liveState(client, device) };
  },

  async act(device, action, value, ctx) {
    try {
      const paired = !!ctx.secrets.pairings?.[device.id]?.adb;
      if (device.ref.cast && CAST_ACTIONS.includes(action) && (!paired || ["set_volume", "unmute", "stop"].includes(action))) {
        return await cast.act({ ...device, ref: device.ref.cast }, action, value);
      }
      if (action === "pair") {
        const client = await connect(device, ctx, { pairing: true });
        const facts = await deviceFacts(client).catch(() => ({}));
        const ft = fireTvModel(facts.model);
        const kind = ft?.kind || device.kind;
        return done(`${device.name} is connected. You can open apps, YouTube and websites on it now.`, {
          devices: [{ id: device.id, setup: null, kind, actions: actionsFor({ kind, paired: true, cast: !!device.ref.cast }), ...(ft ? { model: ft.name } : facts.model ? { model: facts.model } : {}), info: { ...device.info, modelNumber: facts.model || device.info?.modelNumber || null } }],
        });
      }
      const client = await connect(device, ctx);
      switch (action) {
        case "turn_on":
          await key(client, "KEYCODE_WAKEUP");
          return done(`${device.name} is on.`, { state: { ...device.state, on: true } });
        case "turn_off":
          await key(client, "KEYCODE_SLEEP");
          return done(`${device.name} is asleep.`, { state: { ...device.state, on: false } });
        case "volume_up":
        case "volume_down": {
          const times = Math.min(Math.max(Number(value) || 3, 1), 20);
          for (let i = 0; i < times; i++) await key(client, action === "volume_up" ? "KEYCODE_VOLUME_UP" : "KEYCODE_VOLUME_DOWN");
          return done(`Turned ${device.name} ${action === "volume_up" ? "up" : "down"} ${times} steps.`);
        }
        case "mute":
          await key(client, "KEYCODE_VOLUME_MUTE");
          return done(`Toggled mute on ${device.name}.`);
        case "play":
        case "pause":
          await key(client, action === "play" ? "KEYCODE_MEDIA_PLAY" : "KEYCODE_MEDIA_PAUSE");
          return done(action === "play" ? "Playing." : "Paused.");
        case "channel_up":
        case "channel_down":
          await key(client, action === "channel_up" ? "KEYCODE_CHANNEL_UP" : "KEYCODE_CHANNEL_DOWN");
          return done(`Channel ${action === "channel_up" ? "up" : "down"} on ${device.name}.`);
        case "set_channel": {
          const ch = parseChannel(value);
          if (ch.dir) {
            await key(client, ch.dir === "up" ? "KEYCODE_CHANNEL_UP" : "KEYCODE_CHANNEL_DOWN");
            return done(`Channel ${ch.dir} on ${device.name}.`);
          }
          if (ch.name) {
            // Streaming channels on Android TV are apps ("put on ESPN" → the ESPN app).
            const pkg = await findPackage(client, device, ch.name).catch(() => null);
            if (!pkg) throw new DeviceError(`I can change ${device.name}'s channel by number, or open a channel's app if it's installed. I couldn't find one for ${ch.name}.`, { code: "ENOTFOUND" });
            await launchPkg(client, pkg);
            return done(`Opening ${appName(pkg)} on ${device.name}.`, { state: { ...device.state, on: true, app: appName(pkg) } });
          }
          const codes = [...String(ch.major)].map((c) => `KEYCODE_${c}`);
          if (ch.minor != null) codes.push("KEYCODE_PERIOD", ...[...String(ch.minor)].map((c) => `KEYCODE_${c}`));
          await key(client, ...codes, "KEYCODE_ENTER");
          return done(`Changed ${device.name} to channel ${ch.number} (in its live TV app).`, { state: { ...device.state, channel: ch.number } });
        }
        case "press_button": {
          const k = normalizeText(need(value, "button")).replace(/\b\d+ times?\b/g, "").trim();
          const code = /^\d$/.test(k) ? `KEYCODE_${k}` : Object.hasOwn(KEYS, k) ? KEYS[k] : null;
          if (!code) throw new DeviceError(`I don't know the button "${value}". Try home, back, up, down, left, right, ok, play, pause or search.`, { code: "EVALUE" });
          const times = Math.min(Math.max(parseInt(String(value).match(/\b(\d+) times?\b/)?.[1] || "1", 10), 1), 10);
          for (let i = 0; i < times; i++) await key(client, code);
          return done(`Pressed ${value}.`);
        }
        case "launch_app": {
          const pkg = await findPackage(client, device, need(value, "app"));
          await launchPkg(client, pkg);
          return done(`Opening ${appName(pkg)} on ${device.name}.`, { state: { ...device.state, on: true, app: appName(pkg) } });
        }
        case "type_text": {
          const text = String(need(value, "text")).replace(/[^\x20-\x7e]/g, "");
          if (!text) throw new DeviceError("I can only type plain letters, numbers and punctuation on this TV.", { code: "EVALUE" });
          await sh(client, `input text ${shellQuote(text.replace(/ /g, "%s"))}`);
          return done(`Typed “${text}” on ${device.name}.`);
        }
        case "web_search":
        case "open_website": {
          const url = action === "web_search" ? webSearchUrl(need(value, "search")) : websiteOrSearch(value);
          if (!(await view(client, url))) throw new DeviceError(`${device.name} doesn't have a web browser. Install one from its app store (Silk on Fire TV, or a TV browser such as TV Bro) and try again.`, { code: "ENOBROWSER" });
          return done(action === "web_search" ? `Searching the web for “${value}” on ${device.name}.` : `Opening ${url.replace(/^https:\/\//, "").replace(/\/$/, "")} on ${device.name}.`, { state: { ...device.state, on: true, app: "Web browser" } });
        }
        case "search_youtube": {
          const yt = await youtubePkg(client, device);
          return await youtubeSearch(device, value, ctx, {
            showOnTv: yt
              ? async (q) => {
                  const out = await sh(client, `am start -a android.intent.action.SEARCH --es query ${shellQuote(q)} ${yt}`);
                  if (!failed(out)) return "in YouTube";
                  return (await view(client, youtubeSearchUrl(q), yt)) ? "in YouTube" : false;
                }
              : null,
            browserSearch: async (q) => ((await view(client, youtubeSearchUrl(q))) ? "in the web browser" : false),
            openYouTube: yt ? () => launchPkg(client, yt) : null,
          });
        }
        case "play_youtube": {
          const yt = await youtubePkg(client, device);
          return await youtubePlay(device, value, ctx, {
            playVideo: async (id) => {
              if (!((yt && (await view(client, watchUrl(id), yt))) || (await view(client, watchUrl(id))))) throw new DeviceError(`${device.name} couldn't open the video. Is the YouTube app installed?`, { code: "ENOTINSTALLED" });
              await sleep(50);
            },
            showOnTv: yt
              ? async (q) => {
                  const out = await sh(client, `am start -a android.intent.action.SEARCH --es query ${shellQuote(q)} ${yt}`);
                  return failed(out) ? false : "in YouTube";
                }
              : null,
          });
        }
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
