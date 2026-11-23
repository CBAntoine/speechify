import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Word } from "../src/lib/types.ts";
import { assColor, buildAss } from "../src/server/pipeline/ass.ts";
import { bleepSpans, editPlan, isProfane, maskWord, planPunches, storyTime, stressedWords, teaserTrack, ZOOM } from "../src/server/pipeline/edit.ts";
import { refineBounds } from "../src/server/pipeline/heuristics.ts";
import { composeGraph, sourceColor } from "../src/server/pipeline/layout.ts";
import { coldOpen, spliceWindows, unsplice } from "../src/server/pipeline/moment.ts";
import { RATE, renderCues, writeWav } from "../src/server/pipeline/sfx.ts";
import { x264Args } from "../src/server/pipeline/ship.ts";

const words = (text: string, start: number, step = 0.3): Word[] => text.split(" ").map((w, i) => ({ w, s: start + i * step, e: start + i * step + step * 0.9 }));

test("the edit plan opens on the payoff, then plays the story", () => {
  const short = { start: 100, end: 130, keep: [[100, 110], [112, 130]] as [number, number][], teaser: [124, 126] as [number, number] };
  const plan = editPlan(short);
  assert.equal(plan.teaser, 2);
  assert.equal(plan.main, 28);
  assert.equal(plan.body, 30);
  assert.deepEqual(plan.segs[0], { a: 124, b: 126, at: 0, teaser: true });
  assert.deepEqual(plan.segs.map((s) => s.at), [0, 2, 12]);
  assert.equal(editPlan({ ...short, teaser: undefined }).teaser, 0);
  assert.equal(editPlan({ ...short, teaser: [124, 124.4] }).teaser, 0, "too short to land");
  assert.equal(storyTime(short.keep, 113), 11);
  assert.equal(storyTime(short.keep, 111), null, "cut as dead air");
});

test("a cold open must come from late in the clip and fit inside it", () => {
  assert.deepEqual(coldOpen([27, 25], 0, 30), [25, 27]);
  assert.equal(coldOpen([2, 4], 0, 30), undefined);
  assert.equal(coldOpen([29.5, 31], 0, 30), undefined);
  assert.deepEqual(coldOpen([20, 26], 0, 30), [20, 23.5], "capped at 3.5 s");
});

test("during the cold open the camera does what it will do then, and cuts back after", () => {
  const short = { start: 100, end: 130, keep: [[100, 110], [112, 130]] as [number, number][], teaser: [124, 126] as [number, number] };
  const plan = editPlan(short);
  const track = [
    { t: 0, cx: 0.3, cy: 0.5 },
    { t: 28, cx: 0.7, cy: 0.5 },
  ];
  const keys = teaserTrack(track, plan, short.keep);
  // 124 s is 22 s into the story.
  assert.ok(Math.abs(keys[0].cx - (0.3 + (0.4 * 22) / 28)) < 1e-3);
  const back = keys.find((k) => k.t === 2);
  assert.equal(back?.cx, 0.3, "hard cut back to the start of the story");
  assert.equal(keys[keys.length - 1].t, 30);
  assert.deepEqual(teaserTrack(track, editPlan({ ...short, teaser: undefined }), short.keep), track);
});

test("punch-ins land on the payoff and loud reactions, spaced out, never at the very start", () => {
  const keep: [number, number][] = [[0, 30]];
  const tenths = new Array(300).fill(-30);
  tenths[8] = -5; // loud, but in the first 1.5 s
  tenths[120] = -8;
  tenths[121] = -10;
  tenths[200] = -6;
  const ws: Word[] = [
    { w: "hey", s: 0.6, e: 1.0 },
    { w: "NO", s: 11.8, e: 12.3 },
    { w: "WAY", s: 12.3, e: 12.6 },
    { w: "run", s: 19.7, e: 20.2 },
  ];
  const plan = editPlan({ start: 0, end: 30, keep });
  const punches = planPunches({ plan, keep, layout: "split", climax: 25, tenths, words: ws });
  assert.deepEqual(
    punches.map((p) => [p.why, p.panel]),
    [
      ["reaction", "cam"],
      ["reaction", "cam"],
      ["payoff", "game"],
    ],
  );
  assert.ok(Math.abs(punches[0].s - 11.8) < 0.01);
  assert.equal(punches[2].zoom, ZOOM.game);
  for (const p of punches) assert.ok(p.s >= 1.5 && p.e - p.s >= 0.6 && p.e <= 30);
  // Without a facecam the whole frame zooms; a cold open shifts everything later.
  const teased = editPlan({ start: 0, end: 30, keep, teaser: [24.5, 26.5] });
  const later = planPunches({ plan: teased, keep, layout: "crop", climax: 25, tenths, words: ws });
  assert.ok(later.every((p) => p.panel === "all"));
  assert.ok(Math.abs(later[0].s - (11.8 + 2)) < 0.01);
  assert.deepEqual(planPunches({ plan, keep, layout: "fit", climax: 25, tenths, words: ws }), []);
});

test("stressed words: the orchestrator's phrases in order, else numbers and power words", () => {
  const ws = words("no way that was the way he did it no", 0);
  assert.deepEqual([...stressedWords(ws, ["no way"])].sort((a, b) => a - b), [0, 1]);
  const plain = words("we made 100 dollars that was insane", 0);
  assert.deepEqual([...stressedWords(plain)].sort((a, b) => a - b), [2, 6]);
});

test("swearing is masked in captions and bleeped as one span", () => {
  assert.ok(isProfane("Fuck!"));
  assert.ok(isProfane("shitty"));
  for (const w of ["Dickens", "class", "hello", "assume"]) assert.ok(!isProfane(w), w);
  assert.equal(maskWord("fucking!"), "f******!");
  const spans = bleepSpans([
    { w: "what", s: 0, e: 0.3 },
    { w: "the", s: 0.3, e: 0.5 },
    { w: "fuck", s: 0.5, e: 0.9 },
    { w: "shit", s: 0.92, e: 1.2 },
  ]);
  assert.equal(spans.length, 1);
  assert.ok(Math.abs(spans[0][0] - 0.47) < 1e-9 && Math.abs(spans[0][1] - 1.23) < 1e-9);
});

test("cut points snap to whole sentences", () => {
  const ws = [...words("Okay so here's the plan.", 10, 0.5), ...words("We go in fast and grab the bag.", 13, 0.4), ...words("No way!", 30, 0.4), ...words("That was insane, chat.", 31, 0.5)];
  const b = refineBounds(11.0, 31.5, { words: ws, cuts: [], duration: 100, minSec: 10, maxSec: 40 });
  assert.equal(b.start, 9.85);
  assert.equal(b.end, 33.3);
});

test("the second caption pass maps words back and keeps speaker labels", () => {
  const splices = spliceWindows([
    [10, 20],
    [50, 60],
    [19, 25],
  ]);
  assert.deepEqual(splices, [
    { src: 10, out: 0, len: 15 },
    { src: 50, out: 16.5, len: 10 },
  ]);
  const fresh: Word[] = [
    { w: "hello", s: 1, e: 1.5 },
    { w: "world", s: 17, e: 17.4 },
  ];
  const old: Word[] = [
    { w: "helo", s: 11.02, e: 11.5, sp: 1 },
    { w: "outside", s: 30, e: 30.5 },
  ];
  const { words: out, spans } = unsplice(fresh, splices, old);
  assert.deepEqual(
    out.map((w) => [w.w, w.s, w.sp]),
    [
      ["hello", 11, 1],
      ["outside", 30, undefined],
      ["world", 50.5, undefined],
    ],
  );
  assert.equal(spans.length, 2);
});

test("captions: stressed words lit, a title box, a progress bar", () => {
  const ws: Word[] = [
    { w: "that", s: 3, e: 3.3 },
    { w: "was", s: 3.3, e: 3.5 },
    { w: "insane", s: 3.5, e: 4, em: true },
  ];
  const ass = buildAss({
    words: ws,
    duration: 10,
    style: "pop",
    width: 1080,
    height: 1920,
    captionY: 1300,
    hookY: 500,
    font: "Anton",
    accent: "#c8ff3d",
    stress: "#ffd426",
    title: { text: "He trusted the wrong driver", from: 0, to: 10, y: 106 },
    progress: { color: "#c8ff3d" },
  });
  const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
  assert.ok(events.some((l) => l.includes(",Title,") && l.includes("HE TRUSTED THE\\NWRONG DRIVER")), "two balanced lines");
  assert.ok(events.some((l) => l.includes("\\fscx0\\t(0,10000,\\fscx100)") && l.includes("\\p1")));
  // "INSANE" is lit while "THAT" is being said, and pops harder when it's said.
  const first = events.find((l) => l.includes("0:00:03.00"))!;
  assert.ok(first.includes(`{\\c${assColor("#ffd426")}}INSANE`));
  assert.ok(events.some((l) => l.includes("\\fscx124") && l.includes("INSANE")));
});

test("composeGraph: cold open first, punch-ins per panel, a flash, BT.601 → BT.709", () => {
  const spec = {
    kind: "split" as const,
    srcW: 1280,
    srcH: 720,
    facecamShare: 0.42,
    facecam: { x: 0.02, y: 0.55, w: 0.28, h: 0.37 },
    crop: { w: 0.545, h: 1 },
    track: [
      { t: 0, cx: 0.6, cy: 0.5 },
      { t: 8, cx: 0.7, cy: 0.5 },
    ],
    segments: [
      [5, 7],
      [0, 3],
      [3.5, 6],
    ] as [number, number][],
    sharpen: false,
    audioIn: "1:a",
    fps: 30,
    zooms: [
      { s: 3, e: 4.2, panel: "cam" as const, zoom: 1.22, why: "reaction" },
      { s: 5.5, e: 7, panel: "game" as const, zoom: 1.15, why: "payoff" },
    ],
    flashAt: 2,
    color: "bt601" as const,
  };
  const g = composeGraph(spec);
  assert.match(g, /concat=n=3:v=1:a=1\[vraw\]\[ac\]/);
  assert.match(g, /in_color_matrix=bt601:out_color_matrix=bt709\[vc\]/);
  assert.match(g, /\[top_0\]\[top_z\]overlay=0:0:enable='between\(t,3\.000,4\.200\)'/);
  assert.match(g, /\[bot_0\]\[bot_z\]overlay=0:0:enable='between\(t,5\.500,7\.000\)'/);
  assert.match(g, /drawbox=.*enable='between\(t,2\.000,2\.070\)'/);
  assert.doesNotMatch(composeGraph({ ...spec, kind: "fit" }), /overlay=0:0:enable/);
  // And FFmpeg accepts it.
  const probe = spawnSync("ffmpeg", ["-version"]);
  if (probe.status !== 0) return;
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=8", "-f", "lavfi", "-i", "sine=frequency=440:duration=8:sample_rate=48000", "-filter_complex", g, "-map", "[v]", "-map", "[a]", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
});

test("colour: SD is BT.601, HD and unknown-HD BT.709, HDR is tone-mapped when it can be", () => {
  assert.equal(sourceColor({ color_space: "bt709", height: 1080 }, true), "bt709");
  assert.equal(sourceColor({ color_space: "smpte170m", height: 1080 }, true), "bt601");
  assert.equal(sourceColor({ height: 480 }, true), "bt601");
  assert.equal(sourceColor({ height: 1080 }, true), "bt709");
  assert.equal(sourceColor({ color_transfer: "arib-std-b67", color_space: "bt2020nc" }, true), "hdr");
  assert.equal(sourceColor({ color_transfer: "smpte2084" }, false), "bt709");
});

test("sound design: the whoosh peaks on the cut, the bleep only where asked", () => {
  const buf = renderCues(
    [
      { at: 1, kind: "whoosh" },
      { at: 2.5, kind: "impact" },
      { at: 3.2, kind: "bleep", length: 0.2 },
    ],
    4,
  );
  assert.equal(buf[0].length, 4 * RATE);
  const rms = (a: number, b: number) => {
    let s = 0;
    for (let i = Math.round(a * RATE); i < Math.round(b * RATE); i++) s += buf[0][i] ** 2 + buf[1][i] ** 2;
    return Math.sqrt(s / ((b - a) * RATE));
  };
  assert.ok(rms(0.85, 1.05) > 4 * rms(0.4, 0.5), "louder at the cut than at its start");
  assert.ok(rms(3.22, 3.38) > 0.1);
  assert.ok(rms(3.6, 3.9) < 0.01, "silent after the bleep and the impact's tail");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cf-")), "fx.wav");
  writeWav(file, buf);
  const head = fs.readFileSync(file).subarray(0, 44);
  assert.equal(head.toString("ascii", 0, 4), "RIFF");
  assert.equal(head.readUInt32LE(24), 48000);
  assert.equal(fs.statSync(file).size, 44 + 4 * RATE * 4);
});

test("export encode: x264 slow CRF 18 at 1080p, tagged BT.709, 2 s keyframes", () => {
  const a = x264Args(1920, 30);
  const at = (k: string) => a[a.indexOf(k) + 1];
  assert.equal(at("-preset"), "slow");
  assert.equal(at("-crf"), "18");
  assert.equal(at("-colorspace"), "bt709");
  assert.equal(at("-g"), "60");
  const b = x264Args(3840, 60);
  assert.equal(b[b.indexOf("-preset") + 1], "medium");
  assert.equal(b[b.indexOf("-g") + 1], "120");
});
