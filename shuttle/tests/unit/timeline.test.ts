import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cropFor,
  detectSilences,
  keptSegments,
  mergeRanges,
  nextKept,
  outputDuration,
  outputToSource,
  refineSegments,
  sourceToOutput,
  speechThreshold,
  zoomAt,
} from '../../src/lib/timeline.ts';
import { bubbleRect, coverCrop, outputSize } from '../../src/lib/layout.ts';
import { captionCues, chaptersToOutput, cuesToOutput, toSRT, toVTT } from '../../src/lib/captions.ts';

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('mergeRanges merges overlaps and drops empty ranges', () => {
  assert.deepEqual(mergeRanges([[5, 6], [1, 3], [2, 4], [7, 7]]), [[1, 4], [5, 6]]);
});

test('keptSegments applies trim and cuts', () => {
  const segs = keptSegments(10, { trimStart: 1, trimEnd: 9, cuts: [{ id: 'a', start: 3, end: 4, kind: 'manual' }, { id: 'b', start: 3.5, end: 5, kind: 'silence' }] });
  assert.deepEqual(segs, [[1, 3], [5, 9]]);
  close(outputDuration(segs), 6);
});

test('time mapping round-trips and reports cut moments', () => {
  const segs = keptSegments(10, { trimStart: 0, trimEnd: null, cuts: [{ id: 'a', start: 2, end: 4, kind: 'manual' }] });
  assert.equal(sourceToOutput(3, segs), null);
  close(sourceToOutput(5, segs)!, 3);
  close(outputToSource(3, segs), 5);
  close(outputToSource(1.5, segs), 1.5);
  assert.equal(nextKept(2.5, segs), 4);
  assert.equal(nextKept(1, segs), 1);
  assert.equal(nextKept(10.5, segs), null);
});

function envelopeWithPauses(rate: number, pattern: Array<[number, boolean]>): Float32Array {
  const out: number[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const [secs, speaking] of pattern) {
    for (let i = 0; i < secs * rate; i++) out.push(speaking ? 0.15 + rnd() * 0.1 : 0.002 + rnd() * 0.002);
  }
  return Float32Array.from(out);
}

test('detectSilences finds long pauses and keeps padding around speech', () => {
  const rate = 50;
  const env = envelopeWithPauses(rate, [[0.5, false], [3, true], [2, false], [3, true], [0.4, false], [2, true], [1.5, false]]);
  const sil = detectSilences(env, rate, { minSilence: 0.8, padding: 0.2 });
  // leading pause (0.5 s) is shorter than minSilence; the 0.4 s pause is ignored
  assert.equal(sil.length, 2);
  close(sil[0][0], 3.5 + 0.2, 0.05);
  close(sil[0][1], 5.5 - 0.2, 0.05);
  close(sil[1][1], env.length / rate, 0.001); // trailing pause is cut to the end
});

test('speechThreshold refuses to guess on flat audio', () => {
  assert.equal(speechThreshold(new Float32Array(500).fill(0.01)), null);
  assert.deepEqual(detectSilences(new Float32Array(500).fill(0.01), 50), []);
});

test('refineSegments snaps rough boundaries to speech', () => {
  const rate = 50;
  const env = envelopeWithPauses(rate, [[1, false], [2, true], [1.5, false], [2, true], [1, false]]);
  const out = refineSegments(
    [
      { id: 'a', start: 1.6, end: 3.6, text: 'one' },
      { id: 'b', start: 5.2, end: 7.0, text: 'two' },
    ],
    env,
    rate,
  );
  close(out[0].start, 1 - 0.08, 0.05);
  close(out[0].end, 3 + 0.12, 0.05);
  close(out[1].start, 4.5 - 0.08, 0.05);
  close(out[1].end, 6.5 + 0.12, 0.05);
});

test('zoomAt eases in and out and cropFor stays inside the frame', () => {
  const zooms = [{ id: 'z', start: 2, end: 6, scale: 2, x: 0.95, y: 0.1 }];
  assert.equal(zoomAt(1, zooms).scale, 1);
  assert.equal(zoomAt(4, zooms).scale, 2);
  const mid = zoomAt(2.2, zooms).scale;
  assert.ok(mid > 1 && mid < 2);
  const crop = cropFor(zoomAt(4, zooms));
  close(crop.w, 0.5);
  close(crop.x, 0.5);
  close(crop.y, 0);
});

test('bubble geometry stays inside the frame', () => {
  const r = bubbleRect({ visible: true, shape: 'circle', size: 0.3, x: 1, y: 1, mirror: true }, 1920, 1080);
  assert.ok(r.x + r.w <= 1920 && r.y + r.h <= 1080);
  close(r.radius, r.h / 2);
  const wide = bubbleRect({ visible: true, shape: 'wide', size: 0.3, x: 0.5, y: 0.5, mirror: false }, 1920, 1080);
  close(wide.w / wide.h, 16 / 9);
  const c = coverCrop(1280, 720, 1);
  assert.deepEqual(c, { sx: 280, sy: 0, sw: 720, sh: 720 });
  assert.deepEqual(outputSize(2559, 1599, 1080), { width: 1728, height: 1080 });
  assert.deepEqual(outputSize(1280, 720, 1080), { width: 1280, height: 720 });
  // Portrait phone recordings scale by their short side too.
  assert.deepEqual(outputSize(1080, 2400, 720), { width: 720, height: 1600 });
});

test('captions split, shift onto the edited timeline and serialize', () => {
  const segs = [
    { id: 'a', start: 0, end: 4, text: 'This is a long sentence that will need more than two caption lines to show it all on screen' },
    { id: 'b', start: 6, end: 8, text: 'Second phrase' },
  ];
  const cues = captionCues(segs);
  assert.ok(cues.length >= 2);
  assert.ok(cues.every((c) => c.text.split('\n').length <= 2));
  close(cues[cues.length - 2].end, 4, 1e-9);
  const kept = keptSegments(10, { trimStart: 0, trimEnd: null, cuts: [{ id: 'x', start: 4, end: 6, kind: 'silence' }] });
  const out = cuesToOutput(cues, kept);
  close(out[out.length - 1].start, 4);
  assert.match(toVTT(out), /^WEBVTT\n\n00:00:00\.000 --> /);
  assert.match(toSRT(out), /^1\n00:00:00,000 --> /);
});

test('chapters always start at 0:00', () => {
  const kept = keptSegments(100, { trimStart: 10, trimEnd: null, cuts: [] });
  const ch = chaptersToOutput([{ id: '1', t: 40, title: 'Demo' }], kept);
  assert.deepEqual(ch, [{ t: 0, title: 'Intro' }, { t: 30, title: 'Demo' }]);
});
