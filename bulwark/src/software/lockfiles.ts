// Readers for lockfiles and pinned requirement files: which exact package versions a project uses.

export interface Dependency {
  name: string;
  version: string;
  dev?: boolean;
  direct?: boolean;
  /** Line number, for files Bulwark edits itself (requirements.txt). */
  line?: number;
}

export interface LockfileKind {
  /** OSV ecosystem name. */
  ecosystem: string;
  /** The tool that owns this file. */
  manager: "npm" | "yarn" | "pnpm" | "pip" | "poetry" | "uv" | "pipenv" | "cargo" | "go" | "bundler" | "composer" | "dotnet" | "gradle";
  parse(text: string): { deps: Dependency[]; notes: string[] };
}

const isRealVersion = (v: unknown): v is string => typeof v === "string" && /^v?\d/.test(v) && !/use\.local/.test(v);

// ── npm ──

interface NpmLockEntry {
  version?: string;
  name?: string;
  dev?: boolean;
  devOptional?: boolean;
  link?: boolean;
  dependencies?: Record<string, NpmLockEntry | string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

export function parsePackageLock(text: string): { deps: Dependency[]; notes: string[] } {
  const j = JSON.parse(text) as { packages?: Record<string, NpmLockEntry>; dependencies?: Record<string, NpmLockEntry> };
  const deps: Dependency[] = [];
  if (j.packages) {
    const root = j.packages[""] ?? {};
    const direct = new Set([...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {}), ...Object.keys(root.optionalDependencies ?? {})]);
    for (const [key, v] of Object.entries(j.packages)) {
      if (!key || v.link) continue;
      const idx = key.lastIndexOf("node_modules/");
      if (idx === -1) continue; // a workspace folder; its packages appear under node_modules
      const name = v.name ?? key.slice(idx + "node_modules/".length);
      if (!isRealVersion(v.version)) continue;
      deps.push({ name, version: v.version, dev: !!(v.dev || v.devOptional), direct: idx === 0 && direct.has(name) });
    }
  } else if (j.dependencies) {
    const walk = (tree: Record<string, NpmLockEntry | string>, depth: number) => {
      for (const [name, v] of Object.entries(tree)) {
        if (typeof v === "string") continue;
        if (isRealVersion(v.version)) deps.push({ name, version: v.version, dev: !!v.dev, direct: depth === 0 });
        if (v.dependencies) walk(v.dependencies, depth + 1);
      }
    };
    walk(j.dependencies, 0);
  }
  return { deps, notes: [] };
}

export function parseYarnLock(text: string): { deps: Dependency[]; notes: string[] } {
  const deps: Dependency[] = [];
  let spec: string | null = null;
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      const first = line.replace(/:\s*$/, "").split(",")[0].trim().replace(/^"|"$/g, "");
      spec = first.startsWith("__metadata") || first.includes("@patch:") || first.includes("@workspace:") ? null : first;
      continue;
    }
    const m = line.match(/^\s+version:?\s+"?([^"\s]+)"?\s*$/);
    if (m && spec) {
      const at = spec.lastIndexOf("@");
      const name = at > 0 ? spec.slice(0, at) : spec;
      if (isRealVersion(m[1])) deps.push({ name: name.replace(/@npm$/, ""), version: m[1] });
      spec = null;
    }
  }
  return { deps, notes: [] };
}

export function parsePnpmLock(text: string): { deps: Dependency[]; notes: string[] } {
  const deps: Dependency[] = [];
  let inPackages = false;
  let last: Dependency | null = null;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      last = null;
      continue;
    }
    if (!inPackages) continue;
    const entry = line.match(/^ {2}(['"]?)(\S.*?)\1:\s*$/);
    if (entry) {
      const key = entry[2].replace(/^\//, "").replace(/\(.*\)$/, "");
      const v6 = key.match(/^(@?[^@]+)@([^@]+)$/);
      const v5 = key.match(/^(@[^/]+\/[^/]+|[^/@]+)\/(\d[^/]*)$/);
      const m = v6 ?? v5;
      last = m && isRealVersion(m[2]) ? { name: m[1], version: m[2] } : null;
      if (last) deps.push(last);
      continue;
    }
    if (last && /^ {4}dev: true/.test(line)) last.dev = true;
  }
  return { deps, notes: [] };
}

// ── Python ──

export function normalizePyName(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

export function parseRequirements(text: string): { deps: Dependency[]; notes: string[] } {
  const deps: Dependency[] = [];
  let unpinned = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+#.*$/, "").replace(/^#.*$/, "").trim();
    if (!line || line.startsWith("-") || /^[a-z]+\+?[a-z]*:\/\//i.test(line) || line.startsWith(".") || line.startsWith("/")) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?\s*===?\s*([A-Za-z0-9.+!_-]+)/);
    if (m) deps.push({ name: normalizePyName(m[1]), version: m[3], direct: true, line: i + 1 });
    else if (/^[A-Za-z0-9]/.test(line)) unpinned++;
  }
  return { deps, notes: unpinned ? [`${unpinned} requirement${unpinned === 1 ? " isn't" : "s aren't"} pinned to an exact version (==), so ${unpinned === 1 ? "its version" : "their versions"} can't be checked.`] : [] };
}

/** `[[package]]` tables with name and version (poetry.lock, uv.lock, Cargo.lock). */
function parseTomlPackages(text: string, keep: (block: string) => boolean, normalize = (n: string) => n): Dependency[] {
  const deps: Dependency[] = [];
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const head = block.split(/^\[/m)[0];
    const name = head.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = head.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    if (name && isRealVersion(version) && keep(head)) deps.push({ name: normalize(name), version, dev: /^category\s*=\s*"dev"/m.test(head) || undefined });
  }
  return deps;
}

export function parsePoetryLock(text: string) {
  return { deps: parseTomlPackages(text, () => true, normalizePyName), notes: [] };
}

export function parseUvLock(text: string) {
  // The project itself appears as an editable or virtual package.
  return { deps: parseTomlPackages(text, (h) => !/^source\s*=\s*\{\s*(editable|virtual)\s*=/m.test(h), normalizePyName), notes: [] };
}

export function parsePipfileLock(text: string) {
  const j = JSON.parse(text) as Record<string, Record<string, { version?: string }>>;
  const deps: Dependency[] = [];
  for (const [section, dev] of [["default", false], ["develop", true]] as const) {
    for (const [name, v] of Object.entries(j[section] ?? {})) {
      const version = v.version?.replace(/^==/, "");
      if (isRealVersion(version)) deps.push({ name: normalizePyName(name), version, dev });
    }
  }
  return { deps, notes: [] };
}

// ── others ──

export function parseCargoLock(text: string) {
  // Crates without a source are the workspace's own.
  return { deps: parseTomlPackages(text, (h) => /^source\s*=\s*"registry\+/m.test(h)), notes: [] };
}

export function parseGoMod(text: string) {
  const deps: Dependency[] = [];
  const add = (line: string) => {
    const m = line.trim().match(/^(\S+)\s+(v\d\S*)(\s*\/\/\s*indirect)?/);
    if (m) deps.push({ name: m[1], version: m[2].replace(/^v/, ""), direct: !m[3] });
  };
  let inBlock = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\/\/(?!\s*indirect).*$/, "");
    if (/^\s*require\s*\(\s*$/.test(line)) inBlock = true;
    else if (inBlock && /^\s*\)\s*$/.test(line)) inBlock = false;
    else if (inBlock) add(line);
    else if (/^\s*require\s+\S/.test(line)) add(line.replace(/^\s*require\s+/, ""));
  }
  const notes = /^\s*replace\s/m.test(text) ? ["go.mod has replace directives; replaced modules are checked at their original versions."] : [];
  return { deps, notes };
}

export function parseGemfileLock(text: string) {
  const deps: Dependency[] = [];
  let section = "";
  let inSpecs = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      section = line.trim();
      inSpecs = false;
      continue;
    }
    if (/^ {2}specs:/.test(line)) {
      inSpecs = section === "GEM";
      continue;
    }
    const m = inSpecs ? line.match(/^ {4}([^\s(]+) \(([^)]+)\)/) : null;
    if (m) {
      const version = m[2].replace(/-[a-z].*$/i, ""); // drop the platform: 1.15.4-x86_64-linux
      if (isRealVersion(version)) deps.push({ name: m[1], version });
    }
  }
  return { deps, notes: [] };
}

export function parseComposerLock(text: string) {
  const j = JSON.parse(text) as { packages?: { name: string; version: string }[]; "packages-dev"?: { name: string; version: string }[] };
  const deps: Dependency[] = [];
  for (const [list, dev] of [[j.packages ?? [], false], [j["packages-dev"] ?? [], true]] as const) {
    for (const p of list) {
      const version = p.version?.replace(/^v/, "");
      if (isRealVersion(version)) deps.push({ name: p.name, version, dev });
    }
  }
  return { deps, notes: [] };
}

export function parseNugetLock(text: string) {
  const j = JSON.parse(text) as { dependencies?: Record<string, Record<string, { type?: string; resolved?: string }>> };
  const deps: Dependency[] = [];
  for (const framework of Object.values(j.dependencies ?? {})) {
    for (const [name, v] of Object.entries(framework)) {
      if (v.type !== "Project" && isRealVersion(v.resolved)) deps.push({ name, version: v.resolved, direct: v.type === "Direct" });
    }
  }
  return { deps, notes: [] };
}

export function parseGradleLock(text: string) {
  const deps: Dependency[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^([\w.-]+):([\w.-]+):([^=\s]+)=/);
    if (m && isRealVersion(m[3])) deps.push({ name: `${m[1]}:${m[2]}`, version: m[3] });
  }
  return { deps, notes: [] };
}

export const LOCKFILES: Record<string, LockfileKind> = {
  "package-lock.json": { ecosystem: "npm", manager: "npm", parse: parsePackageLock },
  "npm-shrinkwrap.json": { ecosystem: "npm", manager: "npm", parse: parsePackageLock },
  "yarn.lock": { ecosystem: "npm", manager: "yarn", parse: parseYarnLock },
  "pnpm-lock.yaml": { ecosystem: "npm", manager: "pnpm", parse: parsePnpmLock },
  "poetry.lock": { ecosystem: "PyPI", manager: "poetry", parse: parsePoetryLock },
  "uv.lock": { ecosystem: "PyPI", manager: "uv", parse: parseUvLock },
  "Pipfile.lock": { ecosystem: "PyPI", manager: "pipenv", parse: parsePipfileLock },
  "Cargo.lock": { ecosystem: "crates.io", manager: "cargo", parse: parseCargoLock },
  "go.mod": { ecosystem: "Go", manager: "go", parse: parseGoMod },
  "Gemfile.lock": { ecosystem: "RubyGems", manager: "bundler", parse: parseGemfileLock },
  "composer.lock": { ecosystem: "Packagist", manager: "composer", parse: parseComposerLock },
  "packages.lock.json": { ecosystem: "NuGet", manager: "dotnet", parse: parseNugetLock },
  "gradle.lockfile": { ecosystem: "Maven", manager: "gradle", parse: parseGradleLock },
};

const REQUIREMENTS: LockfileKind = { ecosystem: "PyPI", manager: "pip", parse: parseRequirements };

export function lockfileKind(fileName: string): LockfileKind | null {
  if (LOCKFILES[fileName]) return LOCKFILES[fileName];
  if (/^requirements([-_.][\w.-]+)?\.txt$/i.test(fileName)) return REQUIREMENTS;
  return null;
}
