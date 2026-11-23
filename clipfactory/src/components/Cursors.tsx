"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { pad2 } from "@/lib/format";
import { COLORS, TOOL, type JobState, type ToolId } from "@/lib/types";

// Multiplayer-style cursors, one per agent: the orchestrator, the tool at
// work, the caption typesetter, the render node and the QA agent. Each one
// points at whatever its agent is doing right now.

interface Cursor {
  id: string;
  label: string;
  color: string;
  /** data-cur targets, first match wins. */
  targets: string[];
  /** Where on the target to point, 0..1. */
  fx: number;
  fy: number;
}

const TOOL_TARGET: Partial<Record<ToolId, string[]>> = {
  whisperx: ["monitor-focus", "inspector"],
  shortsgen: ["inspector", "monitor-focus"],
  autoeditor: ["inspector"],
  demucs: ["inspector"],
  deepfilter: ["inspector"],
  f5tts: ["inspector", "monitor-focus"],
  remotion: ["output-caption"],
  moviepy: ["queue-active", "output-caption"],
  losslesscut: ["monitor-focus", "playhead"],
  opencut: ["playhead", "monitor-focus"],
  ffmpeg: ["queue-active", "monitor-focus"],
};

function orchestratorName(job: JobState): string {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(job.orchestrator.model ?? "");
  if (job.orchestrator.engine === "claude" && m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
  return "auto";
}

function build(job: JobState, flip: boolean): Cursor[] {
  const out: Cursor[] = [];
  const tool = job.activeTool ? TOOL[job.activeTool] : null;
  out.push({
    id: "orchestrator",
    label: `${orchestratorName(job)} · orchestrator`,
    color: COLORS.CYAN,
    targets: flip && tool ? [`stack-${tool.id}`, `stage-${job.stage}`] : [`stage-${job.stage}`, "monitor"],
    fx: 0.55,
    fy: 0.7,
  });
  if (tool) {
    out.push({
      id: `tool`,
      label: `${pad2(tool.n)} ${tool.verb}`,
      color: tool.color,
      targets: [...(TOOL_TARGET[tool.id] ?? ["monitor-focus"]), "monitor"],
      fx: 0.62,
      fy: 0.55,
    });
  }
  if (job.shorts.length) {
    out.push({ id: "type", label: "12 Type", color: COLORS.AMBER, targets: ["output-caption"], fx: 0.92, fy: 0.6 });
  }
  if (job.stage === "caption" || job.stage === "ship") {
    out.push({ id: "render", label: "render-node", color: "#ffd23a", targets: ["queue-active", "inspector"], fx: 0.97, fy: 0.75 });
  }
  out.push({ id: "qa", label: "qa-agent", color: COLORS.LIME, targets: ["playhead"], fx: 0.5, fy: 0.82 });
  return out;
}

export function Cursors({ root, job }: { root: RefObject<HTMLDivElement | null>; job: JobState }) {
  const [pos, setPos] = useState<Record<string, { x: number; y: number }>>({});
  const [flip, setFlip] = useState(false);
  useEffect(() => {
    const i = setInterval(() => setFlip((f) => !f), 4200);
    return () => clearInterval(i);
  }, []);
  const cursors = useMemo(() => build(job, flip), [job, flip]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const next: Record<string, { x: number; y: number }> = {};
      for (const c of cursors) {
        let target: Element | null = null;
        for (const sel of c.targets) {
          target = el.querySelector(`[data-cur="${sel}"]`);
          if (target) break;
        }
        if (!target) continue;
        const t = target.getBoundingClientRect();
        next[c.id] = { x: Math.round(t.left - r.left + t.width * c.fx), y: Math.round(t.top - r.top + t.height * c.fy) };
      }
      setPos((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    place();
    const i = setInterval(place, 450);
    window.addEventListener("resize", place);
    return () => {
      clearInterval(i);
      window.removeEventListener("resize", place);
    };
  }, [root, cursors]);

  return (
    <div className="cursors" aria-hidden="true">
      {cursors.map((c) => {
        const p = pos[c.id];
        if (!p) return null;
        return (
          <div key={c.id} className="cur" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
            <div className="wob">
              <svg width="16" height="20" viewBox="0 0 16 20">
                <path d="M1 1 L1 16.5 L5.2 12.6 L8.1 19 L10.6 17.9 L7.8 11.6 L13.6 11.6 Z" fill={c.color} stroke="#0b0b11" strokeWidth="1.2" strokeLinejoin="round" />
              </svg>
              <span className="tag" style={{ background: c.color }}>
                {c.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
