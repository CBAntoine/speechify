"use client";

import { compact, pad2 } from "@/lib/format";
import { STAGES, TOOLS, type JobState, type JobSummary, type StackReport, type YouTubeStatus } from "@/lib/types";
import { YouTubeButton } from "./YouTube";

function modelLabel(model?: string): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model ?? "");
  if (!m) return "";
  return `${m[1].toUpperCase()} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}

export function orchestratorLabel(job: JobState | null, stack: StackReport | null): string {
  if (job?.orchestrator.engine === "claude") return modelLabel(job.orchestrator.model) || "CLAUDE";
  if (job && job.tools.shortsgen.state !== "idle") return "AUTO SCORER";
  return stack?.claude.enabled ? modelLabel(stack.claude.model) || "CLAUDE" : "AUTO SCORER";
}

export function Header(props: {
  job: JobState | null;
  jobs: JobSummary[];
  stack: StackReport | null;
  yt: YouTubeStatus | null;
  onYouTubeSetup: () => void;
  onYouTubeChanged: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onCancel: () => void;
  onRestart: () => void;
}) {
  const { job, jobs, stack } = props;
  // Only show a combined count when (nearly) every repo's stars came back.
  const counts = Object.values(stack?.stars ?? {}).filter((v): v is number => typeof v === "number");
  const stars = counts.length >= 15 ? counts.reduce((a, b) => a + b, 0) : 0;
  const running = job?.status === "running" || job?.status === "queued";
  const posted = job?.shorts.filter((s) => s.youtube && ["processing", "posted", "scheduled"].includes(s.youtube.status)).length ?? 0;
  const liveLabel = job?.status === "running" ? "LIVE RENDER" : job?.status === "queued" ? "QUEUED" : job?.status === "done" ? "RENDER DONE" : job?.status === "failed" ? "FAILED" : job?.status === "canceled" ? "CANCELED" : "READY";
  return (
    <header className="head">
      <div style={{ minWidth: 0 }}>
        <div className="crumb">
          <span className={`dot${running ? "" : " idle"}`} />
          PROJECT / {job?.name ?? "NEW_PROJECT"}
        </div>
        <h1 className="title">
          Clip Factory <em>/18</em>
        </h1>
        <div className="subtitle">
          {orchestratorLabel(job, stack)} × 18 GitHub repos{stars ? ` · ${compact(stars)}★` : ""}
          {job?.orchestrator.usd ? ` · $${job.orchestrator.usd.toFixed(2)}` : ""}
        </div>
        <div className="head-actions">
          <button className="btn primary" onClick={props.onNew}>
            + New VOD
          </button>
          {jobs.length > 0 && (
            <select
              className="btn"
              aria-label="Open a project"
              value={job?.id ?? ""}
              onChange={(e) => e.target.value && props.onOpen(e.target.value)}
            >
              {!job && <option value="">Projects…</option>}
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name} · {j.status === "done" ? `${j.shipped} shorts` : j.status}
                </option>
              ))}
            </select>
          )}
          {running && (
            <button className="btn" onClick={props.onCancel}>
              Stop
            </button>
          )}
          {job && (job.status === "canceled" || job.status === "failed" || job.status === "done") && (
            <button className="btn" onClick={props.onRestart}>
              Run again
            </button>
          )}
          <YouTubeButton yt={props.yt} onSetup={props.onYouTubeSetup} onChanged={props.onYouTubeChanged} />
        </div>
      </div>
      <div className="shipped">
        <div className="label">{liveLabel}</div>
        <div className="label">Shorts shipped</div>
        <div className="count" aria-live="polite">
          {pad2(job?.shipped ?? 0)}
        </div>
        {posted > 0 && <div className="label" style={{ color: "var(--text)" }}>▶ {pad2(posted)} on YouTube</div>}
      </div>
    </header>
  );
}

export function StageBar({ job }: { job: JobState | null }) {
  const stage = STAGES.find((s) => s.id === job?.stage) ?? (job?.status === "done" ? STAGES[5] : STAGES[0]);
  const tool = job?.activeTool ? TOOLS.find((t) => t.id === job.activeTool) : null;
  return (
    <div className="panel stagebar">
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", rowGap: 6, minWidth: 0 }}>
        <span className="n">{pad2(stage.n)} / 06</span>
        <span className="t">{stage.title}</span>
        <span className="b">— {tool ? `${tool.tagline.toLowerCase()}` : stage.blurb}</span>
      </div>
      <div className="chips" aria-label="Pipeline">
        {STAGES.map((s, i) => {
          const st = job?.stages[s.id] ?? "pending";
          const cls = st === "active" ? "active" : st === "done" ? "done" : "";
          return (
            <span key={s.id} style={{ display: "contents" }}>
              {i > 0 && <span className="arrow">→</span>}
              <span className={`chip ${cls}`} data-cur={`stage-${s.id}`}>
                {s.chip}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
