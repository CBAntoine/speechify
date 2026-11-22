import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, test } from "node:test";
import { proxyFor } from "../src/core/https.ts";
import { applyFix, planFix, refreshFindings, rollbackChange } from "../src/core/fixer.ts";
import { StateStore } from "../src/core/state.ts";
import { cvss3Score, cvss4Severity } from "../src/software/cvss.ts";
import { findProjects, recheckDependencies, scanCode, setRequirementPins } from "../src/software/deps.ts";
import {
  lockfileKind,
  parseCargoLock,
  parseComposerLock,
  parseGemfileLock,
  parseGoMod,
  parseGradleLock,
  parseNugetLock,
  parsePackageLock,
  parsePipfileLock,
  parsePnpmLock,
  parsePoetryLock,
  parseRequirements,
  parseUvLock,
  parseYarnLock,
} from "../src/software/lockfiles.ts";
import { fixedVersion, groupVulns, OsvClient } from "../src/software/osv.ts";
import { compareGem, comparePep440, compareSemver } from "../src/software/versions.ts";
import { FakeHost } from "./helpers/fake-host.ts";
import { startFakeOsv, VULNS } from "./helpers/fake-osv.ts";

const names = (r: { deps: { name: string; version: string }[] }) => r.deps.map((d) => `${d.name}@${d.version}`).sort();

// ── lockfiles ──

test("package-lock.json v3 and v1", () => {
  const v3 = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "app", dependencies: { lodash: "^4.17.20", "@scope/ui": "^1.0.0" }, devDependencies: { jest: "^29" } },
      "node_modules/lodash": { version: "4.17.20" },
      "node_modules/@scope/ui": { version: "1.2.0" },
      "node_modules/@scope/ui/node_modules/minimist": { version: "1.2.5" },
      "node_modules/jest": { version: "29.7.0", dev: true },
      "node_modules/my-alias": { name: "real-pkg", version: "2.0.0" },
      "node_modules/local": { link: true, resolved: "packages/local" },
      "packages/local": { version: "0.0.1" },
      "node_modules/gitdep": { version: "git+ssh://git@github.com/x/y.git#abc" },
    },
  });
  const r = parsePackageLock(v3);
  assert.deepEqual(names(r), ["@scope/ui@1.2.0", "jest@29.7.0", "lodash@4.17.20", "minimist@1.2.5", "real-pkg@2.0.0"]);
  assert.equal(r.deps.find((d) => d.name === "jest")?.dev, true);
  assert.equal(r.deps.find((d) => d.name === "lodash")?.direct, true);
  assert.equal(r.deps.find((d) => d.name === "minimist")?.direct, false);
  const v1 = JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: "1.0.0", dependencies: { b: { version: "2.0.0", dev: true } } } } });
  assert.deepEqual(names(parsePackageLock(v1)), ["a@1.0.0", "b@2.0.0"]);
});

test("yarn.lock (classic and berry) and pnpm-lock.yaml (v6 and v9)", () => {
  const classic = `# yarn lockfile v1\n\n"@babel/code-frame@^7.0.0", "@babel/code-frame@^7.10.4":\n  version "7.12.13"\n  resolved "https://registry.yarnpkg.com/x"\n\nlodash@^4.17.20:\n  version "4.17.20"\n`;
  assert.deepEqual(names(parseYarnLock(classic)), ["@babel/code-frame@7.12.13", "lodash@4.17.20"]);
  const berry = `__metadata:\n  version: 8\n\n"lodash@npm:^4.17.20":\n  version: 4.17.20\n  resolution: "lodash@npm:4.17.20"\n\n"app@workspace:.":\n  version: 0.0.0-use.local\n\n"resolve@patch:resolve@npm%3A1.22.8#~builtin<compat/resolve>":\n  version: 1.22.8\n`;
  assert.deepEqual(names(parseYarnLock(berry)), ["lodash@4.17.20"]);
  const v6 = `lockfileVersion: '6.0'\n\npackages:\n\n  /lodash@4.17.20:\n    resolution: {integrity: sha512-x}\n    dev: false\n\n  /@babel/core@7.24.0:\n    resolution: {integrity: sha512-y}\n    dev: true\n\n  /react-dom@18.2.0(react@18.2.0):\n    resolution: {integrity: sha512-z}\n`;
  const p6 = parsePnpmLock(v6);
  assert.deepEqual(names(p6), ["@babel/core@7.24.0", "lodash@4.17.20", "react-dom@18.2.0"]);
  assert.equal(p6.deps.find((d) => d.name === "@babel/core")?.dev, true);
  const v9 = `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      lodash:\n        specifier: ^4.17.20\n        version: 4.17.20\n\npackages:\n\n  '@scope/pkg@1.0.0':\n    resolution: {integrity: sha512-a}\n\n  lodash@4.17.20:\n    resolution: {integrity: sha512-b}\n\nsnapshots:\n\n  lodash@4.17.20: {}\n`;
  assert.deepEqual(names(parsePnpmLock(v9)), ["@scope/pkg@1.0.0", "lodash@4.17.20"]);
});

test("Python: requirements, poetry, uv and Pipfile", () => {
  const req = parseRequirements("# comment\nrequests==2.19.0\nDjango[bcrypt] == 3.2.0  # pinned\nflask>=2.0\n-r other.txt\n--hash=sha256:abc\ngit+https://github.com/x/y\n./local\nurllib3===1.24.1\n");
  assert.deepEqual(names(req), ["django@3.2.0", "requests@2.19.0", "urllib3@1.24.1"]);
  assert.equal(req.deps.find((d) => d.name === "django")?.line, 3);
  assert.match(req.notes[0], /1 requirement isn't pinned/);
  const toml = `[[package]]\nname = "Requests"\nversion = "2.19.0"\ncategory = "dev"\n\n[package.dependencies]\nurllib3 = ">=1.21"\n\n[[package]]\nname = "urllib3"\nversion = "1.24.1"\n`;
  assert.deepEqual(names(parsePoetryLock(toml)), ["requests@2.19.0", "urllib3@1.24.1"]);
  const uv = `version = 1\n\n[[package]]\nname = "myapp"\nversion = "0.1.0"\nsource = { editable = "." }\n\n[[package]]\nname = "flask"\nversion = "2.0.0"\nsource = { registry = "https://pypi.org/simple" }\n`;
  assert.deepEqual(names(parseUvLock(uv)), ["flask@2.0.0"]);
  const pipfile = JSON.stringify({ default: { requests: { version: "==2.19.0" } }, develop: { pytest: { version: "==7.0.0" } } });
  const pf = parsePipfileLock(pipfile);
  assert.deepEqual(names(pf), ["pytest@7.0.0", "requests@2.19.0"]);
  assert.equal(pf.deps.find((d) => d.name === "pytest")?.dev, true);
});

test("Cargo, Go, Ruby, PHP, .NET and Gradle", () => {
  const cargo = `[[package]]\nname = "myapp"\nversion = "0.1.0"\n\n[[package]]\nname = "serde_yaml"\nversion = "0.8.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`;
  assert.deepEqual(names(parseCargoLock(cargo)), ["serde_yaml@0.8.0"]);
  const gomod = `module example.com/app\n\ngo 1.22\n\nrequire github.com/gin-gonic/gin v1.9.0\n\nrequire (\n\tgolang.org/x/net v0.17.0 // indirect\n\tgithub.com/x/y v2.0.0+incompatible\n)\n`;
  const g = parseGoMod(gomod);
  assert.deepEqual(names(g), ["github.com/gin-gonic/gin@1.9.0", "github.com/x/y@2.0.0+incompatible", "golang.org/x/net@0.17.0"]);
  assert.equal(g.deps.find((d) => d.name === "golang.org/x/net")?.direct, false);
  const gem = `GEM\n  remote: https://rubygems.org/\n  specs:\n    nokogiri (1.15.4-x86_64-linux)\n      racc (~> 1.4)\n    rack (2.2.3)\n\nPATH\n  remote: .\n  specs:\n    mygem (0.1.0)\n\nPLATFORMS\n  x86_64-linux\n`;
  assert.deepEqual(names(parseGemfileLock(gem)), ["nokogiri@1.15.4", "rack@2.2.3"]);
  const composer = JSON.stringify({ packages: [{ name: "guzzlehttp/guzzle", version: "7.4.0" }, { name: "x/dev", version: "dev-main" }], "packages-dev": [{ name: "phpunit/phpunit", version: "v9.5.0" }] });
  assert.deepEqual(names(parseComposerLock(composer)), ["guzzlehttp/guzzle@7.4.0", "phpunit/phpunit@9.5.0"]);
  const nuget = JSON.stringify({ version: 1, dependencies: { "net8.0": { "Newtonsoft.Json": { type: "Direct", resolved: "12.0.1" }, MyLib: { type: "Project" } } } });
  assert.deepEqual(names(parseNugetLock(nuget)), ["Newtonsoft.Json@12.0.1"]);
  assert.deepEqual(names(parseGradleLock("# comment\ncom.fasterxml.jackson.core:jackson-databind:2.9.8=compileClasspath\nempty=\n")), ["com.fasterxml.jackson.core:jackson-databind@2.9.8"]);
  assert.equal(lockfileKind("requirements-dev.txt")?.manager, "pip");
  assert.equal(lockfileKind("README.md"), null);
});

// ── versions, severity, OSV records ──

test("version ordering per ecosystem", () => {
  assert.equal(compareSemver("1.0.0-beta", "1.0.0"), -1);
  assert.equal(compareSemver("1.0.0-alpha.1", "1.0.0-alpha.beta"), -1);
  assert.equal(compareSemver("v1.2.10", "1.2.9"), 1);
  assert.equal(compareSemver("2.0.0+incompatible", "2.0.0"), 0);
  assert.equal(comparePep440("1.0rc1", "1.0"), -1);
  assert.equal(comparePep440("1.0.post1", "1.0"), 1);
  assert.equal(comparePep440("1.0.dev1", "1.0a1"), -1);
  assert.equal(comparePep440("2.20.0", "2.19.1"), 1);
  assert.equal(compareGem("1.0.0.pre", "1.0.0"), -1);
  assert.equal(compareGem("1.15.10", "1.15.4"), 1);
});

test("CVSS scores", () => {
  assert.equal(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
  assert.equal(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H"), 7.2);
  assert.equal(cvss3Score("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N"), 6.1);
  assert.equal(cvss3Score("CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:N"), 0);
  assert.equal(cvss3Score("garbage"), null);
  assert.equal(cvss4Severity("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N"), "critical");
});

test("aliases merge into one vulnerability with the best rating and the fix", () => {
  const details = new Map(VULNS.map((v) => [v.id, v]));
  const q = { ecosystem: "PyPI", name: "requests", version: "2.19.0" };
  const groups = groupVulns(["PYSEC-2018-28", "GHSA-x84v-xcm2-53pg"], details, q);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].display, "CVE-2018-18074");
  assert.equal(groups[0].severity, "high");
  assert.equal(groups[0].fixed, "2.20.0");
  assert.equal(groups[0].summary, "Insufficiently Protected Credentials in Requests");
  // minimist has two vulnerable ranges; 1.2.5 is in the second.
  assert.equal(fixedVersion(details.get("GHSA-xvch-5gv4-984h")!, { ecosystem: "npm", name: "minimist", version: "1.2.5" }), "1.2.6");
  assert.equal(fixedVersion(details.get("GHSA-xvch-5gv4-984h")!, { ecosystem: "npm", name: "minimist", version: "0.1.0" }), "0.2.4");
  assert.equal(fixedVersion(details.get("GHSA-nofx-0000-0000")!, { ecosystem: "npm", name: "left-pad", version: "1.3.0" }), undefined);
});

test("proxy settings: HTTPS_PROXY is used unless NO_PROXY matches", () => {
  const env = { HTTPS_PROXY: "http://proxy.local:3128", NO_PROXY: "localhost,.internal.example,registry.npmjs.org" };
  assert.equal(proxyFor(new URL("https://api.osv.dev/v1/querybatch"), env)?.host, "proxy.local:3128");
  assert.equal(proxyFor(new URL("https://registry.npmjs.org/x"), env), null);
  assert.equal(proxyFor(new URL("https://a.internal.example/"), env), null);
  assert.equal(proxyFor(new URL("https://api.osv.dev/"), {}), null);
});

// ── scanning projects ──

let osv: Awaited<ReturnType<typeof startFakeOsv>>;
before(async () => {
  osv = await startFakeOsv();
});
after(async () => {
  await osv.stop();
});

function projectHost(): FakeHost {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "shop", dependencies: { lodash: "^4.17.20", minimist: "^1.2.5" }, devDependencies: { "left-pad": "1.3.0" } },
      "node_modules/lodash": { version: "4.17.20" },
      "node_modules/minimist": { version: "1.2.5" },
      "node_modules/left-pad": { version: "1.3.0", dev: true },
      "node_modules/express": { version: "4.21.0" },
    },
  });
  return new FakeHost()
    .file("/etc/passwd", "root:x:0:0::/root:/bin/bash\ndev:x:1000:1000::/home/dev:/bin/bash\n")
    .dir("/home/dev/code", 0o755, [1000, 1000])
    .dir("/home/dev/code/shop", 0o755, [1000, 1000])
    .file("/home/dev/code/shop/package.json", '{"name":"shop"}\n', 0o644, [1000, 1000])
    .file("/home/dev/code/shop/package-lock.json", lock, 0o644, [1000, 1000])
    .file("/home/dev/code/shop/node_modules/lodash/package-lock.json", "{}")
    .file("/home/dev/code/api/requirements.txt", "requests==2.19.0  # http\nflask>=2.0\n", 0o644, [1000, 1000])
    .file("/home/dev/code/.cache/old/package-lock.json", "{}")
    .file("/home/dev/code/svc/go.mod", "module svc\n\nrequire golang.org/x/net v0.17.0\n", 0o644, [1000, 1000]);
}

test("projects are found without wandering into dependency or hidden folders", async () => {
  const host = projectHost();
  const { projects } = await findProjects(host, ["/home/dev/code"]);
  assert.deepEqual(projects.map((p) => p.dir).sort(), ["/home/dev/code/api", "/home/dev/code/shop", "/home/dev/code/svc"]);
});

test("a code scan reports each vulnerable package once, with its fix", async () => {
  const host = projectHost().command("npm").command("go");
  const res = await scanCode(host, ["/home/dev/code"], { osv: new OsvClient({ baseUrl: osv.url }) });
  assert.equal(res.online, true);
  const byName = Object.fromEntries(res.findings.map((f) => [f.id.split("#")[1], f]));
  assert.deepEqual(Object.keys(byName).sort(), ["Go:golang.org/x/net@0.17.0", "PyPI:requests@2.19.0", "npm:left-pad@1.3.0", "npm:lodash@4.17.20", "npm:minimist@1.2.5"]);
  const lodash = byName["npm:lodash@4.17.20"];
  assert.equal(lodash.severity, "high");
  assert.equal(lodash.title, "lodash 4.17.20 has 2 known vulnerabilities");
  assert.deepEqual(lodash.cves, ["CVE-2020-28500", "CVE-2021-23337"]);
  assert.match(lodash.summary, /Fixed in 4\.17\.21/);
  assert.equal(lodash.remedy?.auto?.fixId, "deps.npm");
  assert.equal(byName["npm:minimist@1.2.5"].severity, "critical");
  const leftpad = byName["npm:left-pad@1.3.0"];
  assert.equal(leftpad.severity, "low", "a medium issue in a development dependency counts as low");
  assert.equal(leftpad.remedy?.auto, undefined, "nothing to update to");
  assert.match(leftpad.summary, /no fixed version yet/);
  assert.equal(byName["PyPI:requests@2.19.0"].remedy?.auto?.fixId, "deps.pip");
  assert.equal(byName["Go:golang.org/x/net@0.17.0"].severity, "high");
  assert.equal(res.projects.find((p) => p.name === "shop")?.vulnerable, 3);
  assert.ok(res.notes.some((n) => /isn't pinned/.test(n)));
});

test("offline, the scan says so instead of reporting everything as clean", async () => {
  const host = projectHost();
  const res = await scanCode(host, ["/home/dev/code"], { osv: new OsvClient({ baseUrl: "http://127.0.0.1:9" }) });
  assert.equal(res.online, false);
  assert.equal(res.findings.length, 0);
  assert.ok(res.notes.some((n) => /Couldn't reach osv\.dev/.test(n)));
});

test("pinned requirements are updated in place and the change can be undone", async () => {
  const text = "requests==2.19.0  # http\nRequests_Toolbelt==0.9.1\nflask>=2.0\n";
  assert.equal(setRequirementPins(text, [{ name: "requests", from: "2.19.0", to: "2.20.0" }]), "requests==2.20.0  # http\nRequests_Toolbelt==0.9.1\nflask>=2.0\n");
  const host = projectHost();
  process.env.BULWARK_OSV_URL = osv.url;
  try {
    const res = await scanCode(host, ["/home/dev/code/api"], { osv: new OsvClient({ baseUrl: osv.url }) });
    const state = new StateStore(await fs.mkdtemp(path.join(os.tmpdir(), "bulwark-test-")));
    const change = await applyFix(host, state, res.findings);
    assert.equal(change.status, "applied", change.error);
    assert.equal(change.verification?.status, "pass", change.verification?.summary);
    assert.equal(await host.readFile("/home/dev/code/api/requirements.txt"), "requests==2.20.0  # http\nflask>=2.0\n");
    assert.equal((await refreshFindings(host, res.findings)).length, 0, "already fixed");
    await rollbackChange(host, state, change.id);
    assert.equal(await host.readFile("/home/dev/code/api/requirements.txt"), "requests==2.19.0  # http\nflask>=2.0\n");
  } finally {
    delete process.env.BULWARK_OSV_URL;
  }
});

test("npm fixes run npm as the project's owner and undo restores the lockfile", async () => {
  const host = projectHost();
  const original = (await host.readFile("/home/dev/code/shop/package-lock.json"))!;
  // Pretend npm audit fix: bump lodash and minimist in the lockfile.
  host.command("npm", () => {
    host.file("/home/dev/code/shop/package-lock.json", original.replace('"version":"4.17.20"', '"version":"4.17.21"').replace('"version":"1.2.5"', '"version":"1.2.8"'), 0o644, [1000, 1000]);
    return { code: 0, stdout: "changed 2 packages" };
  });
  process.env.BULWARK_OSV_URL = osv.url;
  try {
    const res = await scanCode(host, ["/home/dev/code/shop"], { osv: new OsvClient({ baseUrl: osv.url }) });
    const fixable = res.findings.filter((f) => f.remedy?.auto);
    assert.equal(fixable.length, 2);
    const plan = await planFix(host, fixable);
    assert.ok(plan.canApply, plan.blockedReason);
    assert.equal(plan.title, "Update 2 vulnerable packages in /home/dev/code/shop");
    assert.equal(host.execs.filter((e) => e.cmd.endsWith("npm")).length, 0, "planning doesn't run npm");
    const state = new StateStore(await fs.mkdtemp(path.join(os.tmpdir(), "bulwark-test-")));
    const change = await applyFix(host, state, fixable);
    assert.equal(change.status, "applied", change.error);
    const run = host.execs.find((e) => e.cmd.endsWith("npm"))!;
    assert.deepEqual(run.args, ["audit", "fix", "--package-lock-only", "--no-fund"]);
    assert.equal(run.opts?.cwd, "/home/dev/code/shop");
    assert.deepEqual(run.opts?.runAs, { uid: 1000, gid: 1000, user: "dev", home: "/home/dev" }, "never as root");
    assert.equal(change.verification?.status, "pass", change.verification?.summary);
    const check = await recheckDependencies(host, fixable, new OsvClient({ baseUrl: osv.url }));
    assert.equal(check.remaining.length, 0);
    await rollbackChange(host, state, change.id);
    assert.equal(await host.readFile("/home/dev/code/shop/package-lock.json"), original);
  } finally {
    delete process.env.BULWARK_OSV_URL;
  }
});

test("without the tool installed, there's no automatic fix, just the steps", async () => {
  const host = projectHost(); // no npm or go command
  const res = await scanCode(host, ["/home/dev/code/svc"], { osv: new OsvClient({ baseUrl: osv.url }) });
  const f = res.findings[0];
  assert.equal(f.remedy?.auto, undefined);
  assert.deepEqual(f.remedy?.steps, ["go get golang.org/x/net@v0.23.0 && go mod tidy"]);
});
