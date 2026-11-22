// Where Bulwark keeps scans, the change journal and the dashboard token.

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ChangeRecord, Platform, Scan } from "./types.ts";
import { randomId } from "./util.ts";

export function defaultStateDir(platform: Platform, isRoot: boolean, env: Record<string, string | undefined> = process.env): string {
  if (env.BULWARK_HOME) return env.BULWARK_HOME;
  if (platform === "win32") {
    const base = isRoot ? env.ProgramData ?? "C:\\ProgramData" : env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Bulwark");
  }
  if (isRoot) return platform === "darwin" ? "/Library/Application Support/Bulwark" : "/var/lib/bulwark";
  return path.join(os.homedir(), ".bulwark");
}

export class StateStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private async ensure(sub = ""): Promise<string> {
    const p = path.join(this.dir, sub);
    await fs.mkdir(p, { recursive: true, mode: 0o700 });
    return p;
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    const tmp = `${file}.${randomId(4)}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as T;
    } catch {
      return null;
    }
  }

  // ── scans ──

  async saveScan(scan: Scan): Promise<void> {
    const dir = await this.ensure("scans");
    await this.writeJson(path.join(dir, `${scan.id}.json`), scan);
    // Keep the newest 50.
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
    for (const old of files.slice(0, Math.max(0, files.length - 50))) await fs.rm(path.join(dir, old), { force: true });
  }

  async listScans(): Promise<Scan[]> {
    let files: string[] = [];
    try {
      files = (await fs.readdir(path.join(this.dir, "scans"))).filter((f) => f.endsWith(".json")).sort().reverse();
    } catch {
      return [];
    }
    const scans: Scan[] = [];
    for (const f of files) {
      const s = await this.readJson<Scan>(path.join(this.dir, "scans", f));
      if (s) scans.push(s);
    }
    return scans;
  }

  async getScan(id: string): Promise<Scan | null> {
    if (!/^[\w.-]+$/.test(id)) return null;
    return this.readJson<Scan>(path.join(this.dir, "scans", `${id}.json`));
  }

  async latestScan(): Promise<Scan | null> {
    return (await this.listScans())[0] ?? null;
  }

  // ── changes ──

  async saveChange(change: ChangeRecord): Promise<void> {
    const dir = await this.ensure("changes");
    await this.writeJson(path.join(dir, `${change.id}.json`), change);
  }

  async getChange(id: string): Promise<ChangeRecord | null> {
    if (!/^[\w.-]+$/.test(id)) return null;
    return this.readJson<ChangeRecord>(path.join(this.dir, "changes", `${id}.json`));
  }

  async listChanges(): Promise<ChangeRecord[]> {
    let files: string[] = [];
    try {
      files = (await fs.readdir(path.join(this.dir, "changes"))).filter((f) => f.endsWith(".json")).sort().reverse();
    } catch {
      return [];
    }
    const out: ChangeRecord[] = [];
    for (const f of files) {
      const c = await this.readJson<ChangeRecord>(path.join(this.dir, "changes", f));
      if (c) out.push(c);
    }
    return out;
  }

  // ── dashboard token ──

  /** A long random token the dashboard requires on every API call. Kept so the same link keeps working. */
  async token(): Promise<string> {
    await this.ensure();
    const file = path.join(this.dir, "dashboard-token");
    try {
      const t = (await fs.readFile(file, "utf8")).trim();
      if (/^[a-f0-9]{48}$/.test(t)) return t;
    } catch {
      /* make one */
    }
    const t = randomId(24);
    await fs.writeFile(file, t + "\n", { mode: 0o600 });
    return t;
  }

  // ── networks the person said are theirs ──

  async confirmedNetworks(): Promise<string[]> {
    return (await this.readJson<string[]>(path.join(this.dir, "networks.json"))) ?? [];
  }

  async confirmNetwork(key: string): Promise<void> {
    await this.ensure();
    const list = new Set(await this.confirmedNetworks());
    list.add(key);
    await this.writeJson(path.join(this.dir, "networks.json"), [...list]);
  }
}
