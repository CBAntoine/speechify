// WLED LED strips (ESP8266/ESP32 running WLED): JSON API at /json.
import { request } from "../net/lanhttp.mjs";
import { clamp, fuzzyPick, normalizeMac, parseColor, parsePercent, rgbToHex } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";

async function j(ip, path, body) {
  const res = await request({ url: `http://${ip}${path}`, method: body ? "POST" : "GET", body, timeout: 3500 });
  if (res.status >= 400) throw new DeviceError(`WLED said no (HTTP ${res.status}).`);
  return res.json();
}

function stateOf(s, effects) {
  const seg = s?.seg?.[0] || {};
  const col = seg.col?.[0];
  return {
    on: !!s?.on,
    brightness: typeof s?.bri === "number" ? Math.round((s.bri / 255) * 100) : null,
    color: Array.isArray(col) && col.length >= 3 ? rgbToHex(col) : null,
    effect: effects && typeof seg.fx === "number" ? effects[seg.fx] ?? null : null,
    preset: typeof s?.ps === "number" && s.ps > 0 ? s.ps : null,
  };
}

export default {
  id: "wled",
  label: "WLED",

  async detect(host) {
    const hinted = host.mdns.some((s) => s.type === "_wled._tcp") || /wled/i.test(`${host.http?.[80]?.title} ${[...host.hostnames].join(" ")}`) || (host.vendor === "Espressif" && host.ports.has(80)) || (!host.vendor && host.ports.has(80) && host.ports.size <= 2);
    if (!hinted) return null;
    let info;
    try {
      info = await j(host.ip, "/json/info");
    } catch {
      return null;
    }
    if (!info || (info.brand !== "WLED" && !info.leds)) return null;
    const [state, effects] = await Promise.all([j(host.ip, "/json/state").catch(() => null), j(host.ip, "/json/effects").catch(() => null)]);
    return [
      {
        id: `wled:${String(info.mac || host.ip).replace(/[^0-9a-z]/gi, "").toLowerCase()}`,
        driver: "wled",
        kind: "light",
        brand: "WLED",
        model: `LED strip${info.leds?.count ? ` · ${info.leds.count} LEDs` : ""}`,
        name: info.name || "WLED",
        ip: host.ip,
        mac: normalizeMac(info.mac),
        ref: { ip: host.ip },
        state: stateOf(state, effects),
        info: { firmware: info.ver, rssi: info.wifi?.rssi ?? null, signal: info.wifi?.signal ?? null, leds: info.leds?.count ?? null, effects: effects?.length ?? null },
        actions: ["turn_on", "turn_off", "toggle", "set_brightness", "set_color", "set_effect", "set_preset", "reboot", "rename", "set_room"],
      },
    ];
  },

  async refresh(device) {
    const [state, effects] = await Promise.all([j(device.ref.ip, "/json/state"), j(device.ref.ip, "/json/effects").catch(() => null)]);
    return { state: stateOf(state, effects) };
  },

  async act(device, action, value) {
    const ip = device.ref.ip;
    const set = async (body, message) => {
      const s = await j(ip, "/json/state", { ...body, v: true });
      let next;
      if (s && "on" in s) {
        next = { ...stateOf(s), effect: body.seg?.[0]?.fx === 0 ? "Solid" : device.state?.effect ?? null };
      } else {
        // Older firmware answers {"success":true} instead of the new state.
        next = { ...device.state };
        if (typeof body.on === "boolean") next.on = body.on;
        if (body.on === "t") next.on = !device.state?.on;
        if (body.bri) next.brightness = Math.round((body.bri / 255) * 100);
        if (body.seg?.[0]?.col) next.color = rgbToHex(body.seg[0].col[0]);
      }
      return done(message, { state: next });
    };
    try {
      switch (action) {
        case "turn_on":
          return await set({ on: true }, `${device.name} is on.`);
        case "turn_off":
          return await set({ on: false }, `${device.name} is off.`);
        case "toggle":
          return await set({ on: "t" }, `Toggled ${device.name}.`);
        case "set_brightness": {
          const pct = parsePercent(need(value, "brightness"), device.state?.brightness);
          if (pct == null) throw new DeviceError(`I didn't understand the brightness "${value}".`);
          return await set(pct === 0 ? { on: false } : { on: true, bri: clamp(Math.round(pct * 2.55), 1, 255) }, pct === 0 ? `${device.name} is off.` : `${device.name} is at ${pct}%.`);
        }
        case "set_color": {
          const rgb = parseColor(need(value, "colour"));
          if (!rgb) throw new DeviceError(`I don't know the colour "${value}".`);
          return await set({ on: true, seg: [{ col: [rgb], fx: 0 }] }, `${device.name} is now ${rgbToHex(rgb)}.`);
        }
        case "set_effect": {
          const effects = await j(ip, "/json/effects");
          const name = fuzzyPick(need(value, "effect"), effects.map((n, i) => ({ name: n, i })));
          if (!name) throw new DeviceError(`WLED has no effect called "${value}". Try rainbow, fire, twinkle, breathe or chase.`);
          const s = await j(ip, "/json/state", { on: true, seg: [{ fx: name.i }], v: true });
          return done(`${device.name} is running ${name.name}.`, { state: { ...stateOf(s, effects) } });
        }
        case "set_preset": {
          const presets = await j(ip, "/presets.json").catch(() => ({}));
          const list = Object.entries(presets)
            .filter(([id, p]) => id !== "0" && p?.n)
            .map(([id, p]) => ({ id: Number(id), name: p.n }));
          const p = fuzzyPick(need(value, "preset"), list);
          if (!p) throw new DeviceError(list.length ? `No preset called "${value}". Presets: ${list.map((x) => x.name).join(", ")}.` : "This WLED has no saved presets.");
          return await set({ ps: p.id }, `${device.name} is on preset ${p.name}.`);
        }
        case "reboot":
          await j(ip, "/json/state", { rb: true }).catch(() => null);
          return done(`${device.name} is restarting.`);
        case "rename": {
          const name = String(need(value, "name")).slice(0, 32);
          await j(ip, "/json/cfg", { id: { name } });
          return done(`Renamed it to ${name} on the device too.`, { name });
        }
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
