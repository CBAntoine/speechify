// Probes for binary protocols. Each one only asks the service what it accepts (which SMB dialects,
// which RDP security, which VNC login methods, whether MQTT/ADB/MongoDB want credentials).
// None of them sends a password or tries to log in as anyone.

import { matchSoftware } from "../fingerprints.ts";
import { Conversation, exchange } from "../tcp.ts";
import { smbNtlmInfo, windowsFromNtlm, windowsIssue } from "./ntlm.ts";
import type { NetIssue, ProbeResult } from "../types.ts";

// ── SMB ──

/** An SMB1 NEGOTIATE offering only the "NT LM 0.12" dialect. Only servers with SMBv1 on accept it. */
export function smb1Negotiate(): Buffer {
  const dialects = Buffer.from("\x02NT LM 0.12\x00", "latin1");
  const header = Buffer.from([
    0xff, 0x53, 0x4d, 0x42, // \xFFSMB
    0x72, // NEGOTIATE
    0x00, 0x00, 0x00, 0x00, // status
    0x18, // flags
    0x01, 0x28, // flags2
    0x00, 0x00, // PID high
    0, 0, 0, 0, 0, 0, 0, 0, // signature
    0x00, 0x00, // reserved
    0x00, 0x00, // TID
    0x2f, 0x4b, // PID
    0x00, 0x00, // UID
    0xc5, 0x5e, // MID
  ]);
  const params = Buffer.from([0x00, dialects.length & 0xff, dialects.length >> 8]);
  const smb = Buffer.concat([header, params, dialects]);
  const nb = Buffer.alloc(4);
  nb.writeUInt32BE(smb.length, 0);
  return Buffer.concat([nb, smb]);
}

export function smb1Accepted(resp: Buffer | null): boolean {
  if (!resp || resp.length < 4 + 32 + 3) return false;
  const smb = resp.subarray(4);
  if (smb.readUInt32BE(0) !== 0xff534d42 || smb[4] !== 0x72) return false;
  if (smb.readUInt32LE(5) !== 0) return false;
  const wordCount = smb[32];
  if (wordCount < 1) return false;
  return smb.readUInt16LE(33) !== 0xffff;
}

export async function probeSmb(ip: string, port: number): Promise<ProbeResult | null> {
  const resp = await exchange(ip, port, { send: smb1Negotiate(), timeoutMs: 3000, until: (b) => b.length >= 4 && b.length >= 4 + b.readUInt32BE(0) });
  const issues: NetIssue[] = [];
  if (smb1Accepted(resp)) {
    issues.push({
      checkId: "smb.v1",
      title: "SMBv1 file sharing is on",
      severity: "high",
      summary: "The device accepts SMB version 1, the protocol WannaCry and NotPetya spread through.",
      why: "SMBv1 has unfixable design weaknesses and was the way in for EternalBlue (MS17-010). Nothing current needs it.",
      steps: [
        "Windows: Set-SmbServerConfiguration -EnableSMB1Protocol $false -Force (admin PowerShell).",
        "Samba/NAS: set server min protocol = SMB2 (most NAS have an \"SMB1/NT1\" toggle in their file service settings).",
      ],
      cves: ["CVE-2017-0144"],
    });
  }
  // The first step of an SMB login names the Windows version and the computer (no password involved).
  const ntlm = await smbNtlmInfo(ip, port);
  const win = ntlm ? windowsFromNtlm(ntlm) : null;
  const unsupported = win && ntlm ? windowsIssue(win, ntlm) : null;
  if (unsupported) issues.push(unsupported);
  return {
    service: {
      port,
      proto: "tcp",
      name: "smb",
      product: win?.name,
      version: ntlm && win ? `${ntlm.major}.${ntlm.minor}.${ntlm.build}` : undefined,
      deviceName: ntlm?.computer,
      os: win?.name,
      notes: smb1Accepted(resp) ? ["SMBv1 on"] : [],
    },
    issues,
  };
}

// ── RDP ──

export const RDP_NEG_REQ_RDP_ONLY = Buffer.from([0x03, 0x00, 0x00, 0x13, 0x0e, 0xe0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00]);

export type RdpSecurity = "standard-rdp" | "tls-or-nla" | "nla-required" | "unknown";

export function parseRdpNegotiation(resp: Buffer | null): RdpSecurity {
  if (!resp || resp.length < 11 || resp[0] !== 0x03) return "unknown";
  if ((resp[5] & 0xf0) !== 0xd0) return "unknown"; // not a Connection Confirm
  if (resp.length < 19) return "standard-rdp"; // no negotiation data: old servers that only do RDP security
  const type = resp[11];
  const value = resp.readUInt32LE(15);
  if (type === 0x02) return value === 0 ? "standard-rdp" : "tls-or-nla";
  if (type === 0x03) return value === 5 || value === 6 ? "nla-required" : "tls-or-nla";
  return "unknown";
}

export async function probeRdp(ip: string, port: number): Promise<ProbeResult | null> {
  const resp = await exchange(ip, port, { send: RDP_NEG_REQ_RDP_ONLY, timeoutMs: 3000, until: (b) => b.length >= 4 && b.length >= b.readUInt16BE(2) });
  const sec = parseRdpNegotiation(resp);
  if (sec === "unknown" && !resp) return null;
  const issues: NetIssue[] = [];
  if (sec === "standard-rdp") {
    issues.push({
      checkId: "rdp.no-nla",
      title: "Remote Desktop without Network Level Authentication",
      severity: "high",
      summary: "The server accepts Remote Desktop connections that don't prove who they are before the login screen.",
      why: "Without NLA, attackers reach Windows' login screen and the code behind it without credentials, which is where pre-login bugs like BlueKeep (CVE-2019-0708) strike.",
      steps: ["On the PC: Settings → System → Remote Desktop → Advanced → \"Require devices to use Network Level Authentication\"."],
      cves: ["CVE-2019-0708"],
      confidence: "likely",
    });
  }
  return { service: { port, proto: "tcp", name: "rdp", notes: [sec === "nla-required" ? "NLA required" : sec === "tls-or-nla" ? "TLS/NLA" : sec] }, issues };
}

// ── VNC ──

export async function probeVnc(ip: string, port: number): Promise<ProbeResult | null> {
  const c = await Conversation.open(ip, port, 3000);
  if (!c) return null;
  try {
    const hello = (await c.readBytes(12, 3000)).toString("latin1");
    const m = hello.match(/^RFB (\d{3})\.(\d{3})/);
    if (!m) return null;
    const minor = Number(m[2]);
    const issues: NetIssue[] = [];
    let types: number[] = [];
    if (Number(m[1]) === 3 && minor < 7) {
      c.write("RFB 003.003\n");
      const t = await c.readBytes(4, 3000);
      if (t.length >= 4) types = [t.readUInt32BE(0)];
    } else {
      c.write(minor >= 8 || Number(m[1]) > 3 ? "RFB 003.008\n" : "RFB 003.007\n");
      const t = await c.read((b) => b.length >= 1 && b.length >= 1 + b[0], 3000);
      if (t.length >= 1) types = [...t.subarray(1, 1 + t[0])];
    }
    if (types.includes(1)) {
      issues.push({
        checkId: "vnc.no-auth",
        title: "VNC remote desktop without a password",
        severity: "critical",
        summary: "This VNC server lets anyone see and control the screen without a password.",
        why: "Open VNC servers are found by scanners in minutes and used to take over the machine.",
        steps: ["Set a password in the VNC server's settings, or turn it off.", "For remote access, reach it through SSH or a VPN instead of opening it to the network."],
      });
    } else if (types.length && types.every((t) => t === 2)) {
      issues.push({
        checkId: "vnc.weak-auth",
        title: "VNC only uses its weak built-in password",
        severity: "low",
        summary: "The server only offers classic VNC authentication, whose passwords are cut to 8 characters.",
        why: "8-character passwords can be guessed, and the connection itself isn't encrypted.",
        steps: ["Use a VNC server with stronger login and encryption (VeNCrypt, or Apple's Screen Sharing), or tunnel it through SSH."],
      });
    }
    return { service: { port, proto: "tcp", name: "vnc", banner: hello.trim(), notes: types.length ? [`auth types ${types.join(",")}`] : [] }, issues };
  } finally {
    c.close();
  }
}

// ── MQTT ──

export function mqttConnect(clientId = "bulwark-check"): Buffer {
  const id = Buffer.from(clientId);
  const varHeader = Buffer.from([0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x1e]); // "MQTT", v3.1.1, clean session, keepalive 30
  const payload = Buffer.concat([Buffer.from([id.length >> 8, id.length & 0xff]), id]);
  const rest = varHeader.length + payload.length;
  return Buffer.concat([Buffer.from([0x10, rest]), varHeader, payload]);
}

export async function probeMqtt(ip: string, port: number): Promise<ProbeResult | null> {
  const c = await Conversation.open(ip, port, 3000);
  if (!c) return null;
  try {
    c.write(mqttConnect(`bulwark-${Math.random().toString(16).slice(2, 8)}`));
    const r = await c.readBytes(4, 3000);
    if (r.length < 4 || r[0] !== 0x20) return null;
    const code = r[3];
    if (code === 0) c.write(Buffer.from([0xe0, 0x00])); // DISCONNECT
    const issues: NetIssue[] = [];
    if (code === 0) {
      issues.push({
        checkId: "mqtt.anonymous",
        title: "MQTT broker accepts anyone",
        severity: "high",
        summary: "The broker accepted a connection without a user name or password.",
        why: "MQTT often carries smart-home commands. Anyone on the network can read every message and switch devices on or off.",
        steps: ["In mosquitto.conf: allow_anonymous false and password_file /etc/mosquitto/passwd (create users with mosquitto_passwd), then restart."],
      });
    }
    return { service: { port, proto: "tcp", name: "mqtt", notes: [code === 0 ? "anonymous allowed" : `login required (code ${code})`] }, issues };
  } finally {
    c.close();
  }
}

// ── Android Debug Bridge ──

export function adbConnect(): Buffer {
  const payload = Buffer.from("host::bulwark\0");
  const h = Buffer.alloc(24);
  const CNXN = 0x4e584e43;
  h.writeUInt32LE(CNXN, 0);
  h.writeUInt32LE(0x01000001, 4);
  h.writeUInt32LE(256 * 1024, 8);
  h.writeUInt32LE(payload.length, 12);
  h.writeUInt32LE(payload.reduce((a, b) => a + b, 0), 16);
  h.writeUInt32LE((CNXN ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, payload]);
}

export async function probeAdb(ip: string, port: number): Promise<ProbeResult | null> {
  const r = await exchange(ip, port, { send: adbConnect(), timeoutMs: 3000, until: (b) => b.length >= 24 });
  if (!r || r.length < 24) return null;
  const cmd = r.readUInt32LE(0);
  const issues: NetIssue[] = [];
  if (cmd === 0x4e584e43) {
    const banner = r.subarray(24).toString("latin1").replace(/\0/g, "");
    issues.push({
      checkId: "adb.open",
      title: "Android debugging is open to the network",
      severity: "critical",
      summary: "The device accepts ADB connections without approval, which gives a full shell.",
      why: "Bots look for open ADB ports (5555) to install crypto miners and spread to other devices.",
      steps: [
        "On the device: Settings → Developer options → turn off \"ADB over network\" / \"Wireless debugging\" (or run adb usb).",
        `Or let Bulwark check the device and turn it off for you: bulwark android connect ${ip}, then bulwark scan --android.`,
        "On TV boxes that don't offer the setting, contact the maker or replace the box.",
      ],
      evidence: banner ? [banner.slice(0, 200)] : [],
    });
  } else if (cmd === 0x48545541) {
    issues.push({
      checkId: "adb.exposed",
      title: "Android network debugging is on",
      severity: "medium",
      summary: "ADB is listening on the network. It asks for approval on the device, but shouldn't be left on.",
      why: "Anyone who once got approval, or tricks someone into tapping \"Allow\", gets a full shell.",
      steps: ["Turn off \"ADB over network\" / \"Wireless debugging\" in Developer options when you're not using it."],
    });
  } else return null;
  return { service: { port, proto: "tcp", name: "adb" }, issues };
}

// ── MongoDB ──

function bsonEncode(doc: Record<string, number | string | boolean>): Buffer {
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(doc)) {
    const key = Buffer.from(k + "\0");
    if (typeof v === "number") {
      const b = Buffer.alloc(4);
      b.writeInt32LE(v);
      parts.push(Buffer.from([0x10]), key, b);
    } else if (typeof v === "boolean") parts.push(Buffer.from([0x08]), key, Buffer.from([v ? 1 : 0]));
    else {
      const s = Buffer.from(v + "\0");
      const len = Buffer.alloc(4);
      len.writeInt32LE(s.length);
      parts.push(Buffer.from([0x02]), key, len, s);
    }
  }
  const body = Buffer.concat([...parts, Buffer.from([0])]);
  const len = Buffer.alloc(4);
  len.writeInt32LE(body.length + 4);
  return Buffer.concat([len, body]);
}

export function bsonDecode(buf: Buffer, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (buf.length < 5 || depth > 4) return out;
  const end = Math.min(buf.readInt32LE(0), buf.length);
  let p = 4;
  while (p < end - 1) {
    const type = buf[p++];
    const z = buf.indexOf(0, p);
    if (z < 0) break;
    const key = buf.toString("utf8", p, z);
    p = z + 1;
    switch (type) {
      case 0x01: out[key] = buf.readDoubleLE(p); p += 8; break;
      case 0x02: { const n = buf.readInt32LE(p); out[key] = buf.toString("utf8", p + 4, p + 4 + n - 1); p += 4 + n; break; }
      case 0x03: case 0x04: { const n = buf.readInt32LE(p); out[key] = bsonDecode(buf.subarray(p, p + n), depth + 1); p += n; break; }
      case 0x05: { const n = buf.readInt32LE(p); p += 5 + n; break; }
      case 0x07: p += 12; break;
      case 0x08: out[key] = buf[p] === 1; p += 1; break;
      case 0x09: case 0x11: case 0x12: out[key] = type === 0x12 ? Number(buf.readBigInt64LE(p)) : null; p += 8; break;
      case 0x0a: out[key] = null; break;
      case 0x10: out[key] = buf.readInt32LE(p); p += 4; break;
      case 0x13: p += 16; break;
      default: return out;
    }
  }
  return out;
}

function opMsg(doc: Record<string, number | string | boolean>, requestId: number): Buffer {
  const body = Buffer.concat([Buffer.alloc(4), Buffer.from([0]), bsonEncode(doc)]);
  const h = Buffer.alloc(16);
  h.writeInt32LE(16 + body.length, 0);
  h.writeInt32LE(requestId, 4);
  h.writeInt32LE(0, 8);
  h.writeInt32LE(2013, 12);
  return Buffer.concat([h, body]);
}

async function mongoCommand(c: Conversation, doc: Record<string, number | string | boolean>, id: number): Promise<Record<string, unknown> | null> {
  c.write(opMsg(doc, id));
  const r = await c.read((b) => b.length >= 4 && b.length >= b.readInt32LE(0), 3000);
  if (r.length < 21 || r.readInt32LE(12) !== 2013) return null;
  return bsonDecode(r.subarray(21));
}

export async function probeMongo(ip: string, port: number): Promise<ProbeResult | null> {
  const c = await Conversation.open(ip, port, 3000);
  if (!c) return null;
  try {
    const info = await mongoCommand(c, { buildInfo: 1, $db: "admin" }, 1);
    if (!info) return null;
    const version = typeof info.version === "string" ? info.version : undefined;
    const dbs = await mongoCommand(c, { listDatabases: 1, nameOnly: true, $db: "admin" }, 2);
    const open = dbs?.ok === 1;
    const issues: NetIssue[] = [];
    if (open) {
      const list = dbs?.databases && typeof dbs.databases === "object" ? Object.keys(dbs.databases as object).length : 0;
      issues.push({
        checkId: "mongodb.no-auth",
        title: "MongoDB is open without a password",
        severity: "critical",
        summary: `Anyone on the network can read and delete this database${list ? ` (${list} database${list === 1 ? "" : "s"})` : ""}.`,
        why: "Bots wipe open MongoDB servers and leave a ransom note, every day.",
        steps: ["Create an admin user, then set security.authorization: enabled and net.bindIp: 127.0.0.1 in /etc/mongod.conf and restart."],
      });
    } else {
      issues.push({
        checkId: "mongodb.exposed",
        title: "MongoDB is reachable from the network",
        severity: "low",
        summary: "It asks for a password, but databases are safer when only the apps that need them can reach them.",
        why: "Every reachable database is one weak password or one bug away from a breach.",
        steps: ["Set net.bindIp to 127.0.0.1 (or your app servers' addresses) in /etc/mongod.conf."],
      });
    }
    if (version) {
      for (const v of matchSoftware({ product: "MongoDB", version })) {
        issues.push({ checkId: "mongodb.version", subject: v.cves[0], title: v.title, severity: open && v.severity === "high" ? "critical" : v.severity, confidence: v.confidence, summary: `This is MongoDB ${version}.`, why: v.why, steps: v.steps, cves: v.cves });
      }
    }
    return { service: { port, proto: "tcp", name: "mongodb", product: "MongoDB", version }, issues };
  } finally {
    c.close();
  }
}
