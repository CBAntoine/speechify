// Yeelight bulbs and strips. Needs "LAN Control" switched on for each light in the Yeelight app.
import net from "node:net";
import dgram from "node:dgram";
import { clamp, parseColor, parseKelvin, parsePercent, rgbToHex } from "../util.mjs";
import { parseSsdpMessage } from "../net/ssdp.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";

/** Multicast M-SEARCH on port 1982. Returns Map(ip → advertised headers). */
export function yeelightDiscover({ unicast = [], timeout = 1500, target = "239.255.255.250" } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket("udp4");
    const finish = () => {
      try {
        sock.close();
      } catch {
        /* closed */
      }
      resolve(found);
    };
    sock.on("error", finish);
    sock.on("message", (msg, rinfo) => {
      const { headers } = parseSsdpMessage(msg.toString("utf8"));
      if (headers.location?.startsWith("yeelight://")) found.set(rinfo.address, headers);
    });
    sock.bind(0, () => {
      const q = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1982\r\nMAN: "ssdp:discover"\r\nST: wifi_bulb\r\n\r\n');
      for (const t of [target, ...unicast].filter(Boolean)) sock.send(q, 1982, t, () => {});
      setTimeout(finish, timeout);
    });
  });
}

let nextId = 1;
export function yeeCommand(ip, port, method, params = [], { timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const sock = net.connect({ host: ip, port });
    let buf = "";
    const fail = (e) => {
      sock.destroy();
      reject(e);
    };
    sock.setTimeout(timeout, () => fail(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    sock.on("error", fail);
    sock.on("connect", () => sock.write(JSON.stringify({ id, method, params }) + "\r\n"));
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let i;
      while ((i = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id !== id) continue; // property notifications
        sock.destroy();
        if (msg.error) reject(new DeviceError(msg.error.message || "The light refused the command."));
        else resolve(msg.result);
      }
    });
  });
}

const PROPS = ["power", "bright", "ct", "rgb", "color_mode", "name"];

function toState(p) {
  const st = { on: p.power === "on", brightness: Number(p.bright) || null };
  if (String(p.color_mode) === "2" && p.ct) st.colorTemperature = Number(p.ct);
  else if (p.rgb) st.color = rgbToHex([(p.rgb >> 16) & 255, (p.rgb >> 8) & 255, p.rgb & 255].map(Number));
  return st;
}

export default {
  id: "yeelight",
  label: "Yeelight",

  async detect(host) {
    const adv = host.udp?.yeelight;
    let port = 55443;
    let props = null;
    if (adv) {
      port = Number(new URL(adv.location.replace("yeelight://", "http://")).port) || 55443;
      props = { power: adv.power, bright: adv.bright, ct: adv.ct, rgb: Number(adv.rgb), color_mode: adv.color_mode, name: adv.name };
    } else if (host.ports.has(55443)) {
      const r = await yeeCommand(host.ip, port, "get_prop", PROPS).catch(() => null);
      if (!r) return null;
      props = Object.fromEntries(PROPS.map((k, i) => [k, k === "rgb" ? Number(r[i]) : r[i]]));
    } else return null;
    const support = String(adv?.support || "").split(/\s+/);
    const actions = ["turn_on", "turn_off", "toggle", "set_brightness", "rename", "set_room"];
    if (!adv || support.includes("set_rgb")) actions.push("set_color");
    if (!adv || support.includes("set_ct_abx")) actions.push("set_color_temperature");
    return [
      {
        id: `yeelight:${String(adv?.id || host.ip).toLowerCase()}`,
        driver: "yeelight",
        kind: "light",
        brand: "Yeelight",
        model: adv?.model ? `Yeelight ${adv.model}` : "Yeelight",
        name: props.name || "Yeelight",
        ip: host.ip,
        ref: { ip: host.ip, port },
        state: toState(props),
        info: { firmware: adv?.fw_ver || null },
        actions,
      },
    ];
  },

  async refresh(device) {
    const r = await yeeCommand(device.ref.ip, device.ref.port, "get_prop", PROPS);
    return { state: toState(Object.fromEntries(PROPS.map((k, i) => [k, k === "rgb" ? Number(r[i]) : r[i]]))) };
  },

  async act(device, action, value) {
    const { ip, port } = device.ref;
    const cmd = (m, p) => yeeCommand(ip, port, m, p);
    try {
      switch (action) {
        case "turn_on":
        case "turn_off":
          await cmd("set_power", [action === "turn_on" ? "on" : "off", "smooth", 300]);
          return done(`${device.name} is ${action === "turn_on" ? "on" : "off"}.`, { state: { ...device.state, on: action === "turn_on" } });
        case "toggle":
          await cmd("toggle", []);
          return done(`Toggled ${device.name}.`, { state: { ...device.state, on: !device.state?.on } });
        case "set_brightness": {
          const pct = parsePercent(need(value, "brightness"), device.state?.brightness);
          if (pct == null) throw new DeviceError(`I didn't understand the brightness "${value}".`);
          if (pct === 0) {
            await cmd("set_power", ["off", "smooth", 300]);
            return done(`${device.name} is off.`, { state: { ...device.state, on: false } });
          }
          if (!device.state?.on) await cmd("set_power", ["on", "smooth", 300]);
          await cmd("set_bright", [clamp(pct, 1, 100), "smooth", 300]);
          return done(`${device.name} is at ${pct}%.`, { state: { ...device.state, on: true, brightness: pct } });
        }
        case "set_color": {
          const rgb = parseColor(need(value, "colour"));
          if (!rgb) throw new DeviceError(`I don't know the colour "${value}".`);
          if (!device.state?.on) await cmd("set_power", ["on", "smooth", 300]);
          await cmd("set_rgb", [(rgb[0] << 16) + (rgb[1] << 8) + rgb[2], "smooth", 300]);
          return done(`${device.name} is now ${rgbToHex(rgb)}.`, { state: { ...device.state, on: true, color: rgbToHex(rgb), colorTemperature: null } });
        }
        case "set_color_temperature": {
          const k = parseKelvin(need(value, "white tone"));
          if (!k) throw new DeviceError(`I didn't understand the white tone "${value}".`);
          if (!device.state?.on) await cmd("set_power", ["on", "smooth", 300]);
          const kk = clamp(k, 1700, 6500);
          await cmd("set_ct_abx", [kk, "smooth", 300]);
          return done(`${device.name} is set to ${kk} kelvin.`, { state: { ...device.state, on: true, colorTemperature: kk, color: null } });
        }
        case "rename": {
          const name = String(need(value, "name")).slice(0, 32);
          await cmd("set_name", [name]);
          return done(`Renamed it to ${name} on the light too.`, { name });
        }
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      if (err.code === "ECONNREFUSED") throw new DeviceError(`${device.name} isn't accepting commands. Turn on LAN Control for it in the Yeelight app.`, { code: "EREFUSED" });
      throw explainError(err, device.name);
    }
  },
};
