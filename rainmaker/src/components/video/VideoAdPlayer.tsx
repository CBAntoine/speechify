"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, LoaderCircle, Pause, Play, RotateCcw, Volume2, VolumeX } from "lucide-react";
import type { VideoScene } from "@/lib/types";

// A video ad, drawn on a canvas: the business's brand colour, logo and photo,
// one scene per beat of the script, captions, and the voiceover in sync.
// "Download" records the canvas and the voiceover into a video file, in the
// browser (MP4 where the browser can, otherwise WebM).

export interface PlayerProduct {
  id: string;
  name: string;
  tagline: string;
  features: string[];
}

export interface VideoAdPlayerProps {
  scenes: VideoScene[];
  timing: { starts: number[]; total: number };
  brand: { color: string; ink: string; domain?: string };
  logoUrl?: string;
  photoUrl?: string;
  voiceUrl?: string;
  business: string;
  agency: string;
  format: "vertical" | "square";
  products: PlayerProduct[];
  /** File name for downloads, without the extension. */
  fileName?: string;
  allowDownload?: boolean;
  /** Called the first time someone presses play. */
  onFirstPlay?: () => void;
}

const SIZE = { vertical: { w: 720, h: 1280 }, square: { w: 960, h: 960 } } as const;
const DISPLAY = '"Geist Variable", "Inter Variable", system-ui, sans-serif';
const BODY = '"Inter Variable", system-ui, sans-serif';

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const ease = (x: number) => 1 - Math.pow(1 - clamp(x), 3);

function useImage(url?: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const el = new Image();
    el.onload = () => alive && setImg(el);
    el.src = url;
    return () => {
      alive = false;
    };
  }, [url]);
  return url ? img : null;
}

function shade(hex: string, amount: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(full, 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function lines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** The biggest font size (down to min) at which the text fits in maxLines. */
function fit(ctx: CanvasRenderingContext2D, text: string, family: string, weight: number, maxWidth: number, maxLines: number, size: number, min: number) {
  for (let s = size; s >= min; s -= 2) {
    ctx.font = `${weight} ${s}px ${family}`;
    const l = lines(ctx, text, maxWidth);
    if (l.length <= maxLines) return { size: s, lines: l };
  }
  ctx.font = `${weight} ${min}px ${family}`;
  const l = lines(ctx, text, maxWidth);
  return { size: min, lines: l.length > maxLines ? [...l.slice(0, maxLines - 1), `${l.slice(maxLines - 1).join(" ").slice(0, 40)}…`] : l };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawText(ctx: CanvasRenderingContext2D, t: { size: number; lines: string[] }, x: number, y: number, opts: { family: string; weight: number; color: string; align?: CanvasTextAlign; lineHeight?: number }) {
  ctx.font = `${opts.weight} ${t.size}px ${opts.family}`;
  ctx.fillStyle = opts.color;
  ctx.textAlign = opts.align ?? "center";
  ctx.textBaseline = "top";
  const lh = t.size * (opts.lineHeight ?? 1.12);
  t.lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return y + t.lines.length * lh;
}

function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, zoom: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight) * zoom;
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function contain(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s;
  const dh = img.naturalHeight * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** "4.6★" counts up from 0; "128" too; anything else is shown as is. */
function countUp(value: string, p: number): string {
  const m = value.match(/^([^\d]*)([\d,]*\.?\d+)(.*)$/);
  if (!m) return value;
  const target = Number(m[2].replace(/,/g, ""));
  const decimals = (m[2].split(".")[1] ?? "").length;
  const v = target * ease(p);
  return `${m[1]}${v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${m[3]}`;
}

export function VideoAdPlayer(props: VideoAdPlayerProps) {
  const { scenes, timing, brand, business, agency, format, products } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const graph = useRef<{ ctx: AudioContext; source: MediaElementAudioSourceNode } | null>(null);
  const clock = useRef({ base: 0, t: 0, shown: 0 });
  const raf = useRef(0);
  const played = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState<null | { progress: number }>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const logo = useImage(props.logoUrl);
  const photo = useImage(props.photoUrl);
  const { w, h } = SIZE[format];

  useEffect(() => {
    let alive = true;
    Promise.all([document.fonts.load(`600 64px ${DISPLAY}`), document.fonts.load(`500 30px ${BODY}`)])
      .catch(() => undefined)
      .then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const draw = useCallback(
    (time: number) => {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      const pad = format === "vertical" ? 56 : 64;
      const idx = Math.max(0, timing.starts.findLastIndex((s) => s <= time + 0.001));
      const scene = scenes[idx];
      const start = timing.starts[idx] ?? 0;
      const end = timing.starts[idx + 1] ?? timing.total;
      const local = time - start;
      const dur = Math.max(0.5, end - start);
      const enter = ease(local / 0.55);
      const exit = idx === scenes.length - 1 ? 1 : clamp((dur - local) / 0.3);
      const alpha = enter * exit;

      // Background: their colour, a soft gradient and slow shapes.
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, shade(brand.color, 0.12));
      g.addColorStop(1, shade(brand.color, -0.45));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.globalAlpha = 0.09;
      ctx.fillStyle = brand.ink;
      ctx.beginPath();
      ctx.arc(w * 0.85 + Math.sin(time / 3) * 30, h * 0.18, w * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(w * 0.1 + Math.cos(time / 4) * 24, h * 0.86, w * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (!scene) return;

      const ink = brand.ink;
      const soft = ink === "#ffffff" ? "rgba(255,255,255,0.78)" : "rgba(17,17,17,0.72)";
      const cx = w / 2;
      const maxW = w - pad * 2;

      // Photo scenes fill the frame behind the words.
      if (scene.visual === "photo" && photo) {
        ctx.save();
        ctx.globalAlpha = alpha;
        cover(ctx, photo, 0, 0, w, h, 1.04 + 0.08 * clamp(local / dur));
        const shadeG = ctx.createLinearGradient(0, h * 0.25, 0, h);
        shadeG.addColorStop(0, "rgba(0,0,0,0.05)");
        shadeG.addColorStop(1, "rgba(0,0,0,0.78)");
        ctx.fillStyle = shadeG;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      const rise = (1 - enter) * 40;
      const onPhoto = scene.visual === "photo" && photo;
      const textColor = onPhoto ? "#ffffff" : ink;
      const subColor = onPhoto ? "rgba(255,255,255,0.85)" : soft;
      let y = format === "vertical" ? h * 0.2 : h * 0.14;

      if (scene.visual === "logo" && logo) {
        const box = format === "vertical" ? w * 0.46 : w * 0.3;
        const s = 0.85 + 0.15 * enter;
        ctx.save();
        ctx.translate(cx, y + box / 2);
        ctx.scale(s, s);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = 40;
        roundRect(ctx, -box / 2, -box / 2, box, box, 36);
        ctx.fill();
        ctx.shadowBlur = 0;
        contain(ctx, logo, -box / 2 + 28, -box / 2 + 28, box - 56, box - 56);
        ctx.restore();
        y += box + 56;
      } else if (scene.visual === "website") {
        const cw = maxW;
        const ch = format === "vertical" ? h * 0.3 : h * 0.34;
        const top = y + rise;
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = 40;
        roundRect(ctx, pad, top, cw, ch, 22);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#eef0f3";
        roundRect(ctx, pad, top, cw, 56, 22);
        ctx.fill();
        ctx.fillRect(pad, top + 34, cw, 22);
        ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(pad + 28 + i * 22, top + 28, 7, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.fillStyle = "#ffffff";
        roundRect(ctx, pad + 100, top + 14, cw - 124, 28, 14);
        ctx.fill();
        ctx.fillStyle = "#555";
        ctx.font = `500 18px ${BODY}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(brand.domain ?? business, pad + 116, top + 28, cw - 150);
        ctx.fillStyle = "#e3e6ea";
        for (let i = 0; i < 4; i++) {
          roundRect(ctx, pad + 28, top + 86 + i * 34, (cw - 56) * (i === 0 ? 0.6 : 0.9 - i * 0.12), 16, 8);
          ctx.fill();
        }
        // The finding, stamped on their site.
        const badge = ease((local - 0.35) / 0.45);
        if (badge > 0) {
          const t = fit(ctx, scene.headline, DISPLAY, 650, cw - 96, 2, 34, 22);
          const bh = t.lines.length * t.size * 1.15 + 36;
          const by = top + ch - bh - 22;
          ctx.save();
          ctx.globalAlpha = alpha * badge;
          ctx.translate(0, (1 - badge) * 20);
          ctx.fillStyle = "#d92d20";
          roundRect(ctx, pad + 24, by, cw - 48, bh, 18);
          ctx.fill();
          drawText(ctx, t, cx, by + 18, { family: DISPLAY, weight: 650, color: "#ffffff" });
          ctx.restore();
        }
        y = top + ch + 48;
      } else if (scene.visual === "stat" && scene.stat) {
        const big = fit(ctx, scene.stat.value, DISPLAY, 700, maxW, 1, format === "vertical" ? 190 : 170, 80);
        ctx.font = `700 ${big.size}px ${DISPLAY}`;
        ctx.fillStyle = textColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(countUp(scene.stat.value, local / 1.2), cx, y + rise);
        y += big.size * 1.05;
        const label = fit(ctx, scene.stat.label, BODY, 600, maxW, 2, 40, 26);
        y = drawText(ctx, label, cx, y + rise, { family: BODY, weight: 600, color: subColor }) + 56;
      } else if (scene.visual === "product") {
        const p = products.find((x) => x.id === scene.productId);
        const feats = (p?.features ?? []).slice(0, 3);
        const cw = maxW;
        const top = y + rise;
        ctx.font = `600 28px ${BODY}`;
        const featLines = feats.map((f) => lines(ctx, f, cw - 120).slice(0, 2));
        const ch = 150 + featLines.reduce((a, l) => a + l.length * 36 + 22, 0);
        ctx.fillStyle = "#ffffff";
        ctx.shadowColor = "rgba(0,0,0,0.25)";
        ctx.shadowBlur = 40;
        roundRect(ctx, pad, top, cw, ch, 28);
        ctx.fill();
        ctx.shadowBlur = 0;
        const name = fit(ctx, p?.name ?? scene.headline, DISPLAY, 650, cw - 72, 1, 46, 28);
        drawText(ctx, name, pad + 36, top + 34, { family: DISPLAY, weight: 650, color: "#111111", align: "left" });
        let fy = top + 104;
        featLines.forEach((fl, i) => {
          const show = ease((local - 0.4 - i * 0.45) / 0.35);
          if (show <= 0) return;
          ctx.save();
          ctx.globalAlpha = alpha * show;
          ctx.fillStyle = brand.color;
          ctx.beginPath();
          ctx.arc(pad + 54, fy + 18, 17, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = brand.ink;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(pad + 46, fy + 18);
          ctx.lineTo(pad + 52, fy + 25);
          ctx.lineTo(pad + 63, fy + 11);
          ctx.stroke();
          ctx.font = `600 28px ${BODY}`;
          ctx.fillStyle = "#222";
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          fl.forEach((l, k) => ctx.fillText(l, pad + 88, fy + 2 + k * 36));
          ctx.restore();
          fy += fl.length * 36 + 22;
        });
        y = top + ch + 48;
      }

      // The words: headline and line under it (not repeated where the visual says it).
      if (scene.visual !== "website" && !(scene.visual === "product")) {
        if (onPhoto) y = format === "vertical" ? h * 0.52 : h * 0.46;
        const head = fit(ctx, scene.headline, DISPLAY, 650, maxW, 3, format === "vertical" ? 68 : 64, 36);
        y = drawText(ctx, head, cx, y + rise, { family: DISPLAY, weight: 650, color: textColor }) + 18;
      }
      if (scene.sub && scene.visual !== "stat") {
        const sub = fit(ctx, scene.sub, BODY, 500, maxW, 3, 34, 24);
        y = drawText(ctx, sub, cx, y + rise, { family: BODY, weight: 500, color: subColor, lineHeight: 1.3 }) + 28;
      }
      if (scene.kind === "cta") {
        const label = "Reply to the email to get started";
        ctx.font = `650 28px ${BODY}`;
        const bw = Math.min(maxW, ctx.measureText(label).width + 72);
        const pulse = 1 + Math.sin(local * 4) * 0.02;
        ctx.save();
        ctx.translate(cx, y + 40);
        ctx.scale(pulse, pulse);
        ctx.fillStyle = ink;
        roundRect(ctx, -bw / 2, -36, bw, 72, 36);
        ctx.fill();
        ctx.fillStyle = brand.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 0, 1);
        ctx.restore();
      }
      ctx.restore();

      // Captions: what the narrator is saying in this scene.
      if (scene.voiceover) {
        const cap = fit(ctx, scene.voiceover, BODY, 600, maxW - 48, 3, format === "vertical" ? 30 : 28, 22);
        const lh = cap.size * 1.3;
        const bh = cap.lines.length * lh + 32;
        const by = h - pad - bh - 26;
        ctx.save();
        ctx.globalAlpha = clamp(local / 0.25) * exit;
        ctx.fillStyle = "rgba(0,0,0,0.62)";
        roundRect(ctx, pad, by, maxW, bh, 22);
        ctx.fill();
        drawText(ctx, cap, cx, by + 16, { family: BODY, weight: 600, color: "#ffffff", lineHeight: 1.3 });
        ctx.restore();
      }

      // Top: who it's for, and progress.
      ctx.save();
      ctx.fillStyle = onPhoto ? "rgba(255,255,255,0.9)" : soft;
      ctx.font = `600 22px ${BODY}`;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(`Made for ${business}`, pad, pad - 18, maxW * 0.6);
      ctx.textAlign = "right";
      ctx.fillText(agency, w - pad, pad - 18, maxW * 0.38);
      ctx.fillStyle = onPhoto ? "rgba(255,255,255,0.25)" : ink === "#ffffff" ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.15)";
      roundRect(ctx, pad, pad + 18, maxW, 6, 3);
      ctx.fill();
      ctx.fillStyle = onPhoto ? "#ffffff" : ink;
      roundRect(ctx, pad, pad + 18, Math.max(6, maxW * clamp(time / timing.total)), 6, 3);
      ctx.fill();
      ctx.restore();
    },
    [agency, brand, business, format, h, logo, photo, products, scenes, timing, w]
  );

  // Redraw the still frame when nothing is playing; before the first play,
  // show the opening scene in full rather than its first (blank) frame.
  useEffect(() => {
    if (!playing) draw(t > 0 ? t : Math.min(1.2, Math.max(0, (timing.starts[1] ?? timing.total) - 0.4)));
  }, [draw, playing, t, fontsReady, timing]);

  const stopLoop = () => cancelAnimationFrame(raf.current);

  const loop = useCallback(
    (onFrame?: (time: number) => void) => {
      const audio = audioRef.current;
      const step = () => {
        let time: number;
        if (audio && props.voiceUrl && !audio.paused && !audio.ended) {
          time = audio.currentTime;
          clock.current.base = performance.now() - time * 1000;
        } else time = (performance.now() - clock.current.base) / 1000;
        clock.current.t = time;
        draw(Math.min(time, timing.total));
        onFrame?.(time);
        if (time >= timing.total) {
          setPlaying(false);
          setT(timing.total);
          return;
        }
        // The time readout: a few updates a second is plenty.
        if (Math.abs(time - clock.current.shown) >= 0.25) {
          clock.current.shown = time;
          setT(time);
        }
        raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    },
    [draw, props.voiceUrl, timing.total]
  );

  /** Route the voiceover through Web Audio once, so it can also be recorded. */
  const ensureGraph = () => {
    const audio = audioRef.current;
    if (!audio || graph.current) return graph.current;
    const ctx = new AudioContext();
    const source = ctx.createMediaElementSource(audio);
    source.connect(ctx.destination);
    graph.current = { ctx, source };
    return graph.current;
  };

  const play = useCallback(
    async (from?: number) => {
      const start = from ?? (t >= timing.total ? 0 : t);
      if (!played.current) {
        played.current = true;
        props.onFirstPlay?.();
      }
      const audio = audioRef.current;
      clock.current.base = performance.now() - start * 1000;
      if (audio && props.voiceUrl) {
        const gr = ensureGraph();
        await gr?.ctx.resume().catch(() => undefined);
        audio.currentTime = Math.min(start, audio.duration || start);
        await audio.play().catch(() => undefined);
      }
      setPlaying(true);
      stopLoop();
      loop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loop, props.voiceUrl, t, timing.total]
  );

  const pause = () => {
    stopLoop();
    audioRef.current?.pause();
    setPlaying(false);
    setT(clock.current.t);
  };

  useEffect(() => () => stopLoop(), []);
  useEffect(() => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  async function download() {
    const canvas = canvasRef.current;
    if (!canvas || recording) return;
    const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    const mime = types.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
    if (!mime) {
      alert("This browser can't record video. Try Chrome on Android or a computer.");
      return;
    }
    pause();
    setRecording({ progress: 0 });
    const stream = canvas.captureStream(30);
    let dest: MediaStreamAudioDestinationNode | undefined;
    const gr = props.voiceUrl ? ensureGraph() : null;
    if (gr) {
      await gr.ctx.resume().catch(() => undefined);
      dest = gr.ctx.createMediaStreamDestination();
      gr.source.connect(dest);
      dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3_000_000 });
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
    rec.start(250);
    const audio = audioRef.current;
    if (audio) audio.muted = false;
    clock.current.base = performance.now();
    if (audio && props.voiceUrl) {
      audio.currentTime = 0;
      await audio.play().catch(() => undefined);
    }
    setPlaying(true);
    await new Promise<void>((resolve) =>
      loop((time) => {
        setRecording({ progress: clamp(time / timing.total) });
        if (time >= timing.total) resolve();
      })
    );
    rec.stop();
    await stopped;
    if (dest && gr) gr.source.disconnect(dest);
    if (audio) audio.muted = muted;
    stream.getTracks().forEach((tr) => tr.stop());
    const type = mime.split(";")[0];
    const blob = new Blob(chunks, { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(props.fileName ?? "video-ad").replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "video-ad"}.${type.includes("mp4") ? "mp4" : "webm"}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setRecording(null);
  }

  const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <div className={`vplayer ${format}`}>
      <div className="vplayer-frame">
        <canvas ref={canvasRef} width={w} height={h} aria-label={`Video ad for ${business}`} />
        {!playing && !recording && (
          <button type="button" className="vplayer-big" onClick={() => void play()} aria-label={t > 0 && t < timing.total ? "Resume" : "Play the video"}>
            {t >= timing.total ? <RotateCcw size={30} /> : <Play size={34} />}
          </button>
        )}
        {recording && (
          <div className="vplayer-rec">
            <LoaderCircle size={16} className="spin" /> Recording the video… {Math.round(recording.progress * 100)}%. Keep this tab open.
          </div>
        )}
      </div>
      {props.voiceUrl && <audio ref={audioRef} src={props.voiceUrl} preload="auto" />}
      <div className="vplayer-bar">
        <button type="button" className="btn sm ghost icon" onClick={() => (playing ? pause() : void play())} disabled={Boolean(recording)} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button type="button" className="btn sm ghost icon" onClick={() => void play(0)} disabled={Boolean(recording)} aria-label="Play from the start">
          <RotateCcw size={15} />
        </button>
        {props.voiceUrl && (
          <button type="button" className="btn sm ghost icon" onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        )}
        <span className="faint small mono">
          {mm(Math.min(t, timing.total))} / {mm(timing.total)}
        </span>
        <span className="spacer" />
        {props.allowDownload && (
          <button type="button" className="btn sm" onClick={() => void download()} disabled={Boolean(recording)}>
            {recording ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} Download video
          </button>
        )}
      </div>
    </div>
  );
}
