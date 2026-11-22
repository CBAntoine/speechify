// SSH: reads the banner and the server's list of algorithms. No login is attempted.

import { matchSoftware, parseSshBanner } from "../fingerprints.ts";
import { Conversation } from "../tcp.ts";
import type { NetIssue, ProbeResult } from "../types.ts";

export interface KexInit {
  kex: string[];
  hostKey: string[];
  ciphers: string[];
  macs: string[];
}

/** Parses the first binary packet after the banner, which must be the server's KEXINIT. */
export function parseKexInit(buf: Buffer): KexInit | null {
  if (buf.length < 6) return null;
  const len = buf.readUInt32BE(0);
  if (len < 20 || len > 65_536 || buf.length < 4 + len) return null;
  const payload = buf.subarray(5, 4 + len - buf[4]);
  if (payload[0] !== 20) return null;
  let pos = 17; // message type + 16-byte cookie
  const lists: string[][] = [];
  for (let i = 0; i < 10; i++) {
    if (pos + 4 > payload.length) return null;
    const n = payload.readUInt32BE(pos);
    pos += 4;
    if (pos + n > payload.length) return null;
    lists.push(payload.toString("latin1", pos, pos + n).split(",").filter(Boolean));
    pos += n;
  }
  return { kex: lists[0], hostKey: lists[1], ciphers: [...new Set([...lists[2], ...lists[3]])], macs: [...new Set([...lists[4], ...lists[5]])] };
}

const WEAK_KEX = /^(diffie-hellman-group1-sha1|diffie-hellman-group-exchange-sha1|gss-group1-sha1-.*)$/;
const WEAK_HOSTKEY = /^ssh-dss$/;
const WEAK_CIPHER = /^(3des-cbc|blowfish-cbc|cast128-cbc|arcfour(128|256)?|des-cbc.*|none|rijndael-cbc@lysator\.liu\.se)$/;
const WEAK_MAC = /^(hmac-md5(-96)?(-etm@openssh\.com)?|hmac-sha1-96(-etm@openssh\.com)?|hmac-ripemd160.*|umac-32@openssh\.com|none)$/;

export function terrapinVulnerable(k: KexInit): boolean {
  const strict = k.kex.includes("kex-strict-s-v00@openssh.com");
  const chacha = k.ciphers.includes("chacha20-poly1305@openssh.com");
  const cbcEtm = k.ciphers.some((c) => c.endsWith("-cbc")) && k.macs.some((m) => m.endsWith("-etm@openssh.com"));
  return !strict && (chacha || cbcEtm);
}

export async function probeSsh(ip: string, port: number): Promise<ProbeResult | null> {
  const c = await Conversation.open(ip, port, 3000);
  if (!c) return null;
  try {
    // Servers may send other lines before the version line.
    let banner = "";
    for (let i = 0; i < 5 && !banner; i++) {
      const line = (await c.readLine(3000)).toString("latin1");
      if (!line) break;
      banner = line.split("\n").find((l) => l.startsWith("SSH-")) ?? "";
    }
    if (!banner) return null;
    const sw = parseSshBanner(banner);
    c.write("SSH-2.0-BulwarkScanner_0.1\r\n");
    const pkt = await c.read((b) => b.length >= 4 && b.length >= 4 + b.readUInt32BE(0), 4000);
    const kex = parseKexInit(pkt);
    const issues: NetIssue[] = [];

    if (sw.protocol === "1.99" || sw.protocol.startsWith("1.")) {
      issues.push({
        checkId: "ssh.protocol1",
        title: "SSH server still speaks the broken SSH-1 protocol",
        severity: "high",
        summary: `The server announces protocol ${sw.protocol}, so it accepts SSH-1 connections.`,
        why: "SSH-1 has design flaws that let attackers decrypt or take over sessions.",
        steps: ["Turn off protocol 1 (Protocol 2 in sshd_config) or update the device's firmware."],
        evidence: [sw.raw],
      });
    }
    for (const v of matchSoftware(sw)) {
      issues.push({
        checkId: "ssh.version",
        subject: v.cves[0] ?? v.title,
        title: v.title,
        severity: v.severity,
        confidence: v.confidence,
        summary: `The SSH server identifies as "${sw.raw}".`,
        why: v.why,
        steps: v.steps,
        cves: v.cves,
        evidence: [sw.raw],
      });
    }
    if (kex) {
      if (terrapinVulnerable(kex)) {
        issues.push({
          checkId: "ssh.terrapin",
          title: "SSH server is open to the Terrapin attack (CVE-2023-48795)",
          severity: "medium",
          summary: "The server offers ChaCha20-Poly1305 or CBC with encrypt-then-MAC, without the strict key exchange that fixes Terrapin.",
          why: "Someone who can intercept the connection can quietly remove security messages at the start of a session, weakening it.",
          steps: ["Update the SSH server (OpenSSH 9.6 or later, Dropbear 2024.84 or later), or turn off chacha20-poly1305@openssh.com and the *-etm@openssh.com MACs."],
          cves: ["CVE-2023-48795"],
          evidence: [`kex: ${kex.kex.join(",")}`, `ciphers: ${kex.ciphers.join(",")}`],
          references: ["https://terrapin-attack.com/"],
        });
      }
      const weak = [...kex.kex.filter((a) => WEAK_KEX.test(a)), ...kex.hostKey.filter((a) => WEAK_HOSTKEY.test(a)), ...kex.ciphers.filter((a) => WEAK_CIPHER.test(a)), ...kex.macs.filter((a) => WEAK_MAC.test(a))];
      if (weak.length) {
        const bad = weak.some((w) => /none|arcfour|des-cbc|group1/.test(w));
        issues.push({
          checkId: "ssh.weak-crypto",
          title: "SSH server allows weak encryption",
          severity: bad ? "medium" : "low",
          summary: `It still accepts ${weak.slice(0, 5).join(", ")}${weak.length > 5 ? "…" : ""}.`,
          why: "Old algorithms like 3DES, RC4 (arcfour), MD5 and 1024-bit Diffie-Hellman can be broken or downgraded to.",
          steps: ["Update the SSH server, or remove these from its Ciphers, MACs and KexAlgorithms settings."],
          evidence: weak,
        });
      }
    }
    return {
      service: { port, proto: "tcp", name: "ssh", product: sw.product, version: sw.version, banner: sw.raw, notes: sw.distro ? [`${sw.distro} build`] : [] },
      issues,
    };
  } finally {
    c.close();
  }
}
