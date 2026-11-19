import { ImageResponse } from "next/og";
import { STATS } from "@/lib/data";
import { SITE } from "@/lib/site";

export const alt = `${SITE.name}: the talking map of Leonida`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "radial-gradient(900px 500px at 80% 70%, #2a1240 0%, #0b1530 45%, #05070f 100%)",
          color: "#f3f4fb",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              background: "linear-gradient(135deg, #ff4f9a, #ffb347)",
              display: "flex",
            }}
          />
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 1 }}>{SITE.name}</div>
          <div style={{ marginLeft: 12, fontSize: 22, color: "#8a8fae" }}>Unofficial GTA VI guide</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ fontSize: 84, fontWeight: 800, lineHeight: 1.02, display: "flex", flexWrap: "wrap", gap: 22 }}>
            <span>The talking map</span>
            <span style={{ color: "#ff8aa8" }}>of Leonida</span>
          </div>
          <div style={{ fontSize: 30, color: "#c0c4dc", display: "flex" }}>
            {`Secrets · Easter eggs · Tips · Daily news · Ask ${SITE.guideName} out loud`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 40, fontSize: 26, color: "#c0c4dc" }}>
          <span style={{ display: "flex", gap: 10 }}>
            <b style={{ color: "#5cffb0" }}>{String(STATS.confirmed)}</b>
            <span>confirmed finds</span>
          </span>
          <span style={{ display: "flex", gap: 10 }}>
            <b style={{ color: "#ffc24d" }}>{String(STATS.reported)}</b>
            <span>being verified</span>
          </span>
          <span style={{ display: "flex", gap: 10 }}>
            <b style={{ color: "#25e2d0" }}>{String(STATS.tips)}</b>
            <span>tips</span>
          </span>
          <span style={{ display: "flex" }}>Updated daily</span>
        </div>
      </div>
    ),
    size,
  );
}
