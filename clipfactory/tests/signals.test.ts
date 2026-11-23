import { test } from "node:test";
import assert from "node:assert/strict";
import { audienceScore, CHAT_DELAY, commentMentions, describeSignals, parseHeatmap, parseLiveChat, reactionWeight, type Signals } from "../src/server/pipeline/signals.ts";

const chatLine = (ms: number, text: string, paid = false) =>
  JSON.stringify({
    replayChatItemAction: {
      actions: [{ addChatItemAction: { item: { [paid ? "liveChatPaidMessageRenderer" : "liveChatTextMessageRenderer"]: { message: { runs: [{ text }] } } } } }],
      videoOffsetTimeMsec: String(ms),
    },
  });

test("Most replayed: yt-dlp's heatmap becomes 0..1 per second", () => {
  const replay = parseHeatmap(
    {
      heatmap: [
        { start_time: 0, end_time: 10, value: 0.2 },
        { start_time: 10, end_time: 20, value: 1 },
      ],
    },
    20,
  )!;
  assert.equal(replay.length, 20);
  assert.equal(replay[5], 0.2);
  assert.equal(replay[15], 1);
  assert.equal(parseHeatmap({}, 20), undefined);
});

test("live chat replay: messages, reactions and samples per second", () => {
  const text = [chatLine(12500, "CLIP IT"), chatLine(12900, "LMAO 😂"), chatLine(40000, "gg", true), "not json", ""].join("\n");
  const chat = parseLiveChat(text, 60);
  assert.equal(chat.messages, 3);
  assert.equal(chat.chat[12], 2);
  assert.ok(chat.react[12] > 6, `clip-it and a laugh: ${chat.react[12]}`);
  assert.ok(chat.react[40] >= 3, "super chats count");
  assert.deepEqual(chat.samples[12], ["CLIP IT", "LMAO 😂"]);
  assert.equal(reactionWeight("ok"), 0);
});

test("comments that cite a time, most liked first", () => {
  const m = commentMentions(
    [
      { text: "1:02:03 lol", like_count: 2 },
      { text: "12:31 I can't breathe", like_count: 50 },
      { text: "no time here", like_count: 900 },
      { text: "99:99 isn't a time" },
    ],
    4000,
  );
  assert.deepEqual(
    m.map((x) => [x.t, x.likes]),
    [
      [751, 50],
      [3723, 2],
    ],
  );
});

test("the audience score peaks where viewers reacted, with chat moved back to the moment", () => {
  const chat = new Array(120).fill(0);
  for (let s = 60 + CHAT_DELAY; s < 66 + CHAT_DELAY; s++) chat[s] = 30;
  const replay = new Array(120).fill(0.1);
  for (let s = 58; s < 66; s++) replay[s] = 1;
  const sig: Signals = { duration: 120, chat, react: chat.map((v) => v / 3), replay, sources: ["Most replayed", "live chat"] };
  const score = audienceScore(sig, 120);
  const best = score.indexOf(Math.max(...score));
  assert.ok(best >= 57 && best <= 66, `peak at ${best}`);
  assert.ok(score[best] > score[20] + 2);
  assert.deepEqual(audienceScore(null, 10), new Array(10).fill(0));
  const text = describeSignals({ ...sig, mentions: [{ t: 61, likes: 40, text: "1:01 the jump" }], samples: { 66: ["NO WAY"] } });
  assert.match(text, /Most replayed \(YouTube, 0–1\): 00:5\d \(1\.00\)/);
  assert.match(text, /Chat spikes/);
  assert.match(text, /"NO WAY"/);
  assert.match(text, /01:01 \(40 likes\)/);
});
