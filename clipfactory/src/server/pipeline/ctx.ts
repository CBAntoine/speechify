import path from "node:path";
import type { JobState, LiveInfo, StageId, ToolId, ToolMode, ToolRun } from "../../lib/types.ts";
import { getJob, jobSignal, log, update } from "../jobs.ts";
import { jobDir } from "../paths.ts";
import { CancelledError } from "../proc.ts";
import type { Machine } from "../stack.ts";

/** Everything a stage needs: the job's state, its folder, logging, and the installed stack. */
export class Ctx {
  readonly id: string;
  readonly dir: string;
  readonly signal: AbortSignal;
  readonly m: Machine;
  private started = new Map<ToolId, number>();

  constructor(id: string, machine: Machine) {
    this.id = id;
    this.dir = jobDir(id);
    this.signal = jobSignal(id);
    this.m = machine;
  }

  get s(): JobState {
    const s = getJob(this.id);
    if (!s) throw new Error("Job vanished");
    return s;
  }

  path(...parts: string[]): string {
    return path.join(this.dir, ...parts);
  }

  update(fn: (s: JobState) => void) {
    update(this.id, fn);
  }

  log(msg: string, level: "info" | "warn" | "error" = "info", tool?: ToolId) {
    log(this.id, msg, level, tool);
  }

  check() {
    if (this.signal.aborted) throw new CancelledError();
  }

  stage(stage: StageId) {
    this.check();
    this.update((s) => {
      if (s.stage && s.stage !== stage && s.stages[s.stage] === "active") s.stages[s.stage] = "done";
      s.stage = stage;
      s.stages[stage] = "active";
    });
  }

  endStage(stage: StageId) {
    this.update((s) => {
      s.stages[stage] = "done";
    });
  }

  /** A tool starts working. */
  begin(tool: ToolId, mode: ToolMode, engine: string, note?: string) {
    this.check();
    this.started.set(tool, Date.now());
    this.update((s) => {
      s.activeTool = tool;
      s.tools[tool] = { ...s.tools[tool], state: "active", mode, engine, note };
    });
  }

  /** A tool finished (or was skipped). Time adds up across repeated runs. */
  end(tool: ToolId, patch: Partial<ToolRun> = {}) {
    const t0 = this.started.get(tool);
    this.started.delete(tool);
    this.update((s) => {
      const prev = s.tools[tool];
      s.tools[tool] = { ...prev, state: "done", ...patch, ms: (prev.ms ?? 0) + (t0 ? Date.now() - t0 : 0) };
      if (s.activeTool === tool) s.activeTool = null;
    });
  }

  skip(tool: ToolId, mode: ToolMode, engine: string, note: string) {
    this.update((s) => {
      s.tools[tool] = { ...s.tools[tool], state: "skipped", mode, engine, note };
    });
  }

  /** Re-activate a tool that already ran once (per-short loops). */
  again(tool: ToolId) {
    this.check();
    this.started.set(tool, Date.now());
    this.update((s) => {
      s.activeTool = tool;
      s.tools[tool] = { ...s.tools[tool], state: "active" };
    });
  }

  live(patch: LiveInfo, replace = false) {
    this.update((s) => {
      s.live = replace ? { ...patch } : { ...s.live, ...patch };
    });
  }
}
