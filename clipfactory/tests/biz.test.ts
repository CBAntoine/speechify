import { test } from "node:test";
import assert from "node:assert/strict";
import { captionFor, directionFrom, earnings, lessons, nextSlot, postValue, scoreCreator, type Campaign, type Creator, type PostRecord } from "../src/lib/biz.ts";

const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: "cmp_1",
  name: "Streamer clips",
  url: "https://whop.com/example/",
  creatorIds: ["twitch:streamer"],
  ratePer1k: 2,
  minViews: 10_000,
  status: "active",
  rules: {},
  addedAt: 0,
  ...over,
});

const post = (over: Partial<PostRecord> = {}): PostRecord => ({
  id: `p${Math.random()}`,
  platform: "tiktok",
  accountId: "tiktok:me",
  jobId: "j",
  shortId: `s${Math.random()}`,
  creatorId: "twitch:streamer",
  campaignId: "cmp_1",
  title: "t",
  caption: "c",
  status: "posted",
  at: new Date().toISOString(),
  postedAt: Date.now(),
  views: 0,
  statsAt: Date.now(),
  ...over,
});

test("a post pays per 1K views only past the campaign's threshold, up to its cap", () => {
  assert.deepEqual(postValue(9_999, campaign()), { usd: 0, eligible: false, toGo: 1, capped: false, counted: 9_999 });
  assert.deepEqual(postValue(250_000, campaign()), { usd: 500, eligible: true, toGo: 0, capped: false, counted: 250_000 });
  assert.equal(postValue(250_000, campaign({ maxPerPost: 300 })).usd, 300);
  assert.equal(postValue(1_000_000, null).usd, 0);
});

test("earnings add up by campaign, creator and platform, and list what to submit", () => {
  const posts = [post({ views: 50_000 }), post({ views: 5_000 }), post({ views: 120_000, platform: "youtube", submittedAt: Date.now() }), post({ views: 900_000, status: "scheduled" })];
  const e = earnings(posts, [campaign()], [{ id: "twitch:streamer", name: "Streamer" } as Creator]);
  assert.equal(e.total.posts, 3);
  assert.equal(e.total.views, 175_000);
  assert.equal(e.total.usd, 340);
  assert.equal(e.submit.length, 1, "the 50K post; the 5K one is under the threshold, the 120K one is submitted");
  assert.equal(e.submit[0].usd, 100);
  assert.equal(e.byCreator[0].label, "Streamer");
  assert.equal(e.byPlatform.find((r) => r.key === "youtube")?.usd, 240);
  assert.equal(e.daily.length, 14);
});

test("posting slots stay inside the hours, spaced out, under the daily limit", () => {
  const now = new Date(2026, 10, 24, 9, 0).getTime();
  const opts = { hours: [10, 23] as [number, number], spacingMin: 150, dailyLimit: 3, now };
  const a = nextSlot([], opts);
  assert.equal(new Date(a).getHours(), 10);
  const b = nextSlot([a], opts);
  assert.equal((b - a) / 60_000, 150);
  const c = nextSlot([a, b], opts);
  const d = nextSlot([a, b, c], opts);
  assert.equal(new Date(d).getDate(), 25, "the fourth goes to tomorrow");
  assert.equal(new Date(d).getHours(), 10);
  // Late in the day: tomorrow morning, not 1 a.m.
  const late = nextSlot([], { ...opts, now: new Date(2026, 10, 24, 22, 58).getTime() });
  assert.equal(new Date(late).getDate(), 25);
});

test("captions carry the campaign's required text, tags and mentions once", () => {
  const base = { title: "He jumped the bridge", description: "Full send.", hashtags: ["gta", "#clips"] };
  const rules = { requiredText: "#ad", hashtags: ["StreamerClips"], mentions: ["streamer"] };
  const tt = captionFor("tiktok", base, rules);
  assert.match(tt, /^He jumped the bridge\n\nFull send\./);
  assert.match(tt, /@streamer #ad/);
  assert.match(tt, /#gta #clips #streamerclips$/);
  const yt = captionFor("youtube", { ...base, description: "Full send. @streamer" }, rules);
  assert.equal(yt.match(/@streamer/g)?.length, 1);
  assert.match(yt, /#shorts/);
  assert.ok(captionFor("tiktok", { ...base, description: "x".repeat(3000) }).length <= 2200);
});

test("who to clip: a paid campaign and a fresh VOD rank first; no permission blocks the autopilot", () => {
  const now = Date.now();
  const vod = { id: "v1", url: "https://www.twitch.tv/videos/1", title: "stream", startedAt: new Date(now - 5 * 3600_000).toISOString(), durationSec: 3 * 3600 };
  const paid: Creator = { id: "twitch:streamer", platform: "twitch", handle: "streamer", name: "Streamer", url: "https://twitch.tv/streamer", permission: "unknown", autopilot: true, addedAt: 0, stats: { avgViewers: 20_000, clips24h: 40, clipViews24h: 800_000, updatedAt: now } };
  const big: Creator = { ...paid, id: "twitch:huge", handle: "huge", name: "Huge", stats: { avgViewers: 90_000, updatedAt: now } };
  const ctx = { campaigns: [campaign()], posts: [], now };
  const a = scoreCreator(paid, { ...ctx, newestVod: vod });
  const b = scoreCreator(big, { ...ctx, newestVod: vod });
  assert.equal(a.permission, "campaign");
  assert.equal(a.blocked, undefined);
  assert.ok(a.score > b.score, `${a.score} vs ${b.score}`);
  assert.match(b.blocked ?? "", /No permission/);
  assert.match(a.reasons.join(" | "), /\$2\.00 per 1K views after 10K views/);
  // An exhausted budget doesn't count; neither does a denied creator.
  assert.equal(scoreCreator(paid, { ...ctx, campaigns: [campaign({ budgetLeft: 0 })], newestVod: vod }).permission, "unknown");
  assert.equal(scoreCreator({ ...paid, permission: "denied" }, { campaigns: [], posts: [], newestVod: vod }).score, 0);
  // Still live: rank it, but wait.
  assert.equal(scoreCreator(paid, { ...ctx, newestVod: { ...vod, live: true } }).blocked, "Still live");
});

test("the same short on two platforms counts once among the best, views summed", () => {
  const a = post({ views: 1000, title: "Same clip", shortId: "x", platform: "tiktok" });
  const b = post({ views: 500, title: "Same clip", shortId: "x", platform: "instagram" });
  const c = post({ views: 300, title: "Other", shortId: "y" });
  const l = lessons([a, b, c])!;
  assert.deepEqual(
    l.best.map((x) => [x.title, x.views]),
    [
      ["Same clip", 1500],
      ["Other", 300],
    ],
  );
});

test("campaigns with a submission window pay only for views after submitting, minus their fee", () => {
  const k = campaign({ submitWithinMin: 30, feePct: 10, minViews: 10_000 });
  assert.equal(postValue(40_000, k, { submittedAt: undefined }).usd, 0, "never submitted: nothing");
  const v = postValue(31_000, k, { submittedAt: Date.now(), viewsAtSubmit: 1_000 });
  assert.equal(v.counted, 30_000);
  assert.equal(v.usd, 54, "30K × $2/1K = $60, less 10%");
  const now = Date.now();
  const fresh = post({ campaignId: k.id, postedAt: now - 10 * 60_000, views: 500 });
  const late = post({ campaignId: k.id, postedAt: now - 50 * 60_000, views: 900 });
  const e = earnings([late, fresh], [k], [], now);
  assert.equal(e.submit.length, 2);
  assert.equal(e.submit[0].post.id, fresh.id, "the open window comes first");
  assert.ok(Math.abs(e.submit[0].deadline! - (now + 20 * 60_000)) < 1000);
  assert.equal(e.submit[1].missed, true);
});

test("your own numbers become direction for the next picks", () => {
  const ps = [
    post({ views: 400_000, category: "fail", title: "Bridge jump fail" }),
    post({ views: 300_000, category: "fail", title: "Wrong turn" }),
    post({ views: 9_000, category: "story", title: "Story time" }),
    post({ views: 7_000, category: "story", title: "Long story" }),
  ];
  const l = lessons(ps, "twitch:streamer")!;
  assert.equal(l.posts, 4);
  assert.equal(l.byCategory[0].category, "fail");
  const d = directionFrom(l, "Streamer")!;
  assert.match(d, /fail clips do best/);
  assert.match(d, /"Bridge jump fail" \(400K\)/);
  assert.equal(lessons(ps.slice(0, 2)), null, "too few posts to learn from");
});
