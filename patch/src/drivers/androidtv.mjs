// Fire TV, Android TV and Google TV devices (sticks, boxes, and TVs from Sony, TCL, Hisense,
// Philips…), controlled over ADB once "ADB debugging" / "Network debugging" is switched on in the
// device's developer options. Volume and play/pause also work over Google Cast when the device
// has it, with or without ADB.
import fsp from "node:fs/promises";
import { AdbClient, newAdbKey, shellQuote } from "../net/adb.mjs";
import { fireTvModel } from "../net/models.mjs";
import { describeScreen, riskyButton } from "../net/phone.mjs";
import { readUiTree } from "../net/uitree.mjs";
import { watchUrl, youtubeSearchUrl } from "../net/youtube.mjs";
import { WebSession, describePage, hostOf } from "../tvweb/session.mjs";
import { apkInfo } from "../apk/index.mjs";
import { fuzzyPick, normalizeText, sleep } from "../util.mjs";
import cast from "./cast.mjs";
import { DeviceError, done, explainError, need, unsupported } from "./common.mjs";
import { APPS, customAppNames, knownApp, parseChannel, pickIndex, storeLink, webSearchUrl, websiteOrSearch, youtubePlay, youtubeSearch } from "./tv.mjs";

const KEYS = {
  power: "KEYCODE_POWER", home: "KEYCODE_HOME", back: "KEYCODE_BACK", menu: "KEYCODE_MENU", settings: "KEYCODE_SETTINGS", up: "KEYCODE_DPAD_UP",
  down: "KEYCODE_DPAD_DOWN", left: "KEYCODE_DPAD_LEFT", right: "KEYCODE_DPAD_RIGHT", ok: "KEYCODE_DPAD_CENTER", select: "KEYCODE_DPAD_CENTER",
  enter: "KEYCODE_DPAD_CENTER", play: "KEYCODE_MEDIA_PLAY", pause: "KEYCODE_MEDIA_PAUSE", "play pause": "KEYCODE_MEDIA_PLAY_PAUSE",
  stop: "KEYCODE_MEDIA_STOP", rewind: "KEYCODE_MEDIA_REWIND", "fast forward": "KEYCODE_MEDIA_FAST_FORWARD", forward: "KEYCODE_MEDIA_FAST_FORWARD",
  next: "KEYCODE_MEDIA_NEXT", previous: "KEYCODE_MEDIA_PREVIOUS", "volume up": "KEYCODE_VOLUME_UP", "volume down": "KEYCODE_VOLUME_DOWN",
  mute: "KEYCODE_VOLUME_MUTE", "channel up": "KEYCODE_CHANNEL_UP", "channel down": "KEYCODE_CHANNEL_DOWN", search: "KEYCODE_SEARCH",
  guide: "KEYCODE_GUIDE", info: "KEYCODE_INFO", input: "KEYCODE_TV_INPUT", source: "KEYCODE_TV_INPUT", recent: "KEYCODE_APP_SWITCH", apps: "KEYCODE_ALL_APPS",
};

const failed = (out) => /(^|\n)\s*(Error|Exception)\b|unable to resolve|No activities found|does not exist|monkey aborted|not found/i.test(out || "");
const safePkg = (p) => /^[A-Za-z0-9_.]+$/.test(p);

/** Friendly names for package ids (the TV only tells us the ids). */
const PKG_NAMES = {
  ...Object.fromEntries(APPS.flatMap((a) => (a.android || []).map((p) => [p, a.names[0].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Youtube/, "YouTube").replace(/Tv\b/, "TV")]))),
  "com.amazon.venezia": "Appstore",
  "com.android.vending": "Google Play Store",
  "com.amazon.cloud9": "Silk Browser",
  "com.amazon.tv.settings.v2": "Settings",
  "com.android.tv.settings": "Settings",
  "com.android.settings": "Settings",
  "com.google.android.youtube.tv": "YouTube",
  "com.amazon.firetv.youtube": "YouTube",
  "com.google.android.apps.tv.launcherx": "Home",
  "com.amazon.avod.thirdpartyclient": "Prime Video",
  "com.amazon.music.tv": "Amazon Music",
  "com.amazon.photos.importer": "Amazon Photos",
  "com.google.android.katniss": "Google Assistant",
  "com.google.android.apps.mediashell": "Chromecast built-in",
};
// Names of apps Patch installed from a file (Android TV only tells other apps their ids).
const knownLabels = new Map();
const appName = (pkg) => customAppNames.get(pkg) || PKG_NAMES[pkg] || knownLabels.get(pkg) || pkg.split(".").filter((x) => !/^(com|tv|org|android|amazon|google|app|apps|firetv|livingroom|leanback)$/.test(x)).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(" ") || pkg;
const isFireTv = (d) => d.brand === "Amazon" || /fire/i.test(`${d.info?.os || ""} ${d.model || ""}`);
const LAUNCHERS = /launcher|tvlauncher|leanbacklauncher|launcherx|com\.google\.android\.apps\.tv\.launcherx|amazon\.tv\.launcher/i;

// Live connections, closed after a minute of quiet. They're kept by the TV and its address: a TV
// that comes back at another address gets a new connection.
const clients = new Map();
// Patch's connection into the web page one of its own apps is showing, per TV.
const webs = new Map();
const keyOf = (device) => `${device.id}|${device.ref.ip}:${device.ref.adbPort || 5555}`;

function closeLater(id) {
  const c = clients.get(id);
  if (!c) return;
  clearTimeout(c.timer);
  c.timer = setTimeout(() => {
    webs.get(id)?.session.close();
    webs.delete(id);
    c.client.close();
    clients.delete(id);
  }, 60_000);
  c.timer.unref?.();
}

async function adbKey(ctx) {
  if (ctx.secrets.adbKey) return ctx.secrets.adbKey;
  const pem = newAdbKey();
  await ctx.saveSecret(["adbKey"], pem);
  return pem;
}

function setupMessage(device) {
  const fire = /fire tv/i.test(`${device.brand} ${device.model}`) || device.brand === "Amazon";
  return fire
    ? `To let Patch open apps, YouTube and websites on ${device.name}: on the Fire TV go to Settings → My Fire TV → Developer options and turn on ADB debugging (no Developer options? Settings → My Fire TV → About, then select the device name 7 times). Then press Connect.`
    : `To let Patch open apps, YouTube and websites on ${device.name}: on the TV go to Settings → System → About and select "Android TV OS build" 7 times, then in Settings → System → Developer options turn on USB debugging and Network debugging. Then press Connect.`;
}

async function connect(device, ctx, { pairing = false } = {}) {
  const id = keyOf(device);
  const live = clients.get(id);
  if (live?.client.open) {
    closeLater(id);
    return live.client;
  }
  const key = await adbKey(ctx);
  let client;
  try {
    client = await AdbClient.connect(device.ref.ip, { port: device.ref.adbPort || 5555, privateKey: key, allowPrompt: pairing, promptTimeout: 45_000 });
  } catch (err) {
    if (err.code === "ECONNREFUSED") throw new DeviceError(setupMessage(device), { code: "ESETUP" });
    if (err.code === "ESETUP") {
      if (!pairing) await ctx.forgetSecret(["pairings", device.id]);
      throw new DeviceError(pairing ? `Nobody allowed Patch on ${device.name}. Press Connect again, then on the TV tick "Always allow from this computer" and choose Allow.` : `${device.name} hasn't allowed Patch yet. Press Connect, then choose Allow on the TV.`, { code: "ESETUP" });
    }
    throw err;
  }
  if (!ctx.secrets.pairings?.[device.id]?.adb) await ctx.saveSecret(["pairings", device.id], { adb: true, paired: true });
  clients.set(id, { client, timer: null });
  client.on("close", () => clients.get(id)?.client === client && clients.delete(id));
  closeLater(id);
  return client;
}

const sh = (client, cmd, timeout) => client.shell(cmd, { timeout });

async function packages(client, device) {
  const out = await sh(client, "pm list packages", 10_000);
  const list = out.split("\n").map((l) => l.replace(/^package:/, "").trim()).filter(safePkg);
  device.ref.packages = list;
  return list;
}

/** The package for a spoken app name, among what's installed. */
async function findPackage(client, device, name) {
  const list = device.ref.packages?.length ? device.ref.packages : await packages(client, device);
  const known = knownApp(name);
  const pkg = known?.android?.find((p) => list.includes(p));
  if (pkg) return pkg;
  const named = list.map((p) => ({ name: appName(p), pkg: p })).filter((x) => !/^com\.android\.|^android$/.test(x.pkg));
  const hit = fuzzyPick(name, named);
  if (hit) return hit.pkg;
  throw new DeviceError(`${name} doesn't seem to be installed on ${device.name}.`, { code: "ENOTINSTALLED" });
}

async function launchPkg(client, pkg) {
  if (!safePkg(pkg)) throw new DeviceError("That isn't an app name I can open.");
  let out = await sh(client, `monkey -p ${pkg} -c android.intent.category.LEANBACK_LAUNCHER 1`);
  if (failed(out)) out = await sh(client, `monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);
  if (failed(out)) throw new DeviceError(`The TV couldn't open ${appName(pkg)}.`, { code: "ENOTINSTALLED" });
}

async function view(client, url, pkg) {
  const out = await sh(client, `am start -a android.intent.action.VIEW -d ${shellQuote(url)}${pkg && safePkg(pkg) ? ` ${pkg}` : ""}`);
  return !failed(out);
}

async function key(client, ...codes) {
  for (const c of codes) await sh(client, `input keyevent ${c}`);
}

async function youtubePkg(client, device) {
  const list = device.ref.packages?.length ? device.ref.packages : await packages(client, device);
  return APPS.find((a) => a.key === "youtube").android.find((p) => list.includes(p)) || null;
}

async function liveState(client, device) {
  const [power, focus] = await Promise.all([sh(client, "dumpsys power | grep -m 1 mWakefulness=").catch(() => ""), sh(client, "dumpsys window | grep -m 2 -E 'mCurrentFocus|mFocusedApp'").catch(() => "")]);
  const wake = power.match(/mWakefulness=(\w+)/)?.[1];
  const pkg = focus.match(/\s([A-Za-z0-9_.]+)\/[A-Za-z0-9_.$]+/)?.[1];
  const st = { ...device.state, on: wake ? wake === "Awake" : true };
  if (pkg) st.app = LAUNCHERS.test(pkg) ? "Home screen" : appName(pkg);
  return st;
}

// ── Apps on the TV ──────────────────────────────────────────────────────────

/** The apps in the TV's own apps list, with friendly names. */
async function launchableApps(client, device) {
  const cats = ["android.intent.category.LEANBACK_LAUNCHER", "android.intent.category.LAUNCHER"];
  const out = await sh(client, cats.map((c) => `cmd package query-activities --brief -a android.intent.action.MAIN -c ${c} 2>/dev/null`).join("; "), 15_000).catch(() => "");
  let pkgs = [...new Set([...out.matchAll(/(?:^|\s)([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\/[A-Za-z0-9_.$]+/g)].map((m) => m[1]))];
  if (!pkgs.length) {
    // Older TVs (Fire OS 5) have no "cmd": the apps the person installed, plus the well-known ones.
    const third = await sh(client, "pm list packages -3", 10_000);
    const all = await packages(client, device);
    pkgs = [...new Set([...third.split("\n").map((l) => l.replace(/^package:/, "").trim()), ...all.filter((p) => PKG_NAMES[p] || customAppNames.has(p))])];
  }
  // Apps the person installed can be removed; the ones that came with the TV can't.
  const third = new Set((await sh(client, "pm list packages -3", 10_000).catch(() => "")).split("\n").map((l) => l.replace(/^package:/, "").trim()));
  return pkgs
    .filter((p) => safePkg(p) && !LAUNCHERS.test(p))
    .map((p) => ({ pkg: p, name: appName(p), removable: third.has(p) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// What the store's button says when an app is free to install (never a price or "Buy").
const STORE_BUTTON = /^(install|get|download|free|get app|install app|install on (this )?(device|tv))$/i;

/** Open the app's page in the TV's own app store and choose Install when it's free. */
async function storeInstall(client, device, name, ctx) {
  const fire = isFireTv(device);
  const known = knownApp(name);
  const label = known ? known.names[0].replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Youtube/, "YouTube").replace(/Tv\b/, "TV") : String(name).trim();
  const link = storeLink(name, { fire });
  const list = await packages(client, device);
  const have = [link.pkg, ...(known?.android || [])].filter(Boolean).find((p) => list.includes(p));
  if (have) return done(`${appName(have)} is already on ${device.name}. Want me to open it?`, { installed: true });
  const pkg = link.pkg || (known?.android || []).find((p) => (fire ? /amazon|firetv/.test(p) : !/firetv/.test(p))) || known?.android?.[0] || null;
  const url = pkg ? (fire ? `amzn://apps/android?p=${pkg}` : `market://details?id=${pkg}`) : fire ? `amzn://apps/android?s=${encodeURIComponent(link.query)}` : `market://search?q=${encodeURIComponent(link.query)}&c=apps`;
  if (!(await view(client, url))) throw new DeviceError(`${device.name}'s app store didn't open. Open it with the remote and search for ${label} there.`, { code: "ENOSTORE" });
  const store = fire ? "the Amazon Appstore" : "Google Play";
  if (!pkg) return done(`${store} on ${device.name} is showing results for “${link.query}”. Ask me what's on the screen and I'll pick the right one, or choose it with the remote.`, { state: { ...device.state, on: true, app: "App store" } });
  await sleep(3500);
  const screen = await readScreen(client, device, ctx).catch(() => null);
  // The button the remote is on, then real buttons, before plain text (a "Free" price label).
  const candidates = (screen?.items || []).filter((it) => STORE_BUTTON.test(it.text) && !/greyed/.test(it.state || ""));
  const button = candidates.find((it) => /selected/.test(it.state || "")) || candidates.find((it) => it.kind === "Button" || it.kind === "Item") || candidates[0];
  if (!button) {
    const priced = screen?.items.find((it) => /^(buy|[$£€]\s?\d|\d+[.,]\d\d\s?[$£€])/i.test(it.text));
    return done(priced ? `The ${label} page is open in ${store} on ${device.name}. It costs money (“${priced.text}”), so choose it yourself if you want it.` : `The ${label} page is open in ${store} on ${device.name}. Choose Install with the remote, or say “select Install”.`, { state: { ...device.state, on: true, app: "App store" } });
  }
  if (/selected/.test(button.state || "")) await key(client, "KEYCODE_DPAD_CENTER");
  else await sh(client, `input tap ${button.x} ${button.y}`);
  for (let i = 0; i < 4; i++) {
    await sleep(2000);
    device.ref.packages = null;
    if ((await packages(client, device)).includes(pkg)) return done(`${label} is installed on ${device.name}. Want me to open it?`, { installed: true });
  }
  return done(`${label} is downloading on ${device.name}. It'll be in the apps list in a minute or two.`, { state: { ...device.state, on: true, app: "App store" } });
}

const INSTALL_ERRORS = [
  [/INSTALL_FAILED_UPDATE_INCOMPATIBLE|INCONSISTENT_CERTIFICATES/, (n) => `A different copy of ${n} is already on the TV, signed by someone else. Remove it first, then try again.`],
  [/INSTALL_FAILED_VERSION_DOWNGRADE/, (n) => `A newer version of ${n} is already on the TV.`],
  [/INSTALL_FAILED_NO_MATCHING_ABIS|CPU_ABI/, (n) => `${n} isn't made for this TV's kind of processor. Look for a version for ARM (most TVs) or for Android TV.`],
  [/INSTALL_FAILED_OLDER_SDK/, (n) => `${n} needs a newer version of Android than this TV has.`],
  [/INSUFFICIENT_STORAGE/, () => "The TV is out of space. Remove an app you don't use and try again."],
  [/INSTALL_PARSE_FAILED|INVALID_APK|NOT_APK/, () => "That file isn't a working Android app."],
  [/VERIFICATION|PLAY_PROTECT|USER_RESTRICTED|blocked/i, (n) => `The TV blocked ${n} (Play Protect or a parental setting). Check the TV's screen.`],
];

/** Copy an app file onto the TV and install it. Returns { package, name }. */
async function sideload(client, device, apk, { label, ours = false, ctx } = {}) {
  let info;
  try {
    info = apkInfo(apk);
  } catch (err) {
    throw new DeviceError(`That isn't an Android app file (APK): ${err.message}`, { code: "EVALUE" });
  }
  const name = label || info.label || appName(info.package);
  const tmp = `/data/local/tmp/patch-${Date.now().toString(36)}.apk`;
  await client.push(apk, tmp);
  let out = await sh(client, `pm install -r ${tmp}`, 240_000).catch((e) => `Failure [${e.message}]`);
  if (ours && /UPDATE_INCOMPATIBLE|INCONSISTENT_CERTIFICATES/.test(out)) {
    // One of Patch's own apps, made earlier with another copy of Patch: replace it.
    await sh(client, `pm uninstall ${info.package}`, 60_000).catch(() => "");
    out = await sh(client, `pm install -r ${tmp}`, 240_000).catch((e) => `Failure [${e.message}]`);
  }
  await sh(client, `rm -f ${tmp}`).catch(() => "");
  device.ref.packages = null;
  if (/\bSuccess\b/.test(out)) {
    if (!ours && name !== info.package) {
      knownLabels.set(info.package, name);
      await ctx?.saveSecret(["appLabels", info.package], name);
    }
    return { package: info.package, name };
  }
  const known = INSTALL_ERRORS.find(([re]) => re.test(out));
  throw new DeviceError(known ? known[1](name) : `${device.name} didn't install ${name}: ${out.trim().split("\n").pop().slice(0, 160)}`, { code: "EINSTALL" });
}

const MAX_APK = 200 * 1024 * 1024;

async function downloadApk(url) {
  let res;
  try {
    res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(180_000) });
  } catch {
    throw new DeviceError("I couldn't download that app file. Check the link.", { code: "EDOWNLOAD" });
  }
  if (!res.ok) throw new DeviceError(`The app file's link answered ${res.status}.`, { code: "EDOWNLOAD" });
  if (Number(res.headers.get("content-length") || 0) > MAX_APK) throw new DeviceError("That app file is too big (over 200 MB).", { code: "ETOOBIG" });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_APK) throw new DeviceError("That app file is too big (over 200 MB).", { code: "ETOOBIG" });
  if (buf.readUInt16BE(0) !== 0x504b) throw new DeviceError("That link isn't an Android app file (APK). For apps in the TV's store, just tell me the app's name.", { code: "EVALUE" });
  return buf;
}

/** install_app: a name (from the store), an app file the person picked, a link to one, or one of Patch's own TV apps. */
async function installApp(client, device, value, ctx) {
  const v = String(need(value, "app")).trim();
  if (/^tvapp:/i.test(v)) {
    const made = await ctx.tvapps?.apk(v.slice(6));
    if (!made) throw new DeviceError("I can't find that TV app in Patch any more.", { code: "ENOTFOUND" });
    const r = await sideload(client, device, made.apk, { label: made.name, ours: true });
    await launchPkg(client, r.package).catch(() => {});
    return done(`${made.name} is on ${device.name} now, in its apps list, and it's opening.`, { installed: r.package, state: { ...device.state, on: true, app: made.name } });
  }
  if (/^upload:/i.test(v)) {
    const file = ctx.uploads?.get(v.slice(7));
    if (!file) throw new DeviceError("That app file isn't here any more. Choose it again.", { code: "ENOTFOUND" });
    const r = await sideload(client, device, await fsp.readFile(file.path), { ctx });
    return done(`${r.name} is installed on ${device.name}. Want me to open it?`, { installed: r.package });
  }
  const link = storeLink(v, { fire: isFireTv(device) });
  if (/^https?:\/\//i.test(v) && !link.pkg) {
    const r = await sideload(client, device, await downloadApk(v), { ctx });
    return done(`${r.name} is installed on ${device.name}. Want me to open it?`, { installed: r.package });
  }
  return storeInstall(client, device, v, ctx);
}

async function uninstallApp(client, device, value) {
  const v = String(need(value, "app")).trim();
  const pkg = /^tvapp:/i.test(v) ? v.slice(6) : await findPackage(client, device, v);
  const third = await sh(client, "pm list packages -3", 10_000);
  if (!third.split("\n").some((l) => l.trim() === `package:${pkg}`)) {
    if (/^tvapp:/i.test(v)) return done(`It wasn't on ${device.name}.`);
    throw new DeviceError(`${appName(pkg)} came with ${device.name}, so it can't be removed. You can hide it from the home screen in the TV's settings.`, { code: "ESYSTEM" });
  }
  const out = await sh(client, `pm uninstall ${pkg}`, 60_000);
  device.ref.packages = null;
  if (!/\bSuccess\b/.test(out)) throw new DeviceError(`${device.name} didn't remove ${appName(pkg)}: ${out.trim().slice(0, 120)}`);
  return done(`Removed ${appName(pkg)} from ${device.name}.`);
}

// ── The TV's screen ─────────────────────────────────────────────────────────

/** What's on the TV's screen, from Android's own view of it. Remembered for "select the second one". */
async function readScreen(client, device, ctx) {
  const file = "/data/local/tmp/patch-screen.xml";
  let xml = "";
  for (let attempt = 0; attempt < 2 && !xml.includes("<hierarchy"); attempt++) {
    const out = await sh(client, `uiautomator dump ${file} >/dev/null 2>&1; cat ${file} 2>/dev/null; rm -f ${file}`, 25_000).catch(() => "");
    xml = out.slice(Math.max(0, out.indexOf("<?xml")));
    if (!xml.includes("<hierarchy")) await sleep(800);
  }
  if (!xml.includes("<hierarchy")) throw new DeviceError(`I couldn't see ${device.name}'s screen just now (it may be playing a video). Try again in a moment.`, { code: "ESCREEN" });
  const tree = readUiTree(xml);
  const screen = { app: tree.package ? (LAUNCHERS.test(tree.package) ? "Home screen" : appName(tree.package)) : device.name, items: tree.items, more: tree.more, full: tree.full, at: Date.now() };
  ctx.memory?.set(`tv-screen:${device.id}`, screen);
  return screen;
}

async function selectOnScreen(client, device, value, ctx) {
  const v = String(need(value, "thing to select")).trim();
  const n = /^\d+$/.test(v) ? Number(v) - 1 : pickIndex(v);
  let screen = ctx.memory?.get(`tv-screen:${device.id}`);
  let item;
  if (n != null) {
    if (!screen || Date.now() - screen.at > 5 * 60_000) throw new DeviceError(`I need to look at ${device.name}'s screen first, so the numbers are right. Ask me what's on the screen.`, { code: "ESTALE" });
    item = n === -1 ? screen.items.at(-1) : screen.items[n];
    if (!item) throw new DeviceError(`There are only ${screen.items.length} things on the screen.`, { code: "EVALUE" });
  } else {
    screen = await readScreen(client, device, ctx);
    item = fuzzyPick(v, screen.items, (it) => it.text);
    if (!item) throw new DeviceError(`I can't see “${v}” on ${device.name}'s screen. It has: ${screen.items.slice(0, 8).map((it) => it.text).join(", ") || "nothing I can read"}.`, { code: "ENOTFOUND" });
  }
  if (riskyButton(item.text) && !ctx.confirmed) throw new DeviceError(`“${item.text}” on ${device.name} could buy, send or delete something.`, { code: "ECONFIRM" });
  if (/selected/.test(item.state || "")) await key(client, "KEYCODE_DPAD_CENTER");
  else await sh(client, `input tap ${item.x} ${item.y}`);
  ctx.memory?.delete(`tv-screen:${device.id}`);
  return done(`Selected “${item.text}” on ${device.name}.`);
}

// ── Web pages on the TV ─────────────────────────────────────────────────────
// Patch's own browser (one of its TV apps) shows the page, and Patch sees into it through the
// browser's debugging socket, which Android only opens to ADB: so Patch can list what's on a
// page, choose things by name, type and scroll, the way it does on the phone's screen.

/** The app in front: the one whose screen it is, even while a box of Android's own (the volume, "viewing full screen") has the focus for a moment. */
async function focusedPkg(client) {
  const out = await sh(client, "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'").catch(() => "");
  const named = (re) => out.match(re)?.[1] || null;
  return named(/mFocusedApp=.*?\s([A-Za-z0-9_.]+)\/[A-Za-z0-9_.$]+/) || named(/mCurrentFocus=.*?\s([A-Za-z0-9_.]+)\/[A-Za-z0-9_.$]+/);
}

/** Why Patch last couldn't use the page in front as a page (the Android build's check prints this when a step goes the other way). */
export const lastWeb = { why: "" };
// Apps whose pages Patch has seen into before: for those it's worth trying again before giving up.
const seenInto = new Set();

/** The name of an app's debugging socket, if its pages are open to Patch. */
async function devtoolsSocket(client, pkg) {
  const out = (await sh(client, `pidof ${pkg} 2>/dev/null; echo; cat /proc/net/unix 2>/dev/null`, 8000).catch(() => "")).replace(/\r/g, "");
  const pids = new Set(out.slice(0, Math.max(0, out.indexOf("\n"))).split(/\s+/).filter((x) => /^\d+$/.test(x)));
  const sockets = [...out.matchAll(/webview_devtools_remote_(\d+)/g)].map((m) => ({ name: m[0], pid: m[1] }));
  let hit = sockets.find((x) => pids.has(x.pid));
  if (!hit && !pids.size) {
    // An older TV with no "pidof": ask each socket's process which app it is.
    for (const x of sockets) {
      const who = await sh(client, `cat /proc/${x.pid}/cmdline 2>/dev/null`).catch(() => "");
      if (who.split("\0")[0].trim() === pkg) {
        hit = x;
        break;
      }
    }
  }
  // A TV that won't show its list of sockets at all: the app's own is named after its process, so try that.
  if (!hit && pids.size && !/RefCount|\/dev\/socket\/|@\w/.test(out)) return `webview_devtools_remote_${[...pids][0]}`;
  return hit?.name || null;
}

/** Patch's connection into the page an app is showing, or null if the app's pages aren't open to Patch. */
async function webSession(client, device, pkg, { wait = 0 } = {}) {
  const id = keyOf(device);
  const live = webs.get(id);
  if (live?.session.alive && live.pkg === pkg && live.client === client) return live.session;
  live?.session.close();
  webs.delete(id);
  let name = null;
  for (const end = Date.now() + wait; ; ) {
    name = await devtoolsSocket(client, pkg);
    if (name || Date.now() >= end) break;
    await sleep(400);
  }
  if (!name) return null;
  const session = await WebSession.connect(() => client.openStream(`localabstract:${name}`));
  webs.set(id, { session, pkg, client });
  seenInto.add(pkg);
  session.cdp.once("close", () => webs.get(id)?.session === session && webs.delete(id));
  return session;
}

/** The page in front, if one of Patch's own apps is showing it and Patch can see into it. */
async function webInFront(client, device) {
  const live = webs.get(keyOf(device));
  // If Android can't say which app is in front just now, it's the page Patch was using a moment ago.
  const pkg = (await focusedPkg(client)) || (live?.session.alive ? live.pkg : null);
  if (!pkg || !customAppNames.has(pkg)) {
    lastWeb.why = pkg ? `${pkg} is in front, which isn't one of Patch's apps` : "Android didn't say which app is in front";
    return null;
  }
  let session = null;
  let error = null;
  for (let i = 0; i < (seenInto.has(pkg) ? 3 : 1) && !session; i++) {
    if (i) await sleep(350);
    session = await webSession(client, device, pkg).catch((e) => {
      error = e;
      return null;
    });
  }
  if (!session) lastWeb.why = error ? `couldn't connect into ${pkg}'s page (${String(error.message).slice(0, 120)})` : `${pkg} has no debugging socket open`;
  return session ? { session, pkg } : null;
}

/** Open Patch's browser on the TV, putting it there the first time, and connect into its page. */
async function openBrowser(client, device, ctx) {
  const tv = ctx.tvapps;
  if (!tv) throw new DeviceError("This copy of Patch can't put its browser on a TV.", { code: "EUNSUPPORTED" });
  if (!(await tv.canSeePages())) throw new DeviceError("Using web pages on a TV needs Patch's newer TV app template, which it fetches from the internet. Check this computer's connection and try again.", { code: "ETEMPLATE" });
  const app = await tv.browser();
  const list = device.ref.packages?.length ? device.ref.packages : await packages(client, device);
  let fresh = false;
  if (!list.includes(app.package) || app.installs?.[device.id]?.version !== app.version) {
    const made = await tv.apk(app.id);
    await sideload(client, device, made.apk, { label: made.name, ours: true });
    await tv.installedOn(app.id, device.id, device.name);
    fresh = true;
  }
  if (fresh || (await focusedPkg(client)) !== app.package) await launchPkg(client, app.package);
  // The app needs a moment to start and draw its first page before there's anything to connect to.
  let session = null;
  for (let i = 0; i < (ctx.webTries ?? 7) && !session; i++) {
    session = await webSession(client, device, app.package, { wait: 1000 }).catch(() => null);
    if (!session) await sleep(400);
  }
  return { session, app, fresh };
}

/** The result of a step on a web page: what happened, and what the page shows now. */
function pageDone(device, pkg, r, lead) {
  const d = describePage(r.page, { where: appName(pkg) === pkg ? "Patch's browser" : appName(pkg) });
  const said = r.dialog ? (r.dialog.type === "alert" ? ` The page said: “${r.dialog.message}”.` : r.dialog.accepted ? ` The page asked “${r.dialog.message}” and I answered OK.` : ` The page asked “${r.dialog.message}”; I answered Cancel.`) : "";
  return done(`${lead}${said}`, { screen: d.text, state: { ...device.state, on: true, app: appName(pkg) } });
}
const showing = (page) => `“${page.title || hostOf(page.url) || "a page"}”${hostOf(page.url) ? ` (${hostOf(page.url)})` : ""}`;

/** A numbered thing ("3", "the second one") or its words. */
function webTarget(value) {
  const v = String(value).trim();
  if (/^\d{1,3}$/.test(v)) return Number(v);
  const n = pickIndex(v);
  return n != null && n >= 0 ? n + 1 : v;
}

async function webTap(device, web, value, ctx) {
  const v = String(need(value, "thing to choose")).trim();
  // "3 in How many", "Large from the size menu": a choice in a drop-down list.
  const pick = v.match(/^(.+?)\s+(?:in|from)\s+(?:the\s+)?(.+?)(?:\s+(?:menu|list|drop.?down))?$/i);
  if (pick) {
    const r = await web.session.choose(webTarget(pick[2]), pick[1]);
    if (r) return pageDone(device, web.pkg, r, `Chose “${r.chosen.chosen}” in “${r.chosen.text}” on ${device.name}.`);
  }
  const r = await web.session.click(webTarget(v), { confirmed: !!ctx.confirmed });
  const it = r.chose;
  if (r.menu) return pageDone(device, web.pkg, r, `“${it.text}” is a menu with these choices: ${r.menu.join(", ")}. To pick one, tap with “<choice> in ${it.text}”.`);
  if (r.secretBox) return pageDone(device, web.pkg, r, `“${it.text}” is for a password or card details. I don't type those: ask the person to type it with the TV's remote.`);
  if (r.ready) return pageDone(device, web.pkg, r, `“${it.text}” is ready for typing on ${device.name}. Use type_text with the words, then press_button “enter” if it needs sending.`);
  if (r.stray) return pageDone(device, web.pkg, r, `I pressed where “${it.text}” was on ${device.name}, but the page moved just then, and something else may have been pressed instead. Look at what it shows now before going on.`);
  const moved = r.page.url && it.href && hostOf(r.page.url) !== "" ? ` It's showing ${showing(r.page)} now.` : "";
  return pageDone(device, web.pkg, r, `Chose “${it.text}” on ${device.name}.${moved}`);
}

/** Facts about the device from ADB (exact model, manufacturer, Android version). */
async function deviceFacts(client) {
  const props = client.banner?.props || {};
  const out = await sh(client, 'echo "$(getprop ro.product.manufacturer)|$(getprop ro.product.model)|$(getprop ro.build.version.release)|$(settings get global device_name)"').catch(() => "");
  const [maker, model, android, name] = out.trim().split("|");
  return { maker: maker || null, model: model || props["ro.product.model"] || null, android: android || null, name: name && name !== "null" ? name : null };
}

const CAST_ACTIONS = ["set_volume", "volume_up", "volume_down", "mute", "unmute", "play", "pause", "stop"];
const ADB_ACTIONS = ["turn_on", "turn_off", "launch_app", "press_button", "type_text", "search_youtube", "play_youtube", "web_search", "open_website", "volume_up", "volume_down", "mute", "play", "pause", "list_apps", "install_app", "uninstall_app", "read_screen", "tap", "scroll", "search"];
const TV_EXTRA = ["set_channel", "channel_up", "channel_down"];

export function actionsFor({ kind, paired, cast: hasCast }) {
  const list = new Set();
  if (paired) ADB_ACTIONS.forEach((a) => list.add(a));
  if (paired && kind === "tv") TV_EXTRA.forEach((a) => list.add(a));
  if (hasCast) CAST_ACTIONS.forEach((a) => list.add(a));
  if (!paired) list.add("pair");
  return [...list, "rename", "set_room"];
}

export default {
  id: "androidtv",
  label: "Android TV / Fire TV",
  /** What it can do once it's connected. */
  readyActions: (d) => actionsFor({ kind: d.kind, paired: true, cast: !!d.ref?.cast }),

  async detect(host, ctx) {
    const svc = (t) => host.mdns.find((s) => s.type === t);
    const amzn = svc("_amzn-wplay._tcp");
    const atv = svc("_androidtvremote2._tcp");
    const gcast = host.mdns.find((s) => s.type === "_googlecast._tcp" && s.txt?.id && !(Number(s.txt.ca) & 32));
    const dial = host.ssdp.map((r) => r.desc).find((d) => d && /amazon/i.test(d.manufacturer || "") && /^AFT/i.test(d.modelName || ""));
    const adbOpen = host.ports.has(5555);
    if (!amzn && !atv && !dial && !(adbOpen && /amazon|google|nvidia|xiaomi|sony|tcl|hisense|philips|tp vision|onn|walmart/i.test(host.vendor || ""))) return null;

    const fire = fireTvModel(dial?.modelName || amzn?.txt?.ad || amzn?.txt?.md);
    const isFire = !!(amzn || dial || fire || /amazon/i.test(host.vendor || ""));
    const md = gcast?.txt?.md || "";
    const kind = fire ? fire.kind : isFire ? "streamer" : /chromecast|shield|streamer|box|stick|mi box|onn/i.test(md) ? "streamer" : "tv";
    const name = gcast?.txt?.fn || atv?.name || amzn?.txt?.n || dial?.friendlyName || (isFire ? "Fire TV" : "Android TV");
    const id = `androidtv:${String(host.mac || gcast?.txt?.id || host.ip).replace(/:/g, "").toLowerCase()}`;
    const paired = !!ctx?.secrets.pairings?.[id]?.adb;
    const device = {
      id,
      driver: "androidtv",
      kind,
      brand: isFire ? "Amazon" : gcast ? (/google|chromecast/i.test(md) ? "Google" : host.vendor || null) : host.vendor || null,
      model: fire?.name || (md || (isFire ? "Fire TV" : "Android TV")),
      name,
      ip: host.ip,
      ref: { ip: host.ip, adbPort: 5555, cast: gcast ? { ip: host.ip, port: gcast.port || 8009 } : null },
      state: {},
      info: { os: isFire ? "Fire OS" : "Android TV / Google TV", modelNumber: fire?.code || null },
      actions: [],
    };
    device.setup = paired ? null : { kind: adbOpen ? "tv-prompt" : "adb", message: adbOpen ? `Press Connect, then on ${name} tick "Always allow from this computer" and choose Allow.` : setupMessage(device) };
    device.actions = actionsFor({ kind, paired, cast: !!gcast });
    if (paired && adbOpen) {
      // Exact model and current app straight from the device.
      try {
        const client = await connect(device, ctx);
        const facts = await deviceFacts(client);
        const ft = fireTvModel(facts.model);
        if (ft) Object.assign(device, { model: ft.name, kind: ft.kind });
        else if (facts.model) device.model = facts.maker && !facts.model.toLowerCase().includes(facts.maker.toLowerCase()) ? `${facts.maker} ${facts.model}` : facts.model;
        if (facts.maker && !isFire && !device.brand) device.brand = facts.maker;
        device.info = { ...device.info, modelNumber: facts.model, os: `${isFire ? "Fire OS" : "Android"}${facts.android ? ` (Android ${facts.android})` : ""}` };
        if (facts.name && !gcast?.txt?.fn) device.name = facts.name;
        device.state = await liveState(client, device);
        device.actions = actionsFor({ kind: device.kind, paired, cast: !!gcast });
      } catch {
        /* keep what discovery said; it may be asleep */
      }
    }
    return [device];
  },

  async refresh(device, ctx) {
    if (!ctx.secrets.pairings?.[device.id]?.adb) {
      if (device.ref.cast) {
        const r = await cast.refresh({ ...device, ref: device.ref.cast });
        return { state: { ...device.state, ...r.state } };
      }
      return null;
    }
    const client = await connect(device, ctx);
    return { state: await liveState(client, device) };
  },

  /** A picture of the TV's screen as it is now (a PNG), for the person to look at in Patch. */
  async picture(device, ctx) {
    try {
      const client = await connect(device, ctx);
      const png = await client.exec("screencap -p", { timeout: 30_000 });
      if (png.length < 100 || png.readUInt32BE(0) !== 0x89504e47) throw new DeviceError(`${device.name} didn't give a picture of its screen.`, { code: "ESCREEN" });
      return png;
    } catch (err) {
      throw explainError(err, device.name);
    }
  },

  /** A tap at a spot on the screen (in the picture's own pixels): the person's own finger, from the dashboard. */
  async tapAt(device, x, y, ctx) {
    try {
      const client = await connect(device, ctx);
      await sh(client, `input tap ${Math.round(x)} ${Math.round(y)}`);
      ctx.memory?.delete(`tv-screen:${device.id}`);
      return done(`Tapped ${device.name}'s screen.`);
    } catch (err) {
      throw explainError(err, device.name);
    }
  },

  async act(device, action, value, ctx) {
    for (const [p, n] of Object.entries(ctx.secrets.appLabels || {})) knownLabels.set(p, n);
    try {
      const paired = !!ctx.secrets.pairings?.[device.id]?.adb;
      if (device.ref.cast && CAST_ACTIONS.includes(action) && (!paired || ["set_volume", "unmute", "stop"].includes(action))) {
        return await cast.act({ ...device, ref: device.ref.cast }, action, value);
      }
      if (action === "pair") {
        const client = await connect(device, ctx, { pairing: true });
        const facts = await deviceFacts(client).catch(() => ({}));
        const ft = fireTvModel(facts.model);
        const kind = ft?.kind || device.kind;
        return done(`${device.name} is connected. You can open apps, YouTube and websites on it now.`, {
          devices: [{ id: device.id, setup: null, kind, actions: actionsFor({ kind, paired: true, cast: !!device.ref.cast }), ...(ft ? { model: ft.name } : facts.model ? { model: facts.model } : {}), info: { ...device.info, modelNumber: facts.model || device.info?.modelNumber || null } }],
        });
      }
      const client = await connect(device, ctx);
      switch (action) {
        case "turn_on":
          await key(client, "KEYCODE_WAKEUP");
          return done(`${device.name} is on.`, { state: { ...device.state, on: true } });
        case "turn_off":
          await key(client, "KEYCODE_SLEEP");
          return done(`${device.name} is asleep.`, { state: { ...device.state, on: false } });
        case "volume_up":
        case "volume_down": {
          const times = Math.min(Math.max(Number(value) || 3, 1), 20);
          for (let i = 0; i < times; i++) await key(client, action === "volume_up" ? "KEYCODE_VOLUME_UP" : "KEYCODE_VOLUME_DOWN");
          return done(`Turned ${device.name} ${action === "volume_up" ? "up" : "down"} ${times} steps.`);
        }
        case "mute":
          await key(client, "KEYCODE_VOLUME_MUTE");
          return done(`Toggled mute on ${device.name}.`);
        case "play":
        case "pause":
          await key(client, action === "play" ? "KEYCODE_MEDIA_PLAY" : "KEYCODE_MEDIA_PAUSE");
          return done(action === "play" ? "Playing." : "Paused.");
        case "channel_up":
        case "channel_down":
          await key(client, action === "channel_up" ? "KEYCODE_CHANNEL_UP" : "KEYCODE_CHANNEL_DOWN");
          return done(`Channel ${action === "channel_up" ? "up" : "down"} on ${device.name}.`);
        case "set_channel": {
          const ch = parseChannel(value);
          if (ch.dir) {
            await key(client, ch.dir === "up" ? "KEYCODE_CHANNEL_UP" : "KEYCODE_CHANNEL_DOWN");
            return done(`Channel ${ch.dir} on ${device.name}.`);
          }
          if (ch.name) {
            // Streaming channels on Android TV are apps ("put on ESPN" → the ESPN app).
            const pkg = await findPackage(client, device, ch.name).catch(() => null);
            if (!pkg) throw new DeviceError(`I can change ${device.name}'s channel by number, or open a channel's app if it's installed. I couldn't find one for ${ch.name}.`, { code: "ENOTFOUND" });
            await launchPkg(client, pkg);
            return done(`Opening ${appName(pkg)} on ${device.name}.`, { state: { ...device.state, on: true, app: appName(pkg) } });
          }
          const codes = [...String(ch.major)].map((c) => `KEYCODE_${c}`);
          if (ch.minor != null) codes.push("KEYCODE_PERIOD", ...[...String(ch.minor)].map((c) => `KEYCODE_${c}`));
          await key(client, ...codes, "KEYCODE_ENTER");
          return done(`Changed ${device.name} to channel ${ch.number} (in its live TV app).`, { state: { ...device.state, channel: ch.number } });
        }
        case "press_button": {
          const k = normalizeText(need(value, "button")).replace(/\b\d+ times?\b/g, "").trim();
          if (k === "enter" || k === "back") {
            // On a web page Patch can see into: send the search or form, or go back a page, and say what shows now.
            const web = await webInFront(client, device);
            if (web && k === "enter") {
              const r = await web.session.enter({ confirmed: !!ctx.confirmed });
              return pageDone(device, web.pkg, r, `Pressed Enter on ${device.name}. It's showing ${showing(r.page)} now.`);
            }
            const r = web ? await web.session.back() : null;
            if (r) return pageDone(device, web.pkg, r, `Went back on ${device.name}. It's showing ${showing(r.page)} now.`);
          }
          const code = /^\d$/.test(k) ? `KEYCODE_${k}` : Object.hasOwn(KEYS, k) ? KEYS[k] : null;
          if (!code) throw new DeviceError(`I don't know the button "${value}". Try home, back, up, down, left, right, ok, play, pause or search.`, { code: "EVALUE" });
          const times = Math.min(Math.max(parseInt(String(value).match(/\b(\d+) times?\b/)?.[1] || "1", 10), 1), 10);
          for (let i = 0; i < times; i++) await key(client, code);
          return done(`Pressed ${value}.`);
        }
        case "launch_app": {
          const pkg = await findPackage(client, device, need(value, "app"));
          await launchPkg(client, pkg);
          return done(`Opening ${appName(pkg)} on ${device.name}.`, { state: { ...device.state, on: true, app: appName(pkg) } });
        }
        case "list_apps": {
          const apps = await launchableApps(client, device);
          return done(`${device.name} has ${apps.length} apps: ${apps.map((a) => a.name).join(", ")}.`, { apps: apps.map((a) => ({ name: a.name, id: a.pkg, removable: a.removable, ...(customAppNames.has(a.pkg) ? { madeWithPatch: true } : {}) })) });
        }
        case "install_app":
          return await installApp(client, device, value, ctx);
        case "uninstall_app":
          return await uninstallApp(client, device, value);
        case "read_screen": {
          const web = await webInFront(client, device);
          if (web) {
            const want = String(value || "").trim();
            const find = want.match(/^(?:find|look for|where is|search for)\s+(.+)$/i);
            if (find) {
              const r = await web.session.find(find[1]);
              return pageDone(device, web.pkg, r, r.found.count ? `“${find[1]}” is on the page ${r.found.count === 1 ? "once" : `${r.found.count} times`}. The first place says: “${r.found.text}”.` : `I can't find “${find[1]}” on this page.`);
            }
            if (/^(text|words|read|article|story|all|everything)\b/i.test(want)) {
              const text = await web.session.read();
              const page = await web.session.snapshot();
              return done(text ? `Here are the words of ${showing(page)} from where the screen is.` : `There are no words to read on ${showing(page)}.`, { screen: text || describePage(page).text });
            }
            const page = await web.session.snapshot();
            const d = describePage(page, { where: appName(web.pkg) === web.pkg ? "Patch's browser" : appName(web.pkg) });
            return done(d.summary, { screen: d.text });
          }
          const screen = await readScreen(client, device, ctx);
          const d = describeScreen(screen);
          const thin = screen.items.length < 3 ? ` ${screen.app} draws its own picture, so I can only read a little of it; I can still press the remote's buttons.` : "";
          return done(`${d.summary}${thin}`, { screen: d.text });
        }
        case "tap": {
          const web = await webInFront(client, device);
          if (web) return await webTap(device, web, value, ctx);
          return await selectOnScreen(client, device, value, ctx);
        }
        case "scroll": {
          const dir = normalizeText(value || "down");
          const web = await webInFront(client, device);
          if (web) {
            const r = await web.session.scroll(dir);
            return pageDone(device, web.pkg, r, r.moved ? `Moved ${r.dir === "top" ? "to the top of" : r.dir === "bottom" ? "to the bottom of" : `${r.dir} on`} the page on ${device.name}.` : `The page on ${device.name} doesn't go any further ${r.dir === "up" || r.dir === "top" ? "up" : "that way"}.`);
          }
          const code = /up/.test(dir) ? "KEYCODE_DPAD_UP" : /left/.test(dir) ? "KEYCODE_DPAD_LEFT" : /right/.test(dir) ? "KEYCODE_DPAD_RIGHT" : "KEYCODE_DPAD_DOWN";
          await key(client, code, code, code);
          ctx.memory?.delete(`tv-screen:${device.id}`);
          return done(`Moved ${code.replace("KEYCODE_DPAD_", "").toLowerCase()} on ${device.name}.`);
        }
        case "search": {
          const q = String(need(value, "search")).trim();
          const inApp = q.match(/^(.+?)\s+(?:in|on|using)\s+(?:the\s+)?(.+?)(?:\s+app)?$/i);
          const pkg = inApp ? await findPackage(client, device, inApp[2]).catch(() => null) : null;
          if (!pkg) {
            // On a web page with a search box of its own: search that site.
            const web = await webInFront(client, device);
            const typed = web ? await web.session.type(q).catch((e) => (e.code === "ENOFIELD" ? null : Promise.reject(e))) : null;
            if (typed) {
              const r = await web.session.enter({ confirmed: !!ctx.confirmed });
              return pageDone(device, web.pkg, r, `Searched for “${q}” in “${typed.box.text}” on ${device.name}. It's showing ${showing(r.page)} now.`);
            }
          }
          if (pkg) {
            const out = await sh(client, `am start -a android.intent.action.SEARCH --es query ${shellQuote(inApp[1])} ${pkg}`);
            if (!failed(out)) return done(`Searching ${appName(pkg)} for “${inApp[1]}” on ${device.name}.`, { state: { ...device.state, on: true, app: appName(pkg) } });
            await launchPkg(client, pkg);
            return done(`${appName(pkg)} is open on ${device.name}, but it doesn't take searches from Patch. Ask me what's on the screen and I'll find its search box.`, { state: { ...device.state, on: true, app: appName(pkg) } });
          }
          const out = await sh(client, `am start -a android.search.action.GLOBAL_SEARCH --es query ${shellQuote(q)}`);
          if (!failed(out)) return done(`Searching ${device.name} for “${q}”.`);
          throw new DeviceError(`${device.name} doesn't take searches from Patch. Tell me which app to search in, like “${q} in YouTube”.`, { code: "EUNSUPPORTED" });
        }
        case "type_text": {
          const web = await webInFront(client, device);
          if (web) {
            // "pizza into the search box" names the box; otherwise the one in use, or the page's search box.
            const raw = String(need(value, "text"));
            const into = raw.match(/^(.+?)\s+(?:into|in)\s+(?:the\s+)?(.+?)\s+(?:box|field)$/i);
            const r = await web.session.type(into ? into[1] : raw, into ? webTarget(into[2]) : null);
            return pageDone(device, web.pkg, r, `Typed “${r.typed}” in “${r.box.text}” on ${device.name}. If it needs sending, use press_button with “enter”.`);
          }
          const text = String(need(value, "text")).replace(/[^\x20-\x7e]/g, "");
          if (!text) throw new DeviceError("I can only type plain letters, numbers and punctuation on this TV.", { code: "EVALUE" });
          await sh(client, `input text ${shellQuote(text.replace(/ /g, "%s"))}`);
          return done(`Typed “${text}” on ${device.name}.`);
        }
        case "web_search":
        case "open_website": {
          const url = action === "web_search" ? webSearchUrl(need(value, "search")) : websiteOrSearch(value);
          let b = null;
          try {
            b = await openBrowser(client, device, ctx);
          } catch (err) {
            // No way to put Patch's browser on this TV right now: hand the page to whatever browser it has.
            if (!["EUNSUPPORTED", "ETEMPLATE", "EINSTALL"].includes(err.code)) throw err;
            if (!(await view(client, url))) throw new DeviceError(`${device.name} doesn't have a web browser, and Patch couldn't put its own on it (${err.message})`, { code: "ENOBROWSER" });
            return done(`${action === "web_search" ? `Searching the web for “${value}”` : `Opening ${url.replace(/^https:\/\//, "").replace(/\/$/, "")}`} on ${device.name}, in its own browser, which Patch can't see into.`, { state: { ...device.state, on: true, app: "Web browser" } });
          }
          const what = action === "web_search" ? `Searching the web for “${value}”` : `Opening ${url.replace(/^https:\/\//, "").replace(/\/$/, "")}`;
          if (!b.session) {
            // Patch's browser is open but Patch can't see into it on this TV: the page still opens in it.
            const out = await sh(client, `am start -n ${b.app.package}/app.patch.tvapp.AppActivity -a android.intent.action.VIEW -d ${shellQuote(url)}`);
            if (failed(out) && !(await view(client, url))) throw new DeviceError(`${device.name} couldn't open that page.`, { code: "ENOBROWSER" });
            return done(`${what} on ${device.name}, in Patch's browser. I can't see into the page on this TV, so use the remote to choose things: the arrows move the pointer and OK clicks.`, { state: { ...device.state, on: true, app: b.app.name } });
          }
          const r = await b.session.goto(url);
          const lead = action === "web_search" ? `Searched the web for “${value}” on ${device.name}.` : `${hostOf(url) || "The page"} is open on ${device.name}: ${showing(r.page)}.`;
          return pageDone(device, b.app.package, r, `${lead}${b.fresh ? ` (I put Patch's browser on ${device.name} for this: it's the one I can see and click in.)` : ""}`);
        }
        case "search_youtube": {
          const yt = await youtubePkg(client, device);
          return await youtubeSearch(device, value, ctx, {
            showOnTv: yt
              ? async (q) => {
                  const out = await sh(client, `am start -a android.intent.action.SEARCH --es query ${shellQuote(q)} ${yt}`);
                  if (!failed(out)) return "in YouTube";
                  return (await view(client, youtubeSearchUrl(q), yt)) ? "in YouTube" : false;
                }
              : null,
            browserSearch: async (q) => ((await view(client, youtubeSearchUrl(q))) ? "in the web browser" : false),
            openYouTube: yt ? () => launchPkg(client, yt) : null,
          });
        }
        case "play_youtube": {
          const yt = await youtubePkg(client, device);
          return await youtubePlay(device, value, ctx, {
            playVideo: async (id) => {
              if (!((yt && (await view(client, watchUrl(id), yt))) || (await view(client, watchUrl(id))))) throw new DeviceError(`${device.name} couldn't open the video. Is the YouTube app installed?`, { code: "ENOTINSTALLED" });
              await sleep(50);
            },
            showOnTv: yt
              ? async (q) => {
                  const out = await sh(client, `am start -a android.intent.action.SEARCH --es query ${shellQuote(q)} ${yt}`);
                  return failed(out) ? false : "in YouTube";
                }
              : null,
          });
        }
        default:
          throw unsupported(device, action);
      }
    } catch (err) {
      throw explainError(err, device.name);
    }
  },
};
