// Colours for a prospect's demo page, from the brand colour their site uses.
// Pure, unit tested.

import { luminance } from "./site-kb-parse.ts";

const FALLBACK = "#1c1917";

/** Their brand colour if it's usable as a background, otherwise a neutral dark. */
export function brandColor(color?: string): string {
  return color && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) && luminance(color) < 0.85 ? color : FALLBACK;
}

/** Black or white text, whichever reads better on the colour. */
export function inkOn(color: string): string {
  const l = luminance(color);
  // Contrast against white vs against near-black text.
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.06) ? "#ffffff" : "#111111";
}
