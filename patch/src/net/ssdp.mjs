// SSDP (UPnP discovery): routers, Sonos, Roku, smart TVs and media players answer an M-SEARCH
// with the URL of an XML file describing themselves and the services they can be controlled by.
import dgram from "node:dgram";
import { request } from "./lanhttp.mjs";
import { child, childText, findFirst, parseXml, textOf } from "./xml.mjs";

const GROUP = "239.255.255.250";
const PORT = 1900;

export const SEARCH_TARGETS = [
  "ssdp:all",
  "upnp:rootdevice",
  "roku:ecp",
  "urn:dial-multiscreen-org:service:dial:1",
  "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
  "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
  "urn:schemas-upnp-org:device:MediaRenderer:1",
  "urn:schemas-upnp-org:device:ZonePlayer:1",
  "urn:lge-com:service:webos-second-screen:1",
  "urn:samsung.com:device:RemoteControlReceiver:1",
];

export function mSearch(st, { mx = 2, host = `${GROUP}:${PORT}` } = {}) {
  return Buffer.from(
    ["M-SEARCH * HTTP/1.1", `HOST: ${host}`, 'MAN: "ssdp:discover"', `MX: ${mx}`, `ST: ${st}`, "USER-AGENT: Patch/1.0 UPnP/1.1", "", ""].join("\r\n"),
  );
}

export function parseSsdpMessage(text) {
  const lines = String(text).split(/\r?\n/);
  const start = lines.shift() || "";
  const headers = {};
  for (const l of lines) {
    const i = l.indexOf(":");
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return { start, headers };
}

/** Returns [{ address, location, st, usn, server, headers }], one per distinct LOCATION+USN. */
export function search({ sts = SEARCH_TARGETS, timeout = 2600, iface, target = GROUP, port = PORT } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const finish = () => {
      try {
        sock.close();
      } catch {
        /* closed */
      }
      resolve([...found.values()]);
    };
    sock.on("error", finish);
    sock.on("message", (msg, rinfo) => {
      const { start, headers } = parseSsdpMessage(msg.toString("utf8"));
      if (!/^HTTP\/1\.\d 200/i.test(start) && !/^NOTIFY/i.test(start)) return;
      const location = headers.location;
      if (!location) return;
      const key = `${location}|${(headers.usn || "").split("::")[0]}`;
      const prev = found.get(key);
      if (prev) {
        if (headers.st && !prev.sts.includes(headers.st)) prev.sts.push(headers.st);
        return;
      }
      let address = rinfo.address;
      try {
        const h = new URL(location).hostname;
        if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) address = h; // the device itself, even if it answered from another interface
      } catch {
        /* keep the sender's address */
      }
      found.set(key, { address, location, st: headers.st || headers.nt || null, sts: [headers.st || headers.nt].filter(Boolean), usn: headers.usn || null, server: headers.server || null, headers });
    });
    sock.bind(0, () => {
      try {
        if (target === GROUP) {
          sock.setMulticastTTL(4);
          if (iface) sock.setMulticastInterface(iface);
        }
      } catch {
        /* still try */
      }
      const host = target === GROUP ? `${GROUP}:${PORT}` : `${target}:${port}`;
      const blast = () => sts.forEach((st) => sock.send(mSearch(st, { host }), port, target, () => {}));
      blast();
      setTimeout(blast, 350);
      setTimeout(finish, timeout);
    });
  });
}

function absolute(url, base) {
  if (!url) return null;
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

function parseDevice(el, base) {
  const services = (child(el, "serviceList")?.children || [])
    .filter((s) => s.local === "service")
    .map((s) => ({
      serviceType: childText(s, "serviceType"),
      serviceId: childText(s, "serviceId"),
      controlURL: absolute(childText(s, "controlURL"), base),
      eventSubURL: absolute(childText(s, "eventSubURL"), base),
      SCPDURL: absolute(childText(s, "SCPDURL"), base),
    }));
  const devices = (child(el, "deviceList")?.children || []).filter((d) => d.local === "device").map((d) => parseDevice(d, base));
  return {
    deviceType: childText(el, "deviceType"),
    friendlyName: childText(el, "friendlyName"),
    manufacturer: childText(el, "manufacturer"),
    manufacturerURL: childText(el, "manufacturerURL"),
    modelName: childText(el, "modelName"),
    modelNumber: childText(el, "modelNumber"),
    modelDescription: childText(el, "modelDescription"),
    serialNumber: childText(el, "serialNumber"),
    udn: childText(el, "UDN"),
    presentationURL: absolute(childText(el, "presentationURL"), base),
    // Sonos adds these
    roomName: childText(el, "roomName"),
    displayName: childText(el, "displayName"),
    softwareVersion: childText(el, "softwareVersion"),
    services,
    devices,
  };
}

const flatten = (d) => [d, ...d.devices.flatMap(flatten)];

export function parseDescription(xml, location) {
  const root = parseXml(xml);
  const base = textOf(root, "URLBase") || location;
  const dev = findFirst(root, "device");
  if (!dev) return null;
  const d = parseDevice(dev, base);
  d.location = location;
  d.allDevices = flatten(d);
  d.allServices = d.allDevices.flatMap((x) => x.services);
  return d;
}

export async function fetchDescription(location, { timeout = 3000 } = {}) {
  try {
    const res = await request({ url: location, timeout });
    if (res.status >= 400) return null;
    return parseDescription(res.text(), location);
  } catch {
    return null;
  }
}

export const findService = (desc, pattern) => desc?.allServices?.find((s) => s.serviceType && pattern.test(s.serviceType)) ?? null;
