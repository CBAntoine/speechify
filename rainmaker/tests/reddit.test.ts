import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REDDIT, cleanSubreddits, parseListing, rankPosts, scorePost, statedBusiness, statedContacts, type RedditPost } from "../src/lib/reddit/intent.ts";
import { needOf, templateEmail, templateReply } from "../src/lib/reddit/drafts.ts";

const NOW = Date.parse("2026-11-27T15:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const post = (title: string, body = "", h = 1, extra: Partial<RedditPost> = {}): RedditPost => ({
  id: `t3_${Math.random().toString(36).slice(2, 8)}`,
  subreddit: "smallbusiness",
  author: "someone",
  title,
  body,
  url: "https://www.reddit.com/r/smallbusiness/comments/x/",
  createdAt: hoursAgo(h),
  comments: 2,
  ...extra,
});

test("the playbook's phrases score as buying intent", () => {
  const cfg = DEFAULT_REDDIT;
  const cases: [RedditPost, string][] = [
    [post("Anyone got recommendations for a web designer in Calgary?"), "recommend"],
    [post("Looking for a good marketing agency for my dental clinic"), "looking"],
    [post("Alternative to GoHighLevel that isn't a nightmare?"), "alternative"],
    [post("Got burned by Scorpion, where do I go now?"), "burned"],
    [post("Has anyone used Podium? Are they worth it?"), "vetting"],
  ];
  for (const [p, kind] of cases) {
    const s = scorePost(p, cfg, NOW);
    assert.ok(s.kinds.includes(kind as never), `${p.title} → ${kind}`);
    assert.ok(s.score >= 50, `${p.title} scored ${s.score}`);
  }
});

test("urgency and budget push a post up, and are called out", () => {
  const s = scorePost(
    post("I need a website redesign urgently", "Budget is $15K. Prefer someone who actually knows what they're doing and isn't sketchy. Anyone you'd recommend?"),
    DEFAULT_REDDIT,
    NOW
  );
  assert.equal(s.urgent, true);
  assert.equal(s.budget, "$15K");
  assert.ok(s.reasons.includes("Urgent") && s.reasons.includes("Budget $15K"));
  assert.ok(s.score >= 80);
});

test("offers, chatter and off-topic questions don't count", () => {
  const cfg = DEFAULT_REDDIT;
  assert.equal(scorePost(post("[For Hire] Web designer, 10 years experience"), cfg, NOW).score, 0);
  assert.equal(scorePost(post("We offer SEO for local businesses, DM me"), cfg, NOW).score, 0);
  assert.equal(scorePost(post("Any recommendations for a good accountant?"), cfg, NOW).score, 0, "not something we sell");
  assert.equal(scorePost(post("My website finally launched!"), cfg, NOW).score, 0, "no request");
  assert.equal(scorePost(post("Looking for feedback", "", 1, { flair: "Offer" }), cfg, NOW).score, 0);
});

test("only fresh posts above the bar, best first, no duplicates", () => {
  const fresh = post("Anyone got recommendations for a web designer? Urgent", "", 0.5);
  const older = post("Looking for a good SEO person", "", 3);
  const stale = post("Anyone recommend a web designer?", "", 9);
  const weak = post("Thoughts on websites in general?", "", 1);
  const ranked = rankPosts([fresh, older, stale, weak, fresh], DEFAULT_REDDIT, NOW);
  assert.deepEqual(ranked.map((r) => r.post.id), [fresh.id, older.id]);
});

test("Reddit listings become posts; removed, pinned and adult posts are skipped", () => {
  const listing = {
    kind: "Listing",
    data: {
      children: [
        { kind: "t3", data: { name: "t3_a1", id: "a1", subreddit: "Calgary", author: "dentaldan", title: "Recommendations for a web designer?", selftext: "Need a new site for my clinic.", permalink: "/r/Calgary/comments/a1/x/", created_utc: NOW / 1000 - 600, num_comments: 3 } },
        { kind: "t3", data: { name: "t3_a2", id: "a2", subreddit: "Calgary", author: "[deleted]", title: "x", selftext: "", permalink: "/r/x", created_utc: NOW / 1000 } },
        { kind: "t3", data: { name: "t3_a3", id: "a3", subreddit: "Calgary", author: "mod", title: "Weekly thread", selftext: "", permalink: "/r/x", created_utc: NOW / 1000, stickied: true } },
        { kind: "t3", data: { name: "t3_a4", id: "a4", subreddit: "Calgary", author: "x", title: "nsfw", selftext: "", permalink: "/r/x", created_utc: NOW / 1000, over_18: true } },
        { kind: "t1", data: { name: "t1_c", author: "y", body: "a comment" } },
      ],
    },
  };
  const posts = parseListing(listing);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, "t3_a1");
  assert.equal(posts[0].url, "https://www.reddit.com/r/Calgary/comments/a1/x/");
  assert.equal(posts[0].createdAt, new Date(NOW - 600_000).toISOString());
  assert.deepEqual(parseListing(null), []);
});

test("contact details the poster shared, and clean subreddit names", () => {
  const c = statedContacts("Email me at Owner@SmileDental.ca or see smiledental.ca/about. Not reddit.com/r/x or imgur.com/a.");
  assert.deepEqual(c.emails, ["owner@smiledental.ca"]);
  assert.deepEqual(c.websites, ["smiledental.ca/about"]);
  assert.deepEqual(cleanSubreddits(["r/Calgary", " /r/smallbusiness ", "Calgary", "x", "bad name!"]), ["Calgary", "smallbusiness", "badname"]);
});

test("the business a poster names, without guessing", () => {
  assert.equal(statedBusiness("I run Bright Smile Dental in Calgary and need a site."), "Bright Smile Dental");
  assert.equal(statedBusiness("my company, Apex Roofing and Gutters, needs ads"), "Apex Roofing and Gutters");
  assert.equal(statedBusiness("I run a small shop and need help"), undefined);
  assert.equal(statedBusiness("Anyone recommend a web designer?"), undefined);
});

test("drafts read naturally and use only the agency's own proof", () => {
  const base = { id: "t3_x", subreddit: "Calgary", author: "a", title: "Need a website urgently", body: "", url: "u", createdAt: new Date().toISOString(), comments: 0, score: 90, kinds: ["looking"], reasons: [], urgent: true, services: ["website"], competitors: [], contact: { emails: [], websites: [] }, status: "new" as const, foundAt: "" };
  assert.equal(needOf(base), "a new website");
  assert.equal(needOf({ ...base, services: ["SEO"] }), "SEO");
  assert.equal(needOf({ ...base, services: [], competitors: ["Podium"] }), "an alternative to Podium");
  const reply = templateReply(base, { agencyName: "Rain Co", proof: "", services: [] });
  assert.match(reply, /Full disclosure: I run Rain Co and we help with exactly this\./);
  const email = templateEmail(base, { agencyName: "Rain Co", ownerName: "Craig", proof: "", mailingAddress: "1 Main St" });
  assert.match(email.body, /Saw your post in r\/Calgary about a new website \(sounded urgent\)\. We do exactly that at Rain Co\. Free 15-minute call this week\?/);
  assert.ok(!/\d+ (calls|clients|leads)/.test(email.body), "no results the agency didn't give");
});
