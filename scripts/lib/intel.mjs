/**
 * Pure helpers for the daily intel job (no network), so they can be unit-tested.
 */
import { XMLParser } from "fast-xml-parser";
import { createHash } from "node:crypto";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  cdataPropName: "#cdata",
  trimValues: true,
});

const RELEVANT = /\b(gta\s?(vi|6)|grand\s+theft\s+auto\s+(vi|6)|leonida|vice\s+city)\b/i;

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function text(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") return text(v["#cdata"] ?? v["#text"] ?? "");
  return "";
}

export function stripHtml(html) {
  return text(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** First sentence, capped, so headlines link out instead of republishing articles. */
export function excerpt(html, max = 160) {
  const plain = stripHtml(html);
  if (!plain) return "";
  const sentence = plain.match(/^.{20,}?[.!?](\s|$)/)?.[0]?.trim() ?? plain;
  return sentence.length > max ? `${sentence.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : sentence;
}

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|cmpid|ref$|source$)/i.test(key)) u.searchParams.delete(key);
    }
    u.hostname = u.hostname.replace(/^www\./, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

const normTitle = (t) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Parse RSS 2.0 or Atom into flat items. */
export function parseFeed(xml, sourceName) {
  const doc = parser.parse(xml);
  const items = [];
  for (const it of asArray(doc?.rss?.channel?.item)) {
    items.push({
      title: stripHtml(it.title),
      url: text(it.link) || text(it.guid),
      publishedAt: text(it.pubDate) || text(it["dc:date"]),
      description: text(it.description) || text(it["content:encoded"]),
      source: sourceName,
    });
  }
  for (const it of asArray(doc?.feed?.entry)) {
    const links = asArray(it.link);
    const alt = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0];
    items.push({
      title: stripHtml(it.title),
      url: alt?.["@href"] ?? text(alt),
      publishedAt: text(it.published) || text(it.updated),
      description: text(it.summary) || text(it.content),
      source: sourceName,
    });
  }
  return items.filter((i) => i.title && /^https?:\/\//.test(i.url));
}

export const isRelevant = (item) => RELEVANT.test(`${item.title} ${stripHtml(item.description)}`);

const TAG_RULES = [
  ["patch", /\b(patch|update|hotfix|title update|bug fix)/i],
  ["easter-egg", /\beaster egg/i],
  ["secrets", /\b(secret|hidden|mystery|ufo|bigfoot|discover(ed|y))/i],
  ["tips", /\b(guide|tips?|how to|best .* in gta|walkthrough)/i],
  ["reviews", /\b(review|metacritic|opencritic|score)/i],
  ["business", /\b(sales|sold|take-two|ttwo|revenue|stock|price|preorder|pre-order)/i],
  ["online", /\bgta online|multiplayer/i],
  ["pc", /\bpc (version|port|release)|steam\b/i],
  ["launch", /\b(launch|release|out now|available now)/i],
];

export function classify(item) {
  const hay = `${item.title} ${stripHtml(item.description)}`;
  const tags = TAG_RULES.filter(([, re]) => re.test(hay)).map(([t]) => t);
  return tags.length ? tags.slice(0, 3) : ["news"];
}

export function toNewsItem(item, now = new Date()) {
  const date = new Date(item.publishedAt);
  const publishedAt = Number.isNaN(date.getTime()) || date > now ? now.toISOString() : date.toISOString();
  const url = normalizeUrl(item.url);
  return {
    id: createHash("sha1").update(url).digest("hex").slice(0, 16),
    title: item.title.slice(0, 200),
    url: item.url,
    source: item.source,
    publishedAt,
    summary: excerpt(item.description),
    tags: classify(item),
  };
}

/** Merge new items into the existing feed: dedupe by URL and by title, newest first, capped. */
export function mergeNews(existing, incoming, cap = 200) {
  const seenUrl = new Set(existing.map((i) => normalizeUrl(i.url)));
  const seenTitle = new Set(existing.map((i) => normTitle(i.title)));
  const added = [];
  for (const item of incoming) {
    const u = normalizeUrl(item.url);
    const t = normTitle(item.title);
    if (seenUrl.has(u) || seenTitle.has(t)) continue;
    seenUrl.add(u);
    seenTitle.add(t);
    added.push(item);
  }
  const items = [...added, ...existing].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, cap);
  return { items, added };
}

/** Deterministic brief used when no AI key is configured. */
export function fallbackBrief(added, date) {
  const top = added.slice(0, 4);
  return {
    date,
    headline: added.length === 1 ? "One new GTA VI story today" : `${added.length} new GTA VI stories today`,
    bullets: top.map((i) => ({ text: `${i.source}: ${i.title}`, url: i.url })),
    model: "auto",
  };
}

/** Parse the JSON block a curator approves in a GitHub submission issue. */
export function parseSubmission(body) {
  const m = body?.match(/```json\s*([\s\S]*?)```/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[1]);
    if (typeof p.name !== "string" || typeof p.lng !== "number" || typeof p.lat !== "number") return null;
    return p;
  } catch {
    return null;
  }
}

export const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
