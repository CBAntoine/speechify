// Asks the network "who offers which services?" over multicast DNS, the way AirPlay, Chromecast,
// printers and HomeKit devices announce themselves. Read-only.

import * as dgram from "node:dgram";

export const SERVICE_TYPES = [
  "_services._dns-sd._udp.local",
  "_device-info._tcp.local",
  "_http._tcp.local",
  "_ipp._tcp.local",
  "_ipps._tcp.local",
  "_printer._tcp.local",
  "_pdl-datastream._tcp.local",
  "_airplay._tcp.local",
  "_raop._tcp.local",
  "_googlecast._tcp.local",
  "_spotify-connect._tcp.local",
  "_smb._tcp.local",
  "_afpovertcp._tcp.local",
  "_ssh._tcp.local",
  "_sftp-ssh._tcp.local",
  "_hap._tcp.local",
  "_homekit._tcp.local",
  "_matter._tcp.local",
  "_esphomelib._tcp.local",
  "_companion-link._tcp.local",
  "_workstation._tcp.local",
  "_rfb._tcp.local",
  "_amzn-wplay._tcp.local",
  "_sonos._tcp.local",
  "_hue._tcp.local",
  "_androidtvremote2._tcp.local",
];

export interface DnsRecord {
  name: string;
  type: number;
  data: string | string[] | { target: string; port: number };
}

const T = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33 } as const;

function encodeName(name: string): Buffer {
  const parts = name.split(".").filter(Boolean);
  const bufs = parts.map((p) => {
    const b = Buffer.from(p, "utf8");
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  return Buffer.concat([...bufs, Buffer.from([0])]);
}

export function buildQuery(names: string[], type = T.PTR): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(names.length, 4);
  const qs = names.map((n) => {
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(type, 0);
    tail.writeUInt16BE(1, 2); // class IN
    return Buffer.concat([encodeName(n), tail]);
  });
  return Buffer.concat([header, ...qs]);
}

function readName(buf: Buffer, offset: number, depth = 0): { name: string; next: number } {
  const labels: string[] = [];
  let pos = offset;
  let next = -1;
  let guard = 0;
  while (pos < buf.length && guard++ < 128) {
    const len = buf[pos];
    if (len === 0) {
      pos++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length || depth > 16) break;
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      if (next === -1) next = pos + 2;
      const inner = readName(buf, ptr, depth + 1);
      labels.push(inner.name);
      pos = -1;
      break;
    }
    labels.push(buf.toString("utf8", pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return { name: labels.filter(Boolean).join("."), next: next !== -1 ? next : pos };
}

export function parseResponse(buf: Buffer): DnsRecord[] {
  if (buf.length < 12) return [];
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  try {
    for (let i = 0; i < qd; i++) pos = readName(buf, pos).next + 4;
    const out: DnsRecord[] = [];
    for (let i = 0; i < total && pos + 10 <= buf.length; i++) {
      const { name, next } = readName(buf, pos);
      pos = next;
      const type = buf.readUInt16BE(pos);
      const rdlen = buf.readUInt16BE(pos + 8);
      const rd = pos + 10;
      pos = rd + rdlen;
      if (pos > buf.length) break;
      if (type === T.A && rdlen === 4) out.push({ name, type, data: `${buf[rd]}.${buf[rd + 1]}.${buf[rd + 2]}.${buf[rd + 3]}` });
      else if (type === T.PTR) out.push({ name, type, data: readName(buf, rd).name });
      else if (type === T.SRV && rdlen >= 6) out.push({ name, type, data: { port: buf.readUInt16BE(rd + 4), target: readName(buf, rd + 6).name } });
      else if (type === T.TXT) {
        const strings: string[] = [];
        let p = rd;
        while (p < rd + rdlen) {
          const l = buf[p];
          strings.push(buf.toString("utf8", p + 1, p + 1 + l));
          p += 1 + l;
        }
        out.push({ name, type, data: strings.filter(Boolean) });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export interface MdnsDevice {
  ip: string;
  hostnames: Set<string>;
  instances: Set<string>;
  services: Set<string>;
  txt: Map<string, string>;
}

function device(map: Map<string, MdnsDevice>, ip: string): MdnsDevice {
  let d = map.get(ip);
  if (!d) {
    d = { ip, hostnames: new Set(), instances: new Set(), services: new Set(), txt: new Map() };
    map.set(ip, d);
  }
  return d;
}

/** Applies one response's records to the device that sent it. */
export function absorb(map: Map<string, MdnsDevice>, from: string, records: DnsRecord[]): void {
  const d = device(map, from);
  const hostToIp = new Map<string, string>();
  for (const r of records) if (r.type === T.A) hostToIp.set(r.name.toLowerCase(), r.data as string);
  for (const r of records) {
    if (r.type === T.A) {
      if (r.data === from) d.hostnames.add(r.name.replace(/\.local$/i, ""));
    } else if (r.type === T.PTR) {
      const target = r.data as string;
      if (r.name.toLowerCase() === "_services._dns-sd._udp.local") d.services.add(target.replace(/\.local$/i, ""));
      else {
        d.services.add(r.name.replace(/\.local$/i, ""));
        d.instances.add(target.replace(/\._[^.]+\._(tcp|udp)\.local$/i, ""));
      }
    } else if (r.type === T.TXT) {
      for (const kv of r.data as string[]) {
        const i = kv.indexOf("=");
        if (i > 0) {
          const k = kv.slice(0, i).toLowerCase();
          if (["model", "md", "fn", "ty", "usb_mdl", "product", "manufacturer", "am", "rpmd", "osxvers", "deviceid"].includes(k) && !d.txt.has(k)) d.txt.set(k, kv.slice(i + 1));
        }
      }
    } else if (r.type === T.SRV) {
      const ip = hostToIp.get((r.data as { target: string }).target.toLowerCase());
      if (!ip || ip === from) d.hostnames.add((r.data as { target: string }).target.replace(/\.local$/i, ""));
    }
  }
}

/** Sends one query per interface and listens for `waitMs`. */
export async function mdnsDiscover(interfaces: string[], waitMs = 2500): Promise<Map<string, MdnsDevice>> {
  const found = new Map<string, MdnsDevice>();
  const query = buildQuery(SERVICE_TYPES);
  const sockets: dgram.Socket[] = [];
  await Promise.all(
    (interfaces.length ? interfaces : [""]).map(
      (addr) =>
        new Promise<void>((resolve) => {
          const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
          sockets.push(s);
          s.on("error", () => resolve());
          s.on("message", (msg, rinfo) => absorb(found, rinfo.address, parseResponse(msg)));
          s.bind(0, addr || undefined, () => {
            try {
              if (addr) s.setMulticastInterface(addr);
              s.send(query, 5353, "224.0.0.251", () => resolve());
            } catch {
              resolve();
            }
          });
        }),
    ),
  );
  await new Promise((r) => setTimeout(r, waitMs));
  for (const s of sockets) {
    try {
      s.close();
    } catch {
      /* already closed */
    }
  }
  for (const [ip, d] of found) if (!d.services.size && !d.hostnames.size && !d.instances.size) found.delete(ip);
  return found;
}
