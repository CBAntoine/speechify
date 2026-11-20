// PlayStation discovery (DDP): PS4s answer on UDP 987 and PS5s on 9302 with their name, model and
// whether they're on or in rest mode. Read-only: Patch doesn't wake or control consoles.
import dgram from "node:dgram";

const PROBES = [
  { port: 9302, version: "00030010" },
  { port: 987, version: "00020020" },
];

export const ddpSearch = (version) => Buffer.from(`SRCH * HTTP/1.1\ndevice-discovery-protocol-version:${version}\n`);

/** "HTTP/1.1 620 Server Standby\nhost-type:PS5\nhost-name:PS5-123\n…" → { type, name, standby, … } */
export function parseDdp(text) {
  const lines = String(text).split(/\r?\n/);
  const m = lines[0].match(/^HTTP\/1\.1\s+(\d{3})/);
  if (!m) return null;
  const h = {};
  for (const l of lines.slice(1)) {
    const i = l.indexOf(":");
    if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  if (!h["host-type"]) return null;
  const v = h["system-version"];
  return {
    type: h["host-type"],
    name: h["host-name"] || null,
    id: h["host-id"] || null,
    standby: m[1] === "620",
    systemVersion: v && /^\d{8}$/.test(v) ? `${Number(v.slice(0, 2))}.${v.slice(2, 4)}` : v || null,
  };
}

/** Finds PlayStations. Returns Map(ip → info). */
export function ddpDiscover({ broadcasts = ["255.255.255.255"], unicast = [], timeout = 1500 } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket("udp4");
    const finish = () => {
      try {
        sock.close();
      } catch {
        /* closed */
      }
      resolve(found);
    };
    sock.on("error", finish);
    sock.on("message", (msg, r) => {
      const info = parseDdp(msg.toString("utf8"));
      if (info) found.set(r.address, info);
    });
    sock.bind(0, () => {
      try {
        sock.setBroadcast(true);
      } catch {
        /* unicast still works */
      }
      for (const { port, version } of PROBES) {
        for (const addr of [...broadcasts, ...unicast]) sock.send(ddpSearch(version), port, addr, () => {});
      }
      setTimeout(finish, timeout);
    });
  });
}
