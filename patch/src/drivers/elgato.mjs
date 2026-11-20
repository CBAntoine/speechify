// Elgato Key Light / Ring Light / Light Strip: REST on port 9123.
import { request } from "../net/lanhttp.mjs";
import { clamp, kelvinToMired, miredToKelvin, parseKelvin, parsePercent } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";

async function call(ip, port, path, method = "GET", body) {
  const res = await request({ url: `http://${ip}:${port}${path}`, method, body, timeout: 3000 });
  if (res.status >= 400) throw new DeviceError(`The light said no (HTTP ${res.status}).`);
  return res.body.length ? res.json() : {};
}

const stateOf = (l) => (l ? { on: !!l.on, brightness: l.brightness ?? null, colorTemperature: l.temperature ? miredToKelvin(l.temperature) : null } : {});

export default {
  id: "elgato",
  label: "Elgato",

  async detect(host) {
    const svc = host.mdns.find((s) => s.type === "_elg._tcp");
    if (!svc && !host.ports.has(9123)) return null;
    const port = svc?.port || 9123;
    let info;
    try {
      info = await call(host.ip, port, "/elgato/accessory-info");
    } catch {
      return null;
    }
    if (!info?.productName) return null;
    const lights = await call(host.ip, port, "/elgato/lights").catch(() => null);
    return [
      {
        id: `elgato:${String(info.serialNumber || host.ip).toLowerCase()}`,
        driver: "elgato",
        kind: "light",
        brand: "Elgato",
        model: info.productName,
        name: info.displayName || info.productName,
        ip: host.ip,
        ref: { ip: host.ip, port },
        state: stateOf(lights?.lights?.[0]),
        info: { firmware: info.firmwareVersion, serial: info.serialNumber },
        actions: ["turn_on", "turn_off", "toggle", "set_brightness", "set_color_temperature", "identify", "rename", "set_room"],
      },
    ];
  },

  async refresh(device) {
    const lights = await call(device.ref.ip, device.ref.port, "/elgato/lights");
    return { state: stateOf(lights?.lights?.[0]) };
  },

  async act(device, action, value) {
    const { ip, port } = device.ref;
    const put = async (patch, msg) => {
      const r = await call(ip, port, "/elgato/lights", "PUT", { numberOfLights: 1, lights: [patch] });
      return done(msg, { state: { ...device.state, ...stateOf(r?.lights?.[0] || { ...patch }) } });
    };
    try {
      switch (action) {
        case "turn_on":
          return await put({ on: 1 }, `${device.name} is on.`);
        case "turn_off":
          return await put({ on: 0 }, `${device.name} is off.`);
        case "toggle":
          return await put({ on: device.state?.on ? 0 : 1 }, `Toggled ${device.name}.`);
        case "set_brightness": {
          const pct = parsePercent(need(value, "brightness"), device.state?.brightness);
          if (pct == null) throw new DeviceError(`I didn't understand the brightness "${value}".`);
          return await put(pct === 0 ? { on: 0 } : { on: 1, brightness: clamp(pct, 3, 100) }, `${device.name} is at ${clamp(pct, 3, 100)}%.`);
        }
        case "set_color_temperature": {
          const k = parseKelvin(need(value, "white tone"));
          if (!k) throw new DeviceError(`I didn't understand the white tone "${value}".`);
          return await put({ on: 1, temperature: clamp(kelvinToMired(k), 143, 344) }, `${device.name} is set to about ${clamp(k, 2900, 7000)} kelvin.`);
        }
        case "identify":
          await call(ip, port, "/elgato/identify", "POST");
          return done(`${device.name} is flashing.`);
        case "rename": {
          const name = String(need(value, "name")).slice(0, 32);
          await call(ip, port, "/elgato/accessory-info", "PUT", { displayName: name });
          return done(`Renamed it to ${name} on the light too.`, { name });
        }
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
