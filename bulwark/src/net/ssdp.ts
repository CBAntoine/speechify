// UPnP discovery (SSDP): routers, smart TVs, media servers and many IoT devices answer it.

import * as dgram from "node:dgram";
import { httpGet } from "./tcp.ts";

export interface SsdpReply {
  ip: string;
  location?: string;
  server?: string;
  st?: string;
  usn?: string;
}

export interface UpnpService {
  serviceType: string;
  controlURL: string;
}

export interface UpnpDescription {
  location: string;
  friendlyName?: string;
  manufacturer?: string;
  modelName?: string;
  modelNumber?: string;
  deviceType?: string;
  services: UpnpService[];
}

export function parseSsdp(text: string, ip: string): SsdpReply | null {
  if (!/^HTTP\/1\.\d 200|^NOTIFY /i.test(text)) return null;
  const get = (k: string) => text.match(new RegExp(`^${k}:\\s*(.*?)\\s*$`, "mi"))?.[1];
  return { ip, location: get("LOCATION"), server: get("SERVER"), st: get("ST") ?? get("NT"), usn: get("USN") };
}

export async function ssdpDiscover(interfaces: string[], waitMs = 3000): Promise<SsdpReply[]> {
  const replies: SsdpReply[] = [];
  const msgs = ["ssdp:all", "urn:schemas-upnp-org:device:InternetGatewayDevice:1", "upnp:rootdevice"].map((st) =>
    Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\nUSER-AGENT: Bulwark/0.1 UPnP/1.1\r\n\r\n`),
  );
  const sockets: dgram.Socket[] = [];
  await Promise.all(
    (interfaces.length ? interfaces : [""]).map(
      (addr) =>
        new Promise<void>((resolve) => {
          const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
          sockets.push(s);
          s.on("error", () => resolve());
          s.on("message", (msg, rinfo) => {
            const r = parseSsdp(msg.toString("latin1"), rinfo.address);
            if (r) replies.push(r);
          });
          s.bind(0, addr || undefined, () => {
            try {
              if (addr) s.setMulticastInterface(addr);
              let n = 0;
              for (const m of msgs) s.send(m, 1900, "239.255.255.250", () => ++n === msgs.length && resolve());
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
      /* closed */
    }
  }
  return replies;
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<(?:\\w+:)?${name}>\\s*([^<]*?)\\s*</(?:\\w+:)?${name}>`, "i"))?.[1];

export function parseDescription(xml: string, location: string): UpnpDescription {
  const base = tag(xml, "URLBase") || location;
  const services: UpnpService[] = [];
  for (const m of xml.matchAll(/<service>([\s\S]*?)<\/service>/gi)) {
    const st = tag(m[1], "serviceType");
    const ctl = tag(m[1], "controlURL");
    if (st && ctl) {
      try {
        services.push({ serviceType: st, controlURL: new URL(ctl, base).toString() });
      } catch {
        /* bad URL */
      }
    }
  }
  return {
    location,
    friendlyName: tag(xml, "friendlyName"),
    manufacturer: tag(xml, "manufacturer"),
    modelName: tag(xml, "modelName"),
    modelNumber: tag(xml, "modelNumber"),
    deviceType: tag(xml, "deviceType"),
    services,
  };
}

/**
 * Fetches a device description. Only from the device that sent the reply, so a device on the
 * network can't make Bulwark fetch an address somewhere else.
 */
export async function fetchDescription(reply: SsdpReply): Promise<UpnpDescription | null> {
  if (!reply.location) return null;
  let url: URL;
  try {
    url = new URL(reply.location);
  } catch {
    return null;
  }
  if (url.hostname !== reply.ip || (url.protocol !== "http:" && url.protocol !== "https:")) return null;
  const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
  const res = await httpGet(reply.ip, port, url.pathname + url.search, { tls: url.protocol === "https:", timeoutMs: 4000, hostHeader: url.host });
  if (!res || res.status !== 200) return null;
  return parseDescription(res.body, reply.location);
}
