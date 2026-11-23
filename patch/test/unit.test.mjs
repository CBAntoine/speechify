// Parsers and protocol encoders, checked against real-world sample output and known byte layouts.
import test from "node:test";
import assert from "node:assert/strict";
import * as U from "../src/util.mjs";
import * as DNS from "../src/net/dns-packet.mjs";
import { parseXml, findFirst, textOf } from "../src/net/xml.mjs";
import { parseSsdpMessage, parseDescription, findService } from "../src/net/ssdp.mjs";
import { parseProcArp, parseBsdArp, parseWindowsArp, parseIpNeigh } from "../src/net/arp.mjs";
import { parseLinuxRoute, parseMacRoute, parseWindowsRoute } from "../src/net/interfaces.mjs";
import { encodeNbstatQuery, parseNbstatResponse, parsePingTimes, magicPacket } from "../src/net/probe.mjs";
import { parseIeeeCsv, parseWiresharkManuf, shortVendor } from "../src/net/oui.mjs";
import { parseNetshInterfaces, parseNetshNetworks, parseNmcli, parseSystemProfiler, channelAdvice } from "../src/net/wifi.mjs";
import { parseChallenge, digestHeader } from "../src/net/lanhttp.mjs";
import { encrypt, decrypt } from "../src/drivers/kasa.mjs";
import * as LIFX from "../src/drivers/lifx.mjs";
import { encodeCastMessage, decodeCastMessage } from "../src/drivers/cast.mjs";
import { encodeIpp, decodeIpp, humanReasons, supplySummary } from "../src/drivers/printer.mjs";
import { parseTrack } from "../src/drivers/sonos.mjs";
import { classify } from "../src/drivers/generic.mjs";
import { riskOf } from "../src/drivers/common.mjs";
import { Inventory, kindHints } from "../src/inventory.mjs";

test("IPv4 subnet maths", () => {
  const c = U.parseCidr("192.168.1.77/24");
  assert.equal(c.cidr, "192.168.1.0/24");
  assert.equal(U.intToIp(c.broadcast), "192.168.1.255");
  assert.equal(U.subnetHosts("192.168.1.0/24").length, 254);
  assert.equal(U.subnetHosts("10.0.0.0/16", { max: 1024, around: "10.0.5.9" }).length, 1024);
  assert.ok(U.subnetHosts("10.0.0.0/16", { max: 1024, around: "10.0.5.9" }).includes("10.0.5.9"));
  assert.ok(U.inCidr("172.20.3.4", "172.16.0.0/12"));
  assert.ok(U.isPrivateIPv4("100.72.1.1") && U.isCgnat("100.72.1.1"));
  assert.ok(!U.isPrivateIPv4("8.8.8.8"));
  assert.equal(U.prefixFromNetmask("255.255.252.0"), 22);
});

test("MAC addresses", () => {
  assert.equal(U.normalizeMac("0:17:88:a:b:c"), "00:17:88:0a:0b:0c");
  assert.equal(U.normalizeMac("A0-B1-C2-D3-E4-F5"), "a0:b1:c2:d3:e4:f5");
  assert.equal(U.normalizeMac("A8032AB1C2D3"), "a8:03:2a:b1:c2:d3");
  assert.equal(U.normalizeMac("ff:ff:ff:ff:ff:ff"), null);
  assert.ok(U.isRandomizedMac("9a:4c:01:22:33:44"));
  assert.ok(!U.isRandomizedMac("b8:27:eb:4d:5e:6f"));
});

test("spoken values: colours, white tones, percentages", () => {
  assert.deepEqual(U.parseColor("red"), [255, 0, 0]);
  assert.deepEqual(U.parseColor("#0f8"), [0, 255, 136]);
  assert.deepEqual(U.parseColor("light sky blue"), [90, 180, 255]);
  assert.equal(U.parseColor("constructor"), null);
  assert.equal(U.parseKelvin("warm"), 2700);
  assert.equal(U.parseKelvin("3500K"), 3500);
  assert.equal(U.parseKelvin("366"), 2732); // mireds
  assert.equal(U.parseKelvin("constructor"), null);
  assert.equal(U.parsePercent("half"), 50);
  assert.equal(U.parsePercent("35%"), 35);
  assert.equal(U.parsePercent("0.4"), 40);
  assert.equal(U.parsePercent("louder", 50), 65);
  assert.equal(U.parsePercent("constructor"), null);
  assert.equal(U.prettyHostname("Living-Room-TV.lan"), "Living Room TV");
  assert.equal(U.prettyHostname("DESKTOP-4F2K9AB.localdomain"), "DESKTOP-4F2K9AB");
  assert.equal(U.fuzzyPick("you tube", ["Netflix", "YouTube", "Hulu"]), "YouTube");
  assert.equal(U.fuzzyPick("disney", ["Netflix", "Disney Plus"]), "Disney Plus");
});

test("DNS-SD packets round-trip, including dots inside instance names", () => {
  const inst = DNS.joinName(["Kitchen.Speaker", "_airplay", "_tcp", "local"]);
  const pkt = DNS.encodeResponse({
    id: 7,
    answers: [{ name: "_airplay._tcp.local", type: DNS.TYPE.PTR, data: inst }],
    additionals: [
      { name: inst, type: DNS.TYPE.SRV, data: { port: 7000, target: "Kitchen.local" } },
      { name: inst, type: DNS.TYPE.TXT, data: { model: "AudioAccessory5,1", flag: true } },
      { name: "Kitchen.local", type: DNS.TYPE.A, data: "192.168.1.40" },
    ],
  });
  const m = DNS.decode(pkt);
  assert.equal(m.id, 7);
  assert.ok(m.response);
  assert.equal(m.answers[0].data, inst);
  assert.equal(DNS.instanceLabel(m.answers[0].data), "Kitchen.Speaker");
  assert.deepEqual(m.additionals[0].data, { priority: 0, weight: 0, port: 7000, target: "Kitchen.local" });
  assert.equal(m.additionals[1].data.kv.model, "AudioAccessory5,1");
  assert.equal(m.additionals[1].data.kv.flag, true);
  assert.equal(m.additionals[2].data, "192.168.1.40");
  const q = DNS.decode(DNS.encodeQuery([{ name: "_hue._tcp.local", type: DNS.TYPE.PTR, qu: true }]));
  assert.deepEqual(q.questions, [{ name: "_hue._tcp.local", type: DNS.TYPE.PTR, qu: true }]);
  assert.equal(DNS.reverseName("192.168.1.40"), "40.1.168.192.in-addr.arpa");
});

test("XML: namespaces, entities, CDATA and escaped DIDL metadata", () => {
  const doc = parseXml(`<?xml version="1.0"?><s:Envelope xmlns:s="x"><s:Body><u:R xmlns:u="y"><A>1 &amp; 2</A><B><![CDATA[<raw>]]></B></u:R></s:Body></s:Envelope>`);
  assert.equal(textOf(doc, "A"), "1 & 2");
  assert.equal(textOf(doc, "B"), "<raw>");
  assert.equal(findFirst(doc, "R").name, "u:R");
  const track = parseTrack(`<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"><item><dc:title>Dreams</dc:title><dc:creator>Fleetwood Mac</dc:creator></item></DIDL-Lite>`);
  assert.deepEqual(track, { title: "Dreams", artist: "Fleetwood Mac" });
});

test("SSDP replies and nested UPnP descriptions", () => {
  const { start, headers } = parseSsdpMessage("HTTP/1.1 200 OK\r\nLOCATION: http://192.168.1.1:5000/rootDesc.xml\r\nST: upnp:rootdevice\r\nUSN: uuid:abc::upnp:rootdevice\r\n\r\n");
  assert.match(start, /200 OK/);
  assert.equal(headers.location, "http://192.168.1.1:5000/rootDesc.xml");
  const desc = parseDescription(
    `<root><device><deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType><friendlyName>R</friendlyName><deviceList><device><deviceList><device><serviceList><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>ctl/IPConn</controlURL></service></serviceList></device></deviceList></device></deviceList></device></root>`,
    "http://192.168.1.1:5000/rootDesc.xml",
  );
  assert.equal(findService(desc, /WANIPConnection/).controlURL, "http://192.168.1.1:5000/ctl/IPConn");
});

test("ARP tables on Linux, macOS and Windows", () => {
  const linux = parseProcArp(`IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         a0:40:a0:11:22:33     *        wlan0
192.168.1.9      0x1         0x0         00:00:00:00:00:00     *        wlan0
192.168.1.20     0x1         0x2         00:17:88:2a:3b:4c     *        wlan0`);
  assert.deepEqual(linux.map((e) => e.ip), ["192.168.1.1", "192.168.1.20"]);
  assert.equal(parseIpNeigh("192.168.1.5 dev wlan0 lladdr b8:27:eb:4d:5e:6f REACHABLE\n192.168.1.6 dev wlan0  FAILED").length, 1);
  const mac = parseBsdArp(`? (192.168.1.1) at a0:40:a0:11:22:33 on en0 ifscope [ethernet]
? (192.168.1.7) at (incomplete) on en0 ifscope [ethernet]
hue.lan (192.168.1.20) at 0:17:88:2a:3b:4c on en0 ifscope [ethernet]`);
  assert.deepEqual(mac.map((e) => [e.ip, e.mac]), [["192.168.1.1", "a0:40:a0:11:22:33"], ["192.168.1.20", "00:17:88:2a:3b:4c"]]);
  const win = parseWindowsArp(`
Interface: 192.168.1.23 --- 0x7
  Internet Address      Physical Address      Type
  192.168.1.1           a0-40-a0-11-22-33     dynamic
  192.168.1.20          00-17-88-2a-3b-4c     dynamic
  192.168.1.255         ff-ff-ff-ff-ff-ff     static
  224.0.0.22            01-00-5e-00-00-16     static
  239.255.255.250       01-00-5e-7f-ff-fa     static`);
  assert.deepEqual(win.map((e) => e.ip), ["192.168.1.1", "192.168.1.20"]);
});

test("default gateway on Linux, macOS and Windows", () => {
  assert.deepEqual(parseLinuxRoute("Iface\tDestination\tGateway \tFlags\nwlan0\t00000000\t0101A8C0\t0003\nwlan0\t0001A8C0\t00000000\t0001"), { gateway: "192.168.1.1", iface: "wlan0" });
  assert.equal(parseMacRoute("   route to: default\ndestination: default\n    gateway: 192.168.50.1\n  interface: en0\n").gateway, "192.168.50.1");
  assert.equal(parseWindowsRoute("Network Destination        Netmask          Gateway       Interface  Metric\n          0.0.0.0          0.0.0.0      192.168.1.1     192.168.1.23     35\n          0.0.0.0          0.0.0.0      10.8.0.1       10.8.0.5     281\n").gateway, "192.168.1.1");
});

test("NetBIOS status query and reply", () => {
  const q = encodeNbstatQuery(0x1234);
  assert.equal(q.length, 50);
  assert.equal(q.subarray(13, 45).toString(), "CK" + "A".repeat(30));
  const entry = (n, suffix, group) => {
    const b = Buffer.alloc(18, 0x20);
    b.write(n, 0, "latin1");
    b[15] = suffix;
    b.writeUInt16BE(group ? 0x8400 : 0x0400, 16);
    return b;
  };
  const rdata = Buffer.concat([Buffer.from([2]), entry("OFFICE-PC", 0, false), entry("WORKGROUP", 0, true), Buffer.from([0, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e]), Buffer.alloc(40)]);
  const meta = Buffer.alloc(10);
  meta.writeUInt16BE(0x21, 0);
  meta.writeUInt16BE(1, 2);
  meta.writeUInt16BE(rdata.length, 8);
  const r = parseNbstatResponse(Buffer.concat([Buffer.from([0x12, 0x34, 0x84, 0, 0, 0, 0, 1, 0, 0, 0, 0]), q.subarray(12, 46), meta, rdata]));
  assert.equal(r.name, "OFFICE-PC");
  assert.equal(r.workgroup, "WORKGROUP");
  assert.equal(r.mac, "00:1a:2b:3c:4d:5e");
});

test("ping output from each OS", () => {
  assert.deepEqual(parsePingTimes("64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=3.42 ms\n64 bytes from 192.168.1.1: icmp_seq=2 ttl=64 time=2.9 ms"), [3.42, 2.9]);
  assert.deepEqual(parsePingTimes("Reply from 192.168.1.1: bytes=32 time=4ms TTL=64\nReply from 192.168.1.1: bytes=32 time<1ms TTL=64"), [4, 1]);
  assert.equal(magicPacket("00:1a:2b:3c:4d:5e").length, 102);
});

test("HTTP Digest answers (Shelly Gen2 uses SHA-256)", () => {
  const ch = parseChallenge('Digest qop="auth", realm="shellyplus1-a8032ab1c2d3", nonce="1700000000", algorithm=SHA-256');
  assert.equal(ch.realm, "shellyplus1-a8032ab1c2d3");
  const h = digestHeader(ch, { method: "POST", url: "http://192.168.1.5/rpc", username: "admin", password: "secret" });
  assert.match(h, /^Digest username="admin", realm="shellyplus1-a8032ab1c2d3", nonce="1700000000", uri="\/rpc", algorithm=SHA-256, response="[0-9a-f]{64}", qop=auth, nc=00000001, cnonce="[0-9a-f]{16}"$/);
});

test("TP-Link Kasa cipher matches the published byte stream", () => {
  const enc = encrypt('{"system":{"get_sysinfo":{}}}');
  assert.equal(enc.subarray(0, 4).toString("hex"), "d0f281f8");
  assert.equal(decrypt(enc), '{"system":{"get_sysinfo":{}}}');
});

test("LIFX discovery packet matches the documented layout", () => {
  const pkt = LIFX.encode({ type: LIFX.MSG.GetService, source: 0, sequence: 0 });
  assert.equal(pkt.toString("hex"), "24000034" + "00".repeat(28) + "02000000");
  const set = LIFX.encode({ type: LIFX.MSG.SetColor, target: "d0:73:d5:2a:bb:01", payload: LIFX.setColorPayload({ hue: 100, saturation: 200, brightness: 300, kelvin: 3500 }), source: 42, sequence: 9, resRequired: true });
  const m = LIFX.decode(set);
  assert.equal(m.target, "d0:73:d5:2a:bb:01");
  assert.equal(m.source, 42);
  assert.equal(m.sequence, 9);
  assert.equal(m.type, LIFX.MSG.SetColor);
  assert.equal(m.payload.readUInt16LE(7), 3500);
  assert.equal(set[2] & 0x20, 0, "unicast packets are not tagged");
});

test("Cast v2 frames round-trip", () => {
  const frame = encodeCastMessage({ namespace: "urn:x-cast:com.google.cast.receiver", data: { type: "GET_STATUS", requestId: 1 } });
  assert.equal(frame.readUInt32BE(0), frame.length - 4);
  assert.equal(frame.subarray(4, 7).toString("hex"), "080012");
  const m = decodeCastMessage(frame.subarray(4));
  assert.equal(m.source, "sender-0");
  assert.equal(m.destination, "receiver-0");
  assert.equal(JSON.parse(m.data).type, "GET_STATUS");
});

test("IPP request and reply", () => {
  const req = encodeIpp(0x000b, "ipp://192.168.1.12:631/ipp/print");
  assert.equal(req.readUInt16BE(2), 0x000b);
  assert.equal(req[8], 0x01);
  assert.equal(req.at(-1), 0x03);
  const a = (tag, name, v) => {
    const n = Buffer.from(name);
    const val = typeof v === "number" ? Buffer.from([0, 0, 0, v]) : Buffer.from(v);
    return Buffer.concat([Buffer.from([tag, 0, n.length]), n, Buffer.from([0, val.length]), val]);
  };
  const more = (tag, v) => Buffer.concat([Buffer.from([tag, 0, 0, 0, 4]), Buffer.from([0, 0, 0, v])]);
  const reply = Buffer.concat([Buffer.from([2, 0, 0, 0, 0, 0, 0, 1, 0x04]), a(0x42, "marker-names", "Black"), a(0x21, "marker-levels", 7), more(0x21, 9), a(0x23, "printer-state", 3), Buffer.from([0x03])]);
  const r = decodeIpp(reply);
  assert.equal(r.status, 0);
  assert.deepEqual(r.attributes["marker-levels"], [7, 9]);
  assert.deepEqual(humanReasons(["media-empty-error", "toner-low-report", "none"]), ["out of paper", "toner low"]);
  assert.equal(supplySummary([{ name: "Black Toner", level: 8 }, { name: "Cyan Toner", level: 64 }]), "Black 8%, Cyan 64%");
});

test("WiFi details on Windows, Linux and macOS", () => {
  const w = parseNetshInterfaces(`    Name                   : Wi-Fi
    SSID                   : HomeNet
    Radio type             : 802.11ax
    Authentication         : WPA3-Personal
    Band                   : 2.4 GHz
    Channel                : 6
    Receive rate (Mbps)    : 286.8
    Signal                 : 52%`);
  assert.equal(w.ssid, "HomeNet");
  assert.equal(w.signalPct, 52);
  assert.equal(w.rssi, -74);
  assert.equal(w.channel, 6);
  const nets = parseNetshNetworks(`SSID 1 : HomeNet
    Network type            : Infrastructure
    BSSID 1                 : aa:bb:cc:dd:ee:01
         Signal             : 90%
         Band               : 5 GHz
         Channel            : 44
SSID 2 : Neighbour
    BSSID 1                 : aa:bb:cc:dd:ee:02
         Signal             : 70%
         Channel            : 6`);
  assert.deepEqual(nets.map((n) => [n.ssid, n.channel, n.band]), [["HomeNet", 44, "5 GHz"], ["Neighbour", 6, "2.4 GHz"]]);
  const nm = parseNmcli("yes:HomeNet:64:6:2437 MHz:270 Mbit/s:WPA2\nno:Neighbour:80:6:2437 MHz:130 Mbit/s:WPA2\nno:Other\\:Net:40:1:2412 MHz:65 Mbit/s:WPA2\nno:FarAway:30:11:2462 MHz:65 Mbit/s:WPA2");
  assert.equal(nm.ssid, "HomeNet");
  assert.equal(nm.neighbors[1].ssid, "Other:Net");
  const advice = channelAdvice({ ...nm, neighbors: [...nm.neighbors, { channel: 6, band: "2.4 GHz", signalPct: 90 }, { channel: 7, band: "2.4 GHz", signalPct: 60 }] });
  assert.equal(advice.channel, 6);
  assert.ok(advice.competing >= 3);
  assert.equal(advice.better, 1); // channel 7 overlaps 11, so 1 is the quietest
  const mac = parseSystemProfiler({ SPAirPortDataType: [{ spairport_airport_interfaces: [{ _name: "en0", spairport_current_network_information: { _name: "HomeNet", spairport_network_channel: "149 (5GHz, 80MHz)", spairport_signal_noise: "-61 dBm / -94 dBm", spairport_network_phymode: "802.11ax", spairport_network_rate: 1200 }, spairport_airport_other_local_wireless_networks: [{ _name: "Neighbour", spairport_network_channel: "6 (2GHz, 20MHz)", spairport_signal_noise: "-70 dBm / -90 dBm" }] }] }] });
  assert.equal(mac.channel, 149);
  assert.equal(mac.band, "5 GHz");
  assert.equal(mac.rssi, -61);
  assert.equal(mac.neighbors[0].band, "2.4 GHz");
});

test("manufacturer registries and short names", () => {
  const ieee = parseIeeeCsv(`Registry,Assignment,Organization Name,Organization Address\nMA-L,001788,"Philips Lighting BV","High Tech Campus 45 Eindhoven NL"\nMA-L,B827EB,Raspberry Pi Foundation,Mitchell Wood House Caldecote GB\nMA-M,1C8259A,Some Small Co,Street`);
  assert.deepEqual(ieee, { "001788": "Philips Lighting", b827eb: "Raspberry Pi" });
  const ws = parseWiresharkManuf("# comment\n00:0E:58\tSonos\tSonos, Inc.\n00:1B:C5:00:00:00/36\tX\tY\n24:0A:C4\tEspressi\tEspressif Inc.");
  assert.deepEqual(ws, { "000e58": "Sonos", "240ac4": "Espressif" });
  assert.equal(shortVendor("TP-LINK TECHNOLOGIES CO.,LTD."), "TP-Link");
  assert.equal(shortVendor("Hangzhou Hikvision Digital Technology Co.,Ltd."), "Hikvision");
  assert.equal(shortVendor("AzureWave Technology Inc."), "AzureWave");
});

test("guessing what an unidentified device is", () => {
  const host = (over) => ({ ip: "192.168.1.9", mac: null, vendor: null, randomMac: false, hostnames: new Set(), ports: new Set(), mdns: [], ssdp: [], udp: {}, http: {}, isGateway: false, ...over });
  assert.equal(classify(host({ ports: new Set([62078]) })).kind, "phone");
  assert.equal(classify(host({ ports: new Set([3389, 445]) })).kind, "computer");
  assert.equal(classify(host({ ports: new Set([554, 80]) })).kind, "camera");
  assert.equal(classify(host({ vendor: "Raspberry Pi", ports: new Set([22]) })).model, "Raspberry Pi");
  assert.equal(classify(host({ mdns: [{ type: "_companion-link._tcp", txt: { rpmd: "iPhone15,2" } }] })).kind, "phone");
  assert.equal(classify(host({ mdns: [{ type: "_hap._tcp", txt: { ci: "5", md: "Nanoleaf" } }] })).kind, "light");
  assert.equal(classify(host({ randomMac: true })).kind, "personal");
});

test("which actions need a spoken yes first", () => {
  assert.ok(riskOf({ name: "Heater", kind: "plug", state: { on: true } }, "turn_off"));
  assert.equal(riskOf({ name: "Heater", kind: "plug", state: { on: false } }, "toggle"), null);
  assert.equal(riskOf({ name: "Porch", kind: "switch" }, "turn_off"), null);
  assert.equal(riskOf({ name: "Lamp", kind: "light" }, "turn_off"), null);
  assert.ok(riskOf({ name: "Door", kind: "lock" }, "unlock"));
  assert.ok(riskOf({ name: "Garage", kind: "garage" }, "open"));
  assert.equal(riskOf({ name: "Blinds", kind: "cover" }, "open"), null);
  assert.ok(riskOf({ name: "Plug", kind: "plug" }, "reboot"));
});

test("turning spoken names into devices", () => {
  const store = { savedDevices: [], data: { meta: { "x:tv": { name: "Big Screen" } }, credentials: {}, history: {} }, saveDevices() {}, save() {} };
  const inv = new Inventory(store);
  const add = (id, name, kind, room) => inv.upsert({ id, name, kind, room, driver: "test", actions: ["turn_on"] });
  add("hue:room:1", "Kitchen", "room", "Kitchen");
  add("hue:l1", "Kitchen 1", "light", "Kitchen");
  add("hue:l2", "Kitchen 2", "light", "Kitchen");
  add("sonos:1", "Kitchen", "speaker", "Kitchen");
  add("lifx:1", "Bedroom Lamp", "light");
  add("hue:l3", "Living room lamp", "light", "Living room");
  add("x:tv", "Roku TV", "tv", "Living room");
  assert.equal(inv.resolve("kitchen lights").device.id, "hue:room:1");
  assert.equal(inv.resolve("the kitchen speaker").device.id, "sonos:1");
  assert.equal(inv.resolve("kitchen 2").device.id, "hue:l2");
  assert.equal(inv.resolve("lamp").ambiguous.length, 2);
  assert.equal(inv.resolve("bedroom lamp").device.id, "lifx:1");
  assert.equal(inv.resolve("big screen").device.id, "x:tv");
  assert.equal(inv.resolve("living room tv").device.id, "x:tv");
  assert.ok(inv.resolve("garage door").none);
  assert.ok(inv.resolve("bedroom speaker").none, "a light is never accepted when a speaker was asked for");
  assert.deepEqual(inv.findMany({ kind: "lights", room: "kitchen" }).map((d) => d.id).sort(), ["hue:l1", "hue:l2"]);
  assert.deepEqual([...kindHints("turn off the kitchen lights").kinds], ["light"]);
});
