import { test } from "node:test";
import assert from "node:assert/strict";
import { atempoChain, buildTrack, composeGraph, facecamCrop, gameCropSize, simplify, splitHeights, trackExpr } from "../src/server/pipeline/layout.ts";

test("split panels add up to 1920 and are even", () => {
  const { top, bottom } = splitHeights(0.42);
  assert.equal(top + bottom, 1920);
  assert.equal(top % 2, 0);
});

test("the facecam crop has the panel's aspect and stays inside the cam", () => {
  const cam = { x: 0.02, y: 0.54, w: 0.3, h: 0.42 };
  const faces = [{ x: 0.11, y: 0.63, w: 0.08, h: 0.14 }];
  const aspect = 1080 / splitHeights(0.42).top;
  const c = facecamCrop(cam, faces, aspect, 1280, 720);
  assert.ok(Math.abs((c.w * 1280) / (c.h * 720) - aspect) < 0.01);
  assert.ok(c.x >= cam.x - 1e-6 && c.x + c.w <= cam.x + cam.w + 1e-6);
  assert.ok(c.y >= cam.y - 1e-6 && c.y + c.h <= cam.y + cam.h + 1e-6);
  // The face is inside the crop.
  assert.ok(faces[0].x >= c.x && faces[0].x + faces[0].w <= c.x + c.w);
});

test("game crops: full height, panel aspect", () => {
  const crop = gameCropSize("crop", 1920, 1080, 0.42);
  assert.equal(crop.h, 1);
  assert.ok(Math.abs(crop.w - (1080 * 9) / 16 / 1920) < 1e-9);
  const split = gameCropSize("split", 1920, 1080, 0.42);
  assert.ok(split.w > crop.w);
});

test("the virtual camera keeps clear of the facecam and respects the speed limit", () => {
  const crop = gameCropSize("split", 1280, 720, 0.42);
  const cam = { x: 0.02, y: 0.54, w: 0.32, h: 0.42 };
  const points = Array.from({ length: 30 }, (_, i) => ({ t: 10 + i / 3, cx: 0.2, cy: 0.5 }));
  const keys = buildTrack(points, [[10, 20]], crop, { avoid: cam });
  for (const k of keys) assert.ok(k.cx - crop.w / 2 >= cam.x + cam.w, `crop at ${k.cx} overlaps the cam`);
  const moving = Array.from({ length: 30 }, (_, i) => ({ t: i / 3, cx: i < 15 ? 0.3 : 0.7, cy: 0.5 }));
  const k2 = buildTrack(moving, [[0, 10]], gameCropSize("crop", 1920, 1080, 0.42), { maxSpeed: 0.2 });
  for (let i = 1; i < k2.length; i++) {
    const v = Math.abs(k2[i].cx - k2[i - 1].cx) / Math.max(1e-3, k2[i].t - k2[i - 1].t);
    assert.ok(v <= 0.2 + 1e-6, `pan speed ${v}`);
  }
});

test("tracks are mapped onto the output timeline and simplified", () => {
  const keys = buildTrack(
    [
      { t: 5, cx: 0.5, cy: 0.5 },
      { t: 9, cx: 0.5, cy: 0.5 },
    ],
    [
      [4, 6],
      [8, 10],
    ],
    { w: 0.3, h: 1 },
  );
  assert.equal(keys[0].t, 0);
  assert.equal(keys[keys.length - 1].t, 4);
  const many = Array.from({ length: 200 }, (_, i) => ({ t: i * 0.1, cx: 0.5 + 0.2 * Math.sin(i / 7), cy: 0.5 }));
  assert.ok(simplify(many, 0.001, 48).length <= 48);
});

test("trackExpr builds a piecewise-linear expression in pixels", () => {
  const e = trackExpr(
    [
      { t: 0, cx: 0.5, cy: 0.5 },
      { t: 2, cx: 0.6, cy: 0.5 },
    ],
    "x",
    608,
    1920,
  );
  assert.equal(e, "if(lt(t,2.000),656+(192)*(t-0.000)/2.000,848)");
  assert.equal(trackExpr([{ t: 0, cx: 0.5, cy: 0.5 }], "x", 608, 1920), "656");
});

test("composeGraph cuts dead air, stacks the panels and keeps audio in sync", () => {
  const g = composeGraph({
    kind: "split",
    srcW: 1280,
    srcH: 720,
    facecamShare: 0.42,
    facecam: { x: 0.02, y: 0.55, w: 0.28, h: 0.37 },
    crop: gameCropSize("split", 1280, 720, 0.42),
    track: [{ t: 0, cx: 0.6, cy: 0.5 }],
    segments: [
      [0, 4],
      [5, 9],
    ],
    sharpen: false,
    audioIn: "1:a",
    fps: 30,
  });
  assert.match(g, /\[0:v\]split=2\[vs0\]\[vs1\]/);
  assert.match(g, /\[1:a\]asplit=2\[as0\]\[as1\]/);
  assert.match(g, /concat=n=2:v=1:a=1\[vc\]\[ac\]/);
  assert.match(g, /vstack=inputs=2/);
  assert.match(g, /scale=1080:806/);
  assert.match(g, /\[lay\]format=yuv420p\[v\]/);
  assert.match(g, /\[ac\]anull\[a\]/);
});

test("atempo is chained to stay within 0.5–2", () => {
  assert.equal(atempoChain(0.35), "atempo=0.5,atempo=0.7");
  assert.equal(atempoChain(1.2), "atempo=1.2");
  assert.equal(atempoChain(3), "atempo=2,atempo=1.5");
});
