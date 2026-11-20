import { test } from "node:test";
import assert from "node:assert/strict";
import { changedPaths, INDEXNOW_KEY } from "../indexnow.mjs";
import { existsSync, readFileSync } from "node:fs";

test("pings only the pages a daily update changed", () => {
  const a = { id: "egg", region: "vice-city", name: "Egg" };
  const b = { id: "ufo", region: "port-gellhorn", name: "UFO" };
  assert.deepEqual(changedPaths(["data/news.json"], [], []), ["/", "/news"]);
  assert.deepEqual(changedPaths(["data/locations.json"], [a], [a, b]).sort(), ["/", "/locations/ufo", "/map", "/regions/port-gellhorn"]);
  assert.deepEqual(changedPaths(["data/locations.json"], [a], [{ ...a, name: "Egg nest" }]).sort(), ["/", "/locations/egg", "/map", "/regions/vice-city"]);
  assert.deepEqual(changedPaths(["README.md"], [a], [a]), []);
});

test("the IndexNow key file is published at the site root", () => {
  const file = `public/${INDEXNOW_KEY}.txt`;
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file, "utf8"), INDEXNOW_KEY);
});
