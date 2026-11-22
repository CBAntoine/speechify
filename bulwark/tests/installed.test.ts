import assert from "node:assert/strict";
import { test } from "node:test";
import { outcomeToFinding } from "../src/core/audit.ts";
import { planFix } from "../src/core/fixer.ts";
import type { Check, Finding } from "../src/core/types.ts";
import {
  classifyApp,
  knownVulnerableCheck,
  osSupportCheck,
  outdatedAppsCheck,
  parseBrewOutdated,
  parseFlatpakUpdates,
  parseSnapRefresh,
  parseWingetUpgrade,
  runtimesCheck,
  supportStatus,
} from "../src/software/installed.ts";
import { FakeHost } from "./helpers/fake-host.ts";

const run = async (check: Check, host: FakeHost): Promise<Finding[]> => (await check.run(host)).map((o) => outcomeToFinding(check, o));

/** Answers PowerShell calls by looking at the script inside -EncodedCommand. */
function powershell(host: FakeHost, answer: (script: string) => unknown): FakeHost {
  return host.command("powershell.exe", (args) => {
    const enc = args[args.indexOf("-EncodedCommand") + 1];
    const script = Buffer.from(enc, "base64").toString("utf16le");
    const r = answer(script);
    return r === undefined ? { code: 1 } : { stdout: JSON.stringify(r) };
  });
}

test("support windows: ended, ending soon, fine", () => {
  const now = new Date("2026-11-22T00:00:00Z");
  assert.equal(supportStatus("2026-08-31", now), "ended");
  assert.equal(supportStatus("2027-04-30", now), "ending");
  assert.equal(supportStatus("2029-05-31", now), "ok");
});

test("Linux release support", async () => {
  const focal = await run(osSupportCheck, new FakeHost().file("/etc/os-release", 'ID=ubuntu\nVERSION_ID="20.04"\nPRETTY_NAME="Ubuntu 20.04.6 LTS"\n'));
  assert.equal(focal[0].status, "fail");
  assert.match(focal[0].summary, /Ubuntu 20\.04 LTS's security support ended in May 2025\. Ubuntu Pro/);
  assert.equal(focal[0].confidence, "likely", "paid extended support may apply");
  const noble = await run(osSupportCheck, new FakeHost().file("/etc/os-release", 'ID=ubuntu\nVERSION_ID="24.04"\n'));
  assert.equal(noble[0].status, "pass");
  const pi = await run(osSupportCheck, new FakeHost().file("/etc/os-release", 'ID=debian\nVERSION_ID="11"\nVERSION_CODENAME=bullseye\n').file("/etc/rpi-issue", "Raspberry Pi reference\n"));
  assert.match(pi[0].summary, /Raspberry Pi OS \(Debian 11\)'s security support ended in August 2026/);
  const unknown = await run(osSupportCheck, new FakeHost().file("/etc/os-release", "ID=gentoo\n"));
  assert.equal(unknown[0].status, "skipped");
});

test("Windows and macOS support", async () => {
  const win10 = powershell(new FakeHost({ platform: "win32" }), (s) => (s.includes("Win32_OperatingSystem") ? { Caption: "Microsoft Windows 10 Pro", BuildNumber: "19045" } : undefined));
  const w10 = await run(osSupportCheck, win10);
  assert.match(w10[0].summary, /Windows 10 Pro's security support ended in October 2025/);
  const win11 = powershell(new FakeHost({ platform: "win32" }), () => ({ Caption: "Microsoft Windows 11 Home", BuildNumber: "26100" }));
  assert.match((await run(osSupportCheck, win11))[0].summary, /Windows 11 Home 24H2's security support ended in October 2026/);
  const ltsc = powershell(new FakeHost({ platform: "win32" }), () => ({ Caption: "Microsoft Windows 10 Enterprise LTSC", BuildNumber: "19044" }));
  assert.equal((await run(osSupportCheck, ltsc))[0].status, "skipped", "LTSC has its own, longer support");
  const mac = new FakeHost({ platform: "darwin" }).command("sw_vers", { stdout: "13.6.9\n" });
  const m = await run(osSupportCheck, mac);
  assert.equal(m[0].status, "fail");
  assert.equal(m[0].confidence, "likely");
});

test("runtimes past their end of support", async () => {
  const host = new FakeHost()
    .command("node", { stdout: "v18.20.4\n" })
    .command("python3", { stdout: "Python 3.12.3\n" })
    .command("go", { stdout: "go version go1.22.5 linux/amd64\n" })
    .command("php", { stdout: "PHP 8.1.2-1ubuntu2.20 (cli) (built: Jun 2024)\n" });
  const out = await run(runtimesCheck, host);
  const by = Object.fromEntries(out.map((f) => [f.id, f]));
  assert.equal(by["software.runtime:node"].status, "fail");
  assert.match(by["software.runtime:node"].summary, /Node\.js 18\.20\.4 .* stopped getting security fixes in April 2025/);
  assert.equal(by["software.runtime:python"].status, "pass");
  assert.equal(by["software.runtime:go"].status, "fail");
  assert.equal(by["software.runtime:php"].confidence, "possible", "Ubuntu's own PHP build keeps getting patches");
  assert.equal(by["software.runtime:ruby"], undefined, "not installed, not reported");
});

test("package manager output parsing", () => {
  const brew = parseBrewOutdated(JSON.stringify({ formulae: [{ name: "openssl@3", installed_versions: ["3.3.1"], current_version: "3.3.2", pinned: false }, { name: "pinned-thing", installed_versions: ["1"], current_version: "2", pinned: true }], casks: [{ name: "google-chrome", installed_versions: ["129.0"], current_version: "131.0" }] }));
  assert.deepEqual(brew.map((a) => [a.id, a.cask ?? false]), [["openssl@3", false], ["google-chrome", true]]);
  const winget = parseWingetUpgrade(
    "\r-\r\\\rName                     Id                    Version        Available      Source\n" +
      "------------------------------------------------------------------------------------\n" +
      "Google Chrome            Google.Chrome         129.0.6668.90  131.0.6778.86  winget\n" +
      "7-Zip 23.01 (x64)        7zip.7zip             23.01          24.08          winget\n" +
      "2 upgrades available.\n",
  );
  assert.deepEqual(winget.map((a) => [a.id, a.current, a.available]), [["Google.Chrome", "129.0.6668.90", "131.0.6778.86"], ["7zip.7zip", "23.01", "24.08"]]);
  const german = parseWingetUpgrade("Name    ID           Version  Verfügbar  Quelle\n----------------------------------------------\nVLC     VideoLAN.VLC 3.0.18   3.0.21     winget\n");
  assert.equal(german[0].id, "VideoLAN.VLC", "works whatever language the headers are in");
  assert.deepEqual(parseSnapRefresh("Name     Version  Rev   Size   Publisher  Notes\nfirefox  132.0    5000  80MB   mozilla✓   -\n").map((a) => a.id), ["firefox"]);
  assert.deepEqual(parseSnapRefresh("All snaps up to date.\n"), []);
  assert.deepEqual(parseFlatpakUpdates("org.mozilla.firefox\tFirefox\t132.0\n").map((a) => a.name), ["Firefox"]);
  assert.equal(classifyApp({ manager: "brew", id: "google-chrome", name: "google-chrome", current: "1", available: "2" }), "high");
  assert.equal(classifyApp({ manager: "brew", id: "openssl@3", name: "openssl@3", current: "1", available: "2" }), "medium");
  assert.equal(classifyApp({ manager: "brew", id: "jq", name: "jq", current: "1", available: "2" }), "low");
});

test("outdated apps: risky ones one by one, the rest grouped, Homebrew never as root", async () => {
  const host = new FakeHost()
    .file("/etc/passwd", "root:x:0:0::/root:/bin/bash\nmia:x:501:20::/home/mia:/bin/zsh\n")
    .dir("/home/linuxbrew/.linuxbrew", 0o755, [501, 20])
    .file("/home/linuxbrew/.linuxbrew/bin/brew", "", 0o755, [501, 20])
    .command("brew", (args) =>
      args[0] === "outdated"
        ? { stdout: JSON.stringify({ formulae: [{ name: "jq", installed_versions: ["1.6"], current_version: "1.7.1" }, { name: "wget", installed_versions: ["1.21"], current_version: "1.25" }, { name: "curl", installed_versions: ["8.0.0"], current_version: "8.11.0" }], casks: [{ name: "firefox", installed_versions: ["131.0"], current_version: "133.0" }] }) }
        : { code: 0 },
    );
  const out = await run(outdatedAppsCheck, host);
  const ids = out.map((f) => f.id).sort();
  assert.deepEqual(ids, ["software.outdated:brew:curl", "software.outdated:brew:firefox", "software.outdated:brew:others", "software.outdated:brew:wget"].sort());
  assert.equal(out.find((f) => f.id.endsWith(":firefox"))?.severity, "high");
  assert.equal(out.find((f) => f.id.endsWith(":others"))?.title, "1 more update waiting (Homebrew)");
  const outdatedRun = host.execs.find((e) => e.args[0] === "outdated")!;
  assert.deepEqual(outdatedRun.opts?.runAs, { uid: 501, gid: 20, user: "mia", home: "/home/mia" });
  const plan = await planFix(host, [out.find((f) => f.id.endsWith(":firefox"))!]);
  assert.ok(plan.canApply, plan.blockedReason);
  assert.equal(plan.reversible, false);
  assert.match(plan.steps[0].detail!, /brew upgrade --cask firefox {3}\(as mia\)/);
});

test("known-exploited versions of 7-Zip, WinRAR, PuTTY and xz", async () => {
  const win = powershell(new FakeHost({ platform: "win32" }), (s) =>
    s.includes("Uninstall")
      ? [
          { DisplayName: "7-Zip 24.08 (x64)", DisplayVersion: "24.08" },
          { DisplayName: "WinRAR 7.13 (64-bit)", DisplayVersion: "7.13.0" },
          { DisplayName: "PuTTY release 0.80 (64-bit)", DisplayVersion: "0.80.0.0" },
          { DisplayName: "Notepad++", DisplayVersion: "8.6" },
        ]
      : undefined,
  ).command("winget");
  const found = await run(knownVulnerableCheck, win);
  assert.deepEqual(found.map((f) => f.title).sort(), ["7-Zip 24.08 has known, exploited flaws", "PuTTY 0.80 has known, exploited flaws"]);
  assert.ok(found.find((f) => f.title.startsWith("7-Zip"))?.cves.includes("CVE-2025-0411"));
  assert.deepEqual(found.find((f) => f.title.startsWith("PuTTY"))?.remedy?.auto, { fixId: "software.update.winget", params: { apps: [{ id: "PuTTY.PuTTY", cask: false, name: "PuTTY" }] } });
  const xz = await run(knownVulnerableCheck, new FakeHost().command("xz", { stdout: "xz (XZ Utils) 5.6.1\nliblzma 5.6.1\n" }));
  assert.equal(xz[0].severity, "critical");
  assert.deepEqual(xz[0].cves, ["CVE-2024-3094"]);
  const fine = await run(knownVulnerableCheck, new FakeHost().command("xz", { stdout: "xz (XZ Utils) 5.4.5\n" }));
  assert.equal(fine[0].status, "pass");
});
