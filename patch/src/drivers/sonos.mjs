// Sonos speakers: UPnP on port 1400. Playback commands go to the group's coordinator;
// volume and mute stay per speaker.
import { fetchDescription } from "../net/ssdp.mjs";
import { soap, UpnpError } from "../net/upnp.mjs";
import { findAll, findFirst, parseXml, textOf } from "../net/xml.mjs";
import { clamp, parsePercent } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";

const AVT = "urn:schemas-upnp-org:service:AVTransport:1";
const RC = "urn:schemas-upnp-org:service:RenderingControl:1";
const ZGT = "urn:schemas-upnp-org:service:ZoneGroupTopology:1";

const rc = (base, action, args) => soap(`${base}/MediaRenderer/RenderingControl/Control`, RC, action, { InstanceID: 0, ...args });
const avt = (base, action, args) => soap(`${base}/MediaRenderer/AVTransport/Control`, AVT, action, { InstanceID: 0, ...args });

const coordinatorCache = new Map();

/** Base URL of the speaker that runs playback for this speaker's group. */
export async function coordinatorBase(base, uuid) {
  const hit = coordinatorCache.get(uuid);
  if (hit && Date.now() - hit.at < 60_000) return hit.base;
  try {
    const out = await soap(`${base}/ZoneGroupTopology/Control`, ZGT, "GetZoneGroupState", {});
    const doc = parseXml(out.ZoneGroupState || "");
    for (const g of findAll(doc, "ZoneGroup")) {
      const members = findAll(g, "ZoneGroupMember");
      if (!members.some((m) => m.attrs.UUID === uuid)) continue;
      const coord = members.find((m) => m.attrs.UUID === g.attrs.Coordinator);
      if (coord?.attrs.Location) {
        const cbase = new URL(coord.attrs.Location).origin;
        coordinatorCache.set(uuid, { base: cbase, at: Date.now() });
        return cbase;
      }
    }
  } catch {
    /* fall back to the speaker itself */
  }
  return base;
}

export function parseTrack(meta) {
  if (!meta || meta === "NOT_IMPLEMENTED") return null;
  const doc = parseXml(meta);
  const title = textOf(doc, "title");
  const artist = textOf(doc, "creator") || textOf(doc, "albumArtist");
  const stream = textOf(doc, "streamContent");
  if (title && /^x-sonos|^x-rincon/i.test(title)) return stream ? { title: stream } : null;
  return title || stream ? { title: stream || title, artist: stream ? null : artist } : null;
}

async function readState(base) {
  const [vol, mute, transport, pos] = await Promise.all([
    rc(base, "GetVolume", { Channel: "Master" }).catch(() => null),
    rc(base, "GetMute", { Channel: "Master" }).catch(() => null),
    avt(base, "GetTransportInfo").catch(() => null),
    avt(base, "GetPositionInfo").catch(() => null),
  ]);
  const playing = transport?.CurrentTransportState;
  const track = parseTrack(pos?.TrackMetaData);
  return {
    volume: vol ? Number(vol.CurrentVolume) : null,
    muted: mute ? mute.CurrentMute === "1" : null,
    playback: playing ? { PLAYING: "playing", PAUSED_PLAYBACK: "paused", STOPPED: "stopped", TRANSITIONING: "loading" }[playing] || playing.toLowerCase() : null,
    track: track ? [track.title, track.artist].filter(Boolean).join(" — ") : null,
  };
}

export default {
  id: "sonos",
  label: "Sonos",

  async detect(host) {
    const ssdp = host.ssdp.find((r) => /sonos/i.test(`${r.server} ${r.desc?.manufacturer}`) || /ZonePlayer/i.test(r.desc?.deviceType || r.st || ""));
    const hinted = ssdp || host.mdns.some((s) => s.type === "_sonos._tcp") || host.vendor === "Sonos" || host.ports.has(1400);
    if (!hinted) return null;
    const desc = ssdp?.desc || (await fetchDescription(`http://${host.ip}:1400/xml/device_description.xml`, { timeout: 2500 }));
    if (!desc || !/sonos/i.test(desc.manufacturer || "")) return null;
    const base = `http://${host.ip}:1400`;
    const uuid = (desc.udn || "").replace(/^uuid:/, "");
    const state = await readState(base).catch(() => ({}));
    return [
      {
        id: `sonos:${uuid.toLowerCase() || host.ip}`,
        driver: "sonos",
        kind: "speaker",
        brand: "Sonos",
        model: desc.modelName ? desc.modelName.replace(/^Sonos\s+/i, "Sonos ") : desc.displayName,
        name: desc.roomName || desc.friendlyName || "Sonos speaker",
        room: desc.roomName || null,
        ip: host.ip,
        ref: { base, uuid },
        state,
        info: { firmware: desc.softwareVersion || null, serial: desc.serialNumber || null },
        actions: ["play", "pause", "stop", "next", "previous", "set_volume", "volume_up", "volume_down", "mute", "unmute", "set_room"],
      },
    ];
  },

  async refresh(device) {
    return { state: await readState(device.ref.base) };
  },

  async act(device, action, value) {
    const { base, uuid } = device.ref;
    try {
      switch (action) {
        case "set_volume": {
          const v = parsePercent(need(value, "volume"), device.state?.volume);
          if (v == null) throw new DeviceError(`I didn't catch the volume "${value}".`);
          await rc(base, "SetVolume", { Channel: "Master", DesiredVolume: v });
          return done(`${device.name} volume is ${v}.`, { state: { ...device.state, volume: v } });
        }
        case "volume_up":
        case "volume_down": {
          const cur = Number((await rc(base, "GetVolume", { Channel: "Master" })).CurrentVolume);
          const step = Math.min(Math.max(Number(value) || 8, 1), 50);
          const v = clamp(cur + (action === "volume_up" ? step : -step), 0, 100);
          await rc(base, "SetVolume", { Channel: "Master", DesiredVolume: v });
          return done(`${device.name} volume is ${v}.`, { state: { ...device.state, volume: v } });
        }
        case "mute":
        case "unmute":
          await rc(base, "SetMute", { Channel: "Master", DesiredMute: action === "mute" ? 1 : 0 });
          return done(action === "mute" ? `${device.name} is muted.` : `${device.name} is unmuted.`, { state: { ...device.state, muted: action === "mute" } });
        case "play":
        case "pause":
        case "stop":
        case "next":
        case "previous": {
          const cbase = await coordinatorBase(base, uuid);
          const name = { play: "Play", pause: "Pause", stop: "Stop", next: "Next", previous: "Previous" }[action];
          await avt(cbase, name, action === "play" ? { Speed: 1 } : {});
          const playback = action === "play" ? "playing" : action === "pause" ? "paused" : action === "stop" ? "stopped" : device.state?.playback;
          return done(
            { play: `Playing on ${device.name}.`, pause: `Paused ${device.name}.`, stop: `Stopped ${device.name}.`, next: "Skipped ahead.", previous: "Went back a track." }[action],
            { state: { ...device.state, playback } },
          );
        }
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      if (err instanceof UpnpError && (err.code === 701 || err.code === 711)) {
        throw new DeviceError(`There's nothing queued on ${device.name} to ${action}. Start something in the Sonos app first.`, { code: "ENOTHING" });
      }
      throw explainError(err, device.name);
    }
  },
};
