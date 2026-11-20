"use client";

import { useEffect, type ReactNode } from "react";
import GeoMap from "./GeoMap";
import MapPanel from "./MapPanel";
import SubmitFind from "./SubmitFind";
import RouteCard from "./RouteCard";
import VoiceGuide from "@/components/voice/VoiceGuide";
import { locationById, regionById } from "@/lib/data";
import { mapStore, useCamera, useMapStore } from "@/lib/map-store";
import { Icon } from "@/components/icons";

/** Deep links: /?loc=<id> or /?region=<id> select on load; selection keeps the URL shareable. */
function useUrlSync() {
  const selectedId = useMapStore((s) => s.selectedId);
  const selectedRegion = useMapStore((s) => s.selectedRegion);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loc = params.get("loc");
    const region = params.get("region");
    if (loc && locationById(loc)) mapStore.selectLocation(loc);
    else if (region && regionById(region)) mapStore.selectRegion(region as NonNullable<ReturnType<typeof regionById>>["id"]);
  }, []);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("loc");
    url.searchParams.delete("region");
    if (selectedId) url.searchParams.set("loc", selectedId);
    else if (selectedRegion) url.searchParams.set("region", selectedRegion);
    if (url.toString() !== window.location.href) window.history.replaceState(null, "", url);
  }, [selectedId, selectedRegion]);
}

function PitchButton() {
  const pitched = useMapStore((s) => s.pitched);
  return (
    <button
      type="button"
      className={`map-tool ${pitched ? "is-on" : ""}`}
      onClick={() => mapStore.togglePitch()}
      aria-pressed={pitched}
      aria-label="Toggle 3D view"
      title="3D view"
    >
      <span className="map-tool__3d">3D</span>
    </button>
  );
}

/** Google Maps-style zoom pill. Touch screens pinch instead, so CSS hides it there. */
function ZoomButtons() {
  return (
    <div className="map-zoom" role="group" aria-label="Zoom">
      <button type="button" className="map-tool" onClick={() => mapStore.zoomIn()} aria-label="Zoom in" title="Zoom in">
        <Icon name="plus" size={18} />
      </button>
      <button type="button" className="map-tool" onClick={() => mapStore.zoomOut()} aria-label="Zoom out" title="Zoom out">
        <Icon name="minus" size={18} />
      </button>
    </div>
  );
}

/** Appears once the map is rotated or tilted; the red tip points north. Click to face north, flat. */
function Compass() {
  const { bearing, pitch } = useCamera();
  if (Math.abs(bearing) < 0.5 && pitch < 0.5) return null;
  return (
    <button type="button" className="map-tool map-compass" onClick={() => mapStore.resetNorth()} aria-label="Reset to north" title="Reset to north">
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-bearing}deg)` }}>
        <path d="M12 2.5 15.5 12h-7z" fill="#ff4f6d" />
        <path d="M12 21.5 8.5 12h7z" fill="currentColor" opacity="0.75" />
      </svg>
    </button>
  );
}

export default function MapExplorer({
  variant = "home",
  editMode = false,
  ticker,
}: {
  variant?: "home" | "full";
  editMode?: boolean;
  ticker?: ReactNode;
}) {
  useUrlSync();
  return (
    <section className={`explorer explorer--${variant}`} id="map" aria-label="Interactive map">
      <GeoMap editMode={editMode} />
      <MapPanel headingLevel={variant === "home" ? 1 : 1} />
      <div className="map-tools" role="toolbar" aria-label="Map tools">
        <button type="button" className="map-tool" onClick={() => mapStore.home()} aria-label="Reset view" title="Reset view">
          <Icon name="target" size={18} />
        </button>
        <PitchButton />
        <button type="button" className="map-tool" onClick={() => mapStore.startPicking()} aria-label="Pin a find">
          <Icon name="pinPlus" size={18} />
        </button>
        <ZoomButtons />
        <Compass />
      </div>
      <RouteCard />
      <p className="map-credit">Real-world Florida as Leonida&apos;s stand-in · in-game layout differs · zones approximate</p>
      {editMode && <p className="edit-flag">Curator mode: click the map to copy coordinates</p>}
      <VoiceGuide />
      {ticker}
      <SubmitFind />
    </section>
  );
}
