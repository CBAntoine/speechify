import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_OPTIONS,
  emptyStages,
  emptyTools,
  type JobOptions,
  type JobState,
  type JobSummary,
  type LogLine,
  type ToolId,
} from "../lib/types.ts";
import { jobDir, WORKSPACE } from "./paths.ts";

type Listener = (state: JobState) => void;

interface Entry {
  state: JobState;
  listeners: Set<Listener>;
  abort: AbortController;
  broadcastTimer: NodeJS.Timeout | null;
  saveTimer: NodeJS.Timeout | null;
}

type Runner = (id: string) => Promise<void>;

interface Registry {
  jobs: Map<string, Entry>;
  loaded: boolean;
  queue: string[];
  running: number;
  runner: Runner | null;
}

// One registry per server process, even if Next.js loads this module twice.
const g = globalThis as unknown as { __clipFactory?: Registry };
const reg: Registry = (g.__clipFactory ??= { jobs: new Map(), loaded: false, queue: [], running: 0, runner: null });

const MAX_PARALLEL = Math.max(1, Number(process.env.CF_MAX_JOBS || 1));
const LOG_KEEP = 250;

export function setRunner(runner: Runner) {
  reg.runner = runner;
}

/** Load jobs saved on disk (once), or pick up folders made since (e.g. by the CLI) with rescan. */
function load(rescan = false) {
  if (reg.loaded && !rescan) return;
  reg.loaded = true;
  if (!fs.existsSync(WORKSPACE)) return;
  for (const name of fs.readdirSync(WORKSPACE)) {
    if (reg.jobs.has(name)) continue;
    const file = path.join(WORKSPACE, name, "job.json");
    if (!fs.existsSync(file)) continue;
    try {
      const state = JSON.parse(fs.readFileSync(file, "utf8")) as JobState;
      if (state.status === "running" || state.status === "queued") {
        state.status = "failed";
        state.error = "The server stopped while this job was running. Start it again to redo it.";
        state.activeTool = null;
      }
      for (const sh of state.shorts ?? []) {
        if (sh.youtube && (sh.youtube.status === "queued" || sh.youtube.status === "uploading")) {
          sh.youtube = { ...sh.youtube, status: "failed", error: "The server stopped during the upload. Post it again." };
        }
      }
      reg.jobs.set(state.id, { state, listeners: new Set(), abort: new AbortController(), broadcastTimer: null, saveTimer: null });
    } catch {
      /* skip unreadable job */
    }
  }
}

export function newJobId(): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  return `${stamp}-${crypto.randomBytes(3).toString("hex")}`;
}

export function createJob(options: Partial<JobOptions>, id = newJobId()): JobState {
  load();
  const dir = jobDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const now = Date.now();
  const state: JobState = {
    id,
    name: options.name || "NEW_PROJECT",
    createdAt: now,
    updatedAt: now,
    status: "queued",
    stage: null,
    stages: emptyStages(),
    activeTool: null,
    tools: emptyTools(),
    options: { ...DEFAULT_OPTIONS, ...options },
    orchestrator: { engine: "heuristic" },
    analysis: { peaks: [], voice: [], game: [], cuts: [] },
    shorts: [],
    shipped: 0,
    live: {},
    log: [],
  };
  reg.jobs.set(id, { state, listeners: new Set(), abort: new AbortController(), broadcastTimer: null, saveTimer: null });
  saveNow(id);
  return state;
}

export function getJob(id: string): JobState | null {
  load();
  return reg.jobs.get(id)?.state ?? null;
}

export function listJobs(): JobSummary[] {
  load(true);
  return [...reg.jobs.values()]
    .map(({ state: s }) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      createdAt: s.createdAt,
      shipped: s.shipped,
      total: s.shorts.length,
      duration: s.source?.duration,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function jobSignal(id: string): AbortSignal {
  const e = reg.jobs.get(id);
  if (!e) throw new Error("No such job");
  return e.abort.signal;
}

/** Change a job's state. Listeners hear about it within ~120 ms; it's saved within a second. */
export function update(id: string, mutate: (s: JobState) => void) {
  const e = reg.jobs.get(id);
  if (!e) return;
  mutate(e.state);
  e.state.updatedAt = Date.now();
  if (!e.broadcastTimer) {
    e.broadcastTimer = setTimeout(() => {
      e.broadcastTimer = null;
      for (const l of e.listeners) l(e.state);
    }, 120);
  }
  if (!e.saveTimer) {
    e.saveTimer = setTimeout(() => {
      e.saveTimer = null;
      saveNow(id);
    }, 1000);
  }
}

export function log(id: string, msg: string, level: LogLine["level"] = "info", tool?: ToolId) {
  update(id, (s) => {
    s.log.push({ t: Date.now(), level, tool, msg });
    if (s.log.length > LOG_KEEP) s.log.splice(0, s.log.length - LOG_KEEP);
  });
  if (process.env.CF_ECHO_LOG) console.log(`[${id}]${tool ? ` ${tool}:` : ""} ${msg}`);
}

export function saveNow(id: string) {
  const e = reg.jobs.get(id);
  if (!e) return;
  const file = path.join(jobDir(id), "job.json");
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(e.state));
    fs.renameSync(tmp, file);
  } catch {
    /* the folder may have been deleted */
  }
}

export function subscribe(id: string, listener: Listener): () => void {
  load();
  const e = reg.jobs.get(id);
  if (!e) return () => {};
  e.listeners.add(listener);
  return () => e.listeners.delete(listener);
}

export function enqueue(id: string) {
  load();
  const e = reg.jobs.get(id);
  if (!e) throw new Error("No such job");
  if (e.state.status === "running") return;
  if (e.abort.signal.aborted) e.abort = new AbortController();
  update(id, (s) => {
    s.status = "queued";
    s.error = undefined;
  });
  if (!reg.queue.includes(id)) reg.queue.push(id);
  pump();
}

function pump() {
  while (reg.running < MAX_PARALLEL && reg.queue.length && reg.runner) {
    const id = reg.queue.shift()!;
    const runner = reg.runner;
    reg.running++;
    runner(id)
      .catch(() => {})
      .finally(() => {
        reg.running--;
        saveNow(id);
        pump();
      });
  }
}

export function cancel(id: string) {
  const e = reg.jobs.get(id);
  if (!e) return;
  reg.queue = reg.queue.filter((q) => q !== id);
  e.abort.abort();
  if (e.state.status === "queued") {
    update(id, (s) => {
      s.status = "canceled";
    });
  }
}

export function removeJob(id: string): boolean {
  const e = reg.jobs.get(id);
  if (!e) return false;
  if (e.state.status === "running") return false;
  reg.jobs.delete(id);
  fs.rmSync(jobDir(id), { recursive: true, force: true });
  return true;
}
