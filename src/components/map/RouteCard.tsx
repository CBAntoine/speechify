"use client";

import { useState } from "react";
import { mapStore, useMapStore } from "@/lib/map-store";
import { formatDistance, formatDuration, type TravelMode } from "@/lib/geo-utils";
import { drawRoute } from "@/lib/spots";

const MODES: { id: TravelMode; label: string }[] = [
  { id: "driving", label: "Drive" },
  { id: "walking", label: "Walk" },
  { id: "cycling", label: "Bike" },
];

/** Directions for the route on the map: summary, travel mode and turn-by-turn steps. */
export default function RouteCard() {
  const route = useMapStore((s) => s.route);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!route) return null;

  const switchMode = async (mode: TravelMode) => {
    if (mode === route.mode || busy) return;
    setBusy(true);
    try {
      await drawRoute(route.from, route.to, mode);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="route-card" aria-label="Route" aria-busy={busy}>
      <div className="route-card__head">
        <p className="route-card__ends" title={`${route.from.name} to ${route.to.name}`}>
          <b className="route-card__a">A</b>
          {route.from.name}
          <span aria-hidden="true"> → </span>
          <b className="route-card__b">B</b>
          {route.to.name}
        </p>
        <button type="button" className="route-card__close" onClick={() => mapStore.clearRoute()} aria-label="Clear route">
          ×
        </button>
      </div>
      <p className="route-card__stats">
        <strong>{formatDistance(route.distanceM)}</strong>
        {route.durationS != null && <> · {route.approximate ? "≈ " : ""}{formatDuration(route.durationS)}</>}
        {route.via.length > 0 && <> · via {route.via.join(", ")}</>}
      </p>
      <div className="route-card__modes" role="group" aria-label="Travel mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={m.id === route.mode ? "is-on" : ""}
            aria-pressed={m.id === route.mode}
            onClick={() => void switchMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {route.approximate ? (
        <p className="route-card__warn">Straight-line estimate: live street routing isn&apos;t answering right now.</p>
      ) : (
        <p className="route-card__note">Follows real-world roads on the stand-in map. In-game streets differ.</p>
      )}
      {route.steps.length > 0 && (
        <>
          <button type="button" className="route-card__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Hide steps" : `Show ${route.steps.length} steps`}
          </button>
          {open && (
            <ol className="route-card__steps">
              {route.steps.map((st, i) => (
                <li key={i}>
                  <button type="button" onClick={() => mapStore.flyTo(st.location, 17)}>
                    {st.text}
                  </button>
                  {st.distanceM > 0 && <span>{formatDistance(st.distanceM)}</span>}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
