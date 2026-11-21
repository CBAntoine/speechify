// Patch's TV app maker: apps the person makes (a photo frame, their own video channel, a clock,
// a quiz…), kept in Patch's data folder and put on their TVs:
//  - Android TV, Google TV and Fire TV get a real app (built from Patch's TV app template, signed
//    with Patch's own key, installed over ADB), with its own name and icon in the TV's app list;
//  - Samsung and LG TVs open it in their web browser, served by Patch over the home WiFi at an
//    address with a long secret in it.
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { TEMPLATE, apkInfo, buildApp, pngSize } from "../apk/index.mjs";
import { letterImage } from "../apk/png.mjs";
import { newSigningKey } from "../apk/sign.mjs";
import { customAppNames } from "../drivers/tv.mjs";
import { ContentError, KINDS, makeSettings, summary } from "./kinds.mjs";
import { CLAUDE_NAME, changeRequest, newAppRequest, writeApp } from "./claude.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const RUNTIME = path.join(HERE, "runtime");
export const TEMPLATE_URL = "https://github.com/CBAntoine/speechify/releases/download/patch-android/PatchTVApp.apk";
const LIST_FIELD = { videos: "items", notes: "notes", radio: "stations", shortcuts: "apps", quiz: "questions" };
const MAX_PHOTOS = 80;
const COLORS = ["#5b6cff", "#ff7a59", "#2ec4b6", "#e84393", "#f4a261", "#43aa8b", "#9b5de5", "#00a6fb"];
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

export class TvAppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const imageType = (b) => (b[0] === 0xff && b[1] === 0xd8 ? ".jpg" : b.readUInt32BE(0) === 0x89504e47 ? ".png" : b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" ? ".webp" : null);
const cleanName = (s) => String(s ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
const cleanColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? String(c).toLowerCase() : null);
const cleanText = (s, max) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max);
const NO_CLAUDE = "Claude isn't set up yet: add your Anthropic API key in Patch's Settings, under Claude (Claude Max, Ultra and Team memberships include monthly API credits for it). Or ask Claude in the Claude app to build the app, then add its file in Patch under TV apps, Make a TV app, Your own code.";
const MAX_JOBS = 2;

const PUNCTUATION = /[\x21-\x26\x28-\x2c\x2e\x2f\x3a-\x40\x5b-\x60\x7b-\x7e\u00a1-\u00bf\u2000-\u206f\u3000-\u303f]+/g;

/** A short name from a description, for when none was given ("a snake game for the kids" → "Snake game"). */
function nameFrom(text) {
  const skip = /^(a|an|the|make|build|create|write|me|us|my|our|please|app|an?|for|that|which|with)$/i;
  // Punctuation goes (apostrophes and hyphens stay). No Unicode property classes (backslash p): the
  // phone's Node.js is built without the Unicode data they need, and a file using them won't load.
  const words = String(text).replace(PUNCTUATION, " ").split(/\s+/).filter(Boolean);
  while (words.length && skip.test(words[0])) words.shift();
  const cut = words.findIndex((w, i) => i > 0 && skip.test(w));
  const name = (cut > 0 ? words.slice(0, cut) : words).slice(0, 3).join(" ");
  return cleanName(name ? name[0].toUpperCase() + name.slice(1) : "") || "New app";
}

/** A PNG sent from the dashboard as a data: URL, checked for size. */
function pngFrom(dataUrl, width, height) {
  const m = String(dataUrl || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  const size = pngSize(buf);
  return size && size.width === width && size.height === height && buf.length < 2_000_000 ? buf : null;
}

export class TvApps {
  constructor({ store, controller, inventory, address = () => null, overrides = {}, log = () => {} }) {
    this.store = store;
    this.controller = controller;
    this.inventory = inventory;
    this.address = address;
    this.overrides = overrides;
    this.log = log;
    this.dir = path.join(store.dir, "tvapps");
    fs.mkdirSync(this.dir, { recursive: true });
    this.data = store.data.tvapps ??= { apps: {} };
    this.data.lanToken ||= crypto.randomBytes(18).toString("base64url");
    this.bundles = new Map();
    this.apks = new Map();
    this.lan = null;
    // Claude's builds in progress (app id → AbortController), and who to tell when something changes.
    this.jobs = new Map();
    this.onChange = () => {};
    this.onBuilt = () => {};
    for (const a of Object.values(this.data.apps)) {
      if (a.job && a.job.status !== "failed") a.job = { ...a.job, status: "failed", error: "Patch was closed while Claude was working on this. Try again.", code: "interrupted" };
    }
    this.syncNames();
  }

  get claudeKey() {
    return this.store.anthropic.apiKey;
  }

  get web() {
    const o = this.overrides;
    return {
      oembed: o.oembedBase || "https://www.youtube.com/oembed",
      geocode: o.geocodeBase || "https://geocoding-api.open-meteo.com/v1/search",
      radio: o.radioBases || ["https://all.api.radio-browser.info", "https://de1.api.radio-browser.info", "https://fi1.api.radio-browser.info"],
    };
  }

  ctx() {
    return { web: this.web, youtube: this.controller.ctx().youtube };
  }

  syncNames() {
    customAppNames.clear();
    for (const a of Object.values(this.data.apps)) customAppNames.set(a.package, a.name);
  }

  async save() {
    this.syncNames();
    await this.store.save();
  }

  appDir(id) {
    return path.join(this.dir, id);
  }

  get(id) {
    const a = this.data.apps[String(id || "")];
    if (a) return a;
    // By name, for the voice agent ("put the photo app on the TV").
    const want = String(id || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!want) return null;
    const all = Object.values(this.data.apps);
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return all.find((x) => norm(x.name) === want) || all.find((x) => norm(x.name).startsWith(want) || want.startsWith(norm(x.name))) || all.find((x) => norm(x.name).includes(want) || norm(KINDS[x.kind].label).includes(want)) || null;
  }

  need(id) {
    const a = this.get(id);
    if (!a) throw new TvAppError(Object.keys(this.data.apps).length ? `I can't find a TV app called “${id}”. You have: ${this.list().map((x) => x.name).join(", ")}.` : "You haven't made any TV apps yet.", 404);
    return a;
  }

  /** What the dashboard and the agent see. */
  publicApp(a) {
    return {
      id: a.id,
      package: a.package,
      name: a.name,
      kind: a.kind,
      kindLabel: a.madeBy === "claude" ? "Built by Claude" : KINDS[a.kind].label,
      emoji: a.emoji,
      color: a.color,
      version: a.version,
      created: a.created,
      updated: a.updated,
      summary: a.madeBy === "claude" ? a.about || a.requests?.[0]?.text || a.job?.text || "" : summary(a),
      madeBy: a.madeBy || null,
      about: a.about || null,
      // What the person asked Claude for, oldest first, and what Claude is doing now.
      requests: (a.requests || []).map((r) => r.text),
      built: a.version > 0,
      job: a.job ? { status: a.job.status, kind: a.job.kind, text: a.job.text, phase: a.job.phase || null, kb: Math.round((a.job.chars || 0) / 1024), started: a.job.started, error: a.job.error || null } : null,
      lastBuild: a.lastBuild || null,
      settings: a.settings,
      photos: (a.photos || []).map((p) => ({ name: p.name, caption: p.caption || null })),
      hasIcon: !!a.icon,
      tvs: Object.entries(a.installs || {}).map(([deviceId, i]) => {
        const d = this.inventory.get(deviceId);
        return { deviceId, name: d ? this.inventory.displayName(d) : i.name, how: i.how, upToDate: i.version === a.version, at: i.at };
      }),
    };
  }

  list() {
    return Object.values(this.data.apps)
      .sort((x, y) => y.updated - x.updated)
      .map((a) => this.publicApp(a));
  }

  kinds() {
    return Object.entries(KINDS).map(([id, k]) => ({ id, ...k }));
  }

  async #settings(kind, input, prev) {
    try {
      return await makeSettings(kind, input, this.ctx(), prev);
    } catch (err) {
      if (err instanceof ContentError) throw new TvAppError(err.message);
      throw err;
    }
  }

  async #saveArt(a, input) {
    const icon = pngFrom(input.icon, TEMPLATE.icon.width, TEMPLATE.icon.height);
    const banner = pngFrom(input.banner, TEMPLATE.banner.width, TEMPLATE.banner.height);
    if (icon) {
      await fsp.writeFile(path.join(this.appDir(a.id), "icon.png"), icon);
      a.icon = true;
    }
    if (banner) {
      await fsp.writeFile(path.join(this.appDir(a.id), "banner.png"), banner);
      a.banner = true;
    }
  }

  /** Make a new TV app: { name, kind, content?, settings?, emoji?, color?, icon?, banner? }. */
  async create(input = {}) {
    const kind = String(input.kind || "").toLowerCase();
    if (!KINDS[kind]) throw new TvAppError(`What kind of TV app? I can make: ${Object.values(KINDS).map((k) => k.label.toLowerCase()).join(", ")}.`);
    if (Object.keys(this.data.apps).length >= 50) throw new TvAppError("That's 50 TV apps already. Remove one you don't use first.");
    const made = await this.#settings(kind, input, null);
    let id;
    do id = `a${crypto.randomBytes(5).toString("hex")}`;
    while (this.data.apps[id]);
    const now = Date.now();
    const a = {
      id,
      package: `app.patch.tvapp.${id}`,
      name: cleanName(input.name) || KINDS[kind].label,
      kind,
      emoji: String(input.emoji || KINDS[kind].emoji).slice(0, 8),
      color: cleanColor(input.color) || COLORS[Object.keys(this.data.apps).length % COLORS.length],
      version: 1,
      created: now,
      updated: now,
      settings: made.settings,
      photos: [],
      installs: {},
    };
    await fsp.mkdir(this.appDir(id), { recursive: true });
    if (made.html) await fsp.writeFile(path.join(this.appDir(id), "custom.html"), made.html);
    await this.#saveArt(a, input);
    this.data.apps[id] = a;
    await this.save();
    return { ok: true, app: this.publicApp(a), message: `Made “${a.name}” (${KINDS[kind].label.toLowerCase()}: ${summary(a)}).${made.notes.length ? ` ${made.notes.join(" ")}` : ""}`, notes: made.notes };
  }

  /** Change an app: a new name, look or content. With add: true, list content is added to what's there. */
  async update(id, input = {}) {
    const a = this.need(id);
    let notes = [];
    if (input.content != null || input.settings != null) {
      if (this.jobs.has(a.id)) throw new TvAppError(`Claude is working on “${a.name}” right now. Wait until it's done.`, 409);
      const made = await this.#settings(a.kind, input, a);
      const field = LIST_FIELD[a.kind];
      if (input.add && field) made.settings[field] = [...(a.settings[field] || []), ...(made.settings[field] || [])];
      a.settings = made.settings;
      if (made.html) await fsp.writeFile(path.join(this.appDir(a.id), "custom.html"), made.html);
      notes = made.notes;
    }
    if (input.name != null && cleanName(input.name)) a.name = cleanName(input.name);
    if (input.emoji) a.emoji = String(input.emoji).slice(0, 8);
    if (cleanColor(input.color)) a.color = cleanColor(input.color);
    await this.#saveArt(a, input);
    // An app Claude hasn't built yet stays unbuilt (version 0) until it has its page.
    if (a.version) a.version++;
    a.updated = Date.now();
    await this.save();
    const stale = Object.keys(a.installs || {}).length;
    return { ok: true, app: this.publicApp(a), message: `Updated “${a.name}”.${notes.length ? ` ${notes.join(" ")}` : ""}${stale ? ` Put it on the TV again to send the new version.` : ""}`, notes };
  }

  /** Add photos the person sent from the dashboard (uploads), with optional captions. */
  async addPhotos(id, files = [], uploads) {
    const a = this.need(id);
    if (a.kind !== "photos") throw new TvAppError("Only photo frames have photos.");
    const dir = path.join(this.appDir(a.id), "photos");
    await fsp.mkdir(dir, { recursive: true });
    let added = 0;
    for (const f of files) {
      if ((a.photos || []).length >= MAX_PHOTOS) break;
      const up = uploads.get(f.upload);
      if (!up) continue;
      const data = await fsp.readFile(up.path);
      const ext = data.length > 12 ? imageType(data) : null;
      if (!ext || data.length > 8 * 1024 * 1024) continue;
      const name = `${crypto.randomBytes(4).toString("hex")}${ext}`;
      await fsp.writeFile(path.join(dir, name), data);
      a.photos.push({ name, caption: f.caption ? cleanName(f.caption) : null });
      added++;
    }
    if (!added) throw new TvAppError("Those didn't look like photos (JPEG, PNG or WebP, up to 8 MB each).");
    a.version++;
    a.updated = Date.now();
    await this.save();
    return { ok: true, app: this.publicApp(a), message: `Added ${added} photo${added === 1 ? "" : "s"} to “${a.name}”.${a.photos.length >= MAX_PHOTOS ? ` That's the most a photo frame can hold (${MAX_PHOTOS}).` : ""}` };
  }

  async removePhoto(id, name) {
    const a = this.need(id);
    const i = (a.photos || []).findIndex((p) => p.name === name);
    if (i < 0) throw new TvAppError("That photo isn't in the app.", 404);
    a.photos.splice(i, 1);
    await fsp.rm(path.join(this.appDir(a.id), "photos", path.basename(name)), { force: true });
    a.version++;
    a.updated = Date.now();
    await this.save();
    return { ok: true, app: this.publicApp(a), message: "Removed the photo." };
  }

  /** Delete an app from Patch, and (by default) from the Android TVs it's installed on. */
  async remove(id, { fromTvs = true } = {}) {
    const a = this.need(id);
    this.jobs.get(a.id)?.abort();
    this.jobs.delete(a.id);
    a.job = null;
    const results = [];
    if (fromTvs) {
      for (const [deviceId, inst] of Object.entries(a.installs || {})) {
        if (inst.how !== "app" || !this.inventory.get(deviceId)) continue;
        const r = await this.controller.act(deviceId, "uninstall_app", `tvapp:${a.package}`);
        results.push(`${this.inventory.displayName(this.inventory.get(deviceId))}: ${r.ok ? "removed" : r.message}`);
      }
    }
    delete this.data.apps[a.id];
    this.bundles.delete(a.id);
    this.apks.delete(a.id);
    await fsp.rm(this.appDir(a.id), { recursive: true, force: true });
    await this.save();
    return { ok: true, message: `Deleted “${a.name}”.${results.length ? ` ${results.join("; ")}.` : ""}` };
  }

  // ── The app's files ───────────────────────────────────────────────────────

  /** All of an app's files: index.html, the runtime, app.json and its photos. Map(name → Buffer). */
  async bundle(id) {
    const a = this.need(id);
    if (!a.version) throw new TvAppError(this.jobs.has(a.id) ? `Claude is still building “${a.name}”.` : `“${a.name}” wasn't built. Ask Claude to try again.`, 409);
    const cached = this.bundles.get(a.id);
    if (cached?.version === a.version) return cached.files;
    const files = new Map();
    const app = { id: a.id, name: a.name, kind: a.kind, emoji: a.emoji, color: a.color, version: a.version, settings: a.settings, photos: (a.photos || []).map((p) => ({ src: `photos/${p.name}`, caption: p.caption || null })) };
    if (a.kind === "custom") {
      files.set("index.html", await fsp.readFile(path.join(this.appDir(a.id), "custom.html")));
    } else {
      const json = JSON.stringify(app).replace(/[<\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
      files.set(
        "index.html",
        Buffer.from(`<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(a.name)}</title><link rel="stylesheet" href="tvkit.css"></head>\n<body class="kind-${a.kind}"><div id="app"></div>\n<script>window.APP = ${json};</script>\n<script src="tvkit.js"></script></body></html>\n`),
      );
      files.set("tvkit.js", await fsp.readFile(path.join(RUNTIME, "tvkit.js")));
      files.set("tvkit.css", await fsp.readFile(path.join(RUNTIME, "tvkit.css")));
    }
    // For Patch's Android TV app: what kind of app it is (a website opens the site itself).
    files.set("app.json", Buffer.from(JSON.stringify({ name: a.name, kind: a.kind, url: a.kind === "website" ? a.settings.url : null, version: a.version })));
    for (const p of a.photos || []) files.set(`photos/${p.name}`, await fsp.readFile(path.join(this.appDir(a.id), "photos", p.name)));
    this.bundles.set(a.id, { version: a.version, files });
    return files;
  }

  /** Serve one of an app's files (the dashboard's preview and TVs' browsers). */
  async serveFile(res, id, rel, headers = {}) {
    const name = rel.replace(/^\/+/, "") || "index.html";
    const files = this.data.apps[id] ? await this.bundle(id) : null;
    const body = files?.get(name);
    if (!body) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(name)] || "application/octet-stream", "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...headers });
    res.end(body);
  }

  // ── The Android TV app ────────────────────────────────────────────────────

  async template() {
    if (this.overrides.tvappTemplate) return this.overrides.tvappTemplate;
    if (this.templateApk) return this.templateApk;
    for (const p of [path.join(ROOT, "tvapp", "template.apk"), path.join(this.dir, "template.apk")]) {
      if (fs.existsSync(p)) return (this.templateApk = await fsp.readFile(p));
    }
    // A copy of Patch running from its source code fetches the template the Android build publishes.
    let buf = null;
    try {
      const res = await fetch(process.env.PATCH_TVAPP_TEMPLATE_URL || TEMPLATE_URL, { redirect: "follow", signal: AbortSignal.timeout(90_000) });
      if (res.ok) buf = Buffer.from(await res.arrayBuffer());
    } catch {
      /* below */
    }
    if (!buf || apkInfo(buf).package !== TEMPLATE.package) throw new TvAppError("Patch couldn't get its Android TV app template. Check the internet connection and try again.", 502);
    await fsp.writeFile(path.join(this.dir, "template.apk"), buf);
    return (this.templateApk = buf);
  }

  async signingKey() {
    if (!this.store.data.tvappSigning?.key) {
      this.store.data.tvappSigning = newSigningKey();
      await this.store.save();
    }
    return this.store.data.tvappSigning;
  }

  /** The app as an Android app file: { apk, name, package } (made once per version). */
  async apk(id) {
    const a = this.need(id);
    const cached = this.apks.get(a.id);
    if (cached?.version === a.version) return cached;
    const files = await this.bundle(a.id);
    const art = async (file, w, h) => (a[file] ? fsp.readFile(path.join(this.appDir(a.id), `${file}.png`)).catch(() => null) : null) || letterImage(w, h, { name: a.name, color: a.color });
    const apk = buildApp(
      await this.template(),
      {
        packageName: a.package,
        label: a.name,
        versionCode: a.version,
        versionName: `1.${a.version}`,
        icon: await art("icon", TEMPLATE.icon.width, TEMPLATE.icon.height),
        banner: await art("banner", TEMPLATE.banner.width, TEMPLATE.banner.height),
        files: [...files].map(([name, data]) => ({ name, data, store: /\.(jpg|png|webp)$/i.test(name) })),
      },
      await this.signingKey(),
    );
    const out = { apk, name: a.name, package: a.package, version: a.version };
    this.apks.set(a.id, out);
    return out;
  }

  // ── Putting it on a TV ────────────────────────────────────────────────────

  /** The TV to use: the one named, or the only one that can take apps. */
  #tv(query, a) {
    const able = (d) => d.driver === "androidtv" || ((d.driver === "samsung" || d.driver === "lgwebos") && d.kind === "tv");
    if (query) {
      const r = this.inventory.resolve(query, {});
      if (r.ambiguous) throw new TvAppError(`Which TV: ${r.ambiguous.map((d) => this.inventory.displayName(d)).join(", ")}?`);
      if (!r.device) throw new TvAppError(`I couldn't find a TV called “${query}”.`, 404);
      return r.device;
    }
    const tvs = this.inventory.all().filter((d) => able(d) && d.online !== false && !(a.kind === "shortcuts" && d.driver !== "androidtv"));
    if (tvs.length === 1) return tvs[0];
    if (!tvs.length) throw new TvAppError("I haven't found a TV that can take apps yet: Android TV, Google TV and Fire TV can install them, and Samsung and LG TVs can open them. Scan for devices, or tell me which TV.", 404);
    throw new TvAppError(`Which TV: ${tvs.map((d) => this.inventory.displayName(d)).join(", ")}?`);
  }

  /** Put an app on a TV: install it (Android TV, Fire TV) or open it in the TV's browser (Samsung, LG). */
  async putOnTv(id, query) {
    const a = this.need(id);
    if (!a.version) throw new TvAppError(this.jobs.has(a.id) ? `Claude is still building “${a.name}”. I'll put it on the TV when it's ready.` : `“${a.name}” wasn't built. Ask Claude to try again.`, 409);
    const d = this.#tv(query, a);
    const name = this.inventory.displayName(d);
    if (d.driver === "androidtv") {
      const r = await this.controller.act(d.id, "install_app", `tvapp:${a.id}`);
      if (r.ok) {
        a.installs[d.id] = { version: a.version, at: Date.now(), how: "app", name };
        await this.save();
      }
      return { ...r, app: this.publicApp(a) };
    }
    if (a.kind === "shortcuts") throw new TvAppError(`App shortcuts only work on Android TV, Google TV and Fire TV, and ${name} isn't one.`);
    if (d.driver === "samsung" || d.driver === "lgwebos" || d.actions?.includes("open_website")) {
      const url = a.kind === "website" ? a.settings.url : `${await this.lanBase()}/${a.id}/`;
      const r = await this.controller.act(d.id, "open_website", url);
      if (!r.ok) return { ...r, app: this.publicApp(a) };
      a.installs[d.id] = { version: a.version, at: Date.now(), how: "browser", name };
      await this.save();
      return {
        ...r,
        app: this.publicApp(a),
        message: `“${a.name}” is open in ${name}'s web browser.${a.kind === "website" ? "" : " It comes from Patch, so keep Patch running while you use it."} To open it again later, ask me or bookmark it in the TV's browser.`,
      };
    }
    throw new TvAppError(`${name} can't take apps from Patch. Android TV, Google TV and Fire TV can install them, and Samsung and LG TVs can open them in their browser.`);
  }

  /** Open an app that's already on a TV (installing it first if needed). */
  async open(id, query) {
    const a = this.need(id);
    const d = this.#tv(query, a);
    if (d.driver !== "androidtv") return this.putOnTv(a.id, d.id);
    const inst = a.installs[d.id];
    if (!inst || inst.version !== a.version) return this.putOnTv(a.id, d.id);
    const r = await this.controller.act(d.id, "launch_app", a.name);
    if (!r.ok && /isn't installed|doesn't seem to be installed/.test(r.message)) return this.putOnTv(a.id, d.id);
    return { ...r, app: this.publicApp(a) };
  }

  // ── Apps Claude builds ────────────────────────────────────────────────────

  /** A device that can take apps (the TVs, and phones and computers through their browser). */
  #target(query) {
    const d = this.#tv(query, { kind: "custom" });
    if (d.driver === "androidtv" || d.driver === "samsung" || d.driver === "lgwebos" || d.actions?.includes("open_website")) return d;
    throw new TvAppError(`${this.inventory.displayName(d)} can't take apps from Patch. Android TV, Google TV and Fire TV can install them, and Samsung and LG TVs, phones and computers can open them in their browser.`);
  }

  /** Where an app will run, for Claude: "Living Room TV, an Amazon Fire TV Stick (installed as an app)". */
  #where(deviceIds) {
    const parts = [];
    for (const id of deviceIds) {
      const d = this.inventory.get(id);
      if (!d) continue;
      const how = d.driver === "androidtv" ? "installed as an app, used with the remote" : d.kind === "tv" ? "in the TV's web browser, used with the remote" : `in the web browser of a ${d.kind === "phone" ? "phone, with touch" : "computer, with a mouse"}`;
      const what = this.inventory.toPublic(d).what;
      parts.push(`${this.inventory.displayName(d)}${what ? `, ${what}` : ""} (${how})`);
    }
    return parts.join("; ");
  }

  #checkClaude() {
    if (!this.claudeKey) throw new TvAppError(NO_CLAUDE, 412);
    if (this.jobs.size >= MAX_JOBS) throw new TvAppError(`Claude is already working on ${this.jobs.size} apps. Wait for one to finish first.`, 429);
  }

  /** Claude builds a new app from the person's description: { description, name?, emoji?, color?, icon?, banner?, device? }. */
  async build(input = {}) {
    this.#checkClaude();
    const description = cleanText(input.description ?? input.content, 6000);
    if (description.length < 3) throw new TvAppError("What should the app do? Describe it in a sentence or two.");
    if (Object.keys(this.data.apps).length >= 50) throw new TvAppError("That's 50 TV apps already. Remove one you don't use first.");
    const target = input.device ? this.#target(String(input.device)) : null;
    let id;
    do id = `a${crypto.randomBytes(5).toString("hex")}`;
    while (this.data.apps[id]);
    const now = Date.now();
    const a = {
      id,
      package: `app.patch.tvapp.${id}`,
      name: cleanName(input.name) || nameFrom(description),
      kind: "custom",
      madeBy: "claude",
      emoji: String(input.emoji || "✨").slice(0, 8),
      color: cleanColor(input.color) || COLORS[Object.keys(this.data.apps).length % COLORS.length],
      version: 0,
      created: now,
      updated: now,
      settings: {},
      photos: [],
      installs: {},
      requests: [],
    };
    await fsp.mkdir(this.appDir(id), { recursive: true });
    await this.#saveArt(a, input);
    this.data.apps[id] = a;
    this.#startJob(a, { kind: "new", text: description, devices: target ? [target.id] : [] });
    await this.save();
    return {
      ok: true,
      app: this.publicApp(a),
      message: `Claude (${CLAUDE_NAME}) is building “${a.name}”. That usually takes two to four minutes${target ? `, then I'll put it on ${this.inventory.displayName(target)}` : ""}. I'll say when it's ready.`,
    };
  }

  /** Claude changes an app it built (or one in the person's own code): { instruction, device? }. */
  async improve(id, input = {}) {
    const a = this.need(id);
    if (this.jobs.has(a.id)) throw new TvAppError(`Claude is still working on “${a.name}”. I'll say when it's done.`, 409);
    if (a.kind !== "custom") throw new TvAppError(`Claude changes the apps it built. “${a.name}” is a ${KINDS[a.kind].label.toLowerCase()}: change what's in it instead, or ask Claude to build a new app.`);
    if (!a.version) throw new TvAppError(`“${a.name}” wasn't built yet. Ask Claude to try again first.`, 409);
    this.#checkClaude();
    const instruction = cleanText(input.instruction ?? input.content, 6000);
    if (instruction.length < 3) throw new TvAppError(`What should Claude change in “${a.name}”?`);
    const devices = input.device ? [this.#target(String(input.device)).id] : Object.keys(a.installs || {}).filter((d) => this.inventory.get(d));
    this.#startJob(a, { kind: "change", text: instruction, devices });
    await this.save();
    const names = devices.map((d) => this.inventory.displayName(this.inventory.get(d)));
    return { ok: true, app: this.publicApp(a), message: `Claude is changing “${a.name}”. That usually takes two or three minutes${names.length ? `, then I'll update it on ${names.join(" and ")}` : ""}. I'll say when it's done.` };
  }

  /** Run a request that didn't work again. */
  async retry(id) {
    const a = this.need(id);
    if (this.jobs.has(a.id)) throw new TvAppError(`Claude is already working on “${a.name}”.`, 409);
    if (a.job?.status !== "failed") throw new TvAppError(`There's nothing to try again for “${a.name}”.`, 409);
    this.#checkClaude();
    this.#startJob(a, { kind: a.job.kind, text: a.job.text, devices: (a.job.devices || []).filter((d) => this.inventory.get(d)) });
    await this.save();
    return { ok: true, app: this.publicApp(a), message: `Claude is trying “${a.name}” again.` };
  }

  /** Stop Claude. A new app that was never built goes away; a change leaves the app as it was. */
  async cancel(id) {
    const a = this.need(id);
    const abort = this.jobs.get(a.id);
    if (!abort && a.job?.status !== "failed") throw new TvAppError(`Claude isn't working on “${a.name}”.`, 409);
    const kind = a.job?.kind;
    abort?.abort();
    this.jobs.delete(a.id);
    a.job = null;
    if (!a.version) {
      delete this.data.apps[a.id];
      await fsp.rm(this.appDir(a.id), { recursive: true, force: true });
      await this.save();
      return { ok: true, message: `Stopped. “${a.name}” wasn't built.` };
    }
    await this.save();
    return { ok: true, app: this.publicApp(a), message: kind === "change" ? `Stopped. “${a.name}” is as it was.` : `Stopped.` };
  }

  #startJob(a, { kind, text, devices = [] }) {
    const job = { status: "building", kind, text, devices, phase: "starting", chars: 0, started: Date.now() };
    const abort = new AbortController();
    a.job = job;
    this.jobs.set(a.id, abort);
    this.#run(a, job, abort).catch((err) => this.log(`[patch] Claude: ${err.stack || err.message}`));
  }

  async #run(a, job, abort) {
    const current = () => this.data.apps[a.id] === a && a.job === job;
    let shown = 0;
    let made;
    try {
      const where = this.#where(job.devices.length ? job.devices : Object.keys(a.installs || {}));
      const request =
        job.kind === "change"
          ? changeRequest({ name: a.name, html: await fsp.readFile(path.join(this.appDir(a.id), "custom.html"), "utf8"), instruction: job.text, history: (a.requests || []).map((r) => r.text), where })
          : newAppRequest({ description: job.text, name: a.name, where });
      made = await writeApp({
        apiKey: this.claudeKey,
        baseURL: this.overrides.claudeBase,
        request,
        signal: abort.signal,
        onProgress: (p) => {
          if (!current()) return;
          job.phase = p.phase;
          job.chars = p.chars;
          if (Date.now() - shown > 750) {
            shown = Date.now();
            this.onChange();
          }
        },
      });
    } catch (err) {
      if (!current()) return;
      this.jobs.delete(a.id);
      a.job = { ...job, status: "failed", error: err.message, code: err.code || "claude", ended: Date.now() };
      await this.save();
      this.onChange();
      const what = job.kind === "change" ? `change “${a.name}”` : `build “${a.name}”`;
      this.onBuilt({ ok: false, app: this.publicApp(a), message: `Claude couldn't ${what}. ${err.message}` });
      return;
    }
    if (!current()) return;
    await fsp.writeFile(path.join(this.appDir(a.id), "custom.html"), made.html);
    a.madeBy = "claude";
    if (made.about) a.about = made.about;
    a.requests = [...(a.requests || []), { text: job.text, at: Date.now() }].slice(-20);
    a.version++;
    a.updated = Date.now();
    job.status = "installing";
    job.phase = "installing";
    await this.save();
    this.onChange();
    // Then onto the TVs it's for (a new version installs over the old one).
    const notes = [];
    for (const d of job.devices) {
      if (!current()) break;
      try {
        const r = await this.putOnTv(a.id, d);
        notes.push(r.message);
      } catch (err) {
        notes.push(err.message);
      }
    }
    if (!this.data.apps[a.id]) return;
    this.jobs.delete(a.id);
    if (a.job === job) a.job = null;
    const message = `${job.kind === "change" ? `Claude changed “${a.name}”.` : `Claude built “${a.name}”.`}${a.about ? ` ${a.about}` : ""}${notes.length ? ` ${notes.join(" ")}` : " It isn't on a TV yet: say which one to put it on."}`;
    a.lastBuild = { at: Date.now(), kind: job.kind, model: made.model, cost: made.cost, message };
    await this.save();
    this.onChange();
    this.onBuilt({ ok: true, app: this.publicApp(a), message, cost: made.cost });
  }

  // ── Serving apps to TV browsers over the WiFi ─────────────────────────────

  async lanBase() {
    const ip = this.address();
    if (!ip) throw new TvAppError("Patch doesn't know its address on the WiFi yet. Scan for devices, then try again.", 503);
    if (!this.lan) {
      const server = http.createServer((req, res) => this.#serveLan(req, res).catch(() => res.end()));
      const port = await new Promise((resolve, reject) => {
        const tryPort = (p) => {
          server.once("error", (err) => (err.code === "EADDRINUSE" && p !== 0 ? tryPort(0) : reject(err)));
          server.listen(p, "0.0.0.0", () => resolve(server.address().port));
        };
        tryPort(this.overrides.tvappsPort ?? 4546);
      });
      this.lan = { server, port };
      this.log(`[patch] TV apps are served to TV browsers on port ${port}`);
    }
    return `http://${ip}:${this.lan.port}/${this.data.lanToken}`;
  }

  async #serveLan(req, res) {
    const m = String(req.url || "").split("?")[0].match(/^\/([A-Za-z0-9_-]+)\/(a[0-9a-f]{10})\/(.*)$/);
    const ok = m && req.method === "GET" && crypto.timingSafeEqual(crypto.createHash("sha256").update(m[1]).digest(), crypto.createHash("sha256").update(this.data.lanToken).digest());
    if (!ok) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found");
    }
    return this.serveFile(res, m[2], decodeURIComponent(m[3]));
  }

  async close() {
    if (this.lan) await new Promise((r) => this.lan.server.close(r));
    this.lan = null;
  }
}
