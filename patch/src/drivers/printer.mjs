// Network printers: IPP (port 631) for status, ink/toner levels and error reasons.
import { request } from "../net/lanhttp.mjs";
import { done, explainError, unsupported, DeviceError } from "./common.mjs";

const T = { integer: 0x21, boolean: 0x22, enum: 0x23, textLang: 0x35, nameLang: 0x36, text: 0x41, name: 0x42, keyword: 0x44, uri: 0x45, charset: 0x47, language: 0x48, mime: 0x49 };

const REQUESTED = [
  "printer-name", "printer-info", "printer-location", "printer-make-and-model", "printer-state", "printer-state-reasons",
  "printer-state-message", "printer-is-accepting-jobs", "printer-uuid", "printer-firmware-string-version", "printer-more-info",
  "marker-names", "marker-levels", "marker-colors", "marker-types", "marker-low-levels", "marker-high-levels", "identify-actions-supported",
];

function attr(tag, name, values) {
  const parts = [];
  values.forEach((v, i) => {
    const n = i === 0 ? Buffer.from(name, "utf8") : Buffer.alloc(0);
    const val = typeof v === "number" ? Buffer.from([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]) : Buffer.from(String(v), "utf8");
    const h = Buffer.alloc(3);
    h[0] = tag;
    h.writeUInt16BE(n.length, 1);
    const l = Buffer.alloc(2);
    l.writeUInt16BE(val.length);
    parts.push(h, n, l, val);
  });
  return Buffer.concat(parts);
}

export function encodeIpp(operation, printerUri, { requestId = 1, version = [2, 0], extra = [] } = {}) {
  const head = Buffer.alloc(8);
  head[0] = version[0];
  head[1] = version[1];
  head.writeUInt16BE(operation, 2);
  head.writeUInt32BE(requestId, 4);
  return Buffer.concat([
    head,
    Buffer.from([0x01]),
    attr(T.charset, "attributes-charset", ["utf-8"]),
    attr(T.language, "attributes-natural-language", ["en"]),
    attr(T.uri, "printer-uri", [printerUri]),
    ...extra,
    Buffer.from([0x03]),
  ]);
}

export function decodeIpp(buf) {
  const res = { version: `${buf[0]}.${buf[1]}`, status: buf.readUInt16BE(2), requestId: buf.readUInt32BE(4), attributes: {} };
  let o = 8;
  let last = null;
  while (o < buf.length) {
    const tag = buf[o++];
    if (tag === 0x03) break;
    if (tag <= 0x0f) continue; // group delimiter
    const nlen = buf.readUInt16BE(o);
    o += 2;
    const name = buf.subarray(o, o + nlen).toString("utf8");
    o += nlen;
    const vlen = buf.readUInt16BE(o);
    o += 2;
    const raw = buf.subarray(o, o + vlen);
    o += vlen;
    let value;
    if (tag === T.integer || tag === T.enum) value = raw.length === 4 ? raw.readInt32BE(0) : null;
    else if (tag === T.boolean) value = raw[0] === 1;
    else if (tag === T.textLang || tag === T.nameLang) {
      const ll = raw.readUInt16BE(0);
      const tl = raw.readUInt16BE(2 + ll);
      value = raw.subarray(4 + ll, 4 + ll + tl).toString("utf8");
    } else if (tag >= 0x40 && tag <= 0x5f) value = raw.toString("utf8");
    else value = raw;
    if (nlen) {
      last = name;
      res.attributes[name] = [value];
    } else if (last) res.attributes[last].push(value);
  }
  return res;
}

const REASONS = {
  "media-empty": "out of paper", "media-needed": "out of paper", "media-jam": "paper jam", "media-low": "paper running low",
  "toner-low": "toner low", "toner-empty": "toner empty", "marker-supply-low": "ink or toner low", "marker-supply-empty": "ink or toner empty",
  "marker-waste-almost-full": "waste ink nearly full", "marker-waste-full": "waste ink full", "door-open": "a door is open",
  "cover-open": "a cover is open", "input-tray-missing": "a paper tray is missing", "output-area-full": "output tray full",
  "offline": "offline", "paused": "paused", "shutdown": "shutting down", "connecting-to-device": "connecting", "other": "needs attention",
};

export function humanReasons(list) {
  return [...new Set((list || []).filter((r) => r && r !== "none").map((r) => {
    const base = String(r).replace(/-(report|warning|error)$/, "");
    return REASONS[base] || base.replace(/-/g, " ");
  }))];
}

const STATE = { 3: "ready", 4: "printing", 5: "stopped" };

export async function printerStatus(ip, { port = 631, path = "ipp/print", secure = false } = {}) {
  const scheme = secure ? "https" : "http";
  const uri = `ipp://${ip}:${port}/${path}`;
  for (const version of [[2, 0], [1, 1]]) {
    const body = encodeIpp(0x000b, uri, { version, extra: [attr(T.keyword, "requested-attributes", REQUESTED)] });
    const res = await request({ url: `${scheme}://${ip}:${port}/${path}`, method: "POST", body, headers: { "content-type": "application/ipp" }, timeout: 4000 });
    if (res.status !== 200) throw new DeviceError(`The printer answered HTTP ${res.status}.`);
    const r = decodeIpp(res.body);
    if (r.status === 0x0503 && version[0] === 2) continue; // version not supported → retry as 1.1
    if (r.status >= 0x0400) throw new DeviceError(`The printer refused the status request (0x${r.status.toString(16)}).`);
    const a = (k) => r.attributes[k] || [];
    const names = a("marker-names");
    const levels = a("marker-levels");
    const colors = a("marker-colors");
    const types = a("marker-types");
    const lows = a("marker-low-levels");
    const highs = a("marker-high-levels");
    const supplies = names.map((name, i) => {
      const raw = levels[i];
      const high = highs[i] > 0 ? highs[i] : 100;
      return {
        name,
        level: typeof raw === "number" && raw >= 0 ? Math.round((raw / high) * 100) : null,
        someLeft: raw === -3,
        low: typeof raw === "number" && raw >= 0 ? raw <= (lows[i] > 0 ? lows[i] : 10) : false,
        color: colors[i] && /^#[0-9a-f]{6}/i.test(colors[i]) ? colors[i].slice(0, 7) : null,
        type: types[i] || null,
      };
    });
    return {
      name: a("printer-info")[0] || a("printer-name")[0] || null,
      model: a("printer-make-and-model")[0] || null,
      location: a("printer-location")[0] || null,
      status: STATE[a("printer-state")[0]] || "unknown",
      reasons: humanReasons(a("printer-state-reasons")),
      message: a("printer-state-message")[0] || null,
      accepting: a("printer-is-accepting-jobs")[0] ?? null,
      uuid: (a("printer-uuid")[0] || "").replace(/^urn:uuid:/, "") || null,
      firmware: a("printer-firmware-string-version")[0] || null,
      moreInfo: a("printer-more-info")[0] || null,
      identify: a("identify-actions-supported").length > 0,
      supplies,
    };
  }
  throw new DeviceError("The printer didn't understand the status request.");
}

export function supplySummary(supplies) {
  const known = supplies.filter((s) => s.level != null);
  if (!known.length) return null;
  return known.map((s) => `${s.name.replace(/\s*(cartridge|toner|ink)\b/gi, "").trim() || s.name} ${s.level}%`).join(", ");
}

export default {
  id: "printer",
  label: "Printer (IPP)",

  async detect(host) {
    const svc = host.mdns.find((s) => s.type === "_ipps._tcp" || s.type === "_ipp._tcp");
    const anyPrinterSvc = svc || host.mdns.find((s) => /_printer|_pdl-datastream/.test(s.type));
    if (!anyPrinterSvc && !host.ports.has(631) && !host.ports.has(9100)) return null;
    const path = (svc?.txt?.rp || "ipp/print").replace(/^\//, "");
    const port = svc?.type === "_ipp._tcp" ? svc.port || 631 : 631;
    let st = null;
    for (const secure of [false, true]) {
      st = await printerStatus(host.ip, { port, path, secure }).catch(() => null);
      if (st) {
        st.secure = secure;
        break;
      }
    }
    const txt = anyPrinterSvc?.txt || {};
    const model = st?.model || txt.ty || txt.product?.replace(/[()]/g, "") || "Printer";
    const brand = txt.usb_mfg || model.split(/\s+/)[0];
    return [
      {
        id: `printer:${(st?.uuid || txt.uuid || host.mac || host.ip).toLowerCase()}`,
        driver: "printer",
        kind: "printer",
        brand: brand && brand.length < 20 ? brand.replace(/^HP$/i, "HP") : null,
        model,
        name: st?.name || anyPrinterSvc?.name || model,
        ip: host.ip,
        room: st?.location || null,
        ref: { ip: host.ip, port, path, secure: !!st?.secure, ipp: !!st },
        state: st ? { status: st.status, reasons: st.reasons, supplies: st.supplies, summary: supplySummary(st.supplies) } : { status: "unknown" },
        info: { firmware: st?.firmware || null, adminUrl: txt.adminurl || st?.moreInfo || null },
        webUrl: txt.adminurl || (host.ports.has(80) ? `http://${host.ip}/` : host.ports.has(443) ? `https://${host.ip}/` : null),
        actions: [...(st?.identify ? ["identify"] : []), "rename", "set_room"],
      },
    ];
  },

  async refresh(device) {
    if (!device.ref.ipp) return null;
    const st = await printerStatus(device.ref.ip, device.ref);
    return { state: { status: st.status, reasons: st.reasons, supplies: st.supplies, summary: supplySummary(st.supplies) } };
  },

  async act(device, action) {
    if (action !== "identify") throw unsupported(device, action);
    try {
      const { ip, port, path, secure } = device.ref;
      const body = encodeIpp(0x003c, `ipp://${ip}:${port}/${path}`, { extra: [attr(T.name, "requesting-user-name", ["Patch"])] });
      const res = await request({ url: `${secure ? "https" : "http"}://${ip}:${port}/${path}`, method: "POST", body, headers: { "content-type": "application/ipp" }, timeout: 4000 });
      const r = decodeIpp(res.body);
      if (r.status >= 0x0400) throw new DeviceError("This printer can't identify itself.");
      return done(`${device.name} should be beeping or flashing now.`);
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
