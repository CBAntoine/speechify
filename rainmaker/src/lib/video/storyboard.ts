// The script of a video ad: scenes, timing and the email that goes with it.
// A template version for when Claude isn't connected, the checks every
// script passes (only real facts and numbers, tidy lengths), and timing from
// the voiceover. Pure, unit tested.

import type { VideoFact, VideoScene } from "../types.ts";
import { productText, type ProductBrief } from "./facts.ts";

export interface StoryInput {
  business: string;
  city?: string;
  /** "HVAC company", "dentist"... */
  kind: string;
  facts: VideoFact[];
  products: ProductBrief[];
  agency: { name: string; owner?: string; phone?: string; email?: string; calendarUrl?: string; mailingAddress?: string };
  hasLogo: boolean;
  hasPhoto: boolean;
}

export interface Story {
  scenes: VideoScene[];
  email: { subject: string; body: string };
}

/** Where the video's link goes in the email. */
export const LINK = "{{video_link}}";

const LIMIT = { headline: 48, sub: 110, voiceover: 260, statValue: 14, statLabel: 40, subject: 70 };

const cut = (s: string | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const words = t.slice(0, max + 1).split(" ");
  words.pop();
  return (words.join(" ") || t.slice(0, max)).replace(/[,;:\-–]+$/, "") + "…";
};

const first = (s: string) => s.split(/(?<=[.!?])\s/)[0];

/** "No online booking: Customers can only call" → label and detail. */
function split(f: VideoFact): { label: string; detail: string } {
  const [label, ...rest] = f.text.split(":");
  const detail = rest.join(":").trim().replace(/\.$/, "");
  return { label: label.replace(/\.$/, "").trim(), detail: detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : "" };
}

const lower = (s: string) => (/^[A-Z]{2,}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** Findings are written about the business; the video speaks to its owner. */
export function toYou(s: string): string {
  return s.replace(/\bTheir\b/g, "Your").replace(/\btheir\b/g, "your").replace(/\bThey\b/g, "You").replace(/\bthey\b/g, "you").replace(/\bthem\b/g, "you");
}

/** "AI receptionist answers every call…" when the tagline starts with a verb, else "Voiceovers: radio-quality…". */
export function productLine(name: string, tagline: string): string {
  const tag = tagline.trim().replace(/\.$/, "");
  const verb = /^[A-Z][a-z]+s$/.test(tag.split(" ")[0]) && !/ss$/.test(tag.split(" ")[0]);
  return verb ? `${name} ${lower(tag)}.` : `${name}: ${tag}.`;
}

/** The email that goes with a video: real details, the link, and the footer commercial email needs. */
export function withFooter(body: string, a: StoryInput["agency"]): string {
  let out = body.trim();
  if (!out.includes(LINK)) out += `\n\nWatch it here: ${LINK}`;
  const sender = a.owner || a.name;
  if (!out.includes(sender)) out += `\n\n${sender}${a.owner ? `\n${a.name}` : ""}`;
  if (!/postal address|\d{2,}.*\b(st|street|ave|avenue|rd|road|blvd|suite|unit|po box)\b/i.test(out)) out += `\n${a.mailingAddress || "[agency postal address]"}`;
  if (!/not interested\?/i.test(out)) out += `\n\nNot interested? Reply "no" and I won't follow up.`;
  return out;
}

/** A video ad without AI: the business's own facts, its biggest gap, a scene per product, and a call to action. */
export function templateStory(input: StoryInput): Story {
  const { facts, products, business } = input;
  const scenes: VideoScene[] = [];
  const identity = facts.find((f) => f.kind === "business");
  const rating = facts.find((f) => /rated [\d.]+ stars from \d+/i.test(f.text));
  const services = facts.find((f) => f.text.startsWith("Services on their website"));
  const headline = facts.find((f) => f.text.startsWith("Their website's headline"));
  const gaps = facts.filter((f) => f.kind === "gap");
  const worth = facts.find((f) => f.kind === "industry" && f.text.startsWith("What one new customer is worth"));

  scenes.push({
    kind: "hook",
    headline: cut(business, LIMIT.headline),
    sub: "What we found, and how to win more customers",
    voiceover: `We made this for ${business}. Here's what we found, and how to win more customers from it.`,
    visual: input.hasLogo ? "logo" : input.hasPhoto ? "photo" : "plain",
    factIds: identity ? [identity.id] : [],
  });
  if (rating) {
    const m = rating.text.match(/rated ([\d.]+) stars from (\d+)/i)!;
    scenes.push({
      kind: "fact",
      headline: "Customers already love you",
      sub: cut(`${m[1]} stars from ${m[2]} Google reviews`, LIMIT.sub),
      voiceover: `You're rated ${m[1]} stars from ${m[2]} reviews. That's a reputation worth putting in front of more people.`,
      visual: "stat",
      stat: { value: `${m[1]}★`, label: `${m[2]} Google reviews` },
      factIds: [rating.id],
    });
  } else if (headline || services) {
    const f = (headline ?? services)!;
    scenes.push({
      kind: "fact",
      headline: "What you're known for",
      sub: cut(f.text.replace(/^[^:]+:\s*/, "").replace(/^"|"$/g, ""), LIMIT.sub),
      voiceover: cut(`Your website says it plainly: ${f.text.replace(/^[^:]+:\s*/, "").replace(/^"|"$/g, "")}`, LIMIT.voiceover),
      visual: input.hasPhoto ? "photo" : "website",
      factIds: [f.id],
    });
  }
  gaps.slice(0, 2).forEach((g, i) => {
    const { label, detail } = split(g);
    scenes.push({
      kind: "problem",
      headline: cut(label, LIMIT.headline),
      sub: cut(toYou(detail) || "From our website check", LIMIT.sub),
      voiceover: cut(toYou(`${i === 0 ? "One thing we noticed" : "Also"}: ${lower(label)}.${detail ? ` ${first(detail)}.` : ""}`.replace(/\.\./g, ".")), LIMIT.voiceover),
      visual: "website",
      factIds: [g.id],
    });
  });
  for (const p of products.slice(0, 3)) {
    const tag = p.tagline.replace(/\.$/, "");
    scenes.push({
      kind: "solution",
      headline: cut(p.name, LIMIT.headline),
      sub: cut(p.fixes ? `Fixes: ${lower(p.fixes)}` : tag, LIMIT.sub),
      voiceover: cut(p.fixes ? `${p.fixes}? ${productLine(p.name, tag)}` : productLine(p.name, tag), LIMIT.voiceover),
      visual: "product",
      productId: p.id,
      factIds: [],
    });
  }
  // What a customer is worth to them, when the video isn't long already.
  if (worth && products.length <= 2) {
    const value = worth.text.replace(/^[^:]+:\s*/, "").split(/;\s*/)[0].replace(/\.$/, "");
    scenes.push({
      kind: "fact",
      headline: "Every customer counts",
      sub: cut(`One new customer: ${value} (industry estimate)`, LIMIT.sub),
      voiceover: cut(`As a rough industry estimate, one new customer is worth ${value}. So every call you catch counts.`, LIMIT.voiceover),
      visual: "plain",
      factIds: [worth.id],
    });
  }
  scenes.push({
    kind: "cta",
    headline: "Ready when you are",
    sub: cut([input.agency.name, input.agency.phone].filter(Boolean).join(" · "), LIMIT.sub),
    voiceover: `We can set this up for ${business} this week. Reply to the email and we'll show you how.`,
    visual: input.hasLogo ? "logo" : "plain",
    factIds: [],
  });

  const hi = "Hi,";
  const gap = gaps[0] ? split(gaps[0]) : undefined;
  const noticed = gap ? lower(toYou(gap.detail || gap.label)) : "";
  const body = [
    hi,
    "",
    `I made a short video for ${business}${input.city ? ` in ${input.city}` : ""}.${noticed ? ` It starts with something we noticed: ${noticed}.` : ""}${products.length ? ` Then it shows how ${list(products.map((p) => p.name))} would help.` : ""}`,
    "",
    `Watch it here: ${LINK}`,
    "",
    "Worth a quick call this week?",
  ]
    .filter((l, i, arr) => l !== "" || arr[i - 1] !== "")
    .join("\n");
  return { scenes, email: { subject: cut(`A short video I made for ${business}`, LIMIT.subject), body: withFooter(body, input.agency) } };
}

function list(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const NUMBER = /\d[\d,.]*\d|\d/g;
const norm = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "").replace(/\.$/, "");

/** Numbers in a line that appear nowhere in the facts or products: likely made up. */
export function ungroundedNumbers(text: string, corpus: string): string[] {
  const known = new Set((corpus.match(NUMBER) ?? []).map(norm));
  return (text.match(NUMBER) ?? []).map(norm).filter((n) => !known.has(n));
}

/**
 * Make a script safe to show: known facts and products only, no numbers the
 * facts don't contain, tidy lengths, a hook first and a call to action last.
 * Returns the scenes and what was changed.
 */
export function groundStory(story: Story, input: StoryInput): { story: Story; dropped: string[] } {
  const factIds = new Set(input.facts.map((f) => f.id));
  const productIds = new Set(input.products.map((p) => p.id));
  const corpus = [...input.facts.map((f) => `${f.text} ${f.source}`), ...input.products.map(productText), input.agency.phone ?? ""].join(" \n ");
  const dropped: string[] = [];
  const scenes: VideoScene[] = [];
  for (const raw of story.scenes) {
    const s: VideoScene = {
      kind: raw.kind,
      headline: cut(raw.headline, LIMIT.headline),
      sub: cut(raw.sub, LIMIT.sub),
      voiceover: cut(raw.voiceover, LIMIT.voiceover),
      visual: raw.visual,
      stat: raw.stat ? { value: cut(raw.stat.value, LIMIT.statValue), label: cut(raw.stat.label, LIMIT.statLabel) } : undefined,
      productId: raw.productId && productIds.has(raw.productId) ? raw.productId : undefined,
      factIds: (raw.factIds ?? []).filter((id) => factIds.has(id)),
    };
    if (s.visual === "product" && !s.productId) s.visual = "plain";
    if (s.visual === "logo" && !input.hasLogo) s.visual = input.hasPhoto ? "photo" : "plain";
    if (s.visual === "photo" && !input.hasPhoto) s.visual = input.hasLogo ? "logo" : "plain";
    if (s.stat && ungroundedNumbers(`${s.stat.value} ${s.stat.label}`, corpus).length) {
      dropped.push(`stat "${s.stat.value} ${s.stat.label}"`);
      s.stat = undefined;
      if (s.visual === "stat") s.visual = "plain";
    }
    if (s.visual === "stat" && !s.stat) s.visual = "plain";
    const bad = ungroundedNumbers(`${s.headline} ${s.sub} ${s.voiceover}`, corpus);
    if (bad.length && s.kind !== "cta") {
      dropped.push(`scene "${s.headline}" (numbers not in the facts: ${bad.join(", ")})`);
      continue;
    }
    if (!s.headline) continue;
    scenes.push(s);
  }
  if (scenes[0]?.kind !== "hook") {
    const t = templateStory(input).scenes[0];
    scenes.unshift(t);
  }
  if (scenes[scenes.length - 1]?.kind !== "cta") scenes.push(templateStory(input).scenes.at(-1)!);
  const capped = scenes.length > 9 ? [...scenes.slice(0, 8), scenes[scenes.length - 1]] : scenes;
  return {
    story: {
      scenes: capped,
      email: { subject: cut(story.email.subject, LIMIT.subject) || templateStory(input).email.subject, body: withFooter(story.email.body, input.agency) },
    },
    dropped,
  };
}

// ── Timing ───────────────────────────────────────────────────

/** Scene lengths without a voiceover: time to read it, 3 to 7 seconds. */
export function estimateTiming(scenes: VideoScene[]): { starts: number[]; total: number } {
  const starts: number[] = [];
  let t = 0;
  for (const s of scenes) {
    starts.push(Math.round(t * 100) / 100);
    const words = `${s.voiceover || `${s.headline} ${s.sub}`}`.split(/\s+/).length;
    t += Math.min(7, Math.max(3, words / 2.6 + 0.8));
  }
  return { starts, total: Math.round(t * 100) / 100 };
}

/** The narration as one text, and where each scene's words start in it. */
export function narration(scenes: VideoScene[]): { text: string; offsets: number[] } {
  const offsets: number[] = [];
  let text = "";
  for (const s of scenes) {
    if (text) text += " ";
    offsets.push(text.length);
    text += s.voiceover.trim() || s.headline;
  }
  return { text, offsets };
}

/**
 * Scene starts from the voiceover's character timings: each scene starts
 * just before its first word is spoken; the video ends a beat after the last.
 */
export function alignedTiming(
  offsets: number[],
  alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
): { starts: number[]; total: number } {
  const starts = offsets.map((o, i) => {
    if (i === 0) return 0;
    const t = alignment.character_start_times_seconds[Math.min(o, alignment.character_start_times_seconds.length - 1)] ?? 0;
    return Math.max(0, Math.round((t - 0.15) * 100) / 100);
  });
  const end = alignment.character_end_times_seconds.at(-1) ?? 0;
  return { starts, total: Math.round((end + 1.2) * 100) / 100 };
}
