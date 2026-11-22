// Smart home gear and home servers: plugs, switches, light bridges, Home Assistant, NAS boxes.
// Every request here is one the device's own app makes to find it (its status or info page). None
// of them changes a setting or sends a password.

import { exchange, httpGet, type HttpResponse } from "../tcp.ts";
import type { NetIssue, ProbeResult } from "../types.ts";

const json = (res: HttpResponse | null): Record<string, unknown> | null => {
  if (!res || res.status !== 200) return null;
  try {
    const v = JSON.parse(res.body);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export interface HomeApi {
  name: string;
  product: string;
  version?: string;
  deviceName?: string;
  issues: NetIssue[];
}

const NO_PASSWORD_WHY =
  "Anything on your Wi-Fi, including a hacked phone or another smart gadget, can switch it, change its settings, or load new firmware onto it, which turns it into a foothold on your network.";

/** Tasmota (open-source firmware for smart plugs and switches): its web page loads without a password. */
export function tasmotaCheck(root: HttpResponse, ip: string, port: number): HomeApi | null {
  if (root.status !== 200 || !/Tasmota/.test(root.body) || !/Theo Arends|tasmota/i.test(root.body)) return null;
  const version = root.body.match(/Tasmota\s+(\d+\.\d+\.\d+)/)?.[1];
  return {
    name: "tasmota",
    product: "Tasmota",
    version,
    issues: [
      {
        checkId: "tasmota.no-password",
        title: "Smart switch with no password (Tasmota)",
        severity: "medium",
        summary: `The Tasmota device at ${ip} opens its control page${port === 80 ? "" : ` on port ${port}`} to anyone, with no password.`,
        why: NO_PASSWORD_WHY,
        steps: [`Open http://${ip}${port === 80 ? "" : `:${port}`} → Configuration → Configure Other → set a Web Admin Password, then Save.`, "Keep smart plugs on a guest or IoT Wi-Fi network if your router has one."],
      },
    ],
  };
}

/** Shelly relays and plugs describe themselves at /shelly, including whether a password is set. */
export async function shellyCheck(ip: string, port: number, useTls: boolean): Promise<HomeApi | null> {
  const j = json(await httpGet(ip, port, "/shelly", { tls: useTls, timeoutMs: 3000 }));
  if (!j || !(str(j.type) || str(j.model) || str(j.app)) || !str(j.mac)) return null;
  const gen2 = typeof j.gen === "number";
  const model = str(j.app) ?? str(j.type) ?? str(j.model);
  const version = str(j.ver) ?? str(j.fw);
  const open = gen2 ? j.auth_en === false : j.auth === false;
  return {
    name: "shelly",
    product: `Shelly ${model ?? ""}`.trim(),
    version,
    deviceName: str(j.name),
    issues: open
      ? [
          {
            checkId: "shelly.no-password",
            title: "Smart switch with no password (Shelly)",
            severity: "medium",
            summary: `The Shelly ${model ?? "device"} at ${ip} accepts commands and settings changes from anyone on the network.`,
            why: NO_PASSWORD_WHY,
            steps: [
              gen2 ? `Open http://${ip} → Settings → Authentication → turn it on and set a password.` : `Open http://${ip} → Internet & Security → Restrict login → set a username and password.`,
              "The Shelly app has the same setting under the device's settings → Device authentication.",
            ],
          },
        ]
      : [],
  };
}

/** Philips Hue bridges answer /api/config without a key; the first-generation (round) bridge is out of support. */
export async function hueCheck(ip: string, port: number, useTls: boolean): Promise<HomeApi | null> {
  const j = json(await httpGet(ip, port, "/api/config", { tls: useTls, timeoutMs: 3000 }));
  if (!j || !str(j.bridgeid) || !str(j.modelid)) return null;
  const issues: NetIssue[] = [];
  if (j.modelid === "BSB001") {
    issues.push({
      checkId: "hue.v1-bridge",
      title: "Hue Bridge no longer gets updates",
      severity: "medium",
      summary: "This is a first-generation (round) Hue Bridge. Philips stopped updating it in April 2020, and it has known flaws that were never fixed on it.",
      why: "A Hue bridge sits on your network and talks to every bulb. Holes found since 2020, like the Zigbee bulb attack (CVE-2020-6007) that reaches the network through the bridge, stay open on it.",
      steps: ["Replace it with a current Hue Bridge (the square one); the Hue app moves your lights and rooms across."],
      cves: ["CVE-2020-6007"],
    });
  }
  return { name: "hue", product: "Philips Hue Bridge", version: str(j.swversion), deviceName: str(j.name), issues };
}

/** Home Assistant before its first account is created: whoever opens it first becomes the owner. */
export async function homeAssistantCheck(ip: string, port: number, useTls: boolean): Promise<HomeApi | null> {
  const res = await httpGet(ip, port, "/api/onboarding", { tls: useTls, timeoutMs: 3000 });
  if (!res || res.status !== 200) return null;
  let steps: { step?: string; done?: boolean }[];
  try {
    steps = JSON.parse(res.body);
  } catch {
    return null;
  }
  if (!Array.isArray(steps)) return null;
  const user = steps.find((s) => s?.step === "user");
  const issues: NetIssue[] = [];
  if (user && user.done === false) {
    issues.push({
      checkId: "homeassistant.not-set-up",
      title: "Home Assistant hasn't been set up",
      severity: "high",
      summary: `Home Assistant at ${ip}:${port} has no owner account yet, so anyone on the network can create one and take control of your smart home.`,
      why: "The first person to finish Home Assistant's setup becomes its administrator, with control of every device it's connected to.",
      steps: [`Open http://${ip}:${port} now and create your account, or turn Home Assistant off if you're not using it.`],
    });
  }
  return { name: "home-assistant", product: "Home Assistant", issues };
}

/** QNAP's login service says which QTS version is installed and when it was built. */
export async function qnapCheck(ip: string, port: number, useTls: boolean): Promise<HomeApi | null> {
  const res = await httpGet(ip, port, "/cgi-bin/authLogin.cgi", { tls: useTls, timeoutMs: 4000 });
  if (!res || res.status !== 200 || !/<QDocRoot/i.test(res.body)) return null;
  const tag = (name: string) => res.body.match(new RegExp(`<${name}>\\s*(?:<!\\[CDATA\\[)?([^<\\]]*)`, "i"))?.[1]?.trim() || undefined;
  const version = tag("version");
  const build = tag("build");
  const model = tag("displayModelName") ?? tag("modelName");
  const issues: NetIssue[] = [];
  if (build && /^\d{8}$/.test(build)) {
    const built = `${build.slice(0, 4)}-${build.slice(4, 6)}-${build.slice(6)}`;
    const ageDays = Math.floor((Date.now() - Date.parse(`${built}T12:00:00Z`)) / 86_400_000);
    if (ageDays > 365) {
      issues.push({
        checkId: "qnap.old-firmware",
        title: "QNAP firmware is more than a year old",
        severity: "high",
        confidence: "likely",
        summary: `This QNAP${model ? ` ${model}` : ""} runs QTS ${version ?? "?"} built on ${built}, ${Math.floor(ageDays / 30)} months ago.`,
        why: "QNAP NAS boxes are a favourite target of ransomware gangs (Deadbolt, Qlocker, eCh0raix), which encrypt every file on them. QNAP fixes the holes they use every few months.",
        steps: ["In QTS: Control Panel → System → Firmware Update → Check for Update, and turn on automatic updates.", "Turn off router port forwarding and UPnP for the NAS unless you need to reach it from outside; use QNAP's VPN app instead."],
        evidence: [`QTS ${version ?? "?"} build ${build}`],
      });
    }
  }
  return { name: "qnap", product: `QNAP${model ? ` ${model}` : ""} (QTS)`, version, issues };
}

/** Which home-device API a web page belongs to, judging by the page itself. */
export async function homeApiChecks(ip: string, port: number, useTls: boolean, root: HttpResponse): Promise<HomeApi | null> {
  const body = root.body.slice(0, 200_000);
  const tasmota = tasmotaCheck(root, ip, port);
  if (tasmota) return tasmota;
  if (/shelly/i.test(body)) {
    const s = await shellyCheck(ip, port, useTls);
    if (s) return s;
  }
  if (/hue personal wireless lighting|philips hue/i.test(body)) {
    const h = await hueCheck(ip, port, useTls);
    if (h) return h;
  }
  if (/Home Assistant/.test(body)) {
    const ha = await homeAssistantCheck(ip, port, useTls);
    if (ha) return ha;
  }
  if (/QNAP|QTS/.test(body)) {
    const q = await qnapCheck(ip, port, useTls);
    if (q) return q;
  }
  return null;
}

// ── TP-Link Kasa smart plugs and bulbs (port 9999) ──

/** Kasa's local protocol: JSON scrambled with a running XOR, after a 4-byte length. */
export function kasaEncode(text: string): Buffer {
  const data = Buffer.from(text, "utf8");
  const out = Buffer.alloc(4 + data.length);
  out.writeUInt32BE(data.length, 0);
  let key = 171;
  for (let i = 0; i < data.length; i++) {
    key = data[i] ^ key;
    out[4 + i] = key;
  }
  return out;
}

export function kasaDecode(buf: Buffer): string {
  const out = Buffer.alloc(buf.length);
  let key = 171;
  for (let i = 0; i < buf.length; i++) {
    out[i] = buf[i] ^ key;
    key = buf[i];
  }
  return out.toString("utf8");
}

export async function probeKasa(ip: string, port: number): Promise<ProbeResult | null> {
  const resp = await exchange(ip, port, { send: kasaEncode('{"system":{"get_sysinfo":{}}}'), timeoutMs: 3000, until: (b) => b.length >= 4 && b.length >= 4 + b.readUInt32BE(0) });
  if (!resp || resp.length < 8) return null;
  let info: Record<string, unknown> | undefined;
  try {
    info = (JSON.parse(kasaDecode(resp.subarray(4, 4 + resp.readUInt32BE(0)))) as { system?: { get_sysinfo?: Record<string, unknown> } }).system?.get_sysinfo;
  } catch {
    return null;
  }
  if (!info) return null;
  const model = str(info.model);
  const alias = str(info.alias);
  return {
    service: { port, proto: "tcp", name: "kasa", product: `TP-Link ${model ?? "Kasa"}`, version: str(info.sw_ver), title: alias, deviceName: alias },
    issues: [
      {
        checkId: "kasa.open-control",
        title: "Smart plug anyone on the network can switch (TP-Link Kasa)",
        severity: "low",
        summary: `${alias ? `"${alias}"` : "This Kasa device"}${model ? ` (${model})` : ""} accepts on/off and settings commands from any device on the network, with no password.`,
        why: "Old Kasa firmware has no authentication at all on its local port. Anything on your Wi-Fi can turn it on or off, which matters if it powers a heater, a router or a security camera.",
        steps: ["Update it in the Kasa (or Tapo) app: newer firmware closes this port.", "Keep smart plugs on a guest or IoT Wi-Fi network if your router has one."],
      },
    ],
  };
}
