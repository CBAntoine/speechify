import type { StyleSpecification } from "@maplibre/maplibre-gl-style-spec";
import type { AddLayerObject, Map as MLMap } from "maplibre-gl";
import { CATEGORIES, GEO, LOCATIONS, circleRing, isPlaced } from "@/lib/data";

/**
 * Neon Atlas map style. Every source is self-hosted (public/geo), built from
 * Natural Earth + AWS Terrain Tiles by scripts/build-geodata.mjs, so the base
 * map has no third-party runtime dependency. Street-level detail is optional
 * and layered on separately (see addStreetLayers).
 */
const geo = (name: string) => `/geo/${name}.geojson`;

export function zonesData() {
  return {
    type: "FeatureCollection" as const,
    features: LOCATIONS.filter(isPlaced)
      .filter((l) => l.placement === "approximate" && l.radiusKm)
      .map((l) => ({
        type: "Feature" as const,
        properties: { id: l.id, color: CATEGORIES[l.category].color, theory: l.confidence === "theory" },
        geometry: { type: "Polygon" as const, coordinates: [circleRing(l.lng, l.lat, l.radiusKm!)] },
      })),
  };
}

export function buildStyle(): StyleSpecification {
  const b = GEO.imageBounds;
  return {
    version: 8,
    name: "Neon Atlas Night",
    // Horizon glow when the camera is tilted (3D view).
    sky: {
      "sky-color": "#0b1030",
      "horizon-color": "#3a1450",
      "fog-color": "#030b18",
      "sky-horizon-blend": 0.7,
      "horizon-fog-blend": 0.6,
      "fog-ground-blend": 0.35,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 4, 0.8, 9, 0.2],
    },
    sources: {
      bathymetry: {
        type: "image",
        url: "/geo/bathymetry.webp",
        // (image sources carry no attribution field; credited on "state" below)
        coordinates: [
          [b.west, b.north],
          [b.east, b.north],
          [b.east, b.south],
          [b.west, b.south],
        ],
      },
      neighbors: { type: "geojson", data: geo("neighbors") },
      state: {
        type: "geojson",
        data: geo("florida"),
        attribution:
          '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a> · Seafloor: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">AWS Terrain Tiles</a>',
      },
      islands: { type: "geojson", data: geo("islands") },
      parks: { type: "geojson", data: geo("parks") },
      urban: { type: "geojson", data: geo("urban") },
      lakes: { type: "geojson", data: geo("lakes") },
      rivers: { type: "geojson", data: geo("rivers") },
      roads: { type: "geojson", data: geo("roads") },
      places: { type: "geojson", data: geo("places") },
      lights: { type: "geojson", data: geo("lights") },
      grid: { type: "geojson", data: geo("grid") },
      regions: { type: "geojson", data: geo("regions"), promoteId: "id" },
      zones: { type: "geojson", data: zonesData(), promoteId: "id" },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#030b18" } },
      {
        id: "bathymetry",
        type: "raster",
        source: "bathymetry",
        // ~300 m/px seafloor data: fade it out at street zooms instead of showing pixels.
        paint: {
          "raster-opacity": ["interpolate", ["linear"], ["zoom"], 9, 1, 11.5, 0.25],
          "raster-resampling": "linear",
          "raster-fade-duration": 0,
        },
      },

      // Out-of-state land: dimmed so Leonida pops.
      { id: "neighbors", type: "fill", source: "neighbors", paint: { "fill-color": "#080b14", "fill-opacity": 0.9 } },
      {
        id: "state-line",
        type: "line",
        source: "neighbors",
        paint: { "line-color": "#c9d6ff", "line-opacity": 0.18, "line-width": 1, "line-dasharray": [3, 3] },
      },

      // Leonida (Florida) land with a neon coastline glow.
      {
        id: "coast-glow",
        type: "line",
        source: "state",
        paint: {
          "line-color": "#36d6e7",
          "line-opacity": 0.22,
          "line-blur": ["interpolate", ["linear"], ["zoom"], 5, 6, 10, 16],
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 8, 10, 22],
        },
      },
      { id: "land", type: "fill", source: "state", paint: { "fill-color": "#111827", "fill-antialias": true } },
      { id: "islands", type: "fill", source: "islands", paint: { "fill-color": "#141d30" } },
      {
        id: "grid",
        type: "line",
        source: "grid",
        paint: { "line-color": "#9ec8ff", "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.08, 9, 0.03], "line-width": 1 },
      },
      { id: "parks", type: "fill", source: "parks", paint: { "fill-color": "#1f7a4d", "fill-opacity": 0.16 } },
      { id: "urban", type: "fill", source: "urban", paint: { "fill-color": "#ff9e6b", "fill-opacity": 0.06 } },

      // Leonida regions: tint + dashed edge, with hover/active feature-state.
      {
        id: "regions-fill",
        type: "fill",
        source: "regions",
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "active"], false],
            0.2,
            ["boolean", ["feature-state", "hover"], false],
            0.13,
            0.065,
          ],
        },
      },
      { id: "lakes", type: "fill", source: "lakes", paint: { "fill-color": "#0c3150" } },
      { id: "lakes-edge", type: "line", source: "lakes", paint: { "line-color": "#47c4e6", "line-opacity": 0.45, "line-width": 0.8 } },
      {
        id: "rivers",
        type: "line",
        source: "rivers",
        paint: {
          "line-color": "#3fb8d8",
          "line-opacity": 0.42,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 10, 2],
        },
      },
      {
        id: "coast",
        type: "line",
        source: "state",
        paint: { "line-color": "#5ee7f0", "line-opacity": 0.6, "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 10, 1.4] },
      },
      {
        id: "regions-edge",
        type: "line",
        source: "regions",
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": ["case", ["boolean", ["feature-state", "active"], false], 0.95, ["boolean", ["feature-state", "hover"], false], 0.7, 0.38],
          "line-width": ["case", ["boolean", ["feature-state", "active"], false], 2.2, 1.2],
          "line-dasharray": [2, 2],
        },
      },

      // Night: highway light trails, population-weighted city glow, scattered lights.
      {
        id: "roads-glow",
        type: "line",
        source: "roads",
        filter: ["==", ["get", "kind"], "major"],
        paint: {
          "line-color": "#ffb35c",
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.22, 10, 0.18, 12, 0],
          "line-blur": 3,
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 2, 10, 7],
        },
      },
      {
        id: "roads",
        type: "line",
        source: "roads",
        paint: {
          "line-color": ["match", ["get", "kind"], "major", "#ffcf8a", "#c99a6a"],
          // national-scale highway geometry: fade before it looks crude up close
          "line-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["match", ["get", "kind"], "major", 0.6, 0.3],
            11,
            ["match", ["get", "kind"], "major", 0.25, 0.1],
          ],
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["match", ["get", "kind"], "major", 0.7, 0.35], 10, ["match", ["get", "kind"], "major", 2, 1]],
        },
      },
      {
        id: "city-glow",
        type: "heatmap",
        source: "places",
        maxzoom: 12,
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "pop"], 0, 0.05, 200000, 0.35, 1000000, 0.7, 6000000, 1],
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 10, 1.6],
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 5, 16, 8, 46, 11, 110],
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            "rgba(0,0,0,0)",
            0.15,
            "rgba(255,79,154,0.18)",
            0.4,
            "rgba(255,110,120,0.4)",
            0.7,
            "rgba(255,170,80,0.6)",
            1,
            "rgba(255,236,200,0.8)",
          ],
          "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.85, 10, 0.55, 12, 0],
        },
      },
      {
        id: "lights",
        type: "circle",
        source: "lights",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 0.6, 8, 1.3, 11, 2.6, 14, 4],
          "circle-color": ["match", ["get", "c"], 0, "#ffd9a0", 1, "#ff9ecb", 2, "#fff4e2", "#ffc46b"],
          "circle-opacity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            5,
            ["*", ["get", "w"], 0.55],
            9,
            ["*", ["get", "w"], 0.9],
            13,
            ["*", ["get", "w"], 0.5],
          ],
          "circle-blur": 0.35,
        },
      },

      // Search zones for approximate pins.
      {
        id: "zones-fill",
        type: "fill",
        source: "zones",
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.1 },
      },
      {
        id: "zones-edge",
        type: "line",
        source: "zones",
        paint: {
          "line-color": ["get", "color"],
          "line-opacity": 0.9,
          "line-width": 1.6,
          "line-dasharray": ["case", ["get", "theory"], ["literal", [1, 3]], ["literal", [3, 3]]],
        },
      },
    ],
  };
}

/**
 * Optional street-level detail from an OpenMapTiles-schema vector source
 * (default: OpenFreeMap, free, no key; © OpenStreetMap contributors).
 * Inserted beneath the search zones. 3D buildings appear from zoom 13.
 */
export const STREET_TILES_URL =
  process.env.NEXT_PUBLIC_STREET_TILES_URL === "off"
    ? ""
    : process.env.NEXT_PUBLIC_STREET_TILES_URL || "https://tiles.openfreemap.org/planet";

export const STREET_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

export function addStreetLayers(map: MLMap) {
  if (!STREET_TILES_URL) return false;
  map.addSource("streets", { type: "vector", url: STREET_TILES_URL, attribution: STREET_ATTRIBUTION });
  const before = "zones-fill";
  const add = (layer: AddLayerObject) => map.addLayer(layer, before);
  add(
    {
      id: "streets-water",
      type: "fill",
      source: "streets",
      "source-layer": "water",
      minzoom: 9,
      paint: { "fill-color": "#0a2238", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0, 10.5, 0.95] },
    },
  );
  add(
    {
      id: "streets-roads",
      type: "line",
      source: "streets",
      "source-layer": "transportation",
      minzoom: 10,
      filter: ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"], true, false],
      paint: {
        "line-color": [
          "match",
          ["get", "class"],
          ["motorway", "trunk"],
          "#ffb35c",
          ["primary", "secondary"],
          "#ff8fc7",
          "#5d6b94",
        ],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 11, 0.75],
        "line-width": [
          "interpolate",
          ["exponential", 1.6],
          ["zoom"],
          10,
          ["match", ["get", "class"], ["motorway", "trunk"], 1.2, 0.3],
          16,
          ["match", ["get", "class"], ["motorway", "trunk"], 8, ["primary", "secondary"], 5, 2],
        ],
      },
    },
  );
  add(
    {
      id: "streets-buildings",
      type: "fill-extrusion",
      source: "streets",
      "source-layer": "building",
      minzoom: 13,
      paint: {
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], 8],
          0,
          "#161c38",
          60,
          "#3a2a5c",
          180,
          "#ff4f9a",
        ],
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.85,
      },
    },
  );
  return true;
}
