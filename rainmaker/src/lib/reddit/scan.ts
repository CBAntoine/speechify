import "server-only";
import { describeError } from "@/lib/claude/client";
import { readRedditPosts, writeRedditEmail, writeRedditReply } from "@/lib/claude/reddit";
import { claudeEnabled } from "@/lib/config";
import { friendlyNetError, normalizeUrl } from "@/lib/net";
import { auditWebsite } from "@/lib/prospecting/audit";
import { mapLimit } from "@/lib/prospecting/audit";
import { deriveSignals, scoreProspect } from "@/lib/prospecting/score";
import { addActivity, createDraft, createLead, getLead, getProfile, updateLead } from "@/lib/repo";
import { readDb, update } from "@/lib/store";
import type { Draft, Lead, RedditSignal } from "@/lib/types";
import { templateEmail, templateReply, withSignature } from "./drafts";
import { DEFAULT_REDDIT, cleanSubreddits, parseListing, rankPosts, statedBusiness, statedContacts, type RedditConfig, type RedditPost } from "./intent";

// The Reddit buyer scan: newest posts from your subreddits, scored for
// buying intent, read by Claude, and kept for you to act on. Through Reddit's
// official API when REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET are set (a free
// "script" app at reddit.com/prefs/apps), otherwise its public feed.

const UA = process.env.REDDIT_USER_AGENT || "web:rainmaker-crm:1.0 (finds public requests for services)";

export function redditOAuth(): boolean {
  return Boolean(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
}

const g = globalThis as { __rmReddit?: { token?: string; expires?: number } };
const cache = (g.__rmReddit ??= {});

async function accessToken(): Promise<string | undefined> {
  if (!redditOAuth()) return undefined;
  if (cache.token && (cache.expires ?? 0) > Date.now() + 60_000) return cache.token;
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) throw new Error(`Reddit didn't accept your app's credentials (HTTP ${res.status}). Check REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET.`);
  cache.token = data.access_token;
  cache.expires = Date.now() + (data.expires_in ?? 3600) * 1000;
  return cache.token;
}

async function getListing(path: string): Promise<RedditPost[]> {
  const token = await accessToken();
  const url = token ? `https://oauth.reddit.com${path}` : `https://www.reddit.com${path.replace("?", ".json?")}`;
  const res = await fetch(url, { headers: { "user-agent": UA, ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(15_000), cache: "no-store" }).catch((err) => {
    throw new Error(`Couldn't reach Reddit (${friendlyNetError(err, 15_000)})`);
  });
  if (res.status === 403 || res.status === 429) {
    throw new Error(token ? `Reddit is rate limiting this app (HTTP ${res.status}). Try again in a few minutes.` : "Reddit blocked the request from your server. Add REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET (a free app at reddit.com/prefs/apps).");
  }
  if (res.status === 404) throw new Error("not found (check the name)");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseListing(await res.json());
}

export function redditConfig(db: { reddit?: { config: RedditConfig } }): RedditConfig {
  return { ...DEFAULT_REDDIT, ...(db.reddit?.config ?? {}) };
}

export async function redditState() {
  const db = await readDb();
  return { config: redditConfig(db), signals: db.reddit?.signals ?? [], lastScanAt: db.reddit?.lastScanAt, lastErrors: db.reddit?.lastErrors ?? [] };
}

export async function saveRedditConfig(patch: Partial<RedditConfig>): Promise<RedditConfig> {
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, 40) : undefined);
  return update((db) => {
    const cur = redditConfig(db);
    const next: RedditConfig = {
      subreddits: patch.subreddits ? cleanSubreddits(list(patch.subreddits) ?? []) : cur.subreddits,
      services: list(patch.services) ?? cur.services,
      competitors: list(patch.competitors) ?? cur.competitors,
      maxAgeHours: typeof patch.maxAgeHours === "number" && patch.maxAgeHours > 0 ? Math.min(72, patch.maxAgeHours) : cur.maxAgeHours,
      minScore: typeof patch.minScore === "number" ? Math.max(0, Math.min(100, Math.round(patch.minScore))) : cur.minScore,
      morning: typeof patch.morning === "boolean" ? patch.morning : cur.morning,
    };
    db.reddit = { ...(db.reddit ?? { signals: [] }), config: next };
    return next;
  });
}

/** Read the subreddits, keep the fresh buying-intent posts, and have Claude read the best of them. */
export async function scanReddit(createdBy = "user", opts: { maxAgeHours?: number } = {}): Promise<{ found: number; added: number; errors: string[]; signals: RedditSignal[] }> {
  const db = await readDb();
  const saved = redditConfig(db);
  const config = { ...saved, maxAgeHours: Math.max(saved.maxAgeHours, opts.maxAgeHours ?? 0) };
  if (!config.subreddits.length) throw new Error("Add at least one subreddit to watch.");
  const errors: string[] = [];
  const lists = await mapLimit(config.subreddits, 3, (sub) =>
    getListing(`/r/${sub}/new?limit=100&raw_json=1`).catch((err) => {
      errors.push(`r/${sub}: ${err instanceof Error ? err.message : String(err)}`);
      return [] as RedditPost[];
    })
  );
  if (errors.length === config.subreddits.length) throw new Error(errors[0].replace(/^r\/\S+: /, ""));
  const ranked = rankPosts(lists.flat(), config);
  const now = new Date().toISOString();
  let found: RedditSignal[] = ranked.map((r) => ({
    id: r.post.id,
    subreddit: r.post.subreddit,
    author: r.post.author,
    title: r.post.title,
    body: r.post.body.slice(0, 2000),
    url: r.post.url,
    createdAt: r.post.createdAt,
    comments: r.post.comments,
    score: r.score,
    kinds: r.kinds,
    reasons: r.reasons,
    urgent: r.urgent,
    budget: r.budget,
    services: r.services,
    competitors: r.competitors,
    contact: statedContacts(`${r.post.title}\n${r.post.body}`),
    status: "new",
    foundAt: now,
  }));

  // Claude reads the best posts it hasn't read yet: real intent, and what they said about themselves.
  const known = new Map((db.reddit?.signals ?? []).map((s) => [s.id, s]));
  const unread = found.filter((s) => !known.get(s.id)?.ai).slice(0, 25);
  if (claudeEnabled() && unread.length) {
    try {
      const reads = await readRedditPosts(unread, db.profile);
      found = found
        .map((s) => ({ ...s, ai: reads.get(s.id) ?? known.get(s.id)?.ai }))
        .filter((s) => s.ai?.intent !== "none");
    } catch (err) {
      errors.push(`Claude couldn't read the posts: ${describeError(err)}`);
    }
  }

  const added = await update((d) => {
    const cur = d.reddit?.signals ?? [];
    const byId = new Map(cur.map((s) => [s.id, s]));
    let fresh = 0;
    for (const s of found) {
      const old = byId.get(s.id);
      if (old) byId.set(s.id, { ...s, ai: s.ai ?? old.ai, status: old.status, leadId: old.leadId, reply: old.reply, foundAt: old.foundAt });
      else {
        byId.set(s.id, s);
        fresh++;
      }
    }
    const signals = [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 300);
    d.reddit = { config: redditConfig(d), signals, lastScanAt: now, lastErrors: errors };
    return fresh;
  });
  if (added) {
    const subs = [...new Set(found.map((s) => `r/${s.subreddit}`))].slice(0, 3).join(", ");
    await addActivity({ kind: "lead", text: `${createdBy === "autopilot" ? "Autopilot" : createdBy === "copilot" ? "The copilot" : "You"} found ${added} new Reddit buyer${added === 1 ? "" : "s"} in ${subs}` });
  }
  return { found: found.length, added, errors, signals: found };
}

async function signal(id: string): Promise<RedditSignal> {
  const s = ((await readDb()).reddit?.signals ?? []).find((x) => x.id === id);
  if (!s) throw new Error("That post isn't in your list any more. Scan again.");
  return s;
}

async function patchSignal(id: string, patch: Partial<RedditSignal>): Promise<RedditSignal> {
  return update((db) => {
    const s = (db.reddit?.signals ?? []).find((x) => x.id === id);
    if (!s) throw new Error("That post isn't in your list any more.");
    Object.assign(s, patch);
    return { ...s };
  });
}

export async function setSignalStatus(id: string, status: RedditSignal["status"]): Promise<RedditSignal> {
  return patchSignal(id, { status });
}

/** A helpful public reply that discloses who you are, to post yourself. */
export async function replyToSignal(id: string): Promise<RedditSignal> {
  const s = await signal(id);
  const profile = await getProfile();
  const reply = claudeEnabled() ? await writeRedditReply(s, profile) : templateReply(s, profile);
  return patchSignal(id, { reply });
}

/**
 * Add the poster to the pipeline. When the post names a business or website,
 * the lead is that business, and its website is checked for its public
 * contact details. Anonymous posters stay as their Reddit name.
 */
export async function saveSignalAsLead(id: string): Promise<{ signal: RedditSignal; lead: Lead }> {
  const s = await signal(id);
  if (s.leadId) {
    const existing = await getLead(s.leadId);
    if (existing) return { signal: s, lead: existing };
  }
  const website = normalizeUrl(s.ai?.website ?? s.contact.websites[0]);
  const lead = await createLead(
    {
      name: s.ai?.business || statedBusiness(`${s.title}\n${s.body}`) || `u/${s.author}`,
      niche: "custom",
      city: s.ai?.location,
      website,
      email: s.contact.emails[0],
      source: "reddit",
      notes: `Asked on Reddit (u/${s.author} in r/${s.subreddit}, ${new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}): "${s.title}"\n${s.url}${s.ai?.summary ? `\n${s.ai.summary}` : ""}${s.budget || s.ai?.budget ? `\nBudget: ${s.ai?.budget ?? s.budget}` : ""}`,
      score: s.score,
    },
    "user"
  );
  let saved = lead;
  if (website) {
    try {
      const audit = await auditWebsite(website);
      const base = { website, phone: lead.phone, booking: false, audit, source: "reddit" as const };
      const signals = deriveSignals(base);
      saved = await updateLead(lead.id, { audit, signals, score: Math.max(s.score, scoreProspect(base, signals)), email: lead.email ?? audit.emails[0], phone: lead.phone ?? audit.phones[0] });
    } catch {
      // Their site didn't load: the lead is still saved with the post.
    }
  }
  const updated = await patchSignal(id, { status: "saved", leadId: saved.id });
  await addActivity({ kind: "lead", text: `Saved ${saved.name} from Reddit (r/${s.subreddit})`, leadId: saved.id });
  return { signal: updated, lead: saved };
}

/** The two-line email about their exact post, as a draft in the Inbox. Only to an address they or their business published. */
export async function emailSignal(id: string, to?: string): Promise<{ signal: RedditSignal; draft: Draft }> {
  const s = await signal(id);
  const lead = s.leadId ? await getLead(s.leadId) : undefined;
  const address = (to?.trim() || s.contact.emails[0] || lead?.email || "").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
    throw new Error("No public email for them yet. Save them as a lead (their business website is checked for one), add one they shared, or reply on Reddit instead.");
  }
  const profile = await getProfile();
  const name = lead?.contactName;
  const e = claudeEnabled() ? await writeRedditEmail(s, profile, name) : templateEmail(s, profile, name);
  const draft = await createDraft({
    leadId: lead?.id,
    leadName: lead?.name ?? `u/${s.author}`,
    channel: "email",
    to: address,
    subject: e.subject.slice(0, 80),
    body: withSignature(e.body, profile),
    rationale: `They asked in r/${s.subreddit} ${Math.max(1, Math.round((Date.now() - Date.parse(s.createdAt)) / 3_600_000))} h ago: "${s.title.slice(0, 90)}"`,
    createdBy: "user",
  });
  const updated = await patchSignal(id, { status: "drafted" });
  return { signal: updated, draft };
}
