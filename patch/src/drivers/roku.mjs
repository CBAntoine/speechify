// Roku players and Roku TVs: External Control Protocol (ECP) on port 8060, no pairing needed.
import { request } from "../net/lanhttp.mjs";
import { childText, findAll, findFirst, parseXml } from "../net/xml.mjs";
import { fuzzyPick, normalizeMac, normalizeText, sleep } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";
import { buttonCodes, describeButtons, knownApp, parseButtons, parseChannel, youtubePlay, youtubeSearch } from "./tv.mjs";

const YOUTUBE = "837"; // YouTube's channel id on every Roku

// The remote's buttons (named as in tv.mjs) as Roku's.
const KEYS = {
  up: "Up", down: "Down", left: "Left", right: "Right", ok: "Select", back: "Back", home: "Home", menu: "Info", info: "Info",
  search: "Search", play: "Play", pause: "Play", "play pause": "Play", rewind: "Rev", "fast forward": "Fwd", replay: "InstantReplay",
  backspace: "Backspace", "volume up": "VolumeUp", "volume down": "VolumeDown", mute: "VolumeMute", power: "Power",
  "channel up": "ChannelUp", "channel down": "ChannelDown",
};

const INPUTS = { hdmi1: "InputHDMI1", hdmi2: "InputHDMI2", hdmi3: "InputHDMI3", hdmi4: "InputHDMI4", tuner: "InputTuner", antenna: "InputTuner", "live tv": "InputTuner", tv: "InputTuner", av: "InputAV1", composite: "InputAV1" };

const ecp = (ref, path, method = "GET") => request({ url: `${ref.base}${path}`, method, timeout: 3500, body: method === "POST" ? "" : undefined });

async function post(ref, path) {
  const res = await ecp(ref, path, "POST");
  if (res.status === 403)
    throw new DeviceError("The Roku blocked the command. On the Roku, open Settings, System, Advanced system settings, Control by mobile apps, and set Network access to Default.", { code: "EBLOCKED" });
  if (res.status >= 400) throw new DeviceError(`The Roku said no (HTTP ${res.status}).`);
}

async function deviceInfo(base) {
  const res = await request({ url: `${base}/query/device-info`, timeout: 2500 });
  if (res.status !== 200) return null;
  const root = findFirst(parseXml(res.text()), "device-info");
  if (!root) return null;
  const f = (k) => childText(root, k);
  return {
    serial: f("serial-number") || f("device-id"),
    vendor: f("vendor-name") || "Roku",
    model: f("model-name"),
    modelNumber: f("model-number"),
    friendly: f("friendly-device-name") || f("user-device-name") || f("default-device-name"),
    userName: f("user-device-name"),
    location: f("user-device-location"),
    isTv: f("is-tv") === "true",
    power: f("power-mode"),
    software: [f("software-version"), f("software-build")].filter(Boolean).join(" build "),
    mac: normalizeMac(f("wifi-mac") || f("ethernet-mac")),
    network: f("network-type"),
  };
}

async function activeApp(base) {
  try {
    const res = await request({ url: `${base}/query/active-app`, timeout: 2500 });
    const app = findFirst(parseXml(res.text()), "app");
    return app ? app.text.trim() : null;
  } catch {
    return null;
  }
}

async function apps(base) {
  const res = await request({ url: `${base}/query/apps`, timeout: 3000 });
  return findAll(parseXml(res.text()), "app").map((a) => ({ id: a.attrs.id, name: a.text.trim() }));
}

const powerOn = (p) => !p || p === "PowerOn";

export default {
  id: "roku",
  label: "Roku",

  async detect(host) {
    const hinted = host.ssdp.some((r) => /roku/i.test(`${r.st} ${r.usn} ${r.server}`)) || host.ports.has(8060) || host.vendor === "Roku";
    if (!hinted) return null;
    const loc = host.ssdp.find((r) => /roku:ecp/i.test(`${r.st} ${r.usn}`))?.location;
    const base = (loc ? new URL(loc).origin : `http://${host.ip}:8060`).replace(/\/$/, "");
    const info = await deviceInfo(base).catch(() => null);
    if (!info) return null;
    const app = await activeApp(base);
    const tv = info.isTv;
    return [
      {
        id: `roku:${String(info.serial || host.ip).toLowerCase()}`,
        driver: "roku",
        kind: tv ? "tv" : "streamer",
        brand: info.vendor && !/^roku$/i.test(info.vendor) ? `${info.vendor} Roku TV` : "Roku",
        model: info.model,
        name: info.userName || info.friendly || (tv ? "Roku TV" : "Roku"),
        ip: host.ip,
        mac: info.mac,
        room: info.location || null,
        ref: { base, isTv: tv },
        state: { on: tv ? powerOn(info.power) : true, power: info.power, app: app && app !== "Roku" ? app : "Home screen" },
        info: { firmware: info.software, model: info.modelNumber, network: info.network },
        actions: [
          ...(tv ? ["turn_on", "turn_off", "switch_input", "set_channel", "channel_up", "channel_down"] : []),
          "launch_app", "press_button", "search", "type_text", "search_youtube", "play_youtube", "play", "pause", "volume_up", "volume_down", "mute", "list_apps", "install_app", "rename", "set_room",
        ],
      },
    ];
  },

  async refresh(device) {
    const info = await deviceInfo(device.ref.base);
    if (!info) return { online: false };
    const app = await activeApp(device.ref.base);
    return { online: true, state: { on: device.ref.isTv ? powerOn(info.power) : true, power: info.power, app: app && app !== "Roku" ? app : "Home screen" } };
  },

  async act(device, action, value, ctx = {}) {
    const ref = device.ref;
    try {
      switch (action) {
        case "turn_on":
          await post(ref, "/keypress/PowerOn");
          return done(`Turning ${device.name} on.`, { state: { ...device.state, on: true } });
        case "turn_off":
          if (!ref.isTv) throw new DeviceError("Roku players don't switch off, but I can take it to the home screen.");
          await post(ref, "/keypress/PowerOff");
          return done(`${device.name} is off.`, { state: { ...device.state, on: false } });
        case "play":
        case "pause":
          await post(ref, "/keypress/Play");
          return done(action === "play" ? "Playing." : "Paused.");
        case "volume_up":
        case "volume_down": {
          const times = Math.min(Math.max(Number(value) || 3, 1), 15);
          for (let i = 0; i < times; i++) await post(ref, `/keypress/${action === "volume_up" ? "VolumeUp" : "VolumeDown"}`);
          return done(`Turned it ${action === "volume_up" ? "up" : "down"} ${times} steps.`);
        }
        case "mute":
          await post(ref, "/keypress/VolumeMute");
          return done("Toggled mute.");
        case "press_button": {
          // "Find my remote" makes the Roku remote beep; it isn't a button on it.
          if (/^find (my |the )?remote$/.test(normalizeText(need(value, "button")))) {
            await post(ref, "/keypress/FindRemote");
            return done(`Asked ${device.name}'s remote to make its sound.`);
          }
          // Any of the remote's buttons, several in a row, or one held down.
          const steps = buttonCodes(parseButtons(value), KEYS, { digit: (d) => `Lit_${d}`, device: device.name });
          for (const st of steps) {
            for (let i = 0; i < st.times; i++) {
              if (st.hold) {
                await post(ref, `/keydown/${st.code}`);
                await sleep(1200);
                await post(ref, `/keyup/${st.code}`);
              } else await post(ref, `/keypress/${st.code}`);
            }
          }
          return done(`${describeButtons(steps)} on ${device.name}.`);
        }
        case "launch_app": {
          const list = await apps(ref.base);
          const app = fuzzyPick(need(value, "app"), list);
          if (!app) throw new DeviceError(`${value} isn't installed on ${device.name}. Installed apps include ${list.slice(0, 8).map((a) => a.name).join(", ")}.`);
          await post(ref, `/launch/${encodeURIComponent(app.id)}`);
          return done(`Opening ${app.name} on ${device.name}.`, { state: { ...device.state, on: true, app: app.name } });
        }
        case "list_apps": {
          const list = await apps(ref.base);
          return done(`${device.name} has ${list.length} channels: ${list.map((a) => a.name).join(", ")}.`, { apps: list.map((a) => ({ name: a.name, id: a.id })) });
        }
        case "install_app": {
          // Roku calls apps "channels": open the channel's page in the Channel Store, or search for it.
          const want = String(need(value, "channel")).trim();
          const list = await apps(ref.base);
          const known = knownApp(want);
          const have = list.find((a) => (known?.roku && a.id === known.roku) || normalizeText(a.name) === normalizeText(want));
          if (have) return done(`${have.name} is already on ${device.name}. Want me to open it?`, { installed: true });
          if (known?.roku && /^\d+$/.test(known.roku)) {
            await post(ref, `/install/${known.roku}`);
            const label = known.names[0].replace(/\b\w/g, (c) => c.toUpperCase());
            return done(`The ${label} page is open in the Roku Channel Store on ${device.name}. Press OK on the remote to add it, or tell me to.`, { state: { ...device.state, on: true, app: "Channel Store" } });
          }
          await post(ref, `/search/browse?keyword=${encodeURIComponent(want)}&type=channel`);
          return done(`${device.name} is searching the Channel Store for “${want}”. Pick it with the remote, then choose Add channel.`, { state: { ...device.state, on: true } });
        }
        case "channel_up":
        case "channel_down":
          if (!ref.isTv) throw new DeviceError("Roku players don't have TV channels. Roku calls its apps channels, so I can open one by name.", { code: "EUNSUPPORTED" });
          await post(ref, `/keypress/${action === "channel_up" ? "ChannelUp" : "ChannelDown"}`);
          return done(`Channel ${action === "channel_up" ? "up" : "down"} on ${device.name}.`);
        case "set_channel": {
          const ch = parseChannel(value);
          if (ch.name) {
            // On a Roku, "channels" are its apps: "put on Netflix", "the Roku Channel".
            const list = await apps(ref.base);
            const app = fuzzyPick(ch.name, list);
            if (!app) throw new DeviceError(`${device.name} doesn't have a channel called ${ch.name}.${ref.isTv ? " For live TV, tell me the channel number." : ""}`, { code: "ENOTFOUND" });
            await post(ref, `/launch/${encodeURIComponent(app.id)}`);
            return done(`Opening ${app.name} on ${device.name}.`, { state: { ...device.state, on: true, app: app.name } });
          }
          if (!ref.isTv) throw new DeviceError("This Roku player has no live TV. Roku calls its apps channels, so tell me which one to open.", { code: "EUNSUPPORTED" });
          if (ch.dir) {
            await post(ref, `/keypress/${ch.dir === "up" ? "ChannelUp" : "ChannelDown"}`);
            return done(`Channel ${ch.dir} on ${device.name}.`);
          }
          await post(ref, `/launch/tvinput.dtv?ch=${encodeURIComponent(ch.number)}`);
          return done(`${device.name} is on channel ${ch.number}.`, { state: { ...device.state, on: true, app: "Live TV", channel: ch.number } });
        }
        case "type_text": {
          const text = String(need(value, "text")).slice(0, 200);
          for (const c of text) await post(ref, `/keypress/Lit_${encodeURIComponent(c)}`);
          return done(`Typed “${text}” on ${device.name}. (It goes into whatever search box is open.)`);
        }
        case "search_youtube": {
          const list = await apps(ref.base);
          if (!list.some((a) => a.id === YOUTUBE)) throw new DeviceError(`YouTube isn't installed on ${device.name}. Add it from the Roku Channel Store.`, { code: "ENOTINSTALLED" });
          return await youtubeSearch(device, value, ctx, { openYouTube: () => post(ref, `/launch/${YOUTUBE}`) });
        }
        case "play_youtube":
          return await youtubePlay(device, value, ctx, {
            playVideo: (id) => post(ref, `/launch/${YOUTUBE}?contentId=${encodeURIComponent(id)}&mediaType=movie`),
          });
        case "search": {
          const q = String(need(value, "search"));
          await post(ref, `/search/browse?keyword=${encodeURIComponent(q)}`);
          return done(`Searching ${device.name} for ${q}.`);
        }
        case "switch_input": {
          if (!ref.isTv) throw unsupported(device, action);
          const k = normalizeText(need(value, "input")).replace(/\s+(\d)/, "$1");
          const key = [k, k.replace(/ /g, "")].map((x) => Object.hasOwn(INPUTS, x) && INPUTS[x]).find(Boolean);
          if (!key) throw new DeviceError(`Which input? HDMI 1 to 4, antenna or AV.`);
          await post(ref, `/keypress/${key}`);
          return done(`Switched ${device.name} to ${value}.`);
        }
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
