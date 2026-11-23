// Any Android device (a wall calendar, a tablet, a phone) through Android's own Wireless debugging:
// it announces itself, Patch pairs once with the six-digit code it shows, and then Patch opens apps,
// reads and taps its screen and takes pictures of it, over an encrypted connection.
//
// The key exchange is checked against BoringSSL's own numbers (what Android uses), the protocol
// against a simulated Android 13 calendar built from Android's source (sim/tv-devices.mjs).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startSimulator } from "../sim/simulator.mjs";
import { startApp } from "../src/app.mjs";
import { AdbClient, newAdbKey, pairAdb, PAIR_EXPORT_LABEL } from "../src/net/adb.mjs";
import { BASE, L, M, N, Spake2, encode, leToBig, multiply } from "../src/net/spake2.mjs";
import { pairingCodeIn } from "../src/drivers/androidtv.mjs";
import { certificateFor, certificatePem } from "../src/apk/sign.mjs";

// BoringSSL's precomputed multiples of N and M (crypto/curve25519/spake25519.cc, kSpakeNSmallPrecomp
// and kSpakeMSmallPrecomp): entry i is k·P for k = bits of i spread 64 bits apart, as x then y.
const TABLES = {
  N: "201bc5b343177110441e73b3ae3fbf9ff544c8138fd101c28a1a6dea4d005d6e10e3df0ae37d8e7a99b5fe74b44672103dbddcbd06af680d71329a11693bc77893f157976ef06e45374af40b1851f54f673cdcec84edd0ebcafbdbff7feba823688713646a10f745e00f3221597c0e50ad56d712697b58f8b93ba5bb4d1b871c46a7179d6d8445be7f95d234cd8995c0f0d3df6e104ae37bce7f4027c72bab660359b47bc7c7f0399a3335bfcc2ff32e689d535c8852e37790a12785c5747f230e93013ee72e2e95f30dc2252539393d6e8e89bde8bb675e8c668b63281e4e7485a8af0f125db68a831a77765e628aa73cb805572baf362e1090b239b43e756d3aa83135c21e8fc27989351626d1c70b041f1df99c05a66bb5195a246d91c531fdc5fae7a6cb0e4b180d94c7ee1d461f92b1b24a2b4337fec2151189ef59733c067678cba60d795f280b5b8c9ee4aa519a426f11503d01d621c0995e1ae8812580ebed5d37473070a04e0b4317beb647e72a629d5da6c533629d56249d1db213bc176643d168d53b176917a6069e12b87cd5af3e211b31eb0ba4981cf26a5e7c9b458fb21206d58c1db2a7575f2f4fdb52997c58015ff2a5f65186212f5b8d6aae83346d584beffebf735ddbc4972a85f36c4642b390c157975035b19db7c73c856d6cfdceb0c9a277eec36b0c37fa3091d12cb85e7f815f87fd18025a304e62bc65c6ce1acf2baa563e4dcfba625f9ad072ffef28bdbed8573df5577de97131ec989094d954bf840be30647199a131def9d13f3dbc35c729eed24aa64ede70da07c73ba9b86a73b55ab5830f11581832ff962849866f65521d8f22564714b127659c5aa9367c38625ab4e4bf6d83f442e11e0bd6af25df5f953eaa4c8d9503381d9a82d917d132a11cfde3f0ad2bc33b26253ea77884366274385e95f55f52a8aacdfff9b4c969ca57aced57918f10b58957ae7d374650ba46430e85cfc5556ee1414d3453bf8de053eb93cd76a52725b3909be8223104ab7c3dc4c5dc9f11483f90b9be923846ac4083dda3d12958718a47d3f23ded41ea847c371dbf5036c57e7a44382337b62467df710691838279a6f38acfa92c5ae66a67395150e4c04b6fcf5c7213a99db0e36f056bc75f9879b111892641ae7c7ab5ac7267f1398425243dbc86d0bb7319324d6e8241f6f21a78cebdb83b889e3c1d7693b026b540f842fb55c1777bee5610dc5df3bcf3e934ff589b95ac52931c0c2ffe53fa6ac03caf5ffe036cef3e2b79c02e99ed2bc872f3d9a1d8fc572b8a201d468b1841610f6f35225d9dc4cdd0fd64acf60967ecc420f649d72460407f25bf407d1f45971",
  M: "c8a663c597f1ee40ab6242ee256f326c752ca7d3bd323b1e119cbd04a9786f455ada7e4bf6ddd9adb6626d32131c6b5c51a1e347a3478f53cfcf441b88eed12e0389afc0612d9e35eb0e03e0b7fba5bc44be0c890a0fd659479ee63d369dff445eacabe53ad5b0359f6d7fbac0850ef4703f13904c501aeec5eb69fe9842871dce6c29aa2b31c2387b6bee880bbacea8ca19601b16f1251ecf63661ebb63eb7dcad2b4235a016f05d1dc417375c0fd309152689645b366013b53893c69bc6c69e3518fe3d284d52866b5e60609fe6db07216e08ace6165a9213248dc7a1de1387f8c75883d08a94a6f3d9f7f3fbd576b19ce3f4ac9d3f96e727b5b74eabe9c7a6d9c4049e6fb2a1a7570e54eed74e075acc0b1113ef2af884d66b6f6154f3c6c77ae4751639afee1b41a12dfe9548d3b302a75e3e529b14cb07c6db5ae85db1e385596a55b9f15232836b8a241b4d719918d263eca9c057a2b6045868bee646f5c094d4b5a7fb0c3269d8bb88369cf1672623e5e534f9c7376fc19efa0743a111ed04db787a1d6876c0e6c8ce9a044c4723e731713d14e3d8e1d5a8b75cb592c47871541fe08e9a6971708266ab5bb73aab85b65655b309e625902f8b80f3210c1360852984a1ef0ab215ede160cda09996b9ec090a55accb0b7bbd28b5fd33b3e8ca5716606e328d4f83fe527dffe0f09b28a095a23610d2df544f15cf8824edc787aabc35791af656e71f144bfed4350b46748ef5a104681b40cc848ed997a45a592c369d6d78a201beb8fb2ffec6d7604f8c2589bf22053c4749119dd2d1253c76ed002513ca67d80756b1ddff86a52bb81f83045ef518536be8ecf0b9a46e83f99fdf7d93e84e5e337cf987feb5e5a53771c20dcf12099ec604093ef5c1c81e2a5ad2ac2db6bc17e8fa9235bd90dfea0ac1128ba8e92072d074083144c358dd011ff98db00306f65b6a07f9c08b8ceb3a842d38445e1e38fa68921d774024d64df54159eba12490941f61024a18415fd686a5766b36d4ceabfbc603f521c441bc04a25e3d94c9a74adfc9e8d0b186624d106ac68c1ae14ceb1f3869f8711d79f3092dbec0b4ae8f653366812115ee034a4ff000a26b862799c0cd5e5f51c1a16844d8e5d317ef7e2d3a14190615d04b29a189e54fbd161951b08ca7c4944741d2fcac47ae18b2fbb96ee198a5dfb3e82e715db2914eec94d9afb9f8abb17371b6e286cf9ffb5b58b9d88200810d7ca58f6e132916f36c0adc1575d763143f3ddecf1a979e9e985d791c731623cd2902c9ca456377bbe4058c0818322e8137918db3a1b310d006c22627570d8965999447971a6768128b265e84714c63906",
};
const P = 2n ** 255n - 19n;
const affine = (pt) => {
  let zi = 1n;
  for (let b = pt.Z % P, e = P - 2n; e > 0n; e >>= 1n, b = (b * b) % P) if (e & 1n) zi = (zi * b) % P;
  return [(((pt.X * zi) % P) + P) % P, (((pt.Y * zi) % P) + P) % P];
};

test("the pairing code's key exchange matches BoringSSL's numbers, which Android uses", () => {
  for (const [name, point] of [["N", N], ["M", M]]) {
    const t = Buffer.from(TABLES[name], "hex");
    for (let i = 1; i < 16; i++) {
      const k = BigInt((i >> 3) & 1) * (1n << 192n) + BigInt((i >> 2) & 1) * (1n << 128n) + BigInt((i >> 1) & 1) * (1n << 64n) + BigInt(i & 1);
      const [x, y] = affine(multiply(k, point));
      assert.equal(x, leToBig(t.subarray((i - 1) * 64, (i - 1) * 64 + 32)), `${name} table entry ${i}, x`);
      assert.equal(y, leToBig(t.subarray((i - 1) * 64 + 32, i * 64)), `${name} table entry ${i}, y`);
    }
  }
  // M and N aren't in the prime-order group (l·M isn't the neutral point): why BoringSSL's
  // password scalar has to be made a multiple of eight exactly as it does.
  assert.notEqual(encode(multiply(L, M)).toString("hex"), "0100000000000000000000000000000000000000000000000000000000000000");
  // The curve itself: the same public keys as Node's own Ed25519.
  for (let n = 0; n < 3; n++) {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
    const h = crypto.createHash("sha512").update(privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32)).digest();
    const a = Buffer.from(h.subarray(0, 32));
    a[0] &= 248;
    a[31] = (a[31] & 127) | 64;
    assert.ok(encode(multiply(leToBig(a), BASE)).equals(publicKey.export({ format: "der", type: "spki" }).subarray(-32)));
  }
  // Both sides end up with the same key with the right code, and different ones with a wrong one.
  const pw = (code) => Buffer.concat([Buffer.from(code), Buffer.alloc(64, 7)]);
  const run = (a, b) => {
    const alice = new Spake2("alice", "adb pair client\0", "adb pair server\0");
    const bob = new Spake2("bob", "adb pair server\0", "adb pair client\0");
    const ma = alice.generateMessage(pw(a));
    const mb = bob.generateMessage(pw(b));
    return alice.processMessage(mb).equals(bob.processMessage(ma));
  };
  assert.equal(run("482913", "482913"), true);
  assert.equal(run("482913", "482914"), false);
  // The 64 bytes taken from the TLS session use the label with its NUL, as Android's does.
  assert.equal(PAIR_EXPORT_LABEL.length, 10);
});

let sim;
let app;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-wireless-"));
const call = async (method, p, body) => (await fetch(`http://127.0.0.1:${app.port}${p}`, { method, headers: { "x-patch-token": app.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
const calendar = () => call("GET", "/api/devices").then((r) => r.devices.find((d) => d.ip === "127.0.17.28"));
const act = async (action, value) => call("POST", `/api/devices/${encodeURIComponent((await calendar()).id)}/action`, { action, value });

before(async () => {
  sim = await startSimulator({ prefix: "127.0.17" });
  app = await startApp({ port: 0, dataDir, overrides: sim.overrides, autoScan: false, log: () => {} });
  await call("POST", "/api/scan");
});
after(async () => {
  await app?.close();
  await sim?.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("an Android wall calendar with Wireless debugging on is found as itself, waiting for a code", async () => {
  const d = await calendar();
  assert.ok(d, "found");
  assert.equal(d.driver, "androidtv");
  assert.equal(d.kind, "display");
  assert.equal(d.brand, "Cozyla");
  assert.equal(d.name, "Cozyla Calendar 2");
  assert.equal(d.setup?.kind, "code");
  assert.match(d.setup.message, /Wireless debugging.*Pair device with pairing code.*six-digit code/);
  assert.ok(d.actions.includes("pair") && !d.actions.includes("launch_app"));
});

test("the pairing code, however it's said or typed", () => {
  const cases = [
    ["482913", "482913"], ["The code is 482913.", "482913"], ["482 913", "482913"], ["4 8 2 9 1 3", "482913"],
    ["4-8-2-9-1-3", "482913"], ["four eight two nine one three", "482913"], ["zero one two three four five", "012345"],
    ["482913 port 37123", "482913"], ["192.168.1.42:37123 482 913", "482913"], ["port 37123 482 913", "482913"],
    ["1234", null], ["48291", null], ["4829133", null], ["12 345 678", null],
  ];
  for (const [said, code] of cases) assert.equal(pairingCodeIn(said).code, code, said);
  assert.match(pairingCodeIn("482 913 port 37123").rest, /port 37123/);
  assert.match(pairingCodeIn("192.168.1.42:37123 482 913").rest, /:37123/);
});

test("pairing: the steps without a code, a closed window, a wrong code, then the right one", async () => {
  const cal = sim.state.calendar;
  let r = await act("pair");
  assert.equal(r.ok, false);
  assert.match(r.message, /Developer options.*Wireless debugging.*tell me the code/);

  r = await act("pair", cal.pairingCode);
  assert.equal(r.ok, false);
  assert.match(r.message, /can't find the pairing window/);

  cal.pairingOpen = true;
  r = await act("pair", "111111");
  assert.equal(r.ok, false);
  assert.match(r.message, /didn't match\. Read me the six digits .* again: they stay the same/);
  assert.deepEqual(cal.paired, [], "a wrong code gives the device nothing");

  // The same window, read out again the way a voice gives it: in two groups.
  r = await act("pair", `The code is ${cal.pairingCode.slice(0, 3)} ${cal.pairingCode.slice(3)}.`);
  assert.equal(r.ok, true, r.message);
  assert.match(r.message, /is connected/);
  assert.deepEqual(cal.pairings, ["wrong code", "paired"]);
  const d = await calendar();
  assert.equal(d.setup, null);
  for (const a of ["launch_app", "read_screen", "tap", "type_text", "press_button", "search_youtube", "install_app"]) assert.ok(d.actions.includes(a), a);
  assert.ok(!d.actions.includes("set_channel"), "a calendar has no channels");
});

test("once paired, Patch works the calendar like any Android device, and it stays paired", async () => {
  let r = await act("launch_app", "YouTube");
  assert.equal(r.ok, true, r.message);
  assert.ok(sim.state.calendar.commands.some((c) => /com\.google\.android\.youtube\b/.test(c)), "the YouTube app for phones and tablets");
  r = await act("search_youtube", "Franklin the Turtle");
  assert.equal(r.ok, true, r.message);
  assert.ok(sim.state.calendar.commands.some((c) => /youtube\.com\/results\?search_query=Franklin/.test(c)), "a search a tablet's YouTube app takes");
  const png = await fetch(`http://127.0.0.1:${app.port}/api/devices/${encodeURIComponent((await calendar()).id)}/screen.png?token=${encodeURIComponent(app.token)}`, { headers: { "x-patch-token": app.token } });
  assert.equal(png.status, 200);
  assert.equal((await png.arrayBuffer()).byteLength > 100, true);
  // A new scan keeps it paired and connected.
  await call("POST", "/api/scan");
  const d = await calendar();
  assert.equal(d.setup, null);
  assert.equal(d.info.os, "Android 13");
});

test("a key that never paired is turned away, and Patch says how to pair", async () => {
  const cal = sim.state.calendar;
  const key = newAdbKey();
  const keys = { key, cert: certificatePem(certificateFor(key, "adb")) };
  await assert.rejects(AdbClient.connect("127.0.17.28", { port: cal.connectPort, privateKey: key, tls: keys }), (e) => e.code === "EPAIR" && /Pair device with pairing code/.test(e.message));
  cal.pairingOpen = true;
  await assert.rejects(pairAdb("127.0.17.28", cal.pairingPort, "000000", { privateKey: key, cert: keys.cert }), (e) => e.code === "EPAIRCODE");
  cal.pairingOpen = false;
});

test("with Wireless debugging off, the calendar says how to switch it on; once on, the same device asks for its code", async () => {
  const sim2 = await startSimulator({ prefix: "127.0.18" });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-wireless-off-"));
  const app2 = await startApp({ port: 0, dataDir: dir, overrides: sim2.overrides, autoScan: false, log: () => {} });
  const call2 = async (method, p, body) => (await fetch(`http://127.0.0.1:${app2.port}${p}`, { method, headers: { "x-patch-token": app2.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })).json();
  const at = async () => (await call2("GET", "/api/devices")).devices.filter((d) => d.ip === "127.0.18.28");
  try {
    sim2.state.calendar.wireless = false;
    await call2("POST", "/api/scan");
    let found = await at();
    assert.equal(found.length, 1);
    assert.equal(found[0].brand, "Cozyla");
    assert.equal(found[0].setup?.kind, "android");
    assert.match(found[0].setup.message, /runs Android.*Wireless debugging.*scan again/);
    // Named by the person while it was a plain device: the name carries over.
    await call2("POST", `/api/devices/${encodeURIComponent(found[0].id)}/meta`, { name: "Kitchen calendar" });

    sim2.state.calendar.wireless = true;
    await call2("POST", "/api/scan");
    found = await at();
    assert.equal(found.length, 1, `one device, not two: ${found.map((d) => d.id).join(", ")}`);
    assert.equal(found[0].driver, "androidtv");
    assert.equal(found[0].setup?.kind, "code");
    assert.equal(found[0].name, "Kitchen calendar");
    // Paired at the first try, with nothing made before: the key Patch makes for it is the one it keeps.
    sim2.state.calendar.pairingOpen = true;
    const r = await call2("POST", `/api/devices/${encodeURIComponent(found[0].id)}/action`, { action: "pair", value: sim2.state.calendar.pairingCode });
    assert.equal(r.ok, true, r.message);
    const again = await call2("POST", `/api/devices/${encodeURIComponent(found[0].id)}/action`, { action: "launch_app", value: "YouTube" });
    assert.equal(again.ok, true, again.message);
  } finally {
    await app2.close();
    await sim2.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
