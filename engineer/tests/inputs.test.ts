import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseHits } from "../src/review/hits.ts";
import { fortinetKev } from "../src/review/kev.ts";
import { loadIds } from "../src/review/ids.ts";
import { CHECK_IDS, RUBRIC } from "../src/review/rubric.ts";

const opts = { source: "test", periodDays: 90, exportedAt: "2026-11-22T14:05:00.000Z" };

test("reads hit counts from the FortiOS monitor API response", () => {
  const text = fs.readFileSync(new URL("../samples/branch-office-hits.json", import.meta.url), "utf8");
  const hits = parseHits(text, opts);
  assert.equal(hits.policies.length, 10);
  assert.equal(hits.period_days, 90);
  const p13 = hits.policies.find((p) => p.policyid === 13)!;
  assert.deepEqual(p13, {
    vdom: "root",
    policyid: 13,
    hit_count: 466,
    last_used: "2026-08-10T16:20:00.000Z",
    first_used: "2025-09-01T07:45:00.000Z",
  });
  const p12 = hits.policies.find((p) => p.policyid === 12)!;
  assert.equal(p12.hit_count, 0);
  assert.equal(p12.last_used, null);
});

test("reads one response per VDOM", () => {
  const text = JSON.stringify([
    { vdom: "root", results: [{ policyid: 1, hit_count: 5, last_used: 1795355940 }] },
    { vdom: "dmz", results: [{ policyid: 1, hit_count: 0 }] },
  ]);
  const hits = parseHits(text, opts);
  assert.deepEqual(
    hits.policies.map((p) => `${p.vdom}/${p.policyid}/${p.hit_count}`),
    ["root/1/5", "dmz/1/0"],
  );
});

test("reads a CSV export", () => {
  const csv = 'Policy ID,Hit Count,Last Used,VDOM\n1,"1,204",2026-11-20T10:00:00Z,root\n2,0,,root\n';
  const hits = parseHits(csv, opts);
  assert.deepEqual(hits.policies[0], {
    vdom: "root",
    policyid: 1,
    hit_count: 1204,
    last_used: "2026-11-20T10:00:00.000Z",
    first_used: null,
  });
  assert.equal(hits.policies[1].last_used, null);
});

test("rejects a file without policy records", () => {
  assert.throws(() => parseHits('{"status":"success"}', opts), /monitor API response/);
  assert.throws(() => parseHits("just one line", opts), /header row/);
});

test("keeps only Fortinet entries from the KEV catalog, newest first", () => {
  const catalog = {
    catalogVersion: "2026.11.20",
    dateReleased: "2026-11-20T17:00:00.000Z",
    vulnerabilities: [
      { cveID: "CVE-2000-0001", vendorProject: "Fortinet", product: "FortiOS", dateAdded: "2024-01-09", notes: "https://fortiguard.example/1" },
      { cveID: "CVE-2000-0002", vendorProject: "Other", product: "Thing", dateAdded: "2025-05-01" },
      { cveID: "CVE-2000-0003", vendorProject: "Fortinet", product: "FortiManager", dateAdded: "2025-10-23" },
    ],
  };
  const kev = fortinetKev(catalog, "test");
  assert.equal(kev.count, 2);
  assert.equal(kev.catalog_version, "2026.11.20");
  assert.deepEqual(kev.vulnerabilities.map((v) => v.cveID), ["CVE-2000-0003", "CVE-2000-0001"]);
  assert.equal(kev.vulnerabilities[1].notes, "https://fortiguard.example/1");
});

test("finds the agent and environment IDs in claude-lock.json", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fgt-ids-"));
  assert.ok("error" in loadIds(dir, {}));
  fs.writeFileSync(
    path.join(dir, "claude-lock.json"),
    JSON.stringify({
      resources: {
        "./agents/fortigate-rulebase-review.md": { id: "agent_01TEST" },
        "./environments/fortigate-review.yaml": { id: "env_01TEST" },
      },
    }),
  );
  assert.deepEqual(loadIds(dir, {}), { agentId: "agent_01TEST", environmentId: "env_01TEST", source: path.join(dir, "claude-lock.json") });
  const fromEnv = loadIds(dir, { FGT_REVIEW_AGENT_ID: "agent_02ENV", FGT_REVIEW_ENVIRONMENT_ID: "env_02ENV" });
  assert.deepEqual(fromEnv, { agentId: "agent_02ENV", environmentId: "env_02ENV", source: "environment variables" });
});

test("the agent's instructions and the rubric list the same checks", () => {
  const agent = fs.readFileSync(new URL("../agents/fortigate-rulebase-review.md", import.meta.url), "utf8");
  const inPrompt = [...agent.matchAll(/^\| ([A-Z]{2,3}-\d{2}) \|/gm)].map((m) => m[1]);
  assert.deepEqual([...inPrompt].sort(), [...CHECK_IDS].sort());
  for (const id of CHECK_IDS) assert.ok(RUBRIC.includes(id), `rubric names ${id}`);
});

test("the agent runs Claude Opus 5.5 with the web tools off", () => {
  const agent = fs.readFileSync(new URL("../agents/fortigate-rulebase-review.md", import.meta.url), "utf8");
  const front = agent.split("---")[1];
  assert.match(front, /id: claude-opus-5-5/);
  assert.match(front, /\{name: web_fetch, enabled: false\}/);
  assert.match(front, /\{name: web_search, enabled: false\}/);
});
