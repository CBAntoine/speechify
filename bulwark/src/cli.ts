// The `bulwark` command.

import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CHECKS, FIXES } from "./checks/index.ts";
import { applyFix, FixError, planFix, refreshFindings, rollbackChange, safeBatches } from "./core/fixer.ts";
import { createHost } from "./core/host.ts";
import { markdownReport } from "./core/report.ts";
import { allFindings, runScan } from "./core/scan.ts";
import { counts, grade } from "./core/score.ts";
import { defaultStateDir, StateStore } from "./core/state.ts";
import type { ChangeRecord, Finding, FixPlan, Host, Scan, Severity } from "./core/types.ts";
import { arpTable, defaultGateway } from "./net/local.ts";
import { defaultTargets } from "./net/scan.ts";
import { displayPath } from "./software/deps.ts";
import { VERSION } from "./version.ts";

// ── output ──

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint("1");
const dim = paint("2");
const green = paint("32");
const yellow = paint("33");
const red = paint("31");
const cyan = paint("36");
const SEV: Record<Severity, (s: string) => string> = { critical: paint("1;31"), high: paint("31"), medium: paint("33"), low: paint("34"), info: dim };
const sevLabel = (s: Severity) => SEV[s](s.toUpperCase().padEnd(8));

function wrap(text: string, indent: number, width = Math.min(process.stdout.columns || 100, 110)): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width - indent && line) {
      lines.push(line);
      line = w;
    } else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : " ".repeat(indent) + l)).join("\n");
}

// ── arguments ──

interface Args {
  cmd: string;
  rest: string[];
  flags: Record<string, string | boolean>;
  targets: string[];
  /** Folders to check for code projects: null without --code, [] for "the current folder". */
  code: string[] | null;
}

const BOOL = new Set(["network", "network-only", "local", "authorized", "yes", "json", "dry-run", "all-safe", "force", "last", "help", "version", "sudo", "lan"]);

export function parseArgs(argv: string[]): Args {
  const out: Args = { cmd: "", rest: [], flags: {}, targets: [], code: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") out.flags.help = true;
    else if (a === "-y") out.flags.yes = true;
    else if (a === "-v") out.flags.version = true;
    else if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=", 2);
      if (k === "target" || k === "targets") out.targets.push(...(v ?? argv[++i] ?? "").split(",").filter(Boolean));
      else if (k === "code") {
        out.code = out.code ?? [];
        if (v) out.code.push(v);
        else if (argv[i + 1] && !argv[i + 1].startsWith("-")) out.code.push(argv[++i]);
      } else if (BOOL.has(k)) out.flags[k] = true;
      else out.flags[k] = v ?? argv[++i] ?? "";
    } else if (!out.cmd) out.cmd = a;
    else out.rest.push(a);
  }
  return out;
}

const HELP = `
${bold("Bulwark")} ${VERSION}: finds security holes in your devices and fixes them.

${bold("Usage")}
  bulwark scan                    Check this device
  bulwark scan --network          …and the other devices on your network
  bulwark scan --target 192.168.1.0/24 [--target 10.0.0.5]
                                  Check specific addresses (yours, or with permission)
  bulwark scan --code [folder]    Check the code projects in a folder (default: this one) for
                                  dependencies with known vulnerabilities (looked up on osv.dev)
  bulwark fix <number|id>…        Review and apply a fix from the last scan
  bulwark fix --all-safe          Apply every low-risk fix at once
  bulwark rollback <change-id>    Undo a change (or --last)
  bulwark history                 Changes Bulwark has made
  bulwark report [--format md|json]
                                  The last scan as Markdown or JSON
  bulwark checks                  Everything Bulwark checks for
  bulwark serve [--port 7077]     Open the dashboard in your browser

${bold("Options")}
  --sudo          Run with admin rights (re-runs this command with sudo)
  --yes, -y       Don't ask before applying (cautious fixes still need it per fix)
  --dry-run       Show what a fix would change without changing anything
  --authorized    You own, or have written permission to test, the public addresses you gave
  --json          Machine-readable output

Fixes that change system settings need admin rights: run them with sudo (or --sudo),
or as Administrator on Windows. Every fix is shown before it's applied, and can be undone.
`;

// ── helpers ──

async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

const yes = async (q: string) => /^y(es)?$/i.test(await ask(`${q} [y/N] `));

function sudoUserStateDir(): string | null {
  const user = process.env.SUDO_USER;
  if (!user || user === "root") return null;
  const home = process.platform === "darwin" ? `/Users/${user}` : `/home/${user}`;
  return path.join(home, ".bulwark");
}

function reexecWithSudo(argv: string[]): never {
  if (process.platform === "win32") {
    console.error("On Windows, open the terminal with \"Run as administrator\" and run Bulwark again.");
    process.exit(1);
  }
  const entry = fileURLToPath(new URL("../bin/bulwark.mjs", import.meta.url));
  console.log(dim("Running with sudo…"));
  const r = spawnSync("sudo", [process.execPath, entry, ...argv.filter((a) => a !== "--sudo")], { stdio: "inherit" });
  process.exit(r.status ?? 1);
}

const isSoftware = (f: Finding) => f.category === "Software";

const inProject = (f: Finding, dir: string) => f.id.startsWith(`deps.vulnerable@${dir}#`);

/**
 * Failing findings in exactly the order printScan shows them (this device, installed software,
 * then each code project, then each network device), so "bulwark fix 3" means what you saw.
 */
export function numbered(scan: Scan): Finding[] {
  const local = scan.local?.findings ?? [];
  const code = scan.code ? scan.code.projects.flatMap((p) => scan.code!.findings.filter((f) => inProject(f, p.path))) : [];
  const net = scan.network ? scan.network.devices.flatMap((d) => scan.network!.findings.filter((f) => f.target === d.ip)) : [];
  return [...local.filter((f) => !isSoftware(f)), ...local.filter(isSoftware), ...code, ...net].filter((f) => f.status === "fail");
}

async function latestScan(state: StateStore): Promise<Scan | null> {
  const mine = await state.latestScan();
  const other = sudoUserStateDir();
  if (!other) return mine;
  // Under sudo, the scan you just ran as yourself counts too (it only picks findings; fixes re-check live).
  const theirs = await new StateStore(other).latestScan();
  if (!theirs) return mine;
  if (!mine || theirs.id > mine.id) return theirs;
  return mine;
}

function printFinding(f: Finding, n?: number): void {
  const num = n !== undefined ? dim(`${String(n).padStart(3)}.`) : "    ";
  const fix = f.remedy?.auto ? cyan(" [auto fix]") : "";
  const conf = f.confidence !== "confirmed" ? dim(` (${f.confidence})`) : "";
  console.log(`${num} ${sevLabel(f.severity)} ${bold(f.title)}${conf}${fix}`);
  console.log(`              ${wrap(f.summary, 14)}`);
}

function printScan(scan: Scan): void {
  const d = scan.device;
  console.log(`\n${bold("Bulwark")} ${dim(VERSION)} · ${d.hostname} · ${d.os} · ${d.isRoot ? green("admin") : yellow("not admin")}`);
  let n = 0;
  if (scan.local) {
    const s = scan.scores.local ?? 0;
    const device = scan.local.findings.filter((f) => !isSoftware(f));
    const software = scan.local.findings.filter(isSoftware);
    console.log(`\n${bold("This device")}  ${scoreText(s)}   ${summaryCounts(counts(scan.local.findings))}`);
    for (const f of device.filter((f) => f.status === "fail")) printFinding(f, ++n);
    const passed = device.filter((f) => f.status === "pass").length;
    const skipped = device.filter((f) => f.status === "skipped");
    console.log(`    ${green("✓")} ${passed} checks passed${skipped.length ? dim(`, ${skipped.length} didn't apply or need admin rights`) : ""}`);
    if (!d.isRoot && skipped.some((f) => /admin rights/.test(f.summary))) console.log(dim(`      Run with sudo to include the checks that need admin rights.`));
    if (software.length) {
      const fails = software.filter((f) => f.status === "fail");
      console.log(`\n${bold("Installed software")}  ${summaryCounts(counts(software))}`);
      for (const f of fails) printFinding(f, ++n);
      for (const f of software.filter((f) => f.status === "pass")) console.log(`    ${green("✓")} ${f.summary}`);
    }
  }
  if (scan.code) {
    const code = scan.code;
    const pkgs = code.projects.reduce((a, p) => a + p.packages, 0);
    console.log(`\n${bold("Code projects")}  ${code.projects.length} project${code.projects.length === 1 ? "" : "s"} · ${pkgs} package versions · ${(code.durationMs / 1000).toFixed(1)}s`);
    if (!code.projects.length) console.log(dim(`    No lockfiles found under ${code.roots.join(", ")}.`));
    for (const p of code.projects) {
      const fs = code.findings.filter((f) => inProject(f, p.path));
      const status = !code.online ? yellow("not checked (offline)") : fs.length ? summaryCounts(counts(fs)) : green("no known vulnerabilities");
      console.log(`\n  ${bold(displayPath(p.path))}  ${dim(`${p.files.join(", ")} · ${p.packages} packages`)}  ${status}`);
      for (const f of fs) printFinding(f, ++n);
    }
    for (const note of code.notes) console.log(yellow(`  ! ${wrap(note, 4)}`));
  }
  if (scan.network) {
    const net = scan.network;
    console.log(`\n${bold("Network")}  ${net.targets.join(", ")} · ${net.devices.length} device${net.devices.length === 1 ? "" : "s"} · ${(net.durationMs / 1000).toFixed(1)}s`);
    for (const dev of net.devices) {
      const fs = net.findings.filter((f) => f.target === dev.ip);
      const name = [dev.name, dev.model].filter(Boolean).join(" · ");
      const ports = dev.services.map((s) => `${s.port}/${s.name}`).join(" ");
      const sc = scan.scores.devices[dev.ip] ?? 100;
      console.log(`\n  ${bold(dev.ip.padEnd(15))} ${dev.kind}${name ? dim(` · ${name}`) : ""}  ${fs.length ? scoreText(sc) : green("no problems found")}`);
      if (ports) console.log(dim(`                  open: ${ports}`));
      for (const f of fs) printFinding(f, ++n);
    }
    for (const note of net.notes) console.log(yellow(`  ! ${wrap(note, 4)}`));
  }
  const auto = numbered(scan).filter((f) => f.remedy?.auto).length;
  console.log();
  if (n) console.log(`${bold("Next:")} ${auto ? `bulwark fix <number> to review a fix · bulwark fix --all-safe · ` : ""}bulwark serve for the dashboard`);
  else console.log(green("No problems found."));
  if (!scan.network && !scan.code) console.log(dim("Add --network to also check the other devices on your network, or --code <folder> for your code projects."));
}

function scoreText(s: number): string {
  const g = grade(s);
  const f = s >= 80 ? green : s >= 50 ? yellow : red;
  return f(bold(`${s}/100 (${g})`));
}

function summaryCounts(c: Record<Severity, number>): string {
  const parts = (["critical", "high", "medium", "low"] as Severity[]).filter((s) => c[s]).map((s) => SEV[s](`${c[s]} ${s}`));
  return parts.length ? parts.join(dim(" · ")) : green("no problems");
}

function printPlan(plan: FixPlan): void {
  console.log(`\n${bold(plan.title)}  ${plan.risk === "caution" ? yellow("[caution]") : green("[low risk]")} ${plan.reversible ? dim("[can be undone]") : yellow("[can't be undone]")}`);
  console.log(bold("\nWhat will change"));
  plan.steps.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.title}`);
    if (s.detail) {
      for (const line of s.detail.split("\n").slice(0, 40)) {
        const l = line.startsWith("+") && !line.startsWith("+++") ? green(line) : line.startsWith("-") && !line.startsWith("---") ? red(line) : dim(line);
        console.log(`       ${l}`);
      }
    }
  });
  if (plan.preconditions.length) {
    console.log(bold("\nChecked first"));
    for (const p of plan.preconditions) console.log(`  ${p.ok ? green("✓") : red("✗")} ${wrap(p.message, 4)}`);
  }
  if (plan.warnings.length) {
    console.log(bold("\nGood to know"));
    for (const w of plan.warnings) console.log(`  ${yellow("!")} ${wrap(w, 4)}`);
  }
}

function printChange(c: ChangeRecord): void {
  if (c.status === "applied") {
    console.log(`\n${green("✓ Applied.")} ${c.verification ? (c.verification.status === "pass" ? green(c.verification.summary) : yellow(c.verification.summary)) : ""}`);
    if (c.reversible) console.log(dim(`  Undo with: bulwark rollback ${c.id}`));
  } else {
    console.log(`\n${red("✗ The fix didn't work:")} ${c.error}`);
    console.log(c.status === "rolled-back" ? green("  Everything was put back the way it was.") : red("  Some steps couldn't be undone; see bulwark history."));
  }
}

// ── network ownership ──

async function networkKey(host: Host, cidr: string): Promise<string> {
  const gw = await defaultGateway(host);
  const mac = gw ? (await arpTable(host)).get(gw) : undefined;
  return `${cidr}${mac ? `@${mac}` : ""}`;
}

// ── commands ──

async function cmdScan(host: Host, state: StateStore, a: Args): Promise<void> {
  const wantNetwork = !!a.flags.network || !!a.flags["network-only"] || a.targets.length > 0;
  // --code or --target on their own mean "just that"; add --local to include this device too.
  const local = !a.flags["network-only"] && !((a.targets.length || a.code) && !a.flags.local);
  const codeRoots = a.code ? (a.code.length ? a.code.map((c) => path.resolve(c)) : [process.cwd()]) : undefined;
  if (codeRoots) console.log(dim(`Package names and versions from ${codeRoots.map(displayPath).join(", ")} are looked up on osv.dev; nothing else is sent.`));
  let network: Parameters<typeof runScan>[1]["network"];
  if (wantNetwork) {
    let targets = a.targets;
    let confirmed = false;
    if (!targets.length) {
      const d = defaultTargets();
      for (const s of d.skipped) console.log(yellow(`! ${s}`));
      targets = d.targets;
      if (!targets.length) {
        console.log(red("No private network found to scan. Pass --target with the addresses to check."));
        if (!local && !codeRoots) return;
      }
    }
    if (targets.length) {
      const known = await state.confirmedNetworks();
      const keys = await Promise.all(targets.map((t) => networkKey(host, t)));
      const unknown = targets.filter((_, i) => !known.includes(keys[i]));
      if (unknown.length && !a.flags.yes) {
        console.log(`\nBulwark will check the devices on ${bold(unknown.join(", "))}.`);
        console.log(dim("Only scan networks you own or have permission to test (a home network, your office with IT's OK)."));
        if (!(await yes("Is this your network?"))) {
          console.log("Skipped the network scan.");
          if (!local && !codeRoots) return;
          targets = [];
        }
      }
      if (targets.length) {
        confirmed = true;
        for (let i = 0; i < targets.length; i++) await state.confirmNetwork(keys[i]);
        network = { targets, authorized: !!a.flags.authorized, confirmedOwnership: confirmed };
      }
    }
  }
  if (!local && !network && !codeRoots) return;
  const tty = process.stdout.isTTY && !a.flags.json;
  const scan = await runScan(host, {
    local,
    code: codeRoots ? { roots: codeRoots, cacheDir: path.join(state.dir, "osv-cache") } : undefined,
    network,
    onProgress: (p) => {
      if (tty) process.stdout.write(`\r\x1b[2K${dim(`${p.message ?? p.phase} ${p.total > 1 ? `(${p.done}/${p.total})` : ""}`)}`);
    },
  });
  if (tty) process.stdout.write("\r\x1b[2K");
  await state.saveScan(scan);
  if (a.flags.json) console.log(JSON.stringify(scan, null, 2));
  else printScan(scan);
}

async function resolveFindings(scan: Scan, refs: string[]): Promise<Finding[]> {
  const list = numbered(scan);
  const all = allFindings(scan);
  const out: Finding[] = [];
  for (const r of refs) {
    let f: Finding | undefined;
    if (/^\d+$/.test(r)) f = list[Number(r) - 1];
    else f = all.find((x) => x.id === r) ?? (all.filter((x) => x.checkId === r && x.status === "fail").length === 1 ? all.find((x) => x.checkId === r && x.status === "fail") : undefined);
    if (!f) throw new FixError(`"${r}" doesn't match a problem in the last scan (${scan.id}). Run bulwark scan, then use the numbers it shows.`);
    if (!f.remedy?.auto) throw new FixError(`"${f.title}" has no automatic fix. To fix it by hand:\n${(f.remedy?.steps ?? []).map((s) => `  - ${s}`).join("\n")}`);
    out.push(f);
  }
  return out;
}

async function cmdFix(host: Host, state: StateStore, a: Args, argv: string[]): Promise<void> {
  const scan = await latestScan(state);
  if (!scan) throw new FixError("No scan yet. Run bulwark scan first.");
  let groups: Finding[][];
  if (a.flags["all-safe"]) {
    groups = safeBatches(numbered(scan));
    if (!groups.length) {
      console.log("There are no low-risk automatic fixes to apply. Fix the others one at a time with bulwark fix <number>.");
      return;
    }
  } else {
    if (!a.rest.length) throw new FixError("Say which problem to fix: bulwark fix <number> (numbers are in the scan output).");
    const found = await resolveFindings(scan, a.rest);
    // Findings that share a combinable fix (kernel settings, file permissions) become one change.
    const map = new Map<string, Finding[]>();
    for (const f of found) {
      const fix = FIXES.get(f.remedy!.auto!.fixId);
      const key = fix?.merge ? fix.id : f.id;
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    groups = [...map.values()];
  }
  const needsRoot = groups.some((g) => FIXES.get(g[0].remedy!.auto!.fixId)?.needsRoot);
  if (needsRoot && !host.isRoot && !a.flags["dry-run"]) {
    if (a.flags.sudo || (await yes("These fixes need admin rights. Run again with sudo?"))) reexecWithSudo(argv);
  }
  for (const group of groups) {
    const fresh = await refreshFindings(host, group);
    if (!fresh.length) {
      console.log(`\n${green("✓")} ${group.map((f) => f.title).join(", ")}: already fixed.`);
      continue;
    }
    const plan = await planFix(host, fresh);
    printPlan(plan);
    if (a.flags["dry-run"]) continue;
    if (!plan.canApply) {
      console.log(`\n${yellow("Can't apply this yet:")} ${plan.blockedReason}`);
      continue;
    }
    const auto = a.flags.yes && (plan.risk === "safe" || a.rest.length > 0);
    if (!auto && !(await yes(`\nApply "${plan.title}"?`))) {
      console.log("Skipped.");
      continue;
    }
    const change = await applyFix(host, state, fresh);
    printChange(change);
  }
}

async function cmdRollback(host: Host, state: StateStore, a: Args): Promise<void> {
  let id = a.rest[0];
  if (a.flags.last || !id) {
    const last = (await state.listChanges()).find((c) => c.status === "applied" && c.reversible);
    if (!last) throw new FixError("There's no change to undo.");
    id = last.id;
  }
  const change = await state.getChange(id);
  if (!change) throw new FixError(`No change with the id ${id}. See bulwark history.`);
  console.log(`Undo "${change.title}" from ${new Date(change.appliedAt).toLocaleString()}:`);
  for (const act of [...change.actions].reverse()) {
    const what = act.type === "write" ? (act.existed ? `restore ${act.path}` : `remove ${act.path}`) : act.type === "remove" ? `restore ${act.path}` : act.type === "chmod" ? `put back the permissions of ${act.path}` : act.type === "exec" ? (act.undo ? `undo: ${act.title}` : act.rerunOnRollback ? `again: ${act.title}` : `(no undo needed) ${act.title}`) : `undo: ${act.title}`;
    console.log(`  - ${what}`);
  }
  if (!a.flags.yes && !(await yes("Undo this change?"))) return;
  const r = await rollbackChange(host, state, id, { force: !!a.flags.force });
  console.log(green(`✓ Undone.`), dim(r.log.slice(-1)[0] ?? ""));
}

async function cmdHistory(state: StateStore, a: Args): Promise<void> {
  const changes = await state.listChanges();
  if (a.flags.json) {
    console.log(JSON.stringify(changes, null, 2));
    return;
  }
  if (!changes.length) console.log("Bulwark hasn't changed anything on this device yet.");
  for (const c of changes) {
    const st = c.status === "applied" ? green("applied") : c.status === "rolled-back" ? dim("undone") : red("failed");
    console.log(`${dim(new Date(c.appliedAt).toLocaleString())}  ${st.padEnd(color ? 16 : 8)} ${bold(c.title)}`);
    console.log(dim(`    ${c.id}${c.verification ? ` · ${c.verification.summary}` : ""}${c.error ? ` · ${c.error}` : ""}`));
  }
  if (process.platform !== "win32" && process.getuid?.() !== 0) console.log(dim("\nChanges made with sudo are listed by: sudo bulwark history"));
}

function cmdChecks(): void {
  const byCat = new Map<string, typeof CHECKS>();
  for (const c of CHECKS) byCat.set(c.category, [...(byCat.get(c.category) ?? []), c]);
  for (const [cat, list] of byCat) {
    console.log(bold(`\n${cat}`));
    for (const c of list) {
      const plat = c.platforms.map((p) => ({ linux: "Linux", darwin: "macOS", win32: "Windows" })[p]).join(", ");
      console.log(`  ${sevLabel(c.severity)} ${c.title} ${dim(`(${plat})`)}`);
    }
  }
  console.log(bold("\nNetwork devices"));
  console.log("  Every device on the network is checked for: Telnet (and shells without a password), FTP, SSH versions,");
  console.log("  Terrapin and weak SSH crypto, web logins without HTTPS, old TLS, expired certificates, SMBv1, Remote Desktop");
  console.log("  without NLA, VNC without a password, open Redis/Memcached/MongoDB/Elasticsearch/CouchDB/Docker APIs,");
  console.log("  anonymous MQTT, open Android debugging, exposed databases, camera streams without a login, known-vulnerable");
  console.log("  software versions (CVE list), and the router's UPnP port forwards (which Bulwark can remove).");
  console.log(bold("\nCode projects (--code)"));
  console.log("  Every exact dependency version in npm, pnpm, Yarn, pip, Poetry, uv, Pipenv, Cargo, Go, Bundler, Composer,");
  console.log("  NuGet and Gradle lockfiles is checked against OSV.dev. Fixes use each project's own tool (npm audit fix,");
  console.log("  poetry update, uv lock, cargo update, go get, bundle lock, composer update) or edit requirements.txt pins.");
}

async function cmdReport(state: StateStore, a: Args): Promise<void> {
  const scan = a.rest[0] ? await state.getScan(a.rest[0]) : await latestScan(state);
  if (!scan) throw new FixError("No scan yet. Run bulwark scan first.");
  if (a.flags.format === "json" || a.flags.json) console.log(JSON.stringify(scan, null, 2));
  else console.log(markdownReport(scan, await state.listChanges()));
}

export async function main(argv: string[]): Promise<void> {
  const a = parseArgs(argv);
  if (a.flags.version) {
    console.log(VERSION);
    return;
  }
  if (a.flags.help || !a.cmd || a.cmd === "help") {
    console.log(HELP);
    return;
  }
  const host = await createHost();
  if (a.flags.sudo && !host.isRoot) reexecWithSudo(argv);
  const state = new StateStore(typeof a.flags["state-dir"] === "string" ? a.flags["state-dir"] : defaultStateDir(host.platform, host.isRoot));
  try {
    switch (a.cmd) {
      case "scan":
        await cmdScan(host, state, a);
        break;
      case "fix":
        await cmdFix(host, state, a, argv);
        break;
      case "rollback":
      case "undo":
        await cmdRollback(host, state, a);
        break;
      case "history":
        await cmdHistory(state, a);
        break;
      case "checks":
        cmdChecks();
        break;
      case "report":
        await cmdReport(state, a);
        break;
      case "serve":
      case "dashboard": {
        const { startServer } = await import("./server.ts");
        await startServer({ host, state, port: Number(a.flags.port) || 7077, bind: typeof a.flags.host === "string" ? a.flags.host : "127.0.0.1" });
        break;
      }
      default:
        console.log(`Unknown command "${a.cmd}".\n${HELP}`);
        process.exitCode = 2;
    }
  } catch (err) {
    if (err instanceof FixError) {
      console.error(red(err.message));
      process.exitCode = 1;
    } else throw err;
  }
}

// Run when executed directly (the launcher imports `main` instead on Node versions with TypeScript built in).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}

