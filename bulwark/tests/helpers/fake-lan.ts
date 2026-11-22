// A pretend home network on loopback addresses (127.0.0.x), with the kinds of holes real devices
// have. Used by the tests and for demos: nothing here is reachable from outside this machine.

import * as http from "node:http";
import * as net from "node:net";
import type { UpnpMapping } from "../../src/core/types.ts";

export interface FakeLan {
  stop(): Promise<void>;
  ips: Record<string, string>;
  upnpLocation: string;
  mappings: UpnpMapping[];
}

const servers: { close(cb?: () => void): void }[] = [];

function tcp(ip: string, port: number, onConn: (s: net.Socket) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = net.createServer((c) => {
      c.on("error", () => {});
      onConn(c);
    });
    s.on("error", reject);
    s.listen(port, ip, () => resolve());
    servers.push(s);
  });
}

function httpServer(ip: string, port: number, handler: (req: http.IncomingMessage, body: string) => { status?: number; headers?: Record<string, string>; body: string }): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const r = handler(req, body);
        res.writeHead(r.status ?? 200, { "Content-Type": "text/html", ...r.headers });
        res.end(r.body);
      });
    });
    s.on("error", reject);
    s.listen(port, ip, () => resolve());
    servers.push(s);
  });
}

const page = (title: string, extra = "") => `<!doctype html><html><head><title>${title}</title></head><body>${extra}</body></html>`;

export async function startFakeLan(): Promise<FakeLan> {
  const ips = {
    router: "127.0.0.11",
    camera: "127.0.0.12",
    nas: "127.0.0.13",
    pc: "127.0.0.14",
    tvbox: "127.0.0.15",
    hub: "127.0.0.16",
    printer: "127.0.0.17",
    docker: "127.0.0.18",
  };

  // ── Router: plain-HTTP admin login, UPnP with two port forwards ──
  const mappings: UpnpMapping[] = [
    { remoteHost: "", externalPort: 3389, protocol: "TCP", internalPort: 3389, internalClient: ips.pc, enabled: true, description: "Remote Desktop", leaseDuration: 0 },
    { remoteHost: "", externalPort: 32400, protocol: "TCP", internalPort: 32400, internalClient: ips.nas, enabled: true, description: "Plex Media Server", leaseDuration: 0 },
  ];
  await httpServer(ips.router, 80, () => ({ headers: { Server: "mini_httpd/1.30" }, body: page("Router Login", `<form><input name=u><input type="password" name=p></form>`) }));
  const svc = "urn:schemas-upnp-org:service:WANIPConnection:1";
  const soap = (action: string, inner: string) =>
    `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="${svc}">${inner}</u:${action}Response></s:Body></s:Envelope>`;
  const fault = (code: number, desc: string) =>
    `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>${desc}</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`;
  const field = (body: string, name: string) => body.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1] ?? "";
  await httpServer(ips.router, 49152, (req, body) => {
    if (req.method === "GET" && req.url === "/rootDesc.xml") {
      return {
        headers: { "Content-Type": "text/xml" },
        body: `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><friendlyName>HomeHub 3000</friendlyName><manufacturer>Example Networks</manufacturer><modelName>HH3000</modelName><modelNumber>v2.1</modelNumber>
          <deviceList><device><deviceType>urn:schemas-upnp-org:device:WANDevice:1</deviceType><deviceList><device><deviceType>urn:schemas-upnp-org:device:WANConnectionDevice:1</deviceType>
          <serviceList><service><serviceType>${svc}</serviceType><serviceId>urn:upnp-org:serviceId:WANIPConn1</serviceId><controlURL>/ctl/IPConn</controlURL><eventSubURL>/evt/IPConn</eventSubURL><SCPDURL>/WANIPCn.xml</SCPDURL></service></serviceList>
          </device></deviceList></device></deviceList></device></root>`,
      };
    }
    if (req.method === "POST" && req.url === "/ctl/IPConn") {
      const action = String(req.headers["soapaction"] ?? "").replace(/"/g, "").split("#")[1];
      if (action === "GetExternalIPAddress") return { headers: { "Content-Type": "text/xml" }, body: soap(action, "<NewExternalIPAddress>203.0.113.7</NewExternalIPAddress>") };
      if (action === "GetGenericPortMappingEntry") {
        const m = mappings[Number(field(body, "NewPortMappingIndex"))];
        if (!m) return { status: 500, headers: { "Content-Type": "text/xml" }, body: fault(713, "SpecifiedArrayIndexInvalid") };
        return {
          headers: { "Content-Type": "text/xml" },
          body: soap(
            action,
            `<NewRemoteHost>${m.remoteHost}</NewRemoteHost><NewExternalPort>${m.externalPort}</NewExternalPort><NewProtocol>${m.protocol}</NewProtocol><NewInternalPort>${m.internalPort}</NewInternalPort><NewInternalClient>${m.internalClient}</NewInternalClient><NewEnabled>${m.enabled ? 1 : 0}</NewEnabled><NewPortMappingDescription>${m.description}</NewPortMappingDescription><NewLeaseDuration>${m.leaseDuration}</NewLeaseDuration>`,
          ),
        };
      }
      if (action === "DeletePortMapping") {
        const i = mappings.findIndex((m) => m.externalPort === Number(field(body, "NewExternalPort")) && m.protocol === field(body, "NewProtocol"));
        if (i === -1) return { status: 500, headers: { "Content-Type": "text/xml" }, body: fault(714, "NoSuchEntryInArray") };
        mappings.splice(i, 1);
        return { headers: { "Content-Type": "text/xml" }, body: soap(action, "") };
      }
      if (action === "AddPortMapping") {
        mappings.push({
          remoteHost: field(body, "NewRemoteHost"),
          externalPort: Number(field(body, "NewExternalPort")),
          protocol: field(body, "NewProtocol") === "UDP" ? "UDP" : "TCP",
          internalPort: Number(field(body, "NewInternalPort")),
          internalClient: field(body, "NewInternalClient"),
          enabled: field(body, "NewEnabled") === "1",
          description: field(body, "NewPortMappingDescription"),
          leaseDuration: Number(field(body, "NewLeaseDuration")),
        });
        return { headers: { "Content-Type": "text/xml" }, body: soap(action, "") };
      }
      return { status: 500, headers: { "Content-Type": "text/xml" }, body: fault(401, "Invalid Action") };
    }
    return { status: 404, body: "not found" };
  });

  // ── Camera: Telnet straight to a shell, Boa web login over HTTP, open RTSP stream, old Dropbear ──
  await tcp(ips.camera, 23, (s) => {
    s.write(Buffer.from([0xff, 0xfd, 0x18, 0xff, 0xfd, 0x20]));
    s.on("data", () => s.write("\r\n\r\nBusyBox v1.19.4 (2016-08-20) built-in shell (ash)\r\n# "));
  });
  await httpServer(ips.camera, 80, () => ({ headers: { Server: "Boa/0.94.14rc21" }, body: page("NETSurveillance WEB", `<input type="password" name="password">`) }));
  await tcp(ips.camera, 554, (s) =>
    s.on("data", (d) => {
      const t = d.toString();
      const cseq = t.match(/CSeq: (\d+)/)?.[1] ?? "1";
      if (t.startsWith("OPTIONS")) s.write(`RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\nServer: Rtsp Server/2.0\r\nPublic: OPTIONS, DESCRIBE, SETUP, PLAY\r\n\r\n`);
      else if (t.startsWith("DESCRIBE")) s.write(`RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\nContent-Type: application/sdp\r\nContent-Length: 20\r\n\r\nv=0\r\ns=Live Stream\r\n`);
    }),
  );
  await tcp(ips.camera, 22, (s) => {
    s.write("SSH-2.0-dropbear_2014.63\r\n");
    s.on("data", () => s.end());
  });

  // ── NAS: SMBv1 on, MySQL 5.7, open Redis, Synology-style web UI, Plex ──
  await tcp(ips.nas, 445, (s) =>
    s.once("data", () => {
      // An SMB1 NEGOTIATE response choosing dialect 0.
      const smb = Buffer.alloc(32 + 3 + 34);
      smb.writeUInt32BE(0xff534d42, 0);
      smb[4] = 0x72;
      smb[32] = 17; // word count
      smb.writeUInt16LE(0, 33); // dialect index
      const nb = Buffer.alloc(4);
      nb.writeUInt32BE(smb.length, 0);
      s.end(Buffer.concat([nb, smb]));
    }),
  );
  await tcp(ips.nas, 3306, (s) => {
    const ver = Buffer.from("5.7.44-log\0");
    const payload = Buffer.concat([Buffer.from([0x0a]), ver, Buffer.alloc(30)]);
    const head = Buffer.from([payload.length & 0xff, (payload.length >> 8) & 0xff, 0, 0]);
    s.write(Buffer.concat([head, payload]));
  });
  await tcp(ips.nas, 6379, (s) =>
    s.on("data", (d) => {
      const t = d.toString();
      if (t.startsWith("PING")) s.write("+PONG\r\n");
      else if (t.startsWith("INFO")) {
        const body = "# Server\r\nredis_version:6.0.16\r\nredis_mode:standalone\r\n";
        s.write("$" + body.length + "\r\n" + body + "\r\n");
      }
    }),
  );
  await httpServer(ips.nas, 5000, () => ({ headers: { Server: "nginx" }, body: page("Synology DiskStation") }));
  await httpServer(ips.nas, 32400, () => ({ status: 401, headers: { Server: "Plex Media Server" }, body: page("Unauthorized") }));

  // ── Windows PC: RDP without NLA, SMB (v1 off) ──
  await tcp(ips.pc, 3389, (s) =>
    s.once("data", () => s.end(Buffer.from([0x03, 0x00, 0x00, 0x13, 0x0e, 0xd0, 0x00, 0x00, 0x12, 0x34, 0x00, 0x02, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]))),
  );
  await tcp(ips.pc, 445, (s) => s.once("data", () => s.destroy()));
  await tcp(ips.pc, 139, () => {});

  // ── Android TV box: open ADB, Chromecast-style HTTP ──
  await tcp(ips.tvbox, 5555, (s) =>
    s.once("data", () => {
      const payload = Buffer.from("device::ro.product.name=tvbox;ro.product.model=X96 Max;\0");
      const h = Buffer.alloc(24);
      h.writeUInt32LE(0x4e584e43, 0);
      h.writeUInt32LE(0x01000000, 4);
      h.writeUInt32LE(4096, 8);
      h.writeUInt32LE(payload.length, 12);
      h.writeUInt32LE(0, 16);
      h.writeUInt32LE((0x4e584e43 ^ 0xffffffff) >>> 0, 20);
      s.end(Buffer.concat([h, payload]));
    }),
  );
  await httpServer(ips.tvbox, 8008, () => ({ body: page("Living Room TV") }));

  // ── Smart-home hub: anonymous MQTT, VNC without a password ──
  await tcp(ips.hub, 1883, (s) => s.once("data", () => s.write(Buffer.from([0x20, 0x02, 0x00, 0x00]))));
  await tcp(ips.hub, 5900, (s) => {
    s.write("RFB 003.008\n");
    s.once("data", () => s.write(Buffer.from([0x01, 0x01])));
  });
  await httpServer(ips.hub, 8123, () => ({ body: page("Home Assistant") }));

  // ── Printer: raw port 9100, web page without a login ──
  await tcp(ips.printer, 9100, () => {});
  await httpServer(ips.printer, 80, () => ({ headers: { Server: "HP HTTP Server; HP LaserJet Pro M404" }, body: page("HP LaserJet Pro M404") }));

  // ── Docker host: Docker API without TLS, open Elasticsearch, Memcached ──
  await httpServer(ips.docker, 2375, (req) =>
    req.url === "/version"
      ? { headers: { "Content-Type": "application/json", "Api-Version": "1.43" }, body: `{"Version":"24.0.7","ApiVersion":"1.43","Os":"linux"}` }
      : { status: 404, headers: { "Content-Type": "application/json", "Api-Version": "1.43" }, body: "{}" },
  );
  await httpServer(ips.docker, 9200, () => ({ headers: { "Content-Type": "application/json" }, body: `{"name":"node-1","cluster_name":"logs","version":{"number":"7.10.2"},"tagline":"You Know, for Search"}` }));
  await tcp(ips.docker, 11211, (s) => s.on("data", () => s.write("VERSION 1.6.21\r\n")));
  await tcp(ips.docker, 22, (s) => {
    s.write("SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\r\n");
    s.on("data", () => s.end());
  });

  return {
    ips,
    mappings,
    upnpLocation: `http://${ips.router}:49152/rootDesc.xml`,
    async stop() {
      await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
    },
  };
}
