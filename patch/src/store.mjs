// Settings, secrets and the remembered device list, kept as JSON files in the data folder
// (patch/.data by default). The settings file is written with owner-only permissions.
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULTS = () => ({
  version: 1,
  elevenlabs: { apiKey: "", agentId: "" },
  homeAssistant: { url: "", token: "" },
  hue: {},
  pairings: {},
  adbKey: "",
  youtube: { apiKey: "" },
  credentials: {},
  meta: {},
  network: { subnet: "" },
  lan: { enabled: false, accessCode: "" },
  features: { vendorLookup: true },
  history: { firstScanAt: null, lastTuneupAt: null },
});

function merge(base, extra) {
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") merge(base[k], v);
    else base[k] = v;
  }
  return base;
}

async function writeAtomic(file, text, mode) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  await fsp.writeFile(tmp, text, { mode });
  await fsp.rename(tmp, file);
}

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "settings.json");
    this.devicesFile = path.join(dir, "devices.json");
    fs.mkdirSync(dir, { recursive: true });
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      /* first run */
    }
    this.data = merge(DEFAULTS(), saved);
    let devices = [];
    try {
      devices = JSON.parse(fs.readFileSync(this.devicesFile, "utf8")).devices || [];
    } catch {
      /* none yet */
    }
    this.savedDevices = devices;
    this.saving = null;
  }

  /** Environment variables win over saved settings (handy for a .env file). */
  get elevenlabs() {
    return {
      apiKey: process.env.ELEVENLABS_API_KEY || this.data.elevenlabs.apiKey || "",
      agentId: process.env.ELEVENLABS_AGENT_ID || this.data.elevenlabs.agentId || "",
    };
  }

  get secrets() {
    const ha = {
      url: process.env.HOME_ASSISTANT_URL || this.data.homeAssistant.url || "",
      token: process.env.HOME_ASSISTANT_TOKEN || this.data.homeAssistant.token || "",
    };
    return {
      hue: this.data.hue,
      pairings: this.data.pairings,
      adbKey: this.data.adbKey || "",
      appLabels: this.data.appLabels || {},
      youtubeApiKey: process.env.YOUTUBE_API_KEY || this.data.youtube.apiKey || "",
      credentials: this.data.credentials,
      homeAssistant: ha.url && ha.token ? ha : null,
    };
  }

  get subnet() {
    return process.env.PATCH_SUBNET || this.data.network.subnet || "";
  }

  setPath(keys, value) {
    let o = this.data;
    for (const k of keys.slice(0, -1)) o = o[k] ??= {};
    if (value === undefined) delete o[keys.at(-1)];
    else o[keys.at(-1)] = value;
    return this.save();
  }

  save() {
    this.saving = (this.saving || Promise.resolve()).then(() => writeAtomic(this.file, JSON.stringify(this.data, null, 2), 0o600)).catch((err) => console.error("[patch] couldn't save settings:", err.message));
    return this.saving;
  }

  saveDevices(devices) {
    clearTimeout(this.devTimer);
    this.devTimer = setTimeout(() => {
      writeAtomic(this.devicesFile, JSON.stringify({ savedAt: new Date().toISOString(), devices }, null, 1), 0o600).catch(() => {});
    }, 800);
  }
}
