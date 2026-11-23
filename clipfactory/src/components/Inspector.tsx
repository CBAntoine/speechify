"use client";

import { useEffect, useRef, useState } from "react";
import { TOOL, type JobState, type ToolId } from "@/lib/types";

const AUDIO_TOOLS: ToolId[] = ["autoeditor", "demucs", "deepfilter", "f5tts"];

export function Inspector({ job, video }: { job: JobState | null; video: HTMLVideoElement | null }) {
  const tool = job?.activeTool ? TOOL[job.activeTool] : null;
  const hot = Boolean(job?.activeTool && AUDIO_TOOLS.includes(job.activeTool));
  const l = job?.live;
  let body: React.ReactNode;
  if (job?.activeTool === "autoeditor" && l?.silence) body = <Silence peaks={l.silence.peaks} regions={l.silence.regions} span={l.silence.span} />;
  else if (job?.activeTool === "demucs" && l?.stems?.length) body = <Stems stems={l.stems} />;
  else if (job?.activeTool === "deepfilter" && l?.wave) body = <Denoise wave={l.wave} noise={l.noise} />;
  else if (job?.activeTool === "f5tts" && l?.dub) body = <Dub job={job} />;
  else if (job?.activeTool === "whisperx") body = <Transcript caption={l?.caption} t={l?.t} />;
  else if (job?.activeTool === "shortsgen" || (job?.stage === "moment" && job.shorts.length && !job.activeTool)) body = <Scores job={job} />;
  else body = <Histogram video={video} />;
  return (
    <section className={`panel${hot ? " hot" : ""}`} aria-label="Inspector">
      <div className="ph">
        <span className="name">INSPECTOR / {tool ? tool.name.toUpperCase() : "PROGRAM"}</span>
        <span className="right">live</span>
      </div>
      <div className="pb">
        <div className="inspector" data-cur="inspector">
          {body}
        </div>
      </div>
    </section>
  );
}

/** RGB histogram of the program monitor's current frame, drawn like a scope. */
function Histogram({ video }: { video: HTMLVideoElement | null }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    const probe = document.createElement("canvas");
    probe.width = 96;
    probe.height = 54;
    const pctx = probe.getContext("2d", { willReadFrequently: true });
    if (!ctx || !pctx) return;
    let raf = 0;
    let last = 0;
    const bins = 48;
    const prev = [new Float32Array(bins), new Float32Array(bins), new Float32Array(bins)];
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 120) return;
      last = now;
      const W = (c.width = c.clientWidth * devicePixelRatio);
      const H = (c.height = c.clientHeight * devicePixelRatio);
      ctx.clearRect(0, 0, W, H);
      const hist = [new Float32Array(bins), new Float32Array(bins), new Float32Array(bins)];
      if (video && video.readyState >= 2) {
        try {
          pctx.drawImage(video, 0, 0, probe.width, probe.height);
          const d = pctx.getImageData(0, 0, probe.width, probe.height).data;
          for (let i = 0; i < d.length; i += 4) {
            hist[0][(d[i] * bins) >> 8]++;
            hist[1][(d[i + 1] * bins) >> 8]++;
            hist[2][(d[i + 2] * bins) >> 8]++;
          }
        } catch {
          /* frame not readable yet */
        }
      }
      const max = Math.max(1, ...hist.flatMap((h) => Array.from(h)));
      const colors = ["rgba(255,61,110,0.75)", "rgba(80,220,140,0.65)", "rgba(80,110,255,0.75)"];
      ctx.globalCompositeOperation = "screen";
      for (let ch = 0; ch < 3; ch++) {
        ctx.beginPath();
        ctx.moveTo(0, H);
        for (let b = 0; b < bins; b++) {
          prev[ch][b] = prev[ch][b] * 0.55 + (hist[ch][b] / max) * 0.45;
          const x = (b / (bins - 1)) * W;
          const y = H - Math.sqrt(prev[ch][b]) * H * 0.92;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fillStyle = colors[ch];
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = `${10 * devicePixelRatio}px "JetBrains Mono Variable", monospace`;
      ctx.fillText("RGB HISTOGRAM · live frame", 2, 12 * devicePixelRatio);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video]);
  return <canvas ref={canvas} aria-label="RGB histogram of the current frame" />;
}

function Bars({ peaks, color, y, h, mirror = true }: { peaks: number[]; color: string | ((i: number) => string); y: number; h: number; mirror?: boolean }) {
  const n = peaks.length || 1;
  const w = 1000 / n;
  return (
    <>
      {peaks.map((p, i) => {
        const bh = Math.max(1.5, p * h);
        return <rect key={i} x={i * w + w * 0.18} width={w * 0.64} y={mirror ? y - bh / 2 : y - bh} height={bh} rx={w * 0.3} fill={typeof color === "string" ? color : color(i)} />;
      })}
    </>
  );
}

function Silence({ peaks, regions, span }: { peaks: number[]; regions: [number, number][]; span: [number, number] }) {
  const len = span[1] - span[0] || 1;
  const inRegion = (i: number) => regions.some(([a, b]) => (i / peaks.length) * len >= a && (i / peaks.length) * len <= b);
  return (
    <svg viewBox="0 0 1000 170" preserveAspectRatio="none">
      {regions.map(([a, b], i) => (
        <g key={i}>
          <rect x={(a / len) * 1000} width={Math.max(6, ((b - a) / len) * 1000)} y={14} height={150} fill="rgba(255,61,110,0.32)" stroke="#ff3d6e" strokeDasharray="5 4" strokeWidth={2} />
          <rect x={(a / len) * 1000 + 2} y={16} width={74} height={18} rx={3} fill="#ff3d6e" />
          <text x={(a / len) * 1000 + 39} y={29} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle" fontFamily="JetBrains Mono Variable, monospace">
            SILENCE
          </text>
        </g>
      ))}
      <Bars peaks={peaks} y={92} h={130} color={(i) => (inRegion(i) ? "rgba(255,255,255,0.35)" : "#f2f2f6")} />
    </svg>
  );
}

const STEM_COLORS: Record<string, string> = { VOCALS: "#3ee0ff", DRUMS: "#ff3d6e", BASS: "#a98bff", OTHER: "#ffd23a" };

function Stems({ stems }: { stems: { name: string; peaks: number[] }[] }) {
  const rowH = 170 / stems.length;
  return (
    <svg viewBox="0 0 1000 170" preserveAspectRatio="none">
      {stems.map((s, i) => (
        <g key={s.name}>
          <text x={2} y={i * rowH + rowH / 2 + 4} fill={STEM_COLORS[s.name] ?? "#ccc"} fontSize={11} fontWeight={800} fontFamily="JetBrains Mono Variable, monospace">
            {s.name}
          </text>
          <g transform="translate(110 0) scale(0.89 1)">
            <Bars peaks={s.peaks} y={i * rowH + rowH / 2} h={rowH * 0.85} color={STEM_COLORS[s.name] ?? "#ccc"} />
          </g>
        </g>
      ))}
    </svg>
  );
}

function Denoise({ wave, noise }: { wave: number[]; noise?: { before: number; after: number } }) {
  return (
    <>
      <svg viewBox="0 0 1000 170" preserveAspectRatio="none">
        <Bars peaks={wave} y={90} h={150} color={(i) => (i < wave.length * 0.12 ? "#c8ff3d" : "rgba(255,255,255,0.55)")} />
      </svg>
      {noise && (
        <span className="pill lime" style={{ position: "absolute", left: 6, top: 8 }}>
          NOISE {noise.after} dB {noise.before !== noise.after ? `(was ${noise.before})` : ""}
        </span>
      )}
    </>
  );
}

function Dub({ job }: { job: JobState }) {
  const d = job.live.dub!;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="lang-chips">
        {[d.from, ...d.to].map((l, i) => (
          <span key={`${l}${i}`} className={i === 0 || d.done.includes(l) ? "on" : ""}>
            {l} {i === 0 || d.done.includes(l) ? "✓" : ""}
          </span>
        ))}
      </div>
      <svg viewBox="0 0 1000 120" preserveAspectRatio="none" style={{ flex: 1 }}>
        <Bars peaks={job.live.wave ?? job.analysis.voice.slice(0, 120)} y={60} h={110} color="#a98bff" />
      </svg>
    </div>
  );
}

function Transcript({ caption, t }: { caption?: string; t?: number }) {
  const [lines, setLines] = useState<{ t: number; text: string }[]>([]);
  useEffect(() => {
    if (!caption) return;
    setLines((ls) => (ls[ls.length - 1]?.text === caption ? ls : [...ls.slice(-6), { t: t ?? 0, text: caption }]));
  }, [caption, t]);
  if (!lines.length) return <div className="note">Transcribing…</div>;
  return (
    <div className="transcript-live">
      {lines.map((l, i) => (
        <div key={i}>
          <span className="t">{new Date(l.t * 1000).toISOString().slice(l.t >= 3600 ? 11 : 14, 19)}</span>
          {l.text}
        </div>
      ))}
    </div>
  );
}

function Scores({ job }: { job: JobState }) {
  if (!job.shorts.length) return <div className="note">{job.live.tag ?? "Scoring every moment…"}</div>;
  const shorts = [...job.shorts].sort((a, b) => a.start - b.start);
  const dur = job.source?.duration || 1;
  return (
    <svg viewBox="0 0 1000 170" preserveAspectRatio="none">
      <line x1={0} x2={1000} y1={150} y2={150} stroke="rgba(255,255,255,0.15)" />
      {shorts.map((s) => {
        const x = (s.start / dur) * 1000;
        const w = Math.max(8, ((s.end - s.start) / dur) * 1000);
        const h = (s.score / 100) * 125;
        return (
          <g key={s.id}>
            <rect x={x} width={w} y={150 - h} height={h} rx={3} fill={s.score >= 80 ? "#c8ff3d" : s.score >= 60 ? "#ffb03a" : "#ff3d6e"} opacity={0.85} />
            <text x={x + w / 2} y={144 - h} fill="#ececf3" fontSize={12} fontWeight={800} textAnchor="middle" fontFamily="JetBrains Mono Variable, monospace">
              {s.score}
            </text>
          </g>
        );
      })}
      <text x={2} y={166} fill="rgba(255,255,255,0.4)" fontSize={11} fontFamily="JetBrains Mono Variable, monospace">
        VIRAL SCORE · across the VOD
      </text>
    </svg>
  );
}
