// Draws one output frame: zoomed screen, camera bubble, burned-in caption.
// Used by the exporter and for thumbnails; the editor preview mirrors the same
// geometry with CSS (see layout.ts).

import type { VideoSample } from 'mediabunny';
import type { Edits, Mode } from './types.ts';
import { bubbleRect, captionFontPx, coverCrop } from './layout.ts';
import { cropFor, zoomAt } from './timeline.ts';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const CAPTION_FONT = '"Inter Variable", "Inter", system-ui, sans-serif';

function roundedRect(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export interface FrameInput {
  W: number;
  H: number;
  mode: Mode;
  edits: Edits;
  tSrc: number;
  main: VideoSample | null;
  cam: VideoSample | null;
  caption?: string;
}

export function drawFrame(ctx: Ctx2D, f: FrameInput): void {
  const { W, H, edits } = f;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  if (f.main) {
    const sw = f.main.displayWidth;
    const sh = f.main.displayHeight;
    const crop = cropFor(zoomAt(f.tSrc, edits.zooms));
    ctx.save();
    if (f.mode === 'cam' && edits.camera.mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    f.main.draw(ctx, crop.x * sw, crop.y * sh, crop.w * sw, crop.h * sh, 0, 0, W, H);
    ctx.restore();
  }

  if (f.cam && f.mode === 'screen-cam' && edits.camera.visible) {
    const r = bubbleRect(edits.camera, W, H);
    const c = coverCrop(f.cam.displayWidth, f.cam.displayHeight, r.w / r.h);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = Math.round(H * 0.02);
    ctx.shadowOffsetY = Math.round(H * 0.006);
    roundedRect(ctx, r.x, r.y, r.w, r.h, r.radius);
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundedRect(ctx, r.x, r.y, r.w, r.h, r.radius);
    ctx.clip();
    if (edits.camera.mirror) {
      ctx.translate(r.x * 2 + r.w, 0);
      ctx.scale(-1, 1);
    }
    f.cam.draw(ctx, c.sx, c.sy, c.sw, c.sh, r.x, r.y, r.w, r.h);
    ctx.restore();
    ctx.save();
    roundedRect(ctx, r.x, r.y, r.w, r.h, r.radius);
    ctx.lineWidth = Math.max(2, Math.round(H * 0.004));
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.restore();
  }

  if (f.caption) drawCaption(ctx, f.caption, W, H);
}

export function drawCaption(ctx: Ctx2D, text: string, W: number, H: number): void {
  const lines = text.split('\n').filter(Boolean);
  if (!lines.length) return;
  const size = captionFontPx(H);
  ctx.save();
  ctx.font = `600 ${size}px ${CAPTION_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineH = size * 1.32;
  const padX = size * 0.6;
  const padY = size * 0.34;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = Math.min(W * 0.92, widest + padX * 2);
  const boxH = lines.length * lineH + padY * 2;
  const x = (W - boxW) / 2;
  const y = H - H * 0.07 - boxH;
  roundedRect(ctx, x, y, boxW, boxH, size * 0.3);
  ctx.fillStyle = 'rgba(12, 13, 16, 0.78)';
  ctx.fill();
  ctx.fillStyle = '#fff';
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y + padY + lineH * (i + 0.5), W * 0.9));
  ctx.restore();
}
