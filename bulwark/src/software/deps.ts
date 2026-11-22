// Code projects: find them, read their lockfiles, look the exact versions up in OSV, and fix
// vulnerable dependencies with each ecosystem's own tool (run as the project's owner, never root).

import * as os from "node:os";
import * as path from "node:path";
import { userToolDirs } from "../core/host.ts";
import { sortFindings } from "../core/score.ts";
import type { CodeProject, CodeScan, Finding, Fix, FixContext, Host, RunAs, Severity, Status, TxApi } from "../core/types.ts";
import { lockfileKind, normalizePyName, parseRequirements, type Dependency, type LockfileKind } from "./lockfiles.ts";
import { groupVulns, OsvClient, type PackageQuery, type VulnGroup } from "./osv.ts";
import { compareEcosystem } from "./versions.ts";

// ── finding projects ──

const SKIP_DIRS = new Set([
  "node_modules", "vendor", "venv", "__pycache__", "dist", "build", "target", "coverage", "out",
  "Library", "AppData", "Applications", "Pods", "DerivedData", "bower_components", "jspm_packages",
  "site-packages", "proc", "sys", "dev", "snap", "System", "Volumes", "private",
]);

export interface FoundProject {
  dir: string;
  files: string[];
}

/** Folders under `roots` that contain a lockfile, skipping dependency and build folders. */
export async function findProjects(host: Host, roots: string[], opts: { maxDepth?: number; maxProjects?: number; maxDirs?: number } = {}): Promise<{ projects: FoundProject[]; truncated: boolean }> {
  const maxDepth = opts.maxDepth ?? 6;
  const maxProjects = opts.maxProjects ?? 300;
  let budget = opts.maxDirs ?? 40_000;
  const projects: FoundProject[] = [];
  const seen = new Set<string>();
  const queue: { dir: string; depth: number }[] = roots.map((r) => ({ dir: path.resolve(r), depth: 0 }));
  while (queue.length && projects.length < maxProjects && budget-- > 0) {
    const { dir, depth } = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    const names = await host.readDir(dir);
    if (!names) continue;
    const files = names.filter((n) => lockfileKind(n));
    if (files.length) projects.push({ dir, files: files.sort() });
    if (depth >= maxDepth) continue;
    for (const n of names) {
      if (n.startsWith(".") || SKIP_DIRS.has(n) || (n === "mod" && path.basename(dir) === "pkg")) continue;
      const st = await host.lstat(path.join(dir, n));
      if (st?.isDir) queue.push({ dir: path.join(dir, n), depth: depth + 1 });
    }
  }
  return { projects, truncated: projects.length >= maxProjects || budget <= 0 };
}

/** Where to look by default: the home folder of whoever is using Bulwark (even under sudo). */
export async function defaultCodeRoots(host: Host): Promise<string[]> {
  const sudoUser = host.env.SUDO_USER;
  if (sudoUser && sudoUser !== "root") {
    const passwd = (await host.readFile("/etc/passwd")) ?? "";
    const home = passwd.split("\n").map((l) => l.split(":")).find((f) => f[0] === sudoUser)?.[5];
    if (home) return [home];
    if (host.platform === "darwin") return [`/Users/${sudoUser}`];
  }
  return [os.homedir()];
}

// ── reading and looking up ──

interface DepUse {
  project: string;
  file: string;
  kind: LockfileKind;
  dep: Dependency;
}

const queryKey = (eco: string, name: string, version: string) => `${eco}\u0000${eco === "PyPI" ? normalizePyName(name) : name}\u0000${version}`;
const DOWN: Record<Severity, Severity> = { critical: "high", high: "medium", medium: "low", low: "low", info: "info" };

export const FIXABLE = new Set(["npm", "pnpm", "pip", "poetry", "uv", "cargo", "go", "bundler", "composer"]);

const TOOL: Record<string, string> = { npm: "npm", pnpm: "pnpm", poetry: "poetry", uv: "uv", cargo: "cargo", go: "go", bundler: "bundle", composer: "composer" };

export function displayPath(p: string): string {
  const home = os.homedir();
  return p === home ? "~" : p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p;
}

function manualSteps(manager: string, file: string, d: Dependency, fixed: string | undefined): string[] {
  const v = fixed ?? "the latest version";
  if (!fixed) return ["No fixed version exists yet. Follow the advisory for a workaround, consider a different package, or limit how the app uses this one."];
  switch (manager) {
    case "npm":
      return d.direct ? [`npm install ${d.name}@${fixed}`] : [`npm audit fix (it comes in through another package; if that doesn't reach ${fixed}, add "overrides": { "${d.name}": "${fixed}" } to package.json)`];
    case "yarn":
      return d.direct ? [`yarn upgrade ${d.name}@^${fixed}`] : [`Add "resolutions": { "${d.name}": "^${fixed}" } to package.json, then run yarn install`];
    case "pnpm":
      return [`pnpm audit --fix, then pnpm install`];
    case "pip":
      return [`In ${file}, change ${d.name}==${d.version} to ${d.name}==${fixed}, then run pip install -r ${file}`];
    case "poetry":
      return [`poetry update ${d.name} (or poetry add ${d.name}@^${fixed} if the version range in pyproject.toml doesn't allow ${fixed})`];
    case "uv":
      return [`uv lock --upgrade-package ${d.name}`];
    case "pipenv":
      return [`pipenv update ${d.name}`];
    case "cargo":
      return [`cargo update ${d.name} (or raise the version in Cargo.toml to ${fixed})`];
    case "go":
      return [`go get ${d.name}@v${fixed} && go mod tidy`];
    case "bundler":
      return [`bundle lock --conservative --update ${d.name}, then bundle install`];
    case "composer":
      return [`composer update ${d.name} --with-dependencies`];
    case "dotnet":
      return [`dotnet add package ${d.name} --version ${v}`];
    case "gradle":
      return [`Update ${d.name} to ${v} in your build file, then ./gradlew dependencies --write-locks`];
    default:
      return [`Update ${d.name} to ${v}.`];
  }
}

function buildFinding(project: string, uses: DepUse[], groups: VulnGroup[], ecosystem: string, autoAvailable: boolean): Finding {
  const d = uses[0].dep;
  const dev = uses.every((u) => u.dep.dev);
  const top = groups[0];
  let severity = top.severity;
  if (dev) severity = DOWN[severity];
  // The lowest version that fixes every vulnerability that has a fix.
  const best = groups.reduce<string | undefined>((acc, g) => (g.fixed && (!acc || compareEcosystem(ecosystem, g.fixed, acc) > 0) ? g.fixed : acc), undefined);
  const unfixed = groups.filter((g) => !g.fixed).length;
  const files = [...new Set(uses.map((u) => u.file))];
  const manager = uses[0].kind.manager;
  const n = groups.length;
  const fixText = !best ? "There's no fixed version yet." : unfixed ? `Version ${best} fixes ${n - unfixed} of them; ${unfixed} ${unfixed === 1 ? "has" : "have"} no fix yet.` : `Fixed in ${best}.`;
  const auto =
    autoAvailable && best && FIXABLE.has(manager) && (manager !== "pip" || uses.some((u) => u.dep.line))
      ? { fixId: `deps.${manager}`, params: { targets: [{ dir: project, file: uses[0].file, manager, packages: [{ name: d.name, version: d.version, fixed: best, direct: !!d.direct }] }] } }
      : undefined;
  return {
    id: `deps.vulnerable@${project}#${ecosystem}:${d.name}@${d.version}`,
    checkId: "deps.vulnerable",
    target: "code",
    title: n === 1 ? `${d.name} ${d.version}: ${top.summary}` : `${d.name} ${d.version} has ${n} known vulnerabilities`,
    category: "Dependencies",
    severity,
    status: "fail",
    confidence: "confirmed",
    summary: `${n === 1 ? `${top.display}.` : `Worst: ${top.summary} (${top.display}).`} ${fixText} In ${files.join(", ")}${dev ? ", as a development dependency" : d.direct ? "" : ", through another package"}.`,
    why: dev
      ? "This package is only used while developing or building, so it's less exposed than code your app runs, but a vulnerable build tool can still be used against your machine or your build."
      : "Known vulnerabilities in packages your project uses can be turned against your app, its users or your machine. Updating to a version with the fix closes them.",
    evidence: groups.map((g) => `${g.severity.toUpperCase()} ${g.display}${g.display !== g.primary ? ` (${g.primary})` : ""}: ${g.summary}${g.fixed ? ` · fixed in ${g.fixed}` : " · no fix yet"}`),
    remedy: { auto, steps: manualSteps(manager, uses[0].file, d, best) },
    references: groups.map((g) => `https://osv.dev/vulnerability/${g.primary}`),
    cves: [...new Set(groups.flatMap((g) => g.cves))].sort(),
  };
}

export async function readProject(host: Host, p: FoundProject): Promise<{ uses: DepUse[]; notes: string[] }> {
  const uses: DepUse[] = [];
  const notes: string[] = [];
  for (const f of p.files) {
    const kind = lockfileKind(f)!;
    const text = await host.readFile(path.join(p.dir, f));
    if (text === null) continue;
    try {
      const r = kind.parse(text);
      for (const n of r.notes) notes.push(`${displayPath(p.dir)}/${f}: ${n}`);
      for (const dep of r.deps) uses.push({ project: p.dir, file: f, kind, dep });
    } catch (err) {
      notes.push(`${displayPath(p.dir)}/${f}: couldn't read it (${err instanceof Error ? err.message : String(err)}).`);
    }
  }
  return { uses, notes };
}

export interface CodeScanOptions {
  cacheDir?: string;
  osv?: OsvClient;
  onProgress?: (p: { phase: string; done: number; total: number; message?: string }) => void;
}

export async function scanCode(host: Host, roots: string[], opts: CodeScanOptions = {}): Promise<CodeScan> {
  const started = Date.now();
  const progress = opts.onProgress ?? (() => {});
  const notes: string[] = [];
  const client = opts.osv ?? new OsvClient({ cacheDir: opts.cacheDir });
  progress({ phase: "code", done: 0, total: 1, message: "Looking for code projects" });
  const found = await findProjects(host, roots);
  if (found.truncated) notes.push("There were a lot of folders, so Bulwark stopped looking after 300 projects. Point it at a smaller folder to check the rest.");

  const all: DepUse[] = [];
  for (const p of found.projects) {
    const r = await readProject(host, p);
    all.push(...r.uses);
    notes.push(...r.notes);
  }

  const queries = new Map<string, PackageQuery>();
  for (const u of all) queries.set(queryKey(u.kind.ecosystem, u.dep.name, u.dep.version), { ecosystem: u.kind.ecosystem, name: u.dep.name, version: u.dep.version });
  const keys = [...queries.keys()];
  progress({ phase: "code", done: 0, total: 1, message: `Looking up ${keys.length} package versions on osv.dev` });
  const idsByKey = new Map<string, string[]>();
  let online = true;
  try {
    const ids = await client.queryBatch(keys.map((k) => queries.get(k)!));
    keys.forEach((k, i) => idsByKey.set(k, ids[i]));
  } catch (err) {
    online = false;
    notes.push(`${err instanceof Error ? err.message : String(err)} Dependency vulnerabilities couldn't be checked.`);
  }
  const details = await client.getVulns([...idsByKey.values()].flat());

  const tools = new Map<string, boolean>();
  const hasTool = async (manager: string, dir: string) => {
    if (manager === "pip") return true;
    const k = `${manager}:${dir}`;
    if (!tools.has(k)) tools.set(k, !!(await findTool(host, manager, (await ownerOf(host, dir))?.home)));
    return tools.get(k)!;
  };

  const findings: Finding[] = [];
  const projects: CodeProject[] = [];
  for (const p of found.projects) {
    const uses = all.filter((u) => u.project === p.dir);
    const byKey = new Map<string, DepUse[]>();
    for (const u of uses) {
      const k = queryKey(u.kind.ecosystem, u.dep.name, u.dep.version);
      byKey.set(k, [...(byKey.get(k) ?? []), u]);
    }
    let vulnerable = 0;
    for (const [k, list] of byKey) {
      const ids = idsByKey.get(k) ?? [];
      if (!ids.length) continue;
      const q = queries.get(k)!;
      const groups = groupVulns(ids, details, q);
      if (!groups.length) continue;
      vulnerable++;
      findings.push(buildFinding(p.dir, list, groups, q.ecosystem, await hasTool(list[0].kind.manager, p.dir)));
    }
    projects.push({
      path: p.dir,
      name: path.basename(p.dir),
      files: p.files,
      ecosystems: [...new Set(uses.map((u) => u.kind.ecosystem))],
      packages: byKey.size,
      vulnerable,
    });
  }
  progress({ phase: "code", done: 1, total: 1 });
  return { roots, projects, findings: sortFindings(findings), notes, online, durationMs: Date.now() - started };
}

// ── running tools as the project's owner ──

export async function ownerOf(host: Host, dir: string): Promise<RunAs | undefined> {
  if (host.platform === "win32") return undefined;
  const st = await host.stat(dir);
  if (!st) return undefined;
  const passwd = (await host.readFile("/etc/passwd")) ?? "";
  const entry = passwd.split("\n").map((l) => l.split(":")).find((f) => Number(f[2]) === st.uid && f.length >= 7);
  let user = entry?.[0];
  let home = entry?.[5];
  if (!user && host.platform === "darwin") {
    const r = await host.exec("id", ["-nu", String(st.uid)]);
    if (r.code === 0) {
      user = r.stdout.trim();
      home = `/Users/${user}`;
    }
  }
  return { uid: st.uid, gid: st.gid, user, home };
}

export async function findTool(host: Host, manager: string, home?: string): Promise<string | null> {
  const name = TOOL[manager];
  if (!name) return null;
  const found = await host.which(name);
  if (found) return found;
  for (const dir of [...userToolDirs(home), "/usr/local/bin", "/opt/homebrew/bin", "/usr/local/go/bin", path.dirname(process.execPath)]) {
    const p = path.join(dir, name);
    if (await host.stat(p)) return p;
  }
  return null;
}

// ── fixes ──

interface DepTarget {
  dir: string;
  file: string;
  manager: string;
  packages: { name: string; version: string; fixed?: string; direct?: boolean }[];
}

function targetsOf(params: Record<string, unknown>): DepTarget[] {
  const list = Array.isArray(params.targets) ? (params.targets as DepTarget[]) : [];
  return list
    .filter((t) => t && typeof t.dir === "string" && path.isAbsolute(t.dir) && typeof t.file === "string" && lockfileKind(t.file) && !t.file.includes("/") && Array.isArray(t.packages))
    .map((t) => ({
      dir: path.resolve(t.dir),
      file: t.file,
      manager: String(t.manager),
      packages: t.packages
        .filter((p) => p && typeof p.name === "string" && /^[@\w./:-]+$/.test(p.name) && typeof p.version === "string")
        .map((p) => ({ name: p.name, version: String(p.version), fixed: typeof p.fixed === "string" && /^[\w.+-]+$/.test(p.fixed) ? p.fixed : undefined, direct: !!p.direct })),
    }));
}

function mergeTargets(all: Record<string, unknown>[]): Record<string, unknown> {
  const map = new Map<string, DepTarget>();
  for (const t of all.flatMap(targetsOf)) {
    const k = `${t.dir}\u0000${t.file}`;
    const cur = map.get(k);
    if (!cur) map.set(k, { ...t, packages: [...t.packages] });
    else for (const p of t.packages) if (!cur.packages.some((x) => x.name === p.name && x.version === p.version)) cur.packages.push(p);
  }
  return { targets: [...map.values()] };
}

const TRACKED: Record<string, string[]> = {
  npm: ["package.json", "package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"],
  poetry: ["pyproject.toml", "poetry.lock"],
  uv: ["pyproject.toml", "uv.lock"],
  cargo: ["Cargo.toml", "Cargo.lock"],
  go: ["go.mod", "go.sum"],
  bundler: ["Gemfile", "Gemfile.lock"],
  composer: ["composer.json", "composer.lock"],
};

function commandsFor(manager: string, t: DepTarget): { args: string[]; title: string; okCodes?: number[] }[] {
  const names = [...new Set(t.packages.map((p) => p.name))];
  switch (manager) {
    case "npm":
      return [{ args: ["audit", "fix", "--package-lock-only", "--no-fund"], title: "Update vulnerable npm packages within their allowed versions (npm audit fix)", okCodes: [0, 1] }];
    case "pnpm":
      return [
        { args: ["audit", "--fix"], title: "Pin fixed versions of vulnerable packages (pnpm audit --fix)", okCodes: [0, 1] },
        { args: ["install", "--lockfile-only"], title: "Update pnpm-lock.yaml" },
      ];
    case "poetry":
      return [{ args: ["update", "--lock", ...names], title: `Update ${names.join(", ")} in poetry.lock` }];
    case "uv":
      return [{ args: ["lock", ...names.flatMap((n) => ["--upgrade-package", n])], title: `Update ${names.join(", ")} in uv.lock` }];
    case "cargo":
      return [{ args: ["update", ...t.packages.map((p) => `${p.name}@${p.version}`)], title: `Update ${names.join(", ")} in Cargo.lock` }];
    case "go":
      return [
        ...t.packages.filter((p) => p.fixed).map((p) => ({ args: ["get", `${p.name}@v${p.fixed}`], title: `Require ${p.name} v${p.fixed}` })),
        { args: ["mod", "tidy"], title: "Tidy go.mod and go.sum" },
      ];
    case "bundler":
      // The gem names must follow --update directly.
      return [{ args: ["lock", "--conservative", "--update", ...names], title: `Update ${names.join(", ")} in Gemfile.lock` }];
    case "composer":
      return [{ args: ["update", ...names, "--with-dependencies", "--no-install", "--no-interaction", "--no-scripts"], title: `Update ${names.join(", ")} in composer.lock` }];
    default:
      return [];
  }
}

const INSTALL_HINT: Record<string, string> = {
  npm: "Run npm install in the project to install the updated packages.",
  pnpm: "Run pnpm install in the project to install the updated packages.",
  pip: "Run pip install -r with the updated file in the project's environment.",
  poetry: "Run poetry install to install the updated packages.",
  uv: "Run uv sync to install the updated packages.",
  cargo: "The next cargo build uses the updated crates.",
  go: "The next go build uses the updated modules.",
  bundler: "Run bundle install to install the updated gems.",
  composer: "Run composer install to install the updated packages.",
};

export function setRequirementPins(text: string, pins: { name: string; from: string; to: string }[]): string {
  const lines = text.split("\n");
  const want = new Map(pins.map((p) => [normalizePyName(p.name), p]));
  for (const d of parseRequirements(text).deps) {
    const pin = want.get(d.name);
    if (!pin || d.version !== pin.from || !d.line) continue;
    lines[d.line - 1] = lines[d.line - 1].replace(/(===?\s*)([A-Za-z0-9.+!_-]+)/, `$1${pin.to}`);
  }
  return lines.join("\n");
}

function depFix(manager: string): Fix {
  return {
    id: `deps.${manager}`,
    title: (p) => {
      const ts = targetsOf(p);
      const n = ts.reduce((a, t) => a + t.packages.length, 0);
      const where = ts.length === 1 ? ` in ${displayPath(ts[0].dir)}` : ` in ${ts.length} projects`;
      return `Update ${n === 1 ? ts[0]?.packages[0]?.name ?? "a package" : `${n} vulnerable packages`}${where}`;
    },
    needsRoot: false,
    risk: "caution",
    reversible: true,
    merge: mergeTargets,
    async preconditions({ host, params }: FixContext) {
      const out = [];
      for (const t of targetsOf(params)) {
        const lock = path.join(t.dir, t.file);
        if (!(await host.stat(lock))) {
          out.push({ ok: false, message: `${displayPath(lock)} isn't there any more.` });
          continue;
        }
        if (manager !== "pip") {
          const owner = await ownerOf(host, t.dir);
          const tool = await findTool(host, manager, owner?.home);
          out.push({ ok: !!tool, message: tool ? `${TOOL[manager]} is installed (${tool}).` : `${TOOL[manager]} isn't installed, so this has to be done by hand.` });
        }
      }
      return out;
    },
    async warnings({ params }: FixContext) {
      const w = ["Newer versions can change behaviour. Run your tests after this, and undo it if something breaks."];
      w.push(INSTALL_HINT[manager] ?? "");
      if (manager === "npm") w.push("npm only moves packages within the version ranges in package.json; anything that needs a major upgrade stays listed, with the command to do it.");
      if (targetsOf(params).some((t) => t.packages.some((p) => !p.fixed))) w.push("Some of these have no fixed version yet; they stay listed.");
      // Pinned files jump straight to the fixed version, which can be a new major version.
      if (manager === "pip" || manager === "go") {
        const major = (v: string) => Number(v.replace(/^v/, "").split(/[.+-]/)[0]);
        const jumps = targetsOf(params).flatMap((t) => t.packages.filter((p) => p.fixed && major(p.fixed) > major(p.version)).map((p) => `${p.name} ${p.version} → ${p.fixed}`));
        if (jumps.length) w.unshift(`New major version${jumps.length === 1 ? "" : "s"}: ${jumps.join(", ")}. Major versions can change how a package works, so test your app before shipping this.`);
      }
      return w.filter(Boolean);
    },
    async apply(tx: TxApi, { host, params }: FixContext) {
      for (const t of targetsOf(params)) {
        const lock = path.join(t.dir, t.file);
        const st = await host.stat(t.dir);
        if (!st?.isDir || !(await host.stat(lock))) throw new Error(`${displayPath(lock)} isn't there any more.`);
        if (manager === "pip") {
          const text = (await host.readFile(lock)) ?? "";
          const pins = t.packages.filter((p) => p.fixed).map((p) => ({ name: p.name, from: p.version, to: p.fixed! }));
          await tx.writeFile(lock, setRequirementPins(text, pins), { title: `Pin fixed versions in ${displayPath(lock)}` });
          continue;
        }
        const runAs = host.isRoot ? await ownerOf(host, t.dir) : undefined;
        const tool = await findTool(host, manager, runAs?.home);
        if (!tool) throw new Error(`${TOOL[manager]} isn't installed.`);
        const files = (TRACKED[manager] ?? [t.file]).map((f) => path.join(t.dir, f));
        const existing: string[] = [];
        for (const f of files) if (await host.stat(f)) existing.push(path.basename(f));
        await tx.track(files, `Keep copies of ${existing.join(", ")} so this can be undone`, async () => {
          for (const c of commandsFor(manager, t)) {
            await tx.exec(
              { cmd: tool, args: c.args, cwd: t.dir, runAs: runAs && runAs.uid !== 0 ? runAs : undefined, timeoutMs: 900_000, display: `${TOOL[manager]} ${c.args.join(" ")}` },
              { title: c.title, okCodes: c.okCodes, readOnly: true },
            );
          }
        });
      }
    },
  };
}

export const depFixes: Fix[] = [...FIXABLE].map(depFix);

// ── re-checking after a fix ──

/** Which of these vulnerable package versions are still in their lockfiles, and still vulnerable. */
export async function recheckDependencies(host: Host, findings: Finding[], client = new OsvClient()): Promise<{ status: Status; summary: string; remaining: Finding[] }> {
  const remaining: Finding[] = [];
  const parsed = new Map<string, Dependency[]>();
  const stillThere: { f: Finding; q: PackageQuery; newVersions: string[] }[] = [];
  for (const f of findings) {
    const m = f.id.match(/^deps\.vulnerable@(.+)#([^:]+):(.+)@([^@]+)$/);
    const t = f.remedy?.auto ? targetsOf(f.remedy.auto.params)[0] : undefined;
    if (!m || !t) continue;
    const [, dir, ecosystem, name, version] = m;
    const file = path.join(dir, t.file);
    if (!parsed.has(file)) {
      const text = await host.readFile(file);
      const kind = lockfileKind(t.file);
      parsed.set(file, text && kind ? kind.parse(text).deps : []);
    }
    const same = (n: string) => (ecosystem === "PyPI" ? normalizePyName(n) === normalizePyName(name) : n === name);
    const versions = parsed.get(file)!.filter((d) => same(d.name)).map((d) => d.version);
    stillThere.push({ f, q: { ecosystem, name, version }, newVersions: [...new Set(versions)] });
  }
  const queries = stillThere.flatMap((s) => s.newVersions.map((v) => ({ ...s.q, version: v })));
  let vulnerable = new Set<string>();
  try {
    const ids = await client.queryBatch(queries);
    vulnerable = new Set(queries.filter((_, i) => ids[i].length).map((q) => `${q.name}@${q.version}`));
  } catch {
    // Offline: judge by whether the old version is gone.
    vulnerable = new Set(stillThere.filter((s) => s.newVersions.includes(s.q.version)).map((s) => `${s.q.name}@${s.q.version}`));
  }
  const fixedNames: string[] = [];
  for (const s of stillThere) {
    if (s.newVersions.some((v) => vulnerable.has(`${s.q.name}@${v}`))) remaining.push(s.f);
    else fixedNames.push(`${s.q.name} ${s.newVersions.join("/") || "(removed)"}`);
  }
  if (!remaining.length) return { status: "pass", summary: `Checked again: ${fixedNames.join(", ")} ${fixedNames.length === 1 ? "has" : "have"} no known vulnerabilities.`, remaining };
  const left = remaining.map((f) => f.title.split(":")[0]).join(", ");
  return {
    status: "fail",
    summary: fixedNames.length
      ? `Fixed ${fixedNames.join(", ")}. Still vulnerable: ${left}; ${remaining[0].remedy?.steps[0] ?? "see the steps"}.`
      : `The tool ran, but ${left} ${remaining.length === 1 ? "is" : "are"} still vulnerable (probably because the fix needs a major upgrade). ${remaining[0].remedy?.steps[0] ?? ""}`,
    remaining,
  };
}

/** Drops findings whose vulnerable version is no longer in the lockfile. */
export async function refreshDependencyFindings(host: Host, findings: Finding[]): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const f of findings) {
    const m = f.id.match(/^deps\.vulnerable@(.+)#([^:]+):(.+)@([^@]+)$/);
    const t = f.remedy?.auto ? targetsOf(f.remedy.auto.params)[0] : undefined;
    if (!m || !t) {
      out.push(f);
      continue;
    }
    const text = await host.readFile(path.join(m[1], t.file));
    const kind = lockfileKind(t.file);
    const deps = text && kind ? kind.parse(text).deps : [];
    const eco = m[2];
    if (deps.some((d) => (eco === "PyPI" ? normalizePyName(d.name) === normalizePyName(m[3]) : d.name === m[3]) && d.version === m[4])) out.push(f);
  }
  return out;
}

