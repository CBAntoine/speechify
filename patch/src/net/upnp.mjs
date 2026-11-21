// UPnP SOAP actions (volume on Sonos and TVs, play/pause, router port-forward listings).
import { request } from "./lanhttp.mjs";
import { escapeXml, findFirst, parseXml, textOf } from "./xml.mjs";

export class UpnpError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export function soapEnvelope(serviceType, action, args = {}) {
  const inner = Object.entries(args)
    .map(([k, v]) => `<${k}>${escapeXml(v ?? "")}</${k}>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${serviceType}">${inner}</u:${action}></s:Body></s:Envelope>`
  );
}

/** Calls an action and returns its output arguments as { Name: "value" }. Throws UpnpError on a SOAP fault. */
export async function soap(controlURL, serviceType, action, args = {}, { timeout = 4000 } = {}) {
  const res = await request({
    url: controlURL,
    method: "POST",
    timeout,
    headers: { "content-type": 'text/xml; charset="utf-8"', soapaction: `"${serviceType}#${action}"` },
    body: soapEnvelope(serviceType, action, args),
  });
  const doc = parseXml(res.text());
  if (res.status >= 400 || findFirst(doc, "Fault")) {
    const code = textOf(doc, "errorCode");
    const desc = textOf(doc, "errorDescription") || textOf(doc, "faultstring") || `HTTP ${res.status}`;
    throw new UpnpError(`${action} failed: ${desc}${code ? ` (${code})` : ""}`, code ? Number(code) : res.status);
  }
  const out = {};
  const resp = findFirst(doc, `${action}Response`);
  for (const c of resp?.children || []) out[c.local] = c.text.trim();
  return out;
}
