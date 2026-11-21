// The remote's buttons, as people say them: one button, several in a row, a count, one held down.
// (How each kind of TV is sent them is in tv.test.mjs.)
import test from "node:test";
import assert from "node:assert/strict";
import { buttonCodes, describeButtons, parseButtons } from "../src/drivers/tv.mjs";
import { refusedKey } from "../src/drivers/androidtv.mjs";

const said = (v) => parseButtons(v).map((s) => `${s.hold ? "hold " : ""}${s.button}${s.times > 1 ? ` x${s.times}` : ""}`).join(", ");

test("buttons by any of their names, and several at once", () => {
  assert.equal(said("down"), "down");
  assert.equal(said("OK"), "ok");
  assert.equal(said("select"), "ok");
  assert.equal(said("enter"), "ok");
  assert.equal(said("go back"), "back");
  assert.equal(said("Press the Home button"), "home");
  assert.equal(said("options"), "menu");
  assert.equal(said("ff"), "fast forward");
  assert.equal(said("skip forward"), "fast forward");
  assert.equal(said("play pause"), "play pause");
  assert.equal(said("vol up"), "volume up");
  assert.equal(said("red button"), "red");
  assert.equal(said("subtitles"), "captions");
  // Several, said with commas, "then", "and", or just one after another.
  assert.equal(said("Down, down, right, OK"), "down x2, right, ok");
  assert.equal(said("home then down then ok"), "home, down, ok");
  assert.equal(said("up up down down left right"), "up x2, down x2, left, right");
  assert.equal(said("press down and then select"), "down, ok");
});

test("how many times, and holding a button down", () => {
  assert.equal(said("down 3"), "down x3");
  assert.equal(said("down three times"), "down x3");
  assert.equal(said("back twice"), "back x2");
  assert.equal(said("right x2 then ok"), "right x2, ok");
  assert.equal(said("2x right"), "right x2");
  assert.equal(said("3 times down"), "down x3");
  assert.equal(said("3 down, ok"), "down x3, ok", "a count said first, for a button that's pressed over and over");
  assert.equal(said("two right then ok"), "right x2, ok");
  assert.equal(said("5 volume up"), "volume up x5");
  assert.equal(said("press 4 left"), "left x4");
  assert.equal(said("down three times, right twice, OK"), "down x3, right x2, ok");
  assert.equal(said("volume up 5"), "volume up x5");
  assert.equal(said("hold home"), "hold home");
  assert.equal(said("long press ok"), "hold ok");
  assert.equal(said("press and hold the select button"), "hold ok");
  assert.equal(said("hold down the home button"), "hold home", "“hold down” is how people say “hold”");
  assert.equal(said("hold down"), "hold down", "unless Down is the button");
  assert.equal(said("hold home then down"), "hold home, down");
});

test("numbers: a count after a button, the number buttons by themselves", () => {
  assert.equal(said("7"), "7");
  assert.equal(said("seven"), "7");
  assert.equal(said("7 1"), "7, 1");
  assert.equal(said("206"), "2, 0, 6");
  assert.equal(said("down 5 ok"), "down x5, ok");
  assert.equal(said("1 2 3 ok"), "1, 2, 3, ok", "a channel number and OK, not OK three times");
  assert.equal(said("3 ok"), "3, ok");
  assert.equal(said("7 1 down"), "7, 1, down");
  assert.equal(said("206 down"), "2, 0, 6, down");
  assert.equal(said("press ok 2 times"), "ok x2");
});

test("what was pressed, in words", () => {
  const told = (v) => describeButtons(parseButtons(v));
  assert.equal(told("down"), "Pressed down");
  assert.equal(told("home, down 2, right, ok"), "Pressed Home, then down twice, then right, then OK");
  assert.equal(told("volume up 5"), "Pressed volume up five times");
  assert.equal(told("hold home"), "Held Home");
  assert.equal(told("back then hold ok"), "Pressed Back, then held OK");
  assert.equal(told("play pause"), "Pressed Play/Pause");
});

test("what isn't a button, too many presses, and buttons a TV's remote doesn't have", () => {
  assert.throws(() => parseButtons("wiggle"), (e) => e.code === "EVALUE" && /I don't know the button “wiggle”/.test(e.message) && /Say several with commas/.test(e.message));
  assert.throws(() => parseButtons("open netflix"), (e) => e.code === "EVALUE" && /“open netflix”/.test(e.message));
  assert.throws(() => parseButtons("down 50"), (e) => e.code === "EVALUE" && /That's 50 presses, more than I'll do in one go \(40\)/.test(e.message));
  assert.throws(() => parseButtons("down 20, up 20, left 5"), (e) => /45 presses/.test(e.message));
  assert.throws(() => parseButtons(""), (e) => e.code === "EVALUE");
  // Each TV has its own codes; a button it doesn't have is said plainly.
  const codes = { up: "U", ok: "SEL" };
  assert.deepEqual(buttonCodes(parseButtons("up 2, ok, 7"), codes, { digit: (d) => `N${d}` }).map((s) => [s.code, s.times]), [["U", 2], ["SEL", 1], ["N7", 1]]);
  assert.throws(() => buttonCodes(parseButtons("guide"), codes, { device: "Den TV" }), (e) => e.code === "EUNSUPPORTED" && e.message === "Den TV doesn't have a Guide button that I can press.");
  assert.throws(() => buttonCodes(parseButtons("7"), codes, { device: "Den TV" }), (e) => /Den TV doesn't have number buttons that I can press\./.test(e.message));
});

test("Android says nothing when it has pressed a key; Patch notices when it says it won't", () => {
  assert.equal(refusedKey(""), false);
  assert.equal(refusedKey("\n"), false);
  assert.equal(refusedKey(undefined), false);
  assert.equal(refusedKey("Error: Invalid arguments for command: keyevent\nusage: input [<source>] keyevent [--longpress] <key code number or name> ..."), true);
  assert.equal(refusedKey("java.lang.SecurityException: Injecting to another application requires INJECT_EVENTS permission\n\tat android.os.Parcel.readException(Parcel.java:2013)"), true);
  assert.equal(refusedKey("Exception occurred while executing 'keyevent':\njava.lang.IllegalArgumentException: Argument expected after \"--longpress\""), true);
});
