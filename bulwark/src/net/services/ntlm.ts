// Which Windows a PC runs, from its file-sharing service: the first step of an SMB login (before
// any user name or password) has the server state its Windows version and computer name. Bulwark
// reads that and hangs up. It's what `nmap --script smb-os-discovery` does.

import { supportStatus, WINDOWS_11 } from "../../software/installed.ts";
import { Conversation } from "../tcp.ts";
import type { NetIssue } from "../types.ts";

function header(command: number, messageId: number): Buffer {
  const h = Buffer.alloc(64);
  h.writeUInt32BE(0xfe534d42, 0); // \xFESMB
  h.writeUInt16LE(64, 4);
  h.writeUInt16LE(command, 12);
  h.writeUInt16LE(1, 14); // credits requested
  h.writeBigUInt64LE(BigInt(messageId), 24);
  return h;
}

const frame = (smb: Buffer) => {
  const nb = Buffer.alloc(4);
  nb.writeUInt32BE(smb.length, 0);
  return Buffer.concat([nb, smb]);
};

/** SMB2 NEGOTIATE offering 2.0.2 to 3.0.2 (3.1.1 would need extra negotiation contexts). */
export function smb2Negotiate(): Buffer {
  const dialects = [0x0202, 0x0210, 0x0300, 0x0302];
  const body = Buffer.alloc(36 + dialects.length * 2);
  body.writeUInt16LE(36, 0);
  body.writeUInt16LE(dialects.length, 2);
  body.writeUInt16LE(1, 4); // signing enabled
  Buffer.from("bulwark-netcheck").copy(body, 12); // client GUID (any 16 bytes)
  dialects.forEach((d, i) => body.writeUInt16LE(d, 36 + i * 2));
  return frame(Buffer.concat([header(0x0000, 0), body]));
}

function der(tag: number, content: Buffer): Buffer {
  const n = content.length;
  const len = n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]);
  return Buffer.concat([Buffer.from([tag]), len, content]);
}

/** NTLMSSP NEGOTIATE (no names, no credentials), wrapped in SPNEGO as Windows expects. */
export function ntlmNegotiateToken(): Buffer {
  const ntlm = Buffer.alloc(40);
  ntlm.write("NTLMSSP\0", 0, "latin1");
  ntlm.writeUInt32LE(1, 8);
  ntlm.writeUInt32LE(0xa2088207, 12); // unicode, request target, NTLM, extended security, version, 128/56-bit
  Buffer.from([6, 1, 0xb1, 0x1d, 0, 0, 0, 15]).copy(ntlm, 32);
  const ntlmOid = Buffer.from([0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x02, 0x02, 0x0a]);
  const spnegoOid = Buffer.from([0x06, 0x06, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x02]);
  const init = der(0x30, Buffer.concat([der(0xa0, der(0x30, ntlmOid)), der(0xa2, der(0x04, ntlm))]));
  return der(0x60, Buffer.concat([spnegoOid, der(0xa0, init)]));
}

export function smb2SessionSetup(): Buffer {
  const token = ntlmNegotiateToken();
  const body = Buffer.alloc(24);
  body.writeUInt16LE(25, 0);
  body[3] = 1; // signing enabled
  body.writeUInt16LE(64 + 24, 12); // security buffer offset
  body.writeUInt16LE(token.length, 14);
  return frame(Buffer.concat([header(0x0001, 1), body, token]));
}

export interface NtlmInfo {
  major: number;
  minor: number;
  build: number;
  computer?: string;
  domain?: string;
  dnsComputer?: string;
}

/** Finds the NTLMSSP CHALLENGE in a reply and reads the version and names out of it. */
export function parseNtlmChallenge(buf: Buffer): NtlmInfo | null {
  const at = buf.indexOf(Buffer.from("NTLMSSP\0", "latin1"));
  if (at < 0 || at + 56 > buf.length || buf.readUInt32LE(at + 8) !== 2) return null;
  const msg = buf.subarray(at);
  const flags = msg.readUInt32LE(20);
  if (!(flags & 0x02000000)) return null; // no version given
  const info: NtlmInfo = { major: msg[48], minor: msg[49], build: msg.readUInt16LE(50) };
  const len = msg.readUInt16LE(40);
  const off = msg.readUInt32LE(44);
  for (let p = off; p + 4 <= Math.min(msg.length, off + len); ) {
    const id = msg.readUInt16LE(p);
    const n = msg.readUInt16LE(p + 2);
    if (id === 0 || p + 4 + n > msg.length) break;
    const text = msg.toString("utf16le", p + 4, p + 4 + n);
    if (id === 1) info.computer = text;
    else if (id === 2) info.domain = text;
    else if (id === 3) info.dnsComputer = text;
    p += 4 + n;
  }
  return info;
}

const readFrame = (b: Buffer) => b.length >= 4 && b.length >= 4 + b.readUInt32BE(0);

export async function smbNtlmInfo(ip: string, port = 445, timeoutMs = 3000): Promise<NtlmInfo | null> {
  const c = await Conversation.open(ip, port, timeoutMs);
  if (!c) return null;
  try {
    c.write(smb2Negotiate());
    const neg = await c.read(readFrame, timeoutMs);
    if (neg.length < 4 + 64 || neg.readUInt32BE(4) !== 0xfe534d42) return null;
    c.write(smb2SessionSetup());
    return parseNtlmChallenge(await c.read(readFrame, timeoutMs));
  } catch {
    return null;
  } finally {
    c.close();
  }
}

export interface WindowsVersion {
  name: string;
  /** When security updates stopped (or stop) for the Home and Pro editions. */
  eol?: string;
  confidence: "likely" | "possible";
}

/**
 * The Windows release behind an NTLM version. Samba (and Macs) also answer, but report numbers
 * no real Windows has (like 6.1 build 0), so only real build numbers count.
 */
export function windowsFromNtlm(v: NtlmInfo): WindowsVersion | null {
  const { major, minor, build } = v;
  if (major === 6 && minor === 1 && (build === 7600 || build === 7601)) return { name: "Windows 7", eol: "2020-01-14", confidence: "likely" };
  if (major === 6 && minor === 2 && build === 9200) return { name: "Windows 8 (or Server 2012)", eol: "2023-10-10", confidence: "likely" };
  if (major === 6 && minor === 3 && build === 9600) return { name: "Windows 8.1 (or Server 2012 R2)", eol: "2023-10-10", confidence: "likely" };
  if (major !== 10 || minor !== 0 || build < 10240) return null;
  if (build === 14393) return { name: "Windows Server 2016 (or Windows 10 LTSB)", eol: "2027-01-12", confidence: "possible" };
  if (build === 17763) return { name: "Windows Server 2019 (or Windows 10 LTSC)", eol: "2029-01-09", confidence: "possible" };
  if (build === 20348) return { name: "Windows Server 2022", eol: "2031-10-14", confidence: "likely" };
  if (build === 19044) return { name: "Windows 10 21H2 (or LTSC 2021)", eol: "2025-10-14", confidence: "possible" };
  if (build < 22000) return { name: build >= 19041 ? "Windows 10" : `Windows 10 (build ${build})`, eol: "2025-10-14", confidence: "likely" };
  const known = Object.keys(WINDOWS_11).map(Number).filter((b) => b <= build).sort((a, b) => b - a)[0];
  const row = known ? WINDOWS_11[known] : undefined;
  return { name: `Windows 11${row ? ` ${row[0]}` : ""}`, eol: row?.[1], confidence: build === 26100 ? "possible" : "likely" };
}

export function windowsIssue(v: WindowsVersion, info: NtlmInfo): NetIssue | null {
  if (!v.eol || supportStatus(v.eol) !== "ended") return null;
  const when = new Date(`${v.eol}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const win11 = v.name.startsWith("Windows 11");
  return {
    checkId: "windows.unsupported",
    title: win11 ? "This PC's Windows 11 version no longer gets updates" : "This PC runs a Windows that no longer gets security updates",
    severity: win11 ? "medium" : "high",
    confidence: v.confidence,
    summary: `${info.computer ? `${info.computer} runs` : "It runs"} ${v.name} (build ${info.build}), which stopped getting security fixes in ${when}${win11 ? " on Home and Pro editions" : ""}.`,
    why: "Microsoft keeps fixing the holes it finds in Windows, but only for supported versions. A PC that stopped getting fixes collects known, published holes, and anything on the network can try them.",
    steps: win11
      ? ["On that PC: Settings → Windows Update → install the newest Windows 11 version it offers."]
      : [
          "On that PC: Settings → Windows Update → upgrade to Windows 11 if it's offered.",
          "If the PC can't run Windows 11, enroll it in Extended Security Updates, switch it to a supported system (ChromeOS Flex, Linux), or keep it off the network.",
        ],
    evidence: [`SMB/NTLM version ${info.major}.${info.minor} build ${info.build}${info.computer ? `, computer name ${info.computer}` : ""}${info.domain ? `, domain ${info.domain}` : ""}`],
  };
}
