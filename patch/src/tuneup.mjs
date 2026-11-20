// "Tune-up": a health and safety check of the whole network, with fixes Patch can apply itself.
import { ping } from "./net/probe.mjs";
import { wifiInfo, channelAdvice } from "./net/wifi.mjs";
import { dnsCheck, internetStatus } from "./net/internet.mjs";
import { mappingLabel } from "./drivers/router.mjs";
import { mapLimit, plural, settleWithin } from "./util.mjs";

// Points off per finding, and the most each severity can take off in total, so one bad area
// doesn't flatten the score and a long list of small things never outweighs a real problem.
const PENALTY = { high: 12, medium: 6, low: 2, info: 0, good: 0 };
const PENALTY_CAP = { high: 45, medium: 30, low: 15, info: 0, good: 0 };
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2, info: 3, good: 4 };

const PORT_RISK = {
  23: { sev: "high", name: "Telnet", why: "Telnet sends passwords in plain text and is the classic way botnets take over cameras and routers." },
  21: { sev: "medium", name: "FTP", why: "FTP sends passwords unencrypted. Use SFTP or the device's app instead." },
  5900: { sev: "medium", name: "VNC screen sharing", why: "Remote screen control should be password-protected and never reachable from the internet." },
  3389: { sev: "low", name: "Remote Desktop", why: "Fine at home with a strong password, but make sure it isn't port-forwarded to the internet." },
  1883: { sev: "low", name: "an MQTT broker", why: "Make sure the broker requires a username and password." },
};
const SMART_KINDS = new Set(["camera", "smart", "light", "plug", "switch", "sensor", "tv", "streamer", "speaker", "printer", "unknown"]);

export function grade(score) {
  return score >= 90 ? "Great" : score >= 75 ? "Good" : score >= 55 ? "Fair" : "Needs work";
}

export async function runTuneup({ inventory, controller, store, focus = "all", skipInternet = false, skipWifi = false, pingDevices = true } = {}) {
  const started = Date.now();
  const want = (cat) => focus === "all" || focus === cat || (focus === "speed" && (cat === "wifi" || cat === "internet" || cat === "health"));
  const findings = [];
  let n = 0;
  const add = (f) => findings.push({ id: `f${++n}`, ...f });

  // Fresh state for everything before judging it.
  await settleWithin(controller.refreshAll(), 25_000);
  const devices = inventory.list().filter((d) => !d.self);
  const online = devices.filter((d) => d.online);
  const byId = Object.fromEntries(devices.map((d) => [d.id, d]));

  // ── Updates ──
  if (want("updates")) {
    for (const d of online) {
      if (d.info?.updateAvailable && d.actions.includes("update_firmware")) {
        add({ severity: "medium", category: "updates", title: `Update available for ${d.name}`, detail: `${d.brand || "The device"} has newer firmware${d.info.newFirmware ? ` (${d.info.newFirmware})` : ""}. Updates fix security holes and bugs.`, deviceId: d.id, fix: { label: "Install update", deviceId: d.id, action: "update_firmware" } });
      }
      if (d.driver === "hue" && d.kind === "hub" && d.state?.updateAvailable) {
        add({ severity: "medium", category: "updates", title: "Hue system update ready", detail: "The Hue Bridge has an update ready to install for itself or your lights.", deviceId: d.id, fix: { label: "Install update", deviceId: d.id, action: "update_firmware" } });
      }
      if (d.driver === "hue" && d.kind === "hub" && d.state?.autoUpdate === false) {
        add({ severity: "low", category: "updates", title: "Hue automatic updates are off", detail: "Turning them on keeps the bridge and bulbs patched without you thinking about it (they install overnight).", deviceId: d.id, fix: { label: "Turn on auto-updates", deviceId: d.id, action: "enable_auto_updates" } });
      }
    }
    const ha = byId["ha:hub"];
    for (const u of ha?.info?.updates || []) {
      add({ severity: "low", category: "updates", title: `Update available: ${u.name}`, detail: `Home Assistant reports ${u.installed || "an older version"} → ${u.latest || "a newer version"}.`, deviceId: "ha:hub", fix: { label: "Install via Home Assistant", haUpdate: u.entity } });
    }
  }

  // ── Security ──
  if (want("security")) {
    for (const d of online) {
      for (const p of d.ports || []) {
        const r = PORT_RISK[p];
        if (!r) continue;
        if (p === 3389 && d.kind !== "computer") continue;
        const sev = p === 23 && SMART_KINDS.has(d.kind) ? "high" : r.sev;
        add({ severity: sev, category: "security", title: `${d.name} has ${r.name} turned on`, detail: `${r.why} Turn it off in ${d.webUrl ? "the device's settings page" : "the device's settings"}, or update its firmware.`, deviceId: d.id, ...(d.webUrl ? { link: d.webUrl } : {}) });
      }
      if ((d.ports || []).includes(445) && ["camera", "printer", "smart", "tv"].includes(d.kind)) {
        add({ severity: "medium", category: "security", title: `${d.name} is sharing files (SMB)`, detail: "File sharing on a camera, printer or gadget is unusual. If you don't use it, switch it off in the device's settings.", deviceId: d.id });
      }
      if (d.driver === "shelly" && d.info?.passwordProtected === false && !d.parent) {
        add({ severity: "low", category: "security", title: `${d.name} has no password`, detail: "Anyone on your WiFi can control it or change its settings. Set one in its web page under Settings → Restrict login, then add it to Patch.", deviceId: d.id, ...(d.webUrl ? { link: d.webUrl } : {}) });
      }
      if (d.kind === "camera" && (d.ports || []).includes(80) && !(d.ports || []).includes(443)) {
        add({ severity: "low", category: "security", title: `${d.name}'s web page isn't encrypted`, detail: "Its login page uses plain HTTP. Change its default password if you haven't, and keep its firmware current.", deviceId: d.id, link: d.webUrl });
      }
    }
    const router = devices.find((d) => d.kind === "router");
    const forwards = router?.info?.portForwards || [];
    for (const m of forwards) {
      const target = devices.find((d) => d.ip === m.internalClient);
      const sensitive = target && ["camera", "nas", "computer", "smart", "unknown"].includes(target.kind);
      add({
        severity: sensitive ? "high" : "medium",
        category: "security",
        title: `Open to the internet: ${m.description || `${m.protocol} port ${m.externalPort}`}`,
        detail: `The router forwards ${m.protocol} port ${m.externalPort} from the internet to ${target ? target.name : m.internalClient}. An app asked for this automatically (UPnP). Close it if you don't recognise it.`,
        deviceId: router.id,
        fix: { label: "Close this port", deviceId: router.id, action: "remove_port_forward", value: `${m.protocol} ${m.externalPort}` },
        detailLine: mappingLabel(m),
      });
    }
    if (router?.info?.upnp && !forwards.length) {
      add({ severity: "info", category: "security", title: "UPnP is on (nothing open right now)", detail: "UPnP lets apps and consoles open ports on your router automatically. Handy for gaming; turn it off in the router if you don't need it.", deviceId: router.id, link: router.webUrl });
    }
    if (router?.webUrl?.startsWith("http://")) {
      add({ severity: "info", category: "security", title: "Check your router's admin password", detail: "Make sure it isn't the one printed on the sticker, and that remote (internet) admin is switched off.", deviceId: router.id, link: router.webUrl });
    }
    const unknown = online.filter((d) => d.kind === "unknown");
    if (unknown.length) {
      add({ severity: "info", category: "devices", title: `${plural(unknown.length, "device")} I can't identify`, detail: `${unknown.map((d) => d.ip).join(", ")}. If you recognise them, give them a name; if you don't, changing your WiFi password kicks off anything that shouldn't be there.`, deviceIds: unknown.map((d) => d.id) });
    }
    const fresh = devices.filter((d) => d.isNew);
    if (fresh.length) {
      add({ severity: "info", category: "devices", title: `${plural(fresh.length, "new device")} joined recently`, detail: fresh.map((d) => d.name).join(", "), deviceIds: fresh.map((d) => d.id) });
    }
  }

  // ── WiFi & connection health ──
  if (want("wifi") || want("health")) {
    for (const d of online) {
      const rssi = d.info?.rssi;
      if (typeof rssi !== "number") continue;
      if (rssi <= -75) add({ severity: "medium", category: "wifi", title: `${d.name} has a weak WiFi signal`, detail: `${rssi} dBm. Expect it to drop off or respond slowly. Move it closer to the router, or add a mesh point or extender between them.`, deviceId: d.id });
      else if (rssi <= -68) add({ severity: "low", category: "wifi", title: `${d.name}'s signal is only fair`, detail: `${rssi} dBm. Usually fine, but it's the first thing to check if it acts up.`, deviceId: d.id });
    }
    if (pingDevices) {
      const targets = online.filter((d) => d.ip && !d.parent && (d.ports || []).length);
      const results = await mapLimit(targets, 8, async (d) => ({ d, r: await ping(d.ip, { count: 4, ports: d.ports, preferTcp: true }) }));
      for (const x of results) {
        if (!x?.r || x.r.received === 0) continue;
        if (x.r.loss >= 25 || x.r.avg > 150) {
          add({ severity: "medium", category: "health", title: `${x.d.name} has a spotty connection`, detail: `${x.r.loss}% of checks lost, ${x.r.avg} ms average. A weak signal or interference is the usual cause.`, deviceId: x.d.id });
        }
      }
    }
    if (!skipWifi) {
      const w = await settleWithin(wifiInfo(), 22_000);
      if (w) {
        if (w.signalPct != null && w.signalPct < 45) add({ severity: "medium", category: "wifi", title: "This computer's WiFi signal is weak", detail: `${w.signalPct}%${w.rssi ? ` (${w.rssi} dBm)` : ""}. Speeds will be well below what your internet plan offers.` });
        const adv = channelAdvice(w);
        if (adv?.better) add({ severity: "low", category: "wifi", title: `Your WiFi channel is crowded`, detail: `${plural(adv.competing, "nearby network")} share${adv.competing === 1 ? "s" : ""} channel ${adv.channel} (${adv.band}). Channel ${adv.better} is quieter: set it in your router's wireless settings (or turn on auto channel).` });
        if (w.band === "2.4 GHz" && (w.neighbors || []).some((n) => n.ssid && n.ssid === w.ssid && n.band === "5 GHz")) add({ severity: "low", category: "wifi", title: "This computer is on the slower 2.4 GHz band", detail: `Your network also broadcasts on 5 GHz, which is several times faster at short range.` });
        store.lastWifi = w;
      }
    }
  }

  // ── Supplies & batteries ──
  if (want("health") || want("all")) {
    for (const d of online.filter((x) => x.kind === "printer")) {
      for (const s of d.state?.supplies || []) {
        if (s.level != null && s.level <= 5) add({ severity: "medium", category: "supplies", title: `${d.name}: ${s.name} is empty`, detail: `${s.level}% left. Time for a replacement.`, deviceId: d.id });
        else if (s.low) add({ severity: "low", category: "supplies", title: `${d.name}: ${s.name} is low`, detail: `${s.level}% left.`, deviceId: d.id });
      }
      for (const r of d.state?.reasons || []) {
        if (/low$/.test(r)) continue;
        add({ severity: /jam|out of paper|empty|open/.test(r) ? "medium" : "low", category: "supplies", title: `${d.name}: ${r}`, detail: "Reported by the printer itself.", deviceId: d.id });
      }
    }
    for (const b of byId["ha:hub"]?.info?.lowBatteries || []) {
      add({ severity: "low", category: "supplies", title: `${b.name} is at ${b.level}%`, detail: "Low battery reported by Home Assistant.", deviceId: "ha:hub" });
    }
    const gone = devices.filter((d) => d.online === false && d.lastSeen && Date.now() - d.lastSeen < 7 * 86_400_000 && !d.parent && d.kind !== "phone" && d.kind !== "personal");
    if (gone.length) add({ severity: "info", category: "health", title: `${plural(gone.length, "device")} went offline`, detail: `${gone.map((d) => d.name).join(", ")} answered earlier this week but not now. Switched off, unplugged, or dropped off the WiFi.`, deviceIds: gone.map((d) => d.id) });
  }

  // ── Internet ──
  let internet = null;
  if (!skipInternet && want("internet")) {
    const [st, dnsRes] = await Promise.all([settleWithin(internetStatus(), 15_000), settleWithin(dnsCheck(), 20_000)]);
    internet = { ...(st || { online: false }), dns: dnsRes };
    if (!st?.online) add({ severity: "high", category: "internet", title: "This computer can't reach the internet", detail: "Check the router's lights, or restart the modem and router (unplug for 30 seconds)." });
    else {
      const sys = dnsRes?.system?.median;
      const best = Math.min(...[dnsRes?.cloudflare?.median, dnsRes?.google?.median].filter((x) => x != null));
      if (sys != null && Number.isFinite(best) && sys > Math.max(60, best * 2.5)) add({ severity: "low", category: "internet", title: "Your DNS server is slow", detail: `Looking up websites takes ${sys} ms on your network's DNS but ${best} ms on a public one. Setting the router's DNS to 1.1.1.1 and 8.8.8.8 makes every page start loading sooner.` });
    }
    const router = devices.find((d) => d.kind === "router");
    if (router?.info?.cgnat || router?.info?.externalIsPrivate) {
      add({ severity: "info", category: "internet", title: router.info.cgnat ? "Your provider shares your internet address (CGNAT)" : "You have two routers in a row (double NAT)", detail: "Normal browsing is fine, but hosting game lobbies, remote camera access or port forwarding may not work. Your provider or putting the first router in bridge mode fixes it." });
    }
  }

  if (!findings.some((f) => f.category === "security" && f.severity !== "info")) add({ severity: "good", category: "security", title: "No risky services or open ports found" });
  if (!findings.some((f) => f.category === "updates")) add({ severity: "good", category: "updates", title: "Everything Patch can check is up to date" });

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  const counts = Object.fromEntries(Object.keys(PENALTY).map((k) => [k, findings.filter((f) => f.severity === k).length]));
  const score = Math.max(5, 100 - Object.keys(PENALTY).reduce((sum, k) => sum + Math.min(PENALTY_CAP[k], counts[k] * PENALTY[k]), 0));
  store.data.history.lastTuneupAt = Date.now();
  store.save();
  return {
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    focus,
    score,
    grade: grade(score),
    counts,
    devicesChecked: online.length,
    findings,
    internet,
    fixable: findings.filter((f) => f.fix).length,
  };
}
