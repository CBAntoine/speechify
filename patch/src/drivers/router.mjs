// The router (default gateway). With UPnP IGD switched on it reports its internet connection and
// lists the port forwards apps have opened, which can be closed from here.
import { findService } from "../net/ssdp.mjs";
import { soap, UpnpError } from "../net/upnp.mjs";
import { formatDuration, fuzzyPick, isCgnat, isPrivateIPv4 } from "../util.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";

const WAN = /WAN(IP|PPP)Connection/;

export async function portMappings(svc, max = 64) {
  const out = [];
  for (let i = 0; i < max; i++) {
    try {
      const m = await soap(svc.controlURL, svc.serviceType, "GetGenericPortMappingEntry", { NewPortMappingIndex: i }, { timeout: 2500 });
      out.push({
        protocol: m.NewProtocol,
        externalPort: Number(m.NewExternalPort),
        internalPort: Number(m.NewInternalPort),
        internalClient: m.NewInternalClient,
        description: m.NewPortMappingDescription || "",
        enabled: m.NewEnabled !== "0",
        remoteHost: m.NewRemoteHost || "",
        lease: Number(m.NewLeaseDuration) || 0,
      });
    } catch (err) {
      if (err instanceof UpnpError) break; // 713 SpecifiedArrayIndexInvalid = end of list
      break;
    }
  }
  return out;
}

async function wanInfo(desc) {
  const svc = findService(desc, WAN);
  if (!svc?.controlURL) return null;
  const common = findService(desc, /WANCommonInterfaceConfig/);
  const call = (s, a, args = {}) => soap(s.controlURL, s.serviceType, a, args, { timeout: 2500 }).catch(() => null);
  const [ext, status, link, sent, recv] = await Promise.all([
    call(svc, "GetExternalIPAddress"),
    call(svc, "GetStatusInfo"),
    common ? call(common, "GetCommonLinkProperties") : null,
    common ? call(common, "GetTotalBytesSent") : null,
    common ? call(common, "GetTotalBytesReceived") : null,
  ]);
  const externalIp = ext?.NewExternalIPAddress || null;
  return {
    svc: { controlURL: svc.controlURL, serviceType: svc.serviceType },
    externalIp,
    externalIsPrivate: externalIp ? isPrivateIPv4(externalIp) : null,
    cgnat: externalIp ? isCgnat(externalIp) : null,
    connection: status?.NewConnectionStatus || null,
    uptimeSec: status?.NewUptime ? Number(status.NewUptime) : null,
    linkDownMbps: link?.NewLayer1DownstreamMaxBitRate ? Math.round(Number(link.NewLayer1DownstreamMaxBitRate) / 1e6) : null,
    linkUpMbps: link?.NewLayer1UpstreamMaxBitRate ? Math.round(Number(link.NewLayer1UpstreamMaxBitRate) / 1e6) : null,
    accessType: link?.NewWANAccessType || null,
    totalSentGB: sent?.NewTotalBytesSent ? Math.round(Number(sent.NewTotalBytesSent) / 1e8) / 10 : null,
    totalReceivedGB: recv?.NewTotalBytesReceived ? Math.round(Number(recv.NewTotalBytesReceived) / 1e8) / 10 : null,
  };
}

function mappingLabel(m) {
  return `${m.protocol} ${m.externalPort} → ${m.internalClient}:${m.internalPort}${m.description ? ` (${m.description})` : ""}`;
}

export default {
  id: "router",
  label: "Router",

  async detect(host) {
    const igd = host.ssdp.find((r) => /InternetGatewayDevice/i.test(`${r.desc?.deviceType} ${r.st}`) && r.desc);
    if (!host.isGateway && !igd) return null;
    const desc = igd?.desc || null;
    const wan = desc ? await wanInfo(desc) : null;
    const mappings = wan ? await portMappings(wan.svc) : [];
    const title = host.http?.[80]?.title || host.http?.[443]?.title || null;
    const brand = desc?.manufacturer?.replace(/,?\s*(inc|ltd|corp|corporation|co)\.?$/i, "") || host.vendor || (title && title.length < 30 ? title : null);
    const friendly = desc?.friendlyName && !/^(router|gateway|wireless router|internet gateway device|igd)$/i.test(desc.friendlyName) ? desc.friendlyName : null;
    return [
      {
        id: `router:${(host.mac || host.ip).replace(/:/g, "")}`,
        driver: "router",
        kind: host.isGateway ? "router" : "network",
        brand: brand || null,
        model: desc?.modelName || desc?.modelNumber || null,
        name: friendly || (brand ? `${brand} router` : "Router"),
        ip: host.ip,
        ref: { ip: host.ip, wan: wan?.svc || null },
        state: wan
          ? { connection: wan.connection, uptime: wan.uptimeSec != null ? formatDuration(wan.uptimeSec) : null, portForwards: mappings.length }
          : {},
        info: {
          upnp: !!wan,
          externalIp: wan?.externalIp || null,
          externalIsPrivate: wan?.externalIsPrivate ?? null,
          cgnat: wan?.cgnat ?? null,
          linkDownMbps: wan?.linkDownMbps ?? null,
          linkUpMbps: wan?.linkUpMbps ?? null,
          accessType: wan?.accessType || null,
          totalReceivedGB: wan?.totalReceivedGB ?? null,
          portForwards: mappings,
        },
        webUrl: desc?.presentationURL || (host.ports.has(80) ? `http://${host.ip}/` : host.ports.has(443) ? `https://${host.ip}/` : `http://${host.ip}/`),
        actions: [...(wan ? ["remove_port_forward"] : []), "rename", "set_room"],
      },
    ];
  },

  async refresh(device) {
    if (!device.ref.wan) return null;
    const mappings = await portMappings(device.ref.wan);
    return { info: { ...device.info, portForwards: mappings }, state: { ...device.state, portForwards: mappings.length } };
  },

  async act(device, action, value) {
    if (action !== "remove_port_forward") throw unsupported(device, action);
    try {
      const svc = device.ref.wan;
      if (!svc) throw new DeviceError("This router doesn't expose its port forwards (UPnP is off), so I can't change them from here.");
      const mappings = await portMappings(svc);
      if (!mappings.length) return done("There are no automatic port forwards open on the router.");
      const q = String(need(value, "port forward"));
      const port = Number(q.match(/\b(\d{2,5})\b/)?.[1]);
      const proto = /\budp\b/i.test(q) ? "UDP" : /\btcp\b/i.test(q) ? "TCP" : null;
      const m =
        mappings.find((x) => x.externalPort === port && (!proto || x.protocol === proto)) ||
        fuzzyPick(q, mappings.map((x) => ({ ...x, name: `${x.description} ${x.protocol} ${x.externalPort}` })));
      if (!m) throw new DeviceError(`No port forward matches "${q}". Open ones: ${mappings.map(mappingLabel).join("; ")}.`);
      await soap(svc.controlURL, svc.serviceType, "DeletePortMapping", { NewRemoteHost: m.remoteHost || "", NewExternalPort: m.externalPort, NewProtocol: m.protocol });
      const left = mappings.filter((x) => !(x.externalPort === m.externalPort && x.protocol === m.protocol));
      return done(`Closed ${mappingLabel(m)}.`, { info: { ...device.info, portForwards: left }, state: { ...device.state, portForwards: left.length } });
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};

export { mappingLabel };
