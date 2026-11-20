// Multicast DNS / DNS-SD browsing: asks "who offers what?" on the local network and collects the
// answers (Chromecasts, AirPlay speakers, printers, Hue bridges, HomeKit accessories, Shelly, WLED…).
//
// Queries go out twice: from port 5353 (answers arrive by multicast) and from a random port
// ("legacy unicast", RFC 6762 §6.7, answered straight back to us). If something else on this computer
// already owns 5353 exclusively, the random-port socket still works on its own.
import dgram from "node:dgram";
import { TYPE, decode, encodeQuery, instanceLabel, reverseName } from "./dns-packet.mjs";

const GROUP = "224.0.0.251";
const PORT = 5353;

export const SERVICE_TYPES = [
  "_googlecast._tcp", "_airplay._tcp", "_raop._tcp", "_companion-link._tcp", "_hap._tcp", "_homekit._tcp",
  "_hue._tcp", "_sonos._tcp", "_spotify-connect._tcp", "_ipp._tcp", "_ipps._tcp", "_printer._tcp",
  "_pdl-datastream._tcp", "_uscan._tcp", "_scanner._tcp", "_smb._tcp", "_afpovertcp._tcp", "_ssh._tcp",
  "_sftp-ssh._tcp", "_device-info._tcp", "_shelly._tcp", "_wled._tcp", "_elg._tcp", "_home-assistant._tcp",
  "_esphomelib._tcp", "_http._tcp", "_amzn-wplay._tcp", "_androidtvremote2._tcp", "_plexmediasvr._tcp",
  "_matter._tcp", "_meshcop._udp", "_mqtt._tcp", "_workstation._tcp", "_nvstream_dbd._tcp", "_daap._tcp",
  "_rdlink._tcp", "_viziocast._tcp", "_leap._tcp", "_lutron._tcp", "_miio._udp", "_ecobee._tcp", "_dyson_mqtt._tcp",
];

const ENUMERATE = "_services._dns-sd._udp.local";
const local = (t) => (t.endsWith(".local") ? t : `${t}.local`);

function openSockets({ iface, target }) {
  const sockets = [];
  const multicast = target === GROUP;
  const make = (port) =>
    new Promise((resolve) => {
      const s = dgram.createSocket({ type: "udp4", reuseAddr: port === PORT });
      s.once("error", () => {
        try {
          s.close();
        } catch {
          /* closed */
        }
        resolve(null);
      });
      s.bind(port, () => {
        try {
          if (multicast) {
            if (iface) s.setMulticastInterface(iface);
            s.setMulticastTTL(255);
            s.setMulticastLoopback(true);
            if (port === PORT) s.addMembership(GROUP, iface || undefined);
          }
        } catch {
          /* membership can fail on odd adapters; unicast replies still arrive */
        }
        s.removeAllListeners("error");
        s.on("error", () => {});
        resolve(s);
      });
    });
  if (multicast) sockets.push(make(PORT));
  sockets.push(make(0));
  return Promise.all(sockets).then((list) => list.filter(Boolean));
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Browse DNS-SD services. Returns { services, hosts } where each service is
 * { type, instance, name, host, port, txt, addresses, source }.
 * `target` defaults to the mDNS group; a unicast address (used by the device simulator) also works.
 */
export async function browse({ types = SERVICE_TYPES, timeout = 2600, iface, target = GROUP, port = PORT, enumerate = true } = {}) {
  const sockets = await openSockets({ iface, target });
  // All keyed by lower-cased name.
  const ptr = new Map(); // service type → Map(instance key → instance name as announced)
  const srv = new Map(); // instance → { target, port }
  const txt = new Map(); // instance → kv
  const addr = new Map(); // hostname → Set(ip)
  const source = new Map(); // instance → ip that announced it
  const asked = new Set();

  const send = (questions) => {
    for (const group of chunk(questions, 14)) {
      const pkt = encodeQuery(group);
      for (const s of sockets) s.send(pkt, port, target, () => {});
    }
  };
  const ask = (names) => {
    const fresh = names.map(local).filter((n) => !asked.has(n));
    fresh.forEach((n) => asked.add(n));
    if (fresh.length) send(fresh.map((name) => ({ name, type: TYPE.PTR })));
  };

  const onMessage = (msg, rinfo) => {
    let m;
    try {
      m = decode(msg);
    } catch {
      return;
    }
    if (!m.response) return;
    for (const r of [...m.answers, ...m.additionals]) {
      const key = r.name.toLowerCase(); // DNS names are case-insensitive
      if (r.type === TYPE.PTR) {
        if (key === ENUMERATE) {
          if (enumerate) ask([r.data.replace(/\.local$/i, "")]);
          continue;
        }
        if (key.endsWith(".in-addr.arpa")) continue;
        if (!ptr.has(key)) ptr.set(key, new Map());
        ptr.get(key).set(r.data.toLowerCase(), r.data);
        if (!source.has(r.data.toLowerCase())) source.set(r.data.toLowerCase(), rinfo.address);
      } else if (r.type === TYPE.SRV) {
        srv.set(key, { target: r.data.target, port: r.data.port });
        if (!source.has(key)) source.set(key, rinfo.address);
      } else if (r.type === TYPE.TXT) {
        txt.set(key, r.data.kv);
      } else if (r.type === TYPE.A) {
        const key = r.name.toLowerCase();
        if (!addr.has(key)) addr.set(key, new Set());
        addr.get(key).add(r.data);
      }
    }
  };
  for (const s of sockets) s.on("message", onMessage);

  ask([...(enumerate ? [ENUMERATE] : []), ...types]);
  const followUp = () => {
    const qs = [];
    for (const instances of ptr.values()) {
      for (const [key, inst] of instances) {
        if (!srv.has(key)) qs.push({ name: inst, type: TYPE.SRV });
        if (!txt.has(key)) qs.push({ name: inst, type: TYPE.TXT });
      }
    }
    for (const { target: host } of srv.values()) if (!addr.has(host.toLowerCase())) qs.push({ name: host, type: TYPE.A });
    if (qs.length) send(qs);
  };
  const t1 = setTimeout(followUp, Math.round(timeout * 0.45));
  const t2 = setTimeout(followUp, Math.round(timeout * 0.75));
  await new Promise((r) => setTimeout(r, timeout));
  clearTimeout(t1);
  clearTimeout(t2);
  for (const s of sockets) {
    try {
      s.close();
    } catch {
      /* closed */
    }
  }

  const services = [];
  for (const [type, instances] of ptr) {
    for (const [key, inst] of instances) {
      const s = srv.get(key);
      const ips = s ? [...(addr.get(s.target.toLowerCase()) || [])] : [];
      const fallback = source.get(key);
      services.push({
        type: type.replace(/\.local$/i, ""),
        instance: inst,
        name: instanceLabel(inst),
        host: s?.target ?? null,
        port: s?.port ?? null,
        txt: txt.get(key) || {},
        addresses: ips.length ? ips : fallback ? [fallback] : [],
        source: fallback ?? null,
      });
    }
  }
  const hosts = new Map([...addr].map(([h, ips]) => [h, [...ips]]));
  return { services, hosts };
}

/** Ask devices for their own ".local" names (Apple devices and Linux boxes running Avahi answer). */
export async function reverseLookup(ips, { timeout = 1500, iface, target = GROUP, port = PORT } = {}) {
  if (!ips.length) return new Map();
  const sockets = await openSockets({ iface, target });
  const want = new Map(ips.map((ip) => [reverseName(ip), ip]));
  const names = new Map();
  const onMessage = (msg) => {
    let m;
    try {
      m = decode(msg);
    } catch {
      return;
    }
    for (const r of [...m.answers, ...m.additionals]) {
      if (r.type === TYPE.PTR && want.has(r.name.toLowerCase())) names.set(want.get(r.name.toLowerCase()), r.data);
    }
  };
  for (const s of sockets) s.on("message", onMessage);
  for (const group of chunk([...want.keys()], 12)) {
    const pkt = encodeQuery(group.map((name) => ({ name, type: TYPE.PTR })));
    for (const s of sockets) s.send(pkt, port, target, () => {});
  }
  await new Promise((r) => setTimeout(r, timeout));
  for (const s of sockets) {
    try {
      s.close();
    } catch {
      /* closed */
    }
  }
  return names;
}
