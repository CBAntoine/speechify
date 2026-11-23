/**
 * Start, track and finish rulebase reviews without any local state: each
 * review is a Managed Agents session, and everything the console needs lives
 * on it (metadata, events, outcome grades, output files). This suits
 * serverless hosting, where nothing survives between requests.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { toFile } from "@anthropic-ai/sdk";
import type { Bundle } from "./bundle.ts";
import { MAX_ITERATIONS, RUBRIC, outcomeDescription } from "./rubric.ts";
import { describeTool } from "./session.ts";

export const WORKFLOW = "NET-2";

type ListedEvent = Anthropic.Beta.Sessions.BetaManagedAgentsSessionEvent;

export interface AgentIds {
  agentId: string;
  environmentId: string;
}

export function outcomeEvent(bundle: Bundle) {
  return {
    type: "user.define_outcome" as const,
    description: outcomeDescription({ device: bundle.device, reviewDate: bundle.reviewDate, files: bundle.files.map((f) => f.name) }),
    rubric: { type: "text" as const, content: RUBRIC },
    max_iterations: MAX_ITERATIONS,
  };
}

/**
 * Upload the inputs and create the session. With `kickoff`, the outcome goes
 * in with the create call and the agent starts at once; without it, the
 * caller opens a stream first and sends outcomeEvent() itself.
 */
export async function startReview(
  client: Anthropic,
  ids: AgentIds,
  bundle: Bundle,
  opts: { budgetCents: number; kickoff: boolean; source: string },
): Promise<{ sessionId: string; uploaded: string[] }> {
  const uploaded: string[] = [];
  try {
    const resources: { type: "file"; file_id: string; mount_path: string }[] = [];
    for (const f of bundle.files) {
      const meta = await client.files.upload({ file: await toFile(Buffer.from(f.content, "utf8"), f.name, { type: f.type }) });
      uploaded.push(meta.id);
      resources.push({ type: "file", file_id: meta.id, mount_path: `/${f.name}` });
    }
    const session = await client.beta.sessions.create({
      agent: ids.agentId,
      environment_id: ids.environmentId,
      title: `Rulebase review: ${bundle.device} (${bundle.reviewDate})`,
      resources,
      budget: { type: "limit", max_list_cost: { amount: String(opts.budgetCents), currency: "USD" } },
      metadata: {
        workflow: WORKFLOW,
        device: bundle.device.slice(0, 200),
        review_date: bundle.reviewDate,
        source: opts.source,
        // Deleted once the review finishes (see cleanupInputs).
        inputs: uploaded.join(","),
      },
      ...(opts.kickoff ? { initial_events: [outcomeEvent(bundle)] } : {}),
    });
    return { sessionId: session.id, uploaded };
  } catch (err) {
    for (const id of uploaded) await client.files.delete(id).catch(() => {});
    throw err;
  }
}

export type ReviewPhase = "starting" | "working" | "grading" | "waiting" | "done" | "stopped";

export interface PendingCall {
  /** The agent.tool_use event id to answer. */
  id: string;
  tool: string;
  summary: string;
}

export interface ReviewStatus {
  id: string;
  device: string;
  reviewDate: string;
  createdAt: string;
  phase: ReviewPhase;
  /** One plain sentence about where the review is. */
  detail: string;
  stopReason: string | null;
  grades: { iteration: number; result: string; explanation: string | null }[];
  lastMessage: string | null;
  pending: PendingCall[];
  costUsd: number | null;
  minutes: number;
}

const STOPPED: Record<string, string> = {
  budget_reached: "It reached its spending cap and paused.",
  retries_exhausted: "It stopped after repeated errors.",
  refusal: "Claude declined to continue this review.",
  terminated: "The session ended.",
};

function messageText(ev: ListedEvent): string | null {
  if (ev.type !== "agent.message") return null;
  const text = ev.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  return text || null;
}

/** Where a review is, read from its session and its latest events. */
export async function reviewStatus(client: Anthropic, sessionId: string, now = Date.now()): Promise<ReviewStatus> {
  const s = await client.beta.sessions.retrieve(sessionId);
  const recent: ListedEvent[] = [];
  for await (const ev of client.beta.sessions.events.list(sessionId, { order: "desc", limit: 60 })) {
    recent.push(ev);
    if (recent.length >= 60) break;
  }

  let lastIdle: string | null = null;
  let lastMessage: string | null = null;
  let grading = false;
  let gradingSettled = false;
  const answered = new Set<string>();
  const asks: PendingCall[] = [];
  let seenRunning = false;
  for (const ev of recent) {
    if (ev.type === "session.status_running" && lastIdle === null) seenRunning = true;
    if (ev.type === "session.status_idle" && lastIdle === null && !seenRunning) lastIdle = ev.stop_reason.type;
    if (!lastMessage) lastMessage = messageText(ev);
    if (!gradingSettled) {
      if (ev.type === "span.outcome_evaluation_end") gradingSettled = true;
      else if (ev.type === "span.outcome_evaluation_start" || ev.type === "span.outcome_evaluation_ongoing") {
        grading = true;
        gradingSettled = true;
      }
    }
    if (ev.type === "user.tool_confirmation") answered.add(ev.tool_use_id);
    if ((ev.type === "agent.tool_use" || ev.type === "agent.mcp_tool_use") && ev.evaluated_permission === "ask" && !answered.has(ev.id)) {
      asks.push({ id: ev.id, tool: ev.name, summary: describeTool(ev) });
    }
  }

  const grades = [...(s.outcome_evaluations ?? [])]
    .sort((a, b) => a.iteration - b.iteration)
    .map((g) => ({ iteration: g.iteration, result: g.result, explanation: g.explanation }));
  const last = grades[grades.length - 1];

  let phase: ReviewPhase;
  let detail: string;
  let stopReason: string | null = null;
  if (s.status === "terminated") {
    phase = "stopped";
    stopReason = "terminated";
    detail = STOPPED.terminated;
  } else if (s.status === "idle" && lastIdle === "requires_action") {
    phase = "waiting";
    detail = asks.length ? `It's waiting for approval to run ${asks[0].tool}.` : "It's waiting for a decision.";
  } else if (s.status === "idle" && lastIdle === "end_turn") {
    phase = "done";
    detail =
      !last || last.result === "satisfied"
        ? "The review is finished and passed its quality check."
        : `The review is finished, but the grader marked it ${last.result.replace(/_/g, " ")}.`;
  } else if (s.status === "idle" && lastIdle) {
    phase = "stopped";
    stopReason = lastIdle;
    detail = STOPPED[lastIdle] ?? `It stopped (${lastIdle}).`;
  } else if (!recent.some((ev) => ev.type.startsWith("agent.") || ev.type.startsWith("span."))) {
    phase = "starting";
    detail = "The sandbox is starting.";
  } else if (grading) {
    phase = "grading";
    detail = `The grader is checking draft ${(last?.iteration ?? -1) + 2} against the rubric.`;
  } else {
    phase = "working";
    detail = last ? `It's revising the report after grading round ${last.iteration + 1}.` : "It's analysing the configuration.";
  }

  const cost = s.usage?.list_cost;
  return {
    id: s.id,
    device: s.metadata?.device ?? "FortiGate",
    reviewDate: s.metadata?.review_date ?? s.created_at.slice(0, 10),
    createdAt: s.created_at,
    phase,
    detail,
    stopReason,
    grades,
    lastMessage,
    pending: phase === "waiting" ? asks : [],
    costUsd: cost ? Number(cost.amount) / 100 : null,
    minutes: Math.max(0, Math.round((now - Date.parse(s.created_at)) / 60_000)),
  };
}

export interface ReviewSummary {
  id: string;
  device: string;
  reviewDate: string;
  createdAt: string;
  status: string;
}

/** The latest reviews, newest first. */
export async function listReviews(client: Anthropic, agentId: string, limit = 20): Promise<ReviewSummary[]> {
  const page = await client.beta.sessions.list({ agent_id: agentId, order: "desc", limit });
  return page.data
    .filter((s) => s.metadata?.workflow === WORKFLOW)
    .map((s) => ({
      id: s.id,
      device: s.metadata?.device ?? "FortiGate",
      reviewDate: s.metadata?.review_date ?? s.created_at.slice(0, 10),
      createdAt: s.created_at,
      status: s.status,
    }));
}

export async function answerApproval(client: Anthropic, sessionId: string, eventId: string, allow: boolean): Promise<void> {
  await client.beta.sessions.events.send(sessionId, {
    events: [
      allow
        ? { type: "user.tool_confirmation", tool_use_id: eventId, result: "allow" }
        : { type: "user.tool_confirmation", tool_use_id: eventId, result: "deny", deny_message: "The engineer declined this call. Continue without it." },
    ],
  });
}

export interface OutputFile {
  name: string;
  text: string;
}

/** The files the agent wrote, newest version of each. Text files only. */
export async function reviewOutputs(client: Anthropic, sessionId: string): Promise<OutputFile[]> {
  const files: Anthropic.Beta.BetaFileMetadata[] = [];
  for await (const f of client.beta.files.list({ scope_id: sessionId, betas: ["managed-agents-2026-04-01"] })) files.push(f);
  files.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const latest = new Map<string, Anthropic.Beta.BetaFileMetadata>();
  for (const f of files) latest.set(f.filename.split("/").pop() ?? f.filename, f);
  const out: OutputFile[] = [];
  for (const [name, f] of latest) {
    if (!/\.(md|json|py|txt|csv)$/i.test(name)) continue;
    const res = await client.beta.files.download(f.id);
    out.push({ name, text: await res.text() });
  }
  return out;
}

/** Delete the uploaded inputs once a review has stopped. Safe to call more than once. */
export async function cleanupInputs(client: Anthropic, sessionId: string): Promise<number> {
  const s = await client.beta.sessions.retrieve(sessionId);
  const ids = (s.metadata?.inputs ?? "").split(",").filter(Boolean);
  if (!ids.length) return 0;
  for (const id of ids) await client.files.delete(id).catch(() => {});
  await client.beta.sessions.update(sessionId, { metadata: { inputs: null } }).catch(() => {});
  return ids.length;
}
