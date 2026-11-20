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
    // Label fonts are self-hosted and rasterised in the browser (no glyph server).
    ...(STREET_TILES_URL ? { "font-faces": fontFaces() } : {}),
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
 * Street-level detail from an OpenMapTiles-schema vector source: every street,
 * building, park, shop and house number in real-world Florida
 * (default: OpenFreeMap — free, no key; data © OpenStreetMap contributors).
 * Set NEXT_PUBLIC_STREET_TILES_URL to your own TileJSON (or "off").
 */
export const STREET_TILES_URL =
  process.env.NEXT_PUBLIC_STREET_TILES_URL === "off"
    ? ""
    : process.env.NEXT_PUBLIC_STREET_TILES_URL || "https://tiles.openfreemap.org/planet";

export const STREET_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

/** Deepest zoom with streets: house-number level. */
export const STREET_MAX_ZOOM = 19;

const LATIN = ["U+0000-00FF", "U+0131", "U+0152-0153", "U+02BB-02BC", "U+02C6", "U+02DA", "U+02DC", "U+0304", "U+0308", "U+0329", "U+2000-206F", "U+20AC", "U+2122", "U+2191", "U+2193", "U+2212", "U+2215", "U+FEFF", "U+FFFD"];
const LATIN_EXT = ["U+0100-02BA", "U+02BD-02C5", "U+02C7-02CC", "U+02CE-02D7", "U+02DD-02FF", "U+1D00-1DBF", "U+1E00-1E9F", "U+1EF2-1EFF", "U+2020", "U+20A0-20AB", "U+20AD-20C0", "U+2113", "U+2C60-2C7F", "U+A720-A7FF"];

function fontFaces() {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const face = (name: string) => [
    { url: `${origin}/vendor/fonts/${name}-latin.woff2`, "unicode-range": LATIN },
    { url: `${origin}/vendor/fonts/${name}-latin-ext.woff2`, "unicode-range": LATIN_EXT },
  ];
  return { Inter: face("inter"), Unbounded: face("unbounded") };
}

const NAME = ["coalesce", ["get", "name:en"], ["get", "name:latin"], ["get", "name"]];
const HALO = "rgba(4,6,14,0.95)";

/** Road widths (px) at zoom 10 / 13 / 16 / 19, by OpenMapTiles class. */
const ROAD_W: Record<string, [number, number, number, number]> = {
  motorway: [1.6, 3.6, 11, 38],
  trunk: [1.3, 3.2, 10, 34],
  primary: [0.9, 2.6, 8.5, 30],
  secondary: [0.6, 2, 7, 26],
  tertiary: [0.4, 1.5, 6, 22],
  minor: [0, 0.8, 4.2, 16],
  service: [0, 0.4, 2.4, 9],
  track: [0, 0.3, 1.6, 6],
};
const ROAD_COLOR = [
  "match",
  ["get", "class"],
  "motorway",
  "#ffae57",
  "trunk",
  "#ffc46b",
  "primary",
  "#ff5fa2",
  "secondary",
  "#ff8cc0",
  "tertiary",
  "#c3a6ff",
  "minor",
  "#64709f",
  "#454e74",
];
const ROAD_RANK = ["match", ["get", "class"], "motorway", 10, "trunk", 9, "primary", 8, "secondary", 7, "tertiary", 6, "minor", 5, "service", 4, 3];

function roadWidth(pad: [number, number, number, number] = [0, 0, 0, 0]) {
  const zooms = [10, 13, 16, 19];
  const stops = zooms.flatMap((z, i) => [
    z,
    ["match", ["get", "class"], ...Object.entries(ROAD_W).flatMap(([c, w]) => [c, w[i] ? w[i] + pad[i] : 0]), 0],
  ]);
  return ["interpolate", ["exponential", 1.5], ["zoom"], ...stops];
}

const ROADS = ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track"];

/** Layers drawn under the search zones (and the route). */
export function streetLayers(): AddLayerObject[] {
  const src = { source: "streets" } as const;
  const layers = [
    {
      id: "streets-landcover",
      type: "fill",
      ...src,
      "source-layer": "landcover",
      minzoom: 10,
      paint: {
        "fill-color": ["match", ["get", "class"], "wood", "#0e2419", "grass", "#10261c", "wetland", "#0c2627", "sand", "#2b2517", "#121a1c"],
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 11, 0.75],
      },
    },
    {
      id: "streets-landuse",
      type: "fill",
      ...src,
      "source-layer": "landuse",
      minzoom: 11,
      paint: {
        "fill-color": [
          "match",
          ["get", "class"],
          "residential",
          "#141a2c",
          ["commercial", "retail"],
          "#1b1631",
          "industrial",
          "#16171f",
          ["hospital", "school", "university", "college"],
          "#1f1730",
          ["stadium", "pitch", "playground"],
          "#11281f",
          "cemetery",
          "#13201a",
          "#141826",
        ],
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0, 12, 0.85],
      },
    },
    {
      id: "streets-park",
      type: "fill",
      ...src,
      "source-layer": "park",
      minzoom: 10,
      paint: { "fill-color": "#0f2a1f", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0, 11, 0.9] },
    },
    {
      id: "streets-water",
      type: "fill",
      ...src,
      "source-layer": "water",
      minzoom: 9,
      paint: { "fill-color": "#08223a", "fill-opacity": ["interpolate", ["linear"], ["zoom"], 9.5, 0, 10.5, 1] },
    },
    {
      id: "streets-waterway",
      type: "line",
      ...src,
      "source-layer": "waterway",
      minzoom: 11,
      paint: {
        "line-color": "#0f3d5e",
        "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 11, 0.6, 16, ["match", ["get", "class"], ["river", "canal"], 6, 2]],
      },
    },
    {
      id: "streets-aeroway",
      type: "line",
      ...src,
      "source-layer": "aeroway",
      minzoom: 11,
      filter: ["match", ["get", "class"], ["runway", "taxiway"], true, false],
      paint: {
        "line-color": "#2c3352",
        "line-width": ["interpolate", ["exponential", 1.5], ["zoom"], 11, ["match", ["get", "class"], "runway", 2, 0.5], 17, ["match", ["get", "class"], "runway", 60, 14]],
      },
    },
    {
      id: "streets-road-casing",
      type: "line",
      ...src,
      "source-layer": "transportation",
      minzoom: 12,
      filter: ["match", ["get", "class"], ROADS, true, false],
      layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ROAD_RANK },
      paint: { "line-color": "#04060d", "line-width": roadWidth([0.6, 1.2, 2.4, 5]), "line-opacity": ["case", ["==", ["get", "brunnel"], "tunnel"], 0.3, 0.9] },
    },
    {
      id: "streets-road",
      type: "line",
      ...src,
      "source-layer": "transportation",
      minzoom: 9.5,
      filter: ["match", ["get", "class"], ROADS, true, false],
      layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ROAD_RANK },
      paint: {
        "line-color": ROAD_COLOR,
        "line-width": roadWidth(),
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 9.5, 0, 11, ["case", ["==", ["get", "brunnel"], "tunnel"], 0.4, 0.95]],
      },
    },
    {
      id: "streets-path",
      type: "line",
      ...src,
      "source-layer": "transportation",
      minzoom: 14.5,
      filter: ["==", ["get", "class"], "path"],
      paint: {
        "line-color": "#8c7ae6",
        "line-opacity": 0.7,
        "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.8, 19, 3],
        "line-dasharray": [2, 1.5],
      },
    },
    {
      id: "streets-rail",
      type: "line",
      ...src,
      "source-layer": "transportation",
      minzoom: 11,
      filter: ["match", ["get", "class"], ["rail", "transit"], true, false],
      paint: {
        "line-color": "#6d7398",
        "line-opacity": 0.75,
        "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 18, 3],
        "line-dasharray": [3, 2],
      },
    },
    {
      id: "streets-buildings",
      type: "fill-extrusion",
      ...src,
      "source-layer": "building",
      minzoom: 13,
      paint: {
        "fill-extrusion-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], 8],
          0,
          "#181e3c",
          40,
          "#2c2856",
          120,
          "#5b2a6e",
          220,
          "#ff4f9a",
        ],
        "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, 0.88],
      },
    },
  ];
  return layers as unknown as AddLayerObject[];
}

/** Text layers drawn on top of everything (route included). */
export function streetLabelLayers(): AddLayerObject[] {
  const src = { source: "streets" } as const;
  const POI_COLOR = [
    "match",
    ["get", "class"],
    ["restaurant", "fast_food", "cafe", "bar", "beer", "ice_cream", "bakery"],
    "#ffb35c",
    ["shop", "grocery", "clothing_store", "jewelry", "alcohol_shop", "mall"],
    "#ff8fc7",
    ["lodging", "hotel"],
    "#b18cff",
    ["attraction", "museum", "art_gallery", "theatre", "cinema", "music", "monument", "stadium", "zoo", "aquarium"],
    "#25e2d0",
    ["park", "beach", "garden", "golf", "marina"],
    "#6dfc9b",
    "#a7b2dd",
  ];
  const layers = [
    {
      id: "streets-water-name",
      type: "symbol",
      ...src,
      "source-layer": "water_name",
      minzoom: 10,
      layout: { "text-field": NAME, "text-font": ["Inter"], "text-size": 12, "text-letter-spacing": 0.12, "text-max-width": 7 },
      paint: { "text-color": "#7cc8ff", "text-halo-color": "rgba(3,14,26,0.9)", "text-halo-width": 1.2 },
    },
    {
      id: "streets-road-ref",
      type: "symbol",
      ...src,
      "source-layer": "transportation_name",
      minzoom: 10,
      maxzoom: 15,
      filter: ["all", ["has", "ref"], ["match", ["get", "class"], ["motorway", "trunk", "primary"], true, false]],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 420,
        "text-field": ["get", "ref"],
        "text-font": ["Unbounded"],
        "text-size": 10,
        "text-rotation-alignment": "viewport",
      },
      paint: { "text-color": "#ffd08a", "text-halo-color": HALO, "text-halo-width": 2 },
    },
    {
      id: "streets-road-label",
      type: "symbol",
      ...src,
      "source-layer": "transportation_name",
      minzoom: 13,
      filter: ["match", ["get", "class"], ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"], true, false],
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 280,
        "text-field": NAME,
        "text-font": ["Inter"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 16, 12.5, 19, 15],
        "text-letter-spacing": 0.02,
        "text-max-angle": 32,
        "text-padding": 2,
      },
      paint: { "text-color": "#dde2ff", "text-halo-color": HALO, "text-halo-width": 1.6, "text-halo-blur": 0.3 },
    },
    {
      id: "streets-poi-dot",
      type: "circle",
      ...src,
      "source-layer": "poi",
      minzoom: 15,
      filter: ["all", ["has", "name"], ["<=", ["coalesce", ["get", "rank"], 99], 30]],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 15, 2.2, 18, 4],
        "circle-color": POI_COLOR,
        "circle-stroke-color": "#05070f",
        "circle-stroke-width": 1,
      },
    },
    {
      id: "streets-poi-label",
      type: "symbol",
      ...src,
      "source-layer": "poi",
      minzoom: 15,
      filter: ["all", ["has", "name"], ["<=", ["coalesce", ["get", "rank"], 99], 30]],
      layout: {
        "text-field": NAME,
        "text-font": ["Inter"],
        "text-size": 11,
        "text-anchor": "top",
        "text-offset": [0, 0.7],
        "text-max-width": 8,
        "text-optional": true,
      },
      paint: { "text-color": POI_COLOR, "text-halo-color": HALO, "text-halo-width": 1.4 },
    },
    {
      id: "streets-housenumber",
      type: "symbol",
      ...src,
      "source-layer": "housenumber",
      minzoom: 17,
      layout: { "text-field": ["get", "housenumber"], "text-font": ["Inter"], "text-size": 10, "text-padding": 1 },
      paint: { "text-color": "#8a93c4", "text-halo-color": HALO, "text-halo-width": 1 },
    },
    {
      id: "streets-place-hood",
      type: "symbol",
      ...src,
      "source-layer": "place",
      minzoom: 12.5,
      filter: ["match", ["get", "class"], ["suburb", "neighbourhood", "quarter"], true, false],
      layout: {
        "text-field": NAME,
        "text-font": ["Unbounded"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 12.5, 10, 16, 13],
        "text-transform": "uppercase",
        "text-letter-spacing": 0.16,
        "text-max-width": 8,
      },
      paint: { "text-color": "#ffd6f0", "text-opacity": 0.85, "text-halo-color": "rgba(10,6,20,0.9)", "text-halo-width": 1.6 },
    },
    {
      id: "streets-place-city",
      type: "symbol",
      ...src,
      "source-layer": "place",
      minzoom: 9,
      maxzoom: 15,
      filter: ["match", ["get", "class"], ["city", "town", "village"], true, false],
      layout: {
        "text-field": NAME,
        "text-font": ["Unbounded"],
        "text-size": ["interpolate", ["linear"], ["zoom"], 9, ["match", ["get", "class"], "city", 15, "town", 12, 10.5], 14, ["match", ["get", "class"], "city", 22, "town", 17, 14]],
        "text-max-width": 8,
      },
      paint: { "text-color": "#ffffff", "text-halo-color": "rgba(255,79,154,0.35)", "text-halo-width": 2.2, "text-halo-blur": 1.2 },
    },
  ];
  return layers as unknown as AddLayerObject[];
}

type PaintProp = Parameters<MLMap["setPaintProperty"]>[1];
type PaintBackup = [layer: string, prop: PaintProp, value: unknown][];
let backup: PaintBackup = [];

/**
 * Adds the street source and layers. Below street zoom the self-hosted Natural
 * Earth chart still does the work; from ~zoom 10 OpenStreetMap's precise
 * coastline, water and roads take over.
 */
export function addStreetLayers(map: MLMap) {
  if (!STREET_TILES_URL) return false;
  map.addSource("streets", { type: "vector", url: STREET_TILES_URL, attribution: STREET_ATTRIBUTION });
  for (const layer of streetLayers()) map.addLayer(layer, "zones-fill");
  for (const layer of streetLabelLayers()) map.addLayer(layer);
  const fadeOut = (from: number) => ["interpolate", ["linear"], ["zoom"], 9.5, from, 10.5, 0];
  const swaps: PaintBackup = [
    ["background", "background-color", ["interpolate", ["linear"], ["zoom"], 9.5, "#030b18", 10.5, "#10131f"]],
    ["land", "fill-color", ["interpolate", ["linear"], ["zoom"], 9.5, "#111827", 10.5, "#10131f"]],
    ["islands", "fill-color", ["interpolate", ["linear"], ["zoom"], 9.5, "#141d30", 10.5, "#10131f"]],
    ["bathymetry", "raster-opacity", ["interpolate", ["linear"], ["zoom"], 9, 1, 10.5, 0]],
    ["coast-glow", "line-opacity", fadeOut(0.22)],
    ["coast", "line-opacity", fadeOut(0.6)],
    ["lakes", "fill-opacity", fadeOut(1)],
    ["lakes-edge", "line-opacity", fadeOut(0.45)],
    ["rivers", "line-opacity", fadeOut(0.42)],
    ["urban", "fill-opacity", fadeOut(0.06)],
    ["parks", "fill-opacity", fadeOut(0.16)],
    [
      "lights",
      "circle-opacity",
      ["interpolate", ["linear"], ["zoom"], 5, ["*", ["get", "w"], 0.55], 9, ["*", ["get", "w"], 0.9], 11, ["*", ["get", "w"], 0.3], 12.5, 0],
    ],
  ];
  backup = swaps.map(([layer, prop]) => [layer, prop, map.getPaintProperty(layer, prop)]);
  for (const [layer, prop, value] of swaps) map.setPaintProperty(layer, prop, value as never);
  return true;
}

/** Undo addStreetLayers (e.g. the tile host is unreachable). */
export function removeStreetLayers(map: MLMap) {
  for (const layer of [...streetLayers(), ...streetLabelLayers()]) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
  if (map.getSource("streets")) map.removeSource("streets");
  for (const [layer, prop, value] of backup) map.setPaintProperty(layer, prop, value as never);
  backup = [];
}
