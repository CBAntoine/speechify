import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanShots, goalKey, madeUpNumbers, palette, sfxCues, shapeBox, templateShots, timeline, type MotionInput } from "../src/lib/motion/story.ts";

const input: MotionInput = {
  business: "Northwind Heating",
  goal: "Book more appointments",
  offer: "Furnace tune-up $149",
  audience: "Calgary homeowners",
  facts: ["Northwind Heating is rated 4.6 stars from 128 Google reviews."],
  cta: "(403) 555-0142",
  hasLogo: true,
  photos: 2,
  format: "vertical",
};

test("every shape is a rounded box, so any shape can morph into any other", () => {
  assert.deepEqual(shapeBox("circle", 0.5, 1000), { w: 500, h: 500, r: 250, ring: 0 });
  assert.equal(shapeBox("ring", 0.5, 1000).ring, 45);
  const pill = shapeBox("pill", 0.5, 1000);
  assert.ok(pill.w > pill.h && pill.r === pill.h / 2);
  const phone = shapeBox("phone", 0.5, 1000);
  assert.ok(phone.h > phone.w);
  assert.equal(shapeBox("square", 9, 1000).w, 1000, "size is capped at the frame");
});

test("timing and the sound cues: whoosh under each morph, hit as the words land, riser in, ding out", () => {
  const shots = [
    { seconds: 2, sfx: ["riser" as const, "hit" as const], camera: "push" as const },
    { seconds: 3, sfx: ["whoosh" as const], camera: "pull" as const },
    { seconds: 2, sfx: ["whoosh" as const, "ding" as const], camera: "still" as const },
  ];
  const { starts, total } = timeline(shots);
  assert.deepEqual(starts, [0, 2, 5]);
  assert.equal(total, 7);
  const cues = sfxCues(shots, starts);
  assert.deepEqual(
    cues.map((c) => `${c.kind}@${c.t.toFixed(2)}`),
    ["riser@0.00", "hit@0.42", "whoosh@1.88", "pullback@2.05", "whoosh@4.88", "ding@5.50"]
  );
});

test("the palette sets their colour off and keeps text readable", () => {
  const p = palette("#0b5394");
  assert.equal(p.primary, "#0b5394");
  assert.equal(p.ink, "#ffffff");
  assert.notEqual(p.accent, p.primary);
  assert.equal(palette("#ffd400").ink, "#111111");
  assert.equal(palette("#111111").accent, "#f5b83d", "a neutral brand gets a warm highlight");
  assert.equal(palette("nope").primary, "#1c1917");
});

test("the template storyboard: offer, logo, photos, rating, call to action, shapes morphing", () => {
  const shots = templateShots(input);
  assert.ok(shots.length >= 6 && shots.length <= 9);
  assert.equal(shots[0].headline, "Furnace tune-up $149");
  assert.ok(shots.some((s) => s.fill === "logo"));
  assert.deepEqual(shots.filter((s) => s.fill === "photo").map((s) => s.photo), [0, 1]);
  assert.deepEqual(shots.find((s) => s.stat)?.stat, { value: "4.6★", label: "128 reviews" });
  assert.equal(shots.at(-1)!.sub, "(403) 555-0142");
  assert.ok(shots[0].sfx.includes("riser") && shots.at(-1)!.sfx.includes("ding"));
  for (let i = 1; i < shots.length; i++) assert.ok(shots[i].shape !== shots[i - 1].shape || shots[i].fill !== shots[i - 1].fill, "each shot changes something");
  const total = timeline(shots).total;
  assert.ok(total >= 12 && total <= 40, `${total}s`);
});

test("storyboards are checked: made-up numbers, missing photos and logos, bad values", () => {
  const { shots, dropped } = cleanShots(
    [
      { headline: "Save 40% today", sub: "x", shape: "circle", fill: "brand", seconds: 2 },
      { headline: "Your logo here", shape: "hexagon" as never, fill: "logo", seconds: 99, size: 7 },
      { headline: "Photo", fill: "photo", photo: 5, seconds: 0.1 },
      { headline: "Tune-up $149", stat: { value: "97%", label: "happy" }, fill: "dark", seconds: 2 },
    ],
    { ...input, hasLogo: false, photos: 1 }
  );
  assert.ok(dropped.some((d) => d.includes("40")));
  assert.equal(shots.length, 3);
  assert.equal(shots[0].shape, "circle", "unknown shapes become circles");
  assert.equal(shots[0].fill, "brand", "no logo uploaded: brand colour");
  assert.equal(shots[0].seconds, 5);
  assert.equal(shots[0].size, 1);
  assert.equal(shots[1].photo, 0, "a photo that doesn't exist becomes the first one");
  assert.equal(shots[1].seconds, 1.4);
  assert.equal(shots[2].stat, undefined, "an invented stat is removed");
  assert.ok(shots[0].sfx.includes("riser") && shots[2].sfx.includes("ding"));
  assert.deepEqual(madeUpNumbers("Tune-up $149 for 2", "Furnace tune-up $149"), ["2"]);
});

test("goals map to the right call to action", () => {
  assert.equal(goalKey("Book more appointments"), "book");
  assert.equal(goalKey("Get more quote requests"), "calls");
  assert.equal(goalKey("Sell the new watch"), "sell");
  assert.equal(goalKey("Get known in town"), "brand");
});

import { fitShotsToVoice, narrationOf, voiceSegments } from "../src/lib/motion/story.ts";
import { imageSize, sharpness } from "../src/lib/motion/image-size.ts";
import { pagePhotos } from "../src/lib/offers/site-kb-parse.ts";

test("the voiceover is one take, cut into each shot's line in the pauses", () => {
  const shots = [{ voice: "Cold house?", seconds: 2 }, { seconds: 2 }, { voice: "Book a tune-up today", seconds: 1.5 }];
  const { text, lines } = narrationOf(shots);
  assert.equal(text, "Cold house? Book a tune-up today.");
  assert.deepEqual(lines, [
    { shot: 0, start: 0, end: 11 },
    { shot: 2, start: 12, end: 33 },
  ]);
  // One character every 0.08s, with a 0.4s pause after the first line.
  const chars = [...text];
  const starts = chars.map((_, i) => i * 0.08 + (i >= 11 ? 0.4 : 0));
  const segs = voiceSegments(lines, { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: starts.map((s) => s + 0.08) });
  assert.equal(segs[0].from, 0);
  assert.ok(segs[0].to > 0.88 && segs[0].to < 1.36, `cut in the pause: ${segs[0].to}`);
  assert.equal(segs[1].from, segs[0].to);
  assert.ok(Math.abs(segs[1].to - (32 * 0.08 + 0.4 + 0.08 + 0.05)) < 0.001);
  const fitted = fitShotsToVoice(shots, segs);
  assert.equal(fitted[0].seconds, 2, "the line fits");
  assert.equal(fitted[2].seconds, 2.6, "the shot grows to fit its line (1.97s line + lead-in + tail)");
  assert.equal(shots[2].seconds, 1.5, "the input isn't changed");
});

test("picture sizes from the file's first bytes", () => {
  const png = Buffer.alloc(32);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  png.writeUInt32BE(3000, 16);
  png.writeUInt32BE(2000, 20);
  assert.deepEqual(imageSize(png), { w: 3000, h: 2000 });
  // JPEG: SOI, an APP0 segment, then SOF0 with height 1080 and width 1920.
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x04, 0x38, 0x07, 0x80, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]);
  assert.deepEqual(imageSize(jpg), { w: 1920, h: 1080 });
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0);
  webp.write("WEBPVP8X", 8);
  webp.writeUIntLE(4095, 24, 3);
  webp.writeUIntLE(2047, 27, 3);
  assert.deepEqual(imageSize(webp), { w: 4096, h: 2048 });
  assert.equal(imageSize(Buffer.from("not an image at all, sorry")), undefined);
  assert.equal(sharpness({ w: 3000, h: 2000 }), "4k");
  assert.equal(sharpness({ w: 1920, h: 1080 }), "hd");
  assert.equal(sharpness({ w: 640, h: 480 }), "low");
  assert.equal(sharpness({}), "unknown");
});

test("photos on their website: share image, biggest srcset, no logos or icons", () => {
  const html = `<meta property="og:image" content="/img/hero.jpg">
    <img src="/img/logo.png" alt="Northwind logo">
    <img src="/img/team-small.jpg" srcset="/img/team-small.jpg 480w, /img/team-big.jpg 1600w" alt="Our team">
    <img src="/img/icon-phone.png" width="24" height="24">
    <img class="site-logo" src="/img/brand.png">
    <picture><source srcset="/img/van.webp 2x, /img/van-1x.webp 1x"><img src="/img/van.jpg"></picture>
    <div style="background-image: url('/img/furnace.jpg')"></div>
    <img src="data:image/gif;base64,R0lGOD">`;
  assert.deepEqual(pagePhotos(html, "https://northwind.ca/"), [
    "https://northwind.ca/img/hero.jpg",
    "https://northwind.ca/img/team-big.jpg",
    "https://northwind.ca/img/van.webp",
    "https://northwind.ca/img/van.jpg",
    "https://northwind.ca/img/furnace.jpg",
  ]);
});

import { proofLines } from "../src/lib/motion/story.ts";
import { logoSharpness } from "../src/lib/motion/image-size.ts";

test("without Claude, the words on screen come only from the brief, your notes and their website", () => {
  const facts = ["Services on their website: Furnace repair, AC install, Duct cleaning, Water heaters.", `Their website's headline: "Calgary's comfort experts"`];
  assert.deepEqual(proofLines({ notes: "Family-run since 1998. Same-day service! We fix every make and model of furnace, boiler and heat pump.", facts }), [
    "Family-run since 1998",
    "Same-day service",
    "Furnace repair",
    "AC install",
    "Duct cleaning",
    "Calgary's comfort experts",
  ]);
  const shots = templateShots({ ...input, notes: "Family-run since 1998. Same-day service.", facts: [...input.facts, ...facts] });
  const words = shots.flatMap((s) => [s.headline, s.sub ?? ""]).join(" | ");
  assert.match(words, /Family-run since 1998/);
  assert.match(words, /Same-day service/);
  assert.doesNotMatch(words, /day and night|24\/7|guarantee|best|#1/i);
  const bare = templateShots({ ...input, offer: undefined, notes: undefined, audience: undefined, facts: [], photos: 0, hasLogo: false });
  assert.ok(bare.length >= 3 && bare.every((s) => s.headline));
  assert.equal(logoSharpness({ w: 1200, h: 400 }), "4k", "a wide logo is judged by its width");
  assert.equal(logoSharpness({ w: 300, h: 100 }), "low");
});
