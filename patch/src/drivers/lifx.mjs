// LIFX bulbs and strips: the LIFX LAN protocol (binary messages over UDP 56700).
import dgram from "node:dgram";
import crypto from "node:crypto";
import { clamp, normalizeMac, parseColor, parseKelvin, parsePercent, rgbToHsv, hsvToRgb, rgbToHex } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";

export const MSG = { GetService: 2, StateService: 3, GetLabel: 23, SetLabel: 24, StateLabel: 25, GetVersion: 32, StateVersion: 33, Acknowledgement: 45, Get: 101, SetColor: 102, SetWaveform: 103, State: 107, GetPower: 116, SetPower: 117, StatePower: 118 };
const PORT = 56700;

export function encode({ type, payload = Buffer.alloc(0), target = null, source = 0, sequence = 0, resRequired = false, ackRequired = false }) {
  const h = Buffer.alloc(36);
  h.writeUInt16LE(36 + payload.length, 0);
  h.writeUInt16LE(1024 | (1 << 12) | (target ? 0 : 1 << 13), 2); // protocol 1024, addressable, tagged when broadcasting
  h.writeUInt32LE(source >>> 0, 4);
  if (target) Buffer.from(normalizeMac(target).split(":").map((x) => parseInt(x, 16))).copy(h, 8);
  h[22] = (resRequired ? 1 : 0) | (ackRequired ? 2 : 0);
  h[23] = sequence & 0xff;
  h.writeUInt16LE(type, 32);
  return Buffer.concat([h, payload]);
}

export function decode(buf) {
  if (buf.length < 36) return null;
  const size = buf.readUInt16LE(0);
  const protocol = buf.readUInt16LE(2) & 0x0fff;
  if (protocol !== 1024 || size > buf.length) return null;
  const mac = [...buf.subarray(8, 14)].map((b) => b.toString(16).padStart(2, "0")).join(":");
  return { size, source: buf.readUInt32LE(4), target: normalizeMac(mac), sequence: buf[23], type: buf.readUInt16LE(32), payload: buf.subarray(36, size) };
}

export function parseState(p) {
  return {
    hue: p.readUInt16LE(0),
    saturation: p.readUInt16LE(2),
    brightness: p.readUInt16LE(4),
    kelvin: p.readUInt16LE(6),
    power: p.readUInt16LE(10),
    label: p.subarray(12, 44).toString("utf8").replace(/\0.*$/s, ""),
  };
}

export function setColorPayload({ hue, saturation, brightness, kelvin, duration = 300 }) {
  const p = Buffer.alloc(13);
  p.writeUInt16LE(hue & 0xffff, 1);
  p.writeUInt16LE(saturation & 0xffff, 3);
  p.writeUInt16LE(brightness & 0xffff, 5);
  p.writeUInt16LE(clamp(kelvin || 3500, 1500, 9000), 7);
  p.writeUInt32LE(duration, 9);
  return p;
}

const source = crypto.randomInt(2, 0x7fffffff);
let seq = 0;

/** Send to one bulb and wait for a reply of `expect` type. */
function call(ip, target, type, payload, expect, { timeout = 1200, tries = 2, port = PORT } = {}) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket("udp4");
    const sequence = ++seq & 0xff;
    let attempts = 0;
    let timer;
    const finish = (err, val) => {
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* closed */
      }
      err ? reject(err) : resolve(val);
    };
    sock.on("error", (e) => finish(e));
    sock.on("message", (msg) => {
      const m = decode(msg);
      if (m && m.source === source && m.sequence === sequence && (m.type === expect || (expect == null && m.type === MSG.Acknowledgement))) finish(null, m);
    });
    const send = () => {
      attempts++;
      sock.send(encode({ type, payload, target, source, sequence, resRequired: expect != null, ackRequired: expect == null }), port, ip, () => {});
      timer = setTimeout(() => (attempts < tries ? send() : finish(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))), timeout);
    };
    sock.bind(0, send);
  });
}

/** Broadcast GetService. Returns Map(ip → { mac, port }). */
export function lifxDiscover({ broadcasts = ["255.255.255.255"], unicast = [], timeout = 1500 } = {}) {
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
      const m = decode(msg);
      if (m?.type === MSG.StateService && m.payload[0] === 1) found.set(rinfo.address, { mac: m.target, port: m.payload.readUInt32LE(1) || PORT });
    });
    sock.bind(0, () => {
      try {
        sock.setBroadcast(true);
      } catch {
        /* unicast still works */
      }
      const pkt = encode({ type: MSG.GetService, source, sequence: 0, resRequired: true });
      for (const t of [...new Set([...broadcasts, ...unicast])]) sock.send(pkt, PORT, t, () => {});
      setTimeout(() => broadcasts.forEach((t) => sock.send(pkt, PORT, t, () => {})), 400);
      setTimeout(finish, timeout);
    });
  });
}

function toState(s) {
  const st = { on: s.power > 0, brightness: Math.round((s.brightness / 65535) * 100) };
  if (s.saturation < 650) st.colorTemperature = s.kelvin;
  else st.color = rgbToHex(hsvToRgb({ h: (s.hue / 65535) * 360, s: s.saturation / 65535, v: 1 }));
  return st;
}

export default {
  id: "lifx",
  label: "LIFX",

  async detect(host) {
    const hit = host.udp?.lifx;
    if (!hit) return null;
    const m = await call(host.ip, hit.mac, MSG.Get, Buffer.alloc(0), MSG.State, { port: hit.port }).catch(() => null);
    if (!m) return null;
    const s = parseState(m.payload);
    return [
      {
        id: `lifx:${hit.mac.replace(/:/g, "")}`,
        driver: "lifx",
        kind: "light",
        brand: "LIFX",
        model: "LIFX light",
        name: s.label || "LIFX light",
        ip: host.ip,
        mac: hit.mac,
        ref: { ip: host.ip, mac: hit.mac, port: hit.port, raw: s },
        state: toState(s),
        info: {},
        actions: ["turn_on", "turn_off", "toggle", "set_brightness", "set_color", "set_color_temperature", "identify", "rename", "set_room"],
      },
    ];
  },

  async refresh(device) {
    const m = await call(device.ref.ip, device.ref.mac, MSG.Get, Buffer.alloc(0), MSG.State, { port: device.ref.port });
    const s = parseState(m.payload);
    device.ref.raw = s;
    return { state: toState(s) };
  },

  async act(device, action, value) {
    const { ip, mac, port } = device.ref;
    const opts = { port };
    try {
      const cur = device.ref.raw || parseState((await call(ip, mac, MSG.Get, Buffer.alloc(0), MSG.State, opts)).payload);
      const setColor = async (hsbk, msg) => {
        const r = await call(ip, mac, MSG.SetColor, setColorPayload({ ...cur, ...hsbk }), MSG.State, opts);
        const s = parseState(r.payload);
        device.ref.raw = s;
        return done(msg, { state: toState({ ...s, ...hsbk, power: s.power }) });
      };
      const power = async (on) => {
        const p = Buffer.alloc(6);
        p.writeUInt16LE(on ? 65535 : 0, 0);
        p.writeUInt32LE(300, 2);
        await call(ip, mac, MSG.SetPower, p, MSG.StatePower, opts);
        cur.power = on ? 65535 : 0;
      };
      switch (action) {
        case "turn_on":
        case "turn_off":
        case "toggle": {
          const on = action === "toggle" ? !(cur.power > 0) : action === "turn_on";
          await power(on);
          return done(`${device.name} is ${on ? "on" : "off"}.`, { state: { ...device.state, on } });
        }
        case "set_brightness": {
          const pct = parsePercent(need(value, "brightness"), device.state?.brightness);
          if (pct == null) throw new DeviceError(`I didn't understand the brightness "${value}".`);
          if (pct === 0) {
            await power(false);
            return done(`${device.name} is off.`, { state: { ...device.state, on: false } });
          }
          if (!(cur.power > 0)) await power(true);
          const r = await setColor({ brightness: Math.round((pct / 100) * 65535) }, `${device.name} is at ${pct}%.`);
          r.state.on = true;
          return r;
        }
        case "set_color": {
          const rgb = parseColor(need(value, "colour"));
          if (!rgb) throw new DeviceError(`I don't know the colour "${value}".`);
          const { h, s } = rgbToHsv(rgb);
          if (!(cur.power > 0)) await power(true);
          const r = await setColor({ hue: Math.round((h / 360) * 65535), saturation: Math.round(s * 65535) }, `${device.name} is now ${rgbToHex(rgb)}.`);
          r.state.on = true;
          return r;
        }
        case "set_color_temperature": {
          const k = parseKelvin(need(value, "white tone"));
          if (!k) throw new DeviceError(`I didn't understand the white tone "${value}".`);
          if (!(cur.power > 0)) await power(true);
          const r = await setColor({ saturation: 0, kelvin: clamp(k, 1500, 9000) }, `${device.name} is set to ${clamp(k, 1500, 9000)} kelvin.`);
          r.state.on = true;
          return r;
        }
        case "identify": {
          // Three soft pulses down to dark and back, then the bulb returns to its own colour.
          const p = Buffer.alloc(21);
          p[1] = 1; // transient
          p.writeUInt16LE(cur.hue, 2);
          p.writeUInt16LE(cur.saturation, 4);
          p.writeUInt16LE(0, 6);
          p.writeUInt16LE(cur.kelvin || 3500, 8);
          p.writeUInt32LE(700, 10);
          p.writeFloatLE(3, 14);
          p.writeInt16LE(0, 18);
          p[20] = 1; // sine
          await call(ip, mac, MSG.SetWaveform, p, null, opts);
          return done(`${device.name} is pulsing.`);
        }
        case "rename": {
          const name = String(need(value, "name"));
          const p = Buffer.alloc(32);
          Buffer.from(name, "utf8").subarray(0, 32).copy(p);
          await call(ip, mac, MSG.SetLabel, p, MSG.StateLabel, opts);
          return done(`Renamed it to ${name} on the bulb too.`, { name });
        }
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
