// Simulated devices that speak raw TCP/UDP/TLS protocols: Kasa, LIFX, Yeelight, Chromecast,
// NetBIOS name service, an IPP printer and plain open ports.
import net from "node:net";
import dgram from "node:dgram";
import tls from "node:tls";
import { encrypt, decrypt } from "../src/drivers/kasa.mjs";
import { encode as lifxEncode, decode as lifxDecode, MSG } from "../src/drivers/lifx.mjs";
import { encodeCastMessage, decodeCastMessage } from "../src/drivers/cast.mjs";
import { selfSigned } from "./selfsigned.mjs";
import { httpServer } from "./http-devices.mjs";

const udp = (ip, port, onMessage) =>
  new Promise((resolve, reject) => {
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
    s.once("error", reject);
    s.on("message", (m, r) => onMessage(m, r, s));
    s.bind(port, ip, () => resolve(s));
  });

const tcp = (ip, port, onConnection) =>
  new Promise((resolve, reject) => {
    const s = net.createServer(onConnection || ((c) => c.end()));
    s.once("error", reject);
    s.listen(port, ip, () => resolve(s));
  });

// ── TP-Link Kasa KP115 (plug with energy monitoring) ──────

export function kasaState() {
  return { alias: "Space Heater", on: false, led_off: 0, reboots: 0 };
}

export async function kasaDevice(ip, s) {
  const sysinfo = () => ({
    sw_ver: "1.0.21 Build 231129 Rel.171238", hw_ver: "1.0", model: "KP115(US)", deviceId: "8006A8C7F1E2D3C4B5A6978812345678ABCDEF01",
    oemId: "6E4B4B0A2A4F8C1E22F0C6E0E1A2B3C4", hwId: "A28C8BB92AFCB6CAFB83A8C00145F7E2", rssi: -55, latitude_i: 0, longitude_i: 0,
    alias: s.alias, status: "new", obd_src: "tplink", mic_type: "IOT.SMARTPLUGSWITCH", feature: "TIM:ENE", mac: "50:C7:BF:12:34:56",
    updating: 0, led_off: s.led_off, relay_state: s.on ? 1 : 0, on_time: s.on ? 3600 : 0, icon_hash: "", dev_name: "Smart Wi-Fi Plug Mini", active_mode: "none", next_action: { type: -1 }, ntc_state: 0, err_code: 0,
  });
  const handle = (req) => {
    const out = {};
    if (req.system?.get_sysinfo !== undefined) out.system = { get_sysinfo: sysinfo() };
    if (req.system?.set_relay_state) {
      s.on = req.system.set_relay_state.state === 1;
      out.system = { set_relay_state: { err_code: 0 } };
    }
    if (req.system?.set_led_off) {
      s.led_off = req.system.set_led_off.off;
      out.system = { set_led_off: { err_code: 0 } };
    }
    if (req.system?.reboot) {
      s.reboots++;
      out.system = { reboot: { err_code: 0 } };
    }
    if (req.system?.set_dev_alias) {
      s.alias = req.system.set_dev_alias.alias;
      out.system = { set_dev_alias: { err_code: 0 } };
    }
    if (req.emeter?.get_realtime) out.emeter = { get_realtime: { current_ma: s.on ? 12083 : 0, voltage_mv: 120411, power_mw: s.on ? 1452300 : 0, total_wh: 48211, err_code: 0 } };
    return out;
  };
  const t = await tcp(ip, 9999, (c) => {
    let buf = Buffer.alloc(0);
    c.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length < 4 || buf.length < 4 + buf.readUInt32BE(0)) return;
      const req = JSON.parse(decrypt(buf.subarray(4, 4 + buf.readUInt32BE(0))));
      const payload = encrypt(JSON.stringify(handle(req)));
      const head = Buffer.alloc(4);
      head.writeUInt32BE(payload.length);
      c.end(Buffer.concat([head, payload]));
    });
  });
  const u = await udp(ip, 9999, (m, r, sock) => {
    try {
      const req = JSON.parse(decrypt(m));
      sock.send(encrypt(JSON.stringify(handle(req))), r.port, r.address);
    } catch {
      /* ignore */
    }
  });
  return [t, u];
}

// ── LIFX bulb ─────────────────────────────────────────────

export function lifxState() {
  return { mac: "d0:73:d5:2a:bb:01", label: "Bedroom Lamp", power: 65535, hue: 7000, saturation: 0, brightness: 45000, kelvin: 2700, waveforms: 0 };
}

export async function lifxDevice(ip, s) {
  const statePayload = () => {
    const p = Buffer.alloc(52);
    p.writeUInt16LE(s.hue, 0);
    p.writeUInt16LE(s.saturation, 2);
    p.writeUInt16LE(s.brightness, 4);
    p.writeUInt16LE(s.kelvin, 6);
    p.writeUInt16LE(s.power, 10);
    Buffer.from(s.label, "utf8").subarray(0, 32).copy(p, 12);
    return p;
  };
  return [
    await udp(ip, 56700, (msg, r, sock) => {
      const m = lifxDecode(msg);
      if (!m) return;
      const reply = (type, payload = Buffer.alloc(0)) => sock.send(lifxEncode({ type, payload, target: s.mac, source: m.source, sequence: m.sequence }), r.port, r.address);
      const ack = () => msg[22] & 2 && reply(MSG.Acknowledgement);
      switch (m.type) {
        case MSG.GetService: {
          const p = Buffer.alloc(5);
          p[0] = 1;
          p.writeUInt32LE(56700, 1);
          return reply(MSG.StateService, p);
        }
        case MSG.Get:
          return reply(MSG.State, statePayload());
        case MSG.SetPower: {
          s.power = m.payload.readUInt16LE(0);
          ack();
          const p = Buffer.alloc(2);
          p.writeUInt16LE(s.power);
          return msg[22] & 1 ? reply(MSG.StatePower, p) : undefined;
        }
        case MSG.SetColor:
          s.hue = m.payload.readUInt16LE(1);
          s.saturation = m.payload.readUInt16LE(3);
          s.brightness = m.payload.readUInt16LE(5);
          s.kelvin = m.payload.readUInt16LE(7);
          ack();
          return msg[22] & 1 ? reply(MSG.State, statePayload()) : undefined;
        case MSG.SetLabel:
          s.label = m.payload.subarray(0, 32).toString("utf8").replace(/\0.*$/s, "");
          ack();
          return msg[22] & 1 ? reply(MSG.StateLabel, m.payload.subarray(0, 32)) : undefined;
        case MSG.SetWaveform:
          s.waveforms++;
          return ack();
        default:
          return undefined;
      }
    }),
  ];
}

// ── Yeelight ──────────────────────────────────────────────

export function yeelightState() {
  return { id: "0x0000000015243f01", name: "Nursery Light", power: "on", bright: 30, ct: 2700, rgb: 16750848, color_mode: 2 };
}

export async function yeelightDevice(ip, s) {
  const u = await udp(ip, 1982, (msg, r, sock) => {
    if (!/M-SEARCH/.test(msg.toString()) || !/wifi_bulb/.test(msg.toString())) return;
    const lines = ["HTTP/1.1 200 OK", "Cache-Control: max-age=3600", "Date: ", "Ext: ", `Location: yeelight://${ip}:55443`, "Server: POSIX UPnP/1.0 YGLC/1", `id: ${s.id}`, "model: color", "fw_ver: 65", "support: get_prop set_default set_power toggle set_bright start_cf stop_cf set_scene cron_add cron_get cron_del set_ct_abx set_rgb set_hsv set_adjust adjust_bright adjust_ct adjust_color set_music set_name", `power: ${s.power}`, `bright: ${s.bright}`, `color_mode: ${s.color_mode}`, `ct: ${s.ct}`, `rgb: ${s.rgb}`, "hue: 36", "sat: 100", `name: ${s.name}`, "", ""];
    sock.send(Buffer.from(lines.join("\r\n")), r.port, r.address);
  });
  const t = await tcp(ip, 55443, (c) => {
    let buf = "";
    c.on("data", (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        let cmd;
        try {
          cmd = JSON.parse(line);
        } catch {
          continue;
        }
        const ok = () => c.write(JSON.stringify({ id: cmd.id, result: ["ok"] }) + "\r\n");
        const p = cmd.params || [];
        switch (cmd.method) {
          case "get_prop":
            c.write(JSON.stringify({ id: cmd.id, result: p.map((k) => String(s[k] ?? "")) }) + "\r\n");
            break;
          case "set_power":
            s.power = p[0];
            c.write(JSON.stringify({ method: "props", params: { power: s.power } }) + "\r\n");
            ok();
            break;
          case "toggle":
            s.power = s.power === "on" ? "off" : "on";
            ok();
            break;
          case "set_bright":
            s.bright = p[0];
            ok();
            break;
          case "set_rgb":
            s.rgb = p[0];
            s.color_mode = 1;
            ok();
            break;
          case "set_ct_abx":
            s.ct = p[0];
            s.color_mode = 2;
            ok();
            break;
          case "set_name":
            s.name = p[0];
            ok();
            break;
          default:
            c.write(JSON.stringify({ id: cmd.id, error: { code: -1, message: "method not supported" } }) + "\r\n");
        }
      }
    });
  });
  return [u, t];
}

// ── Chromecast (Google TV Streamer) ───────────────────────

export function castState() {
  return { id: "5c0a7e2bd1f84e5a9c3b2a1d0e9f8a7b", name: "Bedroom TV", volume: 0.35, muted: false, app: "YouTube", playerState: "PLAYING", title: "Lo-fi beats to relax to", stops: 0 };
}

export async function castDevice(ip, s) {
  const { cert, key } = selfSigned("Chromecast");
  const server = tls.createServer({ cert, key }, (sock) => {
    let buf = Buffer.alloc(0);
    const send = (namespace, data, destination, source = "receiver-0") => {
      const frame = encodeCastMessage({ source, destination, namespace, data });
      sock.write(frame);
    };
    const receiverStatus = (requestId) => ({
      type: "RECEIVER_STATUS",
      requestId,
      status: {
        applications: s.app
          ? [{ appId: "233637DE", displayName: s.app, iconUrl: "", isIdleScreen: false, launchedFromCloud: false, namespaces: [{ name: "urn:x-cast:com.google.cast.media" }, { name: "urn:x-cast:com.google.youtube.mdx" }], sessionId: "7f8e9d0c-1111-2222-3333-444455556666", statusText: `YouTube: ${s.title}`, transportId: "web-5" }]
          : [{ appId: "E8C28D3C", displayName: "Backdrop", isIdleScreen: true, namespaces: [], sessionId: "idle", statusText: "", transportId: "web-0" }],
        isActiveInput: true,
        isStandBy: false,
        userEq: {},
        volume: { controlType: "attenuation", level: s.volume, muted: s.muted, stepInterval: 0.05 },
      },
    });
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
        const msg = decodeCastMessage(buf.subarray(4, 4 + buf.readUInt32BE(0)));
        buf = buf.subarray(4 + buf.readUInt32BE(0));
        const p = JSON.parse(msg.data || "{}");
        const reply = (data) => send(msg.namespace, data, msg.source, msg.destination);
        if (msg.namespace.endsWith("tp.heartbeat") && p.type === "PING") reply({ type: "PONG" });
        if (msg.namespace.endsWith(".receiver")) {
          if (p.type === "SET_VOLUME") {
            if (typeof p.volume?.level === "number") s.volume = p.volume.level;
            if (typeof p.volume?.muted === "boolean") s.muted = p.volume.muted;
          }
          if (p.type === "STOP") {
            s.app = null;
            s.stops++;
          }
          reply(receiverStatus(p.requestId));
        }
        if (msg.namespace.endsWith(".media")) {
          if (!s.app) {
            reply({ type: "MEDIA_STATUS", requestId: p.requestId, status: [] });
            continue;
          }
          if (p.type === "PAUSE") s.playerState = "PAUSED";
          if (p.type === "PLAY") s.playerState = "PLAYING";
          reply({ type: "MEDIA_STATUS", requestId: p.requestId, status: [{ mediaSessionId: 1, playbackRate: 1, playerState: s.playerState, currentTime: 312.4, supportedMediaCommands: 274447, volume: { level: 1, muted: false }, media: { contentId: "jfKfPfyJRdk", streamType: "BUFFERED", contentType: "x-youtube/video", metadata: { metadataType: 0, title: s.title, subtitle: "Lofi Girl" } } }] });
        }
      }
    });
    sock.on("error", () => {});
  });
  await new Promise((r) => server.listen(8009, ip, r));
  return [server];
}

// ── NetBIOS (Windows PC) ──────────────────────────────────

export async function netbiosResponder(ip, name, mac) {
  return udp(ip, 137, (msg, r, sock) => {
    if (msg.length < 50 || msg.readUInt16BE(msg.length - 4) !== 0x21) return;
    const head = Buffer.from([msg[0], msg[1], 0x84, 0x00, 0, 0, 0, 1, 0, 0, 0, 0]);
    const qname = msg.subarray(12, 12 + 34);
    const entry = (n, suffix, group) => {
      const b = Buffer.alloc(18, 0x20);
      b.write(n.slice(0, 15), 0, "latin1");
      b[15] = suffix;
      b.writeUInt16BE(group ? 0x8400 : 0x0400, 16);
      return b;
    };
    const names = [entry(name, 0x00, false), entry("WORKGROUP", 0x00, true), entry(name, 0x20, false)];
    const macBuf = Buffer.from(mac.split(":").map((h) => parseInt(h, 16)));
    const rdata = Buffer.concat([Buffer.from([names.length]), ...names, macBuf, Buffer.alloc(40)]);
    const meta = Buffer.alloc(10);
    meta.writeUInt16BE(0x21, 0);
    meta.writeUInt16BE(1, 2);
    meta.writeUInt32BE(0, 4);
    meta.writeUInt16BE(rdata.length, 8);
    sock.send(Buffer.concat([head, qname, meta, rdata]), r.port, r.address);
  });
}

// ── Printer (IPP Everywhere) ──────────────────────────────

export function printerState() {
  return { name: "Brother HL-L3270CDW", identified: 0, black: 8, cyan: 64, magenta: 55, yellow: 72 };
}

function ippAttr(tag, name, values) {
  return Buffer.concat(
    values.map((v, i) => {
      const n = Buffer.from(i ? "" : name);
      let val;
      if (tag === 0x21 || tag === 0x23) {
        val = Buffer.alloc(4);
        val.writeInt32BE(v);
      } else if (tag === 0x22) val = Buffer.from([v ? 1 : 0]);
      else val = Buffer.from(String(v));
      const h = Buffer.alloc(3);
      h[0] = tag;
      h.writeUInt16BE(n.length, 1);
      const l = Buffer.alloc(2);
      l.writeUInt16BE(val.length);
      return Buffer.concat([h, n, l, val]);
    }),
  );
}

export async function printerDevice(ip, s) {
  const ipp = await httpServer(ip, 631, async ({ req, raw, send }) => {
    if (req.method !== "POST") return send(200, "<html><title>CUPS-like IPP</title></html>");
    const op = raw.readUInt16BE(2);
    const reqId = raw.readUInt32BE(4);
    const head = Buffer.alloc(8);
    head[0] = 2;
    head[1] = 0;
    head.writeUInt32BE(reqId, 4);
    const opAttrs = Buffer.concat([Buffer.from([0x01]), ippAttr(0x47, "attributes-charset", ["utf-8"]), ippAttr(0x48, "attributes-natural-language", ["en"])]);
    if (op === 0x003c) {
      s.identified++;
      head.writeUInt16BE(0x0000, 2);
      return send(200, Buffer.concat([head, opAttrs, Buffer.from([0x03])]), "application/ipp");
    }
    if (op !== 0x000b) {
      head.writeUInt16BE(0x0501, 2); // operation not supported
      return send(200, Buffer.concat([head, opAttrs, Buffer.from([0x03])]), "application/ipp");
    }
    head.writeUInt16BE(0x0000, 2);
    const low = [s.black, s.cyan, s.magenta, s.yellow].some((x) => x <= 10);
    const printer = Buffer.concat([
      Buffer.from([0x04]),
      ippAttr(0x42, "printer-name", ["Brother_HL_L3270CDW_series"]),
      ippAttr(0x41, "printer-info", [s.name]),
      ippAttr(0x41, "printer-location", ["Study"]),
      ippAttr(0x41, "printer-make-and-model", ["Brother HL-L3270CDW series"]),
      ippAttr(0x23, "printer-state", [3]),
      ippAttr(0x44, "printer-state-reasons", low ? ["toner-low-warning"] : ["none"]),
      ippAttr(0x22, "printer-is-accepting-jobs", [true]),
      ippAttr(0x45, "printer-uuid", ["urn:uuid:e3248000-80ce-11db-8000-30055c1a2b3c"]),
      ippAttr(0x41, "printer-firmware-string-version", ["ZC"]),
      ippAttr(0x45, "printer-more-info", [`http://${ip}/`]),
      ippAttr(0x42, "marker-names", ["Black Toner", "Cyan Toner", "Magenta Toner", "Yellow Toner"]),
      ippAttr(0x21, "marker-levels", [s.black, s.cyan, s.magenta, s.yellow]),
      ippAttr(0x21, "marker-low-levels", [10, 10, 10, 10]),
      ippAttr(0x21, "marker-high-levels", [100, 100, 100, 100]),
      ippAttr(0x42, "marker-colors", ["#000000", "#00FFFF", "#FF00FF", "#FFFF00"]),
      ippAttr(0x44, "marker-types", ["toner", "toner", "toner", "toner"]),
      ippAttr(0x44, "identify-actions-supported", ["flash", "sound"]),
    ]);
    return send(200, Buffer.concat([head, opAttrs, printer, Buffer.from([0x03])]), "application/ipp");
  });
  const web = await httpServer(ip, 80, async ({ send }) => send(200, "<html><head><title>Brother HL-L3270CDW series</title></head><body>Status: Ready</body></html>"));
  return [ipp, web];
}

// ── Plain hosts (PC, iPad, camera, Raspberry Pi) ──────────

export async function openPorts(ip, ports, http80Title) {
  const servers = [];
  for (const p of ports) {
    if (p === 80 && http80Title) servers.push(await httpServer(ip, 80, async ({ send }) => send(200, `<html><head><title>${http80Title}</title></head><body>Please log in</body></html>`)));
    else servers.push(await tcp(ip, p));
  }
  return servers;
}
