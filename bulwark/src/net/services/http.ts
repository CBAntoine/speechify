// Web interfaces: what server software they run, whether passwords travel unencrypted, TLS health,
// and APIs that should never be open (Docker, Elasticsearch, CouchDB). Only GET requests are sent.

import * as tls from "node:tls";
import type { ServiceInfo } from "../../core/types.ts";
import { matchSoftware, parseServerHeader } from "../fingerprints.ts";
import { httpGet, type HttpResponse } from "../tcp.ts";
import { homeApiChecks } from "./home.ts";
import type { NetIssue, ProbeResult } from "../types.ts";

export function pageTitle(body: string): string | undefined {
  const t = body.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1];
  return t ? t.replace(/\s+/g, " ").replace(/&amp;/g, "&").trim() || undefined : undefined;
}

const hasPasswordField = (body: string) => /<input[^>]+type\s*=\s*["']?password/i.test(body);

function softwareIssues(res: HttpResponse): NetIssue[] {
  const header = [res.headers["server"], res.headers["x-powered-by"]].filter(Boolean).join(" ");
  const out: NetIssue[] = [];
  for (const sw of parseServerHeader(header)) {
    for (const v of matchSoftware(sw)) {
      out.push({
        checkId: "http.version",
        subject: `${sw.product}-${v.cves[0] ?? v.title}`,
        title: v.title,
        severity: v.severity,
        confidence: v.confidence,
        summary: `The web server identifies as "${header}".`,
        why: v.why,
        steps: v.steps,
        cves: v.cves,
        evidence: [`Server: ${res.headers["server"] ?? ""}`, ...(res.headers["x-powered-by"] ? [`X-Powered-By: ${res.headers["x-powered-by"]}`] : [])],
      });
    }
  }
  return out;
}

async function getFollowing(ip: string, port: number, useTls: boolean): Promise<{ res: HttpResponse; path: string } | null> {
  let path = "/";
  for (let hop = 0; hop < 3; hop++) {
    const res = await httpGet(ip, port, path, { tls: useTls });
    if (!res) return null;
    const loc = res.headers["location"];
    if (res.status >= 300 && res.status < 400 && loc) {
      let next: URL;
      try {
        next = new URL(loc, `${useTls ? "https" : "http"}://${ip}:${port}${path}`);
      } catch {
        return { res, path };
      }
      // Only follow redirects that stay on the same address, port and scheme.
      const samePort = (Number(next.port) || (next.protocol === "https:" ? 443 : 80)) === port;
      if (next.hostname !== ip || !samePort || next.protocol !== (useTls ? "https:" : "http:")) return { res, path };
      path = next.pathname + next.search;
      continue;
    }
    return { res, path };
  }
  return null;
}

export async function tlsDetails(ip: string, port: number): Promise<ServiceInfo["tls"] | null> {
  const info = await new Promise<ServiceInfo["tls"] | null>((resolve) => {
    const s = tls.connect({ host: ip, port, rejectUnauthorized: false, minVersion: "TLSv1.2" });
    const timer = setTimeout(() => {
      s.destroy();
      resolve(null);
    }, 4000);
    s.once("secureConnect", () => {
      clearTimeout(timer);
      const cert = s.getPeerCertificate();
      const subject = cert?.subject?.CN ?? cert?.subject?.O;
      const validTo = cert?.valid_to;
      resolve({
        protocol: s.getProtocol() ?? undefined,
        subject: typeof subject === "string" ? subject : undefined,
        selfSigned: !!cert && JSON.stringify(cert.subject) === JSON.stringify(cert.issuer),
        expired: validTo ? Date.parse(validTo) < Date.now() : undefined,
        validTo,
      });
      s.destroy();
    });
    s.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
  if (!info) return null;
  info.legacy = await new Promise<boolean>((resolve) => {
    const s = tls.connect({ host: ip, port, rejectUnauthorized: false, minVersion: "TLSv1", maxVersion: "TLSv1.1", ciphers: "DEFAULT:@SECLEVEL=0" });
    const timer = setTimeout(() => {
      s.destroy();
      resolve(false);
    }, 4000);
    s.once("secureConnect", () => {
      clearTimeout(timer);
      s.destroy();
      resolve(true);
    });
    s.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  return info;
}

async function apiChecks(ip: string, port: number, useTls: boolean, root: HttpResponse): Promise<{ name?: string; product?: string; version?: string; deviceName?: string; issues: NetIssue[] }> {
  const home = await homeApiChecks(ip, port, useTls, root);
  if (home) return home;
  const issues: NetIssue[] = [];
  const body = root.body.trim();
  // Elasticsearch / OpenSearch
  if (/"cluster_name"/.test(body) && /"version"/.test(body)) {
    const version = body.match(/"number"\s*:\s*"([^"]+)"/)?.[1];
    issues.push({
      checkId: "elasticsearch.no-auth",
      title: "Elasticsearch is open without a password",
      severity: "critical",
      summary: `Anyone on the network can read, change and delete this search database${version ? ` (version ${version})` : ""}.`,
      why: "Open Elasticsearch servers are found and wiped (or held for ransom) by bots within hours.",
      steps: ["Turn on security (xpack.security.enabled: true) and set passwords, or bind it to localhost (network.host: 127.0.0.1)."],
    });
    return { name: "elasticsearch", product: "Elasticsearch", version, issues };
  }
  // CouchDB
  if (/"couchdb"\s*:\s*"Welcome"/.test(body)) {
    const version = body.match(/"version"\s*:\s*"([^"]+)"/)?.[1];
    const dbs = await httpGet(ip, port, "/_all_dbs", { tls: useTls });
    if (dbs?.status === 200) {
      issues.push({
        checkId: "couchdb.no-auth",
        title: "CouchDB lists its databases without a password",
        severity: "high",
        summary: "Anyone on the network can see, and probably change, this database.",
        why: "CouchDB without an admin password (\"admin party\") gives everyone full control.",
        steps: ["Create an admin user and require authentication (require_valid_user = true)."],
      });
    }
    return { name: "couchdb", product: "CouchDB", version, issues };
  }
  // Docker Engine API
  if (port === 2375 || port === 2376 || /docker/i.test(root.headers["server"] ?? "") || root.headers["api-version"]) {
    const v = await httpGet(ip, port, "/version", { tls: useTls });
    if (v?.status === 200 && /"ApiVersion"/.test(v.body)) {
      const version = v.body.match(/"Version"\s*:\s*"([^"]+)"/)?.[1];
      issues.push({
        checkId: "docker.no-auth",
        title: "The Docker API is open to the network",
        severity: "critical",
        summary: `Anyone who can reach port ${port} controls Docker on this machine${version ? ` (Docker ${version})` : ""}, and through it the whole machine.`,
        why: "The Docker API can start a container with the host's disk mounted, which is root access. Bots scan for it constantly.",
        steps: ["Remove the tcp:// listener from dockerd's settings (/etc/docker/daemon.json \"hosts\" or the service's -H flag) and restart Docker.", "For remote access, use docker -H ssh://user@host instead."],
      });
      return { name: "docker", product: "Docker", version, issues };
    }
  }
  return { issues };
}

export async function probeHttp(ip: string, port: number, opts: { tls?: boolean } = {}): Promise<ProbeResult | null> {
  let useTls = opts.tls ?? false;
  let got = await getFollowing(ip, port, useTls);
  if (!got && !useTls) {
    // Many devices only speak HTTPS on non-standard ports.
    useTls = true;
    got = await getFollowing(ip, port, true);
  }
  if (!got) return null;
  const { res, path } = got;
  const issues: NetIssue[] = [];
  const service: ServiceInfo = {
    port,
    proto: "tcp",
    name: useTls ? "https" : "http",
    title: pageTitle(res.body),
    banner: res.headers["server"],
    notes: [],
  };
  const sw = parseServerHeader([res.headers["server"], res.headers["x-powered-by"]].filter(Boolean).join(" "));
  if (sw[0]) {
    service.product = sw[0].product;
    service.version = sw[0].version;
  }
  issues.push(...softwareIssues(res));

  const api = await apiChecks(ip, port, useTls, res);
  issues.push(...api.issues);
  if (api.name) {
    service.name = api.name;
    service.product = api.product;
    service.version = api.version;
    service.deviceName = api.deviceName;
  }

  if (!useTls) {
    const auth = res.headers["www-authenticate"] ?? "";
    const redirectsToHttps = res.status >= 300 && res.status < 400 && /^https:/i.test(res.headers["location"] ?? "");
    if (!redirectsToHttps && (hasPasswordField(res.body) || (res.status === 401 && /basic|digest/i.test(auth)))) {
      const basic = /basic/i.test(auth);
      issues.push({
        checkId: "http.plaintext-login",
        title: "Login page without encryption",
        severity: "medium",
        summary: `${service.title ? `"${service.title}" asks` : "This page asks"} for a password over plain HTTP${basic ? " (HTTP Basic, sent with every request)" : ""}, so the password crosses the network readable.`,
        why: "Anyone else on the same Wi-Fi, or a compromised device on the network, can capture the password as you type it.",
        steps: [
          "Look for an HTTPS or \"secure management\" option in the device's settings and turn it on, then use https:// to open it.",
          "If it has no HTTPS option, use a long unique password for it and don't log in to it from shared networks.",
        ],
        evidence: [`GET ${path} → ${res.status}${auth ? ` (WWW-Authenticate: ${auth})` : ""}`],
      });
    }
  }
  if (/^Index of \//i.test(service.title ?? "")) {
    issues.push({
      checkId: "http.directory-listing",
      title: "Files are listed openly",
      severity: "low",
      summary: `${useTls ? "https" : "http"}://${ip}:${port}/ shows a list of files to anyone.`,
      why: "Open folder listings often expose backups, configuration and private files nobody meant to share.",
      steps: ["Turn off directory listing in the web server, or put a password on the folder."],
    });
  }
  if (useTls) {
    const t = await tlsDetails(ip, port);
    if (t) {
      service.tls = t;
      if (t.legacy) {
        issues.push({
          checkId: "tls.legacy",
          title: "Accepts outdated TLS 1.0/1.1",
          severity: "medium",
          summary: "The server still agrees to TLS 1.0 or 1.1, which browsers dropped in 2020.",
          why: "Old TLS versions have known weaknesses (BEAST, POODLE-style downgrades) and usually come with old, unpatched software.",
          steps: ["Turn off TLS 1.0 and 1.1 in the server's or device's settings, or update its firmware."],
        });
      }
      if (t.expired) {
        issues.push({
          checkId: "tls.expired",
          title: "The security certificate has expired",
          severity: "low",
          summary: `The certificate${t.subject ? ` for ${t.subject}` : ""} expired on ${t.validTo}.`,
          why: "Expired certificates train people to click through browser warnings, which is exactly what an attacker impersonating the device needs.",
          steps: ["Renew or regenerate the certificate (many devices have a \"regenerate certificate\" button)."],
        });
      }
    }
  }
  return { service, issues };
}
