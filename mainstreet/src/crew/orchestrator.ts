import { z } from "zod";
import { DEMO, LOOP_SECONDS, features } from "../config.ts";
import { addApproval, countEventsSince, getLead, getSettings, kvGet, kvSet, leadsWithStatus, listApprovals, patchSettings, responseStats, updateLead } from "../db.ts";
import { clearAgentError, leadChanged, log, working } from "../events.ts";
import { briefing, groupStats } from "../insights.ts";
import { NICHES } from "../niches.ts";
import { askStructured, describeClaudeError, isTransient } from "../providers/claude.ts";
import { notifyOwner } from "../providers/notify.ts";
import type { AgentId, Lead, TargetCity } from "../types.ts";
import { addMinutes, errorMessage, localDate, localDayStart, localParts, nowIso, pct } from "../util.ts";
import { build } from "./builder.ts";
import { ESTIMATE, preflight } from "./checker.ts";
import { handleInbound, runDueDemoPayments } from "./closer.ts";
import { diagnose } from "./diagnoser.ts";
import { film } from "./filmer.ts";
import { preparePitch, queueFollowups, sendDue, takeDueDemoReplies } from "./pitcher.ts";
import { STRATEGY_PROMPT } from "./prompts.ts";
import { HeldError, auditLead, nextTarget, scan, scannedToday } from "./scout.ts";

// The Orchestrator: a loop that keeps every agent fed. Each stage picks up
// leads in the stage before it, within its own concurrency limit and the
// day's quotas, so the crew runs on its own around the clock. Crashes are
// harmless: state lives in the database, so a restart picks up where it was.

const LIMITS = { audit: 4, diagnose: 2, build: 2, film: 1, pitch: 2 } as const;
type Stage = keyof typeof LIMITS;

const running = new Map<string, Promise<unknown>>();
let ticking = false;
let timer: NodeJS.Timeout | undefined;
let scanning: Promise<unknown> | undefined;
let lastScanAt = 0;

const inflight = (stage: Stage) => [...running.keys()].filter((k) => k.startsWith(`${stage}:`)).length;

export function agentOn(id: AgentId): boolean {
  const s = getSettings();
  return !s.crew.paused && !s.crew.pausedAgents.includes(id);
}

function eligible(lead: Lead, stage: Stage): boolean {
  if (lead.errorStage === stage) return false;
  if (lead.retryAt && Date.parse(lead.retryAt) > Date.now()) return false;
  return !running.has(`${stage}:${lead.id}`);
}

function describe(err: unknown): string {
  return err instanceof Error && err.constructor.name.includes("Anthropic") ? describeClaudeError(err) : describeClaudeError(err) || errorMessage(err);
}

function launch(stage: Stage, agent: AgentId, lead: Lead, fn: (l: Lead) => Promise<unknown>): void {
  const key = `${stage}:${lead.id}`;
  if (running.has(key)) return;
  const p = fn(lead)
    .then(() => {
      const l = getLead(lead.id);
      if (l && (l.attempts || l.retryAt)) updateLead(l.id, (x) => ((x.attempts = 0), (x.retryAt = undefined)));
    })
    .catch((err) => onStageError(stage, agent, lead, err))
    .finally(() => running.delete(key));
  running.set(key, p);
}

function onStageError(stage: Stage, agent: AgentId, lead: Lead, err: unknown): void {
  if (err instanceof HeldError) {
    updateLead(lead.id, (l) => (l.retryAt = addMinutes(new Date(), 15)));
    return;
  }
  const transient = isTransient(err);
  const updated = updateLead(lead.id, (l) => {
    l.attempts = (l.attempts ?? 0) + 1;
    l.retryAt = addMinutes(new Date(), transient ? 5 : 5 * 2 ** l.attempts);
    if (!transient && l.attempts >= 3) {
      l.error = describe(err);
      l.errorStage = stage;
    }
  });
  const gaveUp = updated?.errorStage === stage;
  log(agent, `${describe(err)}${gaveUp ? " Gave up after 3 tries; retry it from the lead." : " Will retry shortly."}`, { lead, level: "error" });
  if (updated) leadChanged(updated);
}

export function startCrew(): void {
  if (timer) return;
  log("orchestrator", `Crew started${DEMO ? " in demo mode (fictional businesses, nothing is really sent)" : ""}. Checking in every ${LOOP_SECONDS} seconds.`);
  setTimeout(() => void tick(), 2500).unref?.();
  timer = setInterval(() => void tick(), LOOP_SECONDS * 1000);
  timer.unref?.();
}

export function stopCrew(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const s = getSettings();
    if (s.crew.paused) return;

    if (DEMO) {
      for (const r of takeDueDemoReplies()) {
        const lead = getLead(r.leadId);
        if (lead?.email && !["won", "lost", "dnc"].includes(lead.status)) await handleInbound({ from: lead.email, subject: `Re: ${lead.pitch?.email.subject ?? "your new website"}`, text: r.text, leadId: lead.id });
      }
      await runDueDemoPayments();
    }

    // Scout: one map scan at a time until the day's scan quota is reached.
    const scanGap = DEMO ? 25_000 : 90_000;
    if (agentOn("scout") && !scanning && Date.now() - lastScanAt > scanGap && scannedToday() < s.quotas.scanPerDay) {
      const t = nextTarget();
      if (t) {
        lastScanAt = Date.now();
        scanning = scan(t.city, t.niche)
          .catch((err) => {
            if (!(err instanceof HeldError)) log("scout", `Scan failed: ${errorMessage(err)}`, { level: "error" });
          })
          .finally(() => (scanning = undefined));
      } else {
        once(`no_targets:${localDate(s.owner.timezone)}`, () => log("orchestrator", "Every city and niche has been scanned recently. Add a city or niche to keep the Scout busy.", { level: "warn" }));
      }
    }

    if (agentOn("scout")) for (const lead of leadsWithStatus("new", { order: "oldest", limit: 40 })) {
      if (inflight("audit") >= LIMITS.audit) break;
      if (eligible(lead, "audit")) launch("audit", "scout", lead, auditLead);
    }

    // The day's best qualified leads go forward, up to the daily lead quota.
    const day = localDayStart(s.owner.timezone);
    if (agentOn("diagnoser") && countEventsSince(day, "diagnoser", "success") + inflight("diagnose") < s.quotas.leadsPerDay) {
      for (const lead of leadsWithStatus("qualified", { order: "score", limit: 20 })) {
        if (inflight("diagnose") >= LIMITS.diagnose) break;
        if (eligible(lead, "diagnose")) launch("diagnose", "diagnoser", lead, diagnose);
      }
    }
    if (agentOn("builder")) for (const lead of leadsWithStatus("diagnosed", { order: "oldest", limit: 20 })) {
      if (inflight("build") >= LIMITS.build) break;
      if (eligible(lead, "build")) launch("build", "builder", lead, build);
    }
    if (agentOn("filmer")) for (const lead of leadsWithStatus("built", { order: "oldest", limit: 20 })) {
      if (inflight("film") >= LIMITS.film) break;
      if (eligible(lead, "film")) launch("film", "filmer", lead, film);
    }
    if (agentOn("pitcher")) {
      for (const lead of leadsWithStatus("filmed", { order: "oldest", limit: 20 })) {
        if (inflight("pitch") >= LIMITS.pitch) break;
        if (eligible(lead, "pitch")) launch("pitch", "pitcher", lead, preparePitch);
      }
      queueFollowups();
      await sendDue();
    }
    await routines();
  } catch (err) {
    log("orchestrator", `Loop error: ${errorMessage(err)}`, { level: "error" });
  } finally {
    ticking = false;
  }
}

function once(key: string, fn: () => void): void {
  if (kvGet(key)) return;
  kvSet(key, true);
  fn();
}

let lastHourly = 0;

async function routines(): Promise<void> {
  const s = getSettings();
  const now = new Date();
  const p = localParts(s.owner.timezone, now);
  const today = localDate(s.owner.timezone, now);

  if (Date.now() - lastHourly > (DEMO ? 5 * 60_000 : 60 * 60_000)) {
    lastHourly = Date.now();
    checkResponseRate();
  }
  if (p.hour >= 8 && !kvGet(`brief:${today}`)) {
    kvSet(`brief:${today}`, true);
    const b = briefing();
    log("orchestrator", `Morning brief: ${b.text}`);
    await notifyOwner({ title: "Your morning brief", body: b.text, priority: "low", path: "#/today", dedupeKey: `brief:${today}` });
  }
  if (p.hour >= 7 && features.claude && !kvGet(`strategy:${today}`)) {
    kvSet(`strategy:${today}`, true);
    void strategyReview().catch((err) => log("orchestrator", `Strategy review failed: ${errorMessage(err)}`, { level: "warn" }));
  }
}

/** Wake-up #2: the week's response rate fell under the floor. */
export function checkResponseRate(): void {
  const s = getSettings();
  const r = responseStats(new Date(Date.now() - 7 * 86_400_000).toISOString());
  const rate = r.pitched ? r.replied / r.pitched : 0;
  const flagged = kvGet<{ since: string }>("alert:low_response");
  if (r.pitched >= s.escalation.minSample && rate < s.escalation.minResponseRate) {
    if (flagged) return;
    kvSet("alert:low_response", { since: nowIso(), rate, sample: r.pitched });
    const paused = s.escalation.pauseOnLowResponse;
    if (paused) patchSettings({ crew: { pausedAgents: [...new Set([...s.crew.pausedAgents, "pitcher"])] } });
    log("orchestrator", `Response rate is ${pct(rate)} on ${r.pitched} pitches this week, under your ${pct(s.escalation.minResponseRate)} floor.${paused ? " Paused the Pitcher." : ""}`, { level: "error" });
    void notifyOwner({
      title: `Response rate dropped to ${pct(rate)}`,
      body: `${r.replied} replies from ${r.pitched} pitches this week (floor ${pct(s.escalation.minResponseRate)}).${paused ? " The Pitcher is paused until you look." : ""}`,
      priority: "urgent",
      path: "#/today",
      call: { reason: `The response rate fell to ${pct(rate)} this week, under your ${pct(s.escalation.minResponseRate)} floor.` },
      dedupeKey: "low_response",
    });
  } else if (flagged && (rate >= s.escalation.minResponseRate || r.pitched < s.escalation.minSample)) {
    kvSet("alert:low_response", null);
    log("orchestrator", `Response rate is back to ${pct(rate)}.`, { level: "success" });
  }
}

// ── Strategy review: Atlas steers the crew from the results ────────────

const StrategySchema = z.object({
  summary: z.string(),
  changes: z.array(z.object({ path: z.enum(["targets.niches", "targets.cities", "quotas.leadsPerDay", "qualify.minScore"]), valueJson: z.string().describe("The new value as JSON"), reason: z.string() })),
});

export async function strategyReview(): Promise<string> {
  return working("orchestrator", "Reviewing the last two weeks", async () => {
    const s = getSettings();
    const stats = groupStats(14);
    const total = stats.filter((x) => x.by === "niche").reduce((a, x) => a + x.pitched, 0);
    if (total < 20) {
      log("orchestrator", `Strategy review: only ${total} pitches in two weeks, too few to change course. Keeping the plan.`);
      return "Too few pitches to judge yet.";
    }
    const v = preflight(ESTIMATE.strategy(), { agent: "orchestrator", what: "the strategy review" });
    if (!v.ok) return v.reason;
    const out = await askStructured({
      agent: "orchestrator",
      system: STRATEGY_PROMPT,
      prompt: [
        `Current targets: niches ${JSON.stringify(s.targets.niches)}; cities ${JSON.stringify(s.targets.cities)}.`,
        `Allowed niche ids: ${NICHES.map((n) => n.id).join(", ")}.`,
        `Current quotas.leadsPerDay: ${s.quotas.leadsPerDay}; qualify.minScore: ${s.qualify.minScore}.`,
        "",
        "Results (last 14 days, by group): pitched / replied / won",
        ...stats.map((x) => `- ${x.by} ${x.label}: ${x.pitched} / ${x.replied} / ${x.won}`),
      ].join("\n"),
      schema: StrategySchema,
      effort: "high",
      maxTokens: 8000,
      label: "strategy",
    });
    const changes = out.changes
      .map((c) => {
        try {
          return { path: c.path, value: JSON.parse(c.valueJson) as unknown, reason: c.reason };
        } catch {
          return undefined;
        }
      })
      .filter((c): c is { path: (typeof out.changes)[number]["path"]; value: unknown; reason: string } => Boolean(c && validStrategyValue(c.path, c.value)));
    log("orchestrator", `Strategy review: ${out.summary}`);
    if (changes.length && !listApprovals("pending").some((a) => a.kind === "strategy")) {
      addApproval({
        kind: "strategy",
        title: `Atlas suggests ${changes.length} change${changes.length === 1 ? "" : "s"} to the plan`,
        detail: `${out.summary}\n\n${changes.map((c) => `• ${c.path} → ${JSON.stringify(c.value)}: ${c.reason}`).join("\n")}`,
        payload: { changes },
      });
    }
    return out.summary;
  });
}

function validStrategyValue(path: string, v: unknown): boolean {
  const s = getSettings();
  if (path === "targets.niches") return Array.isArray(v) && v.length > 0 && v.every((x) => NICHES.some((n) => n.id === x));
  if (path === "targets.cities")
    return Array.isArray(v) && v.length > 0 && (v as TargetCity[]).every((c) => s.targets.cities.some((x) => x.city.toLowerCase() === String(c?.city).toLowerCase()));
  if (path === "quotas.leadsPerDay") return Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 60;
  if (path === "qualify.minScore") return Number.isInteger(v) && (v as number) >= 40 && (v as number) <= 80;
  return false;
}

export function applyStrategy(changes: { path: string; value: unknown }[]): void {
  for (const c of changes) {
    if (!validStrategyValue(c.path, c.value)) continue;
    const [a, b] = c.path.split(".");
    patchSettings({ [a]: { [b]: c.value } });
  }
}

// ── Run things now (commands from you or Atlas) ─────────────────────────

export async function scanNow(target: TargetCity, niche: string, count?: number): Promise<{ found: number; added: number }> {
  lastScanAt = Date.now();
  const r = await scan(target, niche, { max: count });
  void tick();
  return r;
}

/** Run one agent on one lead right now, whatever the queue. */
export async function runOnLead(agent: AgentId, lead: Lead): Promise<Lead | undefined> {
  clearAgentError(agent);
  const reset = updateLead(lead.id, (l) => {
    l.error = undefined;
    l.errorStage = undefined;
    l.attempts = 0;
    l.retryAt = undefined;
  })!;
  if (agent === "scout") return auditLead(reset);
  if (agent === "diagnoser") return diagnose(reset);
  if (agent === "builder") return build(reset);
  if (agent === "filmer") return film(reset);
  if (agent === "pitcher") return preparePitch(reset);
  throw new Error(`${agent} doesn't work on single leads.`);
}

export function isBusy(): boolean {
  return running.size > 0 || Boolean(scanning);
}

export async function settle(timeoutMs = 120_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while ((running.size || scanning) && Date.now() < end) await Promise.race([Promise.allSettled([...running.values(), scanning]), new Promise((r) => setTimeout(r, 500))]);
}
