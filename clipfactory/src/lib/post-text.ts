import type { JobState, Short } from "./types.ts";

/** What a short's YouTube post says unless you edit it: its title, description, a link to the full stream, and hashtags. */
export function defaultPost(job: Pick<JobState, "source">, short: Pick<Short, "title" | "description" | "hashtags">): { title: string; description: string; tags: string[] } {
  // Case-insensitive dedupe: the scorer's "shorts" and our "Shorts" are the same tag.
  const seen = new Set<string>();
  const hashtags = [...short.hashtags.map((h) => h.replace(/^#/, "").replace(/\s+/g, "")), "Shorts"].filter((h) => {
    const k = h.toLowerCase();
    if (!h || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const url = job.source?.url;
  const credit = url && /^https?:\/\//.test(url) && !/\/\/(127\.0\.0\.1|localhost)[:/]/.test(url) ? `\n\nFull stream: ${url}` : "";
  return {
    title: short.title,
    description: `${short.description}${credit}\n\n${hashtags.map((h) => `#${h}`).join(" ")}`.trim(),
    tags: short.hashtags,
  };
}
