// Plans, applies, verifies and undoes fixes. Fix parameters always come from Bulwark's own saved
// scan, never from whoever is asking, so a request can only choose *which* finding to fix.

import { FIXES, getCheck } from "../checks/index.ts";
import { outcomeToFinding } from "./audit.ts";
import { performNetworkAction, undoNetworkAction } from "../net/scan.ts";
import { clearHostCache } from "./cache.ts";
import type { StateStore } from "./state.ts";
import { rollbackActions, Tx } from "./tx.ts";
import type { ChangeRecord, CheckOutcome, Finding, Fix, FixPlan, Host, Precondition, Status } from "./types.ts";
import { errorMessage, randomId, stamp } from "./util.ts";

export class FixError extends Error {}

function fixFor(findings: Finding[]): { fix: Fix; params: Record<string, unknown> } {
  if (!findings.length) throw new FixError("Nothing to fix.");
  const ids = new Set(findings.map((f) => f.remedy?.auto?.fixId));
  if (ids.size !== 1 || ids.has(undefined)) throw new FixError("These findings don't share an automatic fix.");
  const fix = FIXES.get([...ids][0]!);
  if (!fix) throw new FixError(`Unknown fix ${[...ids][0]}.`);
  const all = findings.map((f) => f.remedy!.auto!.params);
  if (all.length > 1 && !fix.merge) throw new FixError(`${fix.id} fixes one finding at a time.`);
  return { fix, params: all.length > 1 ? fix.merge!(all) : all[0] };
}

export async function planFix(host: Host, findings: Finding[]): Promise<FixPlan> {
  const { fix, params } = fixFor(findings);
  const ctx = { host, params };
  let preconditions: Precondition[] = [];
  let warnings: string[] = [];
  let blockedReason: string | undefined;
  try {
    preconditions = (await fix.preconditions?.(ctx)) ?? [];
    warnings = (await fix.warnings?.(ctx)) ?? [];
  } catch (err) {
    blockedReason = errorMessage(err);
  }
  const tx = new Tx(host, { dryRun: true });
  try {
    await fix.apply(tx, ctx);
  } catch (err) {
    blockedReason = blockedReason ?? errorMessage(err);
  }
  const failed = preconditions.find((p) => !p.ok);
  if (!blockedReason && failed) blockedReason = failed.message;
  if (!blockedReason && fix.needsRoot && !host.isRoot) {
    blockedReason = host.platform === "win32" ? "This fix needs administrator rights. Open the terminal with \"Run as administrator\" and run Bulwark again." : "This fix needs admin rights. Run Bulwark with sudo to apply it.";
  }
  return {
    findingId: findings.map((f) => f.id).join(","),
    fixId: fix.id,
    title: fix.title(params),
    needsRoot: fix.needsRoot,
    risk: fix.risk,
    reversible: fix.reversible,
    canApply: !blockedReason,
    blockedReason,
    steps: tx.steps,
    warnings,
    preconditions,
  };
}

function subjectOf(f: Finding): string | undefined {
  return f.id.length > f.checkId.length + 1 && f.id.startsWith(f.checkId + ":") ? f.id.slice(f.checkId.length + 1) : undefined;
}

/**
 * Re-runs the checks behind local findings, so a fix works from what's true on the machine now
 * rather than from a saved scan (which may be stale, or was written by a less trusted user).
 * Findings that are already fixed drop out. Findings whose check can't run here are kept as they are.
 */
export async function refreshFindings(host: Host, findings: Finding[]): Promise<Finding[]> {
  clearHostCache(host);
  const results = new Map<string, CheckOutcome[]>();
  const out: Finding[] = [];
  for (const f of findings) {
    const check = f.target === "local" ? getCheck(f.checkId) : undefined;
    if (!check) {
      out.push(f);
      continue;
    }
    if (!results.has(check.id)) results.set(check.id, await check.run(host).catch(() => []));
    const outcomes = results.get(check.id)!;
    const subject = subjectOf(f);
    const same = outcomes.find((o) => (subject ? o.subject === subject : !o.subject || outcomes.length === 1));
    if (same?.status === "fail") {
      const fresh = outcomeToFinding(check, same);
      out.push(fresh.remedy?.auto ? fresh : f);
    } else if (same?.status === "pass" || (!same && outcomes.some((o) => o.status === "pass" || o.status === "fail"))) {
      continue; // fixed already
    } else out.push(f);
  }
  return out;
}

async function verify(host: Host, findings: Finding[]): Promise<{ status: Status; summary: string }> {
  clearHostCache(host);
  const problems: string[] = [];
  for (const f of findings) {
    if (f.target !== "local") continue;
    const check = getCheck(f.checkId);
    if (!check) continue;
    const outcomes = await check.run(host);
    const subject = subjectOf(f);
    const still = outcomes.find((o) => o.status === "fail" && (subject ? o.subject === subject : !o.subject));
    if (still) problems.push(still.summary);
  }
  if (problems.length) return { status: "fail", summary: `The fix was applied, but the check still finds a problem: ${problems[0]}` };
  return { status: "pass", summary: findings.some((f) => f.target === "local") ? "Checked again: the problem is gone." : "Checked again with the device: the change took effect." };
}

export async function applyFix(host: Host, state: StateStore, findings: Finding[]): Promise<ChangeRecord> {
  const { fix, params } = fixFor(findings);
  const plan = await planFix(host, findings);
  if (!plan.canApply) throw new FixError(plan.blockedReason ?? "This fix can't be applied.");
  const ctx = { host, params };
  const change: ChangeRecord = {
    id: `${stamp()}-${fix.id.replace(/[^\w.-]/g, "-")}-${randomId(2)}`,
    fixId: fix.id,
    findingId: findings.map((f) => f.id).join(","),
    target: findings[0].target,
    title: fix.title(params),
    appliedAt: new Date().toISOString(),
    status: "applied",
    reversible: fix.reversible,
    actions: [],
    log: [],
  };
  const tx = new Tx(host, { dryRun: false, network: (a) => performNetworkAction(a) });
  try {
    await fix.apply(tx, ctx);
    clearHostCache(host);
    const problem = await fix.validate?.(ctx);
    if (problem) throw new FixError(problem);
  } catch (err) {
    change.actions = tx.actions;
    change.log = [...tx.log, `Error: ${errorMessage(err)}`];
    const undo = await rollbackActions(host, tx.actions, { force: true, networkUndo: (a) => undoNetworkAction(a) });
    change.log.push(...undo.log, ...(undo.ok ? ["Everything was put back the way it was."] : undo.errors.map((e) => `Undo problem: ${e}`)));
    change.status = undo.ok ? "rolled-back" : "failed";
    change.error = errorMessage(err);
    await state.saveChange(change);
    clearHostCache(host);
    return change;
  }
  change.actions = tx.actions;
  change.log = tx.log;
  change.verification = await verify(host, findings);
  await state.saveChange(change);
  return change;
}

export async function rollbackChange(host: Host, state: StateStore, changeId: string, opts: { force?: boolean } = {}): Promise<ChangeRecord> {
  const change = await state.getChange(changeId);
  if (!change) throw new FixError(`No change with the id ${changeId}.`);
  if (change.status !== "applied") throw new FixError(`That change is ${change.status === "rolled-back" ? "already undone" : "not in effect"}.`);
  if (!change.reversible) throw new FixError("This change (installing updates) can't be undone automatically.");
  const fix = FIXES.get(change.fixId);
  if (fix?.needsRoot && !host.isRoot) throw new FixError("Undoing this needs admin rights. Run Bulwark with sudo.");
  // Undo newer changes to the same files first, or we'd restore stale copies.
  const newer = (await state.listChanges()).filter((c) => c.status === "applied" && c.id > change.id && c.actions.some((a) => "path" in a && change.actions.some((b) => "path" in b && b.path === a.path)));
  if (newer.length && !opts.force) throw new FixError(`Undo the newer change "${newer[0].title}" (${newer[0].id}) first; it touched the same files.`);
  const r = await rollbackActions(host, change.actions, { force: opts.force, networkUndo: (a) => undoNetworkAction(a) });
  change.log.push(`Undo started ${new Date().toISOString()}`, ...r.log, ...r.errors.map((e) => `Undo problem: ${e}`));
  if (r.ok) {
    change.status = "rolled-back";
    change.rolledBackAt = new Date().toISOString();
  } else {
    change.error = r.errors.join(" ");
  }
  await state.saveChange(change);
  clearHostCache(host);
  if (!r.ok) throw new FixError(r.errors.join(" "));
  return change;
}

/** The findings "Fix everything safe" may touch, grouped into one change per fix. */
export function safeBatches(findings: Finding[]): Finding[][] {
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const id = f.remedy?.auto?.fixId;
    if (f.status !== "fail" || !id) continue;
    const fix = FIXES.get(id);
    if (!fix || fix.risk !== "safe") continue;
    const key = fix.merge ? id : f.id;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  return [...groups.values()];
}
