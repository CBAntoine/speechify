import { earnings, lessons, PLATFORMS, scoreCreator, type Account, type BizView, type Campaign, type CampaignRules, type Creator, type Permission, type Platform } from "../../lib/biz.ts";
import { getJob } from "../jobs.ts";
import { parseOptions } from "../options.ts";
import { autopilotRunning, campaignFor, nextScanAt, postNow, refreshStats, runningElsewhere, scan, schedulePosts, startVodJob, syncAccounts } from "./autopilot.ts";
import { connectInstagram, forgetInstagram } from "./instagram.ts";
import { kickLivestreams, kickReady, saveKickCreds } from "./kick.ts";
import { publisherReady } from "./publishers.ts";
import { discover, lookupCreator, parseCreator, recentVods, scoutTracked } from "./scout.ts";
import { biz, bizLog, mutate, newId } from "./store.ts";
import { forgetTiktok, saveTiktokApp, tiktokApp } from "./tiktok.ts";
import { saveTwitchCreds, twitchCreds, twitchUsers } from "./twitch.ts";
import { saveYtApiKey, ytApiKey, ytDataReady, ytTrending } from "./ytdata.ts";

// What the dashboard reads, and every change it can make.

export class BizError extends Error {}

export type Snapshot = BizView;

export function snapshot(): Snapshot {
  syncAccounts();
  // Twitch's developer terms: keep its data at most 24 hours.
  if (biz().suggestionsAt && Date.now() - biz().suggestionsAt! > 24 * 3600_000)
    mutate((dd) => {
      dd.suggestions = [];
      dd.suggestionsAt = undefined;
    });
  const d = biz();
  const today = new Date().toDateString();
  // Without a scout run yet, rank from what's stored (no VOD info).
  const opportunities = d.opportunities.length ? d.opportunities : d.creators.map((c) => scoreCreator(c, { campaigns: d.campaigns, posts: d.posts })).sort((a, b) => b.score - a.score);
  const app = tiktokApp();
  return {
    creators: d.creators,
    campaigns: d.campaigns,
    accounts: d.accounts,
    posts: [...d.posts].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 600),
    autopilot: d.autopilot,
    status: {
      running: autopilotRunning() || runningElsewhere(),
      lastScanAt: d.status.lastScanAt,
      nextScanAt: nextScanAt(),
      lastError: d.status.lastError,
      jobsToday: Object.values(d.jobs).filter((j) => new Date(j.startedAt).toDateString() === today).length,
      log: d.status.log.slice(-60),
    },
    connections: { twitch: Boolean(twitchCreds()), kick: kickReady(), youtubeData: ytDataReady(), tiktok: { configured: Boolean(app) }, instagram: { configured: true } },
    suggestions: d.suggestions,
    suggestionsAt: d.suggestionsAt,
    opportunities,
    opportunitiesAt: d.opportunitiesAt,
    earnings: earnings(d.posts, d.campaigns, d.creators),
    lessons: lessons(d.posts),
    accountsReady: Object.fromEntries(d.accounts.map((a) => [a.id, publisherReady(a)])),
    setup: { twitch: Boolean(twitchCreds()), kick: kickReady(), youtubeKey: Boolean(ytApiKey()), tiktokApp: app ? { clientKey: app.clientKey, redirectUri: app.redirectUri } : undefined },
  };
}

// ── Validation ───────────────────────────────────────────────────────

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
const list = (v: unknown, max = 30, len = 60) =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().slice(0, len))
        .filter(Boolean)
        .slice(0, max)
    : typeof v === "string"
      ? v
          .split(/[,\n]/)
          .map((x) => x.trim().slice(0, len))
          .filter(Boolean)
          .slice(0, max)
      : undefined;
const PERMS: Permission[] = ["campaign", "allowed", "unknown", "denied"];

function cleanRules(r: Record<string, unknown> | undefined): CampaignRules {
  const o = r ?? {};
  const platforms = (list(o.platforms, 3) ?? []).filter((p): p is Platform => (PLATFORMS as string[]).includes(p));
  const minSec = num(o.minSec, 5, 170);
  const maxSec = num(o.maxSec, 8, 180);
  return {
    requiredText: str(o.requiredText, 300) || undefined,
    hashtags: list(o.hashtags, 15, 40)?.map((h) => h.replace(/^#/, "")),
    mentions: list(o.mentions, 10, 40)?.map((m) => (m.startsWith("@") ? m : `@${m}`)),
    minSec,
    maxSec: maxSec && minSec && maxSec < minSec + 3 ? minSec + 3 : maxSec,
    platforms: platforms.length ? platforms : undefined,
    watermark: str(o.watermark, 40) || undefined,
    disclosure: str(o.disclosure, 30) || undefined,
    notes: str(o.notes, 500) || undefined,
  };
}

// ── Actions ──────────────────────────────────────────────────────────

type Body = Record<string, unknown> & { action?: string };

export async function act(body: Body): Promise<unknown> {
  const d = biz();
  switch (body.action) {
    case "creator.add": {
      const input = str(body.input, 300) ?? "";
      const parsed = parseCreator(input);
      if (!parsed) throw new BizError('Paste a channel link: twitch.tv/name, kick.com/name or youtube.com/@name.');
      const c = await lookupCreator(parsed.platform, parsed.handle).catch((err) => {
        throw new BizError((err as Error).message);
      });
      if (d.creators.some((x) => x.id === c.id)) throw new BizError(`${c.name} is already on your list.`);
      const perm = PERMS.includes(body.permission as Permission) ? (body.permission as Permission) : "unknown";
      mutate((dd) => dd.creators.push({ ...c, permission: perm, permissionNote: str(body.permissionNote, 200), autopilot: perm === "campaign" || perm === "allowed" }));
      bizLog(`Tracking ${c.name} (${c.platform})`);
      void scoutTracked({ only: [c.id] }).catch(() => {});
      return { id: c.id };
    }
    case "creator.update": {
      const id = str(body.id);
      const p = (body.patch ?? {}) as Record<string, unknown>;
      const c = d.creators.find((x) => x.id === id);
      if (!c) throw new BizError("No such creator.");
      mutate(() => {
        if (PERMS.includes(p.permission as Permission)) c.permission = p.permission as Permission;
        if (p.permissionNote !== undefined) c.permissionNote = str(p.permissionNote, 200);
        if (typeof p.autopilot === "boolean") c.autopilot = p.autopilot;
        if (typeof p.clipLane === "boolean") c.clipLane = p.clipLane;
        if (p.vocabulary !== undefined) c.vocabulary = list(p.vocabulary, 40, 40);
        if (p.tags !== undefined) c.tags = list(p.tags, 10, 30);
        if (c.permission === "denied") c.autopilot = false;
      });
      return { ok: true };
    }
    case "creator.remove": {
      const id = str(body.id);
      mutate((dd) => {
        dd.creators = dd.creators.filter((x) => x.id !== id);
        dd.opportunities = dd.opportunities.filter((x) => x.creatorId !== id);
        for (const k of dd.campaigns) k.creatorIds = k.creatorIds.filter((x) => x !== id);
        for (const a of dd.accounts) a.creatorIds = a.creatorIds.filter((x) => x !== id);
      });
      return { ok: true };
    }
    case "creator.track": {
      // From a discovery suggestion.
      const s = d.suggestions.find((x) => x.id === str(body.id));
      if (!s) throw new BizError("That suggestion is gone; refresh discovery.");
      if (d.creators.some((x) => x.id === s.id)) throw new BizError(`${s.name} is already on your list.`);
      const c = await lookupCreator(s.platform, s.handle).catch(() => null);
      const campaign = s.campaignId ? d.campaigns.find((k) => k.id === s.campaignId) : undefined;
      const creator: Creator = { ...(c ?? { id: s.id, platform: s.platform, handle: s.handle, name: s.name, url: s.url, avatar: s.avatar, addedAt: Date.now(), permission: "unknown", autopilot: false }), stats: s.stats, permission: campaign ? "campaign" : "unknown", autopilot: Boolean(campaign), language: s.language, tags: s.category ? [s.category] : undefined };
      mutate((dd) => {
        dd.creators.push(creator);
        dd.suggestions = dd.suggestions.filter((x) => x.id !== s.id);
      });
      return { id: creator.id };
    }
    case "creator.clip": {
      // Start a job on the creator's newest unclipped VOD now.
      const c = d.creators.find((x) => x.id === str(body.id));
      if (!c) throw new BizError("No such creator.");
      if (c.permission === "denied") throw new BizError(`${c.name} doesn't want clips.`);
      const vods = await recentVods(c).catch((err) => {
        throw new BizError((err as Error).message);
      });
      const seen = new Set(c.seenVods ?? []);
      const vod = vods.find((v) => !seen.has(v.id) && !v.live) ?? vods.find((v) => !v.live);
      if (!vod) throw new BizError(c.platform === "kick" ? "Kick doesn't list VODs to apps: paste the VOD link into New VOD." : `No finished VOD from ${c.name} found.`);
      const job = startVodJob(c, vod);
      return { jobId: job.id };
    }
    case "campaign.save": {
      const raw = (body.campaign ?? {}) as Record<string, unknown>;
      const rate = num(raw.ratePer1k, 0, 1000);
      const name = str(raw.name, 100);
      if (!name) throw new BizError("Give the campaign a name.");
      if (rate === undefined) throw new BizError("Enter what it pays per 1,000 views.");
      const url = str(raw.url, 500);
      if (url && !/^https?:\/\//i.test(url)) throw new BizError("The campaign link should start with https://");
      const creatorIds = (list(raw.creatorIds, 20, 120) ?? []).filter((id) => d.creators.some((c) => c.id === id));
      const fields: Omit<Campaign, "id" | "addedAt"> = {
        name,
        url,
        creatorIds,
        ratePer1k: rate,
        minViews: num(raw.minViews, 0, 1e9),
        maxPerPost: num(raw.maxPerPost, 0, 1e7),
        budget: num(raw.budget, 0, 1e9),
        budgetLeft: num(raw.budgetLeft, 0, 1e9),
        endsAt: str(raw.endsAt, 40),
        status: raw.status === "paused" || raw.status === "ended" ? raw.status : "active",
        rules: cleanRules(raw.rules as Record<string, unknown>),
        submitWithinMin: num(raw.submitWithinMin, 1, 7 * 24 * 60),
        feePct: num(raw.feePct, 0, 50),
      };
      const id = str(raw.id);
      const existing = id ? d.campaigns.find((k) => k.id === id) : undefined;
      const saved = mutate((dd) => {
        if (existing) {
          Object.assign(existing, fields);
          return existing;
        }
        const k: Campaign = { id: newId("cmp"), addedAt: Date.now(), ...fields };
        dd.campaigns.push(k);
        return k;
      });
      // A campaign for a creator is their permission to be clipped.
      mutate((dd) => {
        for (const c of dd.creators) if (saved.creatorIds.includes(c.id) && c.permission === "unknown") {
          c.permission = "campaign";
          c.permissionNote = `Campaign: ${saved.name}`;
          c.autopilot = true;
        }
      });
      bizLog(`${existing ? "Updated" : "Added"} campaign ${saved.name} ($${saved.ratePer1k}/1K views)`);
      return { id: saved.id };
    }
    case "campaign.remove": {
      const id = str(body.id);
      mutate((dd) => (dd.campaigns = dd.campaigns.filter((k) => k.id !== id)));
      return { ok: true };
    }
    case "account.update": {
      const a = d.accounts.find((x) => x.id === str(body.id));
      if (!a) throw new BizError("No such account.");
      const p = (body.patch ?? {}) as Record<string, unknown>;
      mutate(() => {
        if (p.creatorIds !== undefined) a.creatorIds = (list(p.creatorIds, 50, 120) ?? []).filter((id) => d.creators.some((c) => c.id === id));
        const lim = num(p.dailyLimit, 0, 50);
        if (lim !== undefined) a.dailyLimit = Math.round(lim);
        if (p.clearError) a.error = undefined;
      });
      return { ok: true };
    }
    case "account.remove": {
      const a = d.accounts.find((x) => x.id === str(body.id));
      if (!a) return { ok: true };
      if (a.platform === "tiktok") forgetTiktok(a.id);
      if (a.platform === "instagram") forgetInstagram(a.id);
      mutate((dd) => {
        dd.accounts = dd.accounts.filter((x) => x.id !== a.id);
        for (const p of dd.posts) if (p.accountId === a.id && p.status === "scheduled") {
          p.status = "failed";
          p.error = "Account removed";
        }
      });
      return { ok: true };
    }
    case "instagram.connect": {
      const token = str(body.token, 2000);
      if (!token || token.length < 20) throw new BizError("Paste a long-lived access token from your Meta app.");
      const got = await connectInstagram(token).catch((err) => {
        throw new BizError((err as Error).message);
      });
      mutate((dd) => {
        for (const g of got) {
          const existing = dd.accounts.find((a) => a.id === g.accountId);
          if (existing) {
            existing.error = undefined;
            continue;
          }
          dd.accounts.push({ id: g.accountId, platform: "instagram", name: `@${g.login.username}`, handle: g.login.username, avatar: g.login.avatar, creatorIds: [], dailyLimit: 4, addedAt: Date.now() });
        }
      });
      bizLog(`Connected Instagram: ${got.map((g) => `@${g.login.username}`).join(", ")}`);
      return { accounts: got.map((g) => g.accountId) };
    }
    case "tiktok.app": {
      const clientKey = str(body.clientKey, 200);
      const clientSecret = str(body.clientSecret, 200);
      const redirectUri = str(body.redirectUri, 500);
      if (!clientKey || !clientSecret || !redirectUri) throw new BizError("Enter the client key, the client secret and the redirect URI you registered.");
      if (!/^https?:\/\//.test(redirectUri)) throw new BizError("The redirect URI should be a full URL.");
      saveTiktokApp({ clientKey, clientSecret, redirectUri });
      return { ok: true };
    }
    case "creds.twitch": {
      const clientId = str(body.clientId, 200);
      const clientSecret = str(body.clientSecret, 200);
      if (!clientId || !clientSecret) throw new BizError("Enter both the client ID and the client secret.");
      saveTwitchCreds({ clientId, clientSecret });
      await twitchUsers(["twitch"]).catch((err) => {
        throw new BizError(`Saved, but Twitch said: ${(err as Error).message}`);
      });
      return { ok: true };
    }
    case "creds.kick": {
      const clientId = str(body.clientId, 200);
      const clientSecret = str(body.clientSecret, 200);
      if (!clientId || !clientSecret) throw new BizError("Enter both the client ID and the client secret.");
      saveKickCreds({ clientId, clientSecret });
      await kickLivestreams({ limit: 1 }).catch((err) => {
        throw new BizError(`Saved, but Kick said: ${(err as Error).message}`);
      });
      return { ok: true };
    }
    case "creds.youtubeKey": {
      const key = str(body.key, 200);
      if (!key) throw new BizError("Paste an API key.");
      saveYtApiKey(key);
      await ytTrending("20", "US", 1).catch((err) => {
        throw new BizError(`Saved, but YouTube said: ${(err as Error).message}`);
      });
      return { ok: true };
    }
    case "autopilot.update": {
      const p = (body.patch ?? {}) as Record<string, unknown>;
      mutate((dd) => {
        const a = dd.autopilot;
        if (typeof p.enabled === "boolean") a.enabled = p.enabled;
        a.scanEveryMin = num(p.scanEveryMin, 5, 24 * 60) ?? a.scanEveryMin;
        a.maxJobsPerDay = Math.round(num(p.maxJobsPerDay, 0, 100) ?? a.maxJobsPerDay);
        a.shortsPerVod = Math.round(num(p.shortsPerVod, 1, 50) ?? a.shortsPerVod);
        a.minScore = Math.round(num(p.minScore, 0, 100) ?? a.minScore);
        a.spacingMin = Math.round(num(p.spacingMin, 10, 24 * 60) ?? a.spacingMin);
        a.maxVodAgeHours = num(p.maxVodAgeHours, 1, 24 * 30) ?? a.maxVodAgeHours;
        if (Array.isArray(p.postHours) && p.postHours.length === 2) {
          const h0 = num(p.postHours[0], 0, 23);
          const h1 = num(p.postHours[1], 1, 24);
          if (h0 !== undefined && h1 !== undefined && h1 > h0) a.postHours = [Math.round(h0), Math.round(h1)];
        }
        if (p.privacy === "public" || p.privacy === "unlisted" || p.privacy === "private") a.privacy = p.privacy;
        if (typeof p.approvePosts === "boolean") a.approvePosts = p.approvePosts;
        if (p.options && typeof p.options === "object") a.options = parseOptions({ ...a.options, ...(p.options as object) });
      });
      if (typeof p.enabled === "boolean") bizLog(p.enabled ? "Autopilot on" : "Autopilot off");
      return { ok: true };
    }
    case "autopilot.scan": {
      void scan({ manual: true }).catch((err) => bizLog(`Scan failed: ${(err as Error).message}`, "warn"));
      return { ok: true };
    }
    case "scout.refresh": {
      void scoutTracked().catch((err) => bizLog(`Scout failed: ${(err as Error).message}`, "warn"));
      void discover({ language: str(body.language, 5) || undefined }).catch((err) => bizLog(`Discovery failed: ${(err as Error).message}`, "warn"));
      return { ok: true };
    }
    case "stats.refresh": {
      void refreshStats().catch((err) => bizLog(`Stats failed: ${(err as Error).message}`, "warn"));
      return { ok: true };
    }
    case "post.schedule": {
      const job = getJob(str(body.jobId) ?? "");
      if (!job || job.status !== "done") throw new BizError("That job hasn't finished.");
      const creatorId = str(body.creatorId) || biz().jobs[job.id]?.creatorId;
      const campaignId = str(body.campaignId) || biz().jobs[job.id]?.campaignId || (creatorId ? campaignFor(creatorId)?.id : undefined);
      const n = schedulePosts(job, creatorId, campaignId, list(body.shortIds, 50, 40));
      if (!n) throw new BizError("No connected account can take these (or they're already scheduled).");
      bizLog(`Scheduled ${n} post${n === 1 ? "" : "s"} from ${job.name}`);
      return { scheduled: n };
    }
    case "post.update": {
      const p = d.posts.find((x) => x.id === str(body.id));
      if (!p) throw new BizError("No such post.");
      const patch = (body.patch ?? {}) as Record<string, unknown>;
      mutate(() => {
        if (patch.submitted === true) {
          p.submittedAt = Date.now();
          // Some campaigns only pay for views from here on.
          p.viewsAtSubmit = p.views;
        }
        if (patch.submitted === false) {
          p.submittedAt = undefined;
          p.viewsAtSubmit = undefined;
        }
        const paid = num(patch.paid, 0, 1e7);
        if (paid !== undefined) p.paid = paid;
        if (patch.retry && (p.status === "failed" || p.status === "scheduled")) {
          p.status = "scheduled";
          p.error = undefined;
          if (new Date(p.at).getTime() < Date.now()) p.at = new Date(Date.now() + 60_000).toISOString();
        }
        if (typeof patch.at === "string" && Number.isFinite(Date.parse(patch.at)) && p.status === "scheduled") p.at = new Date(patch.at).toISOString();
        if (typeof patch.caption === "string" && p.status === "scheduled") p.caption = patch.caption.slice(0, 5000);
      });
      return { ok: true };
    }
    case "post.approve": {
      // "Ask me first" mode: go now.
      const p = d.posts.find((x) => x.id === str(body.id));
      if (!p || p.status !== "scheduled") throw new BizError("That post isn't waiting.");
      mutate(() => {
        p.approved = true;
        p.at = new Date(Date.now() - 1000).toISOString();
      });
      void postNow(p.id);
      return { ok: true };
    }
    case "post.remove": {
      const p = d.posts.find((x) => x.id === str(body.id));
      if (p && (p.status === "scheduled" || p.status === "failed")) mutate((dd) => (dd.posts = dd.posts.filter((x) => x.id !== p.id)));
      return { ok: true };
    }
    default:
      throw new BizError("Unknown action.");
  }
}

/** Add or refresh a TikTok account after its login. */
export function addTiktokAccount(accountId: string, name: string, handle?: string, avatar?: string, mode: "direct" | "draft" = "draft") {
  mutate((dd) => {
    const existing = dd.accounts.find((a) => a.id === accountId);
    if (existing) {
      existing.error = undefined;
      existing.name = name;
      return;
    }
    const acc: Account = { id: accountId, platform: "tiktok", name, handle, avatar, creatorIds: [], dailyLimit: mode === "draft" ? 5 : 4, addedAt: Date.now() };
    dd.accounts.push(acc);
  });
  bizLog(`Connected TikTok ${name} (${mode === "draft" ? "drafts to your inbox" : "direct post"})`);
}

