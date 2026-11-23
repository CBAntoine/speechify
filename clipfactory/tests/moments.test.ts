import { test } from "node:test";
import assert from "node:assert/strict";
import { hookFrom, hypeScore, pickMoments, splitSentences } from "../src/server/pipeline/heuristics.ts";
import { keepRanges } from "../src/server/pipeline/moment.ts";
import { parseOptions } from "../src/server/options.ts";
import type { Word } from "../src/lib/types.ts";

function words(text: string, start: number, step = 0.3): Word[] {
  return text.split(" ").map((w, i) => ({ w, s: start + i * step, e: start + i * step + step * 0.8 }));
}

test("hype words score, calm talk doesn't", () => {
  assert.ok(hypeScore("NO WAY! Did you see that?") > 3);
  assert.ok(hypeScore("we go to the shop") < 0.5);
  assert.equal(hookFrom(words("okay no way that was insane", 10), 11), "NO WAY.");
});

test("the loud, hype moment wins, ends after the payoff and on a sentence", () => {
  const duration = 120;
  const loud = Array.from({ length: duration }, (_, i) => (i >= 60 && i <= 63 ? -6 : -30));
  const w = [
    ...words("Okay chat we are just driving around for a bit.", 5),
    ...words("Here is the plan for the next mission.", 40),
    ...words("No way! The whole building just blew up!", 58),
    ...words("Anyway let us go back.", 90),
  ];
  const picks = pickMoments({ duration, loudness: loud, words: w, cuts: [], count: 2, minSec: 15, maxSec: 30, sourceTitle: "GTA RP" });
  assert.equal(picks.length, 2);
  const best = picks[0];
  assert.ok(best.start < 58 && best.end > 61, `best moment ${best.start}–${best.end}`);
  assert.ok(best.end - best.start >= 15 && best.end - best.start <= 30);
  assert.equal(best.hook, "NO WAY.");
  assert.ok(best.hashtags.includes("gta"));
  // No sentence is cut in half at the end.
  const sentences = splitSentences(w);
  assert.ok(!sentences.some((s) => s.s < best.end - 0.36 && s.e > best.end), "ends mid-sentence");
  // Moments don't overlap.
  assert.ok(picks[1].end <= best.start || picks[1].start >= best.end);
});

test("dead-air cuts keep the short long enough", () => {
  const keep = keepRanges(
    [
      [2, 4],
      [6, 6.3],
      [10, 15],
    ],
    20,
    8,
  );
  assert.deepEqual(keep, [
    [0, 2],
    [4, 10],
    [15, 20],
  ]);
  // Asking for at least 14 s puts the shortest cut back.
  assert.deepEqual(
    keepRanges(
      [
        [2, 4],
        [10, 15],
      ],
      20,
      14,
    ),
    [
      [0, 10],
      [15, 20],
    ],
  );
});

test("options from the browser are clamped and checked", () => {
  const o = parseOptions({ count: 999, minSec: 1, maxSec: 2, layout: "nope", dub: ["es", "xx1", 3], captionStyle: "karaoke", instructions: "  only fails  " });
  assert.equal(o.count, 50);
  assert.equal(o.minSec, 5);
  assert.equal(o.maxSec, 8);
  assert.equal(o.layout, "auto");
  assert.deepEqual(o.dub, ["es"]);
  assert.equal(o.captionStyle, "karaoke");
  assert.equal(o.instructions, "only fails");
});
