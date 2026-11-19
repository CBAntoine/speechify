import { CATEGORIES, GEO, isPlaced, previewFraction, regionBounds } from "@/lib/data";
import type { MapLocation, Region } from "@/lib/types";
import { Icon } from "./icons";

/**
 * Zero-JS static map for SEO pages: a crop of the pre-rendered preview
 * (real geography + regions), with the pin or region framed in the middle.
 */
export default function MiniMap({ loc, region }: { loc?: MapLocation; region?: Region }) {
  // Frame in preview-image fractions (0–1). Default: whole state.
  let cx = 0.5;
  let cy = 0.5;
  let span = 1;
  if (loc && isPlaced(loc)) {
    const { fx, fy } = previewFraction(loc.lng, loc.lat);
    cx = fx;
    cy = fy;
    const edge = previewFraction(loc.lng + Math.max(0.6, ((loc.radiusKm ?? 5) * 4) / 100), loc.lat);
    span = Math.min(1, Math.max(0.12, (edge.fx - fx) * 2));
  } else if (region) {
    const [w, s, e, n] = regionBounds(region);
    const a = previewFraction(w, n);
    const b = previewFraction(e, s);
    cx = (a.fx + b.fx) / 2;
    cy = (a.fy + b.fy) / 2;
    span = Math.min(1, Math.max(0.14, Math.max(b.fx - a.fx, b.fy - a.fy) * 1.3));
  }
  const aspect = GEO.preview.height / GEO.preview.width;
  const scale = 1 / span;
  // The frame is square; the preview is not, so vertical offsets scale by the aspect ratio.
  const pinPos = (fx: number, fy: number) => ({
    left: `${((fx - cx) / span + 0.5) * 100}%`,
    top: `${(((fy - cy) * aspect) / span + 0.5) * 100}%`,
  });

  return (
    <div className="mini-map" aria-hidden="true">
      <div
        className="mini-map__art"
        style={{
          width: `${scale * 100}%`,
          height: `${scale * aspect * 100}%`,
          left: `${(0.5 - cx * scale) * 100}%`,
          top: `${(0.5 - cy * scale * aspect) * 100}%`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/geo/preview.webp" alt="" width={GEO.preview.width} height={GEO.preview.height} loading="lazy" />
      </div>
      {loc && isPlaced(loc) && (
        <span className="mini-map__pin" style={pinPos(previewFraction(loc.lng, loc.lat).fx, previewFraction(loc.lng, loc.lat).fy)}>
          <span className={`pin pin--${loc.confidence}`} style={{ "--c": CATEGORIES[loc.category].color } as React.CSSProperties}>
            <span className="pin__halo" />
            <span className="pin__body">
              <Icon name={loc.category} size={18} strokeWidth={1.8} />
            </span>
          </span>
        </span>
      )}
      <span className="mini-map__credit">Real-world Florida · Natural Earth</span>
    </div>
  );
}
