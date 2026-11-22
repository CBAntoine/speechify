import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { unifiedDiff } from "../src/core/diff.ts";
import { applyFix, planFix, refreshFindings, rollbackChange, safeBatches } from "../src/core/fixer.ts";
import { outcomeToFinding } from "../src/core/audit.ts";
import { grade, score } from "../src/core/score.ts";
import { StateStore } from "../src/core/state.ts";
import { rollbackActions, Tx } from "../src/core/tx.ts";
import type { Finding } from "../src/core/types.ts";
import { compareDebian, compareVersions, versionInRange } from "../src/core/versions.ts";
import { kernelHardening } from "../src/checks/linux/kernel.ts";
import { sensitiveFiles } from "../src/checks/linux/files.ts";
import { FakeHost } from "./helpers/fake-host.ts";

async function tempState(): Promise<StateStore> {
  return new StateStore(await fs.mkdtemp(path.join(os.tmpdir(), "bulwark-test-")));
}

test("dpkg version ordering", () => {
  assert.equal(compareDebian("1:9.6p1-3ubuntu13.5", "1:9.6p1-3ubuntu13.3"), 1);
  assert.equal(compareDebian("9.2p1-2+deb12u2", "9.2p1-2+deb12u3"), -1);
  assert.equal(compareDebian("1.0~rc1-1", "1.0-1"), -1); // tilde sorts before anything
  assert.equal(compareDebian("2:1.0-1", "1:9.9-1"), 1); // epoch wins
  assert.equal(compareDebian("1.2.3-1", "1.2.3-1"), 0);
});

test("upstream version ordering", () => {
  assert.equal(compareVersions("9.6p1", "9.8p1"), -1);
  assert.equal(compareVersions("9.8", "9.8p1"), -1);
  assert.equal(compareVersions("1.0.1f", "1.0.1g"), -1);
  assert.equal(compareVersions("1.0.1", "1.0.1a"), -1);
  assert.equal(compareVersions("2020.79", "2016.74"), 1);
  assert.equal(compareVersions("10.0", "9.9"), 1);
  assert.ok(versionInRange("9.6p1", { gte: "8.5p1", lt: "9.8p1" }));
  assert.ok(!versionInRange("9.8p1", { gte: "8.5p1", lt: "9.8p1" }));
  assert.ok(!versionInRange("8.4p1", { gte: "8.5p1", lt: "9.8p1" }));
});

test("unified diff shows only the changed lines with context", () => {
  const before = "a\nb\nc\nd\ne\nf\ng\nh\n";
  const after = "a\nb\nc\nD\ne\nf\ng\nh\n";
  const d = unifiedDiff(before, after, "/etc/x");
  assert.match(d, /^--- \/etc\/x\n\+\+\+ \/etc\/x\n@@ -1,7 \+1,7 @@/);
  assert.match(d, /\n-d\n\+D\n/);
  assert.equal(unifiedDiff(before, before, "/etc/x"), "");
  assert.match(unifiedDiff(null, "new\n", "/etc/y"), /^--- \/dev\/null/);
});

test("score and grade", () => {
  const f = (severity: Finding["severity"], confidence: Finding["confidence"] = "confirmed") => ({ status: "fail", severity, confidence }) as Finding;
  assert.equal(score([]), 100);
  assert.equal(score([f("critical"), f("high")]), 55);
  assert.equal(score([f("high", "possible")]), 93);
  assert.equal(score([f("critical"), f("critical"), f("critical"), f("critical")]), 0);
  assert.equal(grade(95), "A");
  assert.equal(grade(40), "F");
});

test("a dry run records the plan and changes nothing", async () => {
  const host = new FakeHost().file("/etc/app.conf", "x = 1\n");
  const tx = new Tx(host, { dryRun: true });
  await tx.writeFile("/etc/app.conf", "x = 2\n");
  await tx.chmod("/etc/app.conf", 0o600);
  await tx.exec({ cmd: "systemctl", args: ["reload", "app"] }, { title: "Reload" });
  assert.equal(await host.readFile("/etc/app.conf"), "x = 1\n");
  assert.equal(host.execs.length, 0);
  assert.deepEqual(tx.steps.map((s) => s.kind), ["file", "permission", "command"]);
  assert.match(tx.steps[0].detail!, /-x = 1\n\+x = 2/);
});

test("rollback restores files, permissions and runs reloads last", async () => {
  const host = new FakeHost().file("/etc/app.conf", "x = 1\n", 0o640).command("svc");
  const tx = new Tx(host, { dryRun: false });
  await tx.writeFile("/etc/app.conf", "x = 2\n");
  await tx.writeFile("/etc/app.d/new.conf", "y = 1\n");
  await tx.chmod("/etc/app.conf", 0o600);
  await tx.exec({ cmd: "svc", args: ["reload"] }, { title: "Reload", rerunOnRollback: true });
  await tx.exec({ cmd: "svc", args: ["enable"] }, { title: "Enable", undo: { cmd: "svc", args: ["disable"] } });
  host.execs.length = 0;
  const r = await rollbackActions(host, tx.actions);
  assert.ok(r.ok, r.errors.join());
  assert.equal(await host.readFile("/etc/app.conf"), "x = 1\n");
  assert.equal((await host.stat("/etc/app.conf"))!.mode, 0o640);
  assert.equal(await host.readFile("/etc/app.d/new.conf"), null);
  // Undo commands first, the reload after everything is back.
  assert.deepEqual(host.execs.map((e) => e.args[0]), ["disable", "reload"]);
});

test("rollback refuses to clobber a file edited after the fix", async () => {
  const host = new FakeHost().file("/etc/app.conf", "x = 1\n");
  const tx = new Tx(host, { dryRun: false });
  await tx.writeFile("/etc/app.conf", "x = 2\n");
  await host.writeFile("/etc/app.conf", "x = 3 (edited by hand)\n");
  const r = await rollbackActions(host, tx.actions);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /changed after the fix/);
  assert.equal(await host.readFile("/etc/app.conf"), "x = 3 (edited by hand)\n");
  assert.ok((await rollbackActions(host, tx.actions, { force: true })).ok);
  assert.equal(await host.readFile("/etc/app.conf"), "x = 1\n");
});

function sysctlHost(): FakeHost {
  const host = new FakeHost();
  const values: Record<string, string> = {
    "kernel/randomize_va_space": "2",
    "fs/protected_symlinks": "0",
    "fs/protected_hardlinks": "1",
    "kernel/kptr_restrict": "0",
    "net/ipv4/conf/all/accept_redirects": "1",
  };
  for (const [k, v] of Object.entries(values)) host.file(`/proc/sys/${k}`, `${v}\n`);
  host.command("sysctl", (args) => {
    const [k, v] = args[1].split("=");
    host.file(`/proc/sys/${k.replace(/\./g, "/")}`, `${v}\n`);
    return { stdout: `${k} = ${v}\n` };
  });
  return host;
}

async function findingsFor(host: FakeHost): Promise<Finding[]> {
  return (await kernelHardening.run(host)).map((o) => outcomeToFinding(kernelHardening, o));
}

test("kernel check finds the weak settings and one fix covers them all", async () => {
  const host = sysctlHost();
  const fails = (await findingsFor(host)).filter((f) => f.status === "fail");
  assert.deepEqual(fails.map((f) => f.id).sort(), ["linux.kernel.sysctl:fs.protected_symlinks", "linux.kernel.sysctl:kernel.kptr_restrict", "linux.kernel.sysctl:net.ipv4.conf.all.accept_redirects"]);
  const batches = safeBatches(fails);
  assert.equal(batches.length, 1, "kernel settings merge into a single change");
  const plan = await planFix(host, batches[0]);
  assert.ok(plan.canApply, plan.blockedReason);
  assert.equal(plan.title, "Apply 3 kernel hardening settings");
  assert.equal(host.execs.filter((e) => e.cmd === "sysctl").length, 0, "planning runs nothing");
});

test("applying a fix verifies it, and rolling it back restores the old values", async () => {
  const host = sysctlHost();
  const state = await tempState();
  const fails = (await findingsFor(host)).filter((f) => f.status === "fail");
  const change = await applyFix(host, state, fails);
  assert.equal(change.status, "applied");
  assert.equal(change.verification?.status, "pass");
  assert.match((await host.readFile("/etc/sysctl.d/99-zz-bulwark.conf"))!, /fs.protected_symlinks = 1\nkernel.kptr_restrict = 1\nnet.ipv4.conf.all.accept_redirects = 0/);
  assert.equal((await host.readFile("/proc/sys/fs/protected_symlinks"))!.trim(), "1");
  assert.equal((await refreshFindings(host, fails)).length, 0, "a re-check sees them fixed");

  const undone = await rollbackChange(host, state, change.id);
  assert.equal(undone.status, "rolled-back");
  assert.equal(await host.readFile("/etc/sysctl.d/99-zz-bulwark.conf"), null);
  assert.equal((await host.readFile("/proc/sys/fs/protected_symlinks"))!.trim(), "0");
  assert.equal((await host.readFile("/proc/sys/net/ipv4/conf/all/accept_redirects"))!.trim(), "1");
  await assert.rejects(rollbackChange(host, state, change.id), /already undone/);
});

test("a fix that fails half-way puts everything back", async () => {
  const host = sysctlHost();
  host.on((cmd, args) => (cmd === "sysctl" && args[1].startsWith("kernel.kptr_restrict") ? { code: 1, stdout: "", stderr: "sysctl: permission denied on key" } : undefined));
  const state = await tempState();
  const fails = (await findingsFor(host)).filter((f) => f.status === "fail");
  const change = await applyFix(host, state, fails);
  assert.equal(change.status, "rolled-back");
  assert.match(change.error!, /permission denied/);
  assert.equal(await host.readFile("/etc/sysctl.d/99-zz-bulwark.conf"), null);
  assert.equal((await host.readFile("/proc/sys/fs/protected_symlinks"))!.trim(), "0");
});

test("fixes that need root are refused without it", async () => {
  const host = sysctlHost();
  host.isRoot = false;
  const fails = (await findingsFor(host)).filter((f) => f.status === "fail");
  const plan = await planFix(host, fails);
  assert.equal(plan.canApply, false);
  assert.match(plan.blockedReason!, /admin rights/);
});

test("fix parameters come from a fresh check, not from a saved scan", async () => {
  const host = new FakeHost().file("/etc/shadow", "root:*:19000:0:99999:7:::\n", 0o644);
  const real = (await sensitiveFiles.run(host)).map((o) => outcomeToFinding(sensitiveFiles, o)).filter((f) => f.status === "fail");
  assert.equal(real.length, 1);
  // Someone edits the saved finding to make the fix loosen a file instead.
  const tampered = structuredClone(real[0]);
  tampered.remedy!.auto!.params = { items: [{ path: "/etc/shadow", mode: 0o666 }] };
  const fresh = await refreshFindings(host, [tampered]);
  assert.deepEqual(fresh[0].remedy!.auto!.params, { items: [{ path: "/etc/shadow", mode: 0o640 }] });
  // And the chmod fix itself never adds permissions.
  const plan = await planFix(host, [tampered]);
  assert.equal(plan.canApply, false);
});

test("state store keeps scans and changes, and a stable dashboard token", async () => {
  const state = await tempState();
  const t1 = await state.token();
  assert.match(t1, /^[a-f0-9]{48}$/);
  assert.equal(await state.token(), t1);
  const st = await fs.stat(path.join(state.dir, "dashboard-token"));
  assert.equal(st.mode & 0o077, 0, "token file is private");
  await state.confirmNetwork("192.168.1.0/24@aa:bb");
  assert.deepEqual(await state.confirmedNetworks(), ["192.168.1.0/24@aa:bb"]);
  assert.equal(await state.getScan("../../etc/passwd"), null);
});
