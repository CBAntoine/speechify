import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  excerpt,
  fallbackBrief,
  isRelevant,
  mergeNews,
  normalizeUrl,
  parseFeed,
  parseSubmission,
  slugify,
  toNewsItem,
} from "../lib/intel.mjs";

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Games</title>
  <item>
    <title><![CDATA[GTA 6 patch 1.02 fixes the Vice City traffic bug]]></title>
    <link>https://www.example.com/gta-6-patch?utm_source=rss</link>
    <pubDate>Thu, 20 Nov 2026 08:00:00 GMT</pubDate>
    <description><![CDATA[<p>Rockstar's first <b>GTA VI</b> update is out. It fixes traffic in Vice City.</p>]]></description>
  </item>
  <item>
    <title>Best racing wheels of 2026</title>
    <link>https://www.example.com/wheels</link>
    <pubDate>Thu, 20 Nov 2026 07:00:00 GMT</pubDate>
    <description>Our picks for sim racers.</description>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Grand Theft Auto VI sold 25 million copies in a day, says Take-Two</title>
    <link rel="alternate" href="https://news.example.org/gta-vi-sales"/>
    <published>2026-11-20T06:30:00Z</published>
    <summary>Take-Two says launch sales broke records.</summary>
  </entry>
</feed>`;

test("parses RSS and Atom into flat items", () => {
  const rss = parseFeed(RSS, "Example");
  assert.equal(rss.length, 2);
  assert.equal(rss[0].title, "GTA 6 patch 1.02 fixes the Vice City traffic bug");
  assert.equal(rss[0].source, "Example");
  const atom = parseFeed(ATOM, "Org");
  assert.equal(atom.length, 1);
  assert.equal(atom[0].url, "https://news.example.org/gta-vi-sales");
});

test("keeps only GTA VI stories", () => {
  const items = parseFeed(RSS, "Example");
  assert.deepEqual(items.map(isRelevant), [true, false]);
  assert.ok(isRelevant(parseFeed(ATOM, "Org")[0]));
});

test("tags and excerpts a story without republishing it", () => {
  const [patch] = parseFeed(RSS, "Example");
  assert.ok(classify(patch).includes("patch"));
  assert.equal(excerpt(patch.description), "Rockstar's first GTA VI update is out.");
  const [sales] = parseFeed(ATOM, "Org");
  assert.ok(classify(sales).includes("business"));
});

test("normalises URLs for dedupe", () => {
  assert.equal(normalizeUrl("https://www.example.com/gta-6-patch?utm_source=rss#top"), "https://example.com/gta-6-patch");
});

test("merges new items, dedupes by URL and title, newest first", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const incoming = parseFeed(RSS, "Example").concat(parseFeed(ATOM, "Org")).filter(isRelevant).map((i) => toNewsItem(i, now));
  const existing = [
    { id: "old", title: "GTA 6 patch 1.02 fixes the Vice City traffic bug!", url: "https://other.site/x", source: "Other", publishedAt: "2026-11-19T00:00:00.000Z", tags: ["patch"] },
  ];
  const { items, added } = mergeNews(existing, incoming);
  assert.equal(added.length, 1, "same headline from another outlet is skipped");
  assert.equal(items[0].title, "Grand Theft Auto VI sold 25 million copies in a day, says Take-Two");
  const again = mergeNews(items, incoming);
  assert.equal(again.added.length, 0, "a second run adds nothing");
});

test("future or missing dates fall back to now", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const item = toNewsItem({ title: "GTA 6 x", url: "https://a.b/c", publishedAt: "2030-01-01", description: "", source: "S" }, now);
  assert.equal(item.publishedAt, now.toISOString());
});

test("fallback brief lists the newest headlines with links", () => {
  const brief = fallbackBrief(
    [{ title: "A", url: "https://a", source: "X" }, { title: "B", url: "https://b", source: "Y" }],
    "2026-11-20",
  );
  assert.equal(brief.headline, "2 new GTA VI stories today");
  assert.deepEqual(brief.bullets[0], { text: "X: A", url: "https://a" });
});

test("reads an approved submission's JSON block", () => {
  const body = 'Found it!\n```json\n{"name": "Neon sign easter egg", "lng": -80.19, "lat": 25.77}\n```';
  assert.deepEqual(parseSubmission(body), { name: "Neon sign easter egg", lng: -80.19, lat: 25.77 });
  assert.equal(parseSubmission("no json here"), null);
  assert.equal(parseSubmission('```json\n{"name": 1}\n```'), null);
  assert.equal(slugify("Neon Sign: Easter Egg!"), "neon-sign-easter-egg");
});
