// Devices Patch has no driver for, that only a closer look can name (the explore tool): a smart plug
// running Tasmota, a Raspberry Pi with an MQTT broker and a web app on an odd port, an AV receiver that
// takes text commands on port 23, a Hikvision camera (RTSP video, a password on its page), network
// storage that describes itself over SNMP, and a printer's raw port that prints whatever arrives.
import dgram from "node:dgram";
import http from "node:http";
import net from "node:net";

const listen = (server, port, ip) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, ip, () => resolve(server));
  });

function closable(server, sockets) {
  return { close: () => new Promise((r) => (sockets.forEach((s) => s.destroy()), server.close(() => r()))) };
}

async function tcpServer(ip, port, onConnection) {
  const sockets = new Set();
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("error", () => {});
    onConnection(s);
  });
  await listen(server, port, ip);
  return closable(server, sockets);
}

async function httpServer(ip, port, handler) {
  const sockets = new Set();
  const server = http.createServer(handler);
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await listen(server, port, ip);
  return closable(server, sockets);
}

// ── SNMP, written here from RFC 1157 / 3416 (independently of Patch's own) ──

const len = (n) => (n < 128 ? [n] : n < 256 ? [0x81, n] : [0x82, n >> 8, n & 255]);
const tlv = (tag, bytes) => [tag, ...len(bytes.length), ...bytes];
const int = (n) => {
  const b = [];
  do {
    b.unshift(n & 255);
    n = Math.floor(n / 256);
  } while (n > 0);
  if (b[0] & 0x80) b.unshift(0);
  return tlv(0x02, b);
};
const str = (s) => tlv(0x04, [...Buffer.from(s, "utf8")]);
const oid = (dotted) => {
  const p = dotted.split(".").map(Number);
  const b = [40 * p[0] + p[1]];
  for (const v of p.slice(2)) {
    const parts = [v & 127];
    for (let x = Math.floor(v / 128); x > 0; x = Math.floor(x / 128)) parts.unshift((x & 127) | 128);
    b.push(...parts);
  }
  return tlv(0x06, b);
};
function readTlv(buf, i) {
  let n = buf[i + 1];
  let at = i + 2;
  if (n & 0x80) {
    const k = n & 0x7f;
    n = 0;
    for (let j = 0; j < k; j++) n = n * 256 + buf[at + j];
    at += k;
  }
  return { tag: buf[i], at, end: at + n };
}

async function snmpAgent(ip, sys) {
  const values = { "1.3.6.1.2.1.1.1.0": str(sys.descr), "1.3.6.1.2.1.1.2.0": oid(sys.objectId), "1.3.6.1.2.1.1.5.0": str(sys.name), "1.3.6.1.2.1.1.6.0": str(sys.location) };
  const sock = dgram.createSocket("udp4");
  let closed = false;
  sock.on("error", () => {});
  sock.on("message", (msg, rinfo) => {
    if (closed) return;
    try {
      // message { version, community, GetRequest { request-id, … } }
      const top = readTlv(msg, 0);
      const version = readTlv(msg, top.at);
      const community = readTlv(msg, version.end);
      if (msg.subarray(community.at, community.end).toString() !== "public") return;
      const pdu = readTlv(msg, community.end);
      if (pdu.tag !== 0xa0) return;
      const rid = readTlv(msg, pdu.at);
      const requestId = [...msg.subarray(rid.at, rid.end)].reduce((a, b) => a * 256 + b, 0);
      const binds = Object.entries(values).flatMap(([o, v]) => tlv(0x30, [...oid(o), ...v]));
      const body = tlv(0xa2, [...int(requestId), ...int(0), ...int(0), ...tlv(0x30, binds)]);
      sock.send(Buffer.from(tlv(0x30, [...int(1), ...str("public"), ...body])), rinfo.port, rinfo.address);
    } catch {
      /* not SNMP */
    }
  });
  await new Promise((resolve, reject) => {
    sock.once("error", reject);
    sock.bind(161, ip, resolve);
  });
  return {
    close: () =>
      new Promise((r) => {
        if (closed) return r();
        closed = true;
        try {
          sock.close(() => r());
        } catch {
          r();
        }
      }),
  };
}

export const mysteryState = () => ({
  plug: { power: "OFF", requests: [] },
  receiver: { power: "STANDBY", volume: 45, heard: [] },
  printer: { printed: [] },
});

export async function mysteryDevices(ip, state) {
  const out = [];
  // A smart plug running Tasmota: its own firmware's page and command API.
  out.push(
    await httpServer(ip(40), 80, (req, res) => {
      const u = new URL(req.url, "http://plug");
      state.plug.requests.push(`${req.method} ${req.url}`);
      if (u.pathname === "/cm") {
        const cmnd = (u.searchParams.get("cmnd") || "").trim();
        let body;
        if (/^status( 0)?$/i.test(cmnd)) body = { Status: { Module: 1, DeviceName: "Tasmota", FriendlyName: ["Porch light"], Power: state.plug.power === "ON" ? 1 : 0, Topic: "tasmota_1A2B40" } };
        else if (/^power$/i.test(cmnd)) body = { POWER: state.plug.power };
        else if (/^power (on|1)$/i.test(cmnd)) body = { POWER: (state.plug.power = "ON") };
        else if (/^power (off|0)$/i.test(cmnd)) body = { POWER: (state.plug.power = "OFF") };
        else body = { Command: "Unknown" };
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(body));
      }
      if (u.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html" });
        return res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tasmota</title></head><body><h2>Porch light</h2><div id="l1">${state.plug.power}</div><form action="." method="get"><button name="o" value="1">Toggle</button></form><a href="/cn">Configuration</a> <a href="/in">Information</a> <a href="/up">Firmware Upgrade</a></body></html>`);
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
    }),
  );
  // A Raspberry Pi: SSH that greets, an MQTT broker that lets anyone in, a web app on an odd port.
  out.push(await tcpServer(ip(41), 22, (s) => s.write("SSH-2.0-OpenSSH_7.9p1 Raspbian-10+deb10u2\r\n")));
  out.push(await tcpServer(ip(41), 1883, (s) => s.once("data", (b) => b[0] === 0x10 && s.write(Buffer.from([0x20, 0x02, 0x00, 0x00])))));
  out.push(await httpServer(ip(41), 40888, (req, res) => (res.writeHead(200, { "content-type": "text/html" }), res.end("<html><head><title>Garden watering</title></head><body>Zone 1: off</body></html>"))));
  // An AV receiver: text commands on port 23 (it doesn't greet), and a small page.
  out.push(
    await tcpServer(ip(42), 23, (s) => {
      let buf = "";
      s.on("data", (b) => {
        buf += b.toString("latin1");
        for (let i = buf.indexOf("\r"); i >= 0; i = buf.indexOf("\r")) {
          const cmd = buf.slice(0, i).replace(/^\n/, "");
          buf = buf.slice(i + 1);
          state.receiver.heard.push(cmd);
          if (cmd === "PW?") s.write(`PW${state.receiver.power}\r`);
          else if (cmd === "PWON" || cmd === "PWSTANDBY") s.write(`PW${(state.receiver.power = cmd.slice(2))}\r`);
          else if (cmd === "MV?") s.write(`MV${state.receiver.volume}\r`);
        }
      });
    }),
  );
  out.push(await httpServer(ip(42), 80, (req, res) => (res.writeHead(200, { "content-type": "text/html" }), res.end("<html><head><title>AVR-X1700H</title></head><body><h1>Denon AVR-X1700H</h1><p>Web Controller</p></body></html>"))));
  // A Hikvision camera: RTSP video, and a web page behind a password.
  out.push(await tcpServer(ip(43), 554, (s) => s.once("data", (b) => s.write(`RTSP/1.0 401 Unauthorized\r\nCSeq: ${b.toString().match(/CSeq: *(\d+)/i)?.[1] || 1}\r\nWWW-Authenticate: Digest realm="IP Camera(C2143)", nonce="a1b2c3"\r\nServer: HIKVISION RTSP SERVER\r\n\r\n`))));
  out.push(await httpServer(ip(43), 80, (req, res) => (res.writeHead(401, { "www-authenticate": 'Digest realm="DS-2CD2143G2-I", qop="auth", nonce="d4e5"', server: "webserver", "content-type": "text/html" }), res.end("<html><head><title>Document Error: Unauthorized</title></head><body>Access Error: 401</body></html>"))));
  // Network storage that describes itself over SNMP, with Windows-style file sharing.
  out.push(await tcpServer(ip(44), 445, () => {}));
  out.push(await snmpAgent(ip(44), { descr: "Linux DiskStation 4.4.302+ #69057 SMP Fri Jan 12 17:02:59 CST 2024 x86_64 GNU/Linux synology_geminilake_920+", name: "FamilyNAS", objectId: "1.3.6.1.4.1.8072.3.2.10", location: "Basement" }));
  // A printer's raw port: whatever arrives gets printed.
  out.push(await tcpServer(ip(45), 9100, (s) => s.on("data", (b) => state.printer.printed.push(b.toString("latin1")))));
  return out;
}
