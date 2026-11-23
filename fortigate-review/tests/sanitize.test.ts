import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { REDACTED, sanitize } from "../src/sanitize.ts";
import { findSections, parseConfig } from "../src/fortios.ts";

const sample = fs.readFileSync(new URL("../samples/branch-office.conf", import.meta.url), "utf8");
const lines = (s: string) => s.split("\n").length;

test("redacts every secret in the sample and keeps line numbers", () => {
  const { text, redactions } = sanitize(sample);
  assert.equal(lines(text), lines(sample));
  assert.doesNotMatch(text, /SAMPLEONLY/);
  assert.doesNotMatch(text, /brtor-sample-community/);
  assert.equal(redactions.length, 6);
  assert.deepEqual(
    redactions.map((r) => `${r.line} ${r.setting}`),
    ["54 password", "60 password", "70 name", "97 passwd", "101 passwd", "227 psksecret"],
  );
  // Everything else is untouched, line for line.
  const before = sample.split("\n");
  const after = text.split("\n");
  const changed = before.map((l, i) => (l === after[i] ? null : i + 1)).filter((n) => n !== null);
  assert.deepEqual(changed, [54, 60, 70, 97, 101, 227]);
  assert.equal(after[53], `        set password ENC ${REDACTED}`);
});

test("the redacted backup parses the same way", () => {
  const original = parseConfig(sample);
  const redacted = parseConfig(sanitize(sample).text);
  assert.deepEqual(redacted.warnings, []);
  const names = (c: typeof original) => findSections(c, "firewall policy")[0].block.children.map((b) => `${b.name}@${b.line}`);
  assert.deepEqual(names(redacted), names(original));
});

test("redacts a multi-line private key without moving later lines", () => {
  const begin = "-----BEGIN " + "ENCRYPTED PRIVATE KEY-----";
  const endMarker = "-----END " + "ENCRYPTED PRIVATE KEY-----";
  const text = [
    "config vpn certificate local",
    '    edit "branch-cert"',
    `        set private-key "${begin}`,
    "MIIFHzBJBgkqhkiG9w0BBQ0wPDAbBgkqhkiG9w0BBQwwDgQI",
    "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=",
    `${endMarker}"`,
    '        set certificate "-----BEGIN CERTIFICATE-----',
    "MIIDdzCCAl+gAwIBAgIEAgAAuTANBgkqhkiG9w0BAQUFADBa",
    '-----END CERTIFICATE-----"',
    "    next",
    "end",
    "",
  ].join("\n");
  const { text: out, redactions } = sanitize(text);
  assert.equal(lines(out), lines(text));
  assert.doesNotMatch(out, /PRIVATE KEY|MIIFHz/);
  assert.match(out, /BEGIN CERTIFICATE/, "public certificates are kept");
  assert.equal(redactions.length, 1);
  assert.equal(redactions[0].reason, "secret setting");
  const outLines = out.split("\n");
  assert.equal(outLines[2], `        set private-key "${REDACTED}`);
  assert.equal(outLines[5], `${REDACTED}"`);
  assert.equal(outLines[9], "    next");
  assert.deepEqual(parseConfig(out).warnings, []);
});

test("knows which settings are secrets", () => {
  const text = [
    "config vpn ipsec phase1-interface",
    '    edit "t1"',
    '        set psksecret "plain-text-psk"',
    "        set passive-mode enable",
    "    next",
    "end",
    "config router ospf",
    "    config ospf-interface",
    '        edit "o1"',
    "            set md5-keys",
    "            set key-string ENC c2FtcGxl",
    "        next",
    "    end",
    "end",
    "",
  ].join("\n");
  const { text: out, redactions } = sanitize(text);
  assert.match(out, /set psksecret "<redacted>"/);
  assert.match(out, /set passive-mode enable/);
  assert.match(out, /set key-string ENC <redacted>/);
  assert.equal(redactions.length, 2);
});

test("keeps Windows line endings and line count", () => {
  const text = 'config system admin\r\n    edit "a"\r\n        set password ENC abc\r\n    next\r\nend\r\n';
  const { text: out } = sanitize(text);
  assert.equal(out, 'config system admin\r\n    edit "a"\r\n        set password ENC <redacted>\r\n    next\r\nend\r\n');
});
