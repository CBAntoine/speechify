// Runs actions on devices (with the "ask first" rule for risky ones), live refreshes, names, rooms,
// passwords and diagnostics. Everything the dashboard and the voice agent do goes through here.
import os from "node:os";
import crypto from "node:crypto";
import { driverById } from "./drivers/index.mjs";
import { ACTIONS, DeviceError, riskOf } from "./drivers/common.mjs";
import { ping, probePorts, wakeOnLan } from "./net/probe.mjs";
import { mapLimit, normalizeMac, settleWithin } from "./util.mjs";

const ON_DEVICE_RENAME = new Set(["hue", "shelly", "wled", "elgato", "kasa", "lifx", "yeelight"]);
const RISKY_PORTS = { 21: "FTP", 23: "Telnet", 3389: "Remote Desktop", 5900: "VNC", 1883: "MQTT" };

export class Controller {
  constructor({ store, inventory, overrides = {} }) {
    this.store = store;
    this.inventory = inventory;
    this.overrides = overrides;
    this.scanner = null;
    this.confirmations = new Map();
    this.network = null;
    this.memory = new Map(); // short-lived things to remember between commands, e.g. the last YouTube results
  }

  ctx(network = this.network) {
    if (network) this.network = network;
    const store = this.store;
    const o = this.overrides;
    return {
      get secrets() {
        return store.secrets;
      },
      saveSecret: (keys, value) => store.setPath(keys, value),
      forgetSecret: (keys) => store.setPath(keys, undefined),
      hostname: os.hostname().replace(/\..*$/, "") || "computer",
      network: this.network,
      memory: this.memory,
      get youtube() {
        const apiKey = store.secrets.youtubeApiKey;
        return apiKey ? { apiKey, base: o.youtubeBase } : null;
      },
      openUrl: o.openUrl,
      // Set by the app: files the person sent from the dashboard, and the TV apps made with Patch.
      uploads: this.uploads || null,
      tvapps: this.tvapps || null,
    };
  }

  publicDevice(id) {
    const d = this.inventory.get(id);
    return d ? this.inventory.toPublic(d) : null;
  }

  async refresh(id, { timeout = 6000 } = {}) {
    const d = this.inventory.get(id);
    if (!d) return null;
    const driver = driverById[d.driver];
    if (!driver?.refresh || d.setup) return this.publicDevice(id);
    try {
      const r = await settleWithin(driver.refresh(d, this.ctx()), timeout, undefined);
      if (r === undefined) this.inventory.patch(id, { online: false });
      else if (r) this.inventory.patch(id, { ...(r.state ? { state: r.state } : {}), ...(r.info ? { info: r.info } : {}), online: r.online ?? true });
    } catch {
      this.inventory.patch(id, { online: false });
    }
    return this.publicDevice(id);
  }

  /** Background refresh of everything with live state (lights, plugs, speakers…). */
  async refreshAll() {
    const ids = this.inventory
      .all()
      .filter((d) => d.online !== false && driverById[d.driver]?.refresh && !d.setup)
      .map((d) => d.id);
    await mapLimit(ids, 6, (id) => this.refresh(id, { timeout: 5000 }));
  }

  #confirmKey(id, action, value) {
    return `${id}|${action}|${String(value ?? "").toLowerCase().trim()}`;
  }

  #issueConfirmation(id, action, value) {
    const token = crypto.randomBytes(9).toString("base64url");
    this.confirmations.set(token, { key: this.#confirmKey(id, action, value), at: Date.now() });
    for (const [t, c] of this.confirmations) if (Date.now() - c.at > 5 * 60_000) this.confirmations.delete(t);
    return token;
  }

  #checkConfirmation(token, id, action, value) {
    const c = token && this.confirmations.get(token);
    if (!c || Date.now() - c.at > 5 * 60_000 || c.key !== this.#confirmKey(id, action, value)) return false;
    this.confirmations.delete(token);
    return true;
  }

  /**
   * Do one action. Risky actions come back first as { needsConfirmation, confirmToken, message };
   * repeat the call with that confirmToken once the person has said yes.
   */
  async act(id, action, value, { confirmToken } = {}) {
    const d = this.inventory.get(id);
    if (!d) return { ok: false, error: "ENOTFOUND", message: "I can't find that device any more. Try a new scan." };
    const name = this.inventory.displayName(d);
    const view = { ...d, name };
    if (!ACTIONS[action]) return { ok: false, error: "EACTION", message: `"${action}" isn't something I can do.` };

    // Local-only actions.
    if (action === "set_room") {
      const room = String(value ?? "").trim().slice(0, 40) || null;
      await this.store.setPath(["meta", id], { ...this.inventory.meta(id), room });
      this.inventory.changed(d);
      return { ok: true, message: room ? `${name} is now in ${room}.` : `Cleared the room for ${name}.`, device: this.publicDevice(id) };
    }
    if (action === "rename") {
      const newName = String(value ?? "").trim().slice(0, 48);
      if (!newName) return { ok: false, error: "EVALUE", message: "What should I call it?" };
      await this.store.setPath(["meta", id], { ...this.inventory.meta(id), name: newName });
      let note = "";
      if (ON_DEVICE_RENAME.has(d.driver) && d.actions?.includes("rename")) {
        try {
          await driverById[d.driver].act(view, "rename", newName, this.ctx());
          note = " The device itself has the new name too.";
        } catch {
          note = " (The device itself kept its old name; Patch will use the new one.)";
        }
      }
      this.inventory.changed(d);
      return { ok: true, message: `Renamed ${name} to ${newName}.${note}`, device: this.publicDevice(id) };
    }

    if (!d.actions?.includes(action)) {
      // A TV that hasn't been connected yet will do this once it is: say how, rather than "it can't".
      if (d.setup?.message && driverById[d.driver]?.readyActions?.(d)?.includes(action)) {
        return { ok: false, error: "ESETUP", needsSetup: true, message: `${name} needs to be connected to Patch first. ${d.setup.message}`, device: this.publicDevice(id) };
      }
      const offered = (d.actions || []).filter((a) => !["rename", "set_room"].includes(a));
      return { ok: false, error: "EUNSUPPORTED", message: `${name} can't ${ACTIONS[action].label.toLowerCase()}.${offered.length ? ` It can: ${offered.map((a) => ACTIONS[a].label.toLowerCase()).join(", ")}.` : ""}` };
    }

    const risk = riskOf(view, action, value);
    // A confirmation token is good once: it covers this exact action, whether the risk is known up front
    // or only once the device looks (a phone button that turns out to say "Buy now").
    const confirmed = !!confirmToken && this.#checkConfirmation(confirmToken, id, action, value);
    if (risk && !confirmed) {
      return { ok: false, needsConfirmation: true, confirmToken: this.#issueConfirmation(id, action, value), message: `${risk} Ask the person to confirm before doing it.`, risk, device: this.publicDevice(id) };
    }

    try {
      let r;
      if (action === "wake") {
        const mac = normalizeMac(d.mac);
        if (!mac) throw new DeviceError(`I don't know ${name}'s hardware address, so I can't wake it.`);
        const net = this.network;
        await wakeOnLan(mac, { broadcasts: [net?.broadcast, "255.255.255.255"].filter(Boolean), ip: d.ip });
        r = { ok: true, message: `Sent a wake-up signal to ${name}. If Wake-on-LAN is enabled on it, it'll start in a few seconds.` };
      } else {
        const driver = driverById[d.driver];
        if (!driver?.act) throw new DeviceError(`${name} can't be controlled from here.`);
        r = await driver.act(view, action, value, { ...this.ctx(), confirmed });
      }
      const patch = { online: true };
      if (r.state) patch.state = r.state;
      if (r.info) patch.info = r.info;
      if (r.devices?.length) {
        // e.g. a Hue Bridge that was just paired: its lights and rooms join the list right now.
        for (const dev of r.devices) this.inventory.upsert(dev.id === id ? { ...d, ...dev } : dev, { scanId: d.scanId });
      } else this.inventory.patch(id, patch);
      if (r.rescan && this.scanner) this.scanner.scan().catch(() => {});
      return { ok: true, message: r.message, device: this.publicDevice(id), ...(r.results ? { results: r.results } : {}), ...(r.screen ? { screen: r.screen } : {}), ...(r.apps ? { apps: r.apps } : {}), ...(r.installed ? { installed: r.installed } : {}) };
    } catch (err) {
      const e = err instanceof DeviceError ? err : new DeviceError(err.message || String(err));
      if (e.code === "ECONFIRM") {
        return { ok: false, needsConfirmation: true, confirmToken: this.#issueConfirmation(id, action, value), message: `${e.message} Ask the person to confirm before doing it.`, risk: e.message, device: this.publicDevice(id) };
      }
      if (e.code === "EOFFLINE") this.inventory.patch(id, { online: false });
      return { ok: false, error: e.code || "EDEVICE", message: e.message, hint: e.hint || null, device: this.publicDevice(id) };
    }
  }

  /** The same action on several devices ("turn off all the lights"). One confirmation covers the batch. */
  async actMany(ids, action, value, { confirmToken } = {}) {
    const batchId = `batch:${[...ids].sort().join(",")}`;
    const devices = ids.map((id) => this.inventory.get(id)).filter(Boolean);
    const risky = devices.map((d) => riskOf({ ...d, name: this.inventory.displayName(d) }, action, value)).filter(Boolean);
    const needsOk = risky.length > 0 || (devices.length > 6 && ["turn_off", "toggle"].includes(action));
    if (needsOk && !this.#checkConfirmation(confirmToken, batchId, action, value)) {
      return {
        ok: false,
        needsConfirmation: true,
        confirmToken: this.#issueConfirmation(batchId, action, value),
        message: `This affects ${devices.length} devices (${devices.slice(0, 8).map((d) => this.inventory.displayName(d)).join(", ")}${devices.length > 8 ? "…" : ""}).${risky.length ? ` ${risky[0]}` : ""} Ask the person to confirm first.`,
      };
    }
    const results = await mapLimit(devices, 6, async (d) => {
      const own = riskOf({ ...d, name: this.inventory.displayName(d) }, action, value) ? this.#issueConfirmation(d.id, action, value) : undefined;
      const r = await this.act(d.id, action, value, { confirmToken: own });
      return { id: d.id, name: this.inventory.displayName(d), ok: r.ok, message: r.message };
    });
    const ok = results.filter((r) => r.ok);
    const bad = results.filter((r) => !r.ok);
    return {
      ok: ok.length > 0,
      message: `${ok.length} of ${results.length} done.${bad.length ? ` Didn't work: ${bad.map((b) => `${b.name} (${b.message})`).join("; ")}` : ""}`,
      results,
    };
  }

  async setCredentials(id, { username, password }) {
    const d = this.inventory.get(id);
    if (!d) return { ok: false, message: "Unknown device." };
    const key = d.parent || d.id;
    if (!password) await this.store.setPath(["credentials", key], undefined);
    else await this.store.setPath(["credentials", key], { username: username || "admin", password: String(password) });
    if (this.scanner) this.scanner.scan().catch(() => {});
    return { ok: true, message: password ? "Saved. I'll reconnect to it now." : "Removed the saved password." };
  }

  /** Why isn't it working? Reachability, latency, open services, signal and setup state. */
  async diagnose(id) {
    const d = this.inventory.get(id);
    if (!d) return { ok: false, message: "Unknown device." };
    const name = this.inventory.displayName(d);
    if (!d.ip) {
      const fresh = await this.refresh(id);
      return { ok: true, device: fresh, findings: fresh?.online ? [`${name} is responding through ${d.driver === "homeassistant" ? "Home Assistant" : "its hub"}.`] : [`${name} isn't responding right now.`] };
    }
    const [pingRes, ports, fresh] = await Promise.all([ping(d.ip, { count: 5, ports: d.ports || [] }), probePorts(d.ip, d.ports?.length ? [...new Set([...d.ports, 80, 443])] : [80, 443, 22], { timeout: 1000 }), this.refresh(id)]);
    const findings = [];
    const reachable = pingRes.received > 0 || ports.alive;
    if (!reachable) findings.push(`${name} isn't answering on the network. Check it has power, then that it's still connected to your WiFi (it may need re-adding in its own app).`);
    else {
      if (pingRes.avg != null) findings.push(`Response time ${pingRes.avg} ms${pingRes.loss ? ` with ${pingRes.loss}% of checks lost` : ", no losses"}.`);
      if (pingRes.loss >= 20) findings.push("Some checks went unanswered: a weak WiFi signal or interference is likely. Moving it closer to the router or adding a mesh point helps.");
      else if (pingRes.avg > 150) findings.push("That's slow for a home network; the device may be far from the router or busy.");
    }
    const rssi = fresh?.info?.rssi;
    if (typeof rssi === "number") findings.push(rssi <= -75 ? `Its WiFi signal is weak (${rssi} dBm).` : rssi <= -67 ? `Its WiFi signal is fair (${rssi} dBm).` : `Its WiFi signal is good (${rssi} dBm).`);
    const risky = ports.open.filter((p) => RISKY_PORTS[p]);
    if (risky.length) findings.push(`It has ${risky.map((p) => RISKY_PORTS[p]).join(" and ")} switched on, which is worth turning off unless you use it.`);
    if (d.setup) findings.push(d.setup.message);
    if (fresh?.info?.updateAvailable) findings.push(`A firmware update is available${fresh.info.newFirmware ? ` (${fresh.info.newFirmware})` : ""}.`);
    if (fresh?.state?.reasons?.length) findings.push(`The printer reports: ${fresh.state.reasons.join(", ")}.`);
    return { ok: true, device: fresh, reachable, ping: pingRes, openPorts: ports.open, findings };
  }
}
