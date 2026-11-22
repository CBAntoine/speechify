// Every fix changes the system through a Tx. In a dry run the Tx only records what would happen,
// which is how plans are built. For real, it performs each step and keeps what it needs to undo it.

import { unifiedDiff } from "./diff.ts";
import type { ActionRecord, ExecResult, ExecSpec, Host, NetworkAction, PlanStep, TxApi } from "./types.ts";
import { displayCommand, errorMessage, octal, sha256 } from "./util.ts";

export type NetworkExecutor = (action: NetworkAction) => Promise<void>;
export type NetworkUndoer = (action: NetworkAction) => Promise<void>;

export class Tx implements TxApi {
  readonly dryRun: boolean;
  readonly steps: PlanStep[] = [];
  readonly actions: ActionRecord[] = [];
  readonly log: string[] = [];
  private host: Host;
  private net?: NetworkExecutor;

  constructor(host: Host, opts: { dryRun: boolean; network?: NetworkExecutor }) {
    this.host = host;
    this.dryRun = opts.dryRun;
    this.net = opts.network;
  }

  note(title: string, detail?: string): void {
    this.steps.push({ kind: "note", title, detail });
  }

  async writeFile(path: string, content: string, opts: { mode?: number; title?: string } = {}): Promise<void> {
    const before = await this.host.readFile(path);
    const st = before === null ? null : await this.host.stat(path);
    if (before === null && (await this.host.stat(path))) {
      throw new Error(`Can't read ${path}, so it can't be backed up before changing it.`);
    }
    const diff = unifiedDiff(before, content, path);
    const modeChange = opts.mode !== undefined && st && st.mode !== opts.mode ? ` (permissions ${octal(st.mode)} → ${octal(opts.mode)})` : "";
    this.steps.push({
      kind: "file",
      title: opts.title ?? (before === null ? `Create ${path}` : `Edit ${path}${modeChange}`),
      detail: diff || "(no change to the content)",
    });
    if (this.dryRun) return;
    await this.host.writeFile(path, content, opts.mode ?? (before === null ? 0o644 : undefined));
    this.actions.push({
      type: "write",
      path,
      existed: before !== null,
      backup: before === null ? undefined : Buffer.from(before, "utf8").toString("base64"),
      prevMode: st?.mode,
      newMode: opts.mode,
      newHash: sha256(content),
    });
    this.log.push(`Wrote ${path}`);
  }

  async removeFile(path: string, opts: { title?: string } = {}): Promise<void> {
    const before = await this.host.readFile(path);
    if (before === null) return;
    const st = await this.host.stat(path);
    this.steps.push({ kind: "file", title: opts.title ?? `Remove ${path}`, detail: `(a backup is kept so this can be undone)` });
    if (this.dryRun) return;
    await this.host.remove(path);
    this.actions.push({
      type: "remove",
      path,
      backup: Buffer.from(before, "utf8").toString("base64"),
      prevMode: st?.mode ?? 0o600,
      prevHash: sha256(before),
    });
    this.log.push(`Removed ${path}`);
  }

  async chmod(path: string, mode: number, opts: { title?: string } = {}): Promise<void> {
    const st = await this.host.stat(path);
    if (!st) throw new Error(`${path} doesn't exist.`);
    if (st.mode === mode) return;
    this.steps.push({ kind: "permission", title: opts.title ?? `Change permissions of ${path}`, detail: `${octal(st.mode)} → ${octal(mode)}` });
    if (this.dryRun) return;
    await this.host.chmod(path, mode);
    this.actions.push({ type: "chmod", path, prevMode: st.mode, newMode: mode });
    this.log.push(`chmod ${octal(mode)} ${path}`);
  }

  async exec(
    spec: ExecSpec,
    opts: { title: string; undo?: ExecSpec | null; rerunOnRollback?: boolean; okCodes?: number[]; readOnly?: boolean },
  ): Promise<ExecResult> {
    this.steps.push({ kind: "command", title: opts.title, detail: displayCommand(spec) });
    if (this.dryRun) return { code: 0, stdout: "", stderr: "" };
    const r = await this.host.exec(spec.cmd, spec.args, { env: spec.env, timeoutMs: spec.timeoutMs ?? 120_000 });
    const ok = (opts.okCodes ?? [0]).includes(r.code);
    this.log.push(`$ ${displayCommand(spec)} → exit ${r.code}`);
    if (!ok) {
      const output = (r.stderr || r.stdout).trim().split("\n").slice(-6).join("\n");
      throw new Error(`"${opts.title}" failed (exit ${r.code})${output ? `: ${output}` : ""}`);
    }
    // Read-only steps (config tests) are shown in plans but have nothing to undo.
    if (!opts.readOnly) this.actions.push({ type: "exec", title: opts.title, spec, undo: opts.undo ?? null, rerunOnRollback: opts.rerunOnRollback });
    return r;
  }

  async network(action: NetworkAction, opts: { title: string; detail?: string }): Promise<void> {
    this.steps.push({ kind: "network", title: opts.title, detail: opts.detail });
    if (this.dryRun) return;
    if (!this.net) throw new Error("Network changes aren't available here.");
    await this.net(action);
    this.actions.push({ type: "network", title: opts.title, action });
    this.log.push(opts.title);
  }
}

export interface RollbackResult {
  ok: boolean;
  errors: string[];
  log: string[];
}

/**
 * Undoes recorded actions, newest first. Service reloads marked rerunOnRollback run again at the
 * very end, after every file is back, so services pick up the restored configuration.
 * Unless `force` is set, files that changed since the fix wrote them are left alone.
 */
export async function rollbackActions(
  host: Host,
  actions: ActionRecord[],
  opts: { force?: boolean; networkUndo?: NetworkUndoer } = {},
): Promise<RollbackResult> {
  const errors: string[] = [];
  const log: string[] = [];
  const reruns: ExecSpec[] = [];

  if (!opts.force) {
    for (const a of actions) {
      if (a.type === "write") {
        const now = await host.readFile(a.path);
        if (now !== null && sha256(now) !== a.newHash) {
          return {
            ok: false,
            errors: [`${a.path} was changed after the fix was applied. Undoing would overwrite those changes; use --force to undo anyway.`],
            log,
          };
        }
      }
    }
  }

  for (const a of [...actions].reverse()) {
    try {
      switch (a.type) {
        case "write": {
          if (a.existed && a.backup !== undefined) {
            await host.writeFile(a.path, Buffer.from(a.backup, "base64").toString("utf8"));
            if (a.prevMode !== undefined) await host.chmod(a.path, a.prevMode);
            log.push(`Restored ${a.path}`);
          } else {
            await host.remove(a.path);
            log.push(`Removed ${a.path}`);
          }
          break;
        }
        case "remove": {
          await host.writeFile(a.path, Buffer.from(a.backup, "base64").toString("utf8"), a.prevMode);
          await host.chmod(a.path, a.prevMode);
          log.push(`Restored ${a.path}`);
          break;
        }
        case "chmod": {
          await host.chmod(a.path, a.prevMode);
          log.push(`chmod ${octal(a.prevMode)} ${a.path}`);
          break;
        }
        case "exec": {
          if (a.rerunOnRollback) {
            reruns.unshift(a.spec);
          } else if (a.undo) {
            const r = await host.exec(a.undo.cmd, a.undo.args, { env: a.undo.env, timeoutMs: a.undo.timeoutMs ?? 120_000 });
            log.push(`$ ${displayCommand(a.undo)} → exit ${r.code}`);
            if (r.code !== 0) errors.push(`Undo of "${a.title}" failed: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`);
          } else {
            log.push(`"${a.title}" can't be undone automatically.`);
          }
          break;
        }
        case "network": {
          if (!opts.networkUndo) throw new Error("Network undo isn't available here.");
          await opts.networkUndo(a.action);
          log.push(`Undid: ${a.title}`);
          break;
        }
      }
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }

  for (const spec of reruns) {
    const r = await host.exec(spec.cmd, spec.args, { env: spec.env, timeoutMs: spec.timeoutMs ?? 120_000 });
    log.push(`$ ${displayCommand(spec)} → exit ${r.code}`);
    if (r.code !== 0) errors.push(`"${displayCommand(spec)}" failed after undo: ${(r.stderr || r.stdout).trim().split("\n").pop() ?? ""}`);
  }

  return { ok: errors.length === 0, errors, log };
}
