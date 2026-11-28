// The mockups' design system: curated palettes, font pairs and icons. The
// Builder only picks ids, so every site it makes stays on-brand and readable.
// Contrast: primaryInk on primary, ink/muted on bg and surface, primaryText
// on bg and soft, and deepInk/deepMuted on deep all pass WCAG AA (4.5:1);
// tests/site.test.ts checks it.

import type { FontPairId, IconName, PaletteId } from "../types.ts";

export interface Palette {
  name: string;
  primary: string; // buttons, key accents
  primaryInk: string; // text on primary
  primaryText: string; // primary-coloured text on bg/surface/soft
  accent: string; // secondary highlight
  accentInk: string; // text on accent
  bg: string; // page background
  surface: string; // cards
  soft: string; // tinted sections
  ink: string; // body text
  muted: string; // secondary text
  border: string;
  deep: string; // dark sections
  deepInk: string; // text on deep
  deepMuted: string; // secondary text on deep
  deepAccent: string; // highlights on deep
}

export const PALETTES: Record<PaletteId, Palette> = {
  harbor: {
    name: "Harbor",
    primary: "#1B5E96",
    primaryInk: "#FFFFFF",
    primaryText: "#1B5E96",
    accent: "#C9A46A",
    accentInk: "#0F2235",
    bg: "#FBF8F3",
    surface: "#FFFFFF",
    soft: "#F1EADF",
    ink: "#0F2235",
    muted: "#56616D",
    border: "#E6DED1",
    deep: "#0F2A44",
    deepInk: "#F3EEE4",
    deepMuted: "#B9C4CF",
    deepAccent: "#E2C48F",
  },
  clinic: {
    name: "Clinic",
    primary: "#0E7471",
    primaryInk: "#FFFFFF",
    primaryText: "#0E7471",
    accent: "#8FDCC8",
    accentInk: "#063B3A",
    bg: "#F6FBFA",
    surface: "#FFFFFF",
    soft: "#E5F3F0",
    ink: "#0D2B2E",
    muted: "#4B6669",
    border: "#D5E8E4",
    deep: "#0B3D3F",
    deepInk: "#E9F7F4",
    deepMuted: "#A9C9C6",
    deepAccent: "#8FDCC8",
  },
  forest: {
    name: "Forest",
    primary: "#2F5D3A",
    primaryInk: "#FFFFFF",
    primaryText: "#2F5D3A",
    accent: "#A9BC74",
    accentInk: "#1D2B16",
    bg: "#FAF7EF",
    surface: "#FFFFFF",
    soft: "#EFEADB",
    ink: "#1F2A1F",
    muted: "#5A6456",
    border: "#E2DCCB",
    deep: "#1E3A25",
    deepInk: "#F1EEDF",
    deepMuted: "#B7C3AE",
    deepAccent: "#C3D38F",
  },
  ember: {
    name: "Ember",
    primary: "#F26B1D",
    primaryInk: "#1B1B1B",
    primaryText: "#B3470C",
    accent: "#FFC857",
    accentInk: "#1B1B1B",
    bg: "#F6F5F3",
    surface: "#FFFFFF",
    soft: "#ECEAE6",
    ink: "#1C1C1C",
    muted: "#5B5B5B",
    border: "#E1DED8",
    deep: "#1E1E1E",
    deepInk: "#F5F5F4",
    deepMuted: "#B5B5B5",
    deepAccent: "#FF8A3D",
  },
  citrus: {
    name: "Citrus",
    primary: "#C8442A",
    primaryInk: "#FFFFFF",
    primaryText: "#B23B24",
    accent: "#FFC93C",
    accentInk: "#3A2A00",
    bg: "#FFFBF5",
    surface: "#FFFFFF",
    soft: "#FFEFDD",
    ink: "#2B1D16",
    muted: "#6B5A50",
    border: "#F1E0CF",
    deep: "#3B1F17",
    deepInk: "#FFF1E6",
    deepMuted: "#D9C2B6",
    deepAccent: "#FFC93C",
  },
  blush: {
    name: "Blush",
    primary: "#7A2E5A",
    primaryInk: "#FFFFFF",
    primaryText: "#7A2E5A",
    accent: "#F2B8C6",
    accentInk: "#4A1734",
    bg: "#FFFAF7",
    surface: "#FFFFFF",
    soft: "#FAECEE",
    ink: "#2D1A26",
    muted: "#6E5866",
    border: "#F0DDE2",
    deep: "#3E1530",
    deepInk: "#FBEFF3",
    deepMuted: "#D9BCCB",
    deepAccent: "#F2B8C6",
  },
  slate: {
    name: "Slate",
    primary: "#2563EB",
    primaryInk: "#FFFFFF",
    primaryText: "#1D4ED8",
    accent: "#38BDF8",
    accentInk: "#0B2540",
    bg: "#F5F7FA",
    surface: "#FFFFFF",
    soft: "#E8EEF6",
    ink: "#111827",
    muted: "#4B5563",
    border: "#DFE5EE",
    deep: "#1F2937",
    deepInk: "#F1F5F9",
    deepMuted: "#AEB8C6",
    deepAccent: "#60C8FA",
  },
  gold: {
    name: "Gold",
    primary: "#B08D57",
    primaryInk: "#111111",
    primaryText: "#7E5F2C",
    accent: "#D8C3A5",
    accentInk: "#111111",
    bg: "#F7F3EC",
    surface: "#FFFFFF",
    soft: "#EEE6D8",
    ink: "#141414",
    muted: "#5C564D",
    border: "#E4DCCD",
    deep: "#111111",
    deepInk: "#F3EDE2",
    deepMuted: "#B5ACA0",
    deepAccent: "#D2B27A",
  },
  terracotta: {
    name: "Terracotta",
    primary: "#A6492F",
    primaryInk: "#FFFFFF",
    primaryText: "#A6492F",
    accent: "#8C9459",
    accentInk: "#1F1C12",
    bg: "#FAF5EE",
    surface: "#FFFFFF",
    soft: "#F2E7D9",
    ink: "#2E211B",
    muted: "#6B5B52",
    border: "#E8DCCD",
    deep: "#3A2A22",
    deepInk: "#F7EEE5",
    deepMuted: "#CDBBAE",
    deepAccent: "#C8CF8E",
  },
  sky: {
    name: "Sky",
    primary: "#1D6FD8",
    primaryInk: "#FFFFFF",
    primaryText: "#175BB5",
    accent: "#7CC6FE",
    accentInk: "#0B2A4A",
    bg: "#F6FAFE",
    surface: "#FFFFFF",
    soft: "#E7F1FC",
    ink: "#0B2545",
    muted: "#4A5F78",
    border: "#D9E6F4",
    deep: "#0B2545",
    deepInk: "#EAF3FD",
    deepMuted: "#A9BCD3",
    deepAccent: "#7CC6FE",
  },
};

export interface FontPair {
  name: string;
  heading: string; // CSS font-family stack
  body: string; // CSS font-family stack
  googleHref: string;
  headingWeight: number;
  headingTracking: string; // letter-spacing for headings
  headingScale: number; // display faces that run small (Cormorant) get a bump
}

const G = "https://fonts.googleapis.com/css2?";

export const FONT_PAIRS: Record<FontPairId, FontPair> = {
  modern: {
    name: "Modern",
    heading: '"Inter Tight", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    googleHref: `${G}family=Inter+Tight:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap`,
    headingWeight: 700,
    headingTracking: "-0.025em",
    headingScale: 1,
  },
  editorial: {
    name: "Editorial",
    heading: '"Fraunces", Georgia, "Times New Roman", serif',
    body: '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif',
    googleHref: `${G}family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap`,
    headingWeight: 600,
    headingTracking: "-0.015em",
    headingScale: 1,
  },
  friendly: {
    name: "Friendly",
    heading: '"Nunito", system-ui, -apple-system, "Segoe UI", sans-serif',
    body: '"Nunito Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    googleHref: `${G}family=Nunito:wght@700;800;900&family=Nunito+Sans:wght@400;600;700&display=swap`,
    headingWeight: 800,
    headingTracking: "-0.015em",
    headingScale: 1,
  },
  strong: {
    name: "Strong",
    heading: '"Archivo Black", "Archivo", system-ui, -apple-system, "Segoe UI", sans-serif',
    body: '"Archivo", system-ui, -apple-system, "Segoe UI", sans-serif',
    googleHref: `${G}family=Archivo+Black&family=Archivo:wght@400;500;600;700&display=swap`,
    headingWeight: 400,
    headingTracking: "-0.02em",
    headingScale: 0.96,
  },
  elegant: {
    name: "Elegant",
    heading: '"Cormorant Garamond", Garamond, Georgia, serif',
    body: '"Lato", system-ui, -apple-system, "Segoe UI", sans-serif',
    googleHref: `${G}family=Cormorant+Garamond:wght@500;600;700&family=Lato:wght@400;700&display=swap`,
    headingWeight: 600,
    headingTracking: "-0.01em",
    headingScale: 1.14,
  },
  geometric: {
    name: "Geometric",
    heading: '"Outfit", system-ui, -apple-system, "Segoe UI", sans-serif',
    body: '"DM Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    googleHref: `${G}family=Outfit:wght@500;600;700;800&family=DM+Sans:wght@400;500;700&display=swap`,
    headingWeight: 700,
    headingTracking: "-0.02em",
    headingScale: 1,
  },
};

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;

export const ICONS: Record<IconName, string> = {
  tooth: svg(
    '<path d="M7.2 3C4.9 3 3 4.9 3 7.3c0 1.9.6 3.3 1.3 4.9.8 1.8 1 3.5 1.3 5.6.3 2 1 3.2 2 3.2 1.3 0 1.6-1.7 2-3.6.3-1.4.8-2.4 2.4-2.4s2.1 1 2.4 2.4c.4 1.9.7 3.6 2 3.6 1 0 1.7-1.2 2-3.2.3-2.1.5-3.8 1.3-5.6.7-1.6 1.3-3 1.3-4.9C21 4.9 19.1 3 16.8 3c-1.5 0-2.5.8-4.8.8S8.7 3 7.2 3z"/>'
  ),
  heart: svg('<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>'),
  shield: svg('<path d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>'),
  star: svg('<path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/>'),
  clock: svg('<circle cx="12" cy="12" r="9.5"/><path d="M12 6.5V12l3.5 2"/>'),
  calendar: svg('<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18M8 14h2M14 14h2M8 17.5h2"/>'),
  phone: svg(
    '<path d="M21.5 16.4v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.6 3.7 2 2 0 0 1 3.6 1.5h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.6 9.4a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2.1z"/>'
  ),
  map: svg('<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>'),
  wrench: svg('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>'),
  bolt: svg('<path d="M13 2 4 13.5h7l-1 8.5 9-11.5h-7z"/>'),
  drop: svg('<path d="M12 2.7 6.3 8.4a8 8 0 1 0 11.4 0z"/><path d="M8.5 14.5a3.5 3.5 0 0 0 3.5 3.5"/>'),
  flame: svg(
    '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'
  ),
  leaf: svg('<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5.1-6 2.4-.5 4.9-2 5.9-3"/>'),
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9"/>'),
  car: svg(
    '<path d="M5 17H3.5a1 1 0 0 1-1-1v-3.4a2 2 0 0 1 .3-1L4.5 8a2 2 0 0 1 1.8-1.1h9.2a2 2 0 0 1 1.6.8L19.5 11l2 .6a1 1 0 0 1 .7 1V16a1 1 0 0 1-1 1H19"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6M4 11h15"/>'
  ),
  scissors: svg('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>'),
  sparkle: svg('<path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6-5.6-1.9 5.6-1.9z"/><path d="M19 2.5v4M17 4.5h4M5 17.5v3M3.5 19h3"/>'),
  paw: svg(
    '<circle cx="6.5" cy="9.5" r="1.8"/><circle cx="10.2" cy="5.5" r="1.8"/><circle cx="14.8" cy="5.5" r="1.8"/><circle cx="18.5" cy="9.5" r="1.8"/><path d="M7.8 16.4c0-2.7 2-5.4 4.2-5.4s4.2 2.7 4.2 5.4c0 1.8-1.4 3.1-3 3.1-.9 0-1.4-.5-1.2-.5s-.3.5-1.2.5c-1.6 0-3-1.3-3-3.1z"/>'
  ),
  utensils: svg('<path d="M3 2v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6a2 2 0 0 0 2 2h3zm0 0v7"/>'),
  coffee: svg('<path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><path d="M6.5 2v2.5M10 2v2.5M13.5 2v2.5"/>'),
  dumbbell: svg('<path d="M6.5 6.5l11 11M21 21l-1-1M3 3l1 1M18 22l4-4M2 6l4-4M3 10l7-7M14 21l7-7"/>'),
  briefcase: svg('<rect x="2.5" y="7" width="19" height="13.5" rx="2.5"/><path d="M16 20.5V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v15.5M2.5 12.5h19"/>'),
  scale: svg('<path d="M12 3v18M7 21h10M4 7h16"/><path d="M4 7l-2.5 6a3 3 0 0 0 5 0zM20 7l-2.5 6a3 3 0 0 0 5 0z"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>'),
  snowflake: svg('<path d="M2 12h20M12 2v20M20 16l-4-4 4-4M4 8l4 4-4 4M16 4l-4 4-4-4M8 20l4-4 4 4"/>'),
  hammer: svg('<path d="M15 12 6.5 20.5a2.1 2.1 0 0 1-3-3L12 9"/><path d="M17.6 15 22 10.6"/><path d="m20.9 11.7-1.3-1.3a3 3 0 0 1-.9-2.2v-.9L16 4.6A5.6 5.6 0 0 0 12.1 3H9l.9.8a6.2 6.2 0 0 1 2.1 4.6V10l2 2h2.5l2.3 1.9"/>'),
  brush: svg('<path d="M18.4 2.6 14 7l-1.6-1.6a2 2 0 0 0-2.8 0L8 7l9 9 1.6-1.6a2 2 0 0 0 0-2.8L17 10l4.4-4.4a2.1 2.1 0 1 0-3-3z"/><path d="M9 8c-2 3-4 3.5-7 4l8 10c2-1 6-5 6-7"/>'),
  camera: svg('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>'),
};

/** Envelope for email lines (not offered to the Builder, so not an IconName). */
export const MAIL_ICON = svg('<rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><path d="m3.5 7 8.5 6 8.5-6"/>');

/** A solid star for rating rows (filled, not stroked). */
export const STAR_SOLID =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z"/></svg>';
