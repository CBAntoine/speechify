// Talks to a router's UPnP Internet Gateway service: reads its port forwards, and removes or
// restores one when you ask. These are the forwards apps and malware create without asking you.

import type { UpnpMapping } from "../core/types.ts";
import { isPrivate } from "./scope.ts";
import { httpPost } from "./tcp.ts";

export const WAN_SERVICES = /urn:schemas-upnp-org:service:WAN(IP|PPP)Connection:\d/;

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
const xmlUnescape = (s: string) => s.replace(/&(lt|gt|amp|apos|quot);/g, (_, e) => ({ lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' })[e as "lt"]!);

export interface SoapResult {
  ok: boolean;
  status: number;
  fields: Record<string, string>;
  fault?: { code: string; description: string };
}

/** Only routers on private addresses: Bulwark never sends UPnP commands across the internet. */
function checkControlUrl(controlUrl: string): URL {
  const url = new URL(controlUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unexpected UPnP control URL.");
  if (!isPrivate(url.hostname)) throw new Error("Bulwark only talks UPnP to routers on your local network.");
  return url;
}

export async function soapCall(controlUrl: string, serviceType: string, action: string, args: Record<string, string | number>, timeoutMs = 5000): Promise<SoapResult> {
  const url = checkControlUrl(controlUrl);
  const body =
    `<?xml version="1.0"?>\r\n<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    `<s:Body><u:${action} xmlns:u="${xmlEscape(serviceType)}">` +
    Object.entries(args).map(([k, v]) => `<${k}>${xmlEscape(String(v))}</${k}>`).join("") +
    `</u:${action}></s:Body></s:Envelope>\r\n`;
  const res = await httpPost(url, body, { "Content-Type": 'text/xml; charset="utf-8"', SOAPAction: `"${serviceType}#${action}"` }, timeoutMs);
  if (!res) return { ok: false, status: 0, fields: {} };
  const fields: Record<string, string> = {};
  const inner = res.body.match(new RegExp(`<(?:\\w+:)?${action}Response[^>]*>([\\s\\S]*?)</(?:\\w+:)?${action}Response>`, "i"))?.[1] ?? "";
  for (const m of inner.matchAll(/<(\w+)>([^<]*)<\/\1>/g)) fields[m[1]] = xmlUnescape(m[2]);
  for (const m of inner.matchAll(/<(\w+)\s*\/>/g)) fields[m[1]] = "";
  let fault: SoapResult["fault"];
  if (res.status >= 400 || /Fault>/.test(res.body)) {
    fault = {
      code: res.body.match(/<errorCode>(\d+)<\/errorCode>/)?.[1] ?? String(res.status),
      description: res.body.match(/<errorDescription>([^<]*)<\/errorDescription>/)?.[1] ?? res.statusText,
    };
  }
  return { ok: res.status === 200 && !fault, status: res.status, fields, fault };
}

export async function externalIp(controlUrl: string, serviceType: string): Promise<string | undefined> {
  const r = await soapCall(controlUrl, serviceType, "GetExternalIPAddress", {});
  return r.ok ? r.fields.NewExternalIPAddress || undefined : undefined;
}

export async function listMappings(controlUrl: string, serviceType: string, max = 128): Promise<UpnpMapping[]> {
  const out: UpnpMapping[] = [];
  for (let i = 0; i < max; i++) {
    const r = await soapCall(controlUrl, serviceType, "GetGenericPortMappingEntry", { NewPortMappingIndex: i });
    if (!r.ok) break; // 713 SpecifiedArrayIndexInvalid marks the end of the list
    const f = r.fields;
    out.push({
      remoteHost: f.NewRemoteHost ?? "",
      externalPort: Number(f.NewExternalPort),
      protocol: (f.NewProtocol ?? "TCP").toUpperCase() === "UDP" ? "UDP" : "TCP",
      internalPort: Number(f.NewInternalPort),
      internalClient: f.NewInternalClient ?? "",
      enabled: f.NewEnabled !== "0",
      description: f.NewPortMappingDescription ?? "",
      leaseDuration: Number(f.NewLeaseDuration) || 0,
    });
  }
  return out;
}

export async function deleteMapping(controlUrl: string, serviceType: string, m: UpnpMapping): Promise<void> {
  const r = await soapCall(controlUrl, serviceType, "DeletePortMapping", {
    NewRemoteHost: m.remoteHost,
    NewExternalPort: m.externalPort,
    NewProtocol: m.protocol,
  });
  if (!r.ok) throw new Error(`The router refused to remove the forward${r.fault ? ` (${r.fault.code} ${r.fault.description})` : ""}.`);
}

export async function addMapping(controlUrl: string, serviceType: string, m: UpnpMapping): Promise<void> {
  const r = await soapCall(controlUrl, serviceType, "AddPortMapping", {
    NewRemoteHost: m.remoteHost,
    NewExternalPort: m.externalPort,
    NewProtocol: m.protocol,
    NewInternalPort: m.internalPort,
    NewInternalClient: m.internalClient,
    NewEnabled: m.enabled ? 1 : 0,
    NewPortMappingDescription: m.description,
    NewLeaseDuration: m.leaseDuration,
  });
  if (!r.ok) throw new Error(`The router refused to restore the forward${r.fault ? ` (${r.fault.code} ${r.fault.description})` : ""}.`);
}
