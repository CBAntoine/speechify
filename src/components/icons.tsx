import type { CategoryId } from "@/lib/types";

/** Inner SVG markup (24×24, stroke-based) so it can be reused inside Leaflet DivIcons. */
export const CATEGORY_GLYPHS: Record<CategoryId, string> = {
  "easter-egg":
    '<path d="M12 3c-3.6 0-6.5 5.2-6.5 9.4A6.5 6.5 0 0 0 12 19.5a6.5 6.5 0 0 0 6.5-7.1C18.5 8.2 15.6 3 12 3z"/><path d="M6 12l2.4 1.4 1.8-1.6 1.8 1.6 1.8-1.6 1.8 1.6L18 12"/>',
  secret: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="10" r="2.3"/><path d="M11.1 12.2 10 16.5h4l-1.1-4.3"/>',
  collectible: '<path d="M7 4.5h10l4 5L12 20 3 9.5z"/><path d="M3 9.5h18M12 20 8.6 9.5 12 4.5l3.4 5z"/>',
  wildlife:
    '<circle cx="6.8" cy="9.5" r="1.7"/><circle cx="10.6" cy="6.6" r="1.7"/><circle cx="15.2" cy="6.9" r="1.7"/><circle cx="18" cy="10.8" r="1.6"/><path d="M8.6 16.6c0-2.6 2-4.8 4.3-4.8s4 2.1 4 4.4c0 1.9-1.3 2.9-2.9 2.9-.9 0-1.4-.4-2.1-.4s-1.3.5-2.2.5c-1.6 0-1.1-1.3-1.1-2.6z"/>',
  story: '<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9.5h11V10"/><path d="M10.4 19.5v-5h3.2v5"/>',
  service: '<path d="M5 8.5h14l-1.2 11H6.2z"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5"/>',
  tip: '<path d="M9.2 17.5h5.6M10.2 20.5h3.6"/><path d="M12 3.5a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3.5z"/>',
};

const UI = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.4-4.4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevronUp: '<path d="M6 15l6-6 6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  micOff:
    '<path d="M15 10V6.5a3 3 0 0 0-5.6-1.5M9 9v2.5a3 3 0 0 0 4.6 2.5M18.5 11.5a6.4 6.4 0 0 1-1 3.4M5.5 11.5a6.5 6.5 0 0 0 10 5.5M12 18v2.5M4 4l16 16"/>',
  send: '<path d="M4 12 20 4l-6 16-2.6-6.6z"/><path d="M11.4 13.4 20 4"/>',
  end: '<path d="M4.5 14.5c4.6-4 10.4-4 15 0l-1.8 2.6-3.2-1.2v-2.2a9.6 9.6 0 0 0-5 0v2.2l-3.2 1.2z"/>',
  pinPlus: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><path d="M12 7v6M9 10h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  check: '<path d="M5 12.5 10 17 19 7.5"/>',
  layers: '<path d="M12 4 3 9l9 5 9-5z"/><path d="M3 14l9 5 9-5"/>',
  keyboard: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  crown: '<path d="M4 8l4 4 4-7 4 7 4-4-1.5 10h-13z"/>',
  news: '<rect x="3.5" y="5" width="13" height="14" rx="1.5"/><path d="M16.5 9h3v8.5a1.5 1.5 0 0 1-3 0zM7 9h6M7 12.5h6M7 16h4"/>',
  map: '<path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/>',
  bulb: CATEGORY_GLYPHS.tip,
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m4 7 8 6 8-6"/>',
} as const;

export type IconName = keyof typeof UI | CategoryId;

export function svgMarkup(name: IconName, size = 20, strokeWidth = 1.7): string {
  const inner = (UI as Record<string, string>)[name] ?? CATEGORY_GLYPHS[name as CategoryId];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const inner = (UI as Record<string, string>)[name] ?? CATEGORY_GLYPHS[name as CategoryId];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
