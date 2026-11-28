// The Filmer's video: a 1080×1920, 30 fps short that shows a business its new
// website on a phone, scrolling top to bottom, with a hook on top, captions
// timed to the voiceover and an end card with the offer.
//
// Every graphic is HTML rendered to a PNG by the shared headless browser and
// composited by FFmpeg with scale/crop/overlay/fade/boxblur/loop only, so any
// FFmpeg build works (no drawtext, subtitles or libass).

import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "playwright";
import { settle, withPage } from "../providers/browser.ts";
import { hasEncoder, probe, runFfmpeg } from "../providers/ffmpeg.ts";
import type { Caption } from "./captions.ts";

export interface ComposeInput {
  /** Absolute path to a full-page mobile screenshot (PNG/JPEG, ~1170 px wide). */
  siteShot: string;
  /** Gets video.mp4 and poster.jpg. */
  outDir: string;
  /** Voiceover. Captions are timed from its start. A silent track is used when missing. */
  audioPath?: string;
  /** Length when there is no audio (default 12). */
  durationSec?: number;
  captions: Caption[];
  hook: string;
  endCard: { title: string; subtitle: string };
  brand: { primary: string; accent: string; ink: string; bg: string };
  businessName: string;
}

export interface ComposeResult {
  videoPath: string;
  posterPath: string;
  durationSec: number;
}

// ── Geometry (1080×1920) ─────────────────────────────────────────────────

const W = 1080;
const H = 1920;
const FPS = 30;
// The bezel must be at least 0.293 × the outer radius so the screen's square
// corners stay inside the phone body (the frame is drawn over the screen).
const PHONE = { x: 230, y: 420, w: 620, h: 1220, bezel: 22, radius: 72 };
const SCREEN = { x: PHONE.x + PHONE.bezel, y: PHONE.y + PHONE.bezel, w: PHONE.w - 2 * PHONE.bezel, h: PHONE.h - 2 * PHONE.bezel, radius: PHONE.radius - PHONE.bezel };
const STATUS_H = 58; // the phone's status bar; the page starts below it
const CONTENT = { x: SCREEN.x, y: SCREEN.y + STATUS_H, w: SCREEN.w, h: SCREEN.h - STATUS_H };
const PHONE_BOX = { x: 80, y: 300, w: 920, h: H - 300 }; // the phone layer incl. shadow and side buttons
const HOOK_BOX = { x: 0, y: 0, w: W, h: 410 };
const CAP_BOX = { x: 0, y: 1600, w: W, h: 300 };
const LEAD = 0.35; // silence before the voiceover starts
const TAIL = 0.6; // after it ends
const MAX_SCROLL_H = 12_000; // px of page (at screen width) we scroll through

// ── Colour helpers ───────────────────────────────────────────────────────

type RGB = [number, number, number];

function parseHex(hex: string | undefined, fallback: RGB): RGB {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex = (c: RGB) => "#" + c.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");
const rgba = (c: RGB, a: number) => `rgba(${c.map((v) => Math.round(v)).join(",")},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function luminance([r, g, b]: RGB): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const BLACK: RGB = [0, 0, 0];
const WHITE: RGB = [255, 255, 255];
const NEAR_BLACK: RGB = [11, 13, 18];

function inkOn(bg: RGB): string {
  return contrast(bg, WHITE) >= contrast(bg, NEAR_BLACK) ? "#ffffff" : hex(NEAR_BLACK);
}

interface Colors {
  primary: RGB;
  accent: RGB;
  accentInk: string;
  deep: RGB;
  deeper: RGB;
  mid: RGB;
}

function colors(brand: ComposeInput["brand"]): Colors {
  const primary = parseHex(brand.primary, [31, 79, 209]);
  let accent = parseHex(brand.accent, [255, 183, 3]);
  // An accent that disappears into the dark background gets lifted.
  if (contrast(accent, mix(primary, BLACK, 0.7)) < 2.2) accent = mix(accent, WHITE, 0.45);
  return {
    primary,
    accent,
    accentInk: inkOn(accent),
    deep: mix(primary, BLACK, 0.55),
    deeper: mix(primary, BLACK, 0.82),
    mid: mix(primary, BLACK, 0.25),
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── Layers (HTML in full-frame coordinates, clipped to a box) ───────────

const FONTS_HREF = "https://fonts.googleapis.com/css2?family=Inter:wght@600;700;800;900&family=Inter+Tight:wght@800;900&display=swap";
const NOISE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>";
const STACK = `Inter,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`;
const TIGHT = `"Inter Tight",${STACK}`;

const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS_HREF}">
<style>
html,body{margin:0;padding:0;background:transparent}
*{box-sizing:border-box}
body{font-family:${STACK};-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
#stage{position:relative;width:${W}px;height:${H}px;overflow:hidden}
#stage div{text-wrap:balance}
.t{font-family:${TIGHT}}
.k{display:inline-block;white-space:nowrap;overflow:hidden;max-width:100%;padding:12px 28px 13px;border-radius:999px;font-weight:800;font-size:28px;line-height:1.1;letter-spacing:.09em;text-transform:uppercase}
</style></head><body><div id="stage"></div></body></html>`;

function gradientLayer(c: Colors): string {
  return `<div style="position:absolute;inset:0;background:
  radial-gradient(75% 42% at 10% 4%, ${rgba(c.primary, 0.8)} 0%, ${rgba(c.primary, 0)} 70%),
  radial-gradient(70% 40% at 98% 96%, ${rgba(c.accent, 0.45)} 0%, ${rgba(c.accent, 0)} 72%),
  linear-gradient(170deg, ${rgba(c.deep, 0.8)} 0%, ${rgba(c.deeper, 0.94)} 100%)"></div>
<div style="position:absolute;inset:0;opacity:.09;background-image:url(&quot;${NOISE}&quot;);background-size:240px 240px"></div>`;
}

function statusBar(top: RGB): string {
  const s = SCREEN;
  const ink = inkOn(top);
  const icon = (d: string, w: number) => `<svg width="${w}" height="22" viewBox="0 0 ${w} 22" fill="${ink}">${d}</svg>`;
  const signal = icon('<rect x="0" y="14" width="4.5" height="7" rx="1.2"/><rect x="7" y="10" width="4.5" height="11" rx="1.2"/><rect x="14" y="6" width="4.5" height="15" rx="1.2"/><rect x="21" y="2" width="4.5" height="19" rx="1.2"/>', 26);
  const wifi = `<svg width="26" height="22" viewBox="0 0 26 22" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"><path d="M2.5 8.5a15 15 0 0 1 21 0"/><path d="M6.5 12.5a9.5 9.5 0 0 1 13 0"/><circle cx="13" cy="17.5" r="1.8" fill="${ink}" stroke="none"/></svg>`;
  const battery = `<svg width="40" height="22" viewBox="0 0 40 22"><rect x="1" y="3" width="33" height="16" rx="4.5" fill="none" stroke="${ink}" stroke-opacity=".45" stroke-width="2"/><rect x="4" y="6" width="25" height="10" rx="2.5" fill="${ink}"/><rect x="36" y="8" width="2.5" height="6" rx="1.2" fill="${ink}" fill-opacity=".45"/></svg>`;
  return `<div style="position:absolute;left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${STATUS_H}px;border-radius:${s.radius}px ${s.radius}px 0 0;background:${hex(top)};display:flex;align-items:center;justify-content:space-between;padding:6px 40px 0 58px;color:${ink};font-weight:700;font-size:23px;letter-spacing:-.01em">
  <span>9:41</span><span style="display:flex;gap:9px;align-items:center">${signal}${wifi}${battery}</span>
</div>`;
}

function phoneLayer(top: RGB): string {
  const p = PHONE;
  const s = SCREEN;
  const button = (left: number, top: number, h: number, side: "l" | "r") =>
    `<div style="position:absolute;left:${left}px;top:${top}px;width:7px;height:${h}px;border-radius:${side === "r" ? "0 4px 4px 0" : "4px 0 0 4px"};background:linear-gradient(${side === "r" ? 90 : 270}deg,#1e1f25,#41424c)"></div>`;
  return `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;border-radius:${p.radius}px;box-shadow:0 70px 130px rgba(0,0,0,.55),0 26px 50px rgba(0,0,0,.32),0 0 0 3px #3b3c46,0 0 0 5px rgba(255,255,255,.08)"></div>
<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.w}px;height:${p.h}px;border-radius:${p.radius}px;border:${p.bezel}px solid #0b0b0f"></div>
${statusBar(top)}
<div style="position:absolute;left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;border-radius:${s.radius}px;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.07);background:linear-gradient(118deg,rgba(255,255,255,.11) 0%,rgba(255,255,255,.035) 20%,rgba(255,255,255,0) 38%)"></div>
<div style="position:absolute;left:${W / 2 - 74}px;top:${s.y + 9}px;width:148px;height:42px;border-radius:21px;background:#040406;box-shadow:0 0 0 1px rgba(255,255,255,.04)"></div>
${button(p.x + p.w + 2, p.y + 300, 128, "r")}${button(p.x - 9, p.y + 232, 84, "l")}${button(p.x - 9, p.y + 338, 84, "l")}`;
}

function highlight(text: string, name: string, color: string): string {
  const safe = esc(text);
  const target = esc(name);
  if (!target) return safe;
  const at = safe.toLowerCase().indexOf(target.toLowerCase());
  if (at < 0) return safe;
  return `${safe.slice(0, at)}<span style="color:${color}">${safe.slice(at, at + target.length)}</span>${safe.slice(at + target.length)}`;
}

function hookLayer(c: Colors, hook: string, business: string): string {
  return `<div style="position:absolute;left:56px;right:56px;top:72px;display:flex;flex-direction:column;align-items:center;gap:22px;text-align:center">
  <div class="k" data-fit data-lines="1" data-min="18" style="background:${hex(c.accent)};color:${c.accentInk};box-shadow:0 10px 26px rgba(0,0,0,.28)">Built for ${esc(business)}</div>
  <div class="t" data-fit data-lines="2" data-min="44" style="max-width:100%;font-weight:900;font-size:90px;line-height:1.02;letter-spacing:-.032em;color:#fff;text-shadow:0 6px 28px rgba(0,0,0,.4);overflow:hidden">${highlight(hook, business, hex(mix(c.accent, WHITE, 0.15)))}</div>
</div>`;
}

function captionLayer(c: Colors, text: string, i: number): string {
  const tilt = i % 2 === 0 ? -1.6 : 1.4;
  const accentTurn = i % 3 === 1;
  const bg = accentTurn ? hex(c.accent) : "#ffffff";
  const ink = accentTurn ? c.accentInk : hex(NEAR_BLACK);
  return `<div style="position:absolute;left:0;right:0;top:${CAP_BOX.y}px;height:${CAP_BOX.h}px;display:flex;align-items:center;justify-content:center;padding:0 70px">
  <div class="t" data-fit data-lines="2" data-min="40" style="max-width:940px;text-align:center;font-weight:900;font-size:80px;line-height:1.03;letter-spacing:-.018em;text-transform:uppercase;color:${ink};background:${bg};padding:16px 36px 21px;border-radius:26px;box-shadow:0 20px 44px rgba(0,0,0,.42);transform:rotate(${tilt}deg)">${esc(text)}</div>
</div>`;
}

function endLayer(c: Colors, end: ComposeInput["endCard"], business: string, thumb?: string): string {
  const phone = thumb
    ? `<div style="margin-top:48px;width:384px;height:748px;border-radius:58px;border:15px solid #0b0b0f;overflow:hidden;background:#fff;transform:rotate(-4deg);box-shadow:0 44px 90px rgba(0,0,0,.5),0 0 0 3px #3b3c46"><img src="${thumb}" style="display:block;width:100%;height:auto"></div>`
    : "";
  return `<div style="position:absolute;inset:0;background:
  radial-gradient(70% 38% at 50% 36%, ${rgba(c.accent, 0.32)} 0%, ${rgba(c.accent, 0)} 70%),
  linear-gradient(172deg, ${hex(c.mid)} 0%, ${hex(c.deeper)} 100%)"></div>
<div style="position:absolute;inset:0;opacity:.09;background-image:url(&quot;${NOISE}&quot;);background-size:240px 240px"></div>
<div style="position:absolute;left:70px;right:70px;top:40px;height:${H - 80}px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
  <div class="k" data-fit data-lines="1" data-min="18" style="background:rgba(255,255,255,.14);color:#fff;box-shadow:inset 0 0 0 1.5px rgba(255,255,255,.22)">Built for ${esc(business)}</div>
  ${phone}
  <div class="t" data-fit data-lines="2" data-min="48" style="margin-top:${thumb ? 60 : 48}px;max-width:100%;font-weight:900;font-size:108px;line-height:1;letter-spacing:-.034em;color:#fff;text-shadow:0 6px 28px rgba(0,0,0,.3)">${esc(end.title)}</div>
  <div data-fit data-lines="2" data-min="30" style="margin-top:26px;max-width:100%;font-weight:700;font-size:50px;line-height:1.16;color:${hex(c.accent)}">${esc(end.subtitle)}</div>
</div>`;
}

/** Shrink [data-fit] text until it fits data-lines lines and its box width. */
function fitText() {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-fit]"))) {
    const lines = Number(el.dataset.lines || "2");
    const min = Number(el.dataset.min || "24");
    let size = parseFloat(getComputedStyle(el).fontSize);
    const fits = () => {
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || size * 1.15;
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      // Glyphs overhang tight line-heights, so allow ~0.4em of slack: still far less than another line.
      return el.scrollHeight <= Math.ceil(lh * lines + pad + size * 0.4) && el.scrollWidth <= el.clientWidth + 1;
    };
    let guard = 0;
    while (!fits() && size > min && guard++ < 120) {
      size -= 2;
      el.style.fontSize = `${size}px`;
    }
  }
}

/** Fetch every face we use up front: fonts only download once text needs them, which would be too late for a screenshot. */
async function preloadFonts(page: Page): Promise<void> {
  await page
    .evaluate(async () => {
      const faces = ["600 40px Inter", "700 40px Inter", "800 40px Inter", "900 40px Inter", '800 40px "Inter Tight"', '900 40px "Inter Tight"'];
      await Promise.race([Promise.all(faces.map((f) => document.fonts.load(f).catch(() => []))), new Promise((r) => setTimeout(r, 7000))]);
    })
    .catch(() => {});
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function renderLayer(page: Page, html: string, box: Box, transparent: boolean): Promise<Buffer> {
  await page.evaluate((markup: string) => {
    document.getElementById("stage")!.innerHTML = markup;
  }, html);
  await settle(page, 6000);
  await page.evaluate(fitText);
  return page.screenshot({ type: "png", omitBackground: transparent, clip: { x: box.x, y: box.y, width: box.w, height: box.h }, animations: "disabled" });
}

// ── FFmpeg helpers ───────────────────────────────────────────────────────

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * A still image as an endless stream with clean 30 fps timestamps, cut to d
 * seconds. `pre` runs once on the single decoded frame (pixel-format
 * conversion belongs there), `post` on every frame (crop, fades).
 */
const still = (input: number, label: string, d: number, pre: string, post = "") =>
  `[${input}:v]${pre},loop=loop=-1:size=1:start=0,setpts=N/${FPS}/TB,trim=duration=${d}${post}[${label}]`;

async function videoCodecArgs(): Promise<string[]> {
  if (await hasEncoder("libx264")) return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-profile:v", "high"];
  if (await hasEncoder("h264_videotoolbox")) return ["-c:v", "h264_videotoolbox", "-b:v", "6M"];
  if (await hasEncoder("libopenh264")) return ["-c:v", "libopenh264", "-b:v", "6M"];
  return ["-c:v", "mpeg4", "-q:v", "3"];
}

// ── Compose ──────────────────────────────────────────────────────────────

/** MAINSTREET_DEBUG=1 logs how long each render step takes. */
function timer() {
  const on = Boolean(process.env.MAINSTREET_DEBUG);
  let last = Date.now();
  return (label: string) => {
    if (!on) return;
    const now = Date.now();
    console.log(`[filmer] ${label}: ${now - last} ms`);
    last = now;
  };
}

export async function composeVideo(input: ComposeInput): Promise<ComposeResult> {
  const c = colors(input.brand);
  const business = input.businessName.trim() || "your business";

  const audio = input.audioPath ? await probe(input.audioPath).catch(() => null) : null;
  const audioDur = audio?.hasAudio ? audio.durationSec : 0;
  const hasAudio = audioDur > 0.2;
  const lead = hasAudio ? LEAD : 0;
  const D = r2(hasAudio ? lead + audioDur + TAIL : Math.max(3, input.durationSec ?? 12));
  const endDur = r2(Math.min(2.2, Math.max(1.2, D * 0.18)));
  const endStart = r2(D - endDur);

  const captions = input.captions
    .map((cap) => ({ text: cap.text.trim(), start: r2(cap.start + lead), end: r2(Math.min(D, cap.end + lead)) }))
    .filter((cap) => cap.text && cap.start < D && cap.end > cap.start)
    .slice(0, 60);

  const lap = timer();
  await mkdir(input.outDir, { recursive: true });
  const tmp = await mkdtemp(path.join(os.tmpdir(), "ms-film-"));
  const f = (name: string) => path.join(tmp, name);
  try {
    // 1. The page at screen width (scrolls inside the phone) and a thumbnail for the end card.
    await runFfmpeg(["-i", input.siteShot, "-vf", `scale=${SCREEN.w}:-2:flags=lanczos,format=rgb24,crop=${SCREEN.w}:'min(ih,${MAX_SCROLL_H})':0:0`, "-frames:v", "1", f("scroll.png")]);
    await runFfmpeg(["-i", input.siteShot, "-vf", "crop=iw:'min(ih,iw*1.95)':0:0,scale=354:-2:flags=lanczos", "-frames:v", "1", "-q:v", "3", f("thumb.jpg")]);
    await runFfmpeg(["-i", input.siteShot, "-vf", "crop=iw:'min(ih,48)':0:0,scale=1:1:flags=area,format=rgb24", "-frames:v", "1", "-f", "rawvideo", f("top.rgb")]);
    const px = await readFile(f("top.rgb"));
    const top: RGB = px.length >= 3 ? [px[0], px[1], px[2]] : WHITE;
    const scroll = await probe(f("scroll.png"));
    lap("prepare screenshot");
    const scrollH = scroll.height ?? SCREEN.h;
    const thumb = `data:image/jpeg;base64,${(await readFile(f("thumb.jpg"))).toString("base64")}`;

    // 2. Graphics.
    const layers = await withPage({ width: W, height: H }, async (page) => {
      await page.setContent(SHELL, { waitUntil: "domcontentloaded", timeout: 20_000 });
      await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
      await preloadFonts(page);
      const full: Box = { x: 0, y: 0, w: W, h: H };
      return {
        gradient: await renderLayer(page, gradientLayer(c), full, true),
        phone: await renderLayer(page, phoneLayer(top), PHONE_BOX, true),
        hook: await renderLayer(page, hookLayer(c, input.hook, business), HOOK_BOX, true),
        end: await renderLayer(page, endLayer(c, input.endCard, business, thumb), full, false),
        caps: await captions.reduce<Promise<Buffer[]>>(async (acc, cap, i) => [...(await acc), await renderLayer(page, captionLayer(c, cap.text, i), CAP_BOX, true)], Promise.resolve([])),
      };
    });
    lap(`render ${5 + captions.length} graphics`);
    await writeFile(f("gradient.png"), layers.gradient);
    await writeFile(f("phone.png"), layers.phone);
    await writeFile(f("hook.png"), layers.hook);
    await writeFile(f("end.png"), layers.end);
    await Promise.all(layers.caps.map((b, i) => writeFile(f(`cap${i}.png`), b)));

    // 3. Background: the top of the site, blurred, under the brand gradient.
    await runFfmpeg([
      "-i", input.siteShot,
      "-i", f("gradient.png"),
      "-filter_complex",
      `[0:v]crop=iw:'min(ih,iw*16/9)':0:0,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},format=rgb24,boxblur=30:3[b];[b][1:v]overlay=0:0:format=auto,format=rgb24[o]`,
      "-map", "[o]", "-frames:v", "1", f("base.png"),
    ]);

    lap("background");

    // 4. Everything together.
    const maxY = Math.max(0, scrollH - CONTENT.h);
    const target = Math.round(Math.max(0, maxY - CONTENT.h * 0.05));
    const t0 = D >= 8 ? 1.0 : 0.5;
    const t1 = r2(Math.max(t0 + 0.8, endStart - 0.3));
    const scrollY = target > 0 ? `${target}*(1-cos(PI*clip((t-${t0})/${r2(t1 - t0)},0,1)))/2` : "0";
    const pad = scrollH < CONTENT.h ? `,pad=${CONTENT.w}:${CONTENT.h}:0:0:white` : "";

    const files = [f("base.png"), f("scroll.png"), f("phone.png"), f("hook.png"), f("end.png"), ...captions.map((_, i) => f(`cap${i}.png`))];
    const args: string[] = [];
    for (const file of files) args.push("-framerate", String(FPS), "-i", file);
    const audioIndex = files.length;
    if (hasAudio) args.push("-i", input.audioPath!);
    else args.push("-f", "lavfi", "-t", String(D), "-i", "anullsrc=r=44100:cl=stereo");

    const graph: string[] = [
      // Composited in YUV 4:2:0 (the output format): every layer is converted
      // once, before it loops, so no frame pays for a colour conversion.
      still(0, "base", D, "format=yuv420p"),
      still(1, "scr", D, `format=yuv420p${pad}`, `,crop=${CONTENT.w}:${CONTENT.h}:0:'${scrollY}'`),
      still(2, "phone", D, "format=yuva420p"),
      still(3, "hook", D, "format=yuva420p", ",fade=t=in:st=0.05:d=0.45:alpha=1"),
      still(4, "end", D, "format=yuva420p", `,fade=t=in:st=${endStart}:d=0.35:alpha=1`),
      ...captions.map((_, i) => still(5 + i, `c${i}`, D, "format=yuva420p")),
      `[base][scr]overlay=${CONTENT.x}:${CONTENT.y}[v0]`,
      `[v0][phone]overlay=${PHONE_BOX.x}:${PHONE_BOX.y}[v1]`,
      `[v1][hook]overlay=${HOOK_BOX.x}:${HOOK_BOX.y}[v2]`,
      `[v2][end]overlay=0:0:enable='gte(t,${endStart})'[v3]`,
    ];
    let last = "v3";
    captions.forEach((cap, i) => {
      const next = `v${4 + i}`;
      graph.push(`[${last}][c${i}]overlay=${CAP_BOX.x}:${CAP_BOX.y}:enable='between(t,${cap.start},${cap.end})'[${next}]`);
      last = next;
    });
    graph.push(`[${last}]format=yuv420p[vout]`);
    const ms = Math.round(lead * 1000);
    graph.push(
      hasAudio
        ? `[${audioIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo,adelay=${ms}|${ms},apad,atrim=duration=${D},asetpts=N/SR/TB[aout]`
        : `[${audioIndex}:a]atrim=duration=${D},asetpts=N/SR/TB[aout]`
    );

    const partial = path.join(input.outDir, "video.part.mp4");
    await runFfmpeg(
      [
        ...args,
        "-filter_complex", graph.join(";"),
        "-map", "[vout]", "-map", "[aout]",
        ...(await videoCodecArgs()),
        "-pix_fmt", "yuv420p", "-r", String(FPS),
        "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
        "-movflags", "+faststart",
        "-t", String(D),
        partial,
      ],
      { timeoutMs: 300_000 }
    );
    lap("composite + encode");
    const videoPath = path.join(input.outDir, "video.mp4");
    await rename(partial, videoPath);

    // 5. Poster.
    const posterPath = path.join(input.outDir, "poster.jpg");
    const posterPart = path.join(input.outDir, "poster.part.jpg");
    // Just before the scroll starts: hook faded in, the hero and header untouched.
    const posterAt = r2(Math.min(Math.max(0.55, t0 - 0.05), D / 2));
    await runFfmpeg(["-ss", String(posterAt), "-i", videoPath, "-frames:v", "1", "-q:v", "3", posterPart]);
    await rename(posterPart, posterPath);

    return { videoPath, posterPath, durationSec: D };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
    await rm(path.join(input.outDir, "video.part.mp4"), { force: true }).catch(() => {});
    await rm(path.join(input.outDir, "poster.part.jpg"), { force: true }).catch(() => {});
  }
}
