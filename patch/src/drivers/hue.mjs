// Philips Hue: the bridge's local REST API (v1). Pairing needs the round button on the bridge pressed.
import { request } from "../net/lanhttp.mjs";
import { clamp, fuzzyPick, hsvToRgb, kelvinToMired, miredToKelvin, normalizeMac, parseColor, parseKelvin, parsePercent, rgbToHex, rgbToHsv } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";

const MODELS = { BSB001: "Hue Bridge (1st gen)", BSB002: "Hue Bridge", BSB003: "Hue Bridge Pro" };

async function api(ip, path, { method = "GET", body, timeout = 4000 } = {}) {
  const res = await request({ url: `http://${ip}${path}`, method, body, timeout });
  let data;
  try {
    data = res.json();
  } catch {
    throw new DeviceError("The Hue Bridge sent an unexpected reply.");
  }
  const errors = Array.isArray(data) ? data.filter((x) => x.error).map((x) => x.error) : [];
  if (errors.length) {
    const e = errors[0];
    if (e.type === 201) throw new DeviceError("The Hue Bridge can't reach that light right now. It's probably switched off at the wall, or too far from other Hue lights.", { code: "EOFFLINE" });
    throw new DeviceError(e.description || "Hue error", { code: e.type === 1 ? "EAUTH" : e.type === 101 ? "ELINK" : `HUE${e.type}` });
  }
  return data;
}

function lightKind(l) {
  if (/plug/i.test(l.type) || /plug/i.test(l.productname || "")) return "plug";
  return "light";
}

function lightActions(l) {
  const a = ["turn_on", "turn_off", "toggle", "identify", "rename", "set_room"];
  const t = String(l.type).toLowerCase();
  if (l.state && "bri" in l.state) a.push("set_brightness");
  if (t.includes("color light") || "xy" in (l.state || {}) || "hue" in (l.state || {})) a.push("set_color");
  if ("ct" in (l.state || {})) a.push("set_color_temperature");
  return a;
}

function lightState(s = {}) {
  const st = { on: !!s.on };
  if ("bri" in s) st.brightness = Math.round((s.bri / 254) * 100);
  if (s.colormode === "ct" && s.ct) st.colorTemperature = Math.round(miredToKelvin(s.ct) / 50) * 50; // mireds are coarse: 370 → 2700 K, not 2703
  else if ((s.colormode === "hs" || s.colormode === "xy") && "hue" in s) st.color = rgbToHex(hsvToRgb({ h: (s.hue / 65535) * 360, s: (s.sat ?? 0) / 254, v: 1 }));
  return st;
}

function stateBody(action, value, device) {
  switch (action) {
    case "turn_on":
      return { on: true };
    case "turn_off":
      return { on: false };
    case "toggle":
      return { on: !device.state?.on };
    case "set_brightness": {
      const pct = parsePercent(need(value, "brightness"), device.state?.brightness);
      if (pct == null) throw new DeviceError(`I didn't understand the brightness "${value}".`);
      return pct === 0 ? { on: false } : { on: true, bri: clamp(Math.round(pct * 2.54), 1, 254) };
    }
    case "set_color": {
      const rgb = parseColor(need(value, "colour"));
      if (!rgb) throw new DeviceError(`I don't know the colour "${value}".`);
      const { h, s } = rgbToHsv(rgb);
      if (s < 0.08) return device.actions?.includes("set_color_temperature") ? { on: true, ct: 300 } : { on: true, sat: 0 }; // white-ish
      return { on: true, hue: Math.round((h / 360) * 65535), sat: Math.round(s * 254) };
    }
    case "set_color_temperature": {
      const k = parseKelvin(need(value, "white tone"));
      if (!k) throw new DeviceError(`I didn't understand the white tone "${value}".`);
      return { on: true, ct: clamp(kelvinToMired(k), 153, 500) };
    }
    case "identify":
      return { alert: "lselect" };
    default:
      return null;
  }
}

export default {
  id: "hue",
  label: "Philips Hue",

  hinted(host) {
    return (
      host.mdns.some((s) => s.type === "_hue._tcp") ||
      host.ssdp.some((r) => r.headers?.["hue-bridgeid"] || /IpBridge|hue/i.test(`${r.server} ${r.desc?.modelName} ${r.desc?.manufacturer}`)) ||
      host.vendor === "Philips Lighting" ||
      /hue/i.test(host.http?.[80]?.title || "")
    );
  },

  async detect(host, ctx) {
    if (!this.hinted(host)) return null;
    let cfg;
    try {
      cfg = await api(host.ip, "/api/config", { timeout: 2500 });
    } catch {
      return null;
    }
    if (!cfg?.bridgeid) return null;
    const bridgeId = cfg.bridgeid.toLowerCase();
    const bridge = {
      id: `hue:${bridgeId}`,
      driver: "hue",
      kind: "hub",
      brand: "Philips Hue",
      model: MODELS[cfg.modelid] || `Hue Bridge ${cfg.modelid || ""}`.trim(),
      name: cfg.name || "Hue Bridge",
      ip: host.ip,
      mac: normalizeMac(cfg.mac),
      ref: { ip: host.ip, bridgeId },
      info: { firmware: cfg.swversion, api: cfg.apiversion },
      webUrl: null,
      actions: ["pair", "rename", "set_room"],
      setup: { kind: "button", message: "Press the round button on top of the Hue Bridge, then press Connect within 30 seconds." },
    };
    const username = ctx.secrets.hue?.[bridgeId]?.username;
    if (!username) return [bridge];

    let all;
    try {
      all = await api(host.ip, `/api/${username}`);
    } catch (err) {
      if (err.code === "EAUTH") {
        ctx.forgetSecret(["hue", bridgeId]);
        return [bridge];
      }
      return [bridge];
    }
    bridge.setup = null;
    bridge.actions = ["update_firmware", "enable_auto_updates", "rename", "set_room"];
    const su = all.config?.swupdate2 || {};
    bridge.info = { ...bridge.info, updateState: su.state || null, autoUpdate: su.autoinstall?.on ?? null, lights: Object.keys(all.lights || {}).length };
    bridge.state = { updateAvailable: /readytoinstall/.test(su.state || ""), autoUpdate: su.autoinstall?.on ?? null };

    const roomOf = {};
    const devices = [bridge];
    for (const [gid, g] of Object.entries(all.groups || {})) {
      if (g.type === "Room") for (const lid of g.lights || []) roomOf[lid] = g.name;
    }
    for (const [n, l] of Object.entries(all.lights || {})) {
      devices.push({
        id: `hue:${bridgeId}:${String(l.uniqueid || n).replace(/[^0-9a-z]/gi, "").toLowerCase()}`,
        driver: "hue",
        parent: bridge.id,
        kind: lightKind(l),
        brand: l.manufacturername && !/signify|philips/i.test(l.manufacturername) ? l.manufacturername : "Philips Hue",
        model: l.productname || l.modelid || l.type,
        name: l.name,
        ip: host.ip,
        room: roomOf[n] || null,
        online: l.state?.reachable !== false,
        ref: { ip: host.ip, bridgeId, light: n, type: l.type },
        state: lightState(l.state),
        info: { firmware: l.swversion, reachable: l.state?.reachable !== false },
        actions: lightActions(l),
      });
    }
    for (const [gid, g] of Object.entries(all.groups || {})) {
      if (g.type !== "Room" && g.type !== "Zone") continue;
      const scenes = Object.entries(all.scenes || {})
        .filter(([, s]) => s.group === gid)
        .map(([id, s]) => ({ id, name: s.name }));
      devices.push({
        id: `hue:${bridgeId}:group:${gid}`,
        driver: "hue",
        parent: bridge.id,
        kind: "room",
        brand: "Philips Hue",
        model: `${g.type === "Zone" ? "Zone" : "Room"} · ${g.lights?.length || 0} lights`,
        name: g.name,
        ip: host.ip,
        room: g.type === "Room" ? g.name : null,
        ref: { ip: host.ip, bridgeId, group: gid, scenes },
        state: { on: !!g.state?.any_on, allOn: !!g.state?.all_on, ...(g.action && "bri" in g.action ? { brightness: Math.round((g.action.bri / 254) * 100) } : {}) },
        info: { scenes: scenes.map((s) => s.name), lights: g.lights?.length || 0 },
        actions: ["turn_on", "turn_off", "toggle", "set_brightness", "set_color", "set_color_temperature", ...(scenes.length ? ["set_scene"] : []), "rename"],
      });
    }
    return devices;
  },

  async refresh(device, ctx) {
    const { ip, bridgeId, light, group } = device.ref;
    const username = ctx.secrets.hue?.[bridgeId]?.username;
    if (!username) return null;
    if (light) {
      const l = await api(ip, `/api/${username}/lights/${light}`);
      return { state: lightState(l.state), online: l.state?.reachable !== false };
    }
    if (group) {
      const g = await api(ip, `/api/${username}/groups/${group}`);
      return { state: { on: !!g.state?.any_on, allOn: !!g.state?.all_on, ...(g.action && "bri" in g.action ? { brightness: Math.round((g.action.bri / 254) * 100) } : {}) } };
    }
    const cfg = await api(ip, `/api/${username}/config`);
    const su = cfg.swupdate2 || {};
    return { state: { updateAvailable: /readytoinstall/.test(su.state || ""), autoUpdate: su.autoinstall?.on ?? null }, info: { ...device.info, updateState: su.state, autoUpdate: su.autoinstall?.on ?? null, firmware: cfg.swversion } };
  },

  async act(device, action, value, ctx) {
    const { ip, bridgeId, light, group } = device.ref;
    try {
      if (action === "pair") {
        const res = await api(ip, "/api", { method: "POST", body: { devicetype: `patch#${ctx.hostname.slice(0, 19)}` } }).catch((err) => {
          if (err.code === "ELINK") throw new DeviceError("Press the round button on top of the Hue Bridge first, then ask me again within 30 seconds.", { code: "ELINK" });
          throw err;
        });
        const username = res?.[0]?.success?.username;
        if (!username) throw new DeviceError("The Hue Bridge didn't hand over a key.");
        await ctx.saveSecret(["hue", bridgeId], { username });
        // Load the lights and rooms straight away so they can be used in the very next sentence.
        const devices = (await this.detect({ ip, mdns: [{ type: "_hue._tcp" }], ssdp: [], ports: new Set([80]), hostnames: new Set(), http: {} }, ctx).catch(() => null)) || [];
        const lights = devices.filter((d) => d.kind === "light" || d.kind === "plug");
        const rooms = devices.filter((d) => d.kind === "room").map((d) => d.name);
        return done(`Paired with the Hue Bridge. I found ${lights.length} light${lights.length === 1 ? "" : "s"}${rooms.length ? ` in ${rooms.length} room${rooms.length === 1 ? "" : "s"}: ${rooms.join(", ")}` : ""}.`, { devices });
      }
      const username = ctx.secrets.hue?.[bridgeId]?.username;
      if (!username) throw new DeviceError("I need to pair with the Hue Bridge first. Press its round button, then ask me to pair it.", { code: "ESETUP" });

      if (!light && !group) {
        if (action === "update_firmware") {
          const cfg = await api(ip, `/api/${username}/config`);
          const state = cfg.swupdate2?.state;
          if (/readytoinstall/.test(state || "")) {
            await api(ip, `/api/${username}/config`, { method: "PUT", body: { swupdate2: { install: true } } });
            return done("The Hue Bridge is installing its update. Lights may not respond for a few minutes.");
          }
          await api(ip, `/api/${username}/config`, { method: "PUT", body: { swupdate2: { checkforupdate: true } } });
          return done(state === "noupdates" ? "The Hue system is already up to date. I asked it to check again anyway." : "I asked the Hue Bridge to check for updates; it will download any it finds.");
        }
        if (action === "enable_auto_updates") {
          await api(ip, `/api/${username}/config`, { method: "PUT", body: { swupdate2: { autoinstall: { on: true } } } });
          return done("Automatic updates are now on for the Hue system. They install overnight.", { state: { ...device.state, autoUpdate: true } });
        }
        if (action === "rename") {
          const name = String(need(value, "name")).slice(0, 16);
          await api(ip, `/api/${username}/config`, { method: "PUT", body: { name } });
          return done(`Renamed the bridge to ${name}.`, { name });
        }
        throw unsupported(device, action);
      }

      const base = light ? `/api/${username}/lights/${light}` : `/api/${username}/groups/${group}`;
      if (action === "rename") {
        const name = String(need(value, "name")).slice(0, 32);
        await api(ip, base, { method: "PUT", body: { name } });
        return done(`Renamed it to ${name} on the Hue Bridge too.`, { name });
      }
      if (action === "set_scene") {
        const scene = fuzzyPick(need(value, "scene"), device.ref.scenes || []);
        if (!scene) throw new DeviceError(`${device.name} has no scene called "${value}". Scenes: ${(device.ref.scenes || []).map((s) => s.name).join(", ") || "none"}.`);
        await api(ip, `${base}/action`, { method: "PUT", body: { scene: scene.id } });
        return done(`Set ${device.name} to ${scene.name}.`, { state: { ...device.state, on: true } });
      }
      if (!device.actions.includes(action)) throw unsupported(device, action);
      const body = stateBody(action, value, device);
      if (!body) throw unsupported(device, action);
      await api(ip, light ? `${base}/state` : `${base}/action`, { method: "PUT", body });
      if (action === "identify") {
        setTimeout(() => api(ip, `${base}/state`, { method: "PUT", body: { alert: "none" } }).catch(() => {}), 4000);
        return done(`${device.name} is blinking now.`);
      }
      const next = { ...device.state };
      if ("on" in body) next.on = body.on;
      if (body.bri) next.brightness = Math.round((body.bri / 254) * 100);
      if (body.ct) {
        next.colorTemperature = Math.round(miredToKelvin(body.ct) / 50) * 50;
        delete next.color;
      }
      if ("hue" in body) {
        next.color = rgbToHex(hsvToRgb({ h: (body.hue / 65535) * 360, s: body.sat / 254, v: 1 }));
        delete next.colorTemperature;
      }
      return done(describe(device, action, next), { state: next });
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};

function describe(device, action, s) {
  if (action === "turn_off" || (action === "toggle" && !s.on) || (action === "set_brightness" && !s.on)) return `${device.name} is off.`;
  if (action === "set_brightness") return `${device.name} is at ${s.brightness}%.`;
  if (action === "set_color") return `${device.name} is now ${s.color}.`;
  if (action === "set_color_temperature") return `${device.name} is set to ${s.colorTemperature} kelvin.`;
  return `${device.name} is on.`;
}
