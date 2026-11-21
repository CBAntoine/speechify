// Fake Android app files for tests and the simulated Fire TV: a real binary manifest, a tiny
// resource table, a placeholder icon and banner, in a ZIP shaped like the TV app template.
import { writeStringPool } from "../src/apk/axml.mjs";
import { TEMPLATE } from "../src/apk/index.mjs";
import { encodePng } from "../src/apk/png.mjs";
import { writeZip } from "../src/apk/zip.mjs";

const NS = "http://schemas.android.com/apk/res/android";
const NONE = 0xffffffff;

const u32s = (...n) => {
  const b = Buffer.alloc(n.length * 4);
  n.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4));
  return b;
};

function chunk(type, headerSize, body) {
  const h = Buffer.alloc(8);
  h.writeUInt16LE(type, 0);
  h.writeUInt16LE(headerSize, 2);
  h.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([h, body]);
}

/**
 * A binary AndroidManifest.xml for a TV app. `label` is a literal name, or with labelRef a
 * reference to a string resource (as most apps do: @string/app_name).
 */
export function fakeManifest({ pkg = TEMPLATE.package, label = TEMPLATE.label, labelRef = null, versionCode = 1, versionName = TEMPLATE.versionName, utf8 = false } = {}) {
  const attrNames = ["versionCode", "versionName", "minSdkVersion", "label", "icon", "name", "banner"];
  const ids = [0x0101021b, 0x0101021c, 0x0101020c, 0x01010001, 0x01010002, 0x01010003, 0x010103f2];
  const strings = [...attrNames, "android", NS, "package", "manifest", "uses-sdk", "application", "activity", "intent-filter", "action", "category", pkg, versionName, "app.patch.tvapp.AppActivity", "android.intent.action.MAIN", "android.intent.category.LEANBACK_LAUNCHER"];
  if (!labelRef) strings.push(label);
  const ix = (s) => {
    const i = strings.indexOf(s);
    if (i < 0) throw new Error(`no string ${s}`);
    return i;
  };
  const pool = writeStringPool({ strings, utf8, flags: utf8 ? 0x100 : 0, styleOffsets: [], styleData: Buffer.alloc(0) });
  const resMap = chunk(0x0180, 8, u32s(...ids));
  const node = (type, rest) => chunk(type, 16, Buffer.concat([u32s(1, NONE), rest]));
  const attr = (ns, name, raw, type, data) => {
    const b = Buffer.alloc(20);
    b.writeUInt32LE(ns, 0);
    b.writeUInt32LE(name, 4);
    b.writeUInt32LE(raw, 8);
    b.writeUInt16LE(8, 12);
    b[15] = type;
    b.writeUInt32LE(data >>> 0, 16);
    return b;
  };
  const str = (name, s, ns = ix(NS)) => attr(ns, ix(name), ix(s), 0x03, ix(s));
  const int = (name, n) => attr(ix(NS), ix(name), NONE, 0x10, n);
  const ref = (name, id) => attr(ix(NS), ix(name), NONE, 0x01, id);
  const start = (name, attrs = []) => {
    const ext = Buffer.alloc(20);
    ext.writeUInt32LE(NONE, 0);
    ext.writeUInt32LE(ix(name), 4);
    ext.writeUInt16LE(20, 8);
    ext.writeUInt16LE(20, 10);
    ext.writeUInt16LE(attrs.length, 12);
    return node(0x0102, Buffer.concat([ext, ...attrs]));
  };
  const end = (name) => node(0x0103, u32s(NONE, ix(name)));
  const ns = (type) => node(type, u32s(ix("android"), ix(NS)));
  const body = Buffer.concat([
    pool,
    resMap,
    ns(0x0100),
    start("manifest", [int("versionCode", versionCode), str("versionName", versionName), attr(NONE, ix("package"), ix(pkg), 0x03, ix(pkg))]),
    start("uses-sdk", [int("minSdkVersion", 21)]),
    end("uses-sdk"),
    start("application", [labelRef ? ref("label", labelRef) : str("label", label), ref("icon", 0x7f020000), ref("banner", 0x7f020001)]),
    start("activity", [str("name", "app.patch.tvapp.AppActivity")]),
    start("intent-filter"),
    start("action", [str("name", "android.intent.action.MAIN")]),
    end("action"),
    start("category", [str("name", "android.intent.category.LEANBACK_LAUNCHER")]),
    end("category"),
    end("intent-filter"),
    end("activity"),
    end("application"),
    end("manifest"),
    ns(0x0101),
  ]);
  return chunk(0x0003, 8, body);
}

/** A resources.arsc with one string resource, 0x7f010000 = `name`. */
export function fakeArsc(name = "My Cool App") {
  const pool = (list) => writeStringPool({ strings: list, utf8: true, flags: 0x100, styleOffsets: [], styleData: Buffer.alloc(0) });
  const config = Buffer.alloc(64);
  config.writeUInt32LE(64, 0);
  const typeHead = Buffer.alloc(12);
  typeHead[0] = 1; // type id
  typeHead.writeUInt32LE(1, 4); // one entry
  typeHead.writeUInt32LE(20 + 64 + 4, 8); // entries start
  const entry = Buffer.alloc(16);
  entry.writeUInt16LE(8, 0);
  entry.writeUInt16LE(8, 8);
  entry[11] = 0x03; // a string
  entry.writeUInt32LE(0, 12);
  const type = chunk(0x0201, 20 + 64, Buffer.concat([typeHead, config, u32s(0), entry]));
  const pkgHead = Buffer.alloc(280);
  pkgHead.writeUInt32LE(0x7f, 0);
  const pkg = chunk(0x0200, 288, Buffer.concat([pkgHead, pool(["string"]), pool(["app_name"]), type]));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(1, 0);
  const global = pool([name]);
  const table = Buffer.concat([head, global, pkg]);
  const h = Buffer.alloc(8);
  h.writeUInt16LE(0x0002, 0);
  h.writeUInt16LE(12, 2);
  h.writeUInt32LE(8 + table.length, 4);
  return Buffer.concat([h, table]);
}

const solid = (w, h, rgb) => {
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([...rgb, 255], i * 4);
  return encodePng(w, h, px);
};

/** A template-shaped APK (unsigned except for an old signature that building must drop). */
export function fakeTemplate({ utf8 = false, level = TEMPLATE.level } = {}) {
  return writeZip([
    ...(level > 1 ? [{ name: TEMPLATE.levelFile, data: Buffer.from(JSON.stringify({ level })) }] : []),
    { name: "AndroidManifest.xml", data: fakeManifest({ utf8 }) },
    { name: "classes.dex", data: Buffer.from("dex\n035\0 pretend code") },
    { name: "resources.arsc", data: fakeArsc("unused"), store: true },
    { name: "res/drawable-nodpi/icon.png", data: solid(TEMPLATE.icon.width, TEMPLATE.icon.height, [91, 108, 255]), store: true },
    { name: "res/drawable-xhdpi/banner.png", data: solid(TEMPLATE.banner.width, TEMPLATE.banner.height, [91, 108, 255]), store: true },
    { name: "assets/app/index.html", data: Buffer.from("<!doctype html><p>template</p>") },
    { name: "META-INF/OLD.SF", data: Buffer.from("old signature") },
    { name: "META-INF/OLD.RSA", data: Buffer.from("old signature") },
  ]).zip;
}

/** Someone else's app file, for "install this APK on the TV". */
export function fakeThirdPartyApk({ pkg = "org.example.coolapp", name = "My Cool App" } = {}) {
  return writeZip([
    { name: "AndroidManifest.xml", data: fakeManifest({ pkg, labelRef: 0x7f010000, versionName: "2.1", versionCode: 21 }) },
    { name: "classes.dex", data: Buffer.from("dex\n035\0 pretend code") },
    { name: "resources.arsc", data: fakeArsc(name), store: true },
  ]).zip;
}
