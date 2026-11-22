// A stand-in for api.osv.dev with a handful of real advisories, so tests run offline.

import * as http from "node:http";
import type { OsvVuln } from "../../src/software/osv.ts";
import { normalizePyName } from "../../src/software/lockfiles.ts";
import { compareEcosystem } from "../../src/software/versions.ts";

const range = (fixed: string) => [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed }] }];

export const VULNS: OsvVuln[] = [
  {
    id: "GHSA-35jh-r3h4-6jhm",
    summary: "Command Injection in lodash",
    aliases: ["CVE-2021-23337"],
    database_specific: { severity: "HIGH" },
    affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: range("4.17.21") }],
  },
  {
    id: "GHSA-29mw-wpgm-hmr9",
    summary: "Regular Expression Denial of Service (ReDoS) in lodash",
    aliases: ["CVE-2020-28500"],
    database_specific: { severity: "MODERATE" },
    affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "4.0.0" }, { fixed: "4.17.21" }] }] }],
  },
  {
    id: "GHSA-xvch-5gv4-984h",
    summary: "Prototype Pollution in minimist",
    aliases: ["CVE-2021-44906"],
    database_specific: { severity: "CRITICAL" },
    affected: [{ package: { name: "minimist", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "0.2.4" }, { introduced: "1.0.0" }, { fixed: "1.2.6" }] }] }],
  },
  {
    id: "GHSA-nofx-0000-0000",
    summary: "Unfixed flaw in left-pad",
    severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N" }],
    affected: [{ package: { name: "left-pad", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { last_affected: "1.3.0" }] }] }],
  },
  {
    id: "PYSEC-2018-28",
    details: "The Requests package before 2.20.0 for Python sends an HTTP Authorization header to an http URI upon receiving a same-hostname https-to-http redirect.",
    aliases: ["CVE-2018-18074", "GHSA-x84v-xcm2-53pg"],
    affected: [{ package: { name: "requests", ecosystem: "PyPI" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "2.20.0" }] }] }],
  },
  {
    id: "GHSA-x84v-xcm2-53pg",
    summary: "Insufficiently Protected Credentials in Requests",
    aliases: ["CVE-2018-18074", "PYSEC-2018-28"],
    database_specific: { severity: "HIGH" },
    severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N" }],
    affected: [{ package: { name: "requests", ecosystem: "PyPI" }, ranges: [{ type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "2.20.0" }] }] }],
  },
  {
    id: "GO-2024-2687",
    summary: "HTTP/2 CONTINUATION flood in net/http",
    aliases: ["CVE-2023-45288"],
    severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H" }],
    affected: [{ package: { name: "golang.org/x/net", ecosystem: "Go" }, ranges: range("0.23.0") }],
  },
];

function affects(v: OsvVuln, ecosystem: string, name: string, version: string): boolean {
  return (v.affected ?? []).some((a) => {
    if (a.package?.ecosystem !== ecosystem) return false;
    if ((ecosystem === "PyPI" ? normalizePyName(a.package.name) : a.package.name) !== (ecosystem === "PyPI" ? normalizePyName(name) : name)) return false;
    return (a.ranges ?? []).some((r) => {
      let start: string | null = null;
      for (const e of r.events) {
        if (e.introduced !== undefined) start = e.introduced;
        const end = e.fixed ?? e.last_affected;
        if (end !== undefined && start !== null) {
          const after = start === "0" || compareEcosystem(ecosystem, version, start) >= 0;
          const before = e.fixed !== undefined ? compareEcosystem(ecosystem, version, end) < 0 : compareEcosystem(ecosystem, version, end) <= 0;
          if (after && before) return true;
          start = null;
        }
      }
      return false;
    });
  });
}

export async function startFakeOsv(): Promise<{ url: string; requests: number; stop(): Promise<void> }> {
  const state = { requests: 0 };
  const server = http.createServer((req, res) => {
    state.requests++;
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && req.url === "/v1/querybatch") {
        const { queries } = JSON.parse(body) as { queries: { package: { name: string; ecosystem: string }; version: string }[] };
        const results = queries.map((q) => {
          const vulns = VULNS.filter((v) => affects(v, q.package.ecosystem, q.package.name, q.version)).map((v) => ({ id: v.id, modified: "2026-01-01T00:00:00Z" }));
          return vulns.length ? { vulns } : {};
        });
        res.end(JSON.stringify({ results }));
        return;
      }
      const m = req.url?.match(/^\/v1\/vulns\/(.+)$/);
      const v = m ? VULNS.find((x) => x.id === decodeURIComponent(m[1])) : undefined;
      if (req.method === "GET" && v) {
        res.end(JSON.stringify(v));
        return;
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ code: 5, message: "Bug not found." }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return state.requests;
    },
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
