// A pretend home network for demo mode and tests: ~20 devices on 127.0.10.x, each answering with
// its real protocol, plus mDNS and SSDP responders that advertise them.
//
//   node sim/simulator.mjs            run it on its own (Ctrl+C to stop)
//
// Linux and Windows route all of 127.0.0.0/8 to this computer. macOS only has 127.0.0.1, so add the
// extra addresses first: for i in $(seq 1 31); do sudo ifconfig lo0 alias 127.0.10.$i up; done
import dgram from "node:dgram";
import { fileURLToPath } from "node:url";
import { TYPE, decode, encodeResponse, joinName, reverseName } from "../src/net/dns-packet.mjs";
import { parseSsdpMessage } from "../src/net/ssdp.mjs";
import * as H from "./http-devices.mjs";
import * as S from "./socket-devices.mjs";
import * as T from "./tv-devices.mjs";
import { startPretendBrowser } from "./pretend-browser.mjs";

export async function startSimulator({ prefix = "127.0.10", multicast = false } = {}) {
  const ip = (n) => `${prefix}.${n}`;
  const servers = [];
  const add = (x) => servers.push(...(Array.isArray(x) ? x : [x]));

  const state = {
    hue: H.hueState(),
    roku: H.rokuState(),
    sonos: H.sonosState(ip(4)),
    router: H.routerState(),
    plug: H.shellyPlugState(),
    shelly1: H.shellyGen1State(),
    wled: H.wledState(),
    elgato: H.elgatoState(),
    ha: H.haState(),
    kasa: S.kasaState(),
    lifx: S.lifxState(),
    yeelight: S.yeelightState(),
    cast: S.castState(),
    printer: S.printerState(),
    samsung: T.samsungState(),
    lg: T.lgState(),
    firetv: T.fireTvState(),
    calendar: T.wirelessAndroidState(),
  };
  // Port forwards point at the simulated camera and Raspberry Pi.
  state.router.mappings[0].NewInternalClient = ip(23);
  state.router.mappings[1].NewInternalClient = ip(22);

  add(await H.httpServer(ip(1), 80, H.routerHandler(state.router, { ip: ip(1) })));
  add(await H.httpServer(ip(1), 5000, H.routerHandler(state.router, { ip: ip(1) })));
  add(await H.httpServer(ip(2), 80, H.hueHandler(state.hue, { ip: ip(2) })));
  add(await H.httpServer(ip(3), 8060, H.rokuHandler(state.roku)));
  add(await H.httpServer(ip(4), 1400, H.sonosHandler(state.sonos)));
  add(await H.httpServer(ip(5), 80, H.shellyGen2Handler(state.plug, { ip: ip(5) })));
  add(await H.httpServer(ip(6), 80, H.shellyGen1Handler(state.shelly1, { ip: ip(6) })));
  add(await H.httpServer(ip(7), 80, H.wledHandler(state.wled)));
  add(await H.httpServer(ip(8), 9123, H.elgatoHandler(state.elgato)));
  add(await S.kasaDevice(ip(9), state.kasa));
  add(await S.lifxDevice(ip(10), state.lifx));
  add(await S.yeelightDevice(ip(11), state.yeelight));
  add(await S.printerDevice(ip(12), state.printer));
  add(await S.castDevice(ip(13), state.cast));
  add(await H.httpServer(ip(14), 8123, H.haHandler(state.ha, { ip: ip(14), port: 8123 })));
  add(await S.openPorts(ip(20), [135, 139, 445, 3389]));
  add(await S.netbiosResponder(ip(20), "OFFICE-PC", "00:1a:2b:3c:4d:5e"));
  add(await S.openPorts(ip(21), [62078]));
  add(await S.openPorts(ip(22), [23, 80, 554], "IPCAM Web Client"));
  add(await S.openPorts(ip(23), [22, 32400]));
  // TVs and other devices that say exactly what they are.
  add(await T.samsungTv(ip(15), state.samsung));
  add(await T.lgTv(ip(16), state.lg));
  // Patch's own browser on the Fire TV shows pretend pages, unless a test puts a real Chrome
  // behind it (state.firetv.browser = { open }, see sim/chrome.mjs).
  const pretend = await startPretendBrowser();
  state.firetv.browser = pretend;
  add({ close: () => pretend.close() });
  add(await T.fireTv(ip(17), state.firetv));
  add(await T.playStation(ip(18)));
  // A wall calendar running Android, reachable once Wireless debugging is on and it has paired.
  add(await T.wirelessAndroid(ip(28), state.calendar));
  add(await S.openPorts(ip(19), [7000, 49152]));
  add(await S.openPorts(ip(24), [62078]));
  add(await S.openPorts(ip(25), [22, 445, 5900]));
  add(await T.spotifySpeaker(ip(26), 8200, { remoteName: "Bathroom Speaker", deviceType: "SPEAKER", brandDisplayName: "Bose", modelDisplayName: "Smart Speaker 500" }));
  add(await S.openPorts(ip(27), [8008]));
  add(await T.wsdResponder(ip(1), [{ ip: ip(22), uuid: "2419d68a-2dd2-21b2-a205-ec71dbe1a2b3", maker: "Reolink", model: "RLC-510A", location: "Driveway" }]));
  add(await T.youtubeApi(ip(1), 8099));

  const arp = [
    [1, "a0:40:a0:11:22:33"], [2, "00:17:88:2a:3b:4c"], [3, "c8:3a:6b:12:34:56"], [4, "48:a6:b8:f1:c2:d3"], [5, "a8:03:2a:b1:c2:d3"],
    [6, "c4:5b:be:6a:1b:2c"], [7, "a4:cf:12:aa:bb:cc"], [8, "3c:6a:9d:12:34:56"], [9, "50:c7:bf:12:34:56"], [10, "d0:73:d5:2a:bb:01"],
    [11, "04:cf:8c:15:24:3f"], [12, "30:05:5c:1a:2b:3c"], [13, "f8:0f:f9:5c:0a:7e"], [14, "dc:a6:32:9a:8b:7c"], [20, "00:1a:2b:3c:4d:5e"],
    [21, "9a:4c:01:22:33:44"], [22, "bc:51:fe:44:55:66"], [23, "b8:27:eb:4d:5e:6f"], [30, "10:2c:6b:00:11:22"], [31, "6e:12:ab:cd:ef:01"],
    [15, "64:1c:ae:12:34:56"], [16, "44:be:8b:0a:1b:2c"], [17, "f0:4f:7c:3a:2b:1c"], [18, "a4:b1:c2:d3:e4:f5"], [19, "f0:b3:ec:12:9a:7b"],
    [24, "2a:91:fe:61:0c:33"], [25, "f4:d4:88:5e:21:9c"], [26, "08:df:1f:55:66:77"], [27, "56:3e:91:aa:20:4d"], [28, "ae:3f:12:9b:44:20"],
  ].map(([n, mac]) => ({ ip: ip(n), mac, iface: "sim" }));

  // ── mDNS ──
  const services = [
    { type: "_hue._tcp", instance: "Philips Hue - 2A3B4C", host: "Philips-hue.local", ip: ip(2), port: 443, txt: { bridgeid: "001788fffe2a3b4c", modelid: "BSB002" } },
    { type: "_sonos._tcp", instance: "RINCON_48A6B8F1C2D301400@Kitchen", host: "Sonos-48A6B8F1C2D3.local", ip: ip(4), port: 1443, txt: { vers: "3", protovers: "1.24.1" } },
    { type: "_spotify-connect._tcp", instance: "Kitchen", host: "Sonos-48A6B8F1C2D3.local", ip: ip(4), port: 1400, txt: { cpath: "/spotifyzc", version: "1.0" } },
    { type: "_shelly._tcp", instance: "shellyplusplugs-a8032ab1c2d3", host: "shellyplusplugs-a8032ab1c2d3.local", ip: ip(5), port: 80, txt: { gen: "2", app: "PlugS", ver: "1.0.8" } },
    { type: "_http._tcp", instance: "shelly1-6A1B2C", host: "shelly1-6A1B2C.local", ip: ip(6), port: 80, txt: {} },
    { type: "_wled._tcp", instance: "wled-desk", host: "wled-desk.local", ip: ip(7), port: 80, txt: { mac: "a4cf12aabbcc" } },
    { type: "_elg._tcp", instance: "Elgato Key Light Air 0123", host: "elgato-key-light-air-0123.local", ip: ip(8), port: 9123, txt: { mf: "Elgato", dt: "200", id: "3C:6A:9D:12:34:56", md: "Elgato Key Light Air 20LAB9901", pv: "1.0" } },
    { type: "_ipp._tcp", instance: "Brother HL-L3270CDW series", host: "BRW30055C1A2B3C.local", ip: ip(12), port: 631, txt: { txtvers: "1", rp: "ipp/print", ty: "Brother HL-L3270CDW series", adminurl: `http://${ip(12)}/`, usb_MFG: "Brother", usb_MDL: "HL-L3270CDW series", UUID: "e3248000-80ce-11db-8000-30055c1a2b3c", Color: "T" } },
    { type: "_googlecast._tcp", instance: "Google-TV-Streamer-5c0a7e2bd1f84e5a9c3b2a1d0e9f8a7b", host: "5c0a7e2b-d1f8-4e5a-9c3b-2a1d0e9f8a7b.local", ip: ip(13), port: 8009, txt: { id: state.cast.id, cd: "B3B4E0C77AA5A3F1F7A1C3D0E9F8A7B1", rm: "", ve: "05", md: "Google TV Streamer", ic: "/setup/icon.png", fn: state.cast.name, ca: "4101", st: "1", bs: "FA8FCA123456", nf: "1", rs: "YouTube" } },
    { type: "_home-assistant._tcp", instance: "Home", host: "homeassistant.local", ip: ip(14), port: 8123, txt: { location_name: "Home", uuid: "9a8b7c6d5e4f40312a1b", version: "2026.11.2", internal_url: `http://${ip(14)}:8123`, base_url: `http://${ip(14)}:8123`, requires_api_password: "True" } },
    { type: "_companion-link._tcp", instance: "Kitchen iPad", host: "Kitchen-iPad.local", ip: ip(21), port: 49152, txt: { rpMd: "iPad13,1", rpVr: "600.70" } },
    { type: "_amzn-wplay._tcp", instance: "amzn.dmgr:7C3A2B1C9F0E4D5A", host: "amazon-7c3a2b1c.local", ip: ip(17), port: 33201, txt: { n: "Kids Room Fire TV", s: "G4N1AB1234567890", ad: "AFTKA", c: "FireTV", v: "1" } },
    { type: "_airplay._tcp", instance: "Den", host: "Den-Apple-TV.local", ip: ip(19), port: 7000, txt: { model: "AppleTV14,1", deviceid: "F0:B3:EC:12:9A:7B", features: "0x4A7FDFD5,0xBC177FDE", osvers: "18.1", srcvers: "800.20.3" } },
    { type: "_companion-link._tcp", instance: "Den", host: "Den-Apple-TV.local", ip: ip(19), port: 49152, txt: { rpMd: "AppleTV14,1", rpVr: "800.20.3", rpFl: "0x36782" } },
    { type: "_companion-link._tcp", instance: "Alex's iPhone", host: "Alexs-iPhone.local", ip: ip(24), port: 49153, txt: { rpMd: "iPhone15,2", rpVr: "600.70" } },
    { type: "_device-info._tcp", instance: "Alex's MacBook Pro", host: "Alexs-MacBook-Pro.local", ip: ip(25), port: 0, txt: { model: "MacBookPro18,3", osxvers: "24" } },
    { type: "_smb._tcp", instance: "Alex's MacBook Pro", host: "Alexs-MacBook-Pro.local", ip: ip(25), port: 445, txt: {} },
    { type: "_spotify-connect._tcp", instance: "Bathroom Speaker", host: "Bose-SM500-55667.local", ip: ip(26), port: 8200, txt: { CPath: "/zc", VERSION: "1.0", Stack: "SP" } },
    { type: "_workstation._tcp", instance: "raspberrypi [b8:27:eb:4d:5e:6f]", host: "raspberrypi.local", ip: ip(23), port: 9, txt: {} },
    { type: "_plexmediasvr._tcp", instance: "raspberrypi", host: "raspberrypi.local", ip: ip(23), port: 32400, txt: {} },
    // Android announces Wireless debugging while it's on, and its pairing window while that's open.
    { type: "_adb-tls-connect._tcp", instance: state.calendar.guid, host: "Android_5c0a7e2b.local", ip: ip(28), port: state.calendar.connectPort, txt: {}, when: () => state.calendar.announce && state.calendar.wireless },
    { type: "_adb-tls-pairing._tcp", instance: state.calendar.guid, host: "Android_5c0a7e2b.local", ip: ip(28), port: state.calendar.pairingPort, txt: {}, when: () => state.calendar.announce && state.calendar.pairingOpen },
  ];
  const fullName = (s) => joinName([s.instance, ...s.type.split("."), "local"]);
  const reverse = new Map([[reverseName(ip(21)), "Kitchen-iPad.local"], [reverseName(ip(23)), "raspberrypi.local"], [reverseName(ip(20)), "OFFICE-PC.local"], [reverseName(ip(27)), "Galaxy-S24-Ultra.local"], [reverseName(ip(28)), "Cozyla-Calendar-2.local"]]);
  const types = [...new Set(services.map((s) => s.type))];
  const recordsFor = (s) => ({
    srv: { name: fullName(s), type: TYPE.SRV, data: { priority: 0, weight: 0, port: s.port, target: s.host }, flush: true },
    txt: { name: fullName(s), type: TYPE.TXT, data: s.txt, flush: true },
    a: { name: s.host, type: TYPE.A, data: s.ip, flush: true },
  });

  const answer = (msg) => {
    let q;
    try {
      q = decode(msg);
    } catch {
      return null;
    }
    if (q.response) return null;
    const answers = [];
    const additionals = [];
    for (const { name, type } of q.questions) {
      const n = name.toLowerCase();
      if (n === "_services._dns-sd._udp.local" && (type === TYPE.PTR || type === TYPE.ANY)) {
        for (const t of types) answers.push({ name: "_services._dns-sd._udp.local", type: TYPE.PTR, data: `${t}.local` });
        continue;
      }
      if (reverse.has(n) && (type === TYPE.PTR || type === TYPE.ANY)) {
        answers.push({ name, type: TYPE.PTR, data: reverse.get(n), flush: true });
        continue;
      }
      for (const s of services) {
        if (s.when && !s.when()) continue;
        const r = recordsFor(s);
        if (n === `${s.type}.local` && (type === TYPE.PTR || type === TYPE.ANY)) {
          answers.push({ name: `${s.type}.local`, type: TYPE.PTR, data: fullName(s) });
          additionals.push(r.srv, r.txt, r.a);
        } else if (n === fullName(s).toLowerCase()) {
          if (type === TYPE.SRV || type === TYPE.ANY) answers.push(r.srv);
          if (type === TYPE.TXT || type === TYPE.ANY) answers.push(r.txt);
          additionals.push(r.a);
        } else if (n === s.host.toLowerCase() && (type === TYPE.A || type === TYPE.ANY)) answers.push(r.a);
      }
    }
    if (!answers.length) return null;
    const uniq = (list) => list.filter((x, i) => list.findIndex((y) => y.name === x.name && y.type === x.type && JSON.stringify(y.data) === JSON.stringify(x.data)) === i);
    return encodeResponse({ id: q.id, answers: uniq(answers), additionals: uniq(additionals) });
  };

  const mdnsSockets = [];
  const mdnsUnicast = dgram.createSocket({ type: "udp4", reuseAddr: true });
  mdnsUnicast.on("message", (m, r) => {
    const out = answer(m);
    if (out) mdnsUnicast.send(out, r.port, r.address);
  });
  await new Promise((r) => mdnsUnicast.bind(5353, ip(1), r));
  mdnsSockets.push(mdnsUnicast);

  // ── SSDP ──
  const ssdpDevices = [
    { sts: ["upnp:rootdevice", "urn:schemas-upnp-org:device:InternetGatewayDevice:1"], location: `http://${ip(1)}:5000/rootDesc.xml`, usn: "uuid:824ff22b-8c7d-41c5-a131-44a1b2c3d4e5", server: "Linux/4.1.27, UPnP/1.0, MiniUPnPd/2.1" },
    { sts: ["upnp:rootdevice", "urn:schemas-upnp-org:device:basic:1"], location: `http://${ip(2)}:80/description.xml`, usn: "uuid:2f402f80-da50-11e1-9b23-0017882a3b4c", server: "Hue/1.0 UPnP/1.0 IpBridge/1.67.0", extra: { "hue-bridgeid": "001788FFFE2A3B4C" } },
    { sts: ["roku:ecp", "upnp:rootdevice"], location: `http://${ip(3)}:8060/`, usn: "uuid:roku:ecp:YN00AB123456", server: "Roku/14.1.4 UPnP/1.0 Roku/14.1.4" },
    { sts: ["upnp:rootdevice", "urn:lge-com:service:webos-second-screen:1", "urn:dial-multiscreen-org:service:dial:1"], location: `http://${ip(16)}:1754/`, usn: "uuid:4c1d7e52-0b3f-4f43-a9e1-44be8b0a1b2c", server: "WebOS/6.0 UPnP/1.0 webOSTV/1.0" },
    { sts: ["upnp:rootdevice", "urn:schemas-upnp-org:device:ZonePlayer:1", "urn:schemas-upnp-org:device:MediaRenderer:1"], location: `http://${ip(4)}:1400/xml/device_description.xml`, usn: "uuid:RINCON_48A6B8F1C2D301400", server: "Linux UPnP/1.0 Sonos/80.1-55020 (ZPS18)", extra: { "X-RINCON-HOUSEHOLD": "Sonos_4f2a91" } },
  ];
  const ssdpReply = (d, st) =>
    Buffer.from(
      ["HTTP/1.1 200 OK", "CACHE-CONTROL: max-age=1800", "EXT:", `LOCATION: ${d.location}`, `SERVER: ${d.server}`, `ST: ${st}`, `USN: ${d.usn}::${st}`, ...Object.entries(d.extra || {}).map(([k, v]) => `${k}: ${v}`), "", ""].join("\r\n"),
    );
  const onSearch = (sock) => (m, r) => {
    const { start, headers } = parseSsdpMessage(m.toString());
    if (!/^M-SEARCH/i.test(start)) return;
    const st = headers.st || "";
    for (const d of ssdpDevices) {
      if (st === "ssdp:all") sock.send(ssdpReply(d, d.sts[d.sts.length > 1 ? 1 : 0]), r.port, r.address);
      else if (d.sts.includes(st)) sock.send(ssdpReply(d, st), r.port, r.address);
    }
  };
  const ssdpSock = dgram.createSocket({ type: "udp4", reuseAddr: true });
  ssdpSock.on("message", onSearch(ssdpSock));
  await new Promise((r) => ssdpSock.bind(1900, ip(1), r));
  mdnsSockets.push(ssdpSock);

  // Optional: also answer real multicast queries (used by tests of the multicast code path).
  if (multicast) {
    const m = dgram.createSocket({ type: "udp4", reuseAddr: true });
    m.on("message", (msg, r) => {
      const out = answer(msg);
      if (out) m.send(out, r.port, r.address);
    });
    await new Promise((r) => m.bind(5353, r));
    const s2 = dgram.createSocket({ type: "udp4", reuseAddr: true });
    s2.on("message", onSearch(s2));
    await new Promise((r) => s2.bind(1900, r));
    for (const [sock, group] of [[m, "224.0.0.251"], [s2, "239.255.255.250"]]) {
      try {
        sock.addMembership(group);
      } catch {
        /* no multicast-capable interface */
      }
    }
    mdnsSockets.push(m, s2);
  }

  const network = { iface: "simulated", address: ip(100), cidr: `${prefix}.0/24`, prefix: 24, broadcast: ip(255), gateway: ip(1), dns: [], mac: null, simulated: true };
  return {
    prefix,
    state,
    network,
    arpTable: async () => arp.map((e) => ({ ...e })),
    /** Scanner settings that point discovery at the simulator instead of the real network. */
    overrides: { network, arp: async () => arp.map((e) => ({ ...e })), mdnsTarget: ip(1), ssdpTarget: ip(1), wsdTarget: ip(1), broadcasts: [], multicastYeelight: false, skipReverseDns: true, youtubeBase: `http://${ip(1)}:8099/youtube/v3` },
    youtubeKey: "demo-youtube-key",
    async stop() {
      for (const s of [...servers, ...mdnsSockets]) {
        try {
          if (typeof s.close === "function") s.close();
        } catch {
          /* already closed */
        }
      }
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sim = await startSimulator();
  console.log(`Simulated home network running on ${sim.network.cidr}. Router ${sim.network.gateway}. Ctrl+C to stop.`);
}
