"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, LoaderCircle, Pause, Play, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import type { MotionAd, MotionShot } from "@/lib/types";
import { timeline } from "@/lib/motion/story";
import { frameSize, loadPicture, MotionEngine, type MotionPictures } from "./engine";
import { encoderFor, renderVideo, saveFile } from "./export";
import { renderSound, scheduleSound, type SoundPlan } from "./sound";

// The motion ad, live: a preview you can play, scrub and jump through shot
// by shot (with its sound), and the finished MP4 in 1080p or 4K.

export interface PlayerAudio {
  music?: AudioBuffer;
  voice?: AudioBuffer;
}

const mm = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const asset = (id: string) => `/api/assets/${id}`;

export function MotionPlayer({
  ad,
  shots,
  pictures,
  audio,
  allowRender,
}: {
  ad: MotionAd;
  /** The shots to show (the draft being edited, or the approved storyboard). */
  shots: MotionShot[];
  pictures: MotionPictures | null;
  audio: PlayerAudio;
  allowRender?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = useRef<MotionEngine | null>(null);
  const raf = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const out = useRef<GainNode | null>(null);
  const stopSound = useRef<(() => void) | null>(null);
  const clock = useRef({ base: 0, t: 0, shown: -1 });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [muted, setMuted] = useState(false);
  const [job, setJob] = useState<{ quality: "1080p" | "4k"; progress: number; phase: string; abort: AbortController } | null>(null);
  const [can4k, setCan4k] = useState<boolean | null>(null);
  const [note, setNote] = useState("");

  const times = useMemo(() => timeline(shots), [shots]);
  const scene = useMemo(() => (pictures ? { shots, brand: ad.brand, format: ad.format, pictures } : null), [shots, ad.brand, ad.format, pictures]);
  const plan = useMemo<SoundPlan>(
    () => ({ shots, starts: times.starts, total: times.total, sound: ad.sound, music: audio.music, voice: audio.voice, segments: ad.voiceover?.segments ?? [] }),
    [shots, times, ad.sound, audio.music, audio.voice, ad.voiceover]
  );
  const preview = useMemo(() => {
    const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
    return frameSize(ad.format, "preview", Math.round((ad.format === "landscape" ? 400 : 360) * dpr));
  }, [ad.format]);

  // The engine, made once per format.
  useEffect(() => {
    let gone = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    MotionEngine.create({ canvas, width: preview.w, height: preview.h, antialias: true, maxTexture: 1600 })
      .then((e) => {
        if (gone) return e.dispose();
        engine.current = e;
        setReady(true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "This browser can't run the 3D engine (WebGL)."));
    return () => {
      gone = true;
      cancelAnimationFrame(raf.current);
      engine.current?.dispose();
      engine.current = null;
      setReady(false);
    };
  }, [preview.w, preview.h]);

  const draw = useCallback((time: number) => {
    const e = engine.current;
    if (!e) return;
    e.render(time);
    if (e.contextLost) setError("The graphics stopped working. Reload the page to try again.");
  }, []);

  // New storyboard or pictures: redraw where we are.
  useEffect(() => {
    if (!ready || !scene || !engine.current) return;
    engine.current.setScene(scene);
    if (!playing) draw(Math.min(clock.current.t || Math.min(1.2, times.total / 2), times.total));
  }, [ready, scene, draw, playing, times.total]);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stopSound.current?.();
    stopSound.current = null;
    setPlaying(false);
  }, []);

  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    if (out.current) out.current.gain.value = muted ? 0 : 1;
  }, [muted]);
  // Editing while it plays: stop, so the sound and picture don't drift apart.
  useEffect(() => {
    stop();
  }, [plan, stop]);

  const play = useCallback(
    async (from?: number) => {
      if (!engine.current || !scene) return;
      stop();
      const start = from ?? (clock.current.t >= times.total - 0.05 ? 0 : clock.current.t);
      if (!audioCtx.current) {
        audioCtx.current = new AudioContext();
        out.current = audioCtx.current.createGain();
        out.current.connect(audioCtx.current.destination);
        out.current.gain.value = muted ? 0 : 1;
      }
      const ctx = audioCtx.current;
      await ctx.resume().catch(() => undefined);
      const when = ctx.currentTime + 0.06;
      stopSound.current = scheduleSound(ctx, out.current!, plan, start, when);
      clock.current.base = when - start;
      setPlaying(true);
      const step = () => {
        const now = Math.max(start, ctx.currentTime - clock.current.base);
        clock.current.t = Math.min(now, times.total);
        draw(clock.current.t);
        if (Math.abs(clock.current.t - clock.current.shown) >= 0.1) {
          clock.current.shown = clock.current.t;
          setT(clock.current.t);
        }
        if (now >= times.total) {
          setT(times.total);
          stop();
          return;
        }
        raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    },
    [draw, muted, plan, scene, stop, times.total]
  );

  const seek = (time: number) => {
    stop();
    clock.current.t = Math.max(0, Math.min(times.total, time));
    setT(clock.current.t);
    draw(clock.current.t);
  };

  // Can this device encode 4K?
  useEffect(() => {
    if (!allowRender) return;
    const s = frameSize(ad.format, "4k");
    encoderFor(s.w, s.h)
      .then((c) => setCan4k(Boolean(c)))
      .catch(() => setCan4k(false));
  }, [allowRender, ad.format]);

  async function render(quality: "1080p" | "4k") {
    if (!scene || job) return;
    stop();
    const abort = new AbortController();
    const size = frameSize(ad.format, quality);
    setNote("");
    setJob({ quality, progress: 0, phase: "Loading full-size pictures…", abort });
    let big: MotionEngine | null = null;
    try {
      const max = quality === "4k" ? 3840 : 2048;
      const [logo, ...photos] = await Promise.all([ad.assets.logo ? loadPicture(asset(ad.assets.logo.id), 2048) : Promise.resolve(undefined), ...ad.assets.photos.map((p) => loadPicture(asset(p.id), max))]);
      big = await MotionEngine.create({ width: size.w, height: size.h, antialias: quality !== "4k", maxTexture: max });
      big.setScene({ ...scene, pictures: { logo, photos } });
      setJob((j) => j && { ...j, phase: "Mixing the sound…" });
      const mix = await renderSound(plan);
      setJob((j) => j && { ...j, phase: quality === "4k" ? "Rendering 4K…" : "Rendering 1080p…" });
      const engineRef = big;
      const result = await renderVideo({
        width: size.w,
        height: size.h,
        fps: 30,
        total: times.total,
        frame: (time) => engineRef.render(time),
        audio: mix,
        signal: abort.signal,
        onProgress: (p) => setJob((j) => j && { ...j, progress: p }),
      });
      logo?.close();
      photos.forEach((p) => p?.close());
      const name = `${ad.business.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "motion-ad"}-${quality}.${result.ext}`;
      saveFile(result.blob, name);
      const mb = (result.blob.size / 1e6).toFixed(1);
      setNote(
        result.realtime
          ? `Saved ${name} (${mb} MB), recorded in real time because this browser can't render frame by frame.`
          : `Saved ${name} (${mb} MB, ${result.video === "avc" ? "H.264" : result.video.toUpperCase()}${result.audio ? ` + ${result.audio.toUpperCase()}` : ""}, 30 fps).${result.video === "avc" ? "" : " This device has no H.264 encoder, so some players may not open it; Chrome on a computer makes H.264."}`
      );
    } catch (err) {
      if (!(err instanceof DOMException && err.name === "AbortError")) setNote(`Render failed: ${err instanceof Error ? err.message : String(err)}${quality === "4k" ? " Try 1080p." : ""}`);
    } finally {
      big?.dispose();
      setJob(null);
      draw(clock.current.t);
    }
  }

  const ratio = ad.format === "vertical" ? "9 / 16" : ad.format === "square" ? "1 / 1" : "16 / 9";
  const shotAt = (time: number) => {
    let i = 0;
    while (i + 1 < times.starts.length && time >= times.starts[i + 1]) i++;
    return i;
  };
  const current = shotAt(t);

  return (
    <div className={`mplayer ${ad.format}`}>
      <div className="mplayer-frame" style={{ aspectRatio: ratio }}>
        <canvas ref={canvasRef} width={preview.w} height={preview.h} aria-label={`Motion ad for ${ad.business}`} />
        {!ready && !error && (
          <div className="mplayer-over">
            <LoaderCircle size={18} className="spin" /> Loading the 3D engine…
          </div>
        )}
        {error && <div className="mplayer-over error">{error}</div>}
        {ready && !playing && !job && (
          <button type="button" className="vplayer-big" onClick={() => void play()} aria-label="Play">
            {t >= times.total - 0.05 ? <RotateCcw size={28} /> : <Play size={30} />}
          </button>
        )}
        {job && (
          <div className="mplayer-over">
            <LoaderCircle size={16} className="spin" /> {job.phase} {job.phase.startsWith("Rendering") ? `${Math.round(job.progress * 100)}%` : ""}
            <span className="faint small">Keep this tab open.</span>
          </div>
        )}
      </div>
      <div className="mplayer-bar">
        <button type="button" className="btn sm ghost icon" onClick={() => (playing ? stop() : void play())} disabled={!ready || Boolean(job)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button type="button" className="btn sm ghost icon" onClick={() => void play(0)} disabled={!ready || Boolean(job)} aria-label="Play from the start">
          <RotateCcw size={15} />
        </button>
        <button type="button" className="btn sm ghost icon" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <input
          className="mplayer-scrub"
          type="range"
          min={0}
          max={times.total}
          step={0.01}
          value={Math.min(t, times.total)}
          onChange={(e) => seek(Number(e.target.value))}
          disabled={!ready || Boolean(job)}
          aria-label="Time"
        />
        <span className="faint small mono">
          {mm(Math.min(t, times.total))} / {mm(times.total)}
        </span>
      </div>
      <div className="mplayer-shots" role="group" aria-label="Jump to a shot">
        {shots.map((s, i) => (
          <button key={i} type="button" className={i === current ? "on" : ""} onClick={() => seek(times.starts[i] + Math.min(1.2, s.seconds * 0.6))} disabled={!ready || Boolean(job)} title={s.headline}>
            {i + 1}
          </button>
        ))}
      </div>
      {allowRender && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <button type="button" className="btn sm primary" onClick={() => void render("1080p")} disabled={!ready || Boolean(job)}>
              <Download size={14} /> Render 1080p MP4
            </button>
            <button type="button" className="btn sm" onClick={() => void render("4k")} disabled={!ready || Boolean(job) || can4k === false} title={can4k === false ? "This device can't encode 4K video" : undefined}>
              <Download size={14} /> Render 4K MP4
            </button>
            {job && (
              <button type="button" className="btn sm ghost" onClick={() => job.abort.abort()}>
                <X size={14} /> Cancel
              </button>
            )}
          </div>
          {job?.phase.startsWith("Rendering") && (
            <div className="mprogress" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${job.progress * 100}%` }} />
            </div>
          )}
          <span className="faint small">
            {note ||
              (can4k === false
                ? "This device can't encode 4K, so 1080p it is. Chrome on a recent phone or computer can make 4K."
                : "Rendered here on your device, frame by frame at 30 fps, with the sound mixed in. 4K takes a minute or two.")}
          </span>
        </div>
      )}
    </div>
  );
}
