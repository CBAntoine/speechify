import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { browserAvailable, closeBrowser } from "../src/providers/browser.ts";
import { hasFfmpeg, probe, runFfmpeg } from "../src/providers/ffmpeg.ts";
import { type Alignment, type Caption, captionsFromAlignment, captionsFromText } from "../src/video/captions.ts";
import { composeVideo } from "../src/video/compose.ts";

after(async () => {
  await closeBrowser();
});

/** Fake ElevenLabs alignment: every character takes perChar seconds; gaps[i] inserts silence before character i. */
function align(text: string, perChar = 0.06, gaps: Record<number, number> = {}): Alignment {
  const characters = [...text];
  const starts: number[] = [];
  const ends: number[] = [];
  let t = 0;
  characters.forEach((_, i) => {
    t += gaps[i] ?? 0;
    starts.push(t);
    t += perChar;
    ends.push(t);
  });
  return { characters, character_start_times_seconds: starts, character_end_times_seconds: ends };
}

function assertTimeline(caps: Caption[]) {
  for (let i = 0; i < caps.length; i++) {
    assert.ok(caps[i].end > caps[i].start, `caption ${i} has positive length`);
    if (i > 0) assert.ok(caps[i].start >= caps[i - 1].end - 1e-9, `caption ${i} starts after the one before ends`);
  }
}

test("captionsFromAlignment groups words into short phrases and breaks at punctuation", () => {
  const caps = captionsFromAlignment(align("We built you a website, with online booking and your reviews up front."));
  assert.deepEqual(
    caps.map((c) => c.text),
    ["We built you", "a website", "with online booking", "and your reviews", "up front"]
  );
  assertTimeline(caps);
  assert.ok(caps.every((c) => c.text.split(" ").length <= 3));
});

test("captionsFromAlignment keeps a clause-ending word with its phrase instead of stranding it", () => {
  const caps = captionsFromAlignment(align("Hey Bright Smile Dental. So we built you one."));
  assert.equal(caps[0].text, "Hey Bright Smile Dental");
  assert.equal(caps[1].text, "So we built");
  assert.equal(caps[2].text, "you one");
});

test("captionsFromAlignment drops audio tags, keeps ? and !, and splits on long pauses", () => {
  const text = "[excited] Want it live this week? Yes!";
  const pauseAt = text.indexOf("Yes");
  const caps = captionsFromAlignment(align(text, 0.05, { [pauseAt]: 0.8 }));
  assert.deepEqual(
    caps.map((c) => c.text),
    ["Want it live", "this week?", "Yes!"]
  );
  assert.ok(!caps.some((c) => c.text.includes("[")));
  assertTimeline(caps);
  const yes = caps[2];
  assert.ok(yes.start >= 0.05 * pauseAt + 0.8 - 1e-9, "the phrase after the pause starts when its first word is spoken");
});

test("captionsFromAlignment tolerates mismatched arrays and empty input", () => {
  assert.deepEqual(captionsFromAlignment({ characters: [], character_start_times_seconds: [], character_end_times_seconds: [] }), []);
  const a = align("Hello there friend");
  a.character_end_times_seconds = a.character_end_times_seconds.slice(0, 5);
  const caps = captionsFromAlignment(a);
  assert.deepEqual(caps.map((c) => c.text), ["Hello"]);
});

test("captionsFromText spreads a script across the duration by word length", () => {
  const script = "Hey Bright Smile Dental. Your listing has 212 great reviews, but no website. So we built you one.";
  const caps = captionsFromText(script, 10);
  assert.ok(caps.length >= 6 && caps.length <= 12, `${caps.length} captions`);
  assertTimeline(caps);
  assert.ok(caps[0].start > 0 && caps[0].start <= 0.25, "short lead-in");
  assert.ok(caps[caps.length - 1].end <= 10, "ends within the duration");
  assert.ok(caps[caps.length - 1].end >= 9.3, "uses the whole duration");
  assert.equal(caps[0].text, "Hey Bright Smile Dental");
  const words = caps.map((c) => c.text).join(" ").replace(/[^\p{L}\p{N} ]/gu, "").split(/\s+/);
  assert.equal(words.length, script.split(/\s+/).length, "every word appears once");
});

test("captionsFromText handles empty scripts and zero durations", () => {
  assert.deepEqual(captionsFromText("", 10), []);
  assert.deepEqual(captionsFromText("  [pause]  ", 10), []);
  assert.deepEqual(captionsFromText("Hello there", 0), []);
});

test("composeVideo renders a 1080x1920 video with a sound track and a poster", { timeout: 180_000 }, async (t) => {
  if (!(await hasFfmpeg())) return t.skip("FFmpeg isn't installed");
  const b = await browserAvailable();
  if (!b.ok) return t.skip(`no headless browser: ${b.error}`);

  const dir = await mkdtemp(path.join(os.tmpdir(), "ms-video-test-"));
  try {
    // A tall, busy "site" screenshot (PNG) and a short one (JPEG, shorter than the phone screen).
    const tall = path.join(dir, "tall.png");
    const short = path.join(dir, "short.jpg");
    await runFfmpeg(["-f", "lavfi", "-i", "testsrc2=s=1170x4200:d=1", "-frames:v", "1", tall]);
    await runFfmpeg(["-f", "lavfi", "-i", "testsrc2=s=1170x900:d=1", "-frames:v", "1", short]);

    const brand = { primary: "#0f3d5e", accent: "#2bb3a3", ink: "#13202b", bg: "#ffffff" };
    const res = await composeVideo({
      siteShot: tall,
      outDir: path.join(dir, "a"),
      durationSec: 4,
      captions: [
        { text: "We built you", start: 0.3, end: 1.6 },
        { text: "a new website", start: 1.6, end: 3.2 },
      ],
      hook: "We built Test Plumbing a new website",
      endCard: { title: "$500 · live this week", subtitle: "Reply YES to claim it" },
      brand,
      businessName: "Test Plumbing",
    });
    assert.equal(res.durationSec, 4);
    assert.ok((await stat(res.videoPath)).size > 10_000);
    assert.ok((await stat(res.posterPath)).size > 5_000);
    const p = await probe(res.videoPath);
    assert.equal(p.width, 1080);
    assert.equal(p.height, 1920);
    assert.ok(p.hasVideo && p.hasAudio, "video and audio streams");
    assert.ok(Math.abs(p.durationSec - 4) < 0.25, `lasts about 4 s (got ${p.durationSec})`);

    const res2 = await composeVideo({
      siteShot: short,
      outDir: path.join(dir, "b"),
      durationSec: 3,
      captions: [],
      hook: "A very long hook that has to shrink to fit on two lines at the top of the frame without spilling",
      endCard: { title: "$500", subtitle: "Reply YES" },
      brand: { primary: "nonsense", accent: "#fff", ink: "", bg: "" },
      businessName: "A Business With A Rather Long Name & Sons, Incorporated",
    });
    const p2 = await probe(res2.videoPath);
    assert.equal(p2.width, 1080);
    assert.ok(p2.hasAudio);
    assert.ok(Math.abs(p2.durationSec - 3) < 0.25, `lasts about 3 s (got ${p2.durationSec})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
