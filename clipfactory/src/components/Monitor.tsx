"use client";

import { useEffect, useRef } from "react";
import { pad2, timecode } from "@/lib/format";
import { fileUrl, TOOL, type Box, type JobState, type Short, type StackReport, type ToolId, type YouTubeStatus } from "@/lib/types";
import { SourceForm } from "./SourceForm";

const ON_MONITOR: ToolId[] = ["ytdlp", "scenedetect", "whisperx", "mediapipe", "yolo", "sam2", "esrgan", "rife"];

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const boxStyle = (b: Box) => ({ left: pct(b.x), top: pct(b.y), width: pct(b.w), height: pct(b.h) });

export function Monitor(props: {
  job: JobState | null;
  stack: StackReport | null;
  focus: Short | null;
  showForm: boolean;
  yt: YouTubeStatus | null;
  onCloseForm?: () => void;
  onStarted: (id: string) => void;
  onVideo: (v: HTMLVideoElement | null) => void;
}) {
  const { job, focus } = props;
  const ref = useRef<HTMLVideoElement>(null);
  const src = job?.source;
  const media = job && src?.media ? fileUrl(job.id, src.media) : null;
  const ready = Boolean(job && job.stages.source !== "pending" && (job.tools.scenedetect.state !== "idle" || job.stages.source === "done"));
  const target = focus ? focus.start + 0.5 : (job?.live.t ?? 0);
  const tool = job?.activeTool ? TOOL[job.activeTool] : null;
  const short = job?.shorts.find((s) => s.id === (focus?.id ?? job.live.shortId));
  const { onVideo } = props;

  useEffect(() => {
    onVideo(ref.current);
  }, [media, ready, onVideo]);

  // Seek to whatever the pipeline is looking at, and keep playing a few seconds around it.
  useEffect(() => {
    const v = ref.current;
    if (!v || !Number.isFinite(target)) return;
    const go = () => {
      if (Math.abs(v.currentTime - target) > 1.2) v.currentTime = Math.max(0, target);
      v.play().catch(() => {});
    };
    if (v.readyState >= 1) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
  }, [target, media, ready]);

  const hot = Boolean(job?.activeTool && ON_MONITOR.includes(job.activeTool));
  const label = src ? `${src.uploader ? src.uploader.slice(0, 18) : "VOD"} · ${job?.analysis.facecam ? "facecam" : `${src.height}p`}` : "no source";
  return (
    <section className={`panel${hot ? " hot" : ""}`} aria-label="Program monitor">
      <div className="ph">
        <span className="name">PROGRAM / SOURCE_{pad2(short?.n ?? 1)}</span>
        <span className="right">{label}</span>
      </div>
      <div className="pb">
        <div className={`screen${props.showForm ? " form-open" : ""}`} style={{ aspectRatio: src ? `${src.width} / ${src.height}` : "16 / 9" }} data-cur="monitor">
          {media && ready ? (
            <video
              ref={ref}
              key={media}
              src={media}
              muted
              playsInline
              preload="auto"
              crossOrigin="anonymous"
              onTimeUpdate={(e) => {
                const v = e.currentTarget;
                if (v.currentTime > target + 7) v.currentTime = Math.max(0, target);
              }}
            />
          ) : (
            <div className="empty">{job ? (job.status === "queued" ? "Queued…" : "Pulling the VOD…") : ""}</div>
          )}
          {job && !props.showForm && <Overlays job={job} short={short ?? null} />}
          {props.showForm && <SourceForm stack={props.stack} yt={props.yt} onStarted={props.onStarted} onClose={props.onCloseForm} />}
        </div>
        <div className="foot">
          <span>{tool ? `${tool.name} · ${tool.repo.split("/")[0]}` : (src?.title ?? "Paste a VOD link or drop a video")}</span>
          <span className="tc">{timecode(target)}</span>
        </div>
      </div>
    </section>
  );
}

function Overlays({ job, short }: { job: JobState; short: Short | null }) {
  const l = job.live;
  const t = job.activeTool;
  const out: React.ReactNode[] = [];
  const focus = { "data-cur": "monitor-focus" } as Record<string, string>;

  if (t === "ytdlp" && l.download) {
    out.push(
      <div key="dl" className="ov dl" {...focus}>
        <div>
          {job.tools.ytdlp.mode === "native" ? "yt-dlp" : "download"} {l.download.format ? `· ${l.download.format}` : ""} {l.download.size ? `· ${l.download.size}` : ""}
        </div>
        <div style={{ color: "var(--dim)" }}>
          {l.download.pct.toFixed(0)}% {l.download.speed ? `· ${l.download.speed}` : ""}
        </div>
        <div className="bar">
          <i style={{ width: `${l.download.pct}%` }} />
        </div>
      </div>,
    );
  }
  if (t === "scenedetect" && l.cut) {
    out.push(
      <div key="cut" className="ov top" {...focus}>
        <span className="pill">
          SCENE {String(l.cut.index).padStart(3, "0")} · cut @ {timecode(l.cut.t)}
        </span>
      </div>,
    );
  }
  if (t === "whisperx" && l.caption) {
    out.push(
      <div key="sub" className="ov sub" {...focus}>
        {l.caption}
      </div>,
    );
  }
  if (t === "shortsgen" && l.tag) {
    out.push(
      <div key="score" className="ov top" {...focus}>
        <span className="pill cyan">{l.tag}</span>
      </div>,
    );
  }
  if (t === "autoeditor" && l.deadAir !== undefined) {
    out.push(
      <div key="dead" className="ov top" {...focus}>
        <span className="pill">−{l.deadAir.toFixed(1)} s dead air removed</span>
      </div>,
    );
  }
  if (t === "mediapipe" || t === "yolo" || t === "sam2") {
    if (l.facecam) {
      out.push(
        <div key="cam" className="ov cam" style={boxStyle(l.facecam)}>
          <span className="lbl">face lock</span>
        </div>,
      );
    }
    (l.faces ?? []).forEach((f, i) =>
      out.push(<div key={`f${i}`} className="ov face" style={boxStyle({ x: f.x - f.w * 0.15, y: f.y - f.h * 0.1, w: f.w * 1.3, h: f.h * 1.25 })} {...(i === 0 ? focus : {})} />),
    );
    if (l.crop) {
      out.push(
        <div key="crop" className="ov crop" style={boxStyle(l.crop)} {...(l.faces?.length ? {} : focus)}>
          <span className="lbl">9:16 · auto-reframe</span>
        </div>,
      );
    }
  }
  if (t === "yolo") {
    (l.boxes ?? []).slice(0, 10).forEach((b, i) =>
      out.push(
        <div key={`b${i}`} className="ov box" style={boxStyle(b.box)} {...(i === 0 ? focus : {})}>
          <span className="lbl">
            {b.label} {b.score.toFixed(2)}
          </span>
        </div>,
      ),
    );
  }
  if (t === "sam2" && l.mask) {
    const m = l.mask.box;
    out.push(
      <div key="mask" className="ov mask" style={boxStyle({ x: m.x + m.w * 0.2, y: m.y + m.h * 0.15, w: m.w * 0.6, h: m.h * 0.85 })} {...focus}>
        <span className="lbl">
          {l.mask.label} {l.mask.score.toFixed(2)}
        </span>
      </div>,
    );
  }
  if ((t === "demucs" || t === "deepfilter") && l.tag) {
    out.push(
      <div key="aud" className="ov top" {...focus}>
        <span className="pill violet">{l.tag}</span>
      </div>,
    );
  }
  if (t === "f5tts" && l.dub) {
    out.push(
      <div key="dub" className="ov top" {...focus}>
        <span className="pill violet">
          DUB · {l.dub.from} → {l.dub.to.join(" · ")}
        </span>
      </div>,
    );
  }
  if ((t === "remotion" || t === "moviepy") && (l.caption || short?.hook)) {
    out.push(
      <div key="cap" className="ov caption" {...focus}>
        {l.caption ?? short?.hook}
      </div>,
    );
  }
  if (t === "losslesscut") {
    out.push(
      <div key="trim" className="ov top" {...focus}>
        <span className="pill amber">trim · 0 re-encode</span>
      </div>,
    );
  }
  if (t === "opencut") {
    out.push(
      <div key="arr" className="ov top" {...focus}>
        <span className="pill amber">arrange · posting order</span>
      </div>,
    );
  }
  if (t === "esrgan") {
    out.push(<div key="scan" className="scanline" {...focus} />);
    if (l.upscale) {
      out.push(
        <div key="up" className="ov" style={{ left: "4%", bottom: "5%" }}>
          <span className="pill cyan">
            {l.upscale.to >= 3840 ? "4K" : `${l.upscale.to}p`} ×{l.upscale.factor}
          </span>
        </div>,
        <div key="from" className="ov" style={{ right: "4%", bottom: "5%" }}>
          <span className="pill dark">{job.source?.height ?? l.upscale.from}p</span>
        </div>,
      );
    }
  }
  if (t === "rife" && l.tag) {
    out.push(
      <div key="rife" className="ov top" {...focus}>
        <span className="pill cyan">{l.tag}</span>
      </div>,
    );
  }
  if (t === "ffmpeg" && short) {
    out.push(
      <div key="exp" className="ov top" {...focus}>
        <span className="pill lime">
          render · SHORT_{pad2(short.order ?? short.n)}.mp4 · {Math.round(short.progress * 100)}%
        </span>
      </div>,
    );
  }
  return <>{out}</>;
}
