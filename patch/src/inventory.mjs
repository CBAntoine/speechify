// The device list: merges what each scan finds with what Patch remembers (your names and rooms),
// tracks online/offline and "new on the network", and turns spoken names into devices.
import { EventEmitter } from "node:events";
import { KIND_LABEL } from "./drivers/generic.mjs";
import { confidenceOf, describeDevice } from "./identify.mjs";
import { ipToInt, levenshtein, normalizeText } from "./util.mjs";

export const KIND_WORDS = {
  light: ["light", "lights", "lamp", "lamps", "bulb", "bulbs", "led", "leds", "lighting", "strip lights", "light strip"],
  plug: ["plug", "plugs", "outlet", "outlets", "socket", "sockets", "smart plug"],
  switch: ["switch", "switches", "relay"],
  strip: ["power strip", "power bar"],
  tv: ["tv", "tvs", "television", "telly"],
  streamer: ["roku", "chromecast", "apple tv", "fire tv", "fire stick", "streamer", "streaming stick"],
  speaker: ["speaker", "speakers", "sonos", "homepod", "soundbar", "music"],
  display: ["display", "nest hub"],
  printer: ["printer", "printers", "scanner"],
  router: ["router", "wifi", "wi fi", "modem", "gateway", "internet"],
  network: ["extender", "mesh", "access point", "repeater"],
  computer: ["computer", "computers", "pc", "laptop", "desktop", "mac", "macbook", "imac", "raspberry pi"],
  phone: ["phone", "phones", "iphone", "android"],
  tablet: ["tablet", "ipad"],
  camera: ["camera", "cameras", "cam", "doorbell"],
  thermostat: ["thermostat", "heating", "heater", "air conditioning", "ac", "temperature", "climate"],
  lock: ["lock", "locks", "deadbolt"],
  garage: ["garage", "garage door", "gate"],
  cover: ["blinds", "blind", "shades", "shade", "curtains", "curtain"],
  vacuum: ["vacuum", "roomba", "hoover"],
  fan: ["fan", "fans"],
  nas: ["nas", "storage", "file server"],
  console: ["xbox", "playstation", "ps5", "ps4", "console"],
  hub: ["hub", "bridge", "home assistant"],
  group: ["speaker group", "everywhere"],
  scene: ["scene", "scenes", "script", "routine"],
};

const STOP = new Set(["the", "my", "a", "an", "please", "in", "on", "of", "to", "device", "devices", "thing", "one", "that", "this", "and", "for", "all", "every", "our", "at", "up", "down", "off", "turn", "set"]);

// Which kinds count when someone says e.g. "lights": rooms and Hue zones are groups of lights.
const KIND_ALIASES = { light: ["light", "room"], speaker: ["speaker", "group", "display"], tv: ["tv", "streamer"], streamer: ["streamer", "tv"], plug: ["plug", "switch", "strip"], switch: ["switch", "plug"], computer: ["computer", "nas"] };

export function kindHints(text) {
  const n = ` ${normalizeText(text)} `;
  const hits = new Set();
  const words = new Set();
  for (const [kind, list] of Object.entries(KIND_WORDS)) {
    for (const w of list) {
      if (n.includes(` ${w} `)) {
        hits.add(kind);
        w.split(" ").forEach((x) => words.add(x));
      }
    }
  }
  return { kinds: hits, words };
}

export function kindMatches(device, kinds) {
  for (const k of kinds) if ((KIND_ALIASES[k] || [k]).includes(device.kind)) return true;
  return false;
}

const tokens = (s) => normalizeText(s).split(" ").filter(Boolean);
const tokenHit = (t, fields) => fields.some((f) => f === t || (t.length >= 4 && f.length >= 4 && (f.startsWith(t) || t.startsWith(f) || levenshtein(f, t) <= 1)));

export class Inventory extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.devices = new Map();
    for (const d of store.savedDevices || []) {
      if (d?.id) this.devices.set(d.id, { ...d, online: null });
    }
  }

  meta(id) {
    return this.store.data.meta[id] || {};
  }

  displayName(d) {
    return this.meta(d.id).name || d.name || "Device";
  }

  room(d) {
    return this.meta(d.id).room ?? d.room ?? null;
  }

  get(id) {
    return this.devices.get(id) || null;
  }

  all({ includeHidden = false } = {}) {
    return [...this.devices.values()].filter((d) => includeHidden || !this.meta(d.id).hidden);
  }

  /** Move your name and room from an old record to a new one (e.g. once a generic device gets identified). */
  migrateMeta(fromId, toId) {
    const m = this.store.data.meta[fromId];
    if (m && !this.store.data.meta[toId]) {
      this.store.data.meta[toId] = m;
      delete this.store.data.meta[fromId];
      this.store.save();
    }
  }

  upsert(dev, { scanId = null } = {}) {
    let prev = this.devices.get(dev.id);
    if (!prev && dev.driver !== "generic" && !dev.parent) {
      // A device that used to be "unknown" has been identified: carry its history over.
      const old = [...this.devices.values()].find((d) => d.driver === "generic" && ((dev.mac && d.mac === dev.mac) || (!dev.mac && d.ip === dev.ip)));
      if (old) {
        this.devices.delete(old.id);
        this.migrateMeta(old.id, dev.id);
        prev = { firstSeen: old.firstSeen };
      }
    }
    const now = Date.now();
    const online = dev.online ?? true;
    const merged = {
      ...prev,
      ...dev,
      state: dev.state ?? prev?.state ?? {},
      info: { ...(prev?.info || {}), ...(dev.info || {}) },
      firstSeen: prev?.firstSeen || now,
      lastSeen: online ? now : prev?.lastSeen ?? null,
      online,
      scanId: scanId ?? prev?.scanId ?? null,
    };
    this.devices.set(dev.id, merged);
    this.changed(merged);
    return merged;
  }

  patch(id, fields) {
    const d = this.devices.get(id);
    if (!d) return null;
    const next = { ...d, ...fields, state: fields.state ? { ...d.state, ...fields.state } : d.state, info: fields.info ? { ...d.info, ...fields.info } : d.info };
    if (fields.online) next.lastSeen = Date.now();
    this.devices.set(id, next);
    this.changed(next);
    return next;
  }

  remove(id) {
    this.devices.delete(id);
    this.changed(null);
  }

  /** After a scan: anything that didn't turn up is offline. */
  finishScan(scanId) {
    for (const d of this.devices.values()) {
      if (d.scanId !== scanId && d.online !== false) {
        d.online = false;
        this.changed(d);
      }
    }
    this.persist();
  }

  changed(d) {
    this.emit("change", d);
    this.persist();
  }

  persist() {
    this.store.saveDevices([...this.devices.values()].map(({ online, ...d }) => d));
  }

  /** Joined the WiFi recently. Bulbs behind a bridge and Home Assistant entities aren't on the WiFi themselves. */
  isNew(d) {
    const first = this.store.data.history.firstScanAt;
    if (!first || d.parent || d.self || !d.ip || d.driver === "homeassistant") return false;
    return d.firstSeen > first + 60_000 && Date.now() - d.firstSeen < 3 * 86_400_000;
  }

  /** What the dashboard and the voice agent get (no driver internals). */
  toPublic(d) {
    const m = this.meta(d.id);
    const what = d.self ? `${d.brand || "Computer"} running Patch${d.info?.platform ? ` (${d.info.platform})` : ""}` : describeDevice(d);
    return {
      id: d.id,
      name: this.displayName(d),
      reportedName: d.name,
      kind: d.kind,
      kindLabel: KIND_LABEL[d.kind] || "Device",
      brand: d.brand || null,
      model: d.model || null,
      what,
      confidence: confidenceOf(d),
      evidence: d.info?.identity?.evidence || [],
      ip: d.ip || null,
      mac: d.mac || null,
      vendor: d.vendor || null,
      room: this.room(d),
      online: d.online,
      lastSeen: d.lastSeen || null,
      firstSeen: d.firstSeen || null,
      isNew: this.isNew(d),
      driver: d.driver,
      parent: d.parent || null,
      self: !!d.self,
      actions: d.actions || [],
      state: d.state || {},
      info: d.info || {},
      ports: d.ports || [],
      webUrl: d.webUrl || null,
      setup: d.setup || null,
      hidden: !!m.hidden,
      hasPassword: !!this.store.data.credentials[d.parent || d.id],
    };
  }

  list(opts) {
    const order = { router: 0, hub: 1, network: 2 };
    return this.all(opts)
      .map((d) => this.toPublic(d))
      .sort((a, b) => (order[a.kind] ?? 5) - (order[b.kind] ?? 5) || (a.online === false) - (b.online === false) || a.name.localeCompare(b.name) || (ipToInt(a.ip) || 0) - (ipToInt(b.ip) || 0));
  }

  /**
   * Find the device someone means: "kitchen light", "the TV", "Office plug", an exact id…
   * Returns { device } | { ambiguous: [...] } | { none: true, suggestions: [...] }.
   */
  resolve(query, { kind, action } = {}) {
    const raw = String(query || "").trim();
    if (!raw) return { none: true, suggestions: [] };
    if (this.devices.has(raw)) return { device: this.devices.get(raw) };
    // "this computer", "here", "my browser": the computer Patch is running on.
    const self = [...this.devices.values()].find((d) => d.self);
    if (self && /^((this|my|the)\s+(own\s+)?(computer|pc|laptop|mac|desktop|browser|machine|screen)(\s+here)?|here|right here|my browser|the browser|on here)$/i.test(raw)) return { device: self };
    const byIp = [...this.devices.values()].filter((d) => d.ip === raw && !d.parent);
    if (byIp.length === 1) return { device: byIp[0] };

    const q = normalizeText(raw);
    const hints = kindHints(raw);
    if (kind) hints.kinds.add(kind);
    const content = tokens(raw).filter((t) => !STOP.has(t) && !hints.words.has(t));
    // "the fire tv": every word is also a kind word, but they still say which device ("Fire TV Stick").
    const kindOnly = content.length ? [] : tokens(raw).filter((t) => !STOP.has(t));
    const scored = [];
    for (const d of this.all()) {
      const name = normalizeText(this.displayName(d));
      let s;
      if (name === q) s = 1000;
      else {
        s = 0;
        const fields = tokens(`${this.displayName(d)} ${this.room(d) || ""} ${d.brand || ""} ${d.model || ""} ${KIND_LABEL[d.kind] || ""}`);
        const nameTokens = tokens(this.displayName(d));
        if (content.length) {
          const hits = content.filter((t) => tokenHit(t, fields)).length;
          s += (600 * hits) / content.length;
          const nameHits = content.filter((t) => tokenHit(t, nameTokens)).length;
          s += (100 * nameHits) / Math.max(nameTokens.length, content.length);
          if (!hits) s -= 200;
        } else {
          s += 300;
          if (kindOnly.length) s += (150 * kindOnly.filter((t) => tokenHit(t, fields)).length) / kindOnly.length;
        }
        if (hints.kinds.size) s += kindMatches(d, hints.kinds) ? 200 : -250;
        if (name && (q.includes(name) || name.includes(q))) s += 150;
      }
      if (d.online === false) s -= 30;
      if (d.self) s -= 50;
      // "Channel down on the Samsung" means the Samsung that has channels, not the Samsung phone.
      if (action && !["rename", "set_room"].includes(action) && s < 1000) s += d.actions?.includes(action) ? 40 : -120;
      scored.push({ d, s });
    }
    scored.sort((a, b) => b.s - a.s);
    const top = scored[0];
    // "kitchen lights" must be a light: never settle for the kitchen speaker.
    if (top && hints.kinds.size && top.s < 1000 && !kindMatches(top.d, hints.kinds)) return { none: true, suggestions: scored.filter((x) => kindMatches(x.d, hints.kinds)).slice(0, 3).map((x) => this.displayName(x.d)) };
    if (!top || top.s < 380) return { none: true, suggestions: scored.slice(0, 3).filter((x) => x.s > 150).map((x) => this.displayName(x.d)) };
    const close = scored.filter((x) => x.s >= 380 && top.s - x.s < 60);
    if (close.length > 1 && top.s < 1000) return { ambiguous: close.slice(0, 6).map((x) => x.d) };
    return { device: top.d };
  }

  /** Every device matching a kind ("lights") and/or room ("living room"). */
  findMany({ kind, room } = {}) {
    let list = this.all().filter((d) => !d.self);
    if (kind) {
      const { kinds } = kindHints(kind);
      if (!kinds.size) kinds.add(normalizeText(kind).replace(/s$/, ""));
      // Groups and rooms would double up with their members, so bulk commands target the members.
      list = list.filter((d) => [...kinds].some((k) => d.kind === k || (k === "plug" && d.kind === "switch")) && d.kind !== "room" && d.kind !== "group");
    }
    if (room) {
      const want = normalizeText(room).replace(/\b(room|the)\b/g, "").trim();
      list = list.filter((d) => {
        const r = normalizeText(this.room(d) || "").replace(/\broom\b/g, "").trim();
        return r && (r === want || (want && (r.includes(want) || want.includes(r))));
      });
    }
    return list;
  }
}
