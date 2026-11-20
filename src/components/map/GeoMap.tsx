"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, Map as MLMap, Marker as MLMarker, LngLatBoundsLike, Popup as MLPopup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CATEGORIES, GEO, LOCATIONS, REGIONS, isPlaced, locationById, regionById, regionBounds, searchLocations } from "@/lib/data";
import { mapStore, type MapState } from "@/lib/map-store";
import { CATEGORY_GLYPHS } from "@/components/icons";
import { STREET_MAX_ZOOM, STREET_TILES_URL, addStreetLayers, buildStyle, removeStreetLayers } from "./map-style";
import { locationPopup, placePopup } from "./popups";
import { bboxOf } from "@/lib/geo-utils";
import { drawRoute, previousFocus, trackFocus } from "@/lib/spots";

const EMPTY = { type: "FeatureCollection" as const, features: [] };
/** Below this zoom a click on land picks a region; above it you're reading streets. */
const REGION_CLICK_MAX_ZOOM = 10;

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

/** Room the route card takes (desktop: bottom-left; phones: top). */
const ROUTE_CARD_H = 190;

function layoutInsets(container: HTMLElement, opts: { popup?: boolean } = {}) {
  const wide = container.clientWidth >= 1024;
  const panel = container.closest(".explorer")?.querySelector<HTMLElement>("[data-map-panel]");
  const { voiceOpen, route } = mapStore.get();
  // Leave headroom above a pin for its popup.
  const popupRoom = opts.popup ? Math.min(220, Math.round(container.clientHeight * 0.28)) : 0;
  if (wide) {
    const left = panel ? panel.offsetWidth + 40 : 410;
    const right = voiceOpen ? 420 : 40;
    return clampInsets({ left, right, top: 40 + popupRoom, bottom: 80 + (route ? ROUTE_CARD_H : 0) }, container);
  }
  const sheetH = mapStore.get().sheetOpen ? Math.round(container.clientHeight * SHEET_OPEN) : SHEET_COLLAPSED;
  return clampInsets(
    { left: 16, right: 16, top: 64 + (route ? ROUTE_CARD_H - 40 : 0) + (opts.popup ? 190 : 0), bottom: sheetH + 16 },
    container,
  );
}

/** Padding larger than the map makes MapLibre's camera maths fail: keep at least 120px of view. */
function clampInsets(p: { left: number; right: number; top: number; bottom: number }, container: HTMLElement) {
  const fit = (a: number, b: number, room: number) => {
    const total = a + b;
    if (total <= room) return [a, b];
    const k = Math.max(0, room) / total;
    return [Math.floor(a * k), Math.floor(b * k)];
  };
  const [top, bottom] = fit(p.top, p.bottom, container.clientHeight - 120);
  const [left, right] = fit(p.left, p.right, container.clientWidth - 120);
  return { top, bottom, left, right };
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
          maxZoom: STREET_TILES_URL ? STREET_MAX_ZOOM : 12.5,
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
      let placeMarker: MLMarker | null = null;
      let routeMarkers: MLMarker[] = [];
      let popup: MLPopup | null = null;
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
        // A dead tile host (no TileJSON) drops street detail at once; a few bad tiles don't.
        let tileErrors = 0;
        map.on("error", (e) => {
          const ev = e as unknown as { sourceId?: string; tile?: unknown };
          if (ev.sourceId !== "streets" || !streetsOn) return;
          if (ev.tile && ++tileErrors < 12) return;
          streetsOn = false;
          container.classList.remove("has-streets");
          removeStreetLayers(map);
          map.setMaxZoom(12.5);
          console.warn(
            "[map] street tiles failed to load; continuing without street detail:",
            (e as unknown as { error?: { message?: string } }).error?.message ?? e,
          );
        });

        // Route line (cyan → pink), drawn under street labels so names stay readable.
        map.addSource("route", { type: "geojson", data: EMPTY, lineMetrics: true });
        const beforeLabels = map.getLayer("streets-water-name") ? "streets-water-name" : undefined;
        const round = { "line-cap": "round", "line-join": "round" } as const;
        map.addLayer(
          {
            id: "route-glow",
            type: "line",
            source: "route",
            filter: ["!", ["get", "approx"]],
            layout: round,
            paint: {
              "line-color": "#ff4f9a",
              "line-width": ["interpolate", ["linear"], ["zoom"], 8, 12, 16, 28],
              "line-blur": 10,
              "line-opacity": 0.4,
            },
          },
          beforeLabels,
        );
        map.addLayer(
          {
            id: "route-casing",
            type: "line",
            source: "route",
            filter: ["!", ["get", "approx"]],
            layout: round,
            paint: { "line-color": "#05060d", "line-width": ["interpolate", ["linear"], ["zoom"], 8, 7, 16, 15] },
          },
          beforeLabels,
        );
        map.addLayer(
          {
            id: "route-line",
            type: "line",
            source: "route",
            filter: ["!", ["get", "approx"]],
            layout: round,
            paint: {
              "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 16, 9],
              "line-gradient": ["interpolate", ["linear"], ["line-progress"], 0, "#25e2d0", 0.45, "#4db2ff", 1, "#ff4f9a"],
            },
          },
          beforeLabels,
        );
        map.addLayer(
          {
            id: "route-dashed",
            type: "line",
            source: "route",
            filter: ["get", "approx"],
            paint: {
              "line-color": "#ffd166",
              "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 16, 7],
              "line-dasharray": [1.4, 1.2],
            },
          },
          beforeLabels,
        );

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
          const id = map.getZoom() > REGION_CLICK_MAX_ZOOM ? null : ((e.features?.[0]?.id as string | undefined) ?? null);
          if (id === hoverRegion) return;
          if (hoverRegion) map.setFeatureState({ source: "regions", id: hoverRegion }, { hover: false });
          hoverRegion = id;
          if (id) map.setFeatureState({ source: "regions", id }, { hover: true });
          map.getCanvas().style.cursor = mapStore.get().picking || editMode ? "crosshair" : id ? "pointer" : "";
        });
        map.on("mouseleave", "regions-fill", () => {
          if (hoverRegion) map.setFeatureState({ source: "regions", id: hoverRegion }, { hover: false });
          hoverRegion = null;
          map.getCanvas().style.cursor = mapStore.get().picking ? "crosshair" : "";
        });
        map.on("click", "regions-fill", (e) => {
          if (mapStore.get().picking || editMode || map.getZoom() > REGION_CLICK_MAX_ZOOM) return;
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
          if (loc.placement === "exact" || !loc.radiusKm) {
            map.flyTo({ center: [loc.lng, loc.lat], zoom: streetsOn ? 16.5 : 10.5, padding: layoutInsets(container, { popup: true }), duration: 1600, essential: true });
            return;
          }
          const km = Math.max(loc.radiusKm ?? 1.5, 1.2);
          const dLat = (km * 1.35) / 110.574;
          const dLng = (km * 1.35) / (111.32 * Math.cos((loc.lat * Math.PI) / 180));
          map.fitBounds(
            [
              [loc.lng - dLng, loc.lat - dLat],
              [loc.lng + dLng, loc.lat + dLat],
            ],
            { ...fitOptions(), padding: layoutInsets(container, { popup: true }), maxZoom: streetsOn ? 15 : 10.5 },
          );
          return;
        }
        if (req.kind === "place") {
          const p = mapStore.get().place;
          if (!p) return;
          const b = p.bbox;
          if (b && b[2] - b[0] > 0.0005 && b[3] - b[1] > 0.0005) {
            const big = b[2] - b[0] > 0.08 || b[3] - b[1] > 0.08;
            map.fitBounds(
              [
                [b[0], b[1]],
                [b[2], b[3]],
              ],
              { ...fitOptions(), padding: layoutInsets(container, { popup: true }), maxZoom: streetsOn ? (big ? 14 : 17) : 11 },
            );
          } else {
            map.flyTo({ center: [p.lng, p.lat], zoom: streetsOn ? 16.5 : 11, padding: layoutInsets(container, { popup: true }), duration: 1600, essential: true });
          }
          return;
        }
        if (req.kind === "route") {
          const r = mapStore.get().route;
          if (!r) return;
          const [w, s, e, n] = bboxOf(r.coords);
          map.fitBounds(
            [
              [w, s],
              [e, n],
            ],
            { ...fitOptions(), maxZoom: streetsOn ? 16 : 11 },
          );
          return;
        }
        if (req.kind === "point") {
          map.flyTo({ center: req.center, zoom: Math.min(req.zoom, streetsOn ? 18 : 12), padding: layoutInsets(container), essential: true });
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
        if (!prev || prev.selectedId !== s.selectedId || prev.place !== s.place || prev.popupNonce !== s.popupNonce) {
          trackFocus(s);
          showPopup(s);
        }
        if (!prev || prev.place !== s.place) {
          placeMarker?.remove();
          placeMarker = null;
          if (s.place) {
            const el = document.createElement("div");
            el.className = "place-dot";
            el.setAttribute("aria-label", s.place.name);
            placeMarker = new ml.Marker({ element: el, anchor: "center" }).setLngLat([s.place.lng, s.place.lat]).addTo(map);
          }
        }
        if (!prev || prev.route !== s.route) {
          const r = s.route;
          // The route card takes over from the popup.
          if (r) popup?.remove();
          (map.getSource("route") as GeoJSONSource | undefined)?.setData(
            r
              ? {
                  type: "FeatureCollection",
                  features: [{ type: "Feature", properties: { approx: r.approximate }, geometry: { type: "LineString", coordinates: r.coords } }],
                }
              : EMPTY,
          );
          routeMarkers.forEach((m) => m.remove());
          routeMarkers = [];
          if (r) {
            for (const [end, tag] of [
              [r.from, "A"],
              [r.to, "B"],
            ] as const) {
              const el = document.createElement("div");
              el.className = `route-end route-end--${tag.toLowerCase()}`;
              el.textContent = tag;
              el.title = end.name;
              if (end.locationId) {
                const id = end.locationId;
                el.style.cursor = "pointer";
                el.addEventListener("click", (e) => {
                  e.stopPropagation();
                  mapStore.selectLocation(id, { fly: false });
                });
              }
              routeMarkers.push(new ml.Marker({ element: el, anchor: "bottom", offset: [0, -16] }).setLngLat([end.lng, end.lat]).addTo(map));
            }
          }
        }
        if (prev && prev.pitched !== s.pitched) {
          map.easeTo({ pitch: s.pitched ? 58 : 0, bearing: s.pitched ? -14 : 0, duration: 1100 });
        }
        if (s.fly && s.fly !== prev?.fly) fly(s.fly);
        prev = s;
      };

      const showPopup = (s: MapState) => {
        popup?.remove();
        popup = null;
        let at: [number, number] | null = null;
        let html = "";
        const loc = s.selectedId ? locationById(s.selectedId) : undefined;
        if (loc && isPlaced(loc)) {
          at = [loc.lng, loc.lat];
          html = locationPopup(loc, { narrow: container.clientWidth < 700, from: previousFocus() });
        } else if (s.place) {
          at = [s.place.lng, s.place.lat];
          html = placePopup(s.place, { narrow: container.clientWidth < 700, from: previousFocus() });
        }
        if (!at) return;
        const narrow = container.clientWidth < 1024;
        const here = { name: loc?.name ?? s.place!.name, lng: at[0], lat: at[1], locationId: loc?.id };
        // Phones: always above the spot, clear of the bottom sheet and the Ask Sol button.
        popup = new ml.Popup({ className: "na-popup na-popup--rich", offset: 26, maxWidth: "330px", focusAfterOpen: false, ...(narrow ? { anchor: "bottom" as const } : {}) })
          .setLngLat(at)
          .setHTML(html)
          .addTo(map);
        popup.getElement().addEventListener("click", (e) => {
          const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
          if (!btn) return;
          const act = btn.dataset.act;
          if (act === "guide") {
            mapStore.setSheet(true);
            if (container.clientWidth < 1024) popup?.remove();
          }
          else if (act === "pin" && btn.dataset.id) mapStore.selectLocation(btn.dataset.id);
          else if (act === "route") {
            const from = previousFocus();
            if (from) void drawRoute(from, here);
          }
        });
      };

      const unsub = mapStore.subscribe(() => {
        if (markers.size) apply(mapStore.get());
      });
      const onZoom = () => {
        const z = map.getZoom();
        container.classList.toggle("is-zoomed", z > 7.2);
        container.classList.toggle("is-street", z > 11.5);
      };
      map.on("zoom", onZoom);
      map.on("moveend", () => {
        const c = map.getCenter();
        mapStore.setView({ center: [c.lng, c.lat], zoom: map.getZoom() });
      });

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
