// WS-Discovery (UDP 3702): how security cameras (ONVIF), many network printers and Windows PCs
// announce themselves. Cameras include their maker and exact model in the reply.
import dgram from "node:dgram";
import crypto from "node:crypto";
import { childText, findAll, parseXml } from "./xml.mjs";

const GROUP = "239.255.255.250";
const PORT = 3702;

export function probeMessage(types = "") {
  return Buffer.from(
    `<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>uuid:${crypto.randomUUID()}</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe>${types ? `<d:Types>${types}</d:Types>` : ""}</d:Probe></e:Body></e:Envelope>`,
  );
}

const local = (name) => String(name || "").replace(/^.*:/, "");

/** ProbeMatches → [{ address, types, scopes, xaddrs, onvif: { name, hardware, location } }] */
export function parseProbeMatches(xml, from) {
  let doc;
  try {
    doc = parseXml(String(xml));
  } catch {
    return [];
  }
  const out = [];
  for (const m of findAll(doc, "ProbeMatch")) {
    const types = (childText(m, "Types") || "").split(/\s+/).filter(Boolean).map(local);
    const scopes = (childText(m, "Scopes") || "").split(/\s+/).filter(Boolean);
    const xaddrs = (childText(m, "XAddrs") || "").split(/\s+/).filter(Boolean);
    let address = from;
    for (const x of xaddrs) {
      try {
        const h = new URL(x).hostname;
        if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
          address = h;
          break;
        }
      } catch {
        /* not a URL */
      }
    }
    const onvif = {};
    for (const s of scopes) {
      const mm = s.match(/^onvif:\/\/www\.onvif\.org\/(name|hardware|location|type|manufacturer|mac)\/(.+)$/i);
      if (mm) {
        let v = mm[2];
        try {
          v = decodeURIComponent(v);
        } catch {
          /* keep raw */
        }
        v = v.replace(/_/g, " ").trim();
        const k = mm[1].toLowerCase();
        if (k === "type") (onvif.types ||= []).push(v);
        else onvif[k] ??= v;
      }
    }
    out.push({ address, types, scopes, xaddrs, onvif: Object.keys(onvif).length ? onvif : null });
  }
  return out;
}

/** Probe for WS-Discovery devices. Returns Map(ip → { types, onvif, xaddrs }). */
export function wsdDiscover({ target = GROUP, timeout = 2200, iface } = {}) {
  return new Promise((resolve) => {
    const found = new Map();
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
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
      for (const m of parseProbeMatches(msg.toString("utf8"), r.address)) {
        const prev = found.get(m.address);
        found.set(m.address, prev ? { ...prev, types: [...new Set([...prev.types, ...m.types])], onvif: prev.onvif || m.onvif } : m);
      }
    });
    sock.bind(0, () => {
      try {
        if (iface && target === GROUP) sock.setMulticastInterface(iface);
      } catch {
        /* default interface */
      }
      // Some cameras only answer a probe for their type; printers and PCs answer an open probe.
      for (const t of ["dn:NetworkVideoTransmitter", ""]) sock.send(probeMessage(t), PORT, target, () => {});
      setTimeout(finish, timeout);
    });
  });
}
