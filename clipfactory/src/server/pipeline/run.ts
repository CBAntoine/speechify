import { emptyStages, emptyTools } from "../../lib/types.ts";
import { getJob, log, saveNow, setRunner, update } from "../jobs.ts";
import { CancelledError } from "../proc.ts";
import { machine } from "../stack.ts";
import { audioStage } from "./audio.ts";
import { captionStage } from "./caption.ts";
import { describeError } from "./claude.ts";
import { Ctx } from "./ctx.ts";
import { momentStage } from "./moment.ts";
import { reframeStage } from "./reframe.ts";
import { shipStage } from "./ship.ts";
import { sourceStage } from "./source.ts";

/** VOD → find the moment → reframe → audio → caption → ship. */
export async function runPipeline(id: string): Promise<void> {
  const m = await machine();
  const job = getJob(id);
  if (!job) return;
  update(id, (s) => {
    s.status = "running";
    s.error = undefined;
    s.stage = null;
    s.stages = emptyStages();
    s.tools = emptyTools();
    s.activeTool = null;
    s.shorts = [];
    s.shipped = 0;
    s.live = {};
    s.analysis = { ...s.analysis, cuts: [], voice: [], game: [] };
    s.orchestrator = { engine: "heuristic" };
  });
  const c = new Ctx(id, m);
  const started = Date.now();
  try {
    if (!m.report.items.ffmpeg.available) throw new Error("FFmpeg isn't installed. Install it (brew install ffmpeg / apt install ffmpeg / winget install ffmpeg) and try again.");
    if (!m.ffmpegHasLibass) c.log("This FFmpeg was built without libass, so captions can't be burned in.", "warn", "remotion");
    if (!m.report.python) c.log("No Python found: every Python tool uses its built-in equivalent. Run `npm run setup` for the full stack.", "warn");
    await sourceStage(c);
    await momentStage(c);
    await reframeStage(c);
    await audioStage(c);
    await captionStage(c);
    await shipStage(c);
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    c.update((s) => {
      s.status = "done";
      s.activeTool = null;
      s.live = { ...s.live, tag: undefined, boxes: undefined };
    });
    log(id, `Done in ${mins} min: ${c.s.shipped} shorts in workspace/${id}/export`, "info");
  } catch (err) {
    const canceled = err instanceof CancelledError || c.signal.aborted;
    update(id, (s) => {
      s.status = canceled ? "canceled" : "failed";
      s.error = canceled ? undefined : describeError(err);
      if (s.activeTool) s.tools[s.activeTool] = { ...s.tools[s.activeTool], state: canceled ? "idle" : "error" };
      s.activeTool = null;
      for (const sh of s.shorts) if (sh.status === "rendering" || sh.status === "queued") sh.status = canceled ? "planned" : "failed";
    });
    log(id, canceled ? "Canceled" : `Failed: ${describeError(err)}`, canceled ? "warn" : "error");
    if (!canceled && process.env.CF_ECHO_LOG) console.error(err);
  } finally {
    saveNow(id);
  }
}

/** Hook the pipeline into the job queue. Re-run on every load so dev reloads pick up new code. */
export function installRunner() {
  setRunner(runPipeline);
}
