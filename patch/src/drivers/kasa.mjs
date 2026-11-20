// TP-Link Kasa plugs, switches, strips and bulbs: JSON obfuscated with an XOR "autokey" cipher
// on TCP/UDP port 9999. (Newer Tapo devices and some 2021+ Kasa firmware use a different,
// encrypted protocol and are best controlled through Home Assistant.)
import net from "node:net";
import dgram from "node:dgram";
import { clamp, normalizeMac, parseColor, parseKelvin, parsePercent, rgbToHsv, hsvToRgb, rgbToHex } from "../util.mjs";
import { DeviceError, done, explainError, need, parseOnOff, unsupported } from "./common.mjs";

export function encrypt(text) {
  const src = Buffer.from(text, "utf8");
  const out = Buffer.alloc(src.length);
  let key = 171;
  for (let i = 0; i < src.length; i++) {
    key = key ^ src[i];
    out[i] = key;
  }
  return out;
}

export function decrypt(buf) {
  const out = Buffer.alloc(buf.length);
  let key = 171;
  for (let i = 0; i < buf.length; i++) {
    out[i] = key ^ buf[i];
    key = buf[i];
  }
  return out.toString("utf8");
}

/** One request/response over TCP (4-byte big-endian length prefix). */
export function kasaQuery(ip, obj, { timeout = 3000, port = 9999 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = encrypt(JSON.stringify(obj));
    const head = Buffer.alloc(4);
    head.writeUInt32BE(payload.length);
    const sock = net.connect({ host: ip, port });
    const chunks = [];
    let need = null;
    let got = 0;
    const fail = (err) => {
      sock.destroy();
      reject(err);
    };
    sock.setTimeout(timeout, () => fail(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    sock.on("error", fail);
    sock.on("connect", () => sock.write(Buffer.concat([head, payload])));
    sock.on("data", (c) => {
      chunks.push(c);
      got += c.length;
      if (need == null && got >= 4) need = Buffer.concat(chunks).readUInt32BE(0);
      if (need != null && got >= need + 4) {
        sock.destroy();
        try {
          resolve(JSON.parse(decrypt(Buffer.concat(chunks).subarray(4, 4 + need))));
        } catch (err) {
          reject(err);
        }
      }
    });
  });
}

/** Broadcast + unicast discovery. Returns Map(ip → sysinfo). */
export function kasaDiscover({ broadcasts = ["255.255.255.255"], unicast = [], timeout = 1600 } = {}) {
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
      try {
        const info = JSON.parse(decrypt(msg))?.system?.get_sysinfo;
        if (info && (info.alias !== undefined || info.model)) found.set(rinfo.address, info);
      } catch {
        /* not a Kasa reply */
      }
    });
    sock.bind(0, () => {
      try {
        sock.setBroadcast(true);
      } catch {
        /* unicast still works */
      }
      const q = encrypt(JSON.stringify({ system: { get_sysinfo: {} } }));
      for (const t of [...new Set([...broadcasts, ...unicast])]) sock.send(q, 9999, t, () => {});
      setTimeout(() => {
        for (const t of broadcasts) sock.send(q, 9999, t, () => {});
      }, 400);
      setTimeout(finish, timeout);
    });
  });
}

const isBulb = (s) => /SMARTBULB|LIGHTSTRIP/i.test(`${s.mic_type} ${s.type}`) || !!s.light_state;
const isDimmer = (s) => typeof s.brightness === "number" && !isBulb(s);

function bulbState(s) {
  const ls = s.light_state || {};
  const src = ls.on_off ? ls : ls.dft_on_state || ls;
  const st = { on: !!ls.on_off };
  if (typeof src.brightness === "number") st.brightness = src.brightness;
  if (src.color_temp) st.colorTemperature = src.color_temp;
  else if (s.is_color && typeof src.hue === "number") st.color = rgbToHex(hsvToRgb({ h: src.hue, s: (src.saturation ?? 0) / 100, v: 1 }));
  return st;
}

async function emeter(ip, childId) {
  try {
    const r = await kasaQuery(ip, { ...(childId ? { context: { child_ids: [childId] } } : {}), emeter: { get_realtime: {} } }, { timeout: 2500 });
    const e = r?.emeter?.get_realtime;
    if (!e || e.err_code) return null;
    const w = e.power_mw != null ? e.power_mw / 1000 : e.power;
    return typeof w === "number" ? Math.round(w * 10) / 10 : null;
  } catch {
    return null;
  }
}

function devicesFrom(ip, s) {
  const deviceId = s.deviceId || s.mic_mac || s.mac || ip;
  const base = {
    driver: "kasa",
    brand: "TP-Link Kasa",
    model: s.model?.replace(/\(.*\)/, "").trim() || s.dev_name || "Kasa device",
    ip,
    mac: normalizeMac(s.mac || s.mic_mac),
    info: { firmware: s.sw_ver?.split(" ")[0] || null, rssi: s.rssi ?? null, hardware: s.hw_ver || null, energy: /ENE/.test(s.feature || "") },
  };
  if (isBulb(s)) {
    const actions = ["turn_on", "turn_off", "toggle", "rename", "set_room", "reboot"];
    if (s.is_dimmable) actions.push("set_brightness");
    if (s.is_color) actions.push("set_color");
    if (s.is_variable_color_temp) actions.push("set_color_temperature");
    return [{ ...base, id: `kasa:${String(deviceId).toLowerCase()}`, kind: "light", name: s.alias || base.model, ref: { ip, bulb: true }, state: bulbState(s), actions }];
  }
  if (Array.isArray(s.children) && s.children.length) {
    const parentId = `kasa:${String(deviceId).toLowerCase()}`;
    const parent = { ...base, id: parentId, kind: "strip", name: s.alias || base.model, ref: { ip }, state: { on: s.children.some((c) => c.state === 1) }, actions: ["set_led", "reboot", "rename", "set_room"] };
    const kids = s.children.map((c, i) => {
      const childId = String(c.id).length <= 2 ? `${deviceId}${c.id}` : String(c.id);
      return { ...base, id: `kasa:${childId.toLowerCase()}`, parent: parentId, kind: "plug", name: c.alias || `${parent.name} · outlet ${i + 1}`, ref: { ip, childId }, state: { on: c.state === 1 }, actions: ["turn_on", "turn_off", "toggle", "rename", "set_room"] };
    });
    return [parent, ...kids];
  }
  const kind = /HS2\d\d|KS2\d\d|ES20M|SWITCH/i.test(`${s.model} ${s.dev_name}`) && !/plug/i.test(s.dev_name || "") ? "switch" : "plug";
  return [
    {
      ...base,
      id: `kasa:${String(deviceId).toLowerCase()}`,
      kind,
      name: s.alias || base.model,
      ref: { ip, dimmer: isDimmer(s) },
      state: { on: s.relay_state === 1, ...(isDimmer(s) ? { brightness: s.brightness } : {}), ledOff: !!s.led_off },
      actions: ["turn_on", "turn_off", "toggle", ...(isDimmer(s) ? ["set_brightness"] : []), "set_led", "reboot", "rename", "set_room"],
    },
  ];
}

export default {
  id: "kasa",
  label: "TP-Link Kasa",

  async detect(host) {
    let s = host.udp?.kasa;
    if (!s && host.ports.has(9999)) s = (await kasaQuery(host.ip, { system: { get_sysinfo: {} } }).catch(() => null))?.system?.get_sysinfo;
    if (!s) return null;
    const devices = devicesFrom(host.ip, s);
    if (devices[0].info.energy) {
      for (const d of devices) {
        if (d.kind === "plug" || d.kind === "switch") {
          const w = await emeter(host.ip, d.ref.childId);
          if (w != null) d.state.power = w;
        }
      }
    }
    return devices;
  },

  async refresh(device) {
    const r = await kasaQuery(device.ref.ip, { system: { get_sysinfo: {} } });
    const s = r?.system?.get_sysinfo;
    if (!s) return { online: false };
    const fresh = devicesFrom(device.ref.ip, s).find((d) => d.id === device.id);
    if (!fresh) return null;
    if (device.info?.energy && (fresh.kind === "plug" || fresh.kind === "switch")) {
      const w = await emeter(device.ref.ip, device.ref.childId);
      if (w != null) fresh.state.power = w;
    }
    return { state: fresh.state, online: true };
  },

  async act(device, action, value) {
    const { ip, childId, bulb, dimmer } = device.ref;
    const ctx = childId ? { context: { child_ids: [childId] } } : {};
    const sys = bulb ? "smartlife.iot.common.system" : "system";
    const send = async (obj) => {
      const r = await kasaQuery(ip, { ...ctx, ...obj });
      const err = Object.values(r || {}).flatMap((v) => Object.values(v || {})).find((x) => x && x.err_code);
      if (err) throw new DeviceError(err.err_msg || `Kasa error ${err.err_code}`);
      return r;
    };
    const light = (st) => send({ "smartlife.iot.smartbulb.lightingservice": { transition_light_state: { transition_period: 300, ...st } } });
    try {
      switch (action) {
        case "turn_on":
        case "turn_off":
        case "toggle": {
          const on = action === "toggle" ? !device.state?.on : action === "turn_on";
          if (bulb) await light({ on_off: on ? 1 : 0 });
          else await send({ system: { set_relay_state: { state: on ? 1 : 0 } } });
          const { power, ...rest } = device.state || {}; // the old wattage is stale now; the next refresh reads it again
          return done(`${device.name} is ${on ? "on" : "off"}.`, { state: { ...rest, on } });
        }
        case "set_brightness": {
          const pct = parsePercent(need(value, "brightness"), device.state?.brightness);
          if (pct == null) throw new DeviceError(`I didn't understand the brightness "${value}".`);
          if (bulb) await light(pct === 0 ? { on_off: 0 } : { on_off: 1, brightness: clamp(pct, 1, 100) });
          else if (dimmer) {
            if (pct === 0) await send({ system: { set_relay_state: { state: 0 } } });
            else {
              await send({ "smartlife.iot.dimmer": { set_brightness: { brightness: clamp(pct, 1, 100) } } });
              await send({ system: { set_relay_state: { state: 1 } } });
            }
          } else throw unsupported(device, action);
          return done(pct === 0 ? `${device.name} is off.` : `${device.name} is at ${pct}%.`, { state: { ...device.state, on: pct > 0, ...(pct ? { brightness: pct } : {}) } });
        }
        case "set_color": {
          if (!bulb) throw unsupported(device, action);
          const rgb = parseColor(need(value, "colour"));
          if (!rgb) throw new DeviceError(`I don't know the colour "${value}".`);
          const { h, s } = rgbToHsv(rgb);
          await light({ on_off: 1, hue: Math.round(h), saturation: Math.round(s * 100), color_temp: 0 });
          return done(`${device.name} is now ${rgbToHex(rgb)}.`, { state: { ...device.state, on: true, color: rgbToHex(rgb), colorTemperature: null } });
        }
        case "set_color_temperature": {
          if (!bulb) throw unsupported(device, action);
          const k = parseKelvin(need(value, "white tone"));
          if (!k) throw new DeviceError(`I didn't understand the white tone "${value}".`);
          const kk = clamp(k, 2500, 9000);
          await light({ on_off: 1, color_temp: kk });
          return done(`${device.name} is set to ${kk} kelvin.`, { state: { ...device.state, on: true, colorTemperature: kk, color: null } });
        }
        case "set_led": {
          const on = parseOnOff(value ?? "off");
          if (on == null || bulb || childId) throw unsupported(device, action);
          await send({ system: { set_led_off: { off: on ? 0 : 1 } } });
          return done(`The status light on ${device.name} is ${on ? "on" : "off"}.`, { state: { ...device.state, ledOff: !on } });
        }
        case "reboot":
          await send({ [sys]: { reboot: { delay: 1 } } });
          return done(`${device.name} is restarting.`);
        case "rename": {
          const alias = String(need(value, "name")).slice(0, 31);
          await send({ [sys]: { set_dev_alias: { alias } } });
          return done(`Renamed it to ${alias} on the device too.`, { name: alias });
        }
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
