"use client";

import { clock } from "@/lib/format";
import { fileUrl, type JobState } from "@/lib/types";

const BARS = 180;

function resample(values: number[], n: number): number[] {
  if (!values.length) return [];
  const out: number[] = [];
  const step = values.length / n;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = Math.floor(i * step); k < Math.max(Math.floor(i * step) + 1, Math.floor((i + 1) * step)) && k < values.length; k++) m = Math.max(m, values[k]);
    out.push(m);
  }
  return out;
}

function Wave({ values, until, color }: { values: number[]; until: number; color: string }) {
  const bars = resample(values, BARS);
  const w = 1000 / BARS;
  return (
    <svg viewBox="0 0 1000 30" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
      {bars.map((p, i) => {
        const h = Math.max(2, p * 28);
        return <rect key={i} x={i * w + w * 0.2} width={w * 0.6} y={15 - h / 2} height={h} fill={i / BARS <= until ? color : "rgba(255,255,255,0.22)"} />;
      })}
    </svg>
  );
}

export function Sequence({ job, selected, onSelect }: { job: JobState | null; selected: string | null; onSelect: (id: string) => void }) {
  const dur = job?.source?.duration || 0;
  const t = job?.live.t ?? 0;
  const at = dur ? Math.min(1, Math.max(0, t / dur)) : 0;
  const hot = job?.activeTool === "scenedetect" || job?.activeTool === "opencut" || job?.activeTool === "losslesscut";
  const sprite = job?.analysis.sprite;
  const showCuts = job?.activeTool === "scenedetect";
  const current = job?.shorts.find((s) => s.id === (selected ?? job.live.shortId));
  const doneUntil = job?.status === "done" ? 1 : at;
  return (
    <section className={`panel${hot ? " hot" : ""}`} aria-label="Sequence timeline">
      <div className="ph">
        <span className="name">SEQUENCE / {job?.name ?? "NEW_PROJECT"}</span>
        <span className="right" style={{ color: "var(--text)" }}>
          {clock(t)}
        </span>
      </div>
      <div className="pb">
        <div className="seq">
          <span className="lab">VIDEO</span>
          <div className="track video">
            {job && sprite && <div className="strip" style={{ backgroundImage: `url(${fileUrl(job.id, sprite.file)})` }} />}
            {current && dur > 0 && <div className="win" style={{ left: `${(current.start / dur) * 100}%`, width: `${((current.end - current.start) / dur) * 100}%` }} />}
            {dur > 0 &&
              (job?.analysis.cuts ?? []).slice(0, 400).map((c, i) => <span key={i} className="cutmark" style={{ left: `${(c / dur) * 100}%`, opacity: showCuts ? 1 : 0.35 }} />)}
          </div>
          <span className="lab">CAPTIONS</span>
          <div className="track captions">
            {dur > 0 &&
              job?.shorts.map((s) => (
                <button
                  key={s.id}
                  className={`cap${s.status === "done" ? " done" : ""}${s.id === current?.id ? " on" : ""}`}
                  style={{ left: `${(s.start / dur) * 100}%`, width: `${Math.max(0.6, ((s.end - s.start) / dur) * 100)}%` }}
                  onClick={() => onSelect(s.id)}
                  aria-label={`${s.title} (score ${s.score})`}
                  title={`${s.hook} · ${s.title}`}
                />
              ))}
          </div>
          <span className="lab">GAME SFX</span>
          <div className="track">
            <Wave values={job?.analysis.game.length ? job.analysis.game : (job?.analysis.peaks ?? [])} until={doneUntil} color="#c8ff3d" />
          </div>
          <span className="lab">VOICE</span>
          <div className="track">
            <Wave values={job?.analysis.voice.length ? job.analysis.voice : (job?.analysis.peaks ?? [])} until={doneUntil} color="#a98bff" />
          </div>
          {dur > 0 && (
            <div style={{ position: "absolute", left: 72, right: 0, top: 0, bottom: 0, pointerEvents: "none" }}>
              <div className="playhead" style={{ left: `${at * 100}%` }} data-cur="playhead" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
