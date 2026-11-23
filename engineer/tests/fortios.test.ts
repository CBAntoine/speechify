import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { findSections, parseConfig, summarize } from "../src/review/fortios.ts";

const sample = fs.readFileSync(new URL("../samples/branch-office.conf", import.meta.url), "utf8");

test("reads the header of the sample backup", () => {
  const c = parseConfig(sample);
  assert.equal(c.header.model, "FGT60F");
  assert.equal(c.header.version, "7.2.8");
  assert.equal(c.header.build, "1639");
  assert.equal(c.header.release_date, "2024-03-13");
  assert.equal(c.header.user, "netops-jlee");
  assert.equal(c.vdom_mode, false);
  assert.deepEqual(c.vdoms, ["root"]);
  assert.deepEqual(c.warnings, []);
  assert.equal(c.line_count, sample.split("\n").length - 1);
});

test("keeps policies in file order with their line numbers", () => {
  const c = parseConfig(sample);
  const [policies] = findSections(c, "firewall policy");
  assert.equal(policies.vdom, "root");
  const edits = policies.block.children.filter((b) => b.kind === "edit");
  assert.deepEqual(edits.map((e) => e.name), ["1", "7", "3", "12", "5", "9", "10", "11", "13", "14"]);
  const p12 = edits.find((e) => e.name === "12")!;
  assert.equal(p12.line, 311);
  assert.deepEqual(p12.settings.service, { values: ["ALL"], line: 320 });
  assert.match(p12.settings.comments.values[0], /pre-approved/);
  // No `set action` means the FortiOS default, deny.
  const p10 = edits.find((e) => e.name === "10")!;
  assert.equal(p10.settings.action, undefined);
  assert.deepEqual(p10.settings.srcaddr.values, ["PRINTERS"]);
});

test("reads multi-value settings and nested config blocks", () => {
  const c = parseConfig(sample);
  const [groups] = findSections(c, "user group");
  assert.deepEqual(groups.block.children[0].settings.member.values, ["vpnuser1", "vpnuser2"]);
  const [snmp] = findSections(c, "system snmp community");
  const hosts = snmp.block.children[0].children.find((b) => b.kind === "config" && b.name === "hosts")!;
  assert.deepEqual(hosts.children[0].settings.ip.values, ["10.20.0.50", "255.255.255.255"]);
  const [routes] = findSections(c, "router static");
  assert.equal(routes.block.children[0].settings.dst, undefined, "a route with no dst is the default route");
});

test("a quoted value that spans lines can contain config keywords", () => {
  const c = parseConfig(sample);
  const [scripts] = findSections(c, "system auto-script");
  assert.equal(scripts.block.children[0].settings.script.values[0], "config system global\nshow\nend");
  assert.equal(scripts.block.end_line, 93);
  // The sections after the script are still top-level blocks.
  assert.ok(findSections(c, "user local").length === 1);
});

test("handles escaped quotes", () => {
  const c = parseConfig('config firewall address\n    edit "x"\n        set comment "say \\"hi\\" \\\\ bye"\n    next\nend\n');
  const [addr] = findSections(c, "firewall address");
  assert.equal(addr.block.children[0].settings.comment.values[0], 'say "hi" \\ bye');
});

test("splits a multi-VDOM backup by VDOM", () => {
  const text = [
    "#config-version=FGVM64-7.4.3-FW-build2573-240201:opmode=0:vdom=1:user=admin",
    "config vdom",
    "edit root",
    "next",
    "edit dmz",
    "next",
    "end",
    "config global",
    "config system global",
    '    set hostname "HQ-FW01"',
    "end",
    "end",
    "config vdom",
    "edit root",
    "config firewall policy",
    "    edit 1",
    '        set srcintf "port1"',
    "    next",
    "end",
    "next",
    "edit dmz",
    "config firewall policy",
    "    edit 2",
    "    next",
    "    edit 3",
    "    next",
    "end",
    "next",
    "end",
    "",
  ].join("\n");
  const c = parseConfig(text);
  assert.equal(c.vdom_mode, true);
  assert.deepEqual(c.vdoms, ["root", "dmz"]);
  assert.deepEqual(c.warnings, []);
  const s = summarize(c);
  assert.equal(s.hostname, "HQ-FW01");
  assert.deepEqual(s.policies, { root: 1, dmz: 2 });
  assert.equal(findSections(c, "system global")[0].vdom, null);
  assert.equal(findSections(c, "firewall policy", "dmz")[0].block.line, 22);
});

test("warns about unbalanced blocks instead of failing", () => {
  const c = parseConfig("config firewall policy\n    edit 1\n        set name \"x\"\nend\nnext\n");
  assert.equal(c.warnings.length, 2);
  assert.match(c.warnings[0], /not closed/);
  assert.match(c.warnings[1], /without a matching "edit"/);
});
