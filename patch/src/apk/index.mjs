// Android app files (APKs): what's in one (its id, name, version), and making Patch's own TV apps
// from the TV app template (android/tvapp): new id, name, version, icon, banner and content, signed
// with Patch's key.
import { entryData, readZip, writeZip } from "./zip.mjs";
import { ATTR, TYPE, arscString, attrOf, patchAxml, readAxml } from "./axml.mjs";
import { isSignatureFile, signV1, signV2 } from "./sign.mjs";

/** What the template's manifest says before Patch fills it in (android/tvapp/build.gradle). */
export const TEMPLATE = {
  package: "app.patch.tvapp.template",
  label: "Patch TV app template",
  versionName: "0.0.0-template",
  icon: { width: 512, height: 512 },
  banner: { width: 320, height: 180 },
};

/** Width and height of a PNG, or null. */
export function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** { package, label, versionCode, versionName, minSdk, tv } of an APK. Throws if it isn't one. */
export function apkInfo(apk) {
  const { entries } = readZip(apk);
  const manifest = entries.find((e) => e.name === "AndroidManifest.xml");
  if (!manifest) throw new Error("That file isn't an Android app: it has no manifest.");
  const doc = readAxml(entryData(manifest));
  const el = (n) => doc.elements.find((e) => e.name === n);
  const pkg = attrOf(el("manifest"), "package")?.string;
  if (!pkg) throw new Error("That file isn't an Android app: it has no app id.");
  const labelAttr = attrOf(el("application"), ATTR.label);
  let label = labelAttr?.string || null;
  if (!label && labelAttr?.type === TYPE.REFERENCE) {
    const arsc = entries.find((e) => e.name === "resources.arsc");
    try {
      label = arsc ? arscString(entryData(arsc), labelAttr.data) : null;
    } catch {
      label = null;
    }
  }
  const sdk = attrOf(el("uses-sdk"), ATTR.minSdkVersion);
  return {
    package: pkg,
    label,
    versionCode: attrOf(el("manifest"), ATTR.versionCode)?.data ?? null,
    versionName: attrOf(el("manifest"), ATTR.versionName)?.string ?? null,
    minSdk: sdk && sdk.type !== TYPE.STRING ? sdk.data : null,
    tv: doc.elements.some((e) => e.name === "category" && attrOf(e, ATTR.name)?.string === "android.intent.category.LEANBACK_LAUNCHER"),
  };
}

/**
 * Make one of Patch's TV apps from the template APK.
 *  options: { packageName, label, versionCode, versionName, icon (512×512 PNG), banner (320×180 PNG),
 *             files: [{ name, data, store }] (they go in assets/app/) }
 *  signingKey: { key, cert } from newSigningKey().
 */
export function buildApp(template, { packageName, label, versionCode, versionName = String(versionCode), icon, banner, files = [] }, signingKey) {
  if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(packageName || "")) throw new Error("That isn't a valid app id.");
  const { entries } = readZip(template);
  const out = [];
  let replacedIcon = false;
  let replacedBanner = false;
  for (const e of entries) {
    if (isSignatureFile(e.name) || e.name.startsWith("assets/app/")) continue;
    if (e.name === "AndroidManifest.xml") {
      const data = patchAxml(entryData(e), {
        strings: { [TEMPLATE.package]: packageName, [TEMPLATE.label]: String(label).slice(0, 50), [TEMPLATE.versionName]: versionName },
        ints: { [ATTR.versionCode]: versionCode },
      });
      out.push({ name: e.name, data });
      continue;
    }
    if (/\.png$/i.test(e.name) && (icon || banner)) {
      const size = pngSize(entryData(e));
      if (icon && size?.width === TEMPLATE.icon.width && size?.height === TEMPLATE.icon.height) {
        out.push({ name: e.name, data: icon, store: true });
        replacedIcon = true;
        continue;
      }
      if (banner && size?.width === TEMPLATE.banner.width && size?.height === TEMPLATE.banner.height) {
        out.push({ name: e.name, data: banner, store: true });
        replacedBanner = true;
        continue;
      }
    }
    // resources.arsc must stay uncompressed (and aligned) for Android 11 and later.
    out.push(e.name === "resources.arsc" ? { name: e.name, data: entryData(e), store: true } : e);
  }
  if (icon && !replacedIcon) throw new Error("The TV app template has no icon to replace.");
  if (banner && !replacedBanner) throw new Error("The TV app template has no banner to replace.");
  for (const f of files) out.push({ name: `assets/app/${f.name}`, data: f.data, store: !!f.store });
  const signatures = signV1(
    out.map((e) => ({ name: e.name, data: e.data || entryData(e) })),
    signingKey,
  );
  return signV2(writeZip([...out, ...signatures]), signingKey);
}
