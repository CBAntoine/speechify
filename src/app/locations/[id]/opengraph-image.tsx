import { ImageResponse } from "next/og";
import { CATEGORIES, CONFIDENCE, gridRef, isPlaced, locationById, regionById } from "@/lib/data";
import { SITE } from "@/lib/site";

/** The preview card a shared secret gets on Reddit, Discord, X, iMessage... */
export const alt = "Where to find this GTA 6 secret";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : s);

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loc = locationById(id);
  const cat = loc ? CATEGORIES[loc.category] : null;
  const conf = loc ? CONFIDENCE[loc.confidence] : null;
  const region = loc ? regionById(loc.region) : undefined;
  const name = loc?.name ?? "GTA 6 secret";
  const where = [region?.name, loc && isPlaced(loc) ? `Grid ${gridRef(loc.lng, loc.lat)}` : null].filter(Boolean).join(" · ");
  const accent = cat?.color ?? "#ff4f9a";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: 64,
          background: "radial-gradient(900px 520px at 85% 60%, #2a1240 0%, #0b1530 48%, #05070f 100%)",
          color: "#f3f4fb",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 780 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 20, background: "linear-gradient(135deg, #ff4f9a, #ffb347)", display: "flex" }} />
            <div style={{ fontSize: 30, fontWeight: 800 }}>{SITE.name}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 3, color: accent }}>{(cat?.label ?? "Secret").toUpperCase()}</div>
              {conf && (
                <div style={{ fontSize: 22, padding: "6px 16px", borderRadius: 999, border: `2px solid ${conf.color}`, color: conf.color }}>{conf.label}</div>
              )}
            </div>
            <div style={{ fontSize: name.length > 28 ? 62 : 76, fontWeight: 800, lineHeight: 1.04, display: "flex" }}>{name}</div>
            {loc?.summary && <div style={{ fontSize: 28, lineHeight: 1.35, color: "#c0c4dc", display: "flex" }}>{clip(loc.summary, 150)}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 24, color: "#c0c4dc" }}>
            {where && <div style={{ display: "flex" }}>{where}</div>}
            <div style={{ display: "flex", padding: "10px 20px", borderRadius: 999, background: "linear-gradient(90deg, #ff4f9a, #ffb347)", color: "#14070d", fontWeight: 800 }}>
              How to find it →
            </div>
          </div>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 300, height: 300, borderRadius: 150, border: `3px dashed ${accent}`, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.95 }}>
            <div style={{ width: 170, height: 170, borderRadius: 85, border: `2px solid ${accent}`, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.03)" }}>
              <div style={{ width: 56, height: 56, borderRadius: 28, background: accent, display: "flex", boxShadow: `0 0 60px ${accent}` }} />
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
