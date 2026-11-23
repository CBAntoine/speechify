"use client";

import { useState } from "react";
import { pad2, seconds } from "@/lib/format";
import { fileUrl, type JobState } from "@/lib/types";

/** Finished shorts: watch, download, copy the post text. */
export function Shelf({ job, onPlay }: { job: JobState | null; onPlay: (id: string) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  if (!job) return null;
  const done = [...job.shorts].filter((s) => s.status === "done" && s.file).sort((a, b) => (a.order ?? a.n) - (b.order ?? b.n));
  if (!done.length) return null;
  const dl = (rel: string) => `${fileUrl(job.id, rel)}?download=1`;
  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  return (
    <section className="panel" aria-label="Shipped shorts">
      <div className="ph">
        <span className="name">SHIPPED / workspace/{job.id}/export</span>
        <span className="right">posting order</span>
      </div>
      <div className="pb" style={{ display: "grid", gap: 12 }}>
        <div className="shelf">
          {done.map((s) => {
            const name = `SHORT_${pad2(s.order ?? s.n)}`;
            const post = `${s.title}\n\n${s.description}\n\n${s.hashtags.map((h) => `#${h}`).join(" ")}`;
            return (
              <article key={s.id} className="card">
                <button className="cover" style={{ backgroundImage: s.cover ? `url(${fileUrl(job.id, s.cover)})` : undefined }} onClick={() => onPlay(s.id)} aria-label={`Play ${name}`}>
                  <span className={`pill score ${s.score >= 80 ? "lime" : s.score >= 60 ? "amber" : ""}`}>{s.score}</span>
                </button>
                <div className="meta">
                  <span className="fn">
                    {name}.mp4 · {seconds(s.duration)}
                    {s.deadAir > 0.5 ? ` · −${s.deadAir.toFixed(1)} s air` : ""}
                  </span>
                  <span className="tt">{s.title}</span>
                  {s.qa && !s.qa.ok && <span className="hint" style={{ color: "var(--amber)" }}>QA: {s.qa.notes.join("; ")}</span>}
                  <div className="acts">
                    <a className="btn lime" href={dl(s.file!)}>
                      ↓ MP4
                    </a>
                    <button className="btn" onClick={() => copy(s.id, post)}>
                      {copied === s.id ? "Copied" : "Copy post"}
                    </button>
                    {s.dubs
                      .filter((d) => d.file)
                      .map((d) => (
                        <a key={d.lang} className="btn" href={dl(d.file!)}>
                          {d.lang.toUpperCase()}
                        </a>
                      ))}
                    {s.raw && (
                      <a className="btn" href={dl(s.raw)} title="Lossless raw cut from the source">
                        Raw
                      </a>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <div className="files">
          <span className="hint" style={{ alignSelf: "center" }}>
            Project files:
          </span>
          <a className="btn" href={dl("export/shorts.csv")}>
            shorts.csv
          </a>
          <a className="btn" href={dl("export/shorts.json")}>
            shorts.json
          </a>
          <a className="btn" href={dl("export/selects.edl")} title="Every kept range in posting order, for Resolve or Premiere">
            selects.edl
          </a>
          <a className="btn" href={dl("export/project.llc")} title="Open the VOD in LosslessCut with these segments">
            project.llc
          </a>
        </div>
      </div>
    </section>
  );
}
