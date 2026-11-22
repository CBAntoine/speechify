// Known-vulnerable software versions, matched against what devices say about themselves
// (SSH banners, HTTP Server headers, FTP greetings, database handshakes).
//
// Distributions often patch old versions without changing the version number, so for a build that
// says it's from Ubuntu, Debian or Red Hat, a rule only fires when it knows the distribution's
// fixed revision. Otherwise the version alone proves nothing and Bulwark stays quiet.

import type { Confidence, Severity } from "../core/types.ts";
import { compareDebian, compareVersions, versionInRange } from "../core/versions.ts";

export interface Software {
  product: string;
  version?: string;
  /** "Ubuntu", "Debian", "Red Hat"… when the banner says it's a distribution build. */
  distro?: string;
  /** Debian/Ubuntu package revision from the banner, e.g. "3ubuntu13.5". */
  revision?: string;
}

interface Rule {
  product: string;
  /** Vulnerable when the version is in this range… */
  range?: { gte?: string; lt?: string; eq?: string; lte?: string };
  /** …or, for projects with several maintained branches, when it's older than its branch's fix. */
  branchFixed?: string[];
  /** Any version (abandoned software). */
  any?: boolean;
  cves: string[];
  severity: Severity;
  title: string;
  why: string;
  steps: string[];
  confidence?: Confidence;
  /** Debian/Ubuntu revisions that carry the fix, keyed by upstream version. */
  distroFixed?: Record<string, string>;
  /** Rule applies to distribution builds even without a fixed revision (end-of-life releases). */
  distroToo?: boolean;
}

const UPDATE_FIRMWARE = "Update the device's firmware from the maker's website or its app. If no update exists, replace the device or keep it off networks you care about.";

export const RULES: Rule[] = [
  {
    product: "OpenSSH",
    range: { gte: "8.5p1", lt: "9.8p1" },
    cves: ["CVE-2024-6387"],
    severity: "high",
    title: "OpenSSH has the regreSSHion bug (CVE-2024-6387)",
    why: "A race in the SSH server's login timeout lets an attacker run code as root without logging in, on Linux systems that use glibc.",
    steps: ["Update OpenSSH to 9.8p1 or later (or your distribution's patched package).", "Until then, setting LoginGraceTime 0 in sshd_config blocks the attack (at the cost of a denial-of-service risk)."],
    distroFixed: { "8.9p1": "3ubuntu0.10", "9.3p1": "1ubuntu3.6", "9.6p1": "3ubuntu13.3", "9.2p1": "2+deb12u3" },
  },
  {
    product: "OpenSSH",
    range: { lt: "7.7" },
    cves: ["CVE-2018-15473", "CVE-2016-10009", "CVE-2016-6210"],
    severity: "medium",
    title: "Very old OpenSSH with known flaws",
    why: "OpenSSH older than 7.7 (2018) lets attackers check which user names exist and has several other fixed bugs.",
    steps: ["Update the device. If it's an appliance, update its firmware."],
    confidence: "likely",
  },
  {
    product: "Dropbear",
    range: { lt: "2016.74" },
    cves: ["CVE-2016-7406", "CVE-2016-7407", "CVE-2016-7408"],
    severity: "critical",
    title: "Old Dropbear SSH server with remote code execution bugs",
    why: "Dropbear before 2016.74 has bugs that let attackers run code on the device. It's common in old routers and cameras.",
    steps: [UPDATE_FIRMWARE],
    confidence: "likely",
  },
  {
    product: "Dropbear",
    range: { lt: "2020.79" },
    cves: ["CVE-2020-36254"],
    severity: "medium",
    title: "Outdated Dropbear SSH server",
    why: "Dropbear before 2020.79 has known security bugs.",
    steps: [UPDATE_FIRMWARE],
    confidence: "likely",
  },
  {
    product: "vsftpd",
    range: { eq: "2.3.4" },
    cves: ["CVE-2011-2523"],
    severity: "critical",
    title: "vsftpd 2.3.4 with a built-in backdoor",
    why: "This release was tampered with: typing a smiley as the user name opens a root shell on port 6200.",
    steps: ["Replace vsftpd with a current version, or turn the FTP server off.", "Treat the device as possibly compromised."],
  },
  {
    product: "ProFTPD",
    range: { lte: "1.3.6" },
    cves: ["CVE-2015-3306", "CVE-2019-12815"],
    severity: "high",
    title: "ProFTPD with the mod_copy file-copy flaw",
    why: "ProFTPD up to 1.3.6 lets anyone copy files on the server without logging in when mod_copy is loaded (it often is), which can lead to code execution.",
    steps: ["Update ProFTPD, or remove mod_copy (LoadModule mod_copy.c) from its configuration."],
    confidence: "possible",
  },
  {
    product: "Apache",
    range: { eq: "2.4.49" },
    cves: ["CVE-2021-41773"],
    severity: "critical",
    title: "Apache 2.4.49 path traversal (CVE-2021-41773)",
    why: "Apache 2.4.49 lets anyone read files outside the web folder, and run commands if CGI is on. It was exploited within days.",
    steps: ["Update Apache to 2.4.62 or later."],
  },
  {
    product: "Apache",
    range: { eq: "2.4.50" },
    cves: ["CVE-2021-42013"],
    severity: "critical",
    title: "Apache 2.4.50 path traversal (CVE-2021-42013)",
    why: "The fix for CVE-2021-41773 in 2.4.50 was incomplete, leaving the same file-reading and command-running hole.",
    steps: ["Update Apache to 2.4.62 or later."],
  },
  {
    product: "Apache",
    range: { lt: "2.4.0" },
    cves: [],
    severity: "high",
    title: "Apache 2.2 or older (unsupported since 2017)",
    why: "Apache 2.2 stopped getting security fixes in 2017.",
    steps: ["Update the web server, or the firmware of the device running it."],
    confidence: "likely",
    distroToo: true,
  },
  {
    product: "OpenSSL",
    range: { gte: "1.0.1", lt: "1.0.1g" },
    cves: ["CVE-2014-0160"],
    severity: "high",
    title: "OpenSSL version vulnerable to Heartbleed",
    why: "Heartbleed lets anyone read chunks of the server's memory, including private keys and passwords.",
    steps: ["Update OpenSSL (or the device's firmware), then replace the certificate and its private key."],
    confidence: "possible",
  },
  {
    product: "OpenSSL",
    range: { lt: "1.1.1" },
    cves: [],
    severity: "medium",
    title: "OpenSSL 1.0 or older (unsupported)",
    why: "OpenSSL 1.0.2 and older stopped getting public security fixes in 2019.",
    steps: ["Update the software or the device's firmware."],
    confidence: "likely",
  },
  {
    product: "IIS",
    range: { lt: "7.0" },
    cves: ["CVE-2017-7269"],
    severity: "critical",
    title: "IIS 6 or older (Windows Server 2003)",
    why: "IIS 6 is from Windows Server 2003, which has had no security fixes since 2015, and has a known remote code execution bug in WebDAV.",
    steps: ["Move the site to a supported Windows Server, or turn this machine off."],
    distroToo: true,
  },
  {
    product: "Boa",
    any: true,
    cves: ["CVE-2017-9833"],
    severity: "high",
    title: "Boa web server (abandoned in 2005)",
    why: "Boa hasn't been maintained since 2005, and the cameras and routers that still use it carry its known flaws.",
    steps: [UPDATE_FIRMWARE],
    confidence: "likely",
  },
  {
    product: "RomPager",
    range: { lt: "4.34" },
    cves: ["CVE-2014-9222"],
    severity: "critical",
    title: "RomPager web server with the Misfortune Cookie flaw",
    why: "Old RomPager versions, used in millions of routers, let anyone take over the router with a crafted cookie.",
    steps: [UPDATE_FIRMWARE],
    confidence: "likely",
  },
  {
    product: "MiniUPnPd",
    range: { lt: "1.9" },
    cves: ["CVE-2013-0229", "CVE-2013-0230"],
    severity: "high",
    title: "Old MiniUPnPd with remote code execution bugs",
    why: "MiniUPnPd before 1.9 can be crashed or taken over with a single crafted packet.",
    steps: [UPDATE_FIRMWARE, "Turn off UPnP in the router if you don't need it."],
    confidence: "likely",
  },
  {
    product: "uc-httpd",
    any: true,
    cves: ["CVE-2017-7577"],
    severity: "high",
    title: "Xiongmai camera/DVR web server with known flaws",
    why: "uc-httpd ships in Xiongmai-made cameras and recorders, which have file-reading bugs and were a major source of the Mirai botnet.",
    steps: [UPDATE_FIRMWARE, "Keep these devices on a separate network and never forward their ports."],
    confidence: "likely",
  },
  {
    product: "GoAhead",
    range: { lt: "3.6.5" },
    cves: ["CVE-2017-17562"],
    severity: "high",
    title: "Old GoAhead embedded web server",
    why: "GoAhead before 3.6.5 lets attackers run code through CGI, and many cameras run old versions.",
    steps: [UPDATE_FIRMWARE],
    confidence: "possible",
  },
  {
    product: "PHP",
    range: { lt: "8.2" },
    cves: [],
    severity: "medium",
    title: "Unsupported PHP version",
    why: "PHP 8.1 and older no longer get security fixes.",
    steps: ["Update PHP to a supported version (8.2 or newer)."],
    confidence: "likely",
  },
  {
    product: "Redis",
    branchFixed: ["6.2.20", "7.2.11", "7.4.6", "8.0.4", "8.2.2"],
    cves: ["CVE-2025-49844"],
    severity: "high",
    title: "Redis with the RediShell bug (CVE-2025-49844)",
    why: "A Lua scripting bug lets anyone who can run commands on this Redis break out and run code on the machine. (Linux distributions sometimes patch this without changing the version number Redis reports.)",
    steps: ["Update Redis to 8.2.2, 8.0.4, 7.4.6, 7.2.11 or 6.2.20 (or newer), or install your distribution's latest redis package.", "If you don't use Lua scripts, block them for other users with ACLs (-@scripting)."],
    confidence: "possible",
  },
  {
    product: "MongoDB",
    branchFixed: ["4.4.30", "5.0.32", "6.0.27", "7.0.28", "8.0.17", "8.2.3"],
    cves: ["CVE-2025-14847"],
    severity: "high",
    title: "MongoDB with the MongoBleed memory leak (CVE-2025-14847)",
    why: "A bug in MongoDB's zlib network compression lets anyone who can connect read pieces of the server's memory, without logging in.",
    steps: ["Update MongoDB to a fixed release (8.2.3, 8.0.17, 7.0.28, 6.0.27, 5.0.32, 4.4.30 or newer), or turn off zlib with net.compression.compressors."],
    confidence: "likely",
  },
  {
    product: "MySQL",
    range: { lt: "8.4" },
    cves: [],
    severity: "medium",
    title: "MySQL version without security support",
    why: "MySQL 8.0 and older stopped getting security fixes in April 2026.",
    steps: ["Upgrade to MySQL 8.4 LTS."],
    confidence: "likely",
  },
  {
    product: "MariaDB",
    range: { lt: "10.11" },
    cves: [],
    severity: "medium",
    title: "MariaDB version without security support",
    why: "MariaDB releases before 10.11 no longer get security fixes.",
    steps: ["Upgrade to MariaDB 10.11 or 11.4 (LTS)."],
    confidence: "likely",
  },
];

/** Operating systems that are past their end of security support, recognised from SSH banners. */
const EOL_FROM_SSH: { distro: string; upstream: string; name: string; ended: string }[] = [
  { distro: "Ubuntu", upstream: "7.2p2", name: "Ubuntu 16.04", ended: "April 2021" },
  { distro: "Ubuntu", upstream: "7.6p1", name: "Ubuntu 18.04", ended: "May 2023" },
  { distro: "Ubuntu", upstream: "8.2p1", name: "Ubuntu 20.04", ended: "May 2025" },
  { distro: "Debian", upstream: "7.4p1", name: "Debian 9", ended: "June 2022" },
  { distro: "Debian", upstream: "7.9p1", name: "Debian 10", ended: "June 2024" },
  { distro: "Debian", upstream: "8.4p1", name: "Debian 11", ended: "August 2026" },
];

export interface VulnMatch {
  title: string;
  severity: Severity;
  confidence: Confidence;
  cves: string[];
  why: string;
  steps: string[];
}

function branch(v: string): string {
  return v.split(".").slice(0, 2).join(".");
}

export function matchSoftware(sw: Software): VulnMatch[] {
  if (!sw.version) return [];
  const out: VulnMatch[] = [];
  for (const r of RULES) {
    if (r.product !== sw.product) continue;
    let vulnerable = false;
    if (r.any) vulnerable = true;
    else if (r.range) vulnerable = versionInRange(sw.version, r.range);
    else if (r.branchFixed) {
      const fixedSameBranch = r.branchFixed.find((f) => branch(f) === branch(sw.version!));
      const newest = r.branchFixed.reduce((a, b) => (compareVersions(a, b) > 0 ? a : b));
      vulnerable = fixedSameBranch ? compareVersions(sw.version, fixedSameBranch) < 0 : compareVersions(sw.version, newest) < 0;
    }
    if (!vulnerable) continue;
    let confidence: Confidence = r.confidence ?? "confirmed";
    if (sw.distro) {
      const fixedRev = r.distroFixed?.[sw.version];
      if (fixedRev && sw.revision) {
        if (compareDebian(`${sw.version}-${sw.revision}`, `${sw.version}-${fixedRev}`) >= 0) continue;
        confidence = "confirmed";
      } else if (!r.distroToo) {
        // Distribution builds get quiet backports; the upstream number proves nothing here.
        continue;
      } else confidence = "likely";
    }
    out.push({ title: r.title, severity: r.severity, confidence, cves: r.cves, why: r.why, steps: r.steps });
  }
  // Several rules for one product (an old Dropbear matches three) read better as one finding.
  if (out.length > 1) {
    const rank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    out.sort((a, b) => rank[a.severity] - rank[b.severity]);
    const [top, ...rest] = out;
    out.splice(0, out.length, {
      ...top,
      cves: [...new Set(out.flatMap((m) => m.cves))],
      why: `${top.why} ${rest.map((m) => m.why).join(" ")}`,
      steps: [...new Set(out.flatMap((m) => m.steps))],
    });
  }
  if (sw.product === "OpenSSH" && sw.distro) {
    const eol = EOL_FROM_SSH.find((e) => e.distro === sw.distro && e.upstream === sw.version);
    if (eol) {
      out.push({
        title: `Runs ${eol.name}, which no longer gets security updates`,
        severity: "high",
        confidence: "likely",
        cves: [],
        why: `${eol.name}'s regular security support ended in ${eol.ended}, so new holes in it stay open (unless it's on a paid extended-support plan).`,
        steps: [`Upgrade the device to a supported release.${eol.distro === "Debian" ? " On a Raspberry Pi, the simplest way is a fresh Raspberry Pi OS image." : ""}`],
      });
    }
  }
  return out;
}

// ── parsing what devices say ──

export function parseSshBanner(banner: string): Software & { protocol: string; raw: string } {
  const line = banner.split(/\r?\n/)[0].trim();
  const m = line.match(/^SSH-(\d\.\d+)-(\S+)(?:\s+(.*))?$/);
  if (!m) return { product: "unknown", protocol: "", raw: line };
  const [, protocol, soft, comment = ""] = m;
  let product = soft.split(/[_-]/)[0];
  let version: string | undefined;
  const ossh = soft.match(/^OpenSSH_([\d.]+(?:p\d+)?)/);
  const win = soft.match(/^OpenSSH_for_Windows_([\d.]+(?:p\d+)?)/);
  const drop = soft.match(/^dropbear_?(\d{4}\.\d+)?/i);
  if (win) {
    product = "OpenSSH for Windows";
    version = win[1];
  } else if (ossh) {
    // Portable OpenSSH (Linux) carries a "p" release; OpenBSD and macOS builds don't, and the
    // glibc-specific bugs below don't apply to them.
    product = /p\d+$/.test(ossh[1]) ? "OpenSSH" : "OpenSSH (BSD/macOS)";
    version = ossh[1];
  } else if (drop) {
    product = "Dropbear";
    version = drop[1];
  }
  const d = comment.match(/^(Ubuntu|Debian|Raspbian)-(\S+)/);
  return {
    product,
    version,
    distro: d ? (d[1] === "Raspbian" ? "Debian" : d[1]) : /FreeBSD|NetBSD/.test(comment) ? comment.split(/[-\s]/)[0] : undefined,
    revision: d?.[2],
    protocol,
    raw: line,
  };
}

const SERVER_PATTERNS: [string, RegExp][] = [
  ["Apache", /\bApache\/(\d+\.\d+\.\d+)/],
  ["nginx", /\bnginx\/(\d+\.\d+\.\d+)/],
  ["lighttpd", /\blighttpd\/(\d+\.\d+\.\d+)/],
  ["IIS", /\bMicrosoft-IIS\/(\d+\.\d+)/],
  ["OpenSSL", /\bOpenSSL\/(\d+\.\d+\.\d+[a-z]*)/],
  ["PHP", /\bPHP\/(\d+\.\d+\.\d+)/],
  ["Boa", /\bBoa\/([\w.]+)/],
  ["RomPager", /\bRomPager\/(\d+\.\d+)/],
  ["GoAhead", /\bGoAhead-(?:Webs|http)(?:\/([\d.]+))?/],
  ["uc-httpd", /\buc-httpd[ /]?([\d.]+)?/i],
  ["MiniUPnPd", /\bMiniUPnPd\/(\d+\.\d+)/i],
];

const DISTRO_MARK = /\((Ubuntu|Debian|Raspbian|Red Hat|Red Hat Enterprise Linux|CentOS|Fedora|Rocky Linux|AlmaLinux|Amazon|Oracle|SUSE|openSUSE)\)/i;

/** Pulls product versions out of HTTP Server / X-Powered-By headers or an SSDP SERVER line. */
export function parseServerHeader(header: string): Software[] {
  const out: Software[] = [];
  const distro = header.match(DISTRO_MARK)?.[1];
  // "-fips", "-1ubuntu" and similar suffixes mean a vendor build too.
  const vendorBuild = /OpenSSL\/[\d.]+[a-z]*-(fips|\d|ubuntu|deb)/i.test(header) ? "vendor" : undefined;
  for (const [product, re] of SERVER_PATTERNS) {
    const m = header.match(re);
    if (!m) continue;
    let version = m[1];
    // GoAhead-Webs without a version is the 2.x line.
    if (product === "GoAhead" && !version) version = "2.5";
    if (product === "uc-httpd" && !version) version = "1.0.0";
    out.push({ product, version, distro: distro ?? (product === "OpenSSL" ? vendorBuild : undefined) });
  }
  return out;
}

/** "5.5.5-10.11.6-MariaDB-0+deb12u1" or "8.0.36-0ubuntu0.22.04.1". */
export function parseMysqlVersion(v: string): Software {
  const maria = v.match(/(?:5\.5\.5-)?(\d+\.\d+\.\d+)-MariaDB(.*)$/i);
  if (maria) return { product: "MariaDB", version: maria[1], distro: /deb|ubuntu/i.test(maria[2]) ? "Debian" : undefined };
  const m = v.match(/^(\d+\.\d+\.\d+)(.*)$/);
  return { product: "MySQL", version: m?.[1] ?? v, distro: m && /ubuntu|deb|el\d/i.test(m[2]) ? "distro" : undefined };
}
