import { EventEmitter } from "node:events";
import { insertEvent } from "./db.ts";
import type { AgentId, AgentStatus, CrewEvent, Lead } from "./types.ts";

// The crew's activity log and live status. Everything an agent does is an
// event: it's saved (so Atlas can summarise the day), streamed to the
// dashboard over SSE and printed to the console.

export const bus = new EventEmitter();
bus.setMaxListeners(200);

export interface AgentInfo {
  id: AgentId;
  name: string;
  role: string;
  does: string;
}

export const AGENTS: AgentInfo[] = [
  {
    id: "orchestrator",
    name: "Atlas",
    role: "Orchestrator",
    does: "Runs the crew around the clock: sets the day's targets, keeps every agent fed, enforces budgets and wakes you only for big deals or a falling response rate.",
  },
  {
    id: "scout",
    name: "Scout",
    role: "Finds businesses",
    does: "Scans Google Maps in your target cities for businesses with no website or one from 2014, checks every site and scores the opportunity.",
  },
  {
    id: "diagnoser",
    name: "Diagnoser",
    role: "Explains the problem",
    does: "Writes what's wrong and what it costs them, using only facts from the listing and the site.",
  },
  {
    id: "builder",
    name: "Builder",
    role: "Builds the mockups",
    does: "Plans the content, gets a hero image from ElevenLabs and builds three landing-page designs with the business's real hours, phone and reviews.",
  },
  {
    id: "filmer",
    name: "Filmer",
    role: "Makes the video",
    does: "Writes a short script, records it with an ElevenLabs voice and films the new site scrolling on a phone, with captions.",
  },
  {
    id: "pitcher",
    name: "Pitcher",
    role: "Sends the pitch",
    does: "Writes the email, follow-ups, text, DM and call script, checks compliance and sends within your daily cap.",
  },
  {
    id: "checker",
    name: "Checker",
    role: "Guards spend and quality",
    does: "Estimates the cost before every paid call, checks credits and budgets, and stops anything invented from reaching a site or an email.",
  },
  {
    id: "closer",
    name: "Closer",
    role: "Handles replies",
    does: "Reads every reply, answers questions, sends the payment link, books calls and launches the site when they pay.",
  },
];

export const agentName = (id: string) => AGENTS.find((a) => a.id === id)?.name ?? id;

type Level = CrewEvent["level"];

export function log(agent: CrewEvent["agent"], message: string, opts: { level?: Level; lead?: Pick<Lead, "id" | "name"> } = {}): CrewEvent {
  const e = insertEvent({ agent, level: opts.level ?? "info", leadId: opts.lead?.id, leadName: opts.lead?.name, message });
  bus.emit("crew-event", e);
  const tag = `[${agent}]`.padEnd(15);
  const line = `${tag}${opts.lead ? `${opts.lead.name}: ` : ""}${message}`;
  if (e.level === "error") console.error(line);
  else if (e.level === "warn") console.warn(line);
  else if (process.env.QUIET !== "1") console.log(line);
  hintOverview();
  return e;
}

export function leadChanged(lead: Pick<Lead, "id" | "name" | "status">): void {
  bus.emit("lead", { id: lead.id, name: lead.name, status: lead.status });
  hintOverview();
}

let hintTimer: NodeJS.Timeout | undefined;
/** Tell dashboards to refetch the overview, at most every 2 seconds. */
export function hintOverview(): void {
  if (hintTimer) return;
  hintTimer = setTimeout(() => {
    hintTimer = undefined;
    bus.emit("overview", {});
  }, 2000);
  hintTimer.unref?.();
}

// ── Live agent state ─────────────────────────────────────────────────────

interface Live {
  state: AgentStatus["state"];
  current?: string;
  lastRunAt?: string;
  jobs: number;
}

const live = new Map<AgentId, Live>(AGENTS.map((a) => [a.id, { state: "idle", jobs: 0 }]));

function emitAgent(id: AgentId) {
  const info = AGENTS.find((a) => a.id === id)!;
  const l = live.get(id)!;
  bus.emit("agent", { id, name: info.name, role: info.role, state: l.state, current: l.current, lastRunAt: l.lastRunAt, doneToday: 0, errorsToday: 0 } satisfies AgentStatus);
}

/** Mark an agent busy while `fn` runs. Nested/parallel jobs are counted. */
export async function working<T>(id: AgentId, current: string, fn: () => Promise<T>): Promise<T> {
  const l = live.get(id)!;
  l.jobs += 1;
  l.state = "working";
  l.current = current;
  l.lastRunAt = new Date().toISOString();
  emitAgent(id);
  try {
    return await fn();
  } catch (err) {
    l.state = "error";
    throw err;
  } finally {
    l.jobs = Math.max(0, l.jobs - 1);
    if (l.jobs === 0) {
      if (l.state !== "error") l.state = "idle";
      l.current = undefined;
    }
    emitAgent(id);
  }
}

export function liveState(id: AgentId): Live {
  return live.get(id)!;
}

export function clearAgentError(id: AgentId): void {
  const l = live.get(id)!;
  if (l.state === "error" && l.jobs === 0) l.state = "idle";
}
