// Roku players and Roku TVs: External Control Protocol (ECP) on port 8060, no pairing needed.
import { request } from "../net/lanhttp.mjs";
import { childText, findAll, findFirst, parseXml } from "../net/xml.mjs";
import { fuzzyPick, normalizeMac, normalizeText } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";

const KEYS = {
  home: "Home", back: "Back", up: "Up", down: "Down", left: "Left", right: "Right", ok: "Select", select: "Select",
  enter: "Select", play: "Play", pause: "Play", "play pause": "Play", rewind: "Rev", "fast forward": "Fwd", forward: "Fwd",
  ff: "Fwd", replay: "InstantReplay", "instant replay": "InstantReplay", info: "Info", options: "Info", star: "Info",
  search: "Search", backspace: "Backspace", "volume up": "VolumeUp", "volume down": "VolumeDown", mute: "VolumeMute",
  "power off": "PowerOff", "power on": "PowerOn", power: "Power", "channel up": "ChannelUp", "channel down": "ChannelDown",
  "find remote": "FindRemote",
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
          ...(tv ? ["turn_on", "turn_off", "switch_input"] : []),
          "launch_app", "press_button", "search", "play", "pause", "volume_up", "volume_down", "mute", "rename", "set_room",
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

  async act(device, action, value) {
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
          const k = normalizeText(need(value, "button")).replace(/\b\d+\b/g, "").replace(/\s+/g, " ").trim();
          const key = (Object.hasOwn(KEYS, k) && KEYS[k]) || Object.values(KEYS).find((v) => v.toLowerCase() === k.replace(/ /g, ""));
          if (!key) throw new DeviceError(`I don't know the Roku button "${value}". Try home, back, up, down, left, right, ok, play, rewind or fast forward.`);
          const times = Math.min(Math.max(parseInt(String(value).match(/\b(\d+)\b/)?.[1] || "1", 10), 1), 10);
          for (let i = 0; i < times; i++) await post(ref, `/keypress/${key}`);
          return done(`Pressed ${key}.`);
        }
        case "launch_app": {
          const list = await apps(ref.base);
          const app = fuzzyPick(need(value, "app"), list);
          if (!app) throw new DeviceError(`${value} isn't installed on ${device.name}. Installed apps include ${list.slice(0, 8).map((a) => a.name).join(", ")}.`);
          await post(ref, `/launch/${encodeURIComponent(app.id)}`);
          return done(`Opening ${app.name} on ${device.name}.`, { state: { ...device.state, on: true, app: app.name } });
        }
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
