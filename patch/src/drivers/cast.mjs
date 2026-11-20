// Google Cast devices (Chromecast, Google/Nest speakers and displays, Android/Google TVs, Cast groups).
// Cast v2 protocol: length-prefixed protobuf CastMessage frames over TLS on port 8009, carrying JSON.
import tls from "node:tls";
import { clamp, parsePercent } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";

const NS = {
  connection: "urn:x-cast:com.google.cast.tp.connection",
  heartbeat: "urn:x-cast:com.google.cast.tp.heartbeat",
  receiver: "urn:x-cast:com.google.cast.receiver",
  media: "urn:x-cast:com.google.cast.media",
};

function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
}

function str(fieldNo, s) {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([Buffer.from([(fieldNo << 3) | 2]), varint(b.length), b]);
}

/** CastMessage { protocol_version=0, source_id, destination_id, namespace, payload_type=STRING, payload_utf8 } */
export function encodeCastMessage({ source = "sender-0", destination = "receiver-0", namespace, data }) {
  const msg = Buffer.concat([
    Buffer.from([0x08, 0x00]),
    str(2, source),
    str(3, destination),
    str(4, namespace),
    Buffer.from([0x28, 0x00]),
    str(6, typeof data === "string" ? data : JSON.stringify(data)),
  ]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(msg.length);
  return Buffer.concat([head, msg]);
}

export function decodeCastMessage(buf) {
  const out = {};
  let o = 0;
  const readVarint = () => {
    let n = 0;
    let shift = 0;
    for (;;) {
      const b = buf[o++];
      n |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return n >>> 0;
      shift += 7;
    }
  };
  while (o < buf.length) {
    const key = readVarint();
    const field = key >> 3;
    const wire = key & 7;
    if (wire === 0) {
      const v = readVarint();
      if (field === 1) out.protocolVersion = v;
      if (field === 5) out.payloadType = v;
    } else if (wire === 2) {
      const len = readVarint();
      const v = buf.subarray(o, o + len);
      o += len;
      if (field === 2) out.source = v.toString("utf8");
      else if (field === 3) out.destination = v.toString("utf8");
      else if (field === 4) out.namespace = v.toString("utf8");
      else if (field === 6) out.data = v.toString("utf8");
    } else break; // other wire types aren't used by CastMessage
  }
  return out;
}

export class CastClient {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.waiters = [];
    this.requestId = Math.floor(Math.random() * 1000) + 1;
    socket.on("data", (d) => this.onData(d));
  }

  static connect(host, port = 8009, timeout = 4000) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, rejectUnauthorized: false, timeout }, () => {
        socket.setTimeout(0);
        const c = new CastClient(socket);
        c.send(NS.connection, { type: "CONNECT" });
        resolve(c);
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
      });
      socket.once("error", reject);
    });
  }

  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32BE(0);
      if (this.buf.length < 4 + len) break;
      const msg = decodeCastMessage(this.buf.subarray(4, 4 + len));
      this.buf = this.buf.subarray(4 + len);
      let payload = null;
      try {
        payload = JSON.parse(msg.data || "null");
      } catch {
        /* binary payloads aren't used here */
      }
      if (msg.namespace === NS.heartbeat && payload?.type === "PING") {
        this.send(NS.heartbeat, { type: "PONG" }, msg.source);
        continue;
      }
      for (const w of [...this.waiters]) {
        if (w.match(msg, payload)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          clearTimeout(w.timer);
          w.resolve(payload);
        }
      }
    }
  }

  send(namespace, data, destination = "receiver-0") {
    this.socket.write(encodeCastMessage({ namespace, data, destination }));
  }

  request(namespace, data, destination = "receiver-0", timeout = 4000) {
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const w = {
        match: (msg, p) => msg.namespace === namespace && p?.requestId === requestId,
        resolve,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          reject(Object.assign(new Error("The Cast device didn't answer."), { code: "ETIMEDOUT" }));
        }, timeout),
      };
      this.waiters.push(w);
      this.send(namespace, { ...data, requestId }, destination);
    });
  }

  close() {
    try {
      this.send(NS.connection, { type: "CLOSE" });
    } catch {
      /* socket gone */
    }
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 200);
  }
}

async function withClient(ref, fn) {
  const c = await CastClient.connect(ref.ip, ref.port || 8009);
  try {
    return await fn(c);
  } finally {
    c.close();
  }
}

const receiverStatus = async (c) => (await c.request(NS.receiver, { type: "GET_STATUS" }))?.status || {};

function stateFrom(status, media) {
  const app = status.applications?.find((a) => !a.isIdleScreen) || null;
  const st = {
    volume: typeof status.volume?.level === "number" ? Math.round(status.volume.level * 100) : null,
    muted: status.volume?.muted ?? null,
    app: app?.displayName || null,
    activity: app?.statusText || null,
  };
  if (media) {
    st.playback = { PLAYING: "playing", PAUSED: "paused", BUFFERING: "loading", IDLE: "stopped" }[media.playerState] || null;
    const md = media.media?.metadata;
    st.track = md ? [md.title, md.artist || md.subtitle].filter(Boolean).join(" — ") || null : null;
  }
  return st;
}

async function mediaSession(c, status) {
  const app = status.applications?.find((a) => a.namespaces?.some((n) => n.name === NS.media));
  if (!app) return null;
  c.send(NS.connection, { type: "CONNECT" }, app.transportId);
  const ms = await c.request(NS.media, { type: "GET_STATUS" }, app.transportId).catch(() => null);
  const media = ms?.status?.[0];
  return media ? { app, media } : { app, media: null };
}

function kindOf(txt) {
  const ca = Number(txt.ca) || 0;
  const md = String(txt.md || "");
  if (ca & 32 || /cast group/i.test(md)) return "group";
  if (/nest hub|home hub|display/i.test(md)) return "display";
  if (ca & 1 || /chromecast|tv|streamer|shield|bravia/i.test(md)) return /chromecast|streamer|shield/i.test(md) ? "streamer" : "tv";
  return "speaker";
}

export default {
  id: "cast",
  label: "Google Cast",

  async detect(host) {
    const svcs = host.mdns.filter((s) => s.type === "_googlecast._tcp" && s.txt?.id);
    if (!svcs.length) return null;
    // A speaker that leads a Cast group also advertises the group (different port, same address).
    svcs.sort((a, b) => (kindOf(a.txt) === "group") - (kindOf(b.txt) === "group"));
    const devices = [];
    for (const s of svcs) {
      const kind = kindOf(s.txt);
      const ref = { ip: host.ip, port: s.port || 8009 };
      let state = { app: s.txt.rs || null };
      if (kind !== "group") {
        state = await withClient(ref, async (c) => stateFrom(await receiverStatus(c))).catch(() => state);
      }
      const md = s.txt.md || "Cast device";
      devices.push({
        id: `cast:${String(s.txt.id).toLowerCase()}`,
        driver: "cast",
        kind,
        brand: /google|nest|chromecast/i.test(md) ? "Google" : "Google Cast",
        model: md,
        name: s.txt.fn || s.name || md,
        ip: host.ip,
        ref,
        extra: kind === "group",
        state,
        info: { castVersion: s.txt.ve || null },
        actions: ["set_volume", "volume_up", "volume_down", "mute", "unmute", "play", "pause", "stop", "rename", "set_room"],
      });
    }
    return devices;
  },

  async refresh(device) {
    return withClient(device.ref, async (c) => {
      const status = await receiverStatus(c);
      const m = await mediaSession(c, status).catch(() => null);
      return { state: stateFrom(status, m?.media) };
    });
  },

  async act(device, action, value) {
    try {
      return await withClient(device.ref, async (c) => {
        const status = await receiverStatus(c);
        const setVol = async (volume) => {
          if (status.volume?.controlType === "fixed") throw new DeviceError(`${device.name} has fixed volume; change it on the TV or speaker it's plugged into.`);
          const r = await c.request(NS.receiver, { type: "SET_VOLUME", volume });
          return stateFrom(r?.status || status);
        };
        switch (action) {
          case "set_volume": {
            const v = parsePercent(need(value, "volume"), device.state?.volume);
            if (v == null) throw new DeviceError(`I didn't catch the volume "${value}".`);
            return done(`${device.name} volume is ${v}%.`, { state: { ...device.state, ...(await setVol({ level: v / 100 })) } });
          }
          case "volume_up":
          case "volume_down": {
            const cur = Math.round((status.volume?.level ?? 0.3) * 100);
            const step = Math.min(Math.max(Number(value) || 10, 1), 50);
            const v = clamp(cur + (action === "volume_up" ? step : -step), 0, 100);
            return done(`${device.name} volume is ${v}%.`, { state: { ...device.state, ...(await setVol({ level: v / 100 })) } });
          }
          case "mute":
          case "unmute":
            return done(action === "mute" ? `${device.name} is muted.` : `${device.name} is unmuted.`, { state: { ...device.state, ...(await setVol({ muted: action === "mute" })) } });
          case "stop": {
            const app = status.applications?.find((a) => !a.isIdleScreen);
            if (!app) return done(`Nothing is casting to ${device.name}.`);
            await c.request(NS.receiver, { type: "STOP", sessionId: app.sessionId });
            return done(`Stopped ${app.displayName || "casting"} on ${device.name}.`, { state: { ...device.state, app: null, playback: "stopped" } });
          }
          case "play":
          case "pause": {
            const m = await mediaSession(c, status);
            if (!m) throw new DeviceError(`Nothing is playing on ${device.name}.`, { code: "ENOTHING" });
            if (!m.media) throw new DeviceError(`${m.app.displayName || "The app"} on ${device.name} doesn't accept play and pause from other devices.`, { code: "ENOTHING" });
            await c.request(NS.media, { type: action === "play" ? "PLAY" : "PAUSE", mediaSessionId: m.media.mediaSessionId }, m.app.transportId);
            return done(action === "play" ? `Playing on ${device.name}.` : `Paused ${device.name}.`, { state: { ...device.state, playback: action === "play" ? "playing" : "paused" } });
          }
          default:
            throw unsupported(device, action);
        }
      });
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
