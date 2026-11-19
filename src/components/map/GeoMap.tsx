"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, Marker as MLMarker, LngLatBoundsLike } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CATEGORIES, GEO, LOCATIONS, REGIONS, isPlaced, locationById, regionById, regionBounds, searchLocations } from "@/lib/data";
import { mapStore, type MapState } from "@/lib/map-store";
import { CATEGORY_GLYPHS } from "@/components/icons";
import { STREET_TILES_URL, addStreetLayers, buildStyle } from "./map-style";

interface Props {
  /** Home page: page scroll wins; Ctrl/⌘ + scroll or two fingers move the map (MapLibre cooperative gestures). */
  cooperative?: boolean;
  /** Curator mode (?edit=1): click anywhere to copy coordinates for data/locations.json. */
  editMode?: boolean;
}

const HOME: LngLatBoundsLike = [
  [GEO.home.west, GEO.home.south],
  [GEO.home.east, GEO.home.north],
];
// Phones: frame the peninsula, where most of the action is.
const HOME_NARROW: LngLatBoundsLike = [
  [-83.3, 24.4],
  [-79.85, 30.9],
];
const MAX_BOUNDS: LngLatBoundsLike = [
  [-92.5, 21.5],
  [-75.5, 33.8],
];
const SHEET_COLLAPSED = 128; // keep in sync with .map-panel height (mobile) in globals.css
const SHEET_OPEN = 0.62;

function layoutInsets(container: HTMLElement) {
  const wide = container.clientWidth >= 1024;
  const panel = container.closest(".explorer")?.querySelector<HTMLElement>("[data-map-panel]");
  const voiceOpen = mapStore.get().voiceOpen;
  if (wide) {
    const left = panel ? panel.offsetWidth + 40 : 410;
    const right = voiceOpen ? 420 : 40;
    return { left, right, top: 40, bottom: 80 };
  }
  const sheetH = mapStore.get().sheetOpen ? Math.round(container.clientHeight * SHEET_OPEN) : SHEET_COLLAPSED;
  return { left: 16, right: 16, top: 64, bottom: sheetH + 16 };
}

function visibleIds(s: MapState): Set<string> {
  return new Set(
    searchLocations({ query: s.query, categories: s.categories, confidence: s.confidence, includeUnplaced: false }).map((l) => l.id),
  );
}

function pinElement(id: string): HTMLDivElement {
  const loc = locationById(id)!;
  const cat = CATEGORIES[loc.category];
  const el = document.createElement("div");
  el.className = "pin-icon";
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-label", `${loc.name}: ${cat.label}, ${loc.confidence}`);
  el.innerHTML = `<span class="pin pin--${loc.confidence}" style="--c:${cat.color}"><span class="pin__halo"></span><span class="pin__body"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${CATEGORY_GLYPHS[loc.category]}</svg></span></span><span class="pin-tip"><strong>${loc.name}</strong><span>${cat.label} · ${loc.confidence}</span></span>`;
  return el;
}

export default function GeoMap({ cooperative = false, editMode = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const mapRef = useRef<MLMap | null>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const ml = await import("maplibre-gl");
      if (disposed || !host.current) return;
      ml.setWorkerUrl(`/vendor/maplibre-gl-worker.mjs?v=${ml.getVersion()}`);
      const container = host.current;
      const narrow = container.clientWidth < 700;

      let map: MLMap;
      try {
        map = new ml.Map({
          container,
          style: buildStyle() as never,
          bounds: narrow ? HOME_NARROW : HOME,
          fitBoundsOptions: { padding: layoutInsets(container) },
          maxBounds: MAX_BOUNDS,
          minZoom: 4.4,
          maxZoom: STREET_TILES_URL ? 16.5 : 12.5,
          maxPitch: 68,
          cooperativeGestures: cooperative,
          attributionControl: { compact: true },
          canvasContextAttributes: { antialias: true },
          fadeDuration: 150,
        });
      } catch (err) {
        console.error("[map] WebGL map failed to start", err);
        setFailed(true);
        return;
      }
      mapRef.current = map;

      const markers = new Map<string, { marker: MLMarker; el: HTMLDivElement }>();
      let streetsOn = false;
      let pickMarker: MLMarker | null = null;
      let hoverRegion: string | null = null;
      let activeRegion: string | null = null;
      let prev: MapState | null = null;

      const stopMapEvents = (el: HTMLElement) => {
        for (const type of ["mousedown", "touchstart", "dblclick", "wheel"] as const) {
          el.addEventListener(type, (e) => e.stopPropagation(), { passive: true });
        }
      };

      map.on("load", () => {
        if (disposed) return;
        try {
          streetsOn = addStreetLayers(map);
          container.classList.toggle("has-streets", streetsOn);
        } catch (err) {
          console.warn("[map] street detail unavailable", err);
        }
        map.on("error", (e) => {
          const sourceId = (e as unknown as { sourceId?: string }).sourceId;
          if (sourceId === "streets" && streetsOn) {
            streetsOn = false;
            container.classList.remove("has-streets");
            for (const id of ["streets-buildings", "streets-roads", "streets-water"]) if (map.getLayer(id)) map.removeLayer(id);
            map.setMaxZoom(12.5);
            console.warn("[map] street tiles failed to load; continuing without street detail");
          }
        });

        // Region labels.
        for (const r of REGIONS) {
          const pins = LOCATIONS.filter((l) => l.region === r.id).length;
          const el = document.createElement("button");
          el.type = "button";
          el.className = `region-label region-label--${r.labelAnchor}`;
          el.style.setProperty("--rc", r.color);
          el.innerHTML = `<span class="region-label__name">${r.name.replace(" National Park", "")}</span><span class="region-label__tag">${r.id === "mount-kalaga" ? "National park · " : ""}${pins} ${pins === 1 ? "pin" : "pins"}</span>`;
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            mapStore.selectRegion(r.id);
          });
          stopMapEvents(el);
          new ml.Marker({ element: el, anchor: r.labelAnchor === "start" ? "left" : r.labelAnchor === "end" ? "right" : "center" })
            .setLngLat(r.label)
            .addTo(map);
        }

        // Grid references along the chart edges (low zoom only; see CSS).
        const g = GEO.grid;
        for (let i = 0; i < g.cols; i++) {
          const el = document.createElement("span");
          el.className = "grid-label";
          el.textContent = String.fromCharCode(65 + i);
          new ml.Marker({ element: el, anchor: "bottom" })
            .setLngLat([g.west + ((i + 0.5) * (g.east - g.west)) / g.cols, g.north + 0.05])
            .addTo(map);
        }
        for (let j = 0; j < g.rows; j++) {
          const el = document.createElement("span");
          el.className = "grid-label";
          el.textContent = String(j + 1);
          new ml.Marker({ element: el, anchor: "right" })
            .setLngLat([g.west - 0.06, g.north - ((j + 0.5) * (g.north - g.south)) / g.rows])
            .addTo(map);
        }

        // Pins.
        for (const loc of LOCATIONS) {
          if (!isPlaced(loc)) continue;
          const el = pinElement(loc.id);
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (mapStore.get().picking) return;
            mapStore.selectLocation(loc.id);
          });
          el.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              mapStore.selectLocation(loc.id);
            }
          });
          stopMapEvents(el);
          const marker = new ml.Marker({ element: el, anchor: "center" }).setLngLat([loc.lng, loc.lat]).addTo(map);
          markers.set(loc.id, { marker, el });
        }

        // Region hover / click (feature-state driven styling).
        map.on("mousemove", "regions-fill", (e) => {
          const id = (e.features?.[0]?.id as string | undefined) ?? null;
          if (id === hoverRegion) return;
          if (hoverRegion) map.setFeatureState({ source: "regions", id: hoverRegion }, { hover: false });
          hoverRegion = id;
          if (id) map.setFeatureState({ source: "regions", id }, { hover: true });
          map.getCanvas().style.cursor = mapStore.get().picking || editMode ? "crosshair" : "pointer";
        });
        map.on("mouseleave", "regions-fill", () => {
          if (hoverRegion) map.setFeatureState({ source: "regions", id: hoverRegion }, { hover: false });
          hoverRegion = null;
          map.getCanvas().style.cursor = mapStore.get().picking ? "crosshair" : "";
        });
        map.on("click", "regions-fill", (e) => {
          if (mapStore.get().picking || editMode) return;
          const id = e.features?.[0]?.id as (typeof REGIONS)[number]["id"] | undefined;
          if (id) mapStore.selectRegion(id);
        });

        // Picking (submissions) and curator mode.
        map.on("click", (e) => {
          const p = { lng: Math.round(e.lngLat.lng * 1e4) / 1e4, lat: Math.round(e.lngLat.lat * 1e4) / 1e4 };
          if (mapStore.get().picking) {
            mapStore.pick(p);
            return;
          }
          if (editMode) {
            const snippet = `"lng": ${p.lng}, "lat": ${p.lat}`;
            void navigator.clipboard?.writeText(snippet).catch(() => {});
            new ml.Popup({ className: "na-popup", closeButton: false })
              .setLngLat(e.lngLat)
              .setHTML(`<code>${snippet}</code><br/><small>Copied to clipboard</small>`)
              .addTo(map);
          }
        });

        // Start the attribution collapsed on small screens (it expands on tap).
        if (narrow) container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");

        apply(mapStore.get());
        setReady(true);
      });

      const fitOptions = () => ({ padding: layoutInsets(container), duration: 1300, essential: true });

      const fly = (req: NonNullable<MapState["fly"]>) => {
        if (req.kind === "home") {
          map.fitBounds(container.clientWidth < 700 ? HOME_NARROW : HOME, { ...fitOptions(), pitch: map.getPitch() });
          return;
        }
        if (req.kind === "location") {
          const loc = locationById(req.id);
          if (!loc || !isPlaced(loc)) return;
          const km = Math.max(loc.radiusKm ?? 1.5, 1.2);
          const dLat = (km * 1.35) / 110.574;
          const dLng = (km * 1.35) / (111.32 * Math.cos((loc.lat * Math.PI) / 180));
          map.fitBounds(
            [
              [loc.lng - dLng, loc.lat - dLat],
              [loc.lng + dLng, loc.lat + dLat],
            ],
            { ...fitOptions(), maxZoom: streetsOn ? 13.5 : 10.5 },
          );
          return;
        }
        if (req.kind === "region") {
          const r = regionById(req.id);
          if (!r) return;
          const [w, s, e, n] = regionBounds(r);
          map.fitBounds(
            [
              [w, s],
              [e, n],
            ],
            fitOptions(),
          );
          return;
        }
        if (req.kind === "fit") {
          const pts = req.ids.map((id) => locationById(id)).filter((l): l is NonNullable<typeof l> & { lng: number; lat: number } => !!l && isPlaced(l));
          if (!pts.length) return;
          const lngs = pts.map((p) => p.lng);
          const lats = pts.map((p) => p.lat);
          map.fitBounds(
            [
              [Math.min(...lngs) - 0.15, Math.min(...lats) - 0.12],
              [Math.max(...lngs) + 0.15, Math.max(...lats) + 0.12],
            ],
            { ...fitOptions(), maxZoom: 10 },
          );
        }
      };

      const apply = (s: MapState) => {
        if (!map.isStyleLoaded() && !markers.size) {
          prev = null;
          return;
        }
        if (
          !prev ||
          prev.categories !== s.categories ||
          prev.confidence !== s.confidence ||
          prev.query !== s.query ||
          prev.selectedId !== s.selectedId ||
          prev.highlightIds !== s.highlightIds
        ) {
          const visible = visibleIds(s);
          const highlight = new Set(s.highlightIds);
          markers.forEach(({ el }, id) => {
            el.classList.toggle("is-hidden", !(visible.has(id) || id === s.selectedId));
            el.classList.toggle("is-selected", id === s.selectedId);
            el.classList.toggle("is-highlight", highlight.has(id));
          });
          const shown = [...visible, ...(s.selectedId ? [s.selectedId] : [])];
          const filter = ["in", ["get", "id"], ["literal", shown]] as never;
          if (map.getLayer("zones-fill")) map.setFilter("zones-fill", filter);
          if (map.getLayer("zones-edge")) map.setFilter("zones-edge", filter);
        }
        if (!prev || prev.selectedRegion !== s.selectedRegion) {
          if (activeRegion) map.setFeatureState({ source: "regions", id: activeRegion }, { active: false });
          activeRegion = s.selectedRegion;
          if (activeRegion) map.setFeatureState({ source: "regions", id: activeRegion }, { active: true });
        }
        if (!prev || prev.picking !== s.picking) {
          container.classList.toggle("is-picking", s.picking);
          map.getCanvas().style.cursor = s.picking ? "crosshair" : "";
        }
        if (!prev || prev.picked !== s.picked) {
          pickMarker?.remove();
          pickMarker = null;
          if (s.picked) {
            const el = document.createElement("div");
            el.className = "pin-icon";
            el.innerHTML = '<span class="pin pin--picked" style="--c:#ffffff"><span class="pin__halo"></span><span class="pin__body">+</span></span>';
            pickMarker = new ml.Marker({ element: el, draggable: true }).setLngLat([s.picked.lng, s.picked.lat]).addTo(map);
            pickMarker.on("dragend", () => {
              const ll = pickMarker!.getLngLat();
              mapStore.pick({ lng: Math.round(ll.lng * 1e4) / 1e4, lat: Math.round(ll.lat * 1e4) / 1e4 });
            });
          }
        }
        if (prev && prev.pitched !== s.pitched) {
          map.easeTo({ pitch: s.pitched ? 58 : 0, bearing: s.pitched ? -14 : 0, duration: 1100 });
        }
        if (s.fly && s.fly !== prev?.fly) fly(s.fly);
        prev = s;
      };

      const unsub = mapStore.subscribe(() => {
        if (markers.size) apply(mapStore.get());
      });
      const onZoom = () => container.classList.toggle("is-zoomed", map.getZoom() > 7.2);
      map.on("zoom", onZoom);

      cleanup = () => {
        unsub();
        map.remove();
        mapRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [cooperative, editMode]);

  return (
    <div className="map-canvas">
      <div ref={host} className="map-canvas__gl" aria-label="Interactive map of Leonida" role="application" />
      {!ready && !failed && (
        <div className="map-canvas__loading" aria-hidden="true">
          <span className="spinner" /> Charting Leonida…
        </div>
      )}
      {failed && (
        <div className="map-canvas__loading">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/geo/preview.webp" alt="Static map of Leonida" className="map-canvas__fallback" />
          <p>Your browser can&apos;t run the live 3D map. Here&apos;s the static version.</p>
        </div>
      )}
    </div>
  );
}
