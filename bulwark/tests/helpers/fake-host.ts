// An in-memory machine for tests: files, permissions and commands, with nothing real touched.

import type { ExecResult, FileStat, Host, Platform } from "../../src/core/types.ts";

interface FakeFile {
  content: string;
  mode: number;
  uid: number;
  gid: number;
  mtimeMs: number;
}

export type ExecHandler = (cmd: string, args: string[], input?: string) => ExecResult | undefined;

export class FakeHost implements Host {
  platform: Platform;
  isRoot: boolean;
  hostname = "testbox";
  env: Record<string, string | undefined> = {};
  files = new Map<string, FakeFile>();
  dirs = new Set<string>(["/"]);
  links = new Map<string, string>();
  commands = new Set<string>();
  execs: { cmd: string; args: string[] }[] = [];
  private handlers: ExecHandler[] = [];

  constructor(opts: { platform?: Platform; isRoot?: boolean } = {}) {
    this.platform = opts.platform ?? "linux";
    this.isRoot = opts.isRoot ?? true;
  }

  file(path: string, content: string, mode = 0o644, owner: [number, number] = [0, 0]): this {
    this.files.set(path, { content, mode, uid: owner[0], gid: owner[1], mtimeMs: Date.now() });
    this.addParents(path);
    return this;
  }

  dir(path: string, mode = 0o755): this {
    this.dirs.add(path);
    this.dirModes.set(path, mode);
    this.addParents(path);
    return this;
  }

  link(path: string, target: string): this {
    this.links.set(path, target);
    this.addParents(path);
    return this;
  }

  on(handler: ExecHandler): this {
    this.handlers.push(handler);
    return this;
  }

  /** Makes `cmd` exist and answer with `result` (or a function of its args). */
  command(cmd: string, result?: Partial<ExecResult> | ((args: string[], input?: string) => Partial<ExecResult> | undefined)): this {
    this.commands.add(cmd);
    if (result !== undefined) {
      this.on((c, args, input) => {
        if (c !== cmd && !c.endsWith(`/${cmd}`)) return undefined;
        const r = typeof result === "function" ? result(args, input) : result;
        return r ? { code: 0, stdout: "", stderr: "", ...r } : undefined;
      });
    }
    return this;
  }

  private dirModes = new Map<string, number>();

  private addParents(path: string): void {
    const parts = path.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) this.dirs.add("/" + parts.slice(0, i).join("/"));
  }

  async readFile(p: string): Promise<string | null> {
    const f = this.files.get(p);
    if (!f) return null;
    // Without root, files that others can't read stay unreadable, like on a real system.
    if (!this.isRoot && f.uid === 0 && !(f.mode & 0o004)) return null;
    return f.content;
  }

  async readDir(p: string): Promise<string[] | null> {
    if (!this.dirs.has(p)) return null;
    const prefix = p === "/" ? "/" : p + "/";
    const names = new Set<string>();
    for (const k of [...this.files.keys(), ...this.dirs, ...this.links.keys()]) {
      if (k.startsWith(prefix) && k !== p) {
        const rest = k.slice(prefix.length);
        if (rest && !rest.includes("/")) names.add(rest);
      }
    }
    return [...names].sort();
  }

  private statOf(p: string, follow: boolean): FileStat | null {
    if (this.links.has(p)) {
      if (!follow) return { mode: 0o777, uid: 0, gid: 0, size: 0, mtimeMs: 0, isFile: false, isDir: false, isSymlink: true };
      const t = this.links.get(p)!;
      return this.statOf(t.startsWith("/") ? t : p.slice(0, p.lastIndexOf("/") + 1) + t, true);
    }
    const f = this.files.get(p);
    if (f) return { mode: f.mode, uid: f.uid, gid: f.gid, size: f.content.length, mtimeMs: f.mtimeMs, isFile: true, isDir: false, isSymlink: false };
    if (this.dirs.has(p)) return { mode: this.dirModes.get(p) ?? 0o755, uid: 0, gid: 0, size: 0, mtimeMs: 0, isFile: false, isDir: true, isSymlink: false };
    return null;
  }

  async stat(p: string) {
    return this.statOf(p, true);
  }

  async lstat(p: string) {
    return this.statOf(p, false);
  }

  async readlink(p: string) {
    return this.links.get(p) ?? null;
  }

  async exec(cmd: string, args: string[], opts: { input?: string } = {}): Promise<ExecResult> {
    this.execs.push({ cmd, args });
    for (const h of [...this.handlers].reverse()) {
      const r = h(cmd, args, opts.input);
      if (r) return r;
    }
    const known = this.commands.has(cmd) || [...this.commands].some((c) => cmd.endsWith(`/${c}`));
    return known ? { code: 0, stdout: "", stderr: "" } : { code: 127, stdout: "", stderr: `${cmd}: not found` };
  }

  async which(cmd: string) {
    return this.commands.has(cmd) ? `/usr/bin/${cmd}` : null;
  }

  async writeFile(p: string, content: string, mode?: number) {
    const prev = this.files.get(p);
    this.files.set(p, { content, mode: mode ?? prev?.mode ?? 0o644, uid: prev?.uid ?? 0, gid: prev?.gid ?? 0, mtimeMs: Date.now() });
    this.addParents(p);
  }

  async chmod(p: string, mode: number) {
    const f = this.files.get(p);
    if (f) f.mode = mode;
    else if (this.dirs.has(p)) this.dirModes.set(p, mode);
    else throw new Error(`ENOENT ${p}`);
  }

  async remove(p: string) {
    this.files.delete(p);
  }

  async mkdirp(p: string) {
    this.dir(p);
  }

  ran(cmd: string, ...args: string[]): boolean {
    return this.execs.some((e) => (e.cmd === cmd || e.cmd.endsWith(`/${cmd}`)) && args.every((a, i) => e.args[i] === a));
  }
}
