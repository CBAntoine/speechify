"use client";

import { pad2 } from "@/lib/format";
import { fileUrl, type JobState } from "@/lib/types";

export function RenderQueue({ job, selected, onSelect }: { job: JobState | null; selected: string | null; onSelect: (id: string) => void }) {
  const hot = job?.activeTool === "moviepy" || job?.activeTool === "ffmpeg";
  const shorts = job ? [...job.shorts].sort((a, b) => (a.order ?? a.n) - (b.order ?? b.n)) : [];
  const batch = job && (job.stage === "caption" || job.stage === "ship") && shorts.length ? `batch ×${shorts.length}` : "";
  const sprite = job?.analysis.sprite;
  const dur = job?.source?.duration || 1;
  return (
    <section className={`panel${hot ? " hot" : ""}`} aria-label="Render queue">
      <div className="ph">
        <span className="name">RENDER QUEUE</span>
        <span className="right">{batch}</span>
      </div>
      <div className="pb">
        <div className="queue">
          {!shorts.length && <div className="hint" style={{ padding: "8px 4px" }}>Shorts appear here once the moments are picked.</div>}
          {shorts.map((s) => {
            const active = s.status === "rendering";
            const working = active || (!shorts.some((x) => x.status === "rendering") && s.id === job?.live.shortId);
            const done = s.status === "done";
            const idx = sprite ? Math.min(sprite.count - 1, Math.floor(((s.start + s.end) / 2 / dur) * sprite.count)) : 0;
            const thumb = s.cover
              ? { backgroundImage: `url(${fileUrl(job!.id, s.cover)})`, backgroundPosition: "center 30%" }
              : sprite
                ? { backgroundImage: `url(${fileUrl(job!.id, sprite.file)})`, backgroundSize: `${sprite.count * 100}% 100%`, backgroundPosition: `${(idx / Math.max(1, sprite.count - 1)) * 100}% 0` }
                : {};
            return (
              <button
                key={s.id}
                className={`qrow${active ? " active" : ""}${selected === s.id ? " sel" : ""}`}
                onClick={() => onSelect(s.id)}
                data-cur={working ? "queue-active" : undefined}
                title={`${s.title}\n${s.reason}`}
              >
                <span className="thumb" style={thumb} />
                <span style={{ minWidth: 0 }}>
                  <span className="name">SHORT_{pad2(s.order ?? s.n)}.mp4</span>
                  <span className="bar" style={{ display: "block" }}>
                    <i style={{ width: `${Math.round((done ? 1 : s.progress) * 100)}%` }} />
                  </span>
                </span>
                <span className={`pct${done ? " ok" : ""}`}>{done ? (s.qa && !s.qa.ok ? "!" : "✓") : s.status === "failed" ? "✕" : s.progress > 0 ? `${Math.round(s.progress * 100)}%` : "—"}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
