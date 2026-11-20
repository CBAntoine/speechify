import { test } from "node:test";
import assert from "node:assert/strict";
import { directRoute, formatDistance, formatDuration, fromOsrm, haversineM, inFlorida, instruction, parseLngLat } from "../../src/lib/geo-utils.ts";

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
