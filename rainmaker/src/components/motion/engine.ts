// The motion ad engine: draws any moment of an approved storyboard with
// Three.js, then sets the words on top. Deterministic (the same time gives
// the same frame), so the preview and the 4K render match exactly.
//
// The directing rules are built in rather than left to each storyboard:
// - one shape, dead centre, morphs into the next shot (size, corners,
//   ring, colour); pictures inside it change with an iris wipe from the
//   centre, never a cross dissolve;
// - the background never stops moving (flowing light, dust in 3D,
//   optional speed lines), and the shape floats and catches a sheen;
// - words rise into place from behind a mask and leave the same way, one
//   after another; no fading or bouncing letters.

import type * as THREE_NS from "three";
import type { MotionAd, MotionShot } from "@/lib/types";
import { FORMATS, MORPH, inkFor, shapeBox, timeline } from "@/lib/motion/story";

type Three = typeof THREE_NS;

export const DISPLAY_FONT = '"Geist Variable", "Inter Variable", system-ui, sans-serif';
const BODY_FONT = '"Inter Variable", system-ui, sans-serif';

export interface MotionPictures {
  logo?: ImageBitmap;
  photos: (ImageBitmap | undefined)[];
}

export interface MotionScene {
  shots: MotionShot[];
  brand: MotionAd["brand"];
  format: MotionAd["format"];
  pictures: MotionPictures;
}

/** Per-format composition: shape scale, how far above centre it sits, type sizes (of the short side). */
const LAYOUT = {
  vertical: { scale: 1, y: 0.1, head: 0.084, sub: 0.04 },
  square: { scale: 0.8, y: 0.1, head: 0.074, sub: 0.036 },
  landscape: { scale: 0.68, y: 0.1, head: 0.066, sub: 0.032 },
} as const;

const FOV = 30;

// ── Easing and colour ────────────────────────────────────────

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeIn = (x: number) => x * x * x;
const easeOutExpo = (x: number) => (x >= 1 ? 1 : 1 - 2 ** (-10 * x));
const easeOutBack = (x: number, s = 0.9) => 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2;

type RGB = [number, number, number];
function rgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? [...h].map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((i) => (parseInt(f.slice(i, i + 2), 16) || 0) / 255) as RGB;
}
const mixRgb = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

// ── Shaders ──────────────────────────────────────────────────

const SD_BOX = /* glsl */ `
float sdBox(vec2 p, vec2 b, float r) {
  r = min(r, min(b.x, b.y));
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}`;

const HASH = /* glsl */ `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}`;

const PLANE_VERT = /* glsl */ `
uniform vec2 uPlane;
varying vec2 vPos;
void main() {
  vPos = position.xy * 2.0 * uPlane;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SHAPE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vPos;
uniform vec2 uHalf;
uniform float uRadius, uHollow, uRingW, uAA, uTime, uReveal;
uniform vec3 uColA, uPlateA, uColB, uPlateB, uRim;
uniform sampler2D uTexA, uTexB;
uniform float uModeA, uAspA, uZoomA, uModeB, uAspB, uZoomB, uRimAmt;
${SD_BOX}
vec3 layer(vec2 p, float mode, vec3 col, sampler2D tex, float asp, vec3 plate, float zoom) {
  vec2 q = p / (2.0 * uHalf) + 0.5;
  // Photo: cover the box, whatever shape it's morphing through.
  float a = uHalf.x / max(uHalf.y, 1e-4);
  vec2 uv = q - 0.5;
  if (asp > a) uv.x *= a / asp; else uv.y *= asp / a;
  uv = uv / zoom + 0.5;
  vec3 photo = texture2D(tex, vec2(uv.x, 1.0 - uv.y)).rgb;
  // Logo: contained on its plate.
  float wide = smoothstep(1.3, 2.4, asp);
  vec2 inner = 2.0 * uHalf * mix(vec2(0.64), vec2(0.84, 0.6), wide);
  vec2 size = asp > inner.x / max(inner.y, 1e-4) ? vec2(inner.x, inner.x / asp) : vec2(inner.y * asp, inner.y);
  vec2 lv = p / max(size, vec2(1e-4)) + 0.5;
  vec4 lt = texture2D(tex, vec2(lv.x, 1.0 - lv.y));
  float inside = step(0.0, lv.x) * step(lv.x, 1.0) * step(0.0, lv.y) * step(lv.y, 1.0);
  vec3 logo = mix(plate, lt.rgb, lt.a * inside);
  // Colour, lit from above.
  vec3 flat_ = col * (1.03 - 0.09 * (1.0 - q.y));
  return mode < 0.5 ? flat_ : (mode < 1.5 ? photo : logo);
}
void main() {
  float d = sdBox(vPos, uHalf, uRadius);
  float fill = 1.0 - smoothstep(-uAA, uAA, d);
  float cut = mix(min(uHalf.x, uHalf.y) + 1.0, uRingW, uHollow);
  float hole = 1.0 - smoothstep(-uAA, uAA, d + cut);
  float alpha = fill * (1.0 - hole);
  if (alpha < 0.01) discard;
  vec3 ca = layer(vPos, uModeA, uColA, uTexA, uAspA, uPlateA, uZoomA);
  vec3 cb = layer(vPos, uModeB, uColB, uTexB, uAspB, uPlateB, uZoomB);
  float maxR = length(uHalf);
  float r = length(vPos) / max(maxR, 1e-4);
  float edge = uAA / max(maxR, 1e-4);
  float showB = 1.0 - smoothstep(uReveal - edge, uReveal + edge, r);
  vec3 c = mix(ca, cb, showB);
  vec2 q = vPos / (2.0 * max(uHalf, vec2(1e-4)));
  float band = q.x * 0.8 + q.y * 0.6 - (fract(uTime * 0.11) * 3.2 - 1.6);
  c += 0.055 * exp(-band * band * 20.0);
  float rim = 1.0 - smoothstep(0.0, uAA * 2.5, -d);
  c = mix(c, uRim, rim * uRimAmt);
  gl_FragColor = vec4(c, alpha);
}`;

const SHADOW_FRAG = /* glsl */ `
precision highp float;
varying vec2 vPos;
uniform vec2 uHalf;
uniform float uRadius, uHollow, uRingW, uBlur, uAmount;
${SD_BOX}
void main() {
  float d = sdBox(vPos, uHalf, uRadius);
  float fill = 1.0 - smoothstep(-uBlur * 0.4, uBlur, d);
  float cut = mix(min(uHalf.x, uHalf.y) + 1.0, uRingW, uHollow);
  float hole = 1.0 - smoothstep(-uBlur, uBlur * 0.4, d + cut);
  float a = fill * (1.0 - hole) * uAmount;
  if (a < 0.005) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

const FX_FRAG = /* glsl */ `
precision highp float;
varying vec2 vPos;
uniform vec2 uHalf;
uniform float uRadius, uAA, uMax, uRingT, uBurstT, uRot;
uniform vec3 uColor;
${SD_BOX}
void main() {
  float d = sdBox(vPos, uHalf, uRadius);
  float a = 0.0;
  // Ripples in the shape's own outline, growing and thinning to nothing.
  for (int k = 0; k < 3; k++) {
    float t = (uRingT - float(k) * 0.24) / 1.5;
    if (t > 0.0 && t < 1.0) {
      float e = 1.0 - pow(1.0 - t, 3.0);
      float off = uMax * (0.07 + 1.45 * e);
      float w = uMax * 0.03 * (1.0 - t);
      a = max(a, 1.0 - smoothstep(-uAA, uAA, abs(d - off) - w * 0.5));
    }
  }
  // Streaks shooting out from the edge, the tail catching up with the head.
  if (uBurstT > 0.0 && uBurstT < 1.0) {
    float n = 14.0;
    float ang = atan(vPos.y, vPos.x) + uRot;
    float k = floor(ang / (6.2831853 / n) + 0.5);
    float da = ang - k * 6.2831853 / n;
    float r = length(vPos);
    float perp = abs(sin(da)) * r;
    float head = uMax * (1.08 + 1.25 * (1.0 - pow(1.0 - min(1.0, uBurstT / 0.55), 3.0)));
    float tail = uMax * (1.08 + 1.25 * (1.0 - pow(1.0 - clamp((uBurstT - 0.22) / 0.78, 0.0, 1.0), 3.0)));
    float wid = uMax * 0.017;
    a = max(a, step(tail, r) * step(r, head) * (1.0 - smoothstep(wid * 0.5 - uAA, wid * 0.5 + uAA, perp)));
  }
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a * 0.85);
}`;

const BG_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy * 2.0, 0.999, 1.0); }`;

const BG_FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes, uCentre;
uniform float uTime, uGlowAmt, uLines, uLinesSeed;
uniform vec3 uBase, uPrimary, uAccent, uGlow, uLineColor;
${HASH}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime;
  float n1 = fbm(p * 1.3 + vec2(t * 0.035, -t * 0.022));
  float n2 = fbm(p * 0.85 + n1 * 1.4 + vec2(-t * 0.028, t * 0.017));
  vec3 c = uBase;
  c = mix(c, uPrimary * 0.62, smoothstep(0.38, 0.95, n2) * 0.7);
  c = mix(c, uAccent * 0.5, smoothstep(0.58, 1.0, n1) * 0.4);
  vec2 g = p - uCentre;
  c += uGlow * exp(-dot(g, g) * 3.2) * uGlowAmt;
  if (uLines > 0.001) {
    // Speed lines streaming diagonally behind everything.
    vec2 s = mat2(0.978, -0.208, 0.208, 0.978) * p;
    float rows = 34.0;
    float row = floor(s.y * rows);
    float rnd = hash(vec2(row, uLinesSeed));
    float speed = 0.5 + rnd * 1.5;
    float x = fract(s.x * 0.45 - t * speed * 0.4 + rnd * 7.0);
    float len = (0.1 + 0.28 * hash(vec2(row, 9.7 + uLinesSeed))) * uLines;
    float thick = 0.0016 * rows;
    float inRow = 1.0 - smoothstep(thick * 0.5, thick * 0.5 + 1.5 * rows / uRes.y, abs(fract(s.y * rows) - 0.5));
    float on = step(0.55, rnd) * inRow * step(x, len);
    c = mix(c, uLineColor, on * 0.35);
  }
  c *= 1.0 - 0.38 * dot(p, p);
  c += (hash(gl_FragCoord.xy + fract(t) * 91.7) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

const DUST_VERT = /* glsl */ `
attribute float aSize;
attribute float aSeed;
attribute vec3 aVel;
uniform float uTime, uScale;
uniform vec3 uBox, uCentre;
varying float vAlpha;
void main() {
  vec3 p = position + aVel * uTime;
  p = mod(p - uCentre + uBox, 2.0 * uBox) - uBox + uCentre;
  p.x += sin(uTime * 0.35 + aSeed * 6.2831) * 0.025;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.2, -mv.z);
  vAlpha = 0.16 + 0.34 * aSeed;
}`;

const DUST_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (1.0 - smoothstep(0.18, 0.5, d)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

// ── What each shot looks like at rest ────────────────────────

interface Content {
  mode: 0 | 1 | 2;
  col: RGB;
  tex: number; // index into the texture list, -1 for none
  asp: number;
  plate: RGB;
  ink: string;
}

interface ShotState {
  w: number;
  h: number;
  r: number;
  hollow: number;
  ringW: number;
  content: Content;
  rimAmt: number;
}

interface Pose {
  dist: number;
  yaw: number;
  tilt: number;
}

function poseOf(camera: MotionShot["camera"], u: number, d0: number): Pose {
  switch (camera) {
    case "push":
      return { dist: d0 * (1 - 0.11 * easeInOut(u)), yaw: 0, tilt: 0 };
    case "pull":
      return { dist: d0 * (0.86 + 0.16 * easeOut(u)), yaw: 0, tilt: 0 };
    case "tilt":
      return { dist: d0 * 0.98, yaw: 0, tilt: 0.3 * (1 - easeOut(u)) - 0.04 };
    case "orbit":
      return { dist: d0 * 0.97, yaw: -0.36 + 0.72 * easeInOut(u), tilt: 0.04 };
    default:
      return { dist: d0 * (1 - 0.025 * u), yaw: 0.035 * Math.sin(u * Math.PI), tilt: 0 };
  }
}

// ── Words ────────────────────────────────────────────────────

interface Word {
  text: string;
  x: number;
  w: number;
}
interface Line {
  words: Word[];
  y: number;
}
interface TextBlock {
  size: number;
  lh: number;
  lines: Line[];
  font: string;
  color: string;
}

function wrap(ctx: CanvasRenderingContext2D, words: string[], maxW: number): string[][] {
  const lines: string[][] = [];
  let cur: string[] = [];
  for (const w of words) {
    const next = [...cur, w];
    if (cur.length && ctx.measureText(next.join(" ")).width > maxW) {
      lines.push(cur);
      cur = [w];
    } else cur = next;
  }
  if (cur.length) lines.push(cur);
  return lines;
}

function setText(ctx: CanvasRenderingContext2D, text: string, o: { family: string; weight: number; size: number; min: number; maxW: number; maxLines: number; cx: number; top: number; color: string; lh: number }): TextBlock | undefined {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return undefined;
  let size = o.size;
  let lines: string[][] = [];
  for (; size >= o.min; size = Math.floor(size * 0.94)) {
    ctx.font = `${o.weight} ${size}px ${o.family}`;
    lines = wrap(ctx, words, o.maxW);
    if (lines.length <= o.maxLines && lines.every((l) => ctx.measureText(l.join(" ")).width <= o.maxW)) break;
  }
  size = Math.max(size, o.min);
  ctx.font = `${o.weight} ${size}px ${o.family}`;
  lines = wrap(ctx, words, o.maxW).slice(0, o.maxLines + 1);
  const space = ctx.measureText(" ").width;
  const lh = size * o.lh;
  return {
    size,
    lh,
    font: ctx.font,
    color: o.color,
    lines: lines.map((ws, i) => {
      const widths = ws.map((w) => ctx.measureText(w).width);
      const total = widths.reduce((a, b) => a + b, 0) + space * (ws.length - 1);
      let x = o.cx - total / 2;
      return {
        y: o.top + i * lh,
        words: ws.map((w, k) => {
          const word = { text: w, x, w: widths[k] };
          x += widths[k] + space;
          return word;
        }),
      };
    }),
  };
}

const blockHeight = (b?: TextBlock) => (b ? b.lines.length * b.lh : 0);

/** Words that rise from behind their own mask, one after another, and leave upwards the same way. */
function drawBlock(ctx: CanvasRenderingContext2D, b: TextBlock, enterAt: number, exitAt: number | undefined, t: number, stagger: number) {
  ctx.font = b.font;
  ctx.fillStyle = b.color;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  let n = 0;
  for (const line of b.lines) {
    for (const word of line.words) {
      const e = easeOutExpo(clamp01((t - enterAt - n * stagger) / 0.6));
      let offset = (1 - e) * b.lh * 1.02;
      if (exitAt !== undefined && t >= exitAt) offset -= easeIn(clamp01((t - exitAt - n * 0.022) / 0.26)) * b.lh * 1.02;
      n++;
      if (e <= 0 || offset <= -b.lh * 1.02) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(word.x - b.size * 0.12, line.y - b.lh * 0.04, word.w + b.size * 0.24, b.lh * 1.08);
      ctx.clip();
      ctx.fillText(word.text, word.x, line.y + offset + (b.lh - b.size) * 0.35);
      ctx.restore();
    }
  }
}

/** "4.6★" counts up from 0.0, "$149" from $0; anything else just rises in. */
function countUp(value: string, k: number): string {
  const m = value.match(/^([^\d]*)(\d+(?:[.,]\d+)*)(.*)$/);
  if (!m || m[3].match(/\d/)) return value;
  if (/^\d{1,3}(,\d{3})+$/.test(m[2])) {
    const n = Number(m[2].replace(/,/g, ""));
    return `${m[1]}${Math.round(n * easeOut(clamp01(k))).toLocaleString("en-US")}${m[3]}`;
  }
  if (/[.,].*[.,]/.test(m[2])) return value;
  const decimals = (m[2].split(/[.,]/)[1] ?? "").length;
  const n = parseFloat(m[2].replace(",", "."));
  if (!Number.isFinite(n) || n > 1e7) return value;
  const shown = (n * easeOut(clamp01(k))).toFixed(decimals);
  return `${m[1]}${m[2].includes(",") && decimals ? shown.replace(".", ",") : shown}${m[3]}`;
}

// ── The engine ───────────────────────────────────────────────

export interface EngineOptions {
  /** Draw into this canvas (the preview); otherwise the engine makes its own. */
  canvas?: HTMLCanvasElement;
  width: number;
  height: number;
  antialias?: boolean;
  /** Longest side of the pictures as textures. */
  maxTexture?: number;
}

export class MotionEngine {
  readonly canvas: HTMLCanvasElement;
  private T: Three;
  private gl: THREE_NS.WebGLRenderer;
  private ctx: CanvasRenderingContext2D;
  private scene = {} as THREE_NS.Scene;
  private camera = {} as THREE_NS.PerspectiveCamera;
  private hero = {} as THREE_NS.Group;
  private shape = {} as THREE_NS.Mesh<THREE_NS.PlaneGeometry, THREE_NS.ShaderMaterial>;
  private shadow = {} as THREE_NS.Mesh<THREE_NS.PlaneGeometry, THREE_NS.ShaderMaterial>;
  private fx = {} as THREE_NS.Mesh<THREE_NS.PlaneGeometry, THREE_NS.ShaderMaterial>;
  private bg = {} as THREE_NS.Mesh<THREE_NS.PlaneGeometry, THREE_NS.ShaderMaterial>;
  private dust = {} as THREE_NS.Points<THREE_NS.BufferGeometry, THREE_NS.ShaderMaterial>;
  private dots = {} as THREE_NS.InstancedMesh<THREE_NS.SphereGeometry, THREE_NS.MeshBasicMaterial>;
  private blank = {} as THREE_NS.Texture;
  private textures: THREE_NS.Texture[] = [];
  private w = 0;
  private h = 0;
  private data: MotionScene | null = null;
  private states: ShotState[] = [];
  private times = { starts: [] as number[], total: 0 };
  private texts: { head?: TextBlock; sub?: TextBlock; bar: { x: number; y: number; w: number; h: number } }[] = [];
  private logoPlate: RGB = [0.96, 0.95, 0.93];
  private maxTexture: number;
  private lost = false;

  private constructor(T: Three, opts: EngineOptions) {
    this.T = T;
    this.maxTexture = opts.maxTexture ?? 2048;
    this.canvas = opts.canvas ?? document.createElement("canvas");
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("This browser can't draw the video (no 2D canvas).");
    this.ctx = ctx;
    const glCanvas = document.createElement("canvas");
    glCanvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    T.ColorManagement.enabled = false;
    this.gl = new T.WebGLRenderer({ canvas: glCanvas, antialias: opts.antialias ?? true, alpha: false, powerPreference: "high-performance", preserveDrawingBuffer: false });
    this.gl.outputColorSpace = T.LinearSRGBColorSpace;
    this.gl.setPixelRatio(1);
    this.build();
    this.setSize(opts.width, opts.height);
  }

  /** Loads Three.js (only on the pages that need it) and the fonts. */
  static async create(opts: EngineOptions): Promise<MotionEngine> {
    const [T] = await Promise.all([
      import("three"),
      Promise.all([document.fonts.load(`700 64px ${DISPLAY_FONT}`), document.fonts.load(`500 32px ${BODY_FONT}`)]).catch(() => undefined),
    ]);
    return new MotionEngine(T, opts);
  }

  get total(): number {
    return this.times.total;
  }

  get starts(): number[] {
    return this.times.starts;
  }

  get contextLost(): boolean {
    return this.lost;
  }

  private build() {
    const T = this.T;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(FOV, 1, 0.05, 60);
    this.blank = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.blank.needsUpdate = true;

    const quad = new T.PlaneGeometry(1, 1);
    this.bg = new T.Mesh(
      quad,
      new T.ShaderMaterial({
        vertexShader: BG_VERT,
        fragmentShader: BG_FRAG,
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uRes: { value: new T.Vector2(1, 1) },
          uCentre: { value: new T.Vector2(0, 0.1) },
          uTime: { value: 0 },
          uGlowAmt: { value: 0.3 },
          uLines: { value: 0 },
          uLinesSeed: { value: 1 },
          uBase: { value: new T.Vector3() },
          uPrimary: { value: new T.Vector3() },
          uAccent: { value: new T.Vector3() },
          uGlow: { value: new T.Vector3() },
          uLineColor: { value: new T.Vector3(1, 1, 1) },
        },
      })
    );
    this.bg.frustumCulled = false;
    this.bg.renderOrder = -10;
    this.scene.add(this.bg);

    this.hero = new T.Group();
    this.scene.add(this.hero);
    const boxUniforms = () => ({
      uPlane: { value: new T.Vector2(1, 1) },
      uHalf: { value: new T.Vector2(0.2, 0.2) },
      uRadius: { value: 0.2 },
      uHollow: { value: 0 },
      uRingW: { value: 0.02 },
      uAA: { value: 0.002 },
    });
    this.shadow = new T.Mesh(
      quad,
      new T.ShaderMaterial({ vertexShader: PLANE_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false, uniforms: { ...boxUniforms(), uBlur: { value: 0.05 }, uAmount: { value: 0.5 } } })
    );
    this.shadow.renderOrder = 1;
    this.fx = new T.Mesh(
      quad,
      new T.ShaderMaterial({
        vertexShader: PLANE_VERT,
        fragmentShader: FX_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: { ...boxUniforms(), uMax: { value: 0.3 }, uRingT: { value: -1 }, uBurstT: { value: -1 }, uRot: { value: 0 }, uColor: { value: new T.Vector3(1, 1, 1) } },
      })
    );
    this.fx.renderOrder = 2;
    this.shape = new T.Mesh(
      quad,
      new T.ShaderMaterial({
        vertexShader: PLANE_VERT,
        fragmentShader: SHAPE_FRAG,
        transparent: true,
        depthWrite: true,
        uniforms: {
          ...boxUniforms(),
          uTime: { value: 0 },
          uReveal: { value: 1 },
          uColA: { value: new T.Vector3() },
          uPlateA: { value: new T.Vector3() },
          uTexA: { value: this.blank },
          uModeA: { value: 0 },
          uAspA: { value: 1 },
          uZoomA: { value: 1 },
          uColB: { value: new T.Vector3() },
          uPlateB: { value: new T.Vector3() },
          uTexB: { value: this.blank },
          uModeB: { value: 0 },
          uAspB: { value: 1 },
          uZoomB: { value: 1 },
          uRim: { value: new T.Vector3(1, 1, 1) },
          uRimAmt: { value: 0 },
        },
      })
    );
    this.shape.renderOrder = 3;
    this.hero.add(this.shadow, this.fx, this.shape);

    this.dots = new T.InstancedMesh(new T.SphereGeometry(1, 20, 14), new T.MeshBasicMaterial({ color: 0xffffff }), 12);
    this.dots.renderOrder = 4;
    this.dots.frustumCulled = false;
    this.hero.add(this.dots);

    // Dust drifting through the scene in 3D, for depth as the camera moves.
    const n = 150;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const size = new Float32Array(n);
    const seed = new Float32Array(n);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      pos.set([(rnd() - 0.5) * 3.6, (rnd() - 0.5) * 4, -3.2 + rnd() * 4], i * 3);
      vel.set([(rnd() - 0.5) * 0.02, 0.012 + rnd() * 0.03, 0], i * 3);
      size[i] = 0.004 + rnd() ** 3 * 0.02;
      seed[i] = rnd();
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(pos, 3));
    geo.setAttribute("aVel", new T.BufferAttribute(vel, 3));
    geo.setAttribute("aSize", new T.BufferAttribute(size, 1));
    geo.setAttribute("aSeed", new T.BufferAttribute(seed, 1));
    this.dust = new T.Points(
      geo,
      new T.ShaderMaterial({
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 }, uScale: { value: 1000 }, uBox: { value: new T.Vector3(1.8, 2, 2) }, uCentre: { value: new T.Vector3(0, 0, -1.2) }, uColor: { value: new T.Vector3(1, 1, 1) } },
      })
    );
    this.dust.frustumCulled = false;
    this.dust.renderOrder = 5;
    this.scene.add(this.dust);
  }

  setSize(width: number, height: number) {
    this.w = Math.max(16, Math.round(width));
    this.h = Math.max(16, Math.round(height));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.gl.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    (this.bg.material.uniforms.uRes.value as THREE_NS.Vector2).set(this.w, this.h);
    this.dust.material.uniforms.uScale.value = this.h / (2 * Math.tan((FOV * Math.PI) / 360));
    if (this.data) this.layoutText();
  }

  /** The storyboard to draw, with its pictures (already loaded). */
  setScene(data: MotionScene) {
    const T = this.T;
    this.data = data;
    for (const t of this.textures) t.dispose();
    this.textures = [];
    const texOf = (img?: ImageBitmap) => {
      if (!img) return -1;
      const tex = new T.Texture(img);
      tex.colorSpace = T.NoColorSpace;
      tex.flipY = false;
      tex.generateMipmaps = true;
      tex.minFilter = T.LinearMipmapLinearFilter;
      tex.magFilter = T.LinearFilter;
      tex.anisotropy = this.gl.capabilities.getMaxAnisotropy();
      tex.needsUpdate = true;
      this.textures.push(tex);
      return this.textures.length - 1;
    };
    const logo = texOf(data.pictures.logo);
    const photos = data.pictures.photos.map((p) => texOf(p));
    this.logoPlate = data.pictures.logo ? plateFor(data.pictures.logo, data.brand) : rgb(data.brand.light);
    const b = data.brand;
    const L = LAYOUT[data.format];
    const base = mixRgb(rgb(b.dark), rgb(b.primary), 0.14);
    const lumOf = (c: RGB) => 0.2126 * c[0] ** 2.2 + 0.7152 * c[1] ** 2.2 + 0.0722 * c[2] ** 2.2;
    /** A fill that would vanish into the background is lifted a little (and gets a rim, below). */
    const lost = (c: RGB) => Math.abs(lumOf(c) - lumOf(base)) < 0.05;
    const content = (s: MotionShot): Content => {
      const solid = (hex: string): Content => {
        const c = rgb(hex);
        const col = lost(c) ? mixRgb(c, [1, 1, 1], 0.16) : c;
        return { mode: 0, col, tex: -1, asp: 1, plate: [0, 0, 0], ink: inkFor(hex) };
      };
      if (s.fill === "logo" && logo >= 0 && data.pictures.logo) {
        const plateHex = `#${this.logoPlate.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}`;
        return { mode: 2, col: this.logoPlate, tex: logo, asp: data.pictures.logo.width / data.pictures.logo.height, plate: this.logoPlate, ink: inkFor(plateHex) };
      }
      if (s.fill === "photo") {
        const i = s.photo ?? 0;
        const img = data.pictures.photos[i];
        if (img && photos[i] >= 0) return { mode: 1, col: [0, 0, 0], tex: photos[i], asp: img.width / img.height, plate: [0, 0, 0], ink: "#ffffff" };
        return solid(b.accent);
      }
      if (s.fill === "accent") return solid(b.accent);
      if (s.fill === "light") return solid(b.light);
      if (s.fill === "dark") return solid(b.dark);
      return solid(b.primary);
    };
    this.states = data.shots.map((s) => {
      const box = shapeBox(s.shape, s.size * L.scale, 1);
      const c = content(s);
      return {
        w: box.w,
        h: box.h,
        r: box.r,
        hollow: s.shape === "ring" ? 1 : 0,
        ringW: Math.max(box.ring, 0.012),
        content: c,
        rimAmt: c.mode === 0 && lost(rgb(s.fill === "dark" ? b.dark : s.fill === "accent" ? b.accent : s.fill === "light" ? b.light : b.primary)) ? 0.6 : s.fill === "light" ? 0 : 0.18,
      };
    });
    this.times = timeline(data.shots);
    (this.bg.material.uniforms.uBase.value as THREE_NS.Vector3).set(...base);
    (this.bg.material.uniforms.uPrimary.value as THREE_NS.Vector3).set(...rgb(b.primary));
    (this.bg.material.uniforms.uAccent.value as THREE_NS.Vector3).set(...rgb(b.accent));
    (this.bg.material.uniforms.uLineColor.value as THREE_NS.Vector3).set(...mixRgb(rgb(b.accent), [1, 1, 1], 0.5));
    (this.dust.material.uniforms.uColor.value as THREE_NS.Vector3).set(...mixRgb(rgb(b.accent), [1, 1, 1], 0.6));
    this.dots.material.color.setRGB(...mixRgb(rgb(b.accent), [1, 1, 1], 0.25));
    this.layoutText();
  }

  /** Where each shot's words sit: below the shape, centred, inside the safe area. */
  private layoutText() {
    if (!this.data) return;
    const ctx = this.ctx;
    const unit = Math.min(this.w, this.h);
    const L = LAYOUT[this.data.format];
    const yShapePx = this.h / 2 - L.y * unit;
    const margin = unit * 0.08;
    this.texts = this.data.shots.map((s, i) => {
      const st = this.states[i];
      const top = yShapePx + (st.h / 2) * unit + unit * 0.065;
      const maxW = this.w * 0.84;
      const headSize = Math.round(unit * L.head);
      let head = setText(ctx, s.headline, { family: DISPLAY_FONT, weight: 700, size: headSize, min: Math.round(headSize * 0.6), maxW, maxLines: 2, cx: this.w / 2, top, color: "#ffffff", lh: 1.08 });
      const subTop = top + blockHeight(head) + unit * 0.045;
      const subSize = Math.round(unit * L.sub);
      let sub = s.sub ? setText(ctx, s.sub, { family: BODY_FONT, weight: 500, size: subSize, min: Math.round(subSize * 0.75), maxW, maxLines: 2, cx: this.w / 2, top: subTop, color: "#dcdcdc", lh: 1.25 }) : undefined;
      // Keep the block inside the frame; it may then sit over the shape's lower edge.
      const bottom = subTop + blockHeight(sub) + (sub ? 0 : unit * 0.03);
      const over = bottom - (this.h - margin);
      if (over > 0) {
        const shift = (b?: TextBlock) => b && { ...b, lines: b.lines.map((l) => ({ ...l, y: l.y - over })) };
        head = shift(head);
        sub = shift(sub);
      }
      const barY = (head ? head.lines[head.lines.length - 1].y + head.lh : top) + unit * 0.016;
      return { head, sub, bar: { x: this.w / 2, y: barY, w: unit * 0.16, h: Math.max(2, unit * 0.007) } };
    });
  }

  /** The state of the centre shape at time t (morphing from the last shot into this one). */
  private stateAt(t: number) {
    const shots = this.data!.shots;
    const { starts } = this.times;
    let i = 0;
    while (i + 1 < shots.length && t >= starts[i + 1]) i++;
    const lt = Math.max(0, t - starts[i]);
    const cur = this.states[i];
    const prev: ShotState = i > 0 ? this.states[i - 1] : { ...cur, w: 0.004, h: 0.004, r: 0.002, hollow: 0, rimAmt: 0 };
    return { i, lt, cur, prev, m: clamp01(lt / MORPH) };
  }

  /** Draw time t (seconds) and return the canvas. */
  render(time: number): HTMLCanvasElement {
    const data = this.data;
    if (!data || !data.shots.length) return this.canvas;
    const t = Math.max(0, Math.min(time, this.times.total - 1 / 120));
    const { i, lt, cur, prev, m } = this.stateAt(t);
    const shot = data.shots[i];
    const L = LAYOUT[data.format];
    const W = this.w / Math.min(this.w, this.h);
    const H = this.h / Math.min(this.w, this.h);
    const unitPx = Math.min(this.w, this.h);
    const d0 = H / 2 / Math.tan((FOV * Math.PI) / 360);

    // The shape: size with a little overshoot, corners and colour eased, pictures wiped in from the centre.
    const ms = easeOutBack(m);
    const me = easeInOut(m);
    const w = Math.max(0.002, lerp(prev.w, cur.w, ms));
    const h = Math.max(0.002, lerp(prev.h, cur.h, ms));
    const r = lerp(prev.r, cur.r, me);
    const hollow = lerp(prev.hollow, cur.hollow, me);
    const ringW = lerp(prev.ringW, cur.ringW, me);
    const half: [number, number] = [w / 2, h / 2];
    const plane: [number, number] = [half[0] + 0.02, half[1] + 0.02];
    const aa = 1.2 / unitPx;
    const u = this.shape.material.uniforms;
    const setBox = (un: Record<string, THREE_NS.IUniform>, pad: number) => {
      (un.uHalf.value as THREE_NS.Vector2).set(half[0], half[1]);
      (un.uPlane.value as THREE_NS.Vector2).set(half[0] + pad, half[1] + pad);
      un.uRadius.value = r;
      un.uHollow.value = hollow;
      un.uRingW.value = ringW;
      un.uAA.value = aa;
    };
    setBox(u, 0.02);
    this.shape.scale.set(plane[0] * 2, plane[1] * 2, 1);
    const a = prev.content;
    const c = cur.content;
    const same = a.mode === c.mode && a.tex === c.tex && (a.mode !== 0 || a.col.every((v, k) => v === c.col[k]));
    const zoomNow = 1 + 0.07 * clamp01(lt / shot.seconds);
    const setLayer = (k: "A" | "B", x: Content, zoom: number, col?: RGB) => {
      (u[`uCol${k}`].value as THREE_NS.Vector3).set(...(col ?? x.col));
      (u[`uPlate${k}`].value as THREE_NS.Vector3).set(...x.plate);
      u[`uTex${k}`].value = x.tex >= 0 ? this.textures[x.tex] : this.blank;
      u[`uMode${k}`].value = x.mode;
      u[`uAsp${k}`].value = x.asp;
      u[`uZoom${k}`].value = zoom;
    };
    if (a.mode === 0 && c.mode === 0) {
      // Colour to colour: the shape changes colour as it morphs.
      setLayer("A", c, zoomNow, mixRgb(a.col, c.col, me));
      setLayer("B", c, zoomNow, mixRgb(a.col, c.col, me));
      u.uReveal.value = 1.2;
    } else {
      setLayer("A", a, 1.07);
      setLayer("B", c, zoomNow);
      u.uReveal.value = same ? 1.2 : easeInOut(clamp01(lt / (MORPH * 1.1))) * 1.05;
    }
    u.uTime.value = t;
    u.uRimAmt.value = lerp(prev.rimAmt, cur.rimAmt, me);
    (u.uRim.value as THREE_NS.Vector3).set(...rgb(data.brand.accent));

    const su = this.shadow.material.uniforms;
    setBox(su, 0.16);
    su.uBlur.value = 0.03 + 0.08 * Math.max(half[0], half[1]);
    su.uAmount.value = 0.42;
    this.shadow.scale.set((half[0] + 0.16) * 2, (half[1] + 0.16) * 2, 1);
    this.shadow.position.set(0.012, -0.03, -0.04);

    // Accents for this shot; the last shot's shrink away during the morph.
    const maxHalf = Math.max(half[0], half[1]);
    const fu = this.fx.material.uniforms;
    setBox(fu, maxHalf * 2.7);
    fu.uMax.value = maxHalf;
    fu.uRingT.value = shot.accent === "rings" ? lt - 0.3 : -1;
    fu.uBurstT.value = shot.accent === "burst" ? (lt - 0.32) / 1.0 : -1;
    fu.uRot.value = i * 0.37;
    (fu.uColor.value as THREE_NS.Vector3).set(...(shot.fill === "accent" ? rgb(data.brand.light) : rgb(data.brand.accent)));
    this.fx.scale.set((half[0] + maxHalf * 2.7) * 2, (half[1] + maxHalf * 2.7) * 2, 1);
    this.fx.position.z = -0.02;

    const prevShot = i > 0 ? data.shots[i - 1] : undefined;
    const amount = (kind: MotionShot["accent"]) => {
      const now = shot.accent === kind ? easeOut(clamp01((lt - 0.15) / 0.7)) : 0;
      const before = prevShot?.accent === kind ? 1 - easeIn(clamp01(lt / MORPH)) : 0;
      return Math.max(now, before);
    };
    const orbit = amount("orbit");
    const ringR = Math.hypot(half[0], half[1]) * 1.18;
    const m4 = new this.T.Matrix4();
    const q = new this.T.Quaternion();
    const tiltQ = new this.T.Quaternion().setFromEuler(new this.T.Euler(0.42, 0, 0.32));
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2 + t * 0.9;
      const v = new this.T.Vector3(Math.cos(ang) * ringR, 0, Math.sin(ang) * ringR).applyQuaternion(tiltQ);
      const sz = orbit * (k % 3 === 0 ? 0.016 : 0.009);
      m4.compose(v, q, new this.T.Vector3(sz, sz, sz));
      this.dots.setMatrixAt(k, m4);
    }
    this.dots.instanceMatrix.needsUpdate = true;
    this.dots.visible = orbit > 0.001;

    // Camera: each shot's move, blended out of the last shot's so it never jumps.
    const pc = poseOf(shot.camera, clamp01(lt / shot.seconds), d0);
    const pp = prevShot ? poseOf(prevShot.camera, 1, d0) : { dist: d0 * 1.04, yaw: 0, tilt: 0 };
    const kb = easeInOut(clamp01(lt / (MORPH * 1.4)));
    const dist = lerp(pp.dist, pc.dist, kb);
    const yaw = lerp(pp.yaw, pc.yaw, kb);
    const tilt = lerp(pp.tilt, pc.tilt, kb);
    this.camera.position.set(Math.sin(yaw) * dist, 0, Math.cos(yaw) * dist);
    this.camera.lookAt(0, 0, 0);
    this.hero.position.set(0, L.y + 0.006 * Math.sin(t * 0.9), 0);
    this.hero.rotation.set(tilt + 0.028 * Math.sin(t * 0.5), 0.04 * Math.sin(t * 0.6), 0);

    // Background: flowing light in their colours, glowing in the shape's colour, speed lines when asked.
    const bu = this.bg.material.uniforms;
    bu.uTime.value = t;
    (bu.uCentre.value as THREE_NS.Vector2).set(0, L.y / H);
    const glow = c.mode === 0 ? c.col : rgb(data.brand.primary);
    const glowNow = mixRgb(a.mode === 0 ? a.col : glow, glow, me);
    (bu.uGlow.value as THREE_NS.Vector3).set(...glowNow);
    bu.uGlowAmt.value = 0.3 * (1 - 0.6 * (0.2126 * glowNow[0] + 0.7152 * glowNow[1] + 0.0722 * glowNow[2]));
    bu.uLines.value = amount("lines");
    bu.uLinesSeed.value = 1 + (i % 5);
    const du = this.dust.material.uniforms;
    du.uTime.value = t;
    (du.uBox.value as THREE_NS.Vector3).set(W * 0.9 + 0.4, H * 0.6 + 0.4, 2);

    if (!this.lost) this.gl.render(this.scene, this.camera);
    const ctx = this.ctx;
    ctx.drawImage(this.gl.domElement, 0, 0, this.w, this.h);
    this.drawWords(t, i, unitPx);
    return this.canvas;
  }

  /** Headline, sub and accent bar under the shape; a stat counted up inside it. */
  private drawWords(t: number, i: number, unit: number) {
    const ctx = this.ctx;
    const data = this.data!;
    const { starts } = this.times;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = unit * 0.02;
    ctx.shadowOffsetY = unit * 0.004;
    for (const k of [i - 1, i]) {
      if (k < 0) continue;
      const s = data.shots[k];
      const block = this.texts[k];
      const start = starts[k];
      // Words leave just before the cut, so the next shape never grows over them.
      const exit = k + 1 < data.shots.length ? starts[k + 1] - 0.2 : undefined;
      if (exit !== undefined && t > exit + 0.6) continue;
      if (block.head) drawBlock(ctx, block.head, start + 0.36, exit, t, 0.055);
      if (block.sub) drawBlock(ctx, block.sub, start + 0.36 + 0.12 + (block.head?.lines.flatMap((l) => l.words).length ?? 0) * 0.055, exit, t, 0.03);
      // The accent bar draws out from the middle, and back in.
      const grow = easeOutExpo(clamp01((t - start - 0.62) / 0.5)) * (exit !== undefined ? 1 - easeIn(clamp01((t - exit) / 0.25)) : 1);
      if (grow > 0.001 && block.head) {
        ctx.shadowColor = "transparent";
        ctx.fillStyle = data.brand.accent;
        const bw = block.bar.w * grow;
        ctx.beginPath();
        ctx.roundRect(block.bar.x - bw / 2, block.bar.y, bw, block.bar.h, block.bar.h / 2);
        ctx.fill();
        ctx.shadowColor = "rgba(0,0,0,0.35)";
      }
      if (s.stat) this.drawStat(s, k, start, exit, t, unit);
    }
    ctx.restore();
  }

  private drawStat(s: MotionShot, k: number, start: number, exit: number | undefined, t: number, unit: number) {
    if (!s.stat) return;
    const ctx = this.ctx;
    const st = this.states[k];
    const centre = this.hero.position.clone().project(this.camera);
    const cx = (centre.x * 0.5 + 0.5) * this.w;
    const cy = (-centre.y * 0.5 + 0.5) * this.h;
    const inner = Math.min(st.w, st.h) * unit;
    const valueSize = Math.round(inner * (s.stat.value.length > 5 ? 0.26 : 0.34));
    const labelSize = Math.round(Math.max(unit * 0.022, inner * 0.085));
    const ink = st.content.mode === 1 ? "#ffffff" : st.content.ink;
    const value = countUp(s.stat.value, (t - start - 0.4) / 1.0);
    ctx.font = `750 ${valueSize}px ${DISPLAY_FONT}`;
    const vw = ctx.measureText(value).width;
    const fit = Math.min(1, (st.w * unit * 0.84) / Math.max(1, vw));
    const vb: TextBlock = {
      size: valueSize * fit,
      lh: valueSize * fit * 1.04,
      font: `750 ${Math.round(valueSize * fit)}px ${DISPLAY_FONT}`,
      color: ink,
      lines: [{ y: cy - valueSize * fit * 0.62, words: [{ text: value, x: cx - (vw * fit) / 2, w: vw * fit }] }],
    };
    ctx.font = `600 ${labelSize}px ${BODY_FONT}`;
    const label = s.stat.label;
    const lw = ctx.measureText(label).width;
    const lb: TextBlock = { size: labelSize, lh: labelSize * 1.2, font: ctx.font, color: ink, lines: [{ y: cy + valueSize * fit * 0.48, words: [{ text: label, x: cx - lw / 2, w: lw }] }] };
    const shadow = ctx.shadowColor;
    if (st.content.mode !== 1) ctx.shadowColor = "transparent";
    drawBlock(ctx, vb, start + 0.4, exit, t, 0);
    drawBlock(ctx, lb, start + 0.55, exit, t, 0);
    ctx.shadowColor = shadow;
  }

  dispose() {
    for (const t of this.textures) t.dispose();
    this.blank.dispose();
    this.scene.traverse((o) => {
      const mesh = o as THREE_NS.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE_NS.Material | THREE_NS.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    this.gl.dispose();
    this.gl.forceContextLoss();
  }
}

/** The plate behind their logo: its own background if it has one, dark for a light logo, otherwise light. */
function plateFor(img: ImageBitmap, brand: MotionAd["brand"]): RGB {
  try {
    const c = document.createElement("canvas");
    c.width = 48;
    c.height = 48;
    const x = c.getContext("2d", { willReadFrequently: true });
    if (!x) return rgb(brand.light);
    x.drawImage(img, 0, 0, 48, 48);
    const px = x.getImageData(0, 0, 48, 48).data;
    let opaque = 0;
    let lumSum = 0;
    let weight = 0;
    for (let i = 0; i < px.length; i += 4) {
      const al = px[i + 3] / 255;
      if (al > 0.98) opaque++;
      const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      lumSum += l * al;
      weight += al;
    }
    if (opaque / (px.length / 4) > 0.97) {
      // An opaque logo: use its corner colour so the plate and picture are one.
      const k = (48 * 1 + 1) * 4;
      return [px[k] / 255, px[k + 1] / 255, px[k + 2] / 255];
    }
    return weight && lumSum / weight > 0.8 ? rgb(brand.dark) : rgb(brand.light);
  } catch {
    return rgb(brand.light);
  }
}

/** Sizes for a format: the preview fits the screen, exports are 1080p or 4K. */
export function frameSize(format: MotionAd["format"], quality: "preview" | "1080p" | "4k", previewShort = 540): { w: number; h: number } {
  const f = FORMATS[format];
  const short = quality === "4k" ? 2160 : quality === "1080p" ? 1080 : previewShort;
  const k = short / Math.min(f.w, f.h);
  return { w: Math.round((f.w * k) / 2) * 2, h: Math.round((f.h * k) / 2) * 2 };
}

/** Load a stored picture for the engine, scaled down to the longest side given. */
export async function loadPicture(url: string, maxSide: number): Promise<ImageBitmap | undefined> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    const full = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "default" });
    const k = Math.min(1, maxSide / Math.max(full.width, full.height));
    if (k >= 1) return full;
    const small = await createImageBitmap(full, { resizeWidth: Math.round(full.width * k), resizeHeight: Math.round(full.height * k), resizeQuality: "high", premultiplyAlpha: "none" });
    full.close();
    return small;
  } catch {
    return undefined;
  }
}
