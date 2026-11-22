// Probes for line-based protocols, plus services that are a risk just by being reachable.

import { matchSoftware, parseMysqlVersion, type Software } from "../fingerprints.ts";
import { Conversation, exchange, parseHttpResponse } from "../tcp.ts";
import type { NetIssue, ProbeResult } from "../types.ts";

function versionIssues(sw: Software, checkId: string, what: string, boost = false): NetIssue[] {
  return matchSoftware(sw).map((v) => ({
    checkId,
    subject: v.cves[0] ?? v.title,
    title: v.title,
    severity: boost && v.severity === "high" ? "critical" : v.severity,
    confidence: v.confidence,
    summary: `${what} identifies as ${sw.product} ${sw.version}.`,
    why: v.why,
    steps: v.steps,
    cves: v.cves,
  }));
}

// ── Telnet ──

/** Removes telnet negotiation bytes and returns what's left as text, plus our refusals to reply with. */
export function stripTelnet(buf: Buffer): { text: string; reply: Buffer } {
  const text: number[] = [];
  const reply: number[] = [];
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0xff && i + 1 < buf.length) {
      const cmd = buf[i + 1];
      if (cmd >= 0xfb && cmd <= 0xfe && i + 2 < buf.length) {
        const opt = buf[i + 2];
        // DO → WONT, WILL → DONT: decline everything politely.
        if (cmd === 0xfd) reply.push(0xff, 0xfc, opt);
        if (cmd === 0xfb) reply.push(0xff, 0xfe, opt);
        i += 2;
      } else if (cmd === 0xfa) {
        const se = buf.indexOf(Buffer.from([0xff, 0xf0]), i);
        i = se === -1 ? buf.length : se + 1;
      } else i += 1;
      continue;
    }
    text.push(buf[i]);
  }
  return { text: Buffer.from(text).toString("latin1").replace(/[^\x09\x0a\x0d\x20-\x7e]/g, ""), reply: Buffer.from(reply) };
}

export async function probeTelnet(ip: string, port: number): Promise<ProbeResult | null> {
  const c = await Conversation.open(ip, port, 3000);
  if (!c) return null;
  let text = "";
  try {
    let first = await c.read((b) => b.length > 0 && /[:#$>]\s*$/.test(stripTelnet(b).text), 2500);
    let s = stripTelnet(first);
    text += s.text;
    if (s.reply.length) {
      c.write(s.reply);
      first = await c.read((b) => /[:#$>]\s*$/.test(stripTelnet(b).text), 2000);
      s = stripTelnet(first);
      text += s.text;
    }
  } finally {
    c.close();
  }
  const banner = text.trim().slice(0, 300);
  // A prompt ending in # or $ with no login question means a shell for anyone who connects.
  const shell = /built-in shell|(^|\n)[^\n]{0,40}[#$]\s*$/.test(banner) && !/login|user ?name|password/i.test(banner);
  const issues: NetIssue[] = [
    shell
      ? {
          checkId: "telnet.no-login",
          title: "Telnet gives a shell without a password",
          severity: "critical",
          summary: "Connecting to Telnet drops straight into a command prompt.",
          why: "Anyone on the network can control this device completely, no password needed.",
          steps: ["Turn Telnet off in the device's settings or update its firmware. If neither is possible, take it off the network."],
          evidence: banner ? [banner] : [],
        }
      : {
          checkId: "telnet.open",
          title: "Telnet is on",
          severity: "high",
          summary: "The device accepts Telnet logins, which send the password and everything else unencrypted.",
          why: "Telnet is the first thing IoT botnets like Mirai try, with lists of factory passwords.",
          steps: ["Turn Telnet off in the device's settings (look under Administration, Network or Advanced).", "Use SSH or the web interface instead, and change the device's password if it's still the factory one."],
          evidence: banner ? [banner] : [],
        },
  ];
  return { service: { port, proto: "tcp", name: "telnet", banner: banner.split("\n")[0]?.slice(0, 120), product: /busybox/i.test(banner) ? "BusyBox" : undefined }, issues };
}

// ── FTP ──

export function parseFtpBanner(banner: string): Software | null {
  const vs = banner.match(/vsFTPd (\d+\.\d+\.\d+)/i);
  if (vs) return { product: "vsftpd", version: vs[1] };
  const pro = banner.match(/ProFTPD (\d+\.\d+\.\d+[a-z]*)/i);
  if (pro) return { product: "ProFTPD", version: pro[1] };
  return null;
}

export async function probeFtp(ip: string, port: number): Promise<ProbeResult | null> {
  const c = await Conversation.open(ip, port, 3000);
  if (!c) return null;
  let banner = "";
  let feat = "";
  try {
    banner = (await c.read((b) => /^\d{3} [^\n]*\n/m.test(b.toString("latin1")), 3000)).toString("latin1");
    if (!/^220/m.test(banner)) return null;
    c.write("FEAT\r\n");
    feat = (await c.read((b) => /^\d{3} [^\n]*\n/m.test(b.toString("latin1")), 3000)).toString("latin1");
    c.write("QUIT\r\n");
  } finally {
    c.close();
  }
  const first = banner.split(/\r?\n/).find((l) => l.startsWith("220")) ?? banner;
  const tls = /AUTH TLS|AUTH SSL/i.test(feat);
  const issues: NetIssue[] = [
    {
      checkId: "ftp.plaintext",
      title: tls ? "FTP allows unencrypted logins" : "FTP without encryption",
      severity: tls ? "low" : "medium",
      summary: tls ? "The FTP server supports encryption (FTPS) but doesn't require it." : "The FTP server sends user names, passwords and files unencrypted.",
      why: "Anyone on the network path can capture FTP passwords and files.",
      steps: ["Use SFTP (part of SSH) instead and turn FTP off, or require TLS (vsftpd: force_local_logins_ssl=YES)."],
      evidence: [first.trim()],
    },
  ];
  const sw = parseFtpBanner(banner);
  if (sw) issues.push(...versionIssues(sw, "ftp.version", "The FTP server"));
  return { service: { port, proto: "tcp", name: "ftp", banner: first.trim().slice(0, 120), product: sw?.product, version: sw?.version }, issues };
}

// ── Redis ──

export async function probeRedis(ip: string, port: number): Promise<ProbeResult | null> {
  const c = await Conversation.open(ip, port, 3000);
  if (!c) return null;
  try {
    c.write("PING\r\n");
    const pong = (await c.read((b) => b.includes(0x0a), 3000)).toString("latin1");
    if (!/^[+-]/.test(pong)) return null;
    const issues: NetIssue[] = [];
    let version: string | undefined;
    if (pong.startsWith("+PONG")) {
      c.write("INFO server\r\n");
      const info = (await c.read((b) => /redis_version:[^\r\n]+\r\n[\s\S]*\r\n\r\n|redis_mode/.test(b.toString("latin1")), 3000)).toString("latin1");
      version = info.match(/redis_version:([\d.]+)/)?.[1];
      issues.push({
        checkId: "redis.no-auth",
        title: "Redis is open without a password",
        severity: "critical",
        summary: `Anyone on the network can read and change everything in this Redis${version ? ` (version ${version})` : ""}.`,
        why: "An open Redis can be told to write files, which attackers use to add their SSH key or a cron job and take over the machine.",
        steps: ["In redis.conf: bind 127.0.0.1, protected-mode yes, and requirepass <a long password> if other devices need it. Then restart Redis."],
      });
      if (version) issues.push(...versionIssues({ product: "Redis", version }, "redis.version", "Redis", true));
    } else if (/NOAUTH|WRONGPASS|AUTH/i.test(pong)) {
      issues.push({
        checkId: "redis.exposed",
        title: "Redis is reachable from the network",
        severity: "low",
        summary: "It asks for a password, but caches are safer when only local apps can reach them.",
        why: "A reachable Redis is one weak password away from a takeover.",
        steps: ["Set bind 127.0.0.1 in redis.conf unless other machines really need it."],
      });
    }
    // "-DENIED ... protected mode" means Redis already refuses outsiders.
    return { service: { port, proto: "tcp", name: "redis", product: "Redis", version, notes: [pong.trim().slice(0, 80)] }, issues };
  } finally {
    c.close();
  }
}

// ── Memcached ──

export async function probeMemcached(ip: string, port: number): Promise<ProbeResult | null> {
  const r = await exchange(ip, port, { send: "version\r\n", timeoutMs: 3000, until: (b) => b.includes(0x0a) });
  const text = r?.toString("latin1") ?? "";
  const m = text.match(/^VERSION (\S+)/);
  if (!m) return null;
  return {
    service: { port, proto: "tcp", name: "memcached", product: "Memcached", version: m[1] },
    issues: [
      {
        checkId: "memcached.no-auth",
        title: "Memcached is open to the network",
        severity: "high",
        summary: `Anyone on the network can read and change cached data (Memcached ${m[1]}).`,
        why: "Memcached has no passwords. Caches often hold session tokens and personal data.",
        steps: ["Add -l 127.0.0.1 (and -U 0) to /etc/memcached.conf and restart memcached."],
      },
    ],
  };
}

// ── RTSP (cameras) ──

export async function probeRtsp(ip: string, port: number): Promise<ProbeResult | null> {
  const opt = await exchange(ip, port, { send: `OPTIONS rtsp://${ip}:${port}/ RTSP/1.0\r\nCSeq: 1\r\nUser-Agent: Bulwark\r\n\r\n`, timeoutMs: 3000, until: (b) => b.includes("\r\n\r\n") });
  const res = opt ? parseHttpResponse(opt) : null;
  if (!res) return null;
  const desc = await exchange(ip, port, {
    send: `DESCRIBE rtsp://${ip}:${port}/ RTSP/1.0\r\nCSeq: 2\r\nAccept: application/sdp\r\nUser-Agent: Bulwark\r\n\r\n`,
    timeoutMs: 3000,
    until: (b) => b.includes("\r\n\r\n"),
  });
  const d = desc ? parseHttpResponse(desc) : null;
  const issues: NetIssue[] = [];
  if (d?.status === 200 && /sdp/i.test(d.headers["content-type"] ?? "")) {
    issues.push({
      checkId: "rtsp.open-stream",
      title: "Camera stream viewable without a password",
      severity: "high",
      summary: "The video stream answers without asking for a login.",
      why: "Anyone on the network (or the internet, if the port is forwarded) can watch this camera.",
      steps: ["Turn on authentication for RTSP/streaming in the camera's settings and set a strong password.", "Check that the router doesn't forward port 554."],
    });
  }
  return { service: { port, proto: "tcp", name: "rtsp", banner: res.headers["server"], product: res.headers["server"] }, issues };
}

// ── Databases ──

export async function probeMysql(ip: string, port: number): Promise<ProbeResult | null> {
  const r = await exchange(ip, port, { timeoutMs: 3000, until: (b) => b.length >= 4 && b.length >= 4 + (b[0] | (b[1] << 8) | (b[2] << 16)) });
  if (!r || r.length < 6) return null;
  const payload = r.subarray(4);
  if (payload[0] === 0xff) {
    // An error at hello ("Host is not allowed to connect") means it already refuses us.
    return { service: { port, proto: "tcp", name: "mysql", notes: ["refuses this device"] }, issues: [] };
  }
  if (payload[0] !== 0x0a) return null;
  const z = payload.indexOf(0, 1);
  const raw = payload.toString("latin1", 1, z > 0 ? z : Math.min(payload.length, 60));
  const sw = parseMysqlVersion(raw);
  const issues: NetIssue[] = [
    {
      checkId: "mysql.exposed",
      title: `${sw.product} is reachable from the network`,
      severity: "medium",
      summary: `${sw.product} ${sw.version ?? ""} answers connections from other devices.`.replace(/\s+/g, " "),
      why: "Databases should only take connections from the apps that use them; exposed ones get password-guessing attacks.",
      steps: ["Set bind-address = 127.0.0.1 in the [mysqld] section of my.cnf (unless another machine needs it) and restart."],
    },
    ...versionIssues(sw, "mysql.version", "The database"),
  ];
  return { service: { port, proto: "tcp", name: "mysql", product: sw.product, version: sw.version, banner: raw }, issues };
}

export async function probePostgres(ip: string, port: number): Promise<ProbeResult | null> {
  const sslRequest = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
  const r = await exchange(ip, port, { send: sslRequest, timeoutMs: 3000, until: (b) => b.length >= 1 });
  if (!r || r.length < 1 || (r[0] !== 0x53 && r[0] !== 0x4e)) return null;
  return {
    service: { port, proto: "tcp", name: "postgresql", product: "PostgreSQL", notes: [r[0] === 0x53 ? "TLS available" : "no TLS"] },
    issues: [
      {
        checkId: "postgres.exposed",
        title: "PostgreSQL is reachable from the network",
        severity: "medium",
        summary: `PostgreSQL answers connections from other devices${r[0] === 0x4e ? ", without TLS" : ""}.`,
        why: "Databases should only take connections from the apps that use them; exposed ones get password-guessing attacks.",
        steps: ["Set listen_addresses = 'localhost' in postgresql.conf (or limit pg_hba.conf to your app servers) and restart."],
      },
    ],
  };
}

// ── Reachable at all ──

export function exposureProbe(name: string, issue: Omit<NetIssue, "checkId"> & { checkId: string }) {
  return async (ip: string, port: number): Promise<ProbeResult | null> => ({ service: { port, proto: "tcp", name }, issues: [{ ...issue }] });
}
