// The TV protocols and identification helpers: WebSocket frames, ADB messages and keys, YouTube
// links, channel words, model-code tables and the "what exactly is it?" logic.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { encodeFrame, FrameParser, OP, acceptKey } from "../src/net/websocket.mjs";
import { CMD, MessageParser, SHA1_PREFIX, androidPublicKey, encodeMessage, newAdbKey, parseAndroidPublicKey, parseBanner, shellQuote, signToken } from "../src/net/adb.mjs";
import { formatIsoDuration, videoIdFrom, webSearchUrl, websiteUrl, describeResults } from "../src/net/youtube.mjs";
import { appleModel, fireTvModel } from "../src/net/models.mjs";
import { parseDdp, ddpSearch } from "../src/net/ddp.mjs";
import { parseProbeMatches, probeMessage } from "../src/net/wsd.mjs";
import { knownApp, parseChannel, pickIndex, wordsToNumber } from "../src/drivers/tv.mjs";
import { samsungModel } from "../src/drivers/samsung.mjs";
import { lgModel } from "../src/drivers/lgwebos.mjs";
import { describeDevice, factsFor, confidenceOf } from "../src/identify.mjs";
import { classify } from "../src/drivers/generic.mjs";

test("WebSocket frames: masking, sizes, fragments", () => {
  // RFC 6455's own handshake example.
  assert.equal(acceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
  const got = [];
  const p = new FrameParser((f) => got.push(f));
  const small = encodeFrame(OP.text, "hello", { mask: true });
  assert.equal(small[1] & 0x80, 0x80, "client frames are masked");
  const big = encodeFrame(OP.binary, Buffer.alloc(70_000, 7), { mask: false });
  assert.equal(big[1], 127, "64-bit length for big frames");
  const mid = encodeFrame(OP.text, "x".repeat(300), { mask: true });
  assert.equal(mid[1] & 0x7f, 126);
  const all = Buffer.concat([small, big, mid]);
  for (let i = 0; i < all.length; i += 997) p.push(all.subarray(i, i + 997)); // arrives in pieces
  assert.equal(got.length, 3);
  assert.equal(got[0].payload.toString(), "hello");
  assert.equal(got[1].payload.length, 70_000);
  assert.equal(got[2].payload.toString(), "x".repeat(300));
  const parts = [];
  const q = new FrameParser((f) => parts.push(f));
  q.push(Buffer.concat([encodeFrame(OP.text, "hel", { fin: false }), encodeFrame(OP.continuation, "lo", { fin: true })]));
  assert.deepEqual(parts.map((f) => [f.fin, f.opcode]), [[false, OP.text], [true, OP.continuation]]);
});

test("ADB: messages, Android public keys and token signatures", () => {
  const msgs = [];
  const p = new MessageParser((m) => msgs.push(m));
  const raw = Buffer.concat([encodeMessage(CMD.CNXN, 0x01000001, 4096, "host::\0"), encodeMessage(CMD.OPEN, 5, 0, "shell:echo hi\0")]);
  p.push(raw.subarray(0, 30));
  p.push(raw.subarray(30));
  assert.deepEqual(msgs.map((m) => m.command), [CMD.CNXN, CMD.OPEN]);
  assert.equal(raw.readUInt32LE(20), (CMD.CNXN ^ 0xffffffff) >>> 0, "magic is the command inverted");
  assert.equal(msgs[1].data.toString(), "shell:echo hi\0");
  assert.throws(() => new MessageParser(() => {}).push(Buffer.alloc(24, 1)), /Not an ADB message/);

  const pem = newAdbKey();
  const text = androidPublicKey(pem, "patch@test");
  assert.match(text, / patch@test\0$/);
  assert.equal(Buffer.from(text.split(" ")[0], "base64").length, 524, "Android's RSAPublicKey struct is 524 bytes");
  const { key, valid } = parseAndroidPublicKey(text);
  assert.ok(valid, "n0inv and R² mod n check out");
  const token = crypto.randomBytes(20);
  const sig = signToken(pem, token);
  assert.ok(crypto.publicDecrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, sig).equals(Buffer.concat([SHA1_PREFIX, token])));
  assert.deepEqual(parseBanner("device::ro.product.name=kara;ro.product.model=AFTKA;features=shell_v2\0").props["ro.product.model"], "AFTKA");
  assert.equal(shellQuote("it's; rm -rf /"), `'it'\\''s; rm -rf /'`);
});

test("YouTube links, website addresses and durations", () => {
  for (const v of ["dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42", "youtu.be/dQw4w9WgXcQ", "https://m.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"]) {
    assert.equal(videoIdFrom(v), "dQw4w9WgXcQ", v);
  }
  assert.equal(videoIdFrom("lofi beats"), null);
  assert.equal(videoIdFrom("https://evil.example/watch?v=dQw4w9WgXcQ"), null);
  assert.equal(websiteUrl("bbc.co.uk"), "https://bbc.co.uk/");
  assert.equal(websiteUrl("weather dot com"), "https://weather.com/");
  assert.equal(websiteUrl("http://192.168.1.1/admin"), "http://192.168.1.1/admin");
  assert.equal(websiteUrl("javascript:alert(1)"), null);
  assert.equal(websiteUrl("file:///etc/passwd"), null);
  assert.equal(websiteUrl("best pizza near me"), null, "a phrase isn't a website");
  assert.equal(webSearchUrl("a & b"), "https://www.google.com/search?q=a%20%26%20b");
  assert.equal(formatIsoDuration("PT1H2M3S"), "1:02:03");
  assert.equal(formatIsoDuration("PT4M5S"), "4:05");
  assert.equal(formatIsoDuration("PT0S"), null, "live streams have no length");
  assert.equal(describeResults([{ title: "A", channel: "C", duration: "4:05" }, { title: "B", live: true }]), "1. A (C, 4:05) 2. B (live now)");
});

test("channel requests in all the ways people say them", () => {
  assert.deepEqual(parseChannel("7"), { major: 7, minor: null, number: "7" });
  assert.deepEqual(parseChannel("7.1"), { major: 7, minor: 1, number: "7.1" });
  assert.equal(parseChannel("7-1").number, "7.1");
  assert.equal(parseChannel("channel 206").number, "206");
  assert.equal(parseChannel("seven point one").number, "7.1");
  assert.equal(parseChannel("two hundred six").number, "206");
  assert.deepEqual(parseChannel("next"), { dir: "up" });
  assert.deepEqual(parseChannel("previous channel"), { dir: "down" });
  assert.deepEqual(parseChannel("ESPN"), { name: "ESPN" });
  assert.deepEqual(parseChannel("the channel BBC One"), { name: "BBC One" });
  assert.equal(wordsToNumber("twenty one"), 21);
  assert.equal(wordsToNumber("constructor"), null, "no prototype lookups");
  assert.equal(pickIndex("the second one"), 1);
  assert.equal(pickIndex("#3"), 2);
  assert.equal(pickIndex("last"), -1);
  assert.equal(pickIndex("pancakes"), null);
  assert.equal(knownApp("Disney+").key, "disney");
  assert.equal(knownApp("the YouTube app")?.key ?? knownApp("YouTube app").key, "youtube");
  assert.equal(knownApp("youtube tv").key, "youtubetv", "YouTube TV isn't YouTube");
});

test("model codes become product names", () => {
  assert.deepEqual(appleModel("iPhone15,2"), { name: "iPhone 14 Pro", kind: "phone", exact: true, code: "iPhone15,2" });
  assert.equal(appleModel("iPhone99,9").name, "iPhone", "unknown codes fall back to the family");
  assert.equal(appleModel("iPhone99,9").exact, false);
  assert.equal(appleModel("AppleTV14,1").name, "Apple TV 4K (3rd generation)");
  assert.equal(appleModel("MacBookPro18,3").kind, "computer");
  assert.equal(appleModel("Mac16,10").name, "Mac mini (M4, 2024)");
  assert.equal(appleModel("Pixel 8"), null);
  assert.equal(fireTvModel("AFTKA").name, "Fire TV Stick 4K Max");
  assert.equal(fireTvModel("AFTXYZ1").kind, "tv", "unlisted AFT codes are usually Fire TV Edition TVs");
  assert.equal(fireTvModel("Chromecast"), null);
  assert.deepEqual(samsungModel("QN65Q80BAFXZA"), { size: 65, series: "Q80B" });
  assert.deepEqual(samsungModel("UN55TU7000FXZA"), { size: 55, series: "TU7000" });
  assert.equal(samsungModel("", "[TV] Samsung Q80B Series (65)").size, 65);
  assert.deepEqual(lgModel("[LG] webOS TV OLED55C1PUB"), { model: "OLED55C1PUB", size: 55, series: "C1", oled: true });
  assert.equal(lgModel("[LG] webOS TV 50NANO75UPA").size, 50);
});

test("PlayStation and ONVIF camera discovery replies", () => {
  assert.match(ddpSearch("00030010").toString(), /^SRCH \* HTTP\/1\.1\ndevice-discovery-protocol-version:00030010\n$/);
  const ps = parseDdp("HTTP/1.1 620 Server Standby\nhost-id:A4B1\nhost-type:PS5\nhost-name:PS5-773\nhost-request-port:997\nsystem-version:09400004\n");
  assert.deepEqual(ps, { type: "PS5", name: "PS5-773", id: "A4B1", standby: true, systemVersion: "9.40" });
  assert.equal(parseDdp("HTTP/1.1 200 Ok\nhost-type:PS4\n").standby, false);
  assert.equal(parseDdp("NOTIFY * HTTP/1.1"), null);
  assert.match(probeMessage("dn:NetworkVideoTransmitter").toString(), /<d:Types>dn:NetworkVideoTransmitter<\/d:Types>/);
  const xml = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"><s:Body><d:ProbeMatches><d:ProbeMatch><d:Types>dn:NetworkVideoTransmitter</d:Types><d:Scopes>onvif://www.onvif.org/name/HIKVISION%20DS-2CD2143G2-I onvif://www.onvif.org/hardware/DS-2CD2143G2-I onvif://www.onvif.org/location/city/Front_Yard</d:Scopes><d:XAddrs>http://192.168.1.64/onvif/device_service http://[fe80::1]/onvif/device_service</d:XAddrs></d:ProbeMatch></d:ProbeMatches></s:Body></s:Envelope>`;
  const [m] = parseProbeMatches(xml, "192.168.1.1");
  assert.equal(m.address, "192.168.1.64", "the camera's own address, not the sender's");
  assert.equal(m.onvif.hardware, "DS-2CD2143G2-I");
  assert.equal(m.onvif.name, "HIKVISION DS-2CD2143G2-I");
  assert.deepEqual(parseProbeMatches("not xml at all", "1.2.3.4"), []);
});

const host = (o = {}) => ({ ip: "192.168.1.50", mac: null, vendor: null, randomMac: false, hostnames: new Set(), netbios: null, ports: new Set(), mdns: [], ssdp: [], udp: {}, http: {}, extra: {}, isGateway: false, ...o });

test("identifying devices exactly from what they announce", () => {
  const iphone = host({ mdns: [{ type: "_companion-link._tcp", name: "Sam's iPhone", txt: { rpmd: "iPhone16,1" } }], ports: new Set([62078]), randomMac: true });
  iphone.facts = factsFor(iphone);
  assert.deepEqual(classify(iphone), { kind: "phone", brand: "Apple", model: "iPhone 15 Pro", weak: false });
  const tv = host({ ssdp: [{ desc: { manufacturer: "Sony Corporation", modelName: "KD-55X85J", friendlyName: "BRAVIA" } }] });
  assert.equal(factsFor(tv).brand, "Sony");
  assert.equal(factsFor(tv).model, "KD-55X85J");
  const speaker = host({ extra: { spotify: { remoteName: "Bathroom", deviceType: "SPEAKER", brandDisplayName: "Bose", modelDisplayName: "Smart Speaker 500" } } });
  assert.deepEqual([factsFor(speaker).kind, factsFor(speaker).brand, factsFor(speaker).model, factsFor(speaker).name], ["speaker", "Bose", "Smart Speaker 500", "Bathroom"]);
  const cam = host({ extra: { wsd: { types: ["NetworkVideoTransmitter"], onvif: { name: "Reolink", hardware: "RLC-510A", location: "Driveway" } } } });
  assert.deepEqual([factsFor(cam).kind, factsFor(cam).model, factsFor(cam).room, factsFor(cam).exact], ["camera", "RLC-510A", "Driveway", true]);
  const printer = host({ mdns: [{ type: "_ipp._tcp", txt: { ty: "HP OfficeJet Pro 9015e", usb_mfg: "HP" } }] });
  assert.equal(factsFor(printer).model, "HP OfficeJet Pro 9015e");
  const ps5 = host({ extra: { ddp: { type: "PS5", name: "PS5-773", standby: true } } });
  assert.equal(factsFor(ps5).model, "PlayStation 5");
  // Names people's phones and PCs pick by default.
  const named = (n) => factsFor(host({ hostnames: new Set([n]) }));
  assert.equal(named("Galaxy-S24-Ultra.lan").model, "Galaxy S24 Ultra");
  assert.equal(named("Pixel-8-Pro").model, "Pixel 8 Pro");
  assert.equal(named("DESKTOP-4F2K9QZ").os, "Windows");
  assert.equal(named("PS5-123").model, "PlayStation 5");
  assert.equal(named("Echo-Show-8").kind, "display");
  assert.equal(named("living-room-thing").model, null);
  // A private (randomised) WiFi address is a hint, not an identity.
  const anon = host({ randomMac: true });
  anon.facts = factsFor(anon);
  assert.equal(classify(anon).weak, true);
});

test("one line that says exactly what a device is", () => {
  assert.equal(describeDevice({ kind: "tv", brand: "Samsung", model: '65" Q80B Smart TV', info: { modelNumber: "QN65Q80BAFXZA" }, driver: "samsung" }), 'Samsung 65" Q80B Smart TV (model QN65Q80BAFXZA)');
  assert.equal(describeDevice({ kind: "hub", brand: "Philips Hue", model: "Hue Bridge", info: {}, driver: "hue" }), "Philips Hue Bridge");
  assert.equal(describeDevice({ kind: "speaker", brand: "Sonos", model: "Sonos One", info: {}, driver: "sonos" }), "Sonos One");
  assert.equal(describeDevice({ kind: "computer", brand: null, model: "Windows PC", info: {}, driver: "generic" }), "Windows PC");
  assert.equal(describeDevice({ kind: "personal", model: "Uses a private Wi-Fi address", info: { guess: "Uses a private Wi-Fi address" }, driver: "generic" }), "Phone, tablet or laptop (uses a private Wi-Fi address)");
  assert.equal(describeDevice({ kind: "unknown", vendor: "Espressif", info: {}, driver: "generic" }), "Unknown device, network chip by Espressif");
  assert.equal(describeDevice({ kind: "light", brand: "Home Assistant", model: "via Home Assistant", info: {}, driver: "homeassistant", parent: "ha:hub" }), "Light in Home Assistant");
  assert.equal(describeDevice({ kind: "scene", brand: "Home Assistant", model: "Home Assistant script", info: {}, driver: "homeassistant", parent: "ha:hub" }), "Script in Home Assistant");
  assert.equal(confidenceOf({ driver: "roku" }), "exact");
  assert.equal(confidenceOf({ driver: "generic", info: { identity: { exact: true } } }), "exact");
  assert.equal(confidenceOf({ driver: "generic", kind: "phone", brand: "Samsung", model: "Galaxy S24", info: {} }), "likely");
  assert.equal(confidenceOf({ driver: "generic", kind: "unknown", info: {} }), "guess");
});
