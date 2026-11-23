"use client";

import { useEffect, useRef, useState } from "react";
import { pad2 } from "@/lib/format";
import { fileUrl, type Box, type JobState, type Short } from "@/lib/types";

/** The 9:16 output: the rendered short when it exists, otherwise a live preview of the layout built from the source. */
export function OutputPanel({ job, short }: { job: JobState | null; short: Short | null }) {
  const hot = job?.activeTool === "remotion";
  const name = short ? `SHORT_${pad2(short.order ?? short.n)}` : "SHORT_01";
  return (
    <section className={`panel${hot ? " hot" : ""}`} aria-label="9:16 output" style={{ display: "flex", flexDirection: "column" }}>
      <div className="ph">
        <span className="name">9:16 / OUTPUT</span>
        <span className="right">{name}</span>
      </div>
      <div className="pb" style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, minHeight: 300, maxHeight: 520, display: "flex", justifyContent: "center" }}>
          {job && short?.file ? <Rendered job={job} short={short} /> : job && job.source ? <LivePreview job={job} short={short} /> : <div className="vertical" style={{ height: "100%" }} />}
        </div>
      </div>
    </section>
  );
}

function Rendered({ job, short }: { job: JobState; short: Short }) {
  const [muted, setMuted] = useState(true);
  const [t, setT] = useState(0);
  return (
    <div className="vertical" style={{ height: "100%" }}>
      <video
        key={short.file}
        src={fileUrl(job.id, short.file!)}
        poster={short.cover ? fileUrl(job.id, short.cover) : undefined}
        autoPlay
        muted={muted}
        loop
        playsInline
        onTimeUpdate={(e) => setT(e.currentTarget.currentTime / (e.currentTarget.duration || 1))}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        data-cur="output-caption"
      />
      <button className="btn" style={{ position: "absolute", right: 8, top: 8, zIndex: 5, padding: "5px 7px" }} onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
        {muted ? "🔇" : "🔊"}
      </button>
      <div className="progress">
        <i style={{ width: `${t * 100}%` }} />
      </div>
    </div>
  );
}

/** Two muted copies of the source, cropped with CSS exactly like the renderer will crop them. */
function LivePreview({ job, short }: { job: JobState; short: Short | null }) {
  const src = job.source!;
  const media = fileUrl(job.id, src.media);
  const layout = short?.layout;
  const share = job.options.facecamShare;
  const kind = layout?.kind ?? "crop";
  const key = layout?.track?.[0];
  const crop = layout?.crop ?? { w: (src.height * 9) / 16 / src.width, h: 1 };
  const game: Box = {
    x: Math.min(1 - crop.w, Math.max(0, (key?.cx ?? 0.5) - crop.w / 2)),
    y: Math.min(1 - crop.h, Math.max(0, (key?.cy ?? 0.5) - crop.h / 2)),
    w: crop.w,
    h: crop.h,
  };
  const t = short ? short.start + 0.5 : (job.live.t ?? 0);
  const caption = (short && job.live.shortId === short.id ? job.live.caption : undefined) ?? short?.hook ?? job.live.caption ?? "";
  const seam = kind === "split" ? share : kind === "crop" ? 0.62 : 0.4;
  const done = short ? Math.round(short.progress * 100) : 0;
  const ready = job.stages.source === "done";
  return (
    <div className="vertical" style={{ height: "100%" }}>
      {ready && kind === "split" && layout?.facecam ? (
        <>
          <Pane media={media} box={layout.facecam} top={0} height={share} t={t} />
          <Pane media={media} box={game} top={share} height={1 - share} t={t} />
        </>
      ) : ready && kind !== "fit" ? (
        <Pane media={media} box={game} top={0} height={1} t={t} />
      ) : ready ? (
        <Pane media={media} box={{ x: 0, y: 0, w: 1, h: 1 }} top={0.36} height={(9 / 16) * (9 / 16)} t={t} />
      ) : null}
      {caption && (
        <div className="out-caption" style={{ top: `${seam * 100}%` }} data-cur="output-caption">
          {caption}
        </div>
      )}
      {short && short.status !== "planned" && (
        <div className="progress">
          <i style={{ width: `${done}%` }} />
        </div>
      )}
    </div>
  );
}

function Pane({ media, box, top, height, t }: { media: string; box: Box; top: number; height: number; t: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const go = () => {
      if (Math.abs(v.currentTime - t) > 1.2) v.currentTime = Math.max(0, t);
      v.play().catch(() => {});
    };
    if (v.readyState >= 1) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
  }, [t, media]);
  return (
    <div className="half" style={{ top: `${top * 100}%`, height: `${height * 100}%` }}>
      <video
        ref={ref}
        src={media}
        muted
        playsInline
        preload="auto"
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.currentTime > t + 7) v.currentTime = Math.max(0, t);
        }}
        style={{
          width: `${100 / box.w}%`,
          height: `${100 / box.h}%`,
          left: `${(-box.x / box.w) * 100}%`,
          top: `${(-box.y / box.h) * 100}%`,
          objectFit: "fill",
          transition: "left 0.8s ease, top 0.8s ease",
        }}
      />
    </div>
  );
}
