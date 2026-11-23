import type { Box, LayoutKind, TrackKey } from "../../lib/types.ts";

// Geometry for the 9:16 frame, and the FFmpeg filtergraph that builds it.
// Boxes are normalised (0..1 of the source frame) until the very end.

export const OUT_W = 1080;
export const OUT_H = 1920;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

export function splitHeights(facecamShare: number): { top: number; bottom: number } {
  const top = even(OUT_H * clamp(facecamShare, 0.25, 0.6));
  return { top, bottom: OUT_H - top };
}

export function unionBox(boxes: Box[]): Box | null {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The facecam panel: a crop with the panel's aspect ratio that stays inside
 * the facecam overlay, centred on the faces, zoomed in a little if the faces
 * are small in their own camera.
 */
export function facecamCrop(cam: Box, faces: Box[], panelAspect: number, srcW: number, srcH: number): Box {
  // Work in pixels so the aspect ratio is real.
  const R = { x: cam.x * srcW, y: cam.y * srcH, w: cam.w * srcW, h: cam.h * srcH };
  const F = unionBox(faces.map((f) => ({ x: f.x * srcW, y: f.y * srcH, w: f.w * srcW, h: f.h * srcH }))) ?? {
    x: R.x + R.w * 0.3,
    y: R.y + R.h * 0.2,
    w: R.w * 0.4,
    h: R.h * 0.4,
  };
  let h = R.w / R.h > panelAspect ? R.h : R.w / panelAspect;
  // Faces should fill ~38% of the panel's height, but never zoom past 2x of the camera.
  h = clamp(F.h / 0.38, h * 0.5, h);
  h = Math.max(h, (F.w * 1.15) / panelAspect);
  h = Math.min(h, R.h, R.w / panelAspect);
  const w = h * panelAspect;
  const cx = clamp(F.x + F.w / 2, R.x + w / 2, R.x + R.w - w / 2);
  const cy = clamp(F.y + F.h * 0.55, R.y + h / 2, R.y + R.h - h / 2);
  return { x: (cx - w / 2) / srcW, y: (cy - h / 2) / srcH, w: w / srcW, h: h / srcH };
}

/** Size (normalised) of the moving crop over the gameplay for a layout. */
export function gameCropSize(kind: LayoutKind, srcW: number, srcH: number, facecamShare: number, zoom = 1): { w: number; h: number } {
  const panel = kind === "split" ? OUT_W / splitHeights(facecamShare).bottom : OUT_W / OUT_H;
  let hPx = srcH / clamp(zoom, 1, 3);
  let wPx = hPx * panel;
  if (wPx > srcW) {
    wPx = srcW;
    hPx = wPx / panel;
  }
  return { w: wPx / srcW, h: hPx / srcH };
}

export interface TrackPoint {
  /** Source seconds. */
  t: number;
  cx: number | null;
  cy: number | null;
}

/**
 * Turn noisy per-frame action points into a calm virtual camera on the
 * output timeline: median filter, a dead zone, a speed limit, hard cuts at
 * scene changes, and a crop that keeps clear of the facecam.
 */
export function buildTrack(
  points: TrackPoint[],
  keep: [number, number][],
  crop: { w: number; h: number },
  opts: { cuts?: number[]; avoid?: Box | null; deadZone?: number; maxSpeed?: number } = {},
): TrackKey[] {
  const deadZone = opts.deadZone ?? 0.05;
  const maxSpeed = opts.maxSpeed ?? 0.35; // frame widths per second
  const lo = crop.w / 2;
  const hi = 1 - crop.w / 2;
  const loY = crop.h / 2;
  const hiY = 1 - crop.h / 2;

  // Where the crop may sit without showing the facecam twice: fully clear of
  // it when there's room on either side, else as little of it as possible.
  const allowed = (cx: number): number => {
    const c = clamp(cx, lo, hi);
    const cam = opts.avoid;
    if (!cam) return c;
    const margin = 0.006;
    const overlaps = (x: number) => x - crop.w / 2 < cam.x + cam.w + margin && x + crop.w / 2 > cam.x - margin;
    if (!overlaps(c)) return c;
    const right = cam.x + cam.w + margin + crop.w / 2;
    const left = cam.x - margin - crop.w / 2;
    const options = [right, left].filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9);
    if (options.length) return options.reduce((a, b) => (Math.abs(a - c) <= Math.abs(b - c) ? a : b));
    // No room: hug the side away from the cam.
    return cam.x + cam.w / 2 < 0.5 ? hi : lo;
  };

  // 1. Fill gaps and median-filter in source time.
  const sorted = [...points].sort((a, b) => a.t - b.t);
  let lastX = 0.5;
  let lastY = 0.5;
  const filled = sorted.map((p) => {
    if (p.cx !== null && p.cy !== null) {
      lastX = p.cx;
      lastY = p.cy;
    }
    return { t: p.t, cx: lastX, cy: lastY };
  });
  const med = filled.map((p, i) => {
    const win = filled.slice(Math.max(0, i - 2), i + 3);
    const xs = win.map((q) => q.cx).sort((a, b) => a - b);
    const ys = win.map((q) => q.cy).sort((a, b) => a - b);
    return { t: p.t, cx: xs[Math.floor(xs.length / 2)], cy: ys[Math.floor(ys.length / 2)] };
  });

  // 2. Map to output time, keeping only points inside kept ranges.
  const mapped: { t: number; cx: number; cy: number; src: number }[] = [];
  let offset = 0;
  for (const [a, b] of keep) {
    for (const p of med) if (p.t >= a && p.t < b) mapped.push({ t: p.t - a + offset, cx: p.cx, cy: p.cy, src: p.t });
    offset += b - a;
  }
  const total = offset;
  if (!mapped.length) {
    const c = allowed(0.5);
    return [{ t: 0, cx: round(c), cy: round(clamp(0.5, loY, hiY)) }];
  }

  // 3. Virtual camera: dead zone + speed limit, snapping at scene cuts and at our own cuts.
  const cuts = opts.cuts ?? [];
  const keys: TrackKey[] = [];
  let cam = allowed(mapped[0].cx);
  let camY = clamp(mapped[0].cy, loY, hiY);
  let prev = mapped[0];
  keys.push({ t: 0, cx: round(cam), cy: round(camY) });
  for (let i = 1; i < mapped.length; i++) {
    const p = mapped[i];
    const dt = Math.max(0.001, p.t - prev.t);
    const jumped = p.src - prev.src > dt + 0.05 || cuts.some((c) => c > prev.src && c <= p.src);
    const target = allowed(p.cx);
    if (jumped) {
      // A hard cut in the picture: cut the camera too (two keys a frame apart).
      if (Math.abs(target - cam) > deadZone) {
        keys.push({ t: round(p.t - 0.04), cx: round(cam), cy: round(camY) });
        cam = target;
        camY = clamp(p.cy, loY, hiY);
        keys.push({ t: round(p.t), cx: round(cam), cy: round(camY) });
      }
    } else if (Math.abs(target - cam) > deadZone) {
      const step = clamp(target - cam, -maxSpeed * dt, maxSpeed * dt);
      cam = clamp(cam + step, lo, hi);
      camY = clamp(camY + clamp(p.cy - camY, -maxSpeed * dt, maxSpeed * dt), loY, hiY);
      keys.push({ t: round(p.t), cx: round(cam), cy: round(camY) });
    }
    prev = p;
  }
  keys.push({ t: round(total), cx: round(cam), cy: round(camY) });
  return simplify(keys, 0.004, 48);
}

const round = (v: number) => Math.round(v * 10000) / 10000;

/** Drop keys that lie on a straight line between neighbours; cap the count. */
export function simplify(keys: TrackKey[], tolerance: number, max: number): TrackKey[] {
  let out = keys.filter((k, i) => i === 0 || k.t > keys[i - 1].t - 1e-6);
  let tol = tolerance;
  for (let pass = 0; pass < 8; pass++) {
    const next: TrackKey[] = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
      const a = next[next.length - 1];
      const b = out[i + 1];
      const k = out[i];
      const f = (k.t - a.t) / Math.max(1e-6, b.t - a.t);
      const lin = a.cx + (b.cx - a.cx) * f;
      const linY = a.cy + (b.cy - a.cy) * f;
      if (Math.abs(lin - k.cx) > tol || Math.abs(linY - k.cy) > tol) next.push(k);
    }
    if (out.length > 1) next.push(out[out.length - 1]);
    out = next;
    if (out.length <= max) break;
    tol *= 2;
  }
  return out;
}

/** Piecewise-linear FFmpeg expression over t for the crop's left edge, in pixels. */
export function trackExpr(keys: TrackKey[], axis: "x" | "y", cropPx: number, srcPx: number): string {
  const pos = (k: TrackKey) => Math.round(clamp((axis === "x" ? k.cx : k.cy) * srcPx - cropPx / 2, 0, srcPx - cropPx));
  if (keys.length === 1) return String(pos(keys[0]));
  const values = keys.map(pos);
  if (values.every((v) => v === values[0])) return String(values[0]);
  let expr = String(values[values.length - 1]);
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i];
    const b = keys[i + 1];
    const span = Math.max(0.001, b.t - a.t);
    const va = values[i];
    const vb = values[i + 1];
    const seg = va === vb ? `${va}` : `${va}+(${vb - va})*(t-${a.t.toFixed(3)})/${span.toFixed(3)}`;
    expr = `if(lt(t,${b.t.toFixed(3)}),${seg},${expr})`;
  }
  return expr;
}

/** Source-pixel crop for a normalised box, snapped to even numbers. */
export function pxBox(b: Box, srcW: number, srcH: number): { x: number; y: number; w: number; h: number } {
  const w = Math.min(even(b.w * srcW), srcW - (srcW % 2));
  const h = Math.min(even(b.h * srcH), srcH - (srcH % 2));
  const x = clamp(Math.round((b.x * srcW) / 2) * 2, 0, srcW - w);
  const y = clamp(Math.round((b.y * srcH) / 2) * 2, 0, srcH - h);
  return { x, y, w, h };
}

export interface ComposeSpec {
  kind: LayoutKind;
  srcW: number;
  srcH: number;
  facecamShare: number;
  facecam?: Box;
  crop: { w: number; h: number };
  track: TrackKey[];
  /** Kept ranges relative to the start of the input (seconds). */
  segments: [number, number][];
  /** Extra sharpening when the source is upscaled a lot (Lanczos fallback for Real-ESRGAN). */
  sharpen: boolean;
  /** Label of the audio input to use, e.g. "1:a" for a processed mix, else "0:a". */
  audioIn: string | null;
  /** Matte input label for the cutout layout. */
  matteIn?: string;
  /** Playback speed for a slow-motion replay (1 = normal). */
  speed?: number;
  /** Interpolate frames when slowing down (FFmpeg minterpolate). */
  interpolate?: boolean;
  fps: number;
  /** Output size; 1080×1920 unless a later AI upscale takes it from a smaller plate. */
  outW?: number;
  outH?: number;
}

/**
 * The filter graph for one short (or its replay): cut out the dead air,
 * crop and stack the panels, track the action. Outputs [v] and, with audio, [a].
 */
export function composeGraph(spec: ComposeSpec): string {
  const n = spec.segments.length;
  const parts: string[] = [];
  const vIn = n > 1 ? Array.from({ length: n }, (_, i) => `[vs${i}]`) : ["[0:v]"];
  const hasAudio = Boolean(spec.audioIn);
  if (n > 1) {
    parts.push(`[0:v]split=${n}${vIn.join("")}`);
    if (hasAudio) parts.push(`[${spec.audioIn}]asplit=${n}${Array.from({ length: n }, (_, i) => `[as${i}]`).join("")}`);
    if (spec.matteIn) parts.push(`[${spec.matteIn}]split=${n}${Array.from({ length: n }, (_, i) => `[ms${i}]`).join("")}`);
  }
  const concatIn: string[] = [];
  spec.segments.forEach(([a, b], i) => {
    const v = n > 1 ? vIn[i] : "[0:v]";
    parts.push(`${v}trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
    concatIn.push(`[v${i}]`);
    if (hasAudio) {
      const ai = n > 1 ? `[as${i}]` : `[${spec.audioIn}]`;
      parts.push(`${ai}atrim=start=${a.toFixed(3)}:end=${b.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
      concatIn.push(`[a${i}]`);
    }
  });
  parts.push(`${concatIn.join("")}concat=n=${n}:v=1:a=${hasAudio ? 1 : 0}[vc]${hasAudio ? "[ac]" : ""}`);
  if (spec.matteIn) {
    const mIn = n > 1 ? Array.from({ length: n }, (_, i) => `[ms${i}]`) : [`[${spec.matteIn}]`];
    spec.segments.forEach(([a, b], i) => parts.push(`${mIn[i]}trim=start=${a.toFixed(3)}:end=${b.toFixed(3)},setpts=PTS-STARTPTS[m${i}]`));
    parts.push(`${spec.segments.map((_, i) => `[m${i}]`).join("")}concat=n=${n}:v=1:a=0,format=gray[mc]`);
  }

  const { srcW, srcH } = spec;
  const W = spec.outW ?? OUT_W;
  const H = spec.outH ?? OUT_H;
  const cw = Math.min(even(spec.crop.w * srcW), srcW - (srcW % 2));
  const ch = Math.min(even(spec.crop.h * srcH), srcH - (srcH % 2));
  const x = trackExpr(spec.track, "x", cw, srcW);
  const y = ch >= srcH - 1 ? "0" : trackExpr(spec.track, "y", ch, srcH);
  const sharpen = spec.sharpen ? ",unsharp=5:5:0.55:5:5:0" : "";
  const gameCrop = `crop=w=${cw}:h=${ch}:x='${x}':y='${y}'`;

  let out = "[vc]";
  if (spec.kind === "split" && spec.facecam) {
    const top = even((splitHeights(spec.facecamShare).top * H) / OUT_H);
    const bottom = H - top;
    const f = pxBox(spec.facecam, srcW, srcH);
    parts.push(`[vc]split=2[vf][vg]`);
    parts.push(`[vf]crop=${f.w}:${f.h}:${f.x}:${f.y},scale=${W}:${top}:flags=lanczos${sharpen},setsar=1[top]`);
    parts.push(`[vg]${gameCrop},scale=${W}:${bottom}:flags=lanczos${sharpen},setsar=1[bot]`);
    parts.push(`[top][bot]vstack=inputs=2[lay]`);
    out = "[lay]";
  } else if (spec.kind === "cutout" && spec.facecam && spec.matteIn) {
    const f = pxBox(spec.facecam, srcW, srcH);
    const fgW = even(W * 0.86);
    const fgH = even((fgW * f.h) / f.w);
    parts.push(`[vc]split=2[vf][vg]`);
    parts.push(`[vg]${gameCrop},scale=${W}:${H}:flags=lanczos${sharpen},setsar=1[bg]`);
    parts.push(`[vf]crop=${f.w}:${f.h}:${f.x}:${f.y},scale=${fgW}:${fgH}:flags=lanczos,format=yuva420p[cam]`);
    parts.push(`[mc]scale=${fgW}:${fgH}[mat]`);
    parts.push(`[cam][mat]alphamerge[fg]`);
    parts.push(`[bg][fg]overlay=x=(W-w)/2:y=H-h:format=auto[lay]`);
    out = "[lay]";
  } else if (spec.kind === "fit") {
    parts.push(`[vc]split=2[vb][vf]`);
    parts.push(`[vb]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=24:2,eq=brightness=-0.12:saturation=1.15[bg]`);
    parts.push(`[vf]scale=${W}:-2:flags=lanczos${sharpen}[fg]`);
    parts.push(`[bg][fg]overlay=x=0:y=(H-h)/2,setsar=1[lay]`);
    out = "[lay]";
  } else {
    parts.push(`[vc]${gameCrop},scale=${W}:${H}:flags=lanczos${sharpen},setsar=1[lay]`);
    out = "[lay]";
  }

  const speed = spec.speed ?? 1;
  if (speed !== 1) {
    const interp = spec.interpolate ? `,minterpolate=fps=${Math.round(spec.fps)}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1` : `,fps=${Math.round(spec.fps)}`;
    parts.push(`${out}setpts=PTS/${speed}${interp}[slow]`);
    out = "[slow]";
    if (hasAudio) {
      parts.push(`[ac]${atempoChain(speed)}[aslow]`);
    }
  }
  parts.push(`${out}format=yuv420p[v]`);
  if (hasAudio) parts.push(`${speed !== 1 ? "[aslow]" : "[ac]"}anull[a]`);
  return parts.join(";\n");
}

/** atempo only takes 0.5–2.0, so chain it for bigger changes. */
export function atempoChain(speed: number): string {
  const steps: number[] = [];
  let left = speed;
  while (left < 0.5) {
    steps.push(0.5);
    left /= 0.5;
  }
  while (left > 2) {
    steps.push(2);
    left /= 2;
  }
  steps.push(Math.round(left * 10000) / 10000);
  return steps.map((s) => `atempo=${s}`).join(",");
}
