// Turns the Builder's SiteSpec plus the business's real facts into a complete,
// self-contained HTML page in one of three layouts. Preview mode adds the slim
// "made for you" bar (everything preview-only lives inside .ms-preview-bar,
// which the video renderer hides before taking screenshots).

import type { VariantId } from "../types.ts";
import { renderBold } from "./templates/bold.ts";
import { renderClassic } from "./templates/classic.ts";
import { baseCss, buildCtx, cssVars, esc, jsonLd, MENU_SCRIPT, previewBar, txt, type LayoutOutput, type RenderInput, type Ctx } from "./templates/common.ts";
import { renderFresh } from "./templates/fresh.ts";

export type { RenderInput } from "./templates/common.ts";
export { esc } from "./templates/common.ts";

export const VARIANTS: { id: VariantId; label: string; description: string }[] = [
  { id: "bold", label: "Bold", description: "Full-screen hero, big confident type and strong buttons. Stands out on a phone." },
  { id: "classic", label: "Classic", description: "Trustworthy split layout with a clear services grid. Warm and professional." },
  { id: "fresh", label: "Fresh", description: "Light and airy, with rounded cards and soft colours. Friendly and modern." },
];

const LAYOUTS: Record<VariantId, (c: Ctx) => LayoutOutput> = {
  bold: renderBold,
  classic: renderClassic,
  fresh: renderFresh,
};

export function renderSite(input: RenderInput): string {
  const variant: VariantId = input.variant in LAYOUTS ? input.variant : "bold";
  const c = buildCtx({ ...input, variant });
  const layout = LAYOUTS[variant](c);
  const live = input.mode === "live";
  const seoTitle = txt(c.spec.seo?.title) || `${c.name}${c.location ? ` | ${c.location}` : ""}`;
  const seoDesc = txt(c.spec.seo?.description) || txt(c.spec.heroSubheadline);
  const title = live ? seoTitle : `${c.name} · Website preview`;

  const head = [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`,
    `<title>${esc(title)}</title>`,
    seoDesc ? `<meta name="description" content="${esc(seoDesc)}">` : "",
    live ? "" : `<meta name="robots" content="noindex, nofollow">`,
    `<meta name="theme-color" content="${esc(c.p.primary)}">`,
    live ? `<meta property="og:title" content="${esc(seoTitle)}">` : "",
    live && seoDesc ? `<meta property="og:description" content="${esc(seoDesc)}">` : "",
    `<link rel="preconnect" href="https://fonts.googleapis.com">`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
    `<link rel="stylesheet" href="${esc(c.f.googleHref)}">`,
    `<style>${cssVars(c)}${baseCss()}${layout.css}</style>`,
    live ? jsonLd(c) : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
${head}
</head>
<body class="v-${variant} mood-${esc(c.spec.mood)}">
${layout.body}
${previewBar(c)}
${MENU_SCRIPT}
</body>
</html>
`;
}
