// Runs this computer's checks on another one over SSH, and re-checks after a fix there.

import { checksFor, getCheck } from "../checks/index.ts";
import { clearHostCache } from "../core/cache.ts";
import { outcomeToFinding } from "../core/finding.ts";
import { describeOs } from "../core/host.ts";
import { sortFindings } from "../core/score.ts";
import type { Check, CheckOutcome, Finding, Host, RemoteScan, Status } from "../core/types.ts";
import { errorMessage, mapLimit } from "../core/util.ts";
import { parseSshTarget, remoteHost, sessionFor, targetId, targetLabel, type RemoteHost, type SshTarget } from "./ssh.ts";

/** Finding ids on another computer: the check, the computer, and what it was about. */
function remoteFinding(check: Check, o: CheckOutcome, target: string): Finding {
  const f = outcomeToFinding(check, o, target);
  f.id = `${check.id}@${target}${o.subject ? `#${o.subject}` : ""}`;
  return f;
}

export async function scanRemote(
  local: Host,
  target: SshTarget,
  opts: { password?: string; interactive?: boolean; checks?: Check[]; onProgress?: (p: { phase: string; done: number; total: number; message?: string }) => void } = {},
): Promise<RemoteScan> {
  const started = Date.now();
  const id = targetId(target);
  const base = { target: id, label: targetLabel(target), address: target.host, findings: [] as Finding[], notes: [] as string[] };
  let rh: RemoteHost;
  try {
    const session = await sessionFor(local, target);
    opts.onProgress?.({ phase: "remote", done: 0, total: 1, message: `Connecting to ${base.label}` });
    const c = await session.connect({ password: opts.password, interactive: opts.interactive });
    if (!c.ok) return { ...base, error: c.message, durationMs: Date.now() - started };
    rh = await remoteHost(session);
  } catch (err) {
    return { ...base, error: errorMessage(err), durationMs: Date.now() - started };
  }
  const checks = opts.checks ?? checksFor(rh.platform);
  let done = 0;
  const results = await mapLimit(checks, 4, async (check) => {
    opts.onProgress?.({ phase: "remote", done, total: checks.length, message: `${base.label}: ${check.title}` });
    let outcomes: CheckOutcome[];
    try {
      outcomes = await check.run(rh);
    } catch (err) {
      outcomes = [{ status: "error", summary: `The check failed: ${errorMessage(err)}` }];
    }
    done++;
    return outcomes.map((o) => remoteFinding(check, o, id));
  });
  if (!rh.isRoot) base.notes.push(`Connected as ${target.user}, without admin rights: checks that need them were skipped, and most fixes can't be applied. Connect as root, or as a user whose sudo doesn't ask for a password.`);
  return {
    ...base,
    device: { hostname: rh.hostname, platform: rh.platform, os: await describeOs(rh), arch: rh.remote.arch, isRoot: rh.isRoot, user: target.user },
    findings: sortFindings(results.flat()),
    durationMs: Date.now() - started,
  };
}

function parseId(f: Finding): { target: string; subject?: string } {
  const hash = f.id.indexOf("#");
  return { target: f.target, subject: hash === -1 ? undefined : f.id.slice(hash + 1) };
}

/** The other computer, connected (reusing the open connection, or by key). */
export async function remoteHostFor(local: Host, target: string): Promise<RemoteHost> {
  const t = parseSshTarget(target);
  if (!t) throw new Error(`Not an SSH target: ${target}`);
  const session = await sessionFor(local, t);
  if (!(await session.alive())) {
    const c = await session.connect();
    if (!c.ok) throw new Error(`Connect to ${targetLabel(t)} first (bulwark ssh ${targetLabel(t)}, or "Check over SSH" in the dashboard): ${c.message}`);
  }
  return remoteHost(session);
}

async function rerun(rh: RemoteHost, f: Finding): Promise<CheckOutcome[] | null> {
  const check = getCheck(f.checkId);
  if (!check) return null;
  try {
    return await check.run(rh);
  } catch {
    return null;
  }
}

/** Re-checks findings on the other computer, so a fix uses what's true there now. */
export async function refreshRemoteFindings(rh: RemoteHost, findings: Finding[]): Promise<Finding[]> {
  clearHostCache(rh);
  const out: Finding[] = [];
  for (const f of findings) {
    const outcomes = await rerun(rh, f);
    if (!outcomes) {
      out.push(f);
      continue;
    }
    const { subject } = parseId(f);
    const same = outcomes.find((o) => (subject ? o.subject === subject : !o.subject || outcomes.length === 1));
    if (same?.status === "fail") {
      const check = getCheck(f.checkId)!;
      const fresh = remoteFinding(check, same, f.target);
      out.push(fresh.remedy?.auto ? fresh : f);
    } else if (same?.status === "pass" || (!same && outcomes.some((o) => o.status === "pass" || o.status === "fail"))) continue;
    else out.push(f);
  }
  return out;
}

export async function verifyRemote(rh: RemoteHost, findings: Finding[]): Promise<{ status: Status; summary: string }> {
  clearHostCache(rh);
  const problems: string[] = [];
  for (const f of findings) {
    const outcomes = await rerun(rh, f);
    const { subject } = parseId(f);
    const still = outcomes?.find((o) => o.status === "fail" && (subject ? o.subject === subject : !o.subject));
    if (still) problems.push(still.summary);
  }
  return problems.length
    ? { status: "fail", summary: `The fix was applied, but ${rh.remote.label} still has the problem: ${problems[0]}` }
    : { status: "pass", summary: `Checked ${rh.remote.label} again: the problem is gone.` };
}
