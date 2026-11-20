// Geometry shared by the editor preview (CSS) and the exporter (canvas), so the
// two always agree on where the camera bubble and captions sit.

import type { CameraLayout } from './types.ts';
import { clamp } from './timeline.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
}

export const DEFAULT_CAMERA: CameraLayout = {
  visible: true,
  shape: 'circle',
  size: 0.3,
  x: 0.86,
  y: 0.78,
  mirror: true,
};

/** Bubble rectangle in pixels for a frame of W x H. */
export function bubbleRect(cam: CameraLayout, W: number, H: number): Rect {
  const short = Math.min(W, H);
  const h = clamp(cam.size, 0.12, 0.7) * short;
  const w = cam.shape === 'wide' ? h * (16 / 9) : h;
  const margin = short * 0.025;
  const cx = clamp(cam.x * W, w / 2 + margin, W - w / 2 - margin);
  const cy = clamp(cam.y * H, h / 2 + margin, H - h / 2 - margin);
  const radius = cam.shape === 'circle' ? h / 2 : cam.shape === 'rounded' ? h * 0.2 : h * 0.1;
  return { x: cx - w / 2, y: cy - h / 2, w, h, radius };
}

/** Source crop that fills a box of aspect `boxAspect` (object-fit: cover). */
export function coverCrop(srcW: number, srcH: number, boxAspect: number) {
  const srcAspect = srcW / srcH;
  if (srcAspect > boxAspect) {
    const sw = srcH * boxAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  const sh = srcW / boxAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

/** Output size for a target height, keeping aspect and even dimensions. */
export function outputSize(srcW: number, srcH: number, targetHeight: number | null): { width: number; height: number } {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  if (!targetHeight || targetHeight >= srcH) return { width: even(srcW), height: even(srcH) };
  const scale = targetHeight / srcH;
  return { width: even(srcW * scale), height: even(targetHeight) };
}

/** Splits caption text into at most two balanced lines that fit `maxChars`. */
export function wrapCaption(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Caption font size for a frame height. */
export const captionFontPx = (H: number) => Math.max(14, Math.round(H * 0.045));
