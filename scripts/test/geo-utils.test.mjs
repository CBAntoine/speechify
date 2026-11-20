import { test } from "node:test";
import assert from "node:assert/strict";
import { directRoute, formatDistance, formatDuration, fromNominatim, fromOsrm, haversineM, inFlorida, instruction, parseLngLat } from "../../src/lib/geo-utils.ts";

// Shape of a real OSRM /route/v1 answer (overview=full, geometries=geojson, steps=true).
const OSRM = {
  code: "Ok",
  routes: [
    {
      distance: 3210.4,
      duration: 412.7,
      geometry: { coordinates: [[-80.19011, 25.77401], [-80.18922, 25.77512], [-80.18501, 25.78013], [-80.13002, 25.78221]] },
      legs: [
        {
          steps: [
            { name: "Brickell Avenue", distance: 410, duration: 60, maneuver: { type: "depart", location: [-80.19011, 25.77401] } },
            { name: "", ref: "I 395", distance: 2400, duration: 300, maneuver: { type: "on ramp", modifier: "slight right", location: [-80.18922, 25.77512] } },
            { name: "MacArthur Causeway", ref: "I 395;FL A1A", distance: 400, duration: 52, maneuver: { type: "merge", modifier: "slight left", location: [-80.18501, 25.78013] } },
            { name: "", distance: 0, duration: 0, maneuver: { type: "arrive", location: [-80.13002, 25.78221] } },
          ],
        },
      ],
    },
  ],
};

test("turns an OSRM answer into a drawable route with spoken steps", () => {
  const r = fromOsrm(OSRM, "driving");
  assert.ok(r);
  assert.equal(r.approximate, false);
  assert.equal(r.distanceM, 3210);
  assert.equal(r.durationS, 413);
  assert.equal(r.coords.length, 4);
  assert.deepEqual(
    r.steps.map((s) => s.text),
    ["Head out on Brickell Avenue", "Take the ramp onto I 395", "Merge slight left onto MacArthur Causeway (I 395)", "Arrive at your destination"],
  );
  assert.equal(r.via[0], "I 395");
});

test("rejects router errors", () => {
  assert.equal(fromOsrm({ code: "NoRoute" }, "driving"), null);
});

test("straight-line fallback is flagged and estimates time", () => {
  const r = directRoute([-80.19, 25.77], [-80.13, 25.78], "walking");
  assert.equal(r.approximate, true);
  assert.equal(r.provider, "direct");
  assert.ok(r.coords.length >= 2);
  assert.ok(r.durationS > 3600, "6 km on foot takes over an hour");
});

test("roundabouts and U-turns read naturally", () => {
  assert.equal(instruction({ distance: 1, duration: 1, name: "Ocean Dr", maneuver: { type: "roundabout", exit: 2, location: [0, 0] } }), "At the roundabout, take exit 2 onto Ocean Dr");
  assert.equal(instruction({ distance: 1, duration: 1, name: "", maneuver: { type: "turn", modifier: "uturn", location: [0, 0] } }), "Make a U-turn");
});

test("units, bounds and parsing", () => {
  assert.equal(formatDistance(30), "100 ft");
  assert.equal(formatDistance(1609.344 * 2.25), "2.3 mi");
  assert.equal(formatDistance(1609.344 * 42), "42 mi");
  assert.equal(formatDuration(59 * 60), "59 min");
  assert.equal(formatDuration(125 * 60), "2 h 5 min");
  assert.ok(Math.abs(haversineM([-80.19, 25.77], [-80.13, 25.78]) - 6111) < 60);
  assert.ok(inFlorida([-80.19, 25.77]));
  assert.ok(!inFlorida([-74, 40.7]));
  assert.deepEqual(parseLngLat("-80.191234567,25.77"), [-80.19123, 25.77]);
  assert.equal(parseLngLat("abc"), null);
  assert.equal(parseLngLat("200,10"), null);
});

// Recorded 2026-11-20 from routing.openstreetmap.de (Downtown Miami → Ocean Drive),
// trimmed to the fields we read: same names, refs, maneuvers and distances.
const REAL_OSRM = {
  code: "Ok",
  routes: [
    {
      distance: 8971.7,
      duration: 717.1,
      geometry: { coordinates: [[-80.191796, 25.77421], [-80.192285, 25.783832], [-80.179282, 25.787327], [-80.141841, 25.774354], [-80.13028, 25.78205]] },
      legs: [
        {
          steps: [
            { name: "East Flagler Street", distance: 12.9, duration: 5.3, maneuver: { type: "depart", modifier: "right", location: [-80.191796, 25.77421] } },
            { name: "Northeast 1st Avenue", distance: 1067, duration: 93.7, maneuver: { type: "turn", modifier: "right", location: [-80.191925, 25.774206] } },
            { name: "Northeast 10th Street", distance: 273.1, duration: 28.6, maneuver: { type: "turn", modifier: "right", location: [-80.192285, 25.783832] } },
            { name: "Biscayne Boulevard", ref: "US 1", distance: 215.8, duration: 28.9, maneuver: { type: "turn", modifier: "left", location: [-80.189565, 25.783929] } },
            { name: "", distance: 283.3, duration: 19.9, maneuver: { type: "on ramp", modifier: "right", location: [-80.189068, 25.78567] } },
            { name: "", ref: "I 395", distance: 738.1, duration: 44.4, maneuver: { type: "merge", modifier: "slight left", location: [-80.18662, 25.786903] } },
            { name: "MacArthur Causeway", ref: "SR A1A", destinations: "SR A1A: Miami Beach", distance: 4358, duration: 285.5, maneuver: { type: "fork", modifier: "slight right", location: [-80.179282, 25.787327] } },
            { name: "5th Street", ref: "SR A1A", destinations: "SR A1A North: Beaches", distance: 764, duration: 73.1, maneuver: { type: "new name", modifier: "straight", location: [-80.141841, 25.774354] } },
            { name: "Washington Avenue", distance: 973.8, duration: 99.6, maneuver: { type: "turn", modifier: "left", location: [-80.134241, 25.774447] } },
            { name: "12th Street", distance: 215.1, duration: 28.3, maneuver: { type: "turn", modifier: "right", location: [-80.132258, 25.78297] } },
            { name: "Ocean Drive", distance: 70.6, duration: 9.8, maneuver: { type: "end of road", modifier: "right", location: [-80.130143, 25.782675] } },
            { name: "Ocean Drive", distance: 0, duration: 0, maneuver: { type: "arrive", modifier: "left", location: [-80.13028, 25.78205] } },
          ],
        },
      ],
    },
  ],
};

test("reads a real public-router answer into spoken directions", () => {
  const r = fromOsrm(REAL_OSRM, "driving");
  assert.equal(formatDistance(r.distanceM), "5.6 mi");
  assert.equal(formatDuration(r.durationS), "12 min");
  assert.deepEqual(r.via, ["MacArthur Causeway (SR A1A)", "Northeast 1st Avenue", "Washington Avenue"]);
  assert.deepEqual(r.steps.map((s) => s.text), [
    "Head out on East Flagler Street",
    "Turn right onto Northeast 1st Avenue",
    "Turn right onto Northeast 10th Street",
    "Turn left onto Biscayne Boulevard (US 1)",
    "Take the ramp",
    "Merge slight left onto I 395",
    "Keep right at the fork onto MacArthur Causeway (SR A1A)",
    "Continue on 5th Street (SR A1A)",
    "Turn left onto Washington Avenue",
    "Turn right onto 12th Street",
    "Turn right onto Ocean Drive",
    "Arrive at your destination",
  ]);
});

test("reads a real place-search answer (Nominatim jsonv2)", () => {
  // Recorded 2026-11-20 from nominatim.openstreetmap.org for "Ocean Drive, Miami Beach".
  const [hit] = fromNominatim([
    {
      lat: "25.7702050",
      lon: "-80.1329055",
      category: "highway",
      type: "tertiary",
      name: "Ocean Drive",
      display_name: "Ocean Drive, South Beach, Miami Beach, Miami-Dade County, Florida, 33139, United States",
      address: { road: "Ocean Drive", neighbourhood: "South Beach", city: "Miami Beach", county: "Miami-Dade County", state: "Florida" },
      boundingbox: ["25.7695918", "25.7708183", "-80.1330426", "-80.1327694"],
    },
  ]);
  assert.equal(hit.label, "Ocean Drive, South Beach, Miami Beach");
  assert.equal(hit.kind, "tertiary");
  assert.deepEqual(hit.bbox, [-80.1330426, 25.7695918, -80.1327694, 25.7708183]);
  assert.ok(inFlorida([hit.lng, hit.lat]));
});
