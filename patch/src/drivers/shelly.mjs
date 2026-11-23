// Shelly relays, plugs, dimmers and bulbs. Gen1 uses simple GET URLs; Gen2 and later use JSON-RPC at /rpc.
// Password-protected devices: Gen1 uses Basic auth, Gen2+ uses Digest auth with user "admin".
import { request } from "../net/lanhttp.mjs";
import { clamp, normalizeMac, parsePercent } from "../util.mjs";
import { DeviceError, done, explainError, need, parseOnOff, unsupported } from "./common.mjs";

function kindFrom(text) {
  const t = String(text || "");
  if (/plug/i.test(t)) return "plug";
  if (/dimmer|rgbw|bulb|duo|vintage|light|SHDM|SHBLB|SHCB|SHBDUO|SHVIN|SHRGBW/i.test(t)) return "light";
  if (/(^|\W)(ht|h&t|smoke|flood|door|window|motion|gas|em|3em|sense|trv|blu)(\W|$)|SHHT|SHWT|SHDW|SHMOS|SHGS|SHSM|SHEM|SHTRV|SHSEN/i.test(t)) return "sensor";
  return "switch";
}

const MODEL_NAMES = {
  "SHSW-1": "Shelly 1", "SHSW-PM": "Shelly 1PM", "SHSW-25": "Shelly 2.5", "SHSW-L": "Shelly 1L", "SHPLG-S": "Shelly Plug S",
  "SHPLG-1": "Shelly Plug", "SHPLG2-1": "Shelly Plug", "SHPLG-U1": "Shelly Plug US", "SHDM-1": "Shelly Dimmer", "SHDM-2": "Shelly Dimmer 2",
  "SHRGBW2": "Shelly RGBW2", "SHBLB-1": "Shelly Bulb", "SHBDUO-1": "Shelly Duo", "SHVIN-1": "Shelly Vintage", "SHEM": "Shelly EM",
  "SHEM-3": "Shelly 3EM", "SHHT-1": "Shelly H&T", "SHWT-1": "Shelly Flood", "SHDW-2": "Shelly Door/Window 2", "SHIX3-1": "Shelly i3",
};

const GEN2_NAMES = {
  PlugS: "Shelly Plus Plug S", PlugUS: "Shelly Plus Plug US", PlugIT: "Shelly Plus Plug IT", PlugUK: "Shelly Plus Plug UK", Plug: "Shelly Plug",
  Plus1: "Shelly Plus 1", Plus1PM: "Shelly Plus 1PM", Plus2PM: "Shelly Plus 2PM", PlusI4: "Shelly Plus i4", PlusHT: "Shelly Plus H&T",
  Pro1: "Shelly Pro 1", Pro1PM: "Shelly Pro 1PM", Pro2PM: "Shelly Pro 2PM", Pro4PM: "Shelly Pro 4PM", Pro3EM: "Shelly Pro 3EM",
  Mini1: "Shelly 1 Mini", Mini1PM: "Shelly 1PM Mini", MiniPM: "Shelly PM Mini", PlusDimmer: "Shelly Plus Dimmer", PlusWallDimmer: "Shelly Plus Wall Dimmer",
  PlusRGBW: "Shelly Plus RGBW PM", S1G3: "Shelly 1 Gen3", S1PMG3: "Shelly 1PM Gen3", HTG3: "Shelly H&T Gen3", DimmerG3: "Shelly Dimmer Gen3",
};

async function gen1(ref, path, auth) {
  const res = await request({ url: `http://${ref.ip}${path}`, timeout: 3500, auth: auth ? { ...auth, basic: true } : undefined });
  if (res.status === 401) throw new DeviceError("This Shelly has a password set.", { code: "EAUTH" });
  if (res.status >= 400) throw new DeviceError(`The Shelly said no (HTTP ${res.status}).`);
  return res.json();
}

let rpcId = 1;
async function rpc(ref, method, params, auth) {
  const res = await request({ url: `http://${ref.ip}/rpc`, method: "POST", body: { id: rpcId++, method, params: params || {} }, timeout: 4000, auth: auth ? { username: "admin", password: auth.password } : undefined });
  if (res.status === 401) throw new DeviceError("This Shelly has a password set.", { code: "EAUTH" });
  const data = res.json();
  if (data.error) throw new DeviceError(data.error.message || `Shelly error ${data.error.code}`);
  return data.result;
}

function gen2State(status, comp, ch) {
  const c = status?.[`${comp}:${ch}`] || {};
  const st = { on: !!c.output };
  if (typeof c.brightness === "number") st.brightness = c.brightness;
  if (typeof c.apower === "number") st.power = Math.round(c.apower * 10) / 10;
  if (c.aenergy?.total != null) st.energyKwh = Math.round(c.aenergy.total / 10) / 100;
  if (comp === "cover") {
    st.position = c.current_pos ?? null;
    st.on = c.state === "open" || c.state === "opening";
  }
  return st;
}

function gen1State(status, comp, ch) {
  if (comp === "light") {
    const l = status?.lights?.[ch] || {};
    return { on: !!l.ison, ...(typeof l.brightness === "number" ? { brightness: l.brightness } : {}), ...(status?.meters?.[ch]?.power != null ? { power: status.meters[ch].power } : {}) };
  }
  const r = status?.relays?.[ch] || {};
  const st = { on: !!r.ison };
  const m = status?.meters?.[ch] || status?.emeters?.[ch];
  if (m?.power != null) st.power = Math.round(m.power * 10) / 10;
  return st;
}

export default {
  id: "shelly",
  label: "Shelly",

  async detect(host, ctx) {
    const hinted =
      host.mdns.some((s) => s.type === "_shelly._tcp" || (/^_https?\._tcp$/.test(s.type) && /^shelly/i.test(s.name))) ||
      /shelly/i.test(`${host.http?.[80]?.title} ${[...host.hostnames].join(" ")}`) ||
      (host.vendor === "Espressif" && host.ports.has(80)) ||
      (!host.vendor && host.ports.has(80) && host.ports.size <= 2);
    if (!hinted) return null;
    let id;
    try {
      const res = await request({ url: `http://${host.ip}/shelly`, timeout: 2000 });
      if (res.status !== 200) return null;
      id = res.json();
    } catch {
      return null;
    }
    if (!id || (!id.type && !id.gen && !id.model)) return null;
    const gen = id.gen || 1;
    const mac = normalizeMac(id.mac);
    const baseId = `shelly:${(mac || host.ip).replace(/:/g, "")}`;
    const locked = gen === 1 ? !!id.auth : !!id.auth_en;
    const auth = ctx.secrets.credentials?.[baseId];
    const ref = { ip: host.ip, gen };
    const model = gen === 1 ? MODEL_NAMES[id.type] || id.type : id.app ? GEN2_NAMES[id.app] || `Shelly ${id.app.replace(/^(Plus|Pro|Mini)(?=\w)/, "$1 ")}` : id.model;
    const kind = kindFrom(gen === 1 ? id.type : `${id.app} ${id.model}`);
    const common = { driver: "shelly", brand: "Shelly", model, ip: host.ip, mac, info: { firmware: gen === 1 ? id.fw : id.ver, generation: gen, passwordProtected: locked } };

    if (locked && !auth) {
      return [
        {
          ...common,
          id: baseId,
          kind,
          name: id.name || model,
          ref: { ...ref, channel: 0, comp: kind === "light" ? "light" : "switch" },
          state: {},
          setup: { kind: "password", message: "This Shelly is password-protected (good!). Add its password in Patch so I can control it." },
          actions: ["rename", "set_room"],
        },
      ];
    }

    try {
      let name = id.name || null;
      let channels = [];
      let info = {};
      let state0 = {};
      if (gen === 1) {
        const [settings, status] = await Promise.all([gen1(ref, "/settings", auth), gen1(ref, "/status", auth)]);
        name = settings.name || name;
        const comp = status.lights?.length ? "light" : "relay";
        const n = comp === "light" ? status.lights.length : status.relays?.length || 0;
        for (let ch = 0; ch < n; ch++) channels.push({ comp, ch, name: comp === "relay" ? settings.relays?.[ch]?.name : settings.lights?.[ch]?.name, state: gen1State(status, comp, ch) });
        info = { rssi: status.wifi_sta?.rssi ?? null, ssid: status.wifi_sta?.ssid ?? null, updateAvailable: !!status.update?.has_update, newFirmware: status.update?.new_version || null, temperature: status.tmp?.tC ?? null };
      } else {
        const [config, status] = await Promise.all([rpc(ref, "Shelly.GetConfig", {}, auth), rpc(ref, "Shelly.GetStatus", {}, auth)]);
        name = config?.sys?.device?.name || name;
        for (const key of Object.keys(status || {})) {
          const m = key.match(/^(switch|light|cover):(\d+)$/);
          if (m) channels.push({ comp: m[1], ch: Number(m[2]), name: config?.[key]?.name, state: gen2State(status, m[1], Number(m[2])) });
        }
        const upd = status?.sys?.available_updates || {};
        info = { rssi: status?.wifi?.rssi ?? null, ssid: status?.wifi?.ssid ?? null, updateAvailable: !!upd.stable, newFirmware: upd.stable?.version || null, uptime: status?.sys?.uptime ?? null };
      }
      channels.sort((a, b) => a.ch - b.ch);
      const devName = name || model;
      const mk = (c, multi) => {
        const comp = c.comp === "relay" ? "switch" : c.comp;
        const k = comp === "light" ? "light" : comp === "cover" ? "cover" : kind === "light" ? "switch" : kind;
        return {
          ...common,
          id: multi ? `${baseId}:${c.ch}` : baseId,
          parent: multi ? baseId : undefined,
          kind: k,
          name: multi ? c.name || `${devName} · channel ${c.ch + 1}` : devName,
          ref: { ...ref, comp: c.comp, channel: c.ch },
          state: c.state,
          info: { ...common.info, ...info },
          actions:
            comp === "cover"
              ? ["open", "close", "stop", "set_position", "rename", "set_room"]
              : ["turn_on", "turn_off", "toggle", ...(comp === "light" ? ["set_brightness"] : []), "rename", "set_room", ...(multi ? [] : ["reboot", "update_firmware"])],
        };
      };
      if (channels.length <= 1) {
        const c = channels[0] || { comp: kind === "light" ? "light" : "relay", ch: 0, state: state0 };
        const d = mk(c, false);
        if (kind === "sensor" && !channels.length) d.actions = ["reboot", "update_firmware", "rename", "set_room"];
        return [d];
      }
      const parent = { ...common, id: baseId, kind: "switch", name: devName, ref: { ...ref, comp: "device", channel: null }, state: {}, info: { ...common.info, ...info, channels: channels.length }, actions: ["reboot", "update_firmware", "rename", "set_room"] };
      return [parent, ...channels.map((c) => mk(c, true))];
    } catch (err) {
      if (err.code === "EAUTH") {
        return [{ ...common, id: baseId, kind, name: id.name || model, ref: { ...ref, channel: 0, comp: "switch" }, state: {}, setup: { kind: "password", message: "The saved password for this Shelly didn't work. Update it in Patch." }, actions: ["rename", "set_room"] }];
      }
      return null;
    }
  },

  async refresh(device, ctx) {
    const auth = ctx.secrets.credentials?.[device.parent || device.id];
    const { comp, channel } = device.ref;
    if (comp === "device" || channel == null) return null;
    if (device.ref.gen === 1) {
      const status = await gen1(device.ref, "/status", auth);
      return { state: gen1State(status, comp === "light" ? "light" : "relay", channel) };
    }
    const status = await rpc(device.ref, "Shelly.GetStatus", {}, auth);
    return { state: gen2State(status, comp, channel) };
  },

  async act(device, action, value, ctx) {
    const auth = ctx.secrets.credentials?.[device.parent || device.id];
    const { gen, comp, channel } = device.ref;
    const ch = channel ?? 0;
    try {
      if (action === "reboot") {
        if (gen === 1) await gen1(device.ref, "/reboot", auth);
        else await rpc(device.ref, "Shelly.Reboot", {}, auth);
        return done(`${device.name} is restarting. It'll be back in about 20 seconds.`);
      }
      if (action === "update_firmware") {
        if (gen === 1) {
          const st = await gen1(device.ref, "/ota/check", auth).catch(() => null);
          const ota = await gen1(device.ref, "/ota", auth);
          if (!ota.has_update && !st?.has_update) return done(`${device.name} is already on the latest firmware.`);
          await gen1(device.ref, "/ota?update=true", auth);
        } else {
          const check = await rpc(device.ref, "Shelly.CheckForUpdate", {}, auth);
          if (!check?.stable) return done(`${device.name} is already on the latest firmware.`);
          await rpc(device.ref, "Shelly.Update", { stage: "stable" }, auth);
        }
        return done(`${device.name} is installing its update. It will restart by itself.`, { state: { ...device.state }, info: { ...device.info, updateAvailable: false } });
      }
      if (action === "rename" && !device.parent) {
        const name = String(need(value, "name")).slice(0, 60);
        if (gen === 1) await gen1(device.ref, `/settings?name=${encodeURIComponent(name)}`, auth);
        else await rpc(device.ref, "Sys.SetConfig", { config: { device: { name } } }, auth);
        return done(`Renamed it to ${name} on the device too.`, { name });
      }
      if (action === "set_led") {
        const on = parseOnOff(value);
        if (on == null || gen !== 1) throw unsupported(device, action);
        await gen1(device.ref, `/settings?led_status_disable=${on ? "false" : "true"}`, auth);
        return done(`Status light ${on ? "on" : "off"}.`);
      }
      if (comp === "cover") {
        if (gen === 1) {
          const go = action === "open" ? "open" : action === "close" ? "close" : action === "stop" ? "stop" : action === "set_position" ? `to_pos&roller_pos=${parsePercent(value) ?? 50}` : null;
          if (!go) throw unsupported(device, action);
          await gen1(device.ref, `/roller/${ch}?go=${go}`, auth);
        } else {
          const map = { open: ["Cover.Open", {}], close: ["Cover.Close", {}], stop: ["Cover.Stop", {}], set_position: ["Cover.GoToPosition", { pos: parsePercent(value) ?? 50 }] };
          if (!map[action]) throw unsupported(device, action);
          await rpc(device.ref, map[action][0], { id: ch, ...map[action][1] }, auth);
        }
        return done(`${device.name}: ${action.replace("_", " ")}.`);
      }
      if (!["turn_on", "turn_off", "toggle", "set_brightness"].includes(action)) throw unsupported(device, action);
      const isLight = comp === "light";
      let on = action === "turn_on" ? true : action === "turn_off" ? false : action === "toggle" ? !device.state?.on : true;
      let bri;
      if (action === "set_brightness") {
        if (!isLight) throw unsupported(device, action);
        bri = parsePercent(need(value, "brightness"), device.state?.brightness);
        if (bri == null) throw new DeviceError(`I didn't understand the brightness "${value}".`);
        if (bri === 0) on = false;
        else bri = clamp(bri, 1, 100);
      }
      if (gen === 1) {
        const path = isLight ? `/light/${ch}?turn=${on ? "on" : "off"}${bri ? `&brightness=${bri}` : ""}` : `/relay/${ch}?turn=${on ? "on" : "off"}`;
        await gen1(device.ref, path, auth);
      } else if (isLight) {
        await rpc(device.ref, "Light.Set", { id: ch, on, ...(bri ? { brightness: bri } : {}) }, auth);
      } else {
        await rpc(device.ref, "Switch.Set", { id: ch, on }, auth);
      }
      const { power, ...rest } = device.state || {}; // wattage is stale after switching
      const state = { ...rest, on, ...(bri ? { brightness: bri } : {}) };
      return done(on ? (bri ? `${device.name} is at ${bri}%.` : `${device.name} is on.`) : `${device.name} is off.`, { state });
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
