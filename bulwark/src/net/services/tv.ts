// TVs and streaming boxes that can't run Bulwark themselves: recognise them, and check the
// remote-control APIs they open to the network.

import { httpGet } from "../tcp.ts";
import type { NetIssue, ProbeResult } from "../types.ts";
import { probeHttp } from "./http.ts";

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim();

/** Roku's External Control Protocol (port 8060): no password, by design. */
export async function probeRoku(ip: string, port: number): Promise<ProbeResult | null> {
  const res = await httpGet(ip, port, "/query/device-info", { timeoutMs: 4000 });
  if (!res) return null;
  if (res.status === 403) {
    return { service: { port, proto: "tcp", name: "roku-ecp", product: "Roku", notes: ["control limited"] }, issues: [] };
  }
  if (res.status !== 200 || !/<device-info>/.test(res.body)) return probeHttp(ip, port);
  const model = [tag(res.body, "vendor-name"), tag(res.body, "model-name")].filter(Boolean).join(" ") || "Roku";
  const name = tag(res.body, "user-device-name") ?? tag(res.body, "friendly-device-name");
  const version = tag(res.body, "software-version");
  const issues: NetIssue[] = [
    {
      checkId: "roku.ecp-open",
      title: "Anyone on the network can control this Roku",
      severity: "low",
      summary: `${name ? `"${name}" (${model})` : model} accepts remote-control commands from any device on the network, with no password, and tells anyone who asks what it is and what it's playing.`,
      why: "Any app or compromised device on your Wi-Fi can press buttons, open channels and see what's on. On shared networks (flats, dorms, offices), so can your neighbours.",
      steps: [
        "On the Roku: Settings → System → Advanced system settings → Control by mobile apps → Network access → Limited (or Disabled if you don't use a phone as a remote).",
        "Keep TVs and streaming boxes on a guest network if your router has one.",
      ],
    },
  ];
  if (tag(res.body, "developer-enabled") === "true") {
    issues.push({
      checkId: "roku.developer-mode",
      title: "Roku developer mode is on",
      severity: "medium",
      summary: "Developer mode is on, so the Roku runs an installer for channels that didn't come from the Roku store.",
      why: "The developer installer is protected only by the password set when it was turned on, and it lets that person install anything on the TV.",
      steps: ["On the remote press Home 3×, Up 2×, Right, Left, Right, Left, Right, then choose \"Disable installer and restart\"."],
    });
  }
  return { service: { port, proto: "tcp", name: "roku-ecp", product: model, version, title: name ?? model }, issues };
}

/** Samsung TVs answer on port 8001 with their name and model. New remotes need approval on the TV, so this is for naming. */
export async function probeSamsungTv(ip: string, port: number): Promise<ProbeResult | null> {
  const res = await httpGet(ip, port, "/api/v2/", { timeoutMs: 4000 });
  if (!res) return null;
  try {
    const j = JSON.parse(res.body) as { device?: { name?: string; modelName?: string; OS?: string; firmwareVersion?: string }; name?: string; type?: string };
    if (!j.device || !/samsung/i.test(`${j.type} ${j.device.name}`)) return probeHttp(ip, port);
    const name = (j.device.name ?? j.name ?? "Samsung TV").replace(/^\[TV\]\s*/, "");
    return { service: { port, proto: "tcp", name: "samsung-tv", product: `Samsung ${j.device.OS ?? "TV"}`, version: j.device.firmwareVersion, title: name }, issues: [] };
  } catch {
    return probeHttp(ip, port);
  }
}
