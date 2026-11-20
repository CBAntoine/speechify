import { useCallback, useEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import type { Edits, Marker } from '../lib/types.ts';
import { clamp, type Range } from '../lib/timeline.ts';
import { clock } from '../lib/captions.ts';

export interface RegionRef {
  kind: 'cut' | 'zoom';
  id: string;
}

interface Props {
  duration: number;
  envelope: Float32Array | null;
  rate: number;
  analyzing: number | null;
  edits: Edits;
  markers: Marker[];
  selection: Range | null;
  selected: RegionRef | null;
  getTime: () => number;
  onSeek: (t: number) => void;
  onSelection: (r: Range | null) => void;
  onSelectRegion: (r: RegionRef | null) => void;
  onBeginChange: () => void;
  onEdits: (e: Edits) => void;
}

const PAD = 12;
const RULER = 20;
const BAND_TOP = 24;
const BAND_H = 76;
const LANE_TOP = BAND_TOP + BAND_H + 6;
const LANE_H = 20;
const HEIGHT = LANE_TOP + LANE_H + 6;
const EDGE = 7;

type Drag =
  | { type: 'scrub' }
  | { type: 'select'; anchor: number; startX: number; moved: boolean; region?: RegionRef }
  | { type: 'trim'; which: 'start' | 'end' }
  | { type: 'edge'; kind: 'cut' | 'zoom'; id: string; which: 'start' | 'end' }
  | { type: 'move'; id: string; grab: number; startX: number; moved: boolean; began: boolean };

function readColors(el: Element) {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim() || '#888';
  return {
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    line: v('--line'),
    deck: v('--deck-2'),
    ground: v('--ground'),
    tally: v('--tally'),
    cue: v('--cue'),
    chapter: v('--chapter'),
    cut: v('--cut'),
    select: v('--select'),
  };
}

const TICK_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800];

export function Timeline(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 600, dpr: 1 });
  const props = useRef(p);
  props.current = p;
  const dirty = useRef(true);
  const lastTime = useRef(-1);
  const drag = useRef<Drag | null>(null);
  const colors = useRef<ReturnType<typeof readColors> | null>(null);
  const hatch = useRef<{ key: string; pattern: CanvasPattern | null }>({ key: '', pattern: null });
  const peak = useRef(1);

  useEffect(() => {
    dirty.current = true;
  });

  // Normalise the waveform against a high percentile, not the single loudest blip.
  useEffect(() => {
    const env = p.envelope;
    if (!env || !env.length) return;
    const sorted = Float32Array.from(env).sort();
    peak.current = Math.max(1e-4, sorted[Math.floor(sorted.length * 0.985)]);
    dirty.current = true;
  }, [p.envelope]);

  const xOf = useCallback((t: number) => PAD + (t / Math.max(0.001, props.current.duration)) * (size.current.w - PAD * 2), []);
  const tOf = useCallback(
    (x: number) => clamp(((x - PAD) / Math.max(1, size.current.w - PAD * 2)) * props.current.duration, 0, props.current.duration),
    [],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, dpr } = size.current;
    const P = props.current;
    if (!colors.current) colors.current = readColors(canvas);
    const C = colors.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, HEIGHT);
    const D = Math.max(0.001, P.duration);
    const x = (t: number) => PAD + (t / D) * (w - PAD * 2);

    // Ruler
    ctx.font = '500 10px "JetBrains Mono Variable", ui-monospace, monospace';
    ctx.textBaseline = 'top';
    const step = TICK_STEPS.find((s) => (s / D) * (w - PAD * 2) >= 64) ?? 3600;
    ctx.fillStyle = C.ink3;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    for (let t = 0; t <= D + 1e-6; t += step) {
      const xx = Math.round(x(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(xx, RULER - 6);
      ctx.lineTo(xx, RULER);
      ctx.stroke();
      if (xx < w - 30) ctx.fillText(step < 1 ? t.toFixed(1) : clock(t), xx + 3, 3);
    }

    // Band background
    ctx.fillStyle = C.deck;
    ctx.beginPath();
    ctx.roundRect(PAD, BAND_TOP, w - PAD * 2, BAND_H, 6);
    ctx.fill();

    // Waveform
    const mid = BAND_TOP + BAND_H / 2;
    const env = P.envelope;
    if (env && env.length) {
      ctx.fillStyle = C.ink2;
      const cols = Math.floor(w - PAD * 2);
      const perCol = env.length / cols;
      for (let i = 0; i < cols; i++) {
        const a = Math.floor(i * perCol);
        const b = Math.max(a + 1, Math.floor((i + 1) * perCol));
        let m = 0;
        for (let j = a; j < b && j < env.length; j++) if (env[j] > m) m = env[j];
        const amp = Math.sqrt(Math.min(1, m / peak.current));
        const hh = Math.max(1, amp * (BAND_H / 2 - 6));
        ctx.fillRect(PAD + i, mid - hh, 1, hh * 2);
      }
    } else {
      ctx.fillStyle = C.ink3;
      ctx.fillRect(PAD + 4, mid, w - PAD * 2 - 8, 1);
      ctx.font = '500 11px "Inter Variable", system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      const label = P.analyzing !== null ? `Reading audio… ${Math.round(P.analyzing * 100)}%` : 'No audio in this recording';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = C.deck;
      ctx.fillRect(w / 2 - tw / 2 - 8, mid - 9, tw + 16, 18);
      ctx.fillStyle = C.ink3;
      ctx.fillText(label, w / 2 - tw / 2, mid);
    }

    // Trimmed-away ends
    const trimS = P.edits.trimStart;
    const trimE = P.edits.trimEnd ?? D;
    ctx.fillStyle = C.ground;
    ctx.globalAlpha = 0.72;
    if (trimS > 0) ctx.fillRect(PAD, BAND_TOP, x(trimS) - PAD, BAND_H);
    if (trimE < D) ctx.fillRect(x(trimE), BAND_TOP, w - PAD - x(trimE), BAND_H);
    ctx.globalAlpha = 1;

    // Cuts, hatched like film leader
    const key = `${C.cut}|${dpr}`;
    if (hatch.current.key !== key) {
      const pc = document.createElement('canvas');
      pc.width = pc.height = 8;
      const g = pc.getContext('2d')!;
      g.strokeStyle = C.cut;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-2, 10);
      g.lineTo(10, -2);
      g.moveTo(6, 10);
      g.lineTo(10, 6);
      g.moveTo(-2, 2);
      g.lineTo(2, -2);
      g.stroke();
      hatch.current = { key, pattern: ctx.createPattern(pc, 'repeat') };
    }
    for (const c of P.edits.cuts) {
      const x0 = x(Math.max(0, c.start));
      const x1 = Math.max(x0 + 2, x(Math.min(D, c.end)));
      const isSel = P.selected?.kind === 'cut' && P.selected.id === c.id;
      ctx.fillStyle = C.ground;
      ctx.globalAlpha = c.kind === 'silence' ? 0.45 : 0.6;
      ctx.fillRect(x0, BAND_TOP, x1 - x0, BAND_H);
      ctx.globalAlpha = c.kind === 'silence' ? 0.5 : 0.85;
      if (hatch.current.pattern) {
        ctx.fillStyle = hatch.current.pattern;
        ctx.fillRect(x0, BAND_TOP, x1 - x0, BAND_H);
      }
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.cut;
      ctx.lineWidth = isSel ? 2 : 1;
      ctx.strokeRect(x0 + 0.5, BAND_TOP + 0.5, x1 - x0 - 1, BAND_H - 1);
    }

    // Selection
    if (P.selection) {
      const [a, b] = P.selection;
      ctx.fillStyle = C.select;
      ctx.globalAlpha = 0.28;
      ctx.fillRect(x(a), BAND_TOP, x(b) - x(a), BAND_H);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = C.select;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x(a) + 0.5, BAND_TOP + 0.5, x(b) - x(a) - 1, BAND_H - 1);
    }

    // Zoom lane
    ctx.fillStyle = C.deck;
    ctx.beginPath();
    ctx.roundRect(PAD, LANE_TOP, w - PAD * 2, LANE_H, 5);
    ctx.fill();
    ctx.font = '600 10px "Inter Variable", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const z of P.edits.zooms) {
      const x0 = x(z.start);
      const x1 = Math.max(x0 + 6, x(z.end));
      const isSel = P.selected?.kind === 'zoom' && P.selected.id === z.id;
      ctx.fillStyle = C.cue;
      ctx.globalAlpha = isSel ? 1 : 0.75;
      ctx.beginPath();
      ctx.roundRect(x0, LANE_TOP + 2, x1 - x0, LANE_H - 4, 4);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (isSel) {
        ctx.strokeStyle = C.ink;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      if (x1 - x0 > 34) {
        ctx.fillStyle = '#04201c';
        ctx.fillText(`${z.scale.toFixed(1)}×`, x0 + 6, LANE_TOP + LANE_H / 2);
      }
    }
    if (!P.edits.zooms.length) {
      ctx.fillStyle = C.ink3;
      ctx.font = '500 10px "Inter Variable", system-ui, sans-serif';
      ctx.fillText('Zooms', PAD + 8, LANE_TOP + LANE_H / 2);
    }

    // Chapters
    for (const m of P.markers) {
      const xx = Math.round(x(m.t)) + 0.5;
      ctx.strokeStyle = C.chapter;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(xx, BAND_TOP);
      ctx.lineTo(xx, BAND_TOP + BAND_H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.chapter;
      ctx.beginPath();
      ctx.moveTo(xx, BAND_TOP);
      ctx.lineTo(xx + 8, BAND_TOP + 4);
      ctx.lineTo(xx, BAND_TOP + 8);
      ctx.closePath();
      ctx.fill();
    }

    // Trim handles
    const handle = (t: number, left: boolean) => {
      const xx = x(t);
      ctx.fillStyle = C.ink;
      ctx.beginPath();
      ctx.roundRect(left ? xx - 5 : xx - 1, BAND_TOP - 2, 6, BAND_H + 4, 3);
      ctx.fill();
      ctx.fillStyle = C.ground;
      ctx.fillRect(left ? xx - 3 : xx + 1, mid - 8, 2, 16);
    };
    handle(trimS, true);
    handle(trimE, false);

    // Playhead
    const t = P.getTime();
    const px = Math.round(x(t)) + 0.5;
    ctx.strokeStyle = C.tally;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, RULER - 2);
    ctx.lineTo(px, LANE_TOP + LANE_H);
    ctx.stroke();
    ctx.fillStyle = C.tally;
    ctx.beginPath();
    ctx.moveTo(px - 5, RULER - 8);
    ctx.lineTo(px + 5, RULER - 8);
    ctx.lineTo(px, RULER - 1);
    ctx.closePath();
    ctx.fill();
    lastTime.current = t;
    dirty.current = false;
  }, []);

  // Size the canvas to its box.
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const w = Math.max(200, wrap.clientWidth);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      size.current = { w, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(HEIGHT * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${HEIGHT}px`;
      dirty.current = true;
    });
    ro.observe(wrap);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const theme = () => {
      colors.current = null;
      hatch.current.key = '';
      dirty.current = true;
    };
    mq.addEventListener('change', theme);
    const mo = new MutationObserver(theme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      ro.disconnect();
      mq.removeEventListener('change', theme);
      mo.disconnect();
    };
  }, []);

  // Redraw when something changed or the playhead moved.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = props.current.getTime();
      if (dirty.current || Math.abs(t - lastTime.current) > 1e-3) draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // ------------------------------------------------------------ hit testing

  type Hit =
    | { type: 'ruler' }
    | { type: 'trim'; which: 'start' | 'end' }
    | { type: 'edge'; kind: 'cut' | 'zoom'; id: string; which: 'start' | 'end' }
    | { type: 'zoom'; id: string }
    | { type: 'cut'; id: string }
    | { type: 'empty' };

  const hitTest = (px: number, py: number): Hit => {
    const P = props.current;
    if (py < RULER + 2) return { type: 'ruler' };
    const D = P.duration;
    const inBand = py >= BAND_TOP - 4 && py <= BAND_TOP + BAND_H + 4;
    const inLane = py >= LANE_TOP - 2 && py <= LANE_TOP + LANE_H + 2;
    if (inBand) {
      if (Math.abs(px - xOf(P.edits.trimStart)) <= EDGE) return { type: 'trim', which: 'start' };
      if (Math.abs(px - xOf(P.edits.trimEnd ?? D)) <= EDGE) return { type: 'trim', which: 'end' };
      for (const c of P.edits.cuts) {
        if (Math.abs(px - xOf(c.start)) <= 5) return { type: 'edge', kind: 'cut', id: c.id, which: 'start' };
        if (Math.abs(px - xOf(c.end)) <= 5) return { type: 'edge', kind: 'cut', id: c.id, which: 'end' };
      }
      for (const c of P.edits.cuts) if (px >= xOf(c.start) && px <= xOf(c.end)) return { type: 'cut', id: c.id };
    }
    if (inLane) {
      for (const z of P.edits.zooms) {
        if (Math.abs(px - xOf(z.start)) <= 5) return { type: 'edge', kind: 'zoom', id: z.id, which: 'start' };
        if (Math.abs(px - xOf(z.end)) <= 5) return { type: 'edge', kind: 'zoom', id: z.id, which: 'end' };
        if (px >= xOf(z.start) && px <= xOf(z.end)) return { type: 'zoom', id: z.id };
      }
    }
    return { type: 'empty' };
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { px: e.clientX - r.left, py: e.clientY - r.top };
  };

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const P = props.current;
    const { px, py } = local(e);
    const t = tOf(px);
    canvasRef.current!.setPointerCapture(e.pointerId);
    const hit = hitTest(px, py);
    switch (hit.type) {
      case 'ruler':
        drag.current = { type: 'scrub' };
        P.onSeek(t);
        break;
      case 'trim':
        P.onBeginChange();
        drag.current = { type: 'trim', which: hit.which };
        break;
      case 'edge':
        P.onBeginChange();
        P.onSelectRegion({ kind: hit.kind, id: hit.id });
        drag.current = { type: 'edge', kind: hit.kind, id: hit.id, which: hit.which };
        break;
      case 'zoom': {
        const z = P.edits.zooms.find((zz) => zz.id === hit.id)!;
        P.onSelectRegion({ kind: 'zoom', id: hit.id });
        P.onSelection(null);
        drag.current = { type: 'move', id: hit.id, grab: t - z.start, startX: px, moved: false, began: false };
        break;
      }
      case 'cut':
        drag.current = { type: 'select', anchor: t, startX: px, moved: false, region: { kind: 'cut', id: hit.id } };
        break;
      default:
        drag.current = { type: 'select', anchor: t, startX: px, moved: false };
    }
  };

  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const P = props.current;
    const { px, py } = local(e);
    const t = tOf(px);
    const d = drag.current;
    const canvas = canvasRef.current!;
    if (!d) {
      const hit = hitTest(px, py);
      canvas.style.cursor =
        hit.type === 'trim' || hit.type === 'edge' ? 'ew-resize' : hit.type === 'zoom' ? 'grab' : hit.type === 'ruler' ? 'pointer' : 'text';
      return;
    }
    const D = P.duration;
    if (d.type === 'scrub') P.onSeek(t);
    else if (d.type === 'select') {
      if (!d.moved && Math.abs(px - d.startX) < 4) return;
      d.moved = true;
      P.onSelectRegion(null);
      P.onSelection(t >= d.anchor ? [d.anchor, t] : [t, d.anchor]);
    } else if (d.type === 'trim') {
      const e2 = P.edits;
      if (d.which === 'start') P.onEdits({ ...e2, trimStart: clamp(t, 0, (e2.trimEnd ?? D) - 0.5) });
      else {
        const v = clamp(t, e2.trimStart + 0.5, D);
        P.onEdits({ ...e2, trimEnd: v >= D - 0.01 ? null : v });
      }
      P.onSeek(t);
    } else if (d.type === 'edge') {
      const e2 = P.edits;
      if (d.kind === 'cut') {
        P.onEdits({
          ...e2,
          cuts: e2.cuts.map((c) =>
            c.id !== d.id ? c : d.which === 'start' ? { ...c, start: clamp(t, 0, c.end - 0.1) } : { ...c, end: clamp(t, c.start + 0.1, D) },
          ),
        });
      } else {
        P.onEdits({
          ...e2,
          zooms: e2.zooms.map((z) =>
            z.id !== d.id ? z : d.which === 'start' ? { ...z, start: clamp(t, 0, z.end - 0.5) } : { ...z, end: clamp(t, z.start + 0.5, D) },
          ),
        });
      }
      P.onSeek(t);
    } else if (d.type === 'move') {
      if (!d.moved && Math.abs(px - d.startX) < 4) return;
      d.moved = true;
      if (!d.began) {
        P.onBeginChange();
        d.began = true;
      }
      const e2 = P.edits;
      P.onEdits({
        ...e2,
        zooms: e2.zooms.map((z) => {
          if (z.id !== d.id) return z;
          const len = z.end - z.start;
          const start = clamp(t - d.grab, 0, D - len);
          return { ...z, start, end: start + len };
        }),
      });
      canvas.style.cursor = 'grabbing';
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const P = props.current;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const { px } = local(e);
    if (d.type === 'select' && !d.moved) {
      P.onSelection(null);
      P.onSelectRegion(d.region ?? null);
      P.onSeek(tOf(px));
    } else if (d.type === 'move' && !d.moved) {
      P.onSeek(tOf(px));
    }
  };

  return (
    <div className="timeline" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(p.duration)}
        aria-valuenow={Math.round(lastTime.current < 0 ? 0 : lastTime.current)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
      />
    </div>
  );
}
