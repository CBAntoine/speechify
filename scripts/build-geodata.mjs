#!/usr/bin/env node
/**
 * Builds the GTA 6 Secrets Map base map from REAL, openly licensed geography:
 *
 *   • Natural Earth 1:10m vectors (public domain): Florida's coastline, lakes,
 *     rivers, highways, urban footprints, protected lands, reefs and cities.
 *     https://www.naturalearthdata.com/  (fetched from the official GitHub mirror)
 *   • AWS Open Data "Terrain Tiles" (Terrarium encoding): real elevation and
 *     seafloor depth, baked into a bathymetry raster.  https://registry.opendata.aws/terrain-tiles/
 *
 * Leonida is a parody of Florida, so the real state is used as the geographic
 * stand-in. Region boundaries are our approximation of the in-game regions,
 * clipped to the real coastline. Rockstar's in-game map art is NOT used.
 *
 * Outputs (all committed, so builds never need the network):
 *   public/geo/*.geojson          vector layers for MapLibre
 *   public/geo/bathymetry.webp    seafloor/terrain raster
 *   public/geo/preview.webp       static map for SEO pages and previews
 *   data/geo-meta.json            bounds shared by the app
 *
 * Usage: npm run geo:build   (caches downloads in scripts/.cache)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as turf from "@turf/turf";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = resolve(root, "scripts/.cache");
const OUT = resolve(root, "public/geo");
const NE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const TERRARIUM = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

/** Data window: Florida plus a margin of Gulf, Atlantic and neighbouring states. */
const BBOX = [-88.4, 23.9, -78.95, 31.75];
const DEM_ZOOM = 9;

// ── helpers ─────────────────────────────────────────────────────────────────
async function fetchCached(name, url, { binary = false } = {}) {
  const file = resolve(CACHE, name);
  if (existsSync(file)) return binary ? readFile(file) : JSON.parse(await readFile(file, "utf8"));
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(file, buf);
      return binary ? buf : JSON.parse(buf.toString("utf8"));
    } catch (err) {
      if (attempt === 4) throw new Error(`Failed to fetch ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

const ne = (layer) => fetchCached(`${layer}.geojson`, `${NE}/${layer}.geojson`);

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = seeded(19112026);

function clip(features, keep = () => true, box = BBOX) {
  const bboxPoly = turf.bboxPolygon(box);
  const out = [];
  for (const f of features) {
    if (!f.geometry || !keep(f)) continue;
    if (!turf.booleanIntersects(f, bboxPoly)) continue;
    const g = f.geometry.type === "Point" ? f : turf.bboxClip(f, box);
    if (!g.geometry || !g.geometry.coordinates?.length) continue;
    out.push(g);
  }
  return out;
}

function finish(features, { simplify = 0, precision = 4, props = (p) => p } = {}) {
  let fc = turf.featureCollection(features.map((f) => ({ type: "Feature", properties: props(f.properties ?? {}), geometry: f.geometry })));
  if (simplify) fc = turf.simplify(fc, { tolerance: simplify, highQuality: true });
  return turf.truncate(fc, { precision, coordinates: 2 });
}

async function save(name, fc) {
  const json = JSON.stringify(fc);
  await writeFile(resolve(OUT, `${name}.geojson`), json);
  return `${name}: ${fc.features.length} features, ${(json.length / 1024).toFixed(0)} KB`;
}

// Raster window (tile-aligned, slightly larger than BBOX); vectors that frame the
// state are clipped to it so nothing pokes out at the image edge.
const _lon2x = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const _lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const _x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const _y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const IMG_BBOX = [
  _x2lon(Math.floor(_lon2x(BBOX[0], DEM_ZOOM)), DEM_ZOOM),
  _y2lat(Math.floor(_lat2y(BBOX[1], DEM_ZOOM)) + 1, DEM_ZOOM),
  _x2lon(Math.floor(_lon2x(BBOX[2], DEM_ZOOM)) + 1, DEM_ZOOM),
  _y2lat(Math.floor(_lat2y(BBOX[3], DEM_ZOOM)), DEM_ZOOM),
];

// ── 1. states ───────────────────────────────────────────────────────────────
const admin1 = await ne("ne_10m_admin_1_states_provinces");
const isFlorida = (f) => f.properties?.name === "Florida" && f.properties?.adm0_a3 === "USA";
const floridaRaw = admin1.features.find(isFlorida);
if (!floridaRaw) throw new Error("Florida not found in Natural Earth admin-1 data");
const florida = turf.truncate(turf.simplify(floridaRaw, { tolerance: 0.0008, highQuality: true }), { precision: 4 });
const NEIGHBOR_BBOX = [-93.5, 20.5, -74.5, 34.5];
const neighbors = clip(admin1.features, (f) => !isFlorida(f), NEIGHBOR_BBOX);

// ── 2. physical + cultural layers ───────────────────────────────────────────
const inFlorida = (f) => {
  try {
    return turf.booleanIntersects(f, floridaRaw);
  } catch {
    return false;
  }
};
const [lakesA, lakesB, riversA, riversB, roads, urban, parks, reefs, places, islands] = await Promise.all([
  ne("ne_10m_lakes"),
  ne("ne_10m_lakes_north_america"),
  ne("ne_10m_rivers_lake_centerlines"),
  ne("ne_10m_rivers_north_america"),
  ne("ne_10m_roads"),
  ne("ne_10m_urban_areas"),
  ne("ne_10m_parks_and_protected_lands_area"),
  ne("ne_10m_reefs"),
  ne("ne_10m_populated_places_simple"),
  ne("ne_10m_minor_islands"),
]);

const lakesFC = finish(clip([...lakesA.features, ...lakesB.features], inFlorida), { simplify: 0.0006, props: (p) => ({ name: p.name ?? "" }) });
const riversFC = finish(clip([...riversA.features, ...riversB.features]), { simplify: 0.0008, props: (p) => ({ rank: p.scalerank ?? 9 }) });
const roadsFC = finish(clip(roads.features, (f) => f.properties?.type !== "Ferry Route"), {
  simplify: 0.0008,
  props: (p) => ({ kind: p.expressway === 1 || /Major/i.test(p.type ?? "") ? "major" : "minor", rank: p.scalerank ?? 9 }),
});
const urbanFC = finish(clip(urban.features, inFlorida), { simplify: 0.0006, props: (p) => ({ area: Math.round(p.area_sqkm ?? 0) }) });
const parksFC = finish(clip(parks.features, inFlorida), { simplify: 0.0008, props: (p) => ({ name: p.name ?? "", unit: p.unit_type ?? "" }) });
const reefsFC = finish(clip(reefs.features), { simplify: 0.0006, props: () => ({}) });
const islandsFC = finish(clip(islands.features), { simplify: 0.0004, props: () => ({}) });

// City glow: real population, but no real names are shipped to the client.
const floridaPlaces = places.features.filter((f) => turf.booleanPointInPolygon(f, floridaRaw));
const placesFC = turf.featureCollection(
  floridaPlaces.map((f) => turf.point(turf.getCoord(f).map((v) => Math.round(v * 1e4) / 1e4), { pop: f.properties.pop_max ?? 0 })),
);

// ── 3. "night lights": seeded points inside the real urban footprints ───────
const lights = [];
for (const poly of urbanFC.features) {
  const areaKm = turf.area(poly) / 1e6;
  const n = Math.min(320, Math.max(4, Math.round(areaKm * 0.35)));
  const [x0, y0, x1, y1] = turf.bbox(poly);
  let placed = 0;
  let guard = 0;
  while (placed < n && guard++ < n * 40) {
    const pt = [x0 + (x1 - x0) * rand(), y0 + (y1 - y0) * rand()];
    if (!turf.booleanPointInPolygon(pt, poly)) continue;
    lights.push(turf.point(pt.map((v) => Math.round(v * 1e3) / 1e3), { w: Math.round((0.35 + rand() * 0.65) * 10) / 10, c: Math.floor(rand() * 4) }));
    placed++;
  }
}
// Sparse lights along highways: the "light trails" between cities.
for (const road of roadsFC.features) {
  if (road.properties.kind !== "major") continue;
  const len = turf.length(road);
  for (let d = rand() * 8; d < len; d += 8 + rand() * 8) {
    const p = turf.along(road, d);
    lights.push(turf.point(turf.getCoord(p).map((v) => Math.round(v * 1e3) / 1e3), { w: 0.4, c: 3 }));
  }
}
const lightsFC = turf.featureCollection(lights.filter((p) => turf.booleanPointInPolygon(p, floridaRaw)));

// ── 4. Leonida regions, derived from real features ─────────────────────────
// Each official region is matched to the real place it parodies and shaped from
// real data: the Everglades/Big Cypress boundary, the Miami metro footprint, the
// Keys islands, the sugar country around Lake Okeechobee. The two northern
// regions use smoothed hand-drawn boundaries clipped to the real coast.
const fc = (...features) => turf.featureCollection(features.filter(Boolean));
const buffer = (f, km) => turf.buffer(f, km, { units: "kilometers" });
const unionAll = (features) => features.reduce((acc, f) => (acc ? turf.union(fc(acc, f)) ?? acc : f), null);
const intersect = (a, b) => (a && b ? turf.intersect(fc(a, b)) : null);
const minus = (a, ...bs) => bs.reduce((acc, b) => (acc && b ? turf.difference(fc(acc, b)) ?? acc : acc), a);
const centroidOf = (f) => turf.getCoord(turf.centroid(f));
function chaikin(ring, iterations = 3) {
  let pts = ring;
  for (let k = 0; k < iterations; k++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = out;
  }
  return turf.polygon([[...pts, pts[0]]]);
}

const keysIslands = [
  ...islands.features,
  ...turf.flatten(floridaRaw).features,
].filter((f) => {
  const [x, y] = centroidOf(f);
  return y < 25.36 && x < -80.2 && x > -82.4 && turf.area(f) < 5e8;
});
const land = unionAll([floridaRaw, ...keysIslands.map((f) => buffer(f, 0.2))]);

const viceUrban = urbanFC.features.filter((f) => {
  const [x, y] = centroidOf(f);
  return x > -80.55 && y > 25.38 && y < 26.4;
});
const viceCity = unionAll(viceUrban.map((f) => buffer(f, 2.2)));
const keys = minus(unionAll(keysIslands.map((f) => buffer(f, 3.2))), viceCity);
const glades = parksFC.features.filter((f) => /Everglades|Big Cypress/i.test(f.properties.name));
const grassrivers = minus(intersect(unionAll(glades.map((f) => buffer(f, 7))), land), viceCity, keys);
const okeechobee = lakesFC.features.find((f) => /Okeechobee/i.test(f.properties.name)) ?? lakesFC.features[0];
const ambrosia = minus(intersect(buffer(okeechobee, 30), land), viceCity, grassrivers);
const portGellhorn = intersect(
  chaikin([[-87.8, 31.25], [-85.1, 31.25], [-84.85, 30.92], [-84.98, 30.52], [-84.76, 30.12], [-84.92, 29.55], [-86.5, 29.7], [-87.8, 29.95]]),
  land,
);
const mountKalaga = intersect(
  chaikin([[-84.85, 31.25], [-82.25, 31.25], [-82.05, 30.62], [-82.32, 30.02], [-82.92, 29.48], [-83.62, 29.68], [-84.32, 29.9], [-84.76, 30.12], [-84.98, 30.52], [-84.85, 30.92]]),
  land,
);
const REGION_SHAPES = {
  "vice-city": viceCity,
  "leonida-keys": keys,
  grassrivers,
  ambrosia,
  "port-gellhorn": portGellhorn,
  "mount-kalaga": mountKalaga,
};
const regionsJson = JSON.parse(await readFile(resolve(root, "data/regions.json"), "utf8"));
const regionFeatures = [];
const regionBounds = {};
for (const r of regionsJson) {
  const shape = REGION_SHAPES[r.id];
  if (!shape) continue;
  const clean = turf.truncate(turf.simplify(shape, { tolerance: 0.0006, highQuality: true }), { precision: 4 });
  regionBounds[r.id] = turf.bbox(clean).map((v) => Math.round(v * 1e3) / 1e3);
  regionFeatures.push({ type: "Feature", properties: { id: r.id, name: r.name, color: r.color }, geometry: clean.geometry });
}
const regionsFC = turf.featureCollection(regionFeatures);

// ── 5. chart grid (A–J × 1–10) over the state ───────────────────────────────
const GRID = { west: -87.75, east: -79.85, north: 31.1, south: 24.35, cols: 10, rows: 10 };
const gridLines = [];
for (let i = 0; i <= GRID.cols; i++) {
  const x = GRID.west + ((GRID.east - GRID.west) * i) / GRID.cols;
  gridLines.push(turf.lineString([[x, GRID.north], [x, GRID.south]]));
}
for (let j = 0; j <= GRID.rows; j++) {
  const y = GRID.north - ((GRID.north - GRID.south) * j) / GRID.rows;
  gridLines.push(turf.lineString([[GRID.west, y], [GRID.east, y]]));
}
const gridFC = turf.truncate(turf.featureCollection(gridLines), { precision: 4 });

// ── 6. bathymetry raster from Terrarium elevation tiles ─────────────────────
const lon2x = (lng, z) => ((lng + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};
const tx0 = Math.floor(lon2x(BBOX[0], DEM_ZOOM));
const tx1 = Math.floor(lon2x(BBOX[2], DEM_ZOOM));
const ty0 = Math.floor(lat2y(BBOX[3], DEM_ZOOM));
const ty1 = Math.floor(lat2y(BBOX[1], DEM_ZOOM));
const cols = tx1 - tx0 + 1;
const rows = ty1 - ty0 + 1;
const W = cols * 256;
const H = rows * 256;
const elev = new Float32Array(W * H);
let fetched = 0;
const tiles = [];
for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) tiles.push([tx, ty]);
for (let i = 0; i < tiles.length; i += 12) {
  await Promise.all(
    tiles.slice(i, i + 12).map(async ([tx, ty]) => {
      const png = await fetchCached(`terrarium-${DEM_ZOOM}-${tx}-${ty}.png`, `${TERRARIUM}/${DEM_ZOOM}/${tx}/${ty}.png`, { binary: true });
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const ox = (tx - tx0) * 256;
      const oy = (ty - ty0) * 256;
      for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
          const k = (y * info.width + x) * 4;
          elev[(oy + y) * W + ox + x] = data[k] * 256 + data[k + 1] + data[k + 2] / 256 - 32768;
        }
      }
      fetched++;
    }),
  );
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const OCEAN = [
  [0, [20, 92, 118]],
  [6, [14, 70, 98]],
  [25, [11, 52, 82]],
  [80, [8, 38, 66]],
  [250, [6, 28, 52]],
  [1000, [5, 18, 38]],
  [3000, [3, 11, 25]],
  [6000, [2, 7, 17]],
];
const CONTOURS = [10, 30, 60, 120, 200, 500, 1000, 2000, 3000, 4000];
const band = (d) => CONTOURS.findIndex((c) => d < c);
function oceanColor(depth) {
  for (let i = 1; i < OCEAN.length; i++) {
    if (depth <= OCEAN[i][0]) {
      const t = (depth - OCEAN[i - 1][0]) / (OCEAN[i][0] - OCEAN[i - 1][0]);
      return mix(OCEAN[i - 1][1], OCEAN[i][1], t);
    }
  }
  return OCEAN[OCEAN.length - 1][1];
}
const rgba = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const e = elev[i];
    let c;
    if (e < 0) {
      const d = -e;
      c = oceanColor(d);
      // faint nautical contour lines where the depth band changes
      const right = x + 1 < W ? -elev[i + 1] : d;
      const down = y + 1 < H ? -elev[i + W] : d;
      if (band(d) !== band(right) || band(d) !== band(down)) c = mix(c, [90, 200, 230], d < 200 ? 0.22 : 0.14);
    } else {
      // land: dark slate with a soft hillshade from the real DEM
      const ex = (x + 1 < W ? elev[i + 1] : e) - (x > 0 ? elev[i - 1] : e);
      const ey = (y + 1 < H ? elev[i + W] : e) - (y > 0 ? elev[i - W] : e);
      const shade = Math.max(-1, Math.min(1, (-ex - ey) * 0.015));
      const base = [16, 22, 36];
      c = shade > 0 ? mix(base, [44, 54, 78], shade) : mix(base, [6, 8, 14], -shade);
    }
    rgba[i * 4] = c[0];
    rgba[i * 4 + 1] = c[1];
    rgba[i * 4 + 2] = c[2];
    // feather the outer 6% so the raster melts into the map background
    const edge = Math.min(x / W, (W - 1 - x) / W, (y / H) * (W / H), ((H - 1 - y) / H) * (W / H));
    const t = Math.min(1, edge / 0.06);
    rgba[i * 4 + 3] = Math.round(255 * t * t * (3 - 2 * t));
  }
}
const imageBounds = { west: x2lon(tx0, DEM_ZOOM), east: x2lon(tx1 + 1, DEM_ZOOM), north: y2lat(ty0, DEM_ZOOM), south: y2lat(ty1 + 1, DEM_ZOOM) };

// ── 7. write outputs ────────────────────────────────────────────────────────
await mkdir(OUT, { recursive: true });
const report = [];
report.push(await save("florida", turf.featureCollection([{ ...florida, properties: { name: "Leonida" } }])));
report.push(await save("neighbors", finish(neighbors, { simplify: 0.002, precision: 3, props: () => ({}) })));
report.push(await save("lakes", lakesFC));
report.push(await save("rivers", riversFC));
report.push(await save("roads", roadsFC));
report.push(await save("urban", urbanFC));
report.push(await save("parks", parksFC));
if (reefsFC.features.length) report.push(await save("reefs", reefsFC));
report.push(await save("islands", islandsFC));
report.push(await save("places", placesFC));
report.push(await save("lights", lightsFC));
report.push(await save("regions", regionsFC));
report.push(await save("grid", gridFC));

await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .webp({ quality: 82, effort: 6 })
  .toFile(resolve(OUT, "bathymetry.webp"));
report.push(`bathymetry.webp: ${W}×${H} from ${fetched} Terrarium tiles at z${DEM_ZOOM}`);

// ── 8. static preview (bathymetry + vectors) for SEO pages ──────────────────
const PW = 1600;
const PH = Math.round(PW * (H / W));
const mx0 = lon2x(imageBounds.west, 0);
const mx1 = lon2x(imageBounds.east, 0);
const my0 = lat2y(imageBounds.north, 0);
const my1 = lat2y(imageBounds.south, 0);
const px = ([lng, lat]) => [((lon2x(lng, 0) - mx0) / (mx1 - mx0)) * PW, ((lat2y(lat, 0) - my0) / (my1 - my0)) * PH];
const ring = (coords) => "M" + coords.map((c) => px(c).map((v) => v.toFixed(1)).join(" ")).join("L") + "Z";
const polyPath = (g) =>
  g.type === "Polygon" ? g.coordinates.map(ring).join("") : g.type === "MultiPolygon" ? g.coordinates.flatMap((p) => p.map(ring)).join("") : "";
const linePath = (g) => {
  const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
  return lines.map((l) => "M" + l.map((c) => px(c).map((v) => v.toFixed(1)).join(" ")).join("L")).join("");
};
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}">
  <path d="${neighbors.map((f) => polyPath(f.geometry)).join("")}" fill="#0b0f19" fill-opacity="0.9"/>
  <path d="${polyPath(florida.geometry)}${islandsFC.features.map((f) => polyPath(f.geometry)).join("")}" fill="#121a2b" stroke="#5ee7f0" stroke-opacity="0.55" stroke-width="1.2"/>
  <path d="${parksFC.features.map((f) => polyPath(f.geometry)).join("")}" fill="#2a8a55" fill-opacity="0.16"/>
  ${regionsFC.features.map((f) => `<path d="${polyPath(f.geometry)}" fill="${f.properties.color}" fill-opacity="0.09" stroke="${f.properties.color}" stroke-opacity="0.45" stroke-width="1.4" stroke-dasharray="5 6"/>`).join("")}
  <path d="${lakesFC.features.map((f) => polyPath(f.geometry)).join("")}" fill="#0d3554" stroke="#47c4e6" stroke-opacity="0.5"/>
  <path d="${roadsFC.features.filter((f) => f.properties.kind === "major").map((f) => linePath(f.geometry)).join("")}" fill="none" stroke="#ffb35c" stroke-opacity="0.35" stroke-width="1.4"/>
  ${urbanFC.features.map((f) => `<path d="${polyPath(f.geometry)}" fill="#ff8fc7" fill-opacity="0.5"/>`).join("")}
</svg>`;
const previewSvg = await sharp(Buffer.from(svg)).png().toBuffer();
await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
  .resize(PW, PH)
  .flatten({ background: "#030b18" })
  .composite([{ input: previewSvg }])
  .webp({ quality: 80 })
  .toFile(resolve(OUT, "preview.webp"));
report.push(`preview.webp: ${PW}×${PH}`);

const meta = {
  generatedAt: new Date().toISOString().slice(0, 10),
  bbox: BBOX,
  imageBounds,
  preview: { width: PW, height: PH },
  grid: GRID,
  regionBounds,
  home: { west: -87.7, south: 24.35, east: -79.85, north: 31.05 },
  attribution: [
    "Natural Earth (public domain)",
    "Seafloor & terrain: AWS Terrain Tiles (ETOPO1, SRTM, GMTED; Mapzen/AWS Open Data)",
  ],
};
await writeFile(resolve(root, "data/geo-meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(report.join("\n"));
