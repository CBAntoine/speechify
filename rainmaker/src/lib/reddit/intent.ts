// Reddit buyers: people who just asked, in public, for what you sell. Read
// recent posts from chosen subreddits, find the buying-intent phrases
// ("recommendations for", "alternative to", "looking for a good", "got
// burned by", "has anyone used"), and score how ready each one is to buy.
// Pure, unit tested.

export interface RedditConfig {
  /** Subreddit names, without r/. */
  subreddits: string[];
  /** What you sell, as people say it: "web designer", "Facebook ads". */
  services: string[];
  /** Companies people leave or compare: "GoHighLevel", "Podium". */
  competitors: string[];
  /** Only posts this fresh. */
  maxAgeHours: number;
  /** Hide posts scoring below this. */
  minScore: number;
  /** Autopilot checks every morning. */
  morning: boolean;
}

export const DEFAULT_REDDIT: RedditConfig = {
  subreddits: ["smallbusiness", "Entrepreneur", "sweatystartup", "marketing", "DigitalMarketing", "PPC", "SEO", "webdev"],
  services: ["marketing agency", "web designer", "website", "Facebook ads", "Google ads", "SEO", "lead generation", "answering service", "receptionist", "chatbot", "booking system", "review"],
  competitors: ["GoHighLevel", "Podium", "Birdeye", "Smith.ai", "Ruby Receptionists", "Thryv", "Scorpion", "Angi", "HomeAdvisor", "Yelp ads"],
  maxAgeHours: 4,
  minScore: 50,
  morning: false,
};

export interface RedditPost {
  id: string;
  subreddit: string;
  author: string;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  comments: number;
  flair?: string;
}

/** The buying-intent phrases, from the playbook. */
export const PHRASES = [
  { id: "recommend", label: "Asking for recommendations", weight: 40, re: /\b(any(one|body)?|can (any|some)one|could (any|some)one|who do you)\b[^.?!\n]{0,40}\b(recommend|suggest)|\brecommendations? (for|on)\b|\bsuggestions? for\b|\bany recs?\b/i },
  { id: "alternative", label: "Wants an alternative", weight: 40, re: /\balternatives? (to|for)\b|\binstead of\b|\breplacement for\b|\bswitch(ing)? (from|away from)\b|\bmov(e|ing) (away )?from\b/i },
  { id: "looking", label: "Looking to hire", weight: 30, re: /\b(looking for|in search of|searching for|need(ing)?|hire|hiring|want to hire)\b (a |an |some |someone |somebody )?(good |reliable |decent |affordable |great |trustworthy |legit |solid )?/i },
  { id: "burned", label: "Got burned by a provider", weight: 35, re: /\b(got|been|getting|was) (burned|burnt|scammed|ripped off|screwed)\b|\bterrible experience with\b|\b(fired|firing|leaving|left|cancel(l?ing|l?ed)?|ditch(ing|ed)?) (my|our)\b[^.?!\n]{0,20}\b(agency|marketer|marketing|developer|designer|seo|freelancer|provider)\b/i },
  { id: "vetting", label: "Checking a provider", weight: 30, re: /\bhas anyone (here )?(used|tried|worked with|hired)\b|\b(are|is) (they|it) (any good|worth it|legit)\b/i },
  // Vaguer ("thoughts on X?") counts only when X is a competitor.
  { id: "opinion", label: "Asking about a provider", weight: 25, re: /\bthoughts on\b|\bexperiences? with\b|\breviews? (of|on)\b/i },
] as const;

export type PhraseId = (typeof PHRASES)[number]["id"];

const SELF_PROMO = /\[(for hire|offer|offering|hiring\]?\s*\[remote)\]|\b(i|we) (offer|provide|sell|build|run an? (agency|business that))\b|\bdm me (for|if you need)\b|\bmy (agency|services) (can|will)\b|\b(free audit|free consultation) for\b/i;
const URGENT = /\burgent(ly)?\b|\basap\b|\bthis week\b|\bimmediately\b|\bright away\b|\bby (monday|tomorrow|friday)\b/i;
const BUDGET = /\$\s?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s?(?:k\b|K\b)?|\b\d{1,4}\s?k\b(?= budget| per month|\/mo| a month)|\bbudget (?:is|of|around|~)\s?\$?\d[\d,]*k?/;

const words = (s: string) => s.toLowerCase();

function mentions(text: string, terms: string[]): string[] {
  const t = words(text);
  return terms.filter((term) => {
    const k = term.trim().toLowerCase();
    if (!k) return false;
    const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z0-9])${esc}s?([^a-z0-9]|$)`, "i").test(t);
  });
}

export interface Scored {
  post: RedditPost;
  score: number;
  ageHours: number;
  kinds: PhraseId[];
  services: string[];
  competitors: string[];
  urgent: boolean;
  budget?: string;
  /** Why it scored, in a few words. */
  reasons: string[];
}

/**
 * How likely the poster is to buy what you sell, 0 to 100. A post must ask
 * (one of the phrases) about something you sell (a service or competitor
 * term); offers, ads and job seekers score 0.
 */
export function scorePost(post: RedditPost, config: Pick<RedditConfig, "services" | "competitors">, now = Date.now()): Scored {
  const text = `${post.title}\n${post.body}`;
  const ageHours = Math.max(0, (now - Date.parse(post.createdAt)) / 3_600_000);
  const services = mentions(text, config.services);
  const competitors = mentions(text, config.competitors);
  const kinds = PHRASES.filter((p) => p.re.test(text) && (p.id !== "opinion" || competitors.length > 0)).map((p) => p.id);
  const urgent = URGENT.test(text);
  const budget = text.match(BUDGET)?.[0]?.trim();
  const base: Scored = { post, score: 0, ageHours, kinds, services, competitors, urgent, budget, reasons: [] };
  if (SELF_PROMO.test(text) || /for hire|offer/i.test(post.flair ?? "")) return { ...base, reasons: ["Looks like an offer, not a request"] };
  if (!kinds.length || (!services.length && !competitors.length)) return base;

  const reasons: string[] = [];
  let score = Math.max(...kinds.map((k) => PHRASES.find((p) => p.id === k)!.weight));
  reasons.push(PHRASES.find((p) => p.id === kinds[0])!.label);
  if (kinds.length > 1) score += 5;
  if (services.length) {
    score += 25;
    reasons.push(`Needs ${services.slice(0, 2).join(", ")}`);
  }
  if (competitors.length) {
    score += 20;
    reasons.push(`Mentions ${competitors.slice(0, 2).join(", ")}`);
  }
  if (urgent) {
    score += 10;
    reasons.push("Urgent");
  }
  if (budget) {
    score += 10;
    reasons.push(`Budget ${budget}`);
  }
  if (/\?/.test(post.title)) score += 5;
  if (ageHours < 1) score += 5;
  return { ...base, score: Math.min(100, score), reasons };
}

/** Posts worth your morning: fresh, asking, scored, best first. */
export function rankPosts(posts: RedditPost[], config: RedditConfig, now = Date.now()): Scored[] {
  const seen = new Set<string>();
  return posts
    .filter((p) => !seen.has(p.id) && seen.add(p.id))
    .map((p) => scorePost(p, config, now))
    .filter((s) => s.ageHours <= config.maxAgeHours && s.score >= config.minScore)
    .sort((a, b) => b.score - a.score || a.ageHours - b.ageHours);
}

type Child = { kind?: string; data?: Record<string, unknown> };

/** Posts from a Reddit listing (search or new), without removed, pinned or adult ones. */
export function parseListing(json: unknown): RedditPost[] {
  const children = ((json as { data?: { children?: Child[] } })?.data?.children ?? []) as Child[];
  const out: RedditPost[] = [];
  for (const c of children) {
    const d = c.data ?? {};
    if (c.kind !== "t3" || d.stickied || d.over_18) continue;
    const author = String(d.author ?? "");
    const body = String(d.selftext ?? "");
    if (!author || author === "[deleted]" || author === "AutoModerator" || body === "[removed]" || body === "[deleted]") continue;
    const created = Number(d.created_utc);
    if (!Number.isFinite(created)) continue;
    out.push({
      id: String(d.name ?? `t3_${d.id}`),
      subreddit: String(d.subreddit ?? ""),
      author,
      title: String(d.title ?? "").trim(),
      body: body.trim().slice(0, 4000),
      url: `https://www.reddit.com${String(d.permalink ?? "")}`,
      createdAt: new Date(created * 1000).toISOString(),
      comments: Number(d.num_comments ?? 0),
      flair: d.link_flair_text ? String(d.link_flair_text) : undefined,
    });
  }
  return out;
}

/** The business a poster says is theirs: "I run Bright Smile Dental", "my company, Apex Roofing". */
export function statedBusiness(text: string): string | undefined {
  const m = text.match(/\b(?:I|we) (?:run|own|manage|operate|started|have) (?:a [a-z]+ (?:called|named) )?((?:[A-Z][\w&'.-]*)(?:\s+(?:[A-Z][\w&'.-]*|&|of|and)){0,4})/) ?? text.match(/\bmy (?:business|company|shop|clinic|practice|firm),? ((?:[A-Z][\w&'.-]*)(?:\s+(?:[A-Z][\w&'.-]*|&|of|and)){0,4})/);
  const name = m?.[1]?.replace(/\s+(?:and|of|&)$/, "").trim();
  return name && name.split(/\s+/).length >= 2 && !/^(I|We|My|The|A)$/i.test(name) ? name : undefined;
}

/** Contact details the poster chose to share in the post itself. */
export function statedContacts(text: string): { emails: string[]; websites: string[] } {
  const emails = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))].filter((e) => !/@(reddit|example)\./.test(e));
  const withoutEmails = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ");
  const websites = [
    ...new Set(
      (withoutEmails.match(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|ca|net|org|co|io|biz|us|info)(?:\/[^\s)]*)?/gi) ?? [])
        .map((u) => u.replace(/[.,)]+$/, ""))
        .filter((u) => !/reddit\.com|redd\.it|imgur\.com|youtube\.com|google\.com|facebook\.com|instagram\.com|linkedin\.com/i.test(u) && !u.includes("@"))
    ),
  ];
  return { emails, websites: websites.slice(0, 3) };
}

/** Subreddit names as typed: "r/Calgary", "/r/smallbusiness ", "Calgary". */
export function cleanSubreddits(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim().replace(/^\/?r\//i, "").replace(/[^A-Za-z0-9_]/g, "")).filter((s) => s.length >= 2 && s.length <= 21))].slice(0, 20);
}

export function ago(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min ago`;
  return `${Math.round(hours)} h ago`;
}
