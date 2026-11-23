import { test } from "node:test";
import assert from "node:assert/strict";
import { assColor, assText, assTime, buildAss, paginate, remapWords } from "../src/server/pipeline/ass.ts";
import { parseCues, parseJson3, transcriptFromSubs } from "../src/server/pipeline/subs.ts";
import type { Word } from "../src/lib/types.ts";

const W = (w: string, s: number, e: number, sp?: number): Word => ({ w, s, e, ...(sp === undefined ? {} : { sp }) });

test("ASS colours are &HAABBGGRR and times are h:mm:ss.cc", () => {
  assert.equal(assColor("#c8ff3d"), "&H003DFFC8");
  assert.equal(assColor("#000000", 0x60), "&H60000000");
  assert.equal(assTime(0), "0:00:00.00");
  assert.equal(assTime(3723.456), "1:02:03.46");
});

test("caption text can't inject override tags", () => {
  assert.equal(assText("hi {\\b1}there\\N"), "hi /b1there/N");
});

test("pages hold at most 3 words and break at sentence ends and pauses", () => {
  const words = [W("No", 0, 0.2), W("way!", 0.25, 0.5), W("Did", 0.6, 0.7), W("you", 0.72, 0.8), W("see", 0.82, 0.9), W("that?", 0.92, 1.1), W("Run", 2.5, 2.7)];
  const pages = paginate(words);
  assert.deepEqual(
    pages.map((p) => p.words.map((w) => w.w).join(" ")),
    ["No way!", "Did you see", "that?", "Run"],
  );
  // Each page stays up until the next starts, at most 0.6 s longer.
  assert.equal(pages[0].e, 0.6);
  assert.equal(pages[2].e, 1.7);
});

test("remapWords moves words onto the output timeline across cuts", () => {
  const words = [W("one", 1, 1.4), W("cut", 2.1, 2.4), W("two", 3.2, 3.5, 1)];
  const out = remapWords(words, [
    [1, 1.6],
    [3, 4],
  ]);
  assert.deepEqual(out, [W("one", 0, 0.4), W("two", 0.8, 1.1, 1)]);
});

test("buildAss writes a hook, word events, a replay tag and per-speaker colours", () => {
  const ass = buildAss({
    words: [W("GO", 3, 3.3, 0), W("GO", 3.4, 3.7, 1)],
    duration: 8,
    style: "pop",
    width: 1080,
    height: 1920,
    captionY: 806,
    hookY: 806,
    font: "Anton",
    accent: "#c8ff3d",
    speakerColors: ["#c8ff3d", "#3ee0ff"],
    hook: "full send.",
    hookUntil: 2.2,
    replay: { start: 5, end: 8, label: "SLOW-MO REPLAY" },
  });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /Style: Word,Anton,162,/);
  // The hook is big, so two words go on two lines.
  assert.match(ass, /Dialogue: 2,0:00:00.00,0:00:02.20,Hook,.*FULL\\NSEND\./);
  assert.match(ass, /Dialogue: 3,0:00:05.00,0:00:08.00,Tag,.*SLOW-MO REPLAY/);
  const words = ass.split("\n").filter((l) => l.includes(",Word,"));
  assert.equal(words.length, 2);
  assert.match(words[0], /\\c&H003DFFC8/);
  assert.match(words[1], /\\c&H00FFE03E/);
});

test("SRT and YouTube VTT become word timings", () => {
  const srt = "1\n00:00:01,000 --> 00:00:03,000\nNo way that worked\n\n2\n00:00:04,000 --> 00:00:05,000\nRun!\n";
  const words = parseCues(srt);
  assert.deepEqual(
    words.map((w) => w.w),
    ["No", "way", "that", "worked", "Run!"],
  );
  assert.equal(words[0].s, 1);
  assert.equal(words[3].e, 3);
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nlet's<00:00:01.400><c> go</c><00:00:01.900><c> boys</c>\n";
  const v = parseCues(vtt);
  assert.deepEqual(
    v.map((w) => [w.w, w.s]),
    [
      ["let's", 1],
      ["go", 1.4],
      ["boys", 1.9],
    ],
  );
});

test("json3 captions and transcriptFromSubs segments", () => {
  const json3 = JSON.stringify({ events: [{ tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: "full" }, { utf8: " send", tOffsetMs: 400 }] }, { tStartMs: 3000, segs: [{ utf8: "\n" }] }] });
  assert.deepEqual(parseJson3(json3), [
    { w: "full", s: 1, e: 1.4 },
    { w: "send", s: 1.4, e: 3 },
  ]);
  const t = transcriptFromSubs("1\n00:00:00,000 --> 00:00:01,000\nHello there.\n\n2\n00:00:03,000 --> 00:00:04,000\nBye.\n", "srt", "Subtitles");
  assert.equal(t.segments.length, 2);
  assert.equal(t.segments[0].text, "Hello there.");
});
