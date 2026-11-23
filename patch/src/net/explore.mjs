// Looking closer at one device, and talking to it: for anything on the home network, above all the
// devices Patch has no driver for. Patch knocks on its ports, reads what answers on each (a web page's
// title and server, a TLS certificate, an SSH, FTP or Telnet greeting, camera video over RTSP, an MQTT
// broker), asks the device itself for its announcements (mDNS, UPnP, SNMP, its Windows name), and
// works out what it probably is, saying why. Then the assistant can read the device's web pages and
// built-in APIs, and send a message to one of its ports.
//
// Everything a device sends back is content to read, never instructions.
import dgram from "node:dgram";
import net from "node:net";
import tls from "node:tls";
import { request } from "./lanhttp.mjs";
import { browse, reverseLookup } from "./mdns.mjs";
import { fetchDescription, search as ssdpSearch } from "./ssdp.mjs";
import { nbstatSweep } from "./probe.mjs";
import { openPorts, openPortsIn } from "./knock.mjs";

/** Ports home devices commonly listen on, and what each usually is. */
export const PORT_NAMES = {
  21: "FTP", 22: "SSH", 23: "Telnet", 25: "email (SMTP)", 53: "DNS", 80: "web page", 81: "web page", 88: "web page",
  111: "RPC", 135: "Windows RPC", 139: "Windows file sharing", 143: "email (IMAP)", 443: "secure web page", 445: "Windows file sharing",
  515: "printing (LPD)", 548: "Apple file sharing", 554: "camera video (RTSP)", 631: "printing (IPP)", 873: "rsync backups",
  1400: "Sonos", 1883: "MQTT (smart-home messages)", 1925: "Philips TV API", 1926: "Philips TV API", 2020: "web page",
  3000: "web app", 3001: "web app", 3260: "iSCSI storage", 3306: "MySQL database", 3389: "Windows Remote Desktop",
  4070: "Spotify Connect", 4443: "secure web page", 5000: "web page or UPnP", 5001: "secure web page", 5060: "phone calls (SIP)",
  5357: "Windows device discovery", 5432: "PostgreSQL database", 5555: "Android debugging (ADB)", 5900: "screen sharing (VNC)",
  6466: "Android TV remote", 6467: "Android TV pairing", 6668: "Tuya smart device", 7000: "AirPlay", 7100: "AirPlay screen",
  7547: "the internet provider's remote management (TR-069)", 8000: "web page", 8001: "Samsung TV API", 8002: "Samsung TV API",
  8008: "Google Cast", 8009: "Google Cast", 8060: "Roku remote API", 8080: "web page", 8081: "web page", 8088: "web page",
  8089: "web page", 8090: "web page", 8123: "Home Assistant", 8291: "MikroTik router", 8443: "secure web page",
  8554: "camera video (RTSP)", 8883: "MQTT (secure)", 8888: "web page", 9000: "web page", 9080: "web page", 9090: "web page",
  9100: "printing (raw)", 9123: "Elgato light API", 9197: "TV remote API", 9295: "PlayStation Remote Play", 9999: "TP-Link Kasa",
  10001: "Ubiquiti", 32400: "Plex media server", 34567: "video recorder (DVR)", 37777: "Dahua camera or recorder",
  49152: "UPnP", 49153: "UPnP", 49154: "UPnP", 49155: "UPnP", 50001: "web app", 55443: "Yeelight light", 62078: "iPhone or iPad sync",
};
export const COMMON_PORTS = Object.keys(PORT_NAMES).map(Number);
const SECURE_FIRST = new Set([443, 1926, 4443, 5001, 8002, 8443, 8883]);
/** Ports that never speak HTTP: after listening, Patch asks nothing more (a receiver's control port takes any line as a command). */
const NOT_WEB = new Set([21, 22, 23, 25, 110, 135, 139, 143, 445, 548, 1883, 3306, 3389, 5432, 5900, 6668, 9999, 55443]);
/** Printers print whatever arrives on these: Patch only listens there, never sends. */
export const PRINTS_ANYTHING = new Set([9100, 9101, 9102, 515]);

const printable = (buf, max = 400) =>
  buf
    .subarray(0, max * 2)
    .toString("latin1")
    .replace(/\xff[\xfb-\xfe]./gs, "") // Telnet option talk
    .replace(/[^\x20-\x7e\n\t]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);

/**
 * One exchange with a port: connect (TLS if secure), send what's given, and collect what comes back
 * until it goes quiet for `quiet` ms, closes, or reaches `max` bytes; at most `wait` ms once connected.
 * Gives { connected, data, cert, error }.
 */
export function exchange(ip, port, { send = null, secure = false, wait = 3000, quiet = 700, first = 1200, max = 64 * 1024, connectTimeout = 2500 } = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    let connected = false;
    let cert = null;
    let quietTimer = null;
    let allTimer = null;
    const s = secure ? tls.connect({ host: ip, port, rejectUnauthorized: false, ALPNProtocols: ["http/1.1"] }) : net.connect({ host: ip, port });
    const end = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(quietTimer);
      clearTimeout(allTimer);
      clearTimeout(connectTimer);
      s.destroy();
      resolve({ connected, data: Buffer.concat(chunks), cert, error: error ? error.code || error.message : null });
    };
    const connectTimer = setTimeout(() => !connected && end({ code: "ETIMEDOUT" }), connectTimeout);
    s.once(secure ? "secureConnect" : "connect", () => {
      connected = true;
      clearTimeout(connectTimer);
      if (secure) cert = certSummary(s.getPeerCertificate());
      if (send != null) s.write(send);
      allTimer = setTimeout(() => end(), wait);
      quietTimer = setTimeout(() => end(), first); // nothing at all for this long: it has nothing to say
    });
    s.on("data", (b) => {
      chunks.push(b);
      size += b.length;
      if (size >= max) return end();
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => end(), quiet);
    });
    s.once("error", (e) => end(e));
    s.once("close", () => end());
  });
}

function certSummary(c) {
  if (!c || !c.subject) return null;
  const name = (x) => [x?.CN, x?.O, x?.OU].flat().filter(Boolean).join(", ") || null;
  return { subject: name(c.subject), issuer: name(c.issuer), names: c.subjectaltname ? c.subjectaltname.replace(/DNS:|IP Address:/g, "").split(/,\s*/).slice(0, 6) : [], selfSigned: name(c.subject) === name(c.issuer) };
}

/** An HTTP response's head and body from raw bytes. */
function parseHttp(buf) {
  const split = buf.indexOf("\r\n\r\n");
  const head = buf.subarray(0, split < 0 ? buf.length : split).toString("latin1");
  const m = head.match(/^(HTTP|RTSP)\/\d(?:\.\d)? (\d{3})/);
  if (!m) return null;
  const headers = {};
  for (const line of head.split("\r\n").slice(1)) {
    const i = line.indexOf(":");
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const body = split < 0 ? "" : buf.subarray(split + 4, split + 4 + 96 * 1024).toString("utf8");
  return { protocol: m[1], status: Number(m[2]), headers, body };
}

const titleOf = (html) => decodeEntities(html.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim() || null;

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

/** A web page as plain words. */
export function htmlToText(html, max = 4000) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|p|div|li|tr|h[1-6]|section|article|header|footer|table|form|label|option)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, max);
}

async function httpLook(ip, port, secure) {
  const host = port === (secure ? 443 : 80) ? ip : `${ip}:${port}`;
  const r = await exchange(ip, port, { send: `GET / HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: Patch (home network assistant)\r\nAccept: */*\r\nConnection: close\r\n\r\n`, secure, wait: 4000, quiet: 900, first: 2500 });
  const h = r.connected && parseHttp(r.data);
  if (!h || h.protocol !== "HTTP") return { ok: false, cert: r.cert, connected: r.connected };
  return {
    ok: true,
    status: h.status,
    server: h.headers.server || null,
    poweredBy: h.headers["x-powered-by"] || null,
    title: titleOf(h.body),
    auth: h.status === 401 ? (h.headers["www-authenticate"] || "").match(/realm="?([^",]*)/i)?.[1] || "a password" : null,
    location: h.headers.location || null,
    contentType: h.headers["content-type"] || null,
    cert: r.cert,
    words: htmlToText(h.body, 1500),
  };
}

/** MQTT: a CONNECT with no login; the broker's answer says whether it lets anyone in. */
async function mqttLook(ip, port) {
  const id = Buffer.from("patch-look");
  const pkt = Buffer.concat([Buffer.from([0x10, 10 + 2 + id.length, 0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c, 0x00, id.length]), id]);
  const r = await exchange(ip, port, { send: pkt, wait: 2500, quiet: 400, max: 64 });
  if (r.data.length >= 4 && r.data[0] === 0x20 && r.data[1] === 0x02) {
    const rc = r.data[3];
    return { service: "mqtt", banner: rc === 0 ? "an MQTT broker that lets anyone connect" : rc === 4 || rc === 5 ? "an MQTT broker that asks for a login" : "an MQTT broker" };
  }
  return null;
}

/**
 * What answers on one open port: { port, name, service, banner, status, server, title, auth, cert,
 * location, contentType, words }. service is "http", "https", "tls", "ssh", "ftp", "smtp", "telnet",
 * "rtsp", "mqtt", "vnc", "text" (it greeted in words) or "quiet" (it says nothing until spoken to).
 */
export async function readPort(ip, port) {
  const out = { port, name: PORT_NAMES[port] || null, service: null };
  if (PRINTS_ANYTHING.has(port)) return { ...out, service: "printing" };
  if (port === 554 || port === 8554) {
    const r = await exchange(ip, port, { send: "OPTIONS * RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: Patch\r\n\r\n", wait: 2500 });
    const h = parseHttp(r.data);
    if (h?.protocol === "RTSP") return { ...out, service: "rtsp", status: h.status, server: h.headers.server || null };
  }
  if (port === 1883) {
    const m = await mqttLook(ip, port);
    if (m) return { ...out, ...m };
  }
  // Some speak first (SSH, FTP, Telnet, email, screen sharing): listen before asking anything.
  const hello = await exchange(ip, port, { wait: 1500, first: 1200, quiet: 400, max: 4096 });
  if (!hello.connected) return { ...out, service: "closed" };
  if (hello.data.length) {
    const text = printable(hello.data);
    const service = /^SSH-/.test(text)
      ? "ssh"
      : /^220[ -].*(ftp|filezilla|vsftpd|proftpd)/i.test(text)
        ? "ftp"
        : /^220[ -].*(smtp|esmtp|mail)/i.test(text)
          ? "smtp"
          : /^RFB \d/.test(text)
            ? "vnc"
            : hello.data[0] === 0xff
              ? "telnet"
              : /^220[ -]/.test(text)
                ? "ftp"
                : "text";
    return { ...out, service, banner: text.slice(0, 200) || null };
  }
  if (NOT_WEB.has(port)) return { ...out, service: "quiet" };
  // Then as a web page, plain and secure (the usual one first).
  let tlsCert = null;
  for (const secure of SECURE_FIRST.has(port) ? [true, false] : [false, true]) {
    const h = await httpLook(ip, port, secure);
    if (h.ok) {
      const { ok, ...rest } = h;
      return { ...out, service: secure ? "https" : "http", ...rest };
    }
    if (secure && h.cert) tlsCert = h.cert;
  }
  return tlsCert ? { ...out, service: "tls", cert: tlsCert } : { ...out, service: "quiet" };
}

// ── SNMP (printers, network storage, routers and switches answer "public") ─────

const berLen = (n) => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]));
const ber = (tag, ...parts) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), berLen(body.length), body]);
};
const berInt = (n) => {
  const bytes = [];
  let x = n >>> 0;
  do {
    bytes.unshift(x & 0xff);
    x >>>= 8;
  } while (x);
  if (bytes[0] & 0x80) bytes.unshift(0);
  return ber(0x02, Buffer.from(bytes));
};
function berOid(dotted) {
  const p = dotted.split(".").map(Number);
  const out = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const stack = [v & 0x7f];
    let x = v >>> 7;
    while (x) {
      stack.unshift((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    out.push(...stack);
  }
  return ber(0x06, Buffer.from(out));
}
function berRead(buf, i) {
  let len = buf[i + 1];
  let off = i + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + buf[off + k];
    off += n;
  }
  if (off + len > buf.length) throw new Error("short");
  return { tag: buf[i], start: off, end: off + len };
}
function berKids(buf, node) {
  const out = [];
  for (let i = node.start; i < node.end; ) {
    const c = berRead(buf, i);
    out.push(c);
    i = c.end;
  }
  return out;
}
function oidText(buf, node) {
  const b = buf.subarray(node.start, node.end);
  const out = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (const x of b.subarray(1)) {
    v = v * 128 + (x & 0x7f);
    if (!(x & 0x80)) {
      out.push(v);
      v = 0;
    }
  }
  return out.join(".");
}

const SNMP_SYSTEM = { descr: "1.3.6.1.2.1.1.1.0", objectId: "1.3.6.1.2.1.1.2.0", name: "1.3.6.1.2.1.1.5.0", location: "1.3.6.1.2.1.1.6.0" };

export function snmpGetRequest(oids, { community = "public", id = 0x5a7c } = {}) {
  const binds = ber(0x30, ...oids.map((o) => ber(0x30, berOid(o), Buffer.from([0x05, 0x00]))));
  return ber(0x30, berInt(1), ber(0x04, Buffer.from(community)), ber(0xa0, berInt(id), berInt(0), berInt(0), binds));
}

export function parseSnmpResponse(buf) {
  const msg = berRead(buf, 0);
  const [, , pdu] = berKids(buf, msg);
  if (!pdu || pdu.tag !== 0xa2) return null;
  const [, err, , binds] = berKids(buf, pdu);
  if (buf[err.start] !== 0) return null;
  const values = {};
  for (const b of berKids(buf, binds)) {
    const [oid, value] = berKids(buf, b);
    const key = oidText(buf, oid);
    if (value.tag === 0x04) values[key] = buf.subarray(value.start, value.end).toString("utf8").replace(/[^\x20-\x7e]+/g, " ").trim();
    else if (value.tag === 0x06) values[key] = oidText(buf, value);
  }
  return values;
}

/** The device's own description over SNMP ("public"): { descr, name, objectId, location } or null. */
export function snmpSystem(ip, { port = 161, timeout = 1500 } = {}) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* closed */
      }
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeout);
    sock.on("error", () => finish(null));
    sock.on("message", (msg, rinfo) => {
      if (rinfo.address !== ip) return;
      try {
        const v = parseSnmpResponse(msg);
        if (!v) return finish(null);
        const out = Object.fromEntries(Object.entries(SNMP_SYSTEM).map(([k, oid]) => [k, v[oid] || null]));
        finish(out.descr || out.name ? out : null);
      } catch {
        finish(null);
      }
    });
    sock.bind(0, () => sock.send(snmpGetRequest(Object.values(SNMP_SYSTEM)), port, ip, () => {}));
  });
}

// ── Working out what it is ─────────────────────────────────

// Words a device gives away about itself (in its web page's title, its server, its certificate, its
// greeting or its own description), and what they mean. The first match wins.
const KNOWN = [
  [/\bTasmota\b/i, { kind: "plug", brand: "Tasmota", model: "Tasmota smart plug or switch" }],
  [/\bESPHome\b/i, { kind: "smart", brand: "ESPHome", model: "ESPHome device" }],
  [/\bWLED\b/, { kind: "light", brand: "WLED", model: "WLED light strip" }],
  [/\bShelly\b/i, { kind: "switch", brand: "Shelly", model: "Shelly relay or plug" }],
  [/\bOpenBeken\b/i, { kind: "plug", brand: "OpenBeken", model: "OpenBeken smart plug" }],
  [/\bOctoPrint\b/i, { kind: "computer", brand: null, model: "3D printer server (OctoPrint)" }],
  [/\bHome Assistant\b/i, { kind: "hub", brand: "Home Assistant", model: "Home Assistant" }],
  [/\bHomebridge\b/i, { kind: "hub", brand: "Homebridge", model: "Homebridge" }],
  [/\bNode-RED\b/i, { kind: "computer", brand: null, model: "Home server (Node-RED)" }],
  [/\bPi-hole\b/i, { kind: "computer", brand: null, model: "Pi-hole ad blocker" }],
  [/\bzigbee2mqtt\b/i, { kind: "hub", brand: "Zigbee2MQTT", model: "Zigbee2MQTT bridge" }],
  [/\b(Hikvision|HIKVISION|DNVRS-Webs|App-webs)\b/, { kind: "camera", brand: "Hikvision", model: "Hikvision camera or recorder" }],
  [/\bDahua\b/i, { kind: "camera", brand: "Dahua", model: "Dahua camera or recorder" }],
  [/\bReolink\b/i, { kind: "camera", brand: "Reolink", model: "Reolink camera" }],
  [/\bAmcrest\b/i, { kind: "camera", brand: "Amcrest", model: "Amcrest camera" }],
  [/\bFoscam\b/i, { kind: "camera", brand: "Foscam", model: "Foscam camera" }],
  [/\b(Axis Communications|AXIS)\b/, { kind: "camera", brand: "Axis", model: "Axis camera" }],
  [/\b(Blue Iris|Frigate|ZoneMinder|Scrypted|Shinobi)\b/i, { kind: "computer", brand: null, model: "Camera recorder" }],
  [/\b(IP ?Camera|Net ?Cam|Web ?Cam|Network Camera|NVR|DVR)\b/i, { kind: "camera", brand: null, model: "Camera or video recorder" , generic: true }],
  [/\b(DiskStation|Synology)\b/i, { kind: "nas", brand: "Synology", model: "Synology DiskStation" }],
  [/\b(QNAP|QTS)\b/, { kind: "nas", brand: "QNAP", model: "QNAP network storage" }],
  [/\b(TrueNAS|FreeNAS)\b/i, { kind: "nas", brand: null, model: "TrueNAS storage" }],
  [/\bunRAID\b/i, { kind: "nas", brand: null, model: "Unraid server" }],
  [/\bMy ?Cloud\b/i, { kind: "nas", brand: "Western Digital", model: "WD My Cloud" }],
  [/\bOpenMediaVault\b/i, { kind: "nas", brand: null, model: "OpenMediaVault storage" }],
  [/\bPlex Media Server\b/i, { kind: "computer", brand: null, model: "Plex media server" }],
  [/\b(Jellyfin|Emby)\b/i, { kind: "computer", brand: null, model: "Media server" }],
  [/\bKodi\b/i, { kind: "media", brand: "Kodi", model: "Kodi media player" }],
  [/\b(Proxmox|ESXi|VMware)\b/i, { kind: "computer", brand: null, model: "Server running virtual machines" }],
  [/\b(iDRAC|iLO|IPMI)\b/, { kind: "computer", brand: null, model: "Server (remote management)" }],
  [/\b(OpenWrt|LuCI|DD-WRT|Tomato|pfSense|OPNsense)\b/i, { kind: "router", brand: null, model: "Router" }],
  [/\b(UniFi|Ubiquiti|EdgeOS|EdgeRouter|airOS)\b/i, { kind: "network", brand: "Ubiquiti", model: "Ubiquiti network equipment" }],
  [/\b(MikroTik|RouterOS)\b/i, { kind: "router", brand: "MikroTik", model: "MikroTik router" }],
  [/\b(eero|Orbi|Deco|Velop|Google Wifi|Nest Wifi|AmpliFi)\b/i, { kind: "network", brand: null, model: "Mesh Wi-Fi point" , generic: true }],
  [/\b(Range ?Extender|Repeater|Access Point)\b/i, { kind: "network", brand: null, model: "Wi-Fi extender or access point" , generic: true }],
  [/\b(BoostLite|Telus|Sagemcom|Arcadyan|Technicolor|Actiontec|Arris|Hitron|Askey|ZyXEL|Netgear|NETGEAR|Linksys|TP-LINK|TP-Link|ASUS ?WRT|AiMesh|Fritz!?Box)\b/, { kind: "router", brand: null, model: "Router or Wi-Fi point", generic: true }],
  [/\b(LaserJet|OfficeJet|DeskJet|ENVY|HP ETHERNET|HP JetDirect)\b/i, { kind: "printer", brand: "HP", model: "HP printer" }],
  [/\bBrother\b/i, { kind: "printer", brand: "Brother", model: "Brother printer" }],
  [/\b(Canon|PIXMA|imageCLASS)\b/, { kind: "printer", brand: "Canon", model: "Canon printer" }],
  [/\b(EPSON|Epson)\b/, { kind: "printer", brand: "Epson", model: "Epson printer" }],
  [/\b(Xerox|Lexmark|Kyocera|Ricoh|RICOH)\b/, { kind: "printer", brand: null, model: "Printer" , generic: true }],
  [/\bSonos\b/i, { kind: "speaker", brand: "Sonos", model: "Sonos speaker" }],
  [/\b(Denon|Marantz|HEOS)\b/i, { kind: "media", brand: "Denon / Marantz", model: "AV receiver or speaker" }],
  [/\b(Yamaha|MusicCast)\b/i, { kind: "media", brand: "Yamaha", model: "Yamaha AV receiver or speaker" }],
  [/\b(Onkyo|Pioneer|Integra)\b/i, { kind: "media", brand: null, model: "AV receiver" , generic: true }],
  [/\bBose\b/i, { kind: "speaker", brand: "Bose", model: "Bose speaker" }],
  [/\bPhilips hue\b/i, { kind: "hub", brand: "Philips Hue", model: "Hue Bridge" }],
  [/\b(ecobee|Nest Thermostat|Honeywell|Resideo)\b/i, { kind: "thermostat", brand: null, model: "Thermostat" , generic: true }],
  [/\b(Tuya|Smart ?Life)\b/i, { kind: "smart", brand: "Tuya", model: "Tuya smart device" }],
  [/\bRaspbian|Raspberry ?Pi\b/i, { kind: "computer", brand: "Raspberry Pi", model: "Raspberry Pi" }],
  [/\b(Ubuntu|Debian|Fedora|CentOS|Arch Linux)\b/, { kind: "computer", brand: null, model: "Linux computer" , generic: true }],
  [/\b(Windows|Microsoft-IIS|Microsoft-HTTPAPI)\b/, { kind: "computer", brand: null, model: "Windows computer" , generic: true }],
  [/\b(Roku)\b/, { kind: "streamer", brand: "Roku", model: "Roku player" }],
  [/\bChromecast\b/i, { kind: "streamer", brand: "Google", model: "Chromecast" }],
  [/\b(Tesla|Wall Connector)\b/, { kind: "appliance", brand: "Tesla", model: "Tesla Wall Connector" }],
];

const GREETING_HINTS = [
  [/dropbear/i, { kind: "network", model: "Router, camera or storage box (small Linux)" }],
  [/ROSSSH/, { kind: "router", brand: "MikroTik", model: "MikroTik router" }],
  [/Cisco/i, { kind: "network", brand: "Cisco", model: "Cisco network equipment" }],
  [/OpenSSH.*(Raspbian|\+rpt)/i, { kind: "computer", brand: "Raspberry Pi", model: "Raspberry Pi" }],
  [/OpenSSH/i, { kind: "computer", model: "Computer (Linux, Mac or a home server)" }],
  [/BusyBox/i, { kind: "network", model: "Small Linux device (camera, router or similar)" }],
];

const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

/**
 * What a device probably is from a closer look, saying why: { kind, brand, model, name, confidence,
 * reasons }. known is what Patch already had ({ kind, brand, model, vendor, hostnames }).
 */
export function guessFrom(look, known = {}) {
  const reasons = [];
  let g = null;
  let exact = false;
  const take = (v, why, isExact = false) => {
    if (!g || (isExact && !exact)) {
      g = { ...v };
      exact = isExact;
    }
    if (why && !reasons.includes(why)) reasons.push(why);
  };

  // What the device says about itself first: its UPnP description, its SNMP description.
  const u = look.upnp;
  if (u?.modelName || u?.manufacturer) {
    const kind = /MediaRenderer/i.test(u.deviceType || "") ? "media" : /InternetGatewayDevice|WANDevice/i.test(u.deviceType || "") ? "router" : /MediaServer/i.test(u.deviceType || "") ? "nas" : /Printer/i.test(u.deviceType || "") ? "printer" : /Camera|Basic/i.test(u.deviceType || "") ? null : null;
    take({ kind, brand: u.manufacturer || null, model: u.modelName || null, name: u.friendlyName || null }, `its UPnP description says ${[u.manufacturer, u.modelName].filter(Boolean).join(" ")}`, !!u.modelName);
  }
  if (look.snmp?.descr) {
    const hit = KNOWN.find(([re]) => re.test(look.snmp.descr));
    const { generic, ...facts } = hit?.[1] || { kind: null, brand: null, model: null };
    // Its own words, but not its exact model: "likely", ahead of anything a web page says.
    take({ ...facts, name: look.snmp.name || null }, `it describes itself over SNMP as “${look.snmp.descr.slice(0, 80)}”`);
  }

  // Then the words on what answers: web page titles and servers, certificates, greetings; a page's
  // own text only for words that name a maker or product (not "Windows" in a download link).
  for (const s of look.services) {
    const strong = [s.title, s.server, s.poweredBy, s.auth, s.cert?.subject, s.cert?.issuer, s.banner].filter(Boolean).join(" · ");
    let hit = strong ? KNOWN.find(([re]) => re.test(strong)) : null;
    const words = (s.words || "").slice(0, 600);
    if (!hit && words) hit = KNOWN.find(([re, v]) => !v.generic && re.test(words));
    if (!hit) continue;
    const [re, v] = hit;
    const what = s.title && re.test(s.title) ? `its web page on port ${s.port} is titled “${s.title}”` : s.server && re.test(s.server) ? `its server on port ${s.port} calls itself “${s.server}”` : s.cert && re.test(`${s.cert.subject} ${s.cert.issuer}`) ? `its security certificate on port ${s.port} names ${s.cert.subject}` : s.banner && re.test(s.banner) ? `its greeting on port ${s.port} says “${s.banner.slice(0, 60)}”` : `its web page on port ${s.port} mentions ${words.match(re)?.[0]}`;
    const { generic, ...facts } = v;
    take(facts, what);
  }
  if (!g) {
    for (const s of look.services.filter((x) => x.service === "ssh" || x.service === "telnet" || x.service === "text")) {
      const gh = GREETING_HINTS.find(([re]) => re.test(s.banner || ""));
      if (gh) take(gh[1], `its ${s.service === "ssh" ? "SSH" : s.service === "telnet" ? "Telnet" : ""} greeting on port ${s.port} says “${(s.banner || "").slice(0, 60)}”`.replace("its  greeting", "its greeting"));
    }
  }
  if (!g && /Raspberry/i.test(known.vendor || "")) take({ kind: "computer", brand: "Raspberry Pi", model: "Raspberry Pi" }, "its network chip is a Raspberry Pi's");

  // Then what it does: the kinds of service it offers.
  const by = (svc) => look.services.find((s) => s.service === svc);
  const has = (p) => look.open.includes(p);
  if (!g && by("rtsp")) take({ kind: "camera", brand: null, model: "Camera or video recorder" }, `it streams video over RTSP on port ${by("rtsp").port}${by("rtsp").server ? ` (its server: “${by("rtsp").server}”)` : ""}`);
  if (!g && (has(9100) || has(631) || has(515))) take({ kind: "printer", brand: null, model: "Printer" }, `it takes print jobs (port ${[9100, 631, 515].find(has)})`);
  if (!g && (has(445) || has(139)) && (has(5000) || has(5001))) take({ kind: "nas", brand: null, model: "Network storage" }, "it shares files and has a storage-style web page");
  if (!g && (has(445) || has(3389) || has(135))) take({ kind: "computer", brand: null, model: "Windows computer" }, "it shares files the way Windows does");
  if (!g && has(62078)) take({ kind: "phone", brand: "Apple", model: "iPhone or iPad" }, "it answers on Apple's sync port");
  if (!g && by("mqtt")) take({ kind: "hub", brand: null, model: "Smart-home hub (MQTT)" }, `it runs ${by("mqtt").banner} on port ${by("mqtt").port}`);
  if (!g && has(6668)) take({ kind: "smart", brand: "Tuya", model: "Tuya smart device" }, "it answers on Tuya's port 6668");
  if (!g && by("ssh")) take({ kind: "computer", brand: null, model: "Computer (Linux, Mac or a home server)" }, `it offers SSH on port ${by("ssh").port}`);
  if (look.mdns?.length && !g) take({ kind: null, brand: null, model: null }, `it announces ${look.mdns.map((x) => x.type).slice(0, 4).join(", ")}`);

  const out = { kind: g?.kind || known.kind || "unknown", brand: g?.brand ?? known.brand ?? null, model: g?.model ?? known.model ?? null, name: g?.name || look.netbios || look.hostname || null, confidence: exact ? "exact" : g ? "likely" : "guess", reasons };
  if (!g) out.reasons.push(look.open.length ? `it has ${look.open.length} open port${look.open.length === 1 ? "" : "s"}, but nothing on them says what it is` : "it answers, but has no open ports to ask");
  if (known.vendor && !out.brand && !["Espressif", "Realtek"].some((v) => known.vendor.includes(v))) out.reasons.push(`its network chip is made by ${known.vendor}`);
  return out;
}

/** Ways the assistant can talk to it, from what answered. */
export function waysToTalk(look) {
  const out = [];
  for (const s of look.services) {
    if (s.service === "http" || s.service === "https") out.push({ port: s.port, how: "web", what: `${s.service === "https" ? "secure " : ""}web page${s.title ? ` “${s.title}”` : ""}${s.auth ? " (asks for a password)" : ""}` });
    else if (s.service === "rtsp") out.push({ port: s.port, how: "video", what: "camera video (RTSP): a camera app can show it; Patch can't" });
    else if (s.service === "telnet" || s.service === "text" || s.service === "quiet") out.push({ port: s.port, how: "send", what: `${PORT_NAMES[s.port] || "a service"} that takes messages${s.banner ? ` (it says “${s.banner.slice(0, 40)}”)` : ""}` });
    else if (s.service === "mqtt") out.push({ port: s.port, how: "mqtt", what: s.banner });
    else if (s.service === "ssh") out.push({ port: s.port, how: "login", what: "SSH command line (needs its owner's login; Patch doesn't log in)" });
    else if (s.service === "tls") out.push({ port: s.port, how: "send", what: `an encrypted service${s.cert?.subject ? ` (“${s.cert.subject}”)` : ""}` });
    else if (s.service && s.service !== "closed") out.push({ port: s.port, how: "send", what: PORT_NAMES[s.port] || s.service });
  }
  if (look.upnp?.services?.length) out.push({ port: null, how: "upnp", what: `UPnP services: ${look.upnp.services.slice(0, 5).join(", ")}` });
  return out;
}

/**
 * A closer look at one device: knock on its ports (the well-known ones, or every port when deep),
 * read what answers, and ask it directly for its announcements. Gives { ip, answered, open, services,
 * mdns, hostname, upnp, snmp, netbios, guess, talk }.
 */
export async function lookCloser(ip, { deep = false, known = {}, mdnsTarget, ssdpTarget, budget = deep ? 45_000 : 15_000 } = {}) {
  const [knocked, mdns, names, ssdp, snmp, nb] = await Promise.all([
    deep ? openPorts(ip, { from: 1, to: 65535, budget, concurrency: 384 }) : openPortsIn(ip, [...COMMON_PORTS, ...(known.ports || [])]),
    browse({ target: mdnsTarget || ip, qu: !mdnsTarget, timeout: 1800 })
      .then((r) => r.services.filter((x) => x.addresses?.includes(ip)))
      .catch(() => []),
    reverseLookup([ip], { target: mdnsTarget || ip, timeout: 1500 }).catch(() => new Map()),
    ssdpSearch({ sts: ["ssdp:all"], target: ssdpTarget || ip, timeout: 1800 }).catch(() => []),
    snmpSystem(ip),
    nbstatSweep([ip], { timeout: 1500 }).catch(() => new Map()),
  ]);
  const open = knocked.open;
  const services = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, open.length) }, async () => {
      while (i < open.length) {
        const port = open[i++];
        const s = await readPort(ip, port).catch(() => null);
        if (s && s.service !== "closed") services.push(s);
      }
    }),
  );
  services.sort((a, b) => a.port - b.port);
  const location = ssdp.find((r) => r.address === ip)?.location;
  const desc = location ? await fetchDescription(location).catch(() => null) : null;
  const look = {
    ip,
    answered: knocked.answered || services.length > 0 || !!snmp || mdns.length > 0,
    open,
    services,
    mdns: mdns.map((x) => ({ type: x.type, name: x.name, port: x.port })),
    hostname: names.get(ip)?.replace(/\.local\.?$/i, "") || null,
    upnp: desc ? { friendlyName: desc.friendlyName || null, manufacturer: desc.manufacturer || null, modelName: desc.modelName || null, modelNumber: desc.modelNumber || null, deviceType: desc.deviceType || null, services: (desc.allServices || []).map((s) => String(s.serviceType || "").replace(/^urn:[^:]+:service:/, "")).filter(Boolean) } : null,
    snmp,
    netbios: nb.get(ip)?.name || null,
  };
  look.guess = guessFrom(look, known);
  look.talk = waysToTalk(look);
  return look;
}

// ── Talking to it ─────────────────────────────────────────

/** Links and forms on a page, so the assistant can find its way around a device's own pages. */
function linksAndForms(html, base) {
  const links = [];
  for (const m of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (links.length >= 25) break;
    let href = m[1];
    try {
      const u = new URL(href, base);
      if (u.hostname !== new URL(base).hostname) continue;
      href = `${u.port && u.port !== new URL(base).port ? `:${u.port}` : ""}${u.pathname}${u.search}`;
    } catch {
      continue;
    }
    const text = htmlToText(m[2], 60).replace(/\n/g, " ");
    if (!links.some((l) => l.path === href)) links.push({ text: text || null, path: href });
  }
  const forms = [];
  for (const m of String(html).matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    if (forms.length >= 5) break;
    const attr = (name, s) => s.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1] || null;
    const fields = [...m[2].matchAll(/<(input|select|textarea)\b([^>]*)>/gi)].map((f) => ({ name: attr("name", f[2]), type: f[1] === "input" ? attr("type", f[2]) || "text" : f[1] })).filter((f) => f.name && f.type !== "hidden").slice(0, 12);
    forms.push({ action: attr("action", m[1]) || "", method: (attr("method", m[1]) || "GET").toUpperCase(), fields });
  }
  return { links, forms };
}

/**
 * A request to one of the device's web pages or APIs: { ok, status, url, contentType, title, text,
 * json, links, forms, server, location, needsPassword }. Stays on this device: redirects elsewhere
 * are reported, not followed.
 */
export async function webRequest(ip, { port, path = "/", method = "GET", body = null, secure, contentType } = {}) {
  port = Number(port) || (secure ? 443 : 80);
  secure ??= SECURE_FIRST.has(port);
  method = String(method || "GET").toUpperCase();
  let p = String(path || "/").trim();
  if (/^https?:\/\//i.test(p)) {
    const u = new URL(p);
    if (u.hostname !== ip) return { ok: false, message: "That address is on another device; ask with that device instead." };
    secure = u.protocol === "https:";
    port = Number(u.port) || (secure ? 443 : 80);
    p = `${u.pathname}${u.search}`;
  }
  if (!p.startsWith("/")) p = `/${p}`;
  if (PRINTS_ANYTHING.has(port)) return { ok: false, message: `Port ${port} is a printer's raw printing port: anything sent there gets printed, so Patch doesn't.` };
  const headers = body != null ? { "content-type": contentType || (/^\s*[[{]/.test(String(body)) ? "application/json" : "application/x-www-form-urlencoded") } : {};
  let res = null;
  let url = null;
  let lastErr = null;
  for (const s of secure ? [true] : [false, true]) {
    url = `${s ? "https" : "http"}://${ip}${port === (s ? 443 : 80) ? "" : `:${port}`}${p}`;
    try {
      res = await request({ url, method, body: body == null ? undefined : String(body), headers, timeout: 8000 });
      for (let hops = 0; hops < 3 && [301, 302, 303, 307, 308].includes(res.status) && res.headers.location && ["GET", "HEAD"].includes(method); hops++) {
        const next = new URL(res.headers.location, url);
        if (next.hostname !== ip) break;
        url = next.toString();
        res = await request({ url, method, timeout: 8000 });
      }
      break;
    } catch (e) {
      lastErr = e;
      res = null;
    }
  }
  if (!res) return { ok: false, url, message: `${url} didn't answer (${lastErr?.code || lastErr?.message || "no reply"}).` };
  const type = String(res.headers["content-type"] || "");
  const raw = res.body;
  const out = { ok: res.status < 400, status: res.status, url, contentType: type || null, server: res.headers.server || null };
  if (res.status === 401 || res.status === 403) out.needsPassword = true;
  if (res.headers.location) out.location = res.headers.location;
  const text = raw.subarray(0, 512 * 1024).toString("utf8");
  if (/json/i.test(type) || /^\s*[[{]/.test(text)) {
    try {
      out.json = JSON.parse(text);
      const pretty = JSON.stringify(out.json, null, 1);
      if (pretty.length > 6000) {
        out.json = undefined;
        out.text = `${pretty.slice(0, 6000)}…`;
      }
      return out;
    } catch {
      /* not JSON after all */
    }
  }
  if (/html|xml/i.test(type) || /^\s*</.test(text)) {
    out.title = titleOf(text);
    out.text = /html/i.test(type) || /<html|<body|<div/i.test(text) ? htmlToText(text) : text.slice(0, 4000);
    const lf = linksAndForms(text, url);
    if (lf.links.length) out.links = lf.links;
    if (lf.forms.length) out.forms = lf.forms;
    return out;
  }
  const bin = raw.subarray(0, 2048).some((b) => b < 9 || (b > 13 && b < 32));
  out.text = bin ? `(${raw.length} bytes of binary data)` : text.slice(0, 4000);
  return out;
}

/** "PW?\r", "\x02status\x03", "hex: 0a ff 00" → the bytes to send. */
export function messageBytes(message) {
  const m = String(message ?? "");
  if (/^\s*hex\s*:/i.test(m)) return Buffer.from(m.replace(/^\s*hex\s*:/i, "").replace(/[^0-9a-f]/gi, ""), "hex");
  const bytes = [];
  for (let i = 0; i < m.length; i++) {
    if (m[i] === "\\" && i + 1 < m.length) {
      const c = m[i + 1];
      if (c === "r" || c === "n" || c === "t" || c === "0" || c === "\\") {
        bytes.push({ r: 13, n: 10, t: 9, 0: 0, "\\": 92 }[c]);
        i++;
        continue;
      }
      if (c === "x" && /^[0-9a-f]{2}$/i.test(m.slice(i + 2, i + 4))) {
        bytes.push(parseInt(m.slice(i + 2, i + 4), 16));
        i += 3;
        continue;
      }
    }
    bytes.push(...Buffer.from(m[i], "utf8"));
  }
  return Buffer.from(bytes);
}

/** Send a message to a port (TCP or UDP) and collect the reply: { ok, connected, reply, replyHex, bytes }. */
export async function sendMessage(ip, { port, protocol = "tcp", message = "", wait = 2, printing = false } = {}) {
  if (PRINTS_ANYTHING.has(Number(port)) && String(protocol).toLowerCase() !== "udp" && !printing) return { ok: false, message: `Port ${port} is a printer's raw printing port: anything sent there gets printed. Patch only sends there when the person asks to print text.` };
  const data = messageBytes(message);
  const ms = Math.min(8, Math.max(0.5, Number(wait) || 2)) * 1000;
  let reply;
  if (String(protocol).toLowerCase() === "udp") {
    reply = await new Promise((resolve) => {
      const sock = dgram.createSocket("udp4");
      const chunks = [];
      const finish = () => {
        try {
          sock.close();
        } catch {
          /* closed */
        }
        resolve({ connected: true, data: Buffer.concat(chunks) });
      };
      sock.on("error", finish);
      sock.on("message", (msg, rinfo) => rinfo.address === ip && chunks.push(msg));
      sock.bind(0, () => sock.send(data, Number(port), ip, () => setTimeout(finish, ms)));
    });
  } else {
    reply = await exchange(ip, Number(port), { send: data.length ? data : null, wait: ms, quiet: Math.min(ms, 900), first: ms, max: 64 * 1024 });
  }
  if (!reply.connected) return { ok: false, connected: false, message: `Port ${port} on that device didn't take a connection (${reply.error || "no answer"}).` };
  return { ok: true, connected: true, bytes: reply.data.length, reply: reply.data.length ? printable(reply.data, 3000) : null, replyHex: reply.data.length ? reply.data.subarray(0, 128).toString("hex").replace(/(..)/g, "$1 ").trim() : null };
}

// ── What needs the person's yes ───────────────────────────

const PASSWORDISH = /\b(pass(word|wd|phrase)?|pwd|passcode|pin|secret|token|api[_-]?key|auth|login|username|user)\s*["']?\s*[=:]/i;
const DESTRUCTIVE = /\b(factory|reset|reboot|restart|shutdown|power[-_ ]?off|firmware|upgrade|update|flash|format|erase|wipe|delete|remove|unlock|disarm)\b/i;
const CHANGING = /\b(on|off|toggle|turn|set|power|switch|start|stop|open|close|lock|play|pause|volume|level|bright(ness)?|colou?r|mode|scene|write|save|apply|enable|disable|cmnd|cmd|command|action)\b/i;

// A command channel ("cmnd=", "cmd=") is a read when it only asks: "Status", "Status 8", "Power".
const READ_COMMAND = /^(status|state|info|version|ver|ping|help|list|get[a-z]*|power\d?)( \d+)?$/i;

/** Whether a query string asks a device to change something ("turn=on", "cmnd=Power On") rather than to say something. */
export function queryChanges(query) {
  let params;
  try {
    params = [...new URLSearchParams(query)];
  } catch {
    return true;
  }
  return params.some(([k, v]) => {
    if (/^(cmnd|cmd|command)$/i.test(k)) return !READ_COMMAND.test(v.trim());
    return CHANGING.test(k) || CHANGING.test(v);
  });
}

/** Passwords never go from the assistant to a device: the person types them into its own page. */
export const sendsPassword = (...parts) => parts.some((p) => p != null && PASSWORDISH.test(String(p)));

/**
 * Whether a step could change the device (and so needs the person's yes), with the words to ask:
 * reading pages (GET) doesn't, unless its address says it does something; sending anything else does.
 */
export function changeOf(action, { method = "GET", path = "/", body = null, port, protocol = "tcp", message = "" } = {}, name = "the device") {
  if (action === "web") {
    const m = String(method || "GET").toUpperCase();
    const where = `${name}'s ${path || "/"}${port ? ` (port ${port})` : ""}`;
    if (DESTRUCTIVE.test(`${path} ${body || ""}`)) return `This could restart, reset or change ${name} in a big way: it sends ${m} ${where}${body ? ` with ${String(body).slice(0, 80)}` : ""}. Patch can't tell exactly what it will do.`;
    if (!["GET", "HEAD"].includes(m)) return `This sends ${m} ${where}${body ? ` with ${String(body).slice(0, 80)}` : ""}, which may change something on it. Patch can't tell exactly what it will do.`;
    if (/\?/.test(path) && queryChanges(String(path).split("?").slice(1).join("?"))) return `This asks ${where}, which looks like it changes something on it. Patch can't tell exactly what it will do.`;
    return null;
  }
  if (action === "send") {
    if (!String(message || "").length) return null;
    return `This sends “${String(message).slice(0, 60)}” to ${name} on ${String(protocol).toUpperCase()} port ${port}. Patch can't tell what it will do.`;
  }
  return null;
}
