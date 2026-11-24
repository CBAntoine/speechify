import "server-only";
import { placeInText } from "@/lib/regions";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { agentRuntime, runBudgetCents } from "@/lib/config";
import { claude, describeError, FALLBACK, MODEL } from "@/lib/claude/client";
import { templateOutreach } from "@/lib/claude/outreach";
import { getNiche, matchNiche, NICHES } from "@/lib/niches";
import { addActivity, getLead, getProfile, listDrafts, listLeads } from "@/lib/repo";
import { getStoredRun, listStoredRuns, newId, putStoredRun, readDb, update } from "@/lib/store";
import type { AgencyProfile, AgentRun, RunEvent } from "@/lib/types";
import { getAgent, type AgentDef, type AgentId } from "./roster";
import { executeTool, toolsFor, TOOLS, type ToolContext } from "./tools";

// Runs live in memory while they execute and are saved to the store as they
// go, so the UI can poll them and they survive a page refresh.

interface Live {
  run: AgentRun;
  def: AgentDef;
  ctx: ToolContext;
  saveTimer?: ReturnType<typeof setTimeout>;
  stopRequested: boolean;
  abort: AbortController;
  /** Messages-API runtime: conversation so far (for follow-ups). */
  messages?: Anthropic.Beta.BetaMessageParam[];
  /** Managed Agents: custom tool calls already answered, by event id. */
  answered: Map<string, { text: string; isError: boolean }>;
  busy: boolean;
}

const g = globalThis as { __rmRuns?: Map<string, Live>; __rmEnsuring?: Map<string, Promise<{ agentId: string; version: number; environmentId: string }>> };
const live: Map<string, Live> = (g.__rmRuns ??= new Map());
const ensuring = (g.__rmEnsuring ??= new Map());

const now = () => new Date().toISOString();

function emit(l: Live, ev: Omit<RunEvent, "id" | "at">) {
  l.run.events.push({ id: newId("ev"), at: now(), ...ev });
  scheduleSave(l);
}

function scheduleSave(l: Live) {
  if (l.saveTimer) return;
  l.saveTimer = setTimeout(() => {
    l.saveTimer = undefined;
    void persistRun(l.run);
  }, 700);
}

async function persistRun(run: AgentRun) {
  try {
    await putStoredRun(structuredClone(run));
  } catch (err) {
    console.error("[rainmaker] could not save run", err);
  }
}

/** No events for this long means the server running it is gone. */
const STALE_MS = 8 * 60_000;

function settle(run: AgentRun): AgentRun {
  if (run.status !== "running" && run.status !== "waiting") return run;
  const last = run.events[run.events.length - 1]?.at ?? run.startedAt;
  if (Date.now() - Date.parse(last) < STALE_MS) return run;
  return { ...run, status: "stopped", error: run.error ?? "This run stopped responding. The server may have restarted or hit its time limit." };
}

async function stopRequestedElsewhere(runId: string): Promise<boolean> {
  try {
    return Boolean((await readDb()).stopRequests?.includes(runId));
  } catch {
    return false;
  }
}

async function flush(l: Live) {
  if (l.saveTimer) {
    clearTimeout(l.saveTimer);
    l.saveTimer = undefined;
  }
  await persistRun(l.run);
}

export async function getRun(id: string): Promise<AgentRun | undefined> {
  const l = live.get(id);
  if (l) return structuredClone(l.run);
  const stored = await getStoredRun(id);
  return stored ? settle(stored) : undefined;
}

export async function listRuns(): Promise<AgentRun[]> {
  const stored = await listStoredRuns(40);
  return stored.map((r) => (live.has(r.id) ? structuredClone(live.get(r.id)!.run) : settle(r)));
}

function kickoff(profile: AgencyProfile, goal: string): string {
  const niches = profile.targetNiches.map((id) => getNiche(id)?.label ?? id).join(", ");
  return [
    `Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`,
    "",
    "THE AGENCY",
    `- Name: ${profile.agencyName}`,
    profile.ownerName ? `- Owner (sign messages as): ${profile.ownerName}` : "- Owner name: not set (sign as the agency)",
    profile.city ? `- Based in: ${profile.city}` : "",
    profile.coreOffer ? `- Core offer: ${profile.coreOffer}` : "- Core offer: not set (describe the services plainly; don't invent guarantees or terms)",
    `- Services: ${profile.services.join(", ")}`,
    profile.pricing ? `- Pricing: ${profile.pricing}` : "",
    profile.proof ? `- Proof and results: ${profile.proof}` : "- Proof and results: none given (don't invent any)",
    `- Target niches: ${niches || "any local business"}`,
    profile.calendarUrl ? `- Booking link: ${profile.calendarUrl}` : "",
    profile.mailingAddress ? `- Postal address for email footers: ${profile.mailingAddress}` : "",
    `- Voice: ${profile.voice}`,
    "",
    "YOUR GOAL",
    goal,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Start an agent run. Returns at once; `done` settles when the run ends. */
export async function startRun(agentId: string, goal: string): Promise<{ run: AgentRun; done: Promise<void> }> {
  const def = getAgent(agentId);
  if (!def) throw new Error("Unknown agent");
  const text = goal.trim().slice(0, 2000) || def.presets[0];
  const run: AgentRun = {
    id: newId("run"),
    agentId: def.id,
    goal: text,
    status: "running",
    runtime: agentRuntime(),
    startedAt: now(),
    events: [],
  };
  const l: Live = { run, def, ctx: { runId: run.id, agentId: def.id, prospects: new Map() }, stopRequested: false, abort: new AbortController(), answered: new Map(), busy: true };
  live.set(run.id, l);
  emit(l, { kind: "user", text });
  await persistRun(run);
  const profile = await getProfile();
  const done = execute(l, kickoff(profile, text), true);
  return { run: structuredClone(run), done };
}

/** Send a follow-up instruction to a finished run (same context). */
export async function followUp(runId: string, text: string): Promise<{ run: AgentRun; done: Promise<void> }> {
  let l = live.get(runId);
  if (!l) {
    const found = await getStoredRun(runId);
    if (!found) throw new Error("Run not found");
    const stored = settle(found);
    if (stored.status === "running" || stored.status === "waiting") throw new Error("The agent is still working. Wait for it to finish or stop it.");
    const def = getAgent(stored.agentId);
    if (!def) throw new Error("Unknown agent");
    if (stored.runtime === "messages") throw new Error("This run's conversation is gone (server restarted). Start a new run.");
    l = { run: stored, def, ctx: { runId, agentId: def.id, prospects: new Map() }, stopRequested: false, abort: new AbortController(), answered: new Map(), busy: false };
    live.set(runId, l);
  }
  if (l.busy) throw new Error("The agent is still working. Wait for it to finish or stop it.");
  if (l.run.runtime === "demo") throw new Error("Follow-up messages need a Claude API key. Start a new run instead.");
  if (l.run.runtime === "managed" && !l.run.sessionId) throw new Error("This run has no session to continue. Start a new run.");
  l.busy = true;
  l.stopRequested = false;
  l.abort = new AbortController();
  l.run.status = "running";
  l.run.endedAt = undefined;
  l.run.error = undefined;
  emit(l, { kind: "user", text });
  await flush(l);
  return { run: structuredClone(l.run), done: execute(l, text.slice(0, 2000), false) };
}

export async function stopRun(runId: string): Promise<void> {
  const l = live.get(runId);
  if (!l) {
    // The run may be executing on another server instance: leave a stop
    // request it checks between steps, and interrupt a Managed Agents
    // session directly.
    const stored = await getStoredRun(runId);
    if (!stored || (stored.status !== "running" && stored.status !== "waiting")) return;
    await update((db) => {
      db.stopRequests = [...(db.stopRequests ?? []).filter((x) => x !== runId), runId];
    });
    if (stored.runtime === "managed" && stored.sessionId) {
      await claude()
        .beta.sessions.events.send(stored.sessionId, { events: [{ type: "user.interrupt" }] })
        .catch(() => undefined);
    }
    return;
  }
  if (!l.busy) return;
  l.stopRequested = true;
  l.abort.abort();
  emit(l, { kind: "status", text: "Stopping…" });
  if (l.run.runtime === "managed" && l.run.sessionId) {
    try {
      await claude().beta.sessions.events.send(l.run.sessionId, { events: [{ type: "user.interrupt" }] });
    } catch {
      /* the stream loop will notice stopRequested */
    }
  }
}

async function execute(l: Live, text: string, first: boolean): Promise<void> {
  try {
    if (l.run.runtime === "managed") await runManaged(l, text);
    else if (l.run.runtime === "messages") await runMessages(l, text, first);
    // The demo script parses the user's own words, not the full kickoff.
    else await runDemo(l, l.run.goal);
    if (!l.stopRequested && (await stopRequestedElsewhere(l.run.id))) l.stopRequested = true;
    if (l.run.status === "running" || l.run.status === "waiting") l.run.status = l.stopRequested ? "stopped" : "done";
  } catch (err) {
    if (l.stopRequested) {
      l.run.status = "stopped";
    } else {
      l.run.status = "error";
      l.run.error = describeError(err);
      emit(l, { kind: "error", text: l.run.error });
    }
  } finally {
    l.busy = false;
    l.run.endedAt = now();
    if (l.stopRequested) {
      await update((db) => {
        db.stopRequests = (db.stopRequests ?? []).filter((x) => x !== l.run.id);
      }).catch(() => undefined);
    }
    if (!l.run.summary) {
      const last = [...l.run.events].reverse().find((e) => e.kind === "message");
      l.run.summary = last?.text?.slice(0, 600);
    }
    await flush(l);
    await addActivity({
      kind: "agent",
      agentId: l.def.id,
      text:
        l.run.status === "done"
          ? `${l.def.name} finished: ${l.run.goal.slice(0, 90)}`
          : l.run.status === "stopped"
            ? `${l.def.name} was stopped`
            : `${l.def.name} hit a problem: ${l.run.error?.slice(0, 90) ?? "unknown error"}`,
    });
  }
}

async function callTool(l: Live, name: string, input: unknown) {
  const tool = (TOOLS as Record<string, (typeof TOOLS)[keyof typeof TOOLS] | undefined>)[name];
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  emit(l, { kind: "tool_call", tool: name, text: tool ? tool.describe(args) : name, input: args });
  const res = await executeTool(name, args, l.ctx, l.def.tools);
  emit(l, { kind: "tool_result", tool: name, text: res.summary, ok: !res.isError });
  return res;
}

// ── Claude Managed Agents ─────────────────────────────────────

function agentConfig(def: AgentDef) {
  return {
    name: `Rainmaker ${def.name}`,
    model: MODEL,
    system: def.system,
    tools: toolsFor(def.tools).map((t) => ({ type: "custom" as const, name: t.name, description: t.description, input_schema: t.input_schema })),
  };
}

export function agentHash(def: AgentDef): string {
  return createHash("sha256").update(JSON.stringify(agentConfig(def))).digest("hex").slice(0, 16);
}

/** Create (once) or update the environment and the agent for this role. */
export async function ensureManagedAgent(def: AgentDef): Promise<{ agentId: string; version: number; environmentId: string }> {
  const pending = ensuring.get(def.id);
  if (pending) return pending;
  const p = (async () => {
    const c = claude();
    const db = await readDb();
    let environmentId = db.managed.environmentId;
    if (!environmentId) {
      // Reuse the account's Rainmaker environment if one exists (another
      // install, or a reset database) so agents don't pile up as duplicates.
      let found: string | undefined;
      for await (const env of c.beta.environments.list()) {
        if (!env.archived_at && env.metadata?.app === "rainmaker") {
          found = env.id;
          break;
        }
      }
      // The agents only call Rainmaker's own tools, so the sandbox gets no
      // network access at all.
      found ??= (
        await c.beta.environments.create({
          name: "rainmaker",
          description: "Rainmaker CRM agents (custom tools only)",
          config: { type: "cloud", networking: { type: "limited" } },
          metadata: { app: "rainmaker" },
        })
      ).id;
      environmentId = found;
      await update((d) => {
        d.managed.environmentId = found;
      });
    }
    const config = agentConfig(def);
    const hash = agentHash(def);
    let rec = db.managed.agents[def.id];
    if (!rec) {
      for await (const a of c.beta.agents.list()) {
        if (!a.archived_at && a.metadata?.app === "rainmaker" && a.metadata?.role === def.id) {
          rec = { id: a.id, version: a.version, hash: a.metadata?.hash ?? "" };
          break;
        }
      }
    }
    const meta = { app: "rainmaker", role: def.id, hash };
    const agent =
      rec && rec.hash === hash
        ? { id: rec.id, version: rec.version }
        : rec
          ? // No `version`: the config comes from code, so last write wins and a
            // second server instance can't fail this with a version conflict.
            await c.beta.agents.update(rec.id, { ...config, metadata: meta })
          : await c.beta.agents.create({ ...config, description: def.description, metadata: meta });
    if (!db.managed.agents[def.id] || db.managed.agents[def.id].version !== agent.version || db.managed.agents[def.id].hash !== hash) {
      await update((d) => {
        d.managed.agents[def.id] = { id: agent.id, version: agent.version, hash };
      });
    }
    return { agentId: agent.id, version: agent.version, environmentId };
  })();
  ensuring.set(def.id, p);
  try {
    return await p;
  } finally {
    ensuring.delete(def.id);
  }
}

type SessionEvent = Anthropic.Beta.Sessions.BetaManagedAgentsStreamSessionEvents | Anthropic.Beta.Sessions.BetaManagedAgentsSessionEvent;

async function runManaged(l: Live, message: string) {
  const c = claude();
  if (!l.run.sessionId) {
    const { agentId, version, environmentId } = await ensureManagedAgent(l.def);
    const session = await c.beta.sessions.create({
      agent: { type: "agent", id: agentId, version },
      environment_id: environmentId,
      title: `${l.def.name}: ${l.run.goal.slice(0, 80)}`,
      budget: { type: "limit", max_list_cost: { amount: String(runBudgetCents()), currency: "USD" } },
      metadata: { app: "rainmaker", run_id: l.run.id },
    });
    l.run.sessionId = session.id;
    emit(l, { kind: "status", text: "Started a Claude Managed Agents session" });
  }
  const sid = l.run.sessionId;
  let sent = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    // Stream first, then send, so no early event is missed.
    const stream = await c.beta.sessions.events.stream(sid);
    if (!sent) {
      await c.beta.sessions.events.send(sid, { events: [{ type: "user.message", content: [{ type: "text", text: message }] }] });
      sent = true;
    } else {
      // Reconnected: answer any tool call that is still waiting on us.
      const state = await reconcile(l, sid);
      if (state === "finished") return;
    }
    try {
      for await (const ev of stream) {
        if ((await handleEvent(l, sid, ev)) === "finished") return;
        if (l.stopRequested && l.run.status !== "running") return;
      }
    } catch (err) {
      if (attempt === 3) throw err;
    }
    emit(l, { kind: "status", text: "Reconnecting to the session…" });
  }
  throw new Error("Lost the connection to the agent session");
}

async function answerCustomTool(l: Live, sid: string, ev: { id: string; name: string; input: unknown }) {
  let res = l.answered.get(ev.id);
  if (!res) {
    const r = await callTool(l, ev.name, ev.input);
    res = { text: r.text, isError: r.isError };
    l.answered.set(ev.id, res);
  }
  await claude().beta.sessions.events.send(sid, {
    events: [{ type: "user.custom_tool_result", custom_tool_use_id: ev.id, content: [{ type: "text", text: res.text }], is_error: res.isError }],
  });
}

async function handleEvent(l: Live, sid: string, ev: SessionEvent): Promise<"continue" | "finished"> {
  switch (ev.type) {
    case "agent.message": {
      const text = ev.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
      if (text) emit(l, { kind: "message", text });
      return "continue";
    }
    case "agent.thinking": {
      const last = l.run.events[l.run.events.length - 1];
      if (last?.kind !== "thinking") emit(l, { kind: "thinking", text: "Thinking" });
      return "continue";
    }
    case "agent.custom_tool_use":
      await answerCustomTool(l, sid, ev);
      return "continue";
    case "agent.tool_use":
    case "agent.mcp_tool_use":
      // No built-in or MCP tools are enabled; refuse anything that asks.
      if (ev.evaluated_permission === "ask") {
        await claude().beta.sessions.events.send(sid, {
          events: [{ type: "user.tool_confirmation", tool_use_id: ev.id, result: "deny", deny_message: "Use the Rainmaker tools instead." }],
        });
      }
      return "continue";
    case "session.usage": {
      const u = ev.usage;
      l.run.usage = {
        inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        outputTokens: u.output_tokens ?? 0,
        costUsd: u.list_cost ? Number(u.list_cost.amount) / 100 : l.run.usage?.costUsd,
      };
      scheduleSave(l);
      return "continue";
    }
    case "session.error":
      emit(l, { kind: "error", text: ev.error.message });
      return "continue";
    case "session.status_idle": {
      const reason = ev.stop_reason.type;
      if (reason === "requires_action") return "continue";
      if (reason === "budget_reached") {
        l.run.status = "stopped";
        l.run.error = `Reached this run's $${(runBudgetCents() / 100).toFixed(2)} spending cap. Raise AGENT_RUN_BUDGET_USD to allow longer runs.`;
        emit(l, { kind: "error", text: l.run.error });
      } else if (reason === "retries_exhausted") {
        l.run.status = "error";
        l.run.error = "Claude ran into repeated errors and stopped. Try again in a few minutes.";
        emit(l, { kind: "error", text: l.run.error });
      } else if (reason === "refusal") {
        l.run.status = "error";
        l.run.error = "Claude declined to continue this task.";
        emit(l, { kind: "error", text: l.run.error });
      }
      return "finished";
    }
    case "session.status_terminated":
      return "finished";
    default:
      return "continue";
  }
}

/** After a dropped stream: answer pending tool calls, or detect we're done. */
async function reconcile(l: Live, sid: string): Promise<"finished" | "continue"> {
  const uses = new Map<string, { id: string; name: string; input: unknown }>();
  const resolved = new Set<string>();
  let lastIdle: string | undefined;
  for await (const ev of claude().beta.sessions.events.list(sid)) {
    if (ev.type === "agent.custom_tool_use") uses.set(ev.id, ev);
    else if (ev.type === "user.custom_tool_result") resolved.add(ev.custom_tool_use_id);
    else if (ev.type === "session.status_idle") lastIdle = ev.stop_reason.type;
    else if (ev.type === "session.status_running") lastIdle = undefined;
    else if (ev.type === "session.status_terminated") return "finished";
  }
  const pending = [...uses.values()].filter((u) => !resolved.has(u.id));
  for (const u of pending) await answerCustomTool(l, sid, u);
  if (!pending.length && lastIdle && lastIdle !== "requires_action") return "finished";
  return "continue";
}

// ── Messages API (agent loop on this server) ──────────────────

async function runMessages(l: Live, message: string, first: boolean) {
  const c = claude();
  const tools: Anthropic.Beta.BetaTool[] = toolsFor(l.def.tools).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  l.messages ??= [];
  if (first) l.messages = [];
  l.messages.push({ role: "user", content: message });
  for (let turn = 0; turn < 40; turn++) {
    if (l.stopRequested || (await stopRequestedElsewhere(l.run.id))) {
      l.stopRequested = true;
      return;
    }
    const res = await c.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: "high" },
        cache_control: { type: "ephemeral" },
        system: l.def.system,
        tools,
        messages: l.messages,
      },
      { signal: l.abort.signal }
    );
    const u = l.run.usage ?? { inputTokens: 0, outputTokens: 0 };
    l.run.usage = {
      inputTokens: u.inputTokens + res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0),
      outputTokens: u.outputTokens + res.usage.output_tokens,
    };
    l.messages.push({ role: "assistant", content: res.content });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (text) emit(l, { kind: "message", text });
    if (res.stop_reason === "refusal") throw new Error("Claude declined to continue this task.");
    if (res.stop_reason === "pause_turn") continue;
    if (res.stop_reason !== "tool_use") return;
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const r = await callTool(l, call.name, call.input);
        return { type: "tool_result", tool_use_id: call.id, content: r.text, is_error: r.isError };
      })
    );
    l.messages.push({ role: "user", content: results });
  }
  emit(l, { kind: "status", text: "Stopped after 40 steps" });
}

// ── Demo mode (no API key): the same tools, scripted ──────────

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseCity(goal: string): string | undefined {
  return placeInText(goal);
}

async function runDemo(l: Live, goal: string) {
  emit(l, { kind: "status", text: "Demo mode: no Claude API key, so this agent follows a fixed script with the real tools" });
  await pause(500);
  const profile = await getProfile();
  if (l.def.id === "prospector") return demoProspector(l, goal, profile);
  if (l.def.id === "outreach") return demoOutreach(l);
  if (l.def.id === "ads") return demoAds(l, goal);
  return demoOps(l);
}

async function demoProspector(l: Live, goal: string, profile: AgencyProfile) {
  const niche = matchNiche(goal) ?? getNiche(profile.targetNiches[0]) ?? NICHES[0];
  const city = parseCity(goal) ?? (profile.city || "Austin, TX");
  emit(l, { kind: "thinking", text: "Thinking" });
  await pause(400);
  const res = await callTool(l, "find_businesses", { niche: niche.id, location: city, limit: 20, audit_top: 8 });
  if (res.isError) {
    emit(l, { kind: "message", text: `The business search failed (${res.summary}), so nothing was saved. Try again in a minute, or try another city.` });
    return;
  }
  const pool = [...l.ctx.prospects.values()].filter((p) => !p.savedLeadId).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const picks = pool.filter((p) => (p.score ?? 0) >= 45).slice(0, 6);
  await pause(300);
  if (picks.length) {
    await callTool(l, "save_leads", {
      leads: picks.map((p) => ({ key: p.key, notes: `Opening angle: ${p.signals?.find((s) => !s.positive)?.label ?? "local visibility"}.` })),
    });
  }
  const best = picks.slice(0, 3).map((p) => `- ${p.name} (score ${p.score}): ${p.signals?.filter((s) => !s.positive).slice(0, 2).map((s) => s.label.toLowerCase()).join(", ") || "few gaps"}`);
  emit(l, {
    kind: "message",
    text: [
      `I looked at ${pool.length} ${niche.plural} near ${city} and saved ${picks.length} with clear gaps you can sell against.`,
      best.length ? `\nBest bets:\n${best.join("\n")}` : "",
      "\nNext: run the Outreach Writer on these leads, or open one and generate a sample ad to send with your first email.",
    ].join("\n"),
  });
}

async function demoOutreach(l: Live) {
  const [leads, drafts, profile] = await Promise.all([listLeads(), listDrafts(), getProfile()]);
  const pending = new Set(drafts.filter((d) => d.status === "pending").map((d) => d.leadId));
  await callTool(l, "list_leads", { stage: "new", without_pending_draft: true, limit: 5 });
  const targets = leads.filter((x) => x.stage === "new" && !pending.has(x.id)).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 4);
  for (const lead of targets) {
    await pause(250);
    const full = await getLead(lead.id);
    if (!full) continue;
    const msg = templateOutreach(full, profile);
    await callTool(l, "draft_message", { lead_id: lead.id, channel: "email", subject: msg.subject, body: msg.body, rationale: msg.rationale });
  }
  emit(l, {
    kind: "message",
    text: targets.length
      ? `Drafted ${targets.length} first-touch emails, each opening with that business's biggest gap. They're waiting in your Inbox for approval.\n\nTemplates in demo mode: add an Anthropic API key and I'll write each one from scratch.`
      : "No new leads without a draft. Run the Prospector first, or pick leads in the Pipeline.",
  });
}

async function demoAds(l: Live, goal: string) {
  const leads = await listLeads();
  const named = leads.find((x) => goal.toLowerCase().includes(x.name.toLowerCase().split(" ")[0]));
  const lead = named ?? [...leads].filter((x) => x.stage !== "won" && x.stage !== "lost").sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  if (!lead) {
    emit(l, { kind: "message", text: "Your pipeline is empty. Find some clients first." });
    return;
  }
  await callTool(l, "get_lead", { lead_id: lead.id });
  await pause(300);
  const niche = getNiche(lead.niche);
  await callTool(l, "create_ad_campaign", {
    lead_id: lead.id,
    business_name: lead.name,
    goal: niche?.booking ? "Book more appointments" : "Get more quote requests",
    offer: niche?.offers[0],
  });
  emit(l, {
    kind: "message",
    text: `Built a starter campaign for ${lead.name} around "${niche?.offers[0] ?? "a clear first-visit offer"}". Open it in Ad Studio to see the previews and creative.\n\nTip: send the Meta ad preview with your first email. A free sample made for them is hard to ignore.`,
  });
}

async function demoOps(l: Live) {
  await callTool(l, "pipeline_summary", {});
  await callTool(l, "list_tasks", {});
  const leads = await listLeads();
  const noNext = leads.filter((x) => !["won", "lost"].includes(x.stage) && !x.nextStep).slice(0, 3);
  for (const lead of noNext) {
    await callTool(l, "update_lead", { lead_id: lead.id, next_step: lead.stage === "new" ? "Send first-touch email" : "Follow up this week" });
  }
  const hot = leads.filter((x) => x.stage === "new" && (x.score ?? 0) >= 70);
  const meeting = leads.filter((x) => x.stage === "meeting");
  const proposal = leads.filter((x) => x.stage === "proposal");
  const plan = [
    proposal[0] && `1. Follow up on the ${proposal[0].name} proposal: it's the closest deal to cash.`,
    meeting[0] && `${proposal[0] ? "2" : "1"}. Prep for ${meeting[0].name}: bring their audit findings and one sample ad.`,
    hot.length ? `- Contact ${hot.length} hot new lead${hot.length > 1 ? "s" : ""} (score 70+) before they go cold.` : "",
    "- Approve or edit the drafts waiting in your Inbox.",
  ].filter(Boolean);
  emit(l, { kind: "message", text: `Here's your plan for today:\n${plan.join("\n")}\n\nPipeline: ${leads.filter((x) => !["won", "lost"].includes(x.stage)).length} open deals.` });
}
