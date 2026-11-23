// Android app files: reading them, making Patch's TV apps from the template, and signing them so
// Android accepts them (both signature schemes, checked independently here and with Google's own
// apksig/apksigner in the Android build).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readZip, entryData, writeZip, crc32 } from "../src/apk/zip.mjs";
import { ATTR, attrOf, patchAxml, readAxml } from "../src/apk/axml.mjs";
import { newSigningKey, verifyV1, verifyV2 } from "../src/apk/sign.mjs";
import { TEMPLATE, apkInfo, buildApp, pngSize } from "../src/apk/index.mjs";
import { letterImage } from "../src/apk/png.mjs";
import { fakeManifest, fakeTemplate, fakeThirdPartyApk } from "../sim/apk-fixture.mjs";

const KEY = newSigningKey();

test("CRC-32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("zip entries round-trip, and uncompressed ones are 4-byte aligned", () => {
  const z = writeZip([
    { name: "a.txt", data: Buffer.from("hello ".repeat(50)) },
    { name: "odd-name-length.bin", data: crypto.randomBytes(333), store: true },
    { name: "b/c.json", data: Buffer.from("{}") },
  ]).zip;
  const { entries } = readZip(z);
  assert.deepEqual(entries.map((e) => e.name), ["a.txt", "odd-name-length.bin", "b/c.json"]);
  assert.equal(entryData(entries[0]).toString(), "hello ".repeat(50));
  assert.equal(entries[0].method, 8);
  assert.equal(entries[1].method, 0);
  assert.equal(entries[1].raw.byteOffset % 4, z.byteOffset % 4, "stored data starts on a 4-byte boundary");
  assert.equal((entries[1].raw.byteOffset - z.byteOffset) % 4, 0);
});

for (const utf8 of [false, true]) {
  test(`binary manifest: read and rewrite (${utf8 ? "UTF-8" : "UTF-16"} strings)`, () => {
    const xml = fakeManifest({ utf8 });
    const doc = readAxml(xml);
    const manifest = doc.elements.find((e) => e.name === "manifest");
    assert.equal(attrOf(manifest, "package").string, TEMPLATE.package);
    assert.equal(attrOf(manifest, ATTR.versionCode).data, 1);
    const patched = patchAxml(xml, { strings: { [TEMPLATE.package]: "app.patch.tvapp.t1234abcd", [TEMPLATE.label]: "Grandma’s Photos 📷" }, ints: { [ATTR.versionCode]: 7 } });
    assert.equal(patched.readUInt32LE(4), patched.length, "the file's size field is updated");
    const again = readAxml(patched);
    const m2 = again.elements.find((e) => e.name === "manifest");
    assert.equal(attrOf(m2, "package").string, "app.patch.tvapp.t1234abcd");
    assert.equal(attrOf(m2, ATTR.versionCode).data, 7);
    assert.equal(attrOf(again.elements.find((e) => e.name === "application"), ATTR.label).string, "Grandma’s Photos 📷");
    // Everything else is untouched.
    assert.equal(again.elements.length, doc.elements.length);
    assert.equal(attrOf(again.elements.find((e) => e.name === "activity"), ATTR.name).string, "app.patch.tvapp.AppActivity");
    assert.throws(() => patchAxml(xml, { strings: { "not there": "x" } }), /doesn't contain/);
  });
}

test("apkInfo reads an app's id, name (from its resources) and version", () => {
  const info = apkInfo(fakeThirdPartyApk({ pkg: "org.example.coolapp", name: "My Cool App" }));
  assert.deepEqual(info, { package: "org.example.coolapp", label: "My Cool App", versionCode: 21, versionName: "2.1", minSdk: 21, tv: true });
  assert.throws(() => apkInfo(Buffer.from("not a zip at all")), /isn't a ZIP or APK/);
  assert.throws(() => apkInfo(writeZip([{ name: "x.txt", data: Buffer.from("x") }]).zip), /no manifest/);
});

test("signing key: a valid self-signed certificate", () => {
  const cert = new crypto.X509Certificate(Buffer.from(KEY.cert, "base64"));
  assert.match(cert.subject, /CN=Patch TV apps/);
  assert.ok(cert.verify(cert.publicKey));
  assert.ok(cert.publicKey.export({ type: "spki", format: "der" }).equals(crypto.createPublicKey(KEY.key).export({ type: "spki", format: "der" })));
});

test("buildApp: new id, name, version, icon and content, signed both ways", () => {
  const icon = letterImage(512, 512, { name: "Photos", color: "#ff7a59" });
  const banner = letterImage(320, 180, { name: "Photos", color: "#ff7a59" });
  for (const utf8 of [false, true]) {
    const apk = buildApp(fakeTemplate({ utf8 }), { packageName: "app.patch.tvapp.tcafe0123", label: "Family Photos", versionCode: 3, icon, banner, files: [{ name: "index.html", data: Buffer.from("<!doctype html><h1>Hi</h1>") }, { name: "photos/1.jpg", data: crypto.randomBytes(5000), store: true }] }, KEY);
    const info = apkInfo(apk);
    assert.equal(info.package, "app.patch.tvapp.tcafe0123");
    assert.equal(info.label, "Family Photos");
    assert.equal(info.versionCode, 3);
    assert.equal(info.versionName, "3");
    const { entries } = readZip(apk);
    const names = entries.map((e) => e.name);
    assert.ok(!names.includes("META-INF/OLD.SF"), "the template's old signature is gone");
    assert.ok(names.includes("assets/app/photos/1.jpg"));
    assert.equal(entryData(entries.find((e) => e.name === "assets/app/index.html")).toString(), "<!doctype html><h1>Hi</h1>");
    assert.equal(names.filter((n) => n === "assets/app/index.html").length, 1, "the template's own page is replaced");
    assert.ok(entryData(entries.find((e) => e.name === "res/drawable-nodpi/icon.png")).equals(icon));
    assert.deepEqual(pngSize(entryData(entries.find((e) => e.name === "res/drawable-xhdpi/banner.png"))), { width: 320, height: 180 });
    assert.equal(entries.find((e) => e.name === "resources.arsc").method, 0, "resources.arsc stays uncompressed");
    const v2 = verifyV2(apk);
    assert.ok(v2.ok, v2.reason);
    assert.equal(v2.cert, KEY.cert);
    const v1 = verifyV1(entries.map((e) => ({ name: e.name, data: entryData(e) })));
    assert.ok(v1.ok, v1.reason);
    // Changing one byte breaks the v2 signature.
    const bad = Buffer.from(apk);
    bad[100] ^= 1;
    assert.equal(verifyV2(bad).ok, false);
  }
});

test("long file names wrap in the JAR manifest and still verify", () => {
  const long = `assets/app/photos/${"a-very-long-photo-name-".repeat(5)}.jpg`;
  const apk = buildApp(fakeTemplate(), { packageName: "app.patch.tvapp.tlong", label: "Long", versionCode: 1, files: [{ name: long.replace("assets/app/", ""), data: Buffer.from("x"), store: true }] }, KEY);
  const entries = readZip(apk).entries.map((e) => ({ name: e.name, data: entryData(e) }));
  const mf = entries.find((e) => e.name === "META-INF/MANIFEST.MF").data.toString();
  assert.ok(mf.split("\r\n").every((l) => Buffer.byteLength(l) <= 72));
  assert.ok(verifyV1(entries).ok);
});

test("letterImage makes PNGs of the right size", () => {
  assert.deepEqual(pngSize(letterImage(512, 512, { name: "quiz" })), { width: 512, height: 512 });
  assert.deepEqual(pngSize(letterImage(320, 180, { name: "9 lives" })), { width: 320, height: 180 });
});
