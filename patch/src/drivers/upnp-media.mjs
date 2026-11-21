// Any other UPnP/DLNA "media renderer": most smart TVs (Samsung, LG, Sony, Panasonic…), AV receivers
// and some speakers. Volume and mute work almost everywhere; play/pause only while media is playing.
import { findService } from "../net/ssdp.mjs";
import { soap } from "../net/upnp.mjs";
import { clamp, parsePercent } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";

const TV_WORDS = /\b(tv|television|bravia|webos|tizen|smart ?tv|samsung|lg|hisense|tcl|vizio|panasonic|philips|sharp|toshiba|qled|oled)\b/i;
const AV_WORDS = /\b(receiver|avr|denon|marantz|yamaha|onkyo|pioneer|harman|bose|soundbar)\b/i;

export default {
  id: "upnp",
  label: "Media renderer (DLNA)",

  async detect(host) {
    for (const r of host.ssdp) {
      const d = r.desc;
      if (!d) continue;
      const rcs = findService(d, /RenderingControl/);
      if (!rcs?.controlURL) continue;
      const avt = findService(d, /AVTransport/);
      const text = `${d.friendlyName} ${d.manufacturer} ${d.modelName} ${d.modelDescription}`;
      const kind = TV_WORDS.test(text) ? "tv" : AV_WORDS.test(text) ? "speaker" : "media";
      const vol = await soap(rcs.controlURL, rcs.serviceType, "GetVolume", { InstanceID: 0, Channel: "Master" }, { timeout: 2500 }).catch(() => null);
      return [
        {
          id: `upnp:${(d.udn || host.ip).replace(/^uuid:/, "").toLowerCase()}`,
          driver: "upnp",
          kind,
          brand: d.manufacturer || null,
          model: d.modelName || d.modelDescription || null,
          name: d.friendlyName || d.modelName || "Media player",
          ip: host.ip,
          ref: { rc: { url: rcs.controlURL, type: rcs.serviceType }, avt: avt?.controlURL ? { url: avt.controlURL, type: avt.serviceType } : null },
          state: { volume: vol ? Number(vol.CurrentVolume) : null },
          info: { upnpType: d.deviceType },
          actions: ["set_volume", "volume_up", "volume_down", "mute", "unmute", ...(avt?.controlURL ? ["play", "pause", "stop"] : []), "rename", "set_room"],
        },
      ];
    }
    return null;
  },

  async refresh(device) {
    const { rc } = device.ref;
    const [vol, mute] = await Promise.all([
      soap(rc.url, rc.type, "GetVolume", { InstanceID: 0, Channel: "Master" }).catch(() => null),
      soap(rc.url, rc.type, "GetMute", { InstanceID: 0, Channel: "Master" }).catch(() => null),
    ]);
    if (!vol && !mute) return { online: false };
    return { online: true, state: { volume: vol ? Number(vol.CurrentVolume) : null, muted: mute ? mute.CurrentMute === "1" : null } };
  },

  async act(device, action, value) {
    const { rc, avt } = device.ref;
    const call = (svc, name, args) => soap(svc.url, svc.type, name, { InstanceID: 0, ...args });
    try {
      switch (action) {
        case "set_volume":
        case "volume_up":
        case "volume_down": {
          let v;
          if (action === "set_volume") v = parsePercent(need(value, "volume"), device.state?.volume);
          else {
            const cur = Number((await call(rc, "GetVolume", { Channel: "Master" })).CurrentVolume);
            v = clamp(cur + (action === "volume_up" ? 1 : -1) * Math.min(Math.max(Number(value) || 5, 1), 50), 0, 100);
          }
          if (v == null) throw new DeviceError(`I didn't catch the volume "${value}".`);
          await call(rc, "SetVolume", { Channel: "Master", DesiredVolume: v });
          return done(`${device.name} volume is ${v}.`, { state: { ...device.state, volume: v } });
        }
        case "mute":
        case "unmute":
          await call(rc, "SetMute", { Channel: "Master", DesiredMute: action === "mute" ? 1 : 0 });
          return done(action === "mute" ? `${device.name} is muted.` : `${device.name} is unmuted.`, { state: { ...device.state, muted: action === "mute" } });
        case "play":
        case "pause":
        case "stop":
          if (!avt) throw unsupported(device, action);
          await call(avt, action === "play" ? "Play" : action === "pause" ? "Pause" : "Stop", action === "play" ? { Speed: 1 } : {});
          return done(action === "play" ? "Playing." : action === "pause" ? "Paused." : "Stopped.");
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
