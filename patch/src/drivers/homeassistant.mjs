// Home Assistant bridge. If you already run Home Assistant, Patch can control everything it controls
// (thermostats, locks, blinds, vacuums, cameras' lights, Tapo/Tuya/Nest/ecobee devices…) through its
// REST API with a long-lived access token (Profile → Security → Long-lived access tokens).
import { clamp, fuzzyPick, parseColor, parseKelvin, parsePercent, rgbToHex } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";
import { parseChannel } from "./tv.mjs";

const DOMAINS = new Set(["light", "switch", "fan", "cover", "climate", "media_player", "lock", "vacuum", "scene", "script"]);

async function ha(conf, path, { method = "GET", body, timeout = 6000 } = {}) {
  const res = await fetch(new URL(path, conf.url.replace(/\/?$/, "/")), {
    method,
    headers: { authorization: `Bearer ${conf.token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (res.status === 401 || res.status === 403) throw new DeviceError("Home Assistant rejected the access token. Create a new long-lived token and paste it into Patch's settings.", { code: "EAUTH" });
  if (!res.ok) throw new DeviceError(`Home Assistant answered HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

const AREA_TEMPLATE =
  "{%- set ns = namespace(items=[]) -%}{%- for s in states -%}{%- set a = area_name(s.entity_id) -%}{%- if a -%}{%- set ns.items = ns.items + [[s.entity_id, a]] -%}{%- endif -%}{%- endfor -%}{{ ns.items | tojson }}";

function kindOf(domain, a) {
  switch (domain) {
    case "light":
      return "light";
    case "switch":
      return a.device_class === "outlet" ? "plug" : "switch";
    case "fan":
      return "fan";
    case "cover":
      return a.device_class === "garage" || a.device_class === "gate" ? "garage" : "cover";
    case "climate":
      return "thermostat";
    case "media_player":
      return a.device_class === "tv" ? "tv" : a.device_class === "speaker" || a.device_class === "receiver" ? "speaker" : "media";
    case "lock":
      return "lock";
    case "vacuum":
      return "vacuum";
    default:
      return "scene";
  }
}

function actionsOf(domain, a) {
  switch (domain) {
    case "light": {
      const modes = a.supported_color_modes || [];
      const out = ["turn_on", "turn_off", "toggle"];
      if (modes.some((m) => m !== "onoff")) out.push("set_brightness");
      if (modes.some((m) => ["hs", "xy", "rgb", "rgbw", "rgbww"].includes(m))) out.push("set_color");
      if (modes.includes("color_temp")) out.push("set_color_temperature");
      return out;
    }
    case "switch":
    case "fan":
      return ["turn_on", "turn_off", "toggle"];
    case "cover":
      return ["open", "close", "stop", ...("current_position" in a ? ["set_position"] : [])];
    case "climate":
      return ["set_temperature", "set_mode", "turn_on", "turn_off"];
    case "media_player":
      return [
        "turn_on", "turn_off", "play", "pause", "stop", "next", "previous", "set_volume", "volume_up", "volume_down", "mute", "unmute",
        ...(a.source_list?.length ? ["launch_app", "switch_input"] : []),
        ...(a.device_class === "tv" ? ["set_channel"] : []),
      ];
    case "lock":
      return ["lock", "unlock"];
    case "vacuum":
      return ["start", "stop", "dock"];
    default:
      return ["activate"];
  }
}

function stateOf(domain, s, unit) {
  const a = s.attributes || {};
  const st = {};
  if (["light", "switch", "fan"].includes(domain)) st.on = s.state === "on";
  if (domain === "light") {
    if (typeof a.brightness === "number") st.brightness = Math.round((a.brightness / 255) * 100);
    if (a.color_mode === "color_temp" && a.color_temp_kelvin) st.colorTemperature = a.color_temp_kelvin;
    else if (Array.isArray(a.rgb_color)) st.color = rgbToHex(a.rgb_color);
  }
  if (domain === "cover") {
    st.status = s.state;
    if (typeof a.current_position === "number") st.position = a.current_position;
  }
  if (domain === "climate") {
    st.mode = s.state;
    st.currentTemperature = a.current_temperature ?? null;
    st.targetTemperature = a.temperature ?? null;
    st.unit = unit;
    st.modes = a.hvac_modes || [];
  }
  if (domain === "media_player") {
    st.on = !["off", "standby", "unavailable"].includes(s.state);
    st.playback = s.state;
    if (typeof a.volume_level === "number") st.volume = Math.round(a.volume_level * 100);
    if (typeof a.is_volume_muted === "boolean") st.muted = a.is_volume_muted;
    const track = [a.media_title, a.media_artist].filter(Boolean).join(" — ");
    if (track) st.track = track;
    if (a.app_name || a.source) st.app = a.app_name || a.source;
  }
  if (domain === "lock") st.locked = s.state === "locked";
  if (domain === "vacuum") {
    st.status = s.state;
    if (typeof a.battery_level === "number") st.battery = a.battery_level;
  }
  return st;
}

export async function haSnapshot(conf) {
  const [config, states] = await Promise.all([ha(conf, "api/config"), ha(conf, "api/states")]);
  let areas = {};
  try {
    const raw = await ha(conf, "api/template", { method: "POST", body: { template: AREA_TEMPLATE } });
    areas = Object.fromEntries(typeof raw === "string" ? JSON.parse(raw) : raw || []);
  } catch {
    /* areas are optional */
  }
  return { config, states, areas };
}

export default {
  id: "homeassistant",
  label: "Home Assistant",

  async detect(host, ctx) {
    const svc = host.mdns.find((s) => s.type === "_home-assistant._tcp");
    if (!svc && !host.ports.has(8123)) return null;
    const connected = !!ctx.secrets.homeAssistant?.token; // then extra() fills in the hub and its devices
    const port = svc?.port || 8123;
    return [
      {
        id: "ha:hub",
        driver: "homeassistant",
        kind: "hub",
        brand: "Home Assistant",
        model: svc?.txt?.version ? `Home Assistant ${svc.txt.version}` : "Home Assistant",
        name: svc?.txt?.location_name || "Home Assistant",
        ip: host.ip,
        ref: { url: svc?.txt?.internal_url || svc?.txt?.base_url || `http://${host.ip}:${port}` },
        webUrl: svc?.txt?.internal_url || `http://${host.ip}:${port}/`,
        setup: connected ? null : { kind: "token", message: "Paste a long-lived access token from Home Assistant (your profile → Security) into Patch's settings, and I can control everything Home Assistant controls." },
        actions: ["rename", "set_room"],
      },
    ];
  },

  /** Devices that come from the configured Home Assistant rather than from a scanned address. */
  async extra(ctx) {
    const conf = ctx.secrets.homeAssistant;
    if (!conf?.url || !conf?.token) return [];
    const host = new URL(conf.url).hostname;
    const hub = {
      id: "ha:hub",
      driver: "homeassistant",
      kind: "hub",
      brand: "Home Assistant",
      model: "Home Assistant",
      name: "Home Assistant",
      ip: /^\d+\.\d+\.\d+\.\d+$/.test(host) ? host : null,
      ref: { url: conf.url },
      webUrl: conf.url,
      actions: ["rename", "set_room"],
      info: {},
    };
    let snap;
    try {
      snap = await haSnapshot(conf);
    } catch (err) {
      hub.online = false;
      hub.setup = { kind: "token", message: err.message };
      return [hub];
    }
    const unit = snap.config?.unit_system?.temperature || "°C";
    hub.name = snap.config?.location_name || "Home Assistant";
    hub.model = `Home Assistant ${snap.config?.version || ""}`.trim();
    hub.info = {
      version: snap.config?.version || null,
      updates: snap.states
        .filter((s) => s.entity_id.startsWith("update.") && s.state === "on")
        .map((s) => ({ entity: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, installed: s.attributes?.installed_version, latest: s.attributes?.latest_version })),
      lowBatteries: snap.states
        .filter((s) => s.attributes?.device_class === "battery" && s.entity_id.startsWith("sensor.") && Number(s.state) >= 0 && Number(s.state) <= 20)
        .map((s) => ({ entity: s.entity_id, name: s.attributes?.friendly_name || s.entity_id, level: Number(s.state) })),
      unavailable: snap.states.filter((s) => DOMAINS.has(s.entity_id.split(".")[0]) && s.state === "unavailable").length,
    };
    const devices = [hub];
    for (const s of snap.states) {
      const domain = s.entity_id.split(".")[0];
      if (!DOMAINS.has(domain)) continue;
      const a = s.attributes || {};
      if (a.hidden || a.entity_category) continue;
      devices.push({
        id: `ha:${s.entity_id}`,
        driver: "homeassistant",
        parent: "ha:hub",
        kind: kindOf(domain, a),
        brand: "Home Assistant",
        model: domain === "script" ? "Home Assistant script" : domain === "scene" ? "Home Assistant scene" : `via Home Assistant`,
        name: a.friendly_name || s.entity_id,
        ip: null,
        room: snap.areas[s.entity_id] || null,
        online: s.state !== "unavailable",
        ref: { entity: s.entity_id, domain, unit, ...(domain === "media_player" && a.source_list?.length ? { sources: a.source_list.slice(0, 80).map(String) } : {}) },
        state: stateOf(domain, s, unit),
        info: {},
        actions: [...actionsOf(domain, a), "set_room"],
      });
    }
    return devices;
  },

  async refresh(device, ctx) {
    const conf = ctx.secrets.homeAssistant;
    if (!conf?.token || !device.ref.entity) return null;
    const s = await ha(conf, `api/states/${device.ref.entity}`);
    return { state: stateOf(device.ref.domain, s, device.ref.unit), online: s.state !== "unavailable" };
  },

  async act(device, action, value, ctx) {
    const conf = ctx.secrets.homeAssistant;
    if (!conf?.token) throw new DeviceError("Connect Home Assistant in Patch's settings first.", { code: "ESETUP" });
    const { entity, domain } = device.ref;
    if (!entity) throw unsupported(device, action);
    const call = (svcDomain, service, data = {}) => ha(conf, `api/services/${svcDomain}/${service}`, { method: "POST", body: { entity_id: entity, ...data } });
    try {
      const simple = {
        turn_on: [domain, "turn_on"], turn_off: [domain, "turn_off"], toggle: [domain, "toggle"],
        open: ["cover", "open_cover"], close: ["cover", "close_cover"], lock: ["lock", "lock"], unlock: ["lock", "unlock"],
        start: ["vacuum", "start"], dock: ["vacuum", "return_to_base"], activate: [domain, "turn_on"],
        play: ["media_player", "media_play"], pause: ["media_player", "media_pause"], next: ["media_player", "media_next_track"],
        previous: ["media_player", "media_previous_track"], volume_up: ["media_player", "volume_up"], volume_down: ["media_player", "volume_down"],
      };
      if (action === "stop") {
        if (domain === "cover") await call("cover", "stop_cover");
        else if (domain === "vacuum") await call("vacuum", "stop");
        else await call("media_player", "media_stop");
        return done(`Stopped ${device.name}.`);
      }
      if (action === "mute" || action === "unmute") {
        await call("media_player", "volume_mute", { is_volume_muted: action === "mute" });
        return done(`${device.name} is ${action === "mute" ? "muted" : "unmuted"}.`, { state: { ...device.state, muted: action === "mute" } });
      }
      if (action === "launch_app" || action === "switch_input") {
        const sources = device.ref.sources || [];
        const hit = fuzzyPick(need(value, action === "launch_app" ? "app" : "input"), sources);
        if (!hit) throw new DeviceError(`${device.name} can switch to ${sources.slice(0, 12).join(", ") || "nothing else"}.`, { code: "ENOTFOUND" });
        await call("media_player", "select_source", { source: hit });
        return done(`Switched ${device.name} to ${hit}.`, { state: { ...device.state, on: true, app: hit } });
      }
      if (action === "set_channel") {
        const ch = parseChannel(value);
        if (!ch.number) throw new DeviceError("Through Home Assistant I can change to a channel by its number.", { code: "EVALUE" });
        await call("media_player", "play_media", { media_content_type: "channel", media_content_id: ch.number });
        return done(`${device.name} is on channel ${ch.number}.`, { state: { ...device.state, channel: ch.number } });
      }
      if (action === "set_volume") {
        const v = parsePercent(need(value, "volume"), device.state?.volume);
        if (v == null) throw new DeviceError(`I didn't catch the volume "${value}".`);
        await call("media_player", "volume_set", { volume_level: v / 100 });
        return done(`${device.name} volume is ${v}%.`, { state: { ...device.state, volume: v } });
      }
      if (action === "set_brightness") {
        const v = parsePercent(need(value, "brightness"), device.state?.brightness);
        if (v == null) throw new DeviceError(`I didn't understand the brightness "${value}".`);
        if (v === 0) await call("light", "turn_off");
        else await call("light", "turn_on", { brightness_pct: v });
        return done(v ? `${device.name} is at ${v}%.` : `${device.name} is off.`, { state: { ...device.state, on: v > 0, ...(v ? { brightness: v } : {}) } });
      }
      if (action === "set_color") {
        const rgb = parseColor(need(value, "colour"));
        if (!rgb) throw new DeviceError(`I don't know the colour "${value}".`);
        await call("light", "turn_on", { rgb_color: rgb });
        return done(`${device.name} is now ${rgbToHex(rgb)}.`, { state: { ...device.state, on: true, color: rgbToHex(rgb) } });
      }
      if (action === "set_color_temperature") {
        const k = parseKelvin(need(value, "white tone"));
        if (!k) throw new DeviceError(`I didn't understand the white tone "${value}".`);
        await call("light", "turn_on", { color_temp_kelvin: k });
        return done(`${device.name} is set to ${k} kelvin.`, { state: { ...device.state, on: true, colorTemperature: k } });
      }
      if (action === "set_position") {
        const p = parsePercent(need(value, "position"));
        await call("cover", "set_cover_position", { position: p });
        return done(`${device.name} is moving to ${p}%.`);
      }
      if (action === "set_temperature") {
        const t = Number(String(need(value, "temperature")).match(/-?\d+(\.\d+)?/)?.[0]);
        if (!Number.isFinite(t)) throw new DeviceError(`What temperature? For example 21.`);
        const safe = device.ref.unit === "°F" ? clamp(t, 45, 90) : clamp(t, 7, 32);
        await call("climate", "set_temperature", { temperature: safe });
        return done(`${device.name} is set to ${safe}${device.ref.unit || ""}.`, { state: { ...device.state, targetTemperature: safe } });
      }
      if (action === "set_mode") {
        const modes = device.state?.modes || ["heat", "cool", "heat_cool", "auto", "off"];
        const want = String(need(value, "mode")).toLowerCase().replace(/\s+/g, "_");
        const mode = modes.find((m) => m === want) || modes.find((m) => m.startsWith(want) || want.startsWith(m));
        if (!mode) throw new DeviceError(`${device.name} supports these modes: ${modes.join(", ")}.`);
        await call("climate", "set_hvac_mode", { hvac_mode: mode });
        return done(`${device.name} is set to ${mode.replace("_", " ")}.`, { state: { ...device.state, mode } });
      }
      if (action === "update_firmware") {
        await call("update", "install");
        return done(`Home Assistant is installing the update for ${device.name}.`);
      }
      const svc = simple[action];
      if (!svc || !device.actions.includes(action)) throw unsupported(device, action);
      await call(svc[0], svc[1]);
      const next = { ...device.state };
      if (action === "turn_on") next.on = true;
      if (action === "turn_off") next.on = false;
      if (action === "toggle") next.on = !device.state?.on;
      if (action === "lock" || action === "unlock") next.locked = action === "lock";
      return done(
        { turn_on: `${device.name} is on.`, turn_off: `${device.name} is off.`, toggle: `Toggled ${device.name}.`, lock: `${device.name} is locked.`, unlock: `${device.name} is unlocked.`, activate: `Ran ${device.name}.`, dock: `${device.name} is heading back to its dock.` }[action] ||
          `Done: ${action.replace(/_/g, " ")} on ${device.name}.`,
        { state: next },
      );
    } catch (err) {
      throw explainError(err, device.name);
    }
  },

  /** Used by tune-up fixes for Home Assistant update entities. */
  async installUpdate(entity, ctx) {
    const conf = ctx.secrets.homeAssistant;
    await ha(conf, "api/services/update/install", { method: "POST", body: { entity_id: entity } });
  },
};
