#!/usr/bin/env node
/**
 * Daily intel job (run by .github/workflows/daily-intel.yml):
 *   1. Pull RSS/Atom feeds from data/sources.json
 *   2. Keep GTA VI stories, dedupe against data/news.json, tag them
 *   3. Write a short daily brief: AI-drafted with Claude when ANTHROPIC_API_KEY
 *      is set (our own words + source links), otherwise a plain headline list
 *
 * Headlines link to the original reporting; we never republish article bodies.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fallbackBrief, isRelevant, mergeNews, parseFeed, toNewsItem } from "./lib/intel.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NEWS_FILE = resolve(root, "data/news.json");
const SOURCES_FILE = resolve(root, "data/sources.json");
const UA = "NeonAtlasBot/1.0 (+unofficial GTA VI fan guide; daily headline aggregator)";

async function fetchFeed(src) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(src.url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/atom+xml, text/xml, */*" }, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseFeed(await res.text(), src.name);
  } finally {
    clearTimeout(timer);
  }
}

async function aiBrief(added, date) {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const listing = added
    .slice(0, 25)
    .map((i, n) => `${n + 1}. [${i.source}] ${i.title}\n   ${i.summary || ""}\n   ${i.url}`)
    .join("\n");
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["headline", "bullets"],
    properties: {
      headline: { type: "string", description: "Punchy 3-7 word headline for today's GTA VI news" },
      bullets: {
        type: "array",
        description: "3-5 bullets, most important first",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["text", "item"],
          properties: {
            text: { type: "string", description: "One or two sentences in your own words (no copying), under 220 characters" },
            item: { type: "integer", description: "Number of the story this bullet is based on" },
          },
        },
      },
    },
  };
  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system:
        "You write the daily news brief for Neon Atlas, an unofficial GTA VI fan guide. Summarize only what the listed headlines and excerpts say, in your own words. Never invent facts, numbers or quotes. Flag rumors as rumors. Plain, energetic English.",
      messages: [{ role: "user", content: `Today's new GTA VI stories (${date}):\n\n${listing}` }],
    });
    if (response.stop_reason === "refusal") throw new Error("model declined");
    const textBlock = response.content.find((b) => b.type === "text");
    const parsed = JSON.parse(textBlock?.text ?? "{}");
    const bullets = (parsed.bullets ?? [])
      .map((b) => ({ text: String(b.text).slice(0, 260), url: added[b.item - 1]?.url }))
      .filter((b) => b.text && b.url);
    if (!parsed.headline || !bullets.length) throw new Error("empty brief");
    return { date, headline: String(parsed.headline).slice(0, 80), bullets: bullets.slice(0, 5), model: "ai" };
  } catch (err) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    if (err instanceof Anthropic.RateLimitError) console.warn("[brief] rate limited; using fallback brief");
    else if (err instanceof Anthropic.AuthenticationError) console.warn("[brief] invalid ANTHROPIC_API_KEY; using fallback brief");
    else if (err instanceof Anthropic.APIError) console.warn(`[brief] API error ${err.status}; using fallback brief`);
    else console.warn(`[brief] ${err.message}; using fallback brief`);
    return fallbackBrief(added, date);
  }
}

const sources = JSON.parse(await readFile(SOURCES_FILE, "utf8"));
const news = JSON.parse(await readFile(NEWS_FILE, "utf8"));
const now = new Date();
const today = now.toISOString().slice(0, 10);

const results = await Promise.allSettled(sources.map(fetchFeed));
const fetched = [];
results.forEach((r, i) => {
  if (r.status === "fulfilled") fetched.push(...r.value);
  else console.warn(`[feed] ${sources[i].name}: ${r.reason?.message ?? r.reason}`);
});
const relevant = fetched.filter(isRelevant).map((i) => toNewsItem(i, now));
const { items, added } = mergeNews(news.items, relevant);
console.log(`[intel] ${fetched.length} feed items, ${relevant.length} about GTA VI, ${added.length} new`);

let brief = news.brief;
if (added.length) {
  brief = process.env.ANTHROPIC_API_KEY ? await aiBrief(added, today) : fallbackBrief(added, today);
}
const next = { updatedAt: now.toISOString(), brief, items };
await writeFile(NEWS_FILE, JSON.stringify(next, null, 2) + "\n");
console.log(`[intel] wrote ${items.length} items; brief: ${brief?.headline ?? "unchanged"}`);
