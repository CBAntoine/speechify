"use client";

import { forwardRef } from "react";
import type { Creative } from "@/lib/types";

export type CreativeSize = "square" | "story" | "landscape";
export type CreativeTemplate = "bold" | "split" | "minimal";

export const SIZES: Record<CreativeSize, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: "Feed 1:1" },
  story: { w: 1080, h: 1920, label: "Story 9:16" },
  landscape: { w: 1200, h: 628, label: "Link 1.91:1" },
};

const HEX = /^#[0-9a-f]{6}$/i;

function safe(c: Creative["palette"]) {
  return {
    bg: HEX.test(c.bg) ? c.bg : "#16204a",
    fg: HEX.test(c.fg) ? c.fg : "#ffffff",
    accent: HEX.test(c.accent) ? c.accent : "#ffb020",
  };
}

/** Greedy word wrap by an average glyph width. */
function wrap(text: string, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const perLine = Math.max(6, Math.floor(maxWidth / (fontSize * 0.54)));
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > perLine && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/[\s,.;:]*$/, "") + "…";
    return kept;
  }
  return lines;
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const FONT = "Inter Variable, Inter, Helvetica Neue, Arial, sans-serif";

export const CreativeSvg = forwardRef<SVGSVGElement, { creative: Creative; business: string; size?: CreativeSize; template?: CreativeTemplate; className?: string; art?: string }>(
  function CreativeSvg({ creative, business, size = "square", template = "bold", className, art }, ref) {
    const { w, h } = SIZES[size];
    const p = safe(creative.palette);
    const onAccent = luminance(p.accent) > 0.45 ? "#111111" : "#ffffff";
    const pad = Math.round(w * 0.075);
    const story = size === "story";
    const land = size === "landscape";
    const narrow = template === "split" && !story;
    const nameY = pad + (land ? 34 : 44);
    const hasBadge = Boolean(creative.badge?.trim());
    const badgeH = land ? 44 : 56;
    const badgeY = story ? Math.round(h * 0.2) : nameY + (land ? 22 : 34);
    const badgeW = Math.min((narrow ? w * 0.58 : w) - pad * 2, creative.badge.length * (land ? 15 : 19) + 64);
    const headSize = Math.round((land ? 64 : story ? 104 : 92) * (narrow ? 0.84 : 1));
    const headWidth = narrow ? w * 0.6 - pad : w - pad * 2;
    const lineH = headSize * 1.08;
    const blockTop = hasBadge ? badgeY + badgeH + (land ? 26 : 44) : story ? h * 0.26 : nameY + (land ? 34 : 56);
    const headTop = Math.max(blockTop + headSize * 0.8, story ? h * 0.36 : 0);
    const ctaH = land ? 64 : 84;
    const ctaY = story ? h - pad - ctaH - 120 : h - pad - ctaH;
    const ctaW = Math.min(w - pad * 2, creative.cta.length * (land ? 19 : 25) + 96);
    const subSize = land ? 30 : 40;
    // Fit the headline and subline above the button.
    const room = ctaY - (land ? 28 : 48) - headTop;
    const maxHead = Math.max(1, Math.min(land ? 2 : story ? 5 : 4, Math.floor((room - subSize * 1.2) / lineH) + 1));
    const head = wrap(creative.headline, headSize, headWidth, maxHead);
    const subTop = headTop + head.length * lineH + subSize * 0.9;
    const subRoom = Math.floor((ctaY - (land ? 24 : 40) - subTop) / (subSize * 1.3)) + 1;
    const sub = subRoom > 0 ? wrap(creative.subline, subSize, headWidth, Math.min(2, subRoom)) : [];
    const id = `g${business.replace(/[^a-z0-9]/gi, "").slice(0, 8)}${size}${template}`;

    return (
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${w} ${h}`} width="100%" className={className} role="img" aria-label={`${creative.headline}. ${creative.subline}`}>
        <defs>
          <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={p.bg} />
            <stop offset="1" stopColor={p.bg} stopOpacity="0.86" />
          </linearGradient>
          <radialGradient id={`${id}-glow`} cx="0.85" cy="0.1" r="0.8">
            <stop offset="0" stopColor={p.accent} stopOpacity="0.38" />
            <stop offset="1" stopColor={p.accent} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={w} height={h} fill={p.bg} />
        {art ? (
          <>
            {/* Custom art fills the card; a scrim in the background colour keeps the text readable. */}
            <defs>
              <linearGradient id={`${id}-scrim`} x1="0" y1="0" x2={story ? "0" : "1"} y2={story ? "1" : "0"}>
                <stop offset="0" stopColor={p.bg} stopOpacity={story ? "0.88" : "0.94"} />
                <stop offset={story ? "0.55" : "0.5"} stopColor={p.bg} stopOpacity="0.55" />
                <stop offset="1" stopColor={p.bg} stopOpacity={story ? "0.9" : "0.05"} />
              </linearGradient>
            </defs>
            <image href={art} x="0" y="0" width={w} height={h} preserveAspectRatio="xMidYMid slice" />
            <rect width={w} height={h} fill={`url(#${id}-scrim)`} />
          </>
        ) : (
          <rect width={w} height={h} fill={`url(#${id}-bg)`} />
        )}
        {template !== "minimal" && !art && <rect width={w} height={h} fill={`url(#${id}-glow)`} />}
        {template === "split" && !story && !art && <rect x={w * 0.62} y={0} width={w * 0.38} height={h} fill={p.accent} opacity="0.92" />}
        {template === "split" && story && !art && <rect x={0} y={h * 0.7} width={w} height={h * 0.3} fill={p.accent} opacity="0.92" />}
        {template === "bold" &&
          Array.from({ length: 9 }, (_, i) => (
            <circle key={i} cx={w - pad - (i % 3) * 46} cy={pad + 10 + Math.floor(i / 3) * 46} r="9" fill={p.accent} opacity={0.5 - i * 0.04} />
          ))}
        {template === "minimal" && <rect x={pad} y={Math.max(18, pad - 40)} width={86} height={10} rx={5} fill={p.accent} />}

        <text x={pad} y={nameY} fill={p.fg} opacity="0.85" fontFamily={FONT} fontWeight="700" fontSize={land ? 30 : 38} letterSpacing="-0.5">
          {business}
        </text>

        {hasBadge && (
          <g transform={`translate(${pad} ${badgeY})`}>
            <rect width={badgeW} height={badgeH} rx={badgeH / 2} fill={p.fg} opacity="0.12" />
            <text x={land ? 22 : 28} y={land ? 29 : 37} fill={p.fg} fontFamily={FONT} fontWeight="650" fontSize={land ? 22 : 28}>
              {creative.badge}
            </text>
          </g>
        )}

        <text fill={p.fg} fontFamily={FONT} fontWeight="800" fontSize={headSize} letterSpacing={-headSize * 0.03}>
          {head.map((line, i) => (
            <tspan key={i} x={pad} y={headTop + i * lineH}>
              {line}
            </tspan>
          ))}
        </text>
        <text fill={p.fg} opacity="0.82" fontFamily={FONT} fontWeight="500" fontSize={subSize}>
          {sub.map((line, i) => (
            <tspan key={i} x={pad} y={subTop + i * subSize * 1.3}>
              {line}
            </tspan>
          ))}
        </text>

        <g transform={`translate(${pad} ${ctaY})`}>
          <rect width={ctaW} height={ctaH} rx={ctaH / 2} fill={template === "split" ? p.fg : p.accent} />
          <text x={ctaW / 2} y={ctaH / 2 + (land ? 9 : 12)} textAnchor="middle" fill={template === "split" ? p.bg : onAccent} fontFamily={FONT} fontWeight="750" fontSize={land ? 26 : 34}>
            {creative.cta} →
          </text>
        </g>
      </svg>
    );
  }
);

/** An SVG drawn into a canvas can't load outside images, so embed them first. */
async function inlineImages(svg: SVGSVGElement) {
  for (const img of Array.from(svg.querySelectorAll("image"))) {
    const href = img.getAttribute("href");
    if (!href || href.startsWith("data:")) continue;
    const blob = await fetch(href).then((r) => {
      if (!r.ok) throw new Error("Couldn't load the ad art");
      return r.blob();
    });
    const data = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error("Couldn't read the ad art"));
      fr.readAsDataURL(blob);
    });
    img.setAttribute("href", data);
  }
}

/** Render an SVG element to a PNG blob at full size. */
export async function renderPng(svg: SVGSVGElement, width: number, height: number): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  await inlineImages(clone);
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Couldn't render the image"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not available");
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!blob) throw new Error("Couldn't create the PNG");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Render an SVG element to a PNG and download it. */
export async function downloadPng(svg: SVGSVGElement, filename: string, width: number, height: number) {
  const blob = await renderPng(svg, width, height);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Send the PNG to another app (WhatsApp, Instagram, Gmail…) with the phone's share sheet. */
export async function sharePng(svg: SVGSVGElement, filename: string, width: number, height: number, text?: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = await renderPng(svg, width, height);
  const file = new File([blob], filename, { type: "image/png" });
  const data: ShareData = { files: [file], ...(text ? { text } : {}) };
  if (typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare(data)) {
    try {
      await navigator.share(data);
      return "shared";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return "downloaded";
}
