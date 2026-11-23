import { DEFAULT_OPTIONS, type JobOptions } from "../lib/types.ts";

const LAYOUTS = ["auto", "split", "crop", "fit", "cutout"] as const;
const STYLES = ["pop", "karaoke", "clean"] as const;
const UPSCALE = ["auto", "4k", "off"] as const;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Options from the browser, checked. Unknown or bad values fall back to the defaults. */
export function parseOptions(raw: unknown): Partial<JobOptions> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: string, lo: number, hi: number, def: number) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? clamp(o[k] as number, lo, hi) : def);
  const bool = (k: keyof JobOptions) => (typeof o[k] === "boolean" ? (o[k] as boolean) : (DEFAULT_OPTIONS[k] as boolean));
  const pick = <T extends string>(k: string, list: readonly T[], def: T): T => (list.includes(o[k] as T) ? (o[k] as T) : def);
  const minSec = num("minSec", 5, 170, DEFAULT_OPTIONS.minSec);
  const maxSec = Math.max(minSec + 3, num("maxSec", 8, 180, DEFAULT_OPTIONS.maxSec));
  const out: Partial<JobOptions> = {
    count: Math.round(num("count", 1, 50, DEFAULT_OPTIONS.count)),
    minSec,
    maxSec,
    layout: pick("layout", LAYOUTS, DEFAULT_OPTIONS.layout),
    facecamShare: num("facecamShare", 0.25, 0.6, DEFAULT_OPTIONS.facecamShare),
    captions: bool("captions"),
    captionStyle: pick("captionStyle", STYLES, DEFAULT_OPTIONS.captionStyle),
    hook: bool("hook"),
    removeSilence: bool("removeSilence"),
    denoise: bool("denoise"),
    stems: bool("stems"),
    slowmo: bool("slowmo"),
    upscale: pick("upscale", UPSCALE, DEFAULT_OPTIONS.upscale),
    dub: Array.isArray(o.dub) ? (o.dub as unknown[]).filter((d): d is string => typeof d === "string" && /^[a-z]{2}$/.test(d)).slice(0, 6) : [],
  };
  if (typeof o.language === "string" && /^[a-z]{2}$/.test(o.language)) out.language = o.language;
  if (typeof o.instructions === "string" && o.instructions.trim()) out.instructions = o.instructions.trim().slice(0, 500);
  if (typeof o.name === "string" && o.name.trim()) out.name = o.name.trim().slice(0, 40);
  return out;
}
