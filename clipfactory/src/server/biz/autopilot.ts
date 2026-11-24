import fs from "node:fs";
import path from "node:path";
import { captionFor, directionFrom, lessons, localDay, nextSlot, PLATFORM_NAME, PLATFORMS, type Account, type Campaign, type Creator, type PostRecord, type Vod } from "../../lib/biz.ts";
import { defaultPost } from "../../lib/post-text.ts";
import type { JobOptions, JobState, Short } from "../../lib/types.ts";
import { createJob, enqueue, getJob, update } from "../jobs.ts";
import { insideJob, WORKSPACE } from "../paths.ts";
import { status as ytStatus, isConnected as ytConnected } from "../youtube.ts";
import { AuthError, postTo, publisherReady, statsFor } from "./publishers.ts";
import { scoutTracked } from "./scout.ts";
import { biz, bizLog, mutate, newId } from "./store.ts";
import { twitchClips, twitchCreds } from "./twitch.ts";

// The autopilot: every few minutes it posts what's due; every scan it looks
// for new VODs from creators you're allowed to clip, turns them into shorts,
// schedules them across your accounts, and keeps their view counts fresh so
// you can see what each campaign owes you.

const TICK_MS = () => Number(process.env.CF_AUTOPILOT_TICK_MS || 60_000);
const STATS_EVERY_MS = 3 * 3600_000;

const g = globalThis as unknown as { __cfAutopilot?: { timer: NodeJS.Timeout | null; busy: boolean; scanning: boolean; tick: (() => Promise<void>) | null } };
const ap = (g.__cfAutopilot ??= { timer: null, busy: false, scanning: false, tick: null });

/** Ticks run whatever tick() is current, so a dev reload doesn't leave old code running. */
export function startAutopilot() {
  if (ap.timer) return;
  ap.timer = setInterval(() => void ap.tick?.(), TICK_MS());
  ap.timer.unref?.();
  setTimeout(() => void ap.tick?.(), 2000).unref?.();
}

// Only one process runs the autopilot (the dashboard's server or `npm run autopilot`).
const lockFile = () => path.join(WORKSPACE, "autopilot.lock");

function holdLock(): boolean {
  const now = Date.now();
  let ours = false;
  try {
    const cur = JSON.parse(fs.readFileSync(lockFile(), "utf8")) as { pid: number; at: number };
    if (cur.pid !== process.pid && now - cur.at < 3 * 60_000) return false;
    ours = cur.pid === process.pid;
  } catch {
    /* no lock yet */
  }
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, at: now }));
  // Taking over: an upload the last runner didn't finish goes back in the queue.
  if (!ours && biz().posts.some((p) => p.status === "uploading"))
    mutate((d) => {
      for (const p of d.posts) if (p.status === "uploading") p.status = "scheduled";
    });
  return true;
}

export function releaseLock() {
  try {
    const cur = JSON.parse(fs.readFileSync(lockFile(), "utf8")) as { pid: number };
    if (cur.pid === process.pid) fs.rmSync(lockFile(), { force: true });
  } catch {
    /* not ours */
  }
}

/** Another process holds the autopilot. */
export function runningElsewhere(): boolean {
  try {
    const cur = JSON.parse(fs.readFileSync(lockFile(), "utf8")) as { pid: number; at: number };
    return cur.pid !== process.pid && Date.now() - cur.at < 3 * 60_000;
  } catch {
    return false;
  }
}

ap.tick = tick;

export function stopAutopilot() {
  if (ap.timer) clearInterval(ap.timer);
  ap.timer = null;
}

export function autopilotRunning(): boolean {
  return Boolean(ap.timer);
}

export function nextScanAt(): number | undefined {
  const d = biz();
  if (!d.autopilot.enabled) return undefined;
  return (d.status.lastScanAt ?? 0) + d.autopilot.scanEveryMin * 60_000;
}

/** One pass: follow finished jobs, post what's due, refresh stats, scan when it's time. */
export async function tick(): Promise<void> {
  if (ap.busy || !holdLock()) return;
  ap.busy = true;
  try {
    syncAccounts();
    followJobs();
    await postDue();
    const d = biz();
    if (Date.now() - (d.status.lastStatsAt ?? 0) > STATS_EVERY_MS) await refreshStats();
    const next = nextScanAt();
    if (next !== undefined && Date.now() >= next) await scan();
  } catch (err) {
    bizLog(`Autopilot: ${(err as Error).message}`, "warn");
  } finally {
    ap.busy = false;
  }
}

/** Your connected YouTube channel shows up as an account by itself. */
export function syncAccounts() {
  if (!ytConnected()) return;
  const ch = ytStatus("").channel;
  if (!ch) return;
  const id = `youtube:${ch.id}`;
  if (biz().accounts.some((a) => a.id === id)) return;
  mutate((d) => {
    d.accounts.push({ id, platform: "youtube", name: ch.title, handle: ch.handle, avatar: ch.thumbnail, creatorIds: [], dailyLimit: 4, addedAt: Date.now() });
  });
}

const jobsToday = () => Object.values(biz().jobs).filter((j) => localDay(j.startedAt) === localDay(Date.now())).length;

/** The best active campaign for a creator. */
export function campaignFor(creatorId: string): Campaign | undefined {
  return biz()
    .campaigns.filter((k) => k.status === "active" && k.creatorIds.includes(creatorId) && (k.budgetLeft === undefined || k.budgetLeft > 0))
    .sort((a, b) => b.ratePer1k - a.ratePer1k)[0];
}

/** Look for new VODs and start jobs for the best ones the autopilot may take. */
export async function scan(opts: { manual?: boolean } = {}): Promise<{ started: number; looked: number }> {
  if (ap.scanning) return { started: 0, looked: 0 };
  ap.scanning = true;
  try {
    mutate((d) => {
      d.status.lastScanAt = Date.now();
      d.status.lastError = undefined;
    });
    const d = biz();
    const opps = await scoutTracked();
    let room = d.autopilot.maxJobsPerDay - jobsToday();
    let started = 0;
    for (const o of opps) {
      if (room <= 0) break;
      const c = d.creators.find((x) => x.id === o.creatorId);
      if (!c?.autopilot || o.blocked || !o.vod) continue;
      startVodJob(c, o.vod, o.campaign?.id);
      started++;
      room--;
    }
    // Fast lane: clips viewers made in the last few hours become shorts right away.
    if (room > 0) started += await clipLane(room);
    if (opts.manual || started) bizLog(`Scan: ${opps.length} creators checked, ${started} new job${started === 1 ? "" : "s"}${room <= 0 ? " (daily limit reached)" : ""}`);
    return { started, looked: opps.length };
  } catch (err) {
    mutate((d) => {
      d.status.lastError = (err as Error).message;
    });
    throw err;
  } finally {
    ap.scanning = false;
  }
}

function jobOptions(c: Creator, campaign: Campaign | undefined, extra: Partial<JobOptions> = {}): Partial<JobOptions> {
  const d = biz();
  const o = d.autopilot.options;
  const rules = campaign?.rules ?? {};
  const learned = directionFrom(lessons(d.posts, c.id), c.name);
  const direction = [rules.notes, learned].filter(Boolean).join(" ").slice(0, 900);
  return {
    ...o,
    name: c.handle.replace(/[^\w-]+/g, "").slice(0, 40) || undefined,
    count: d.autopilot.shortsPerVod,
    minSec: rules.minSec ?? o.minSec,
    maxSec: rules.maxSec ?? o.maxSec,
    instructions: direction || o.instructions,
    watermark: rules.watermark ?? o.watermark,
    disclosure: rules.disclosure,
    vocabulary: [c.name, ...(c.vocabulary ?? [])].filter(Boolean),
    publish: undefined,
    ...extra,
  };
}

export function startVodJob(c: Creator, vod: Vod, campaignId?: string): JobState {
  const campaign = campaignId ? biz().campaigns.find((k) => k.id === campaignId) : campaignFor(c.id);
  const job = createJob({ ...jobOptions(c, campaign), url: vod.url });
  enqueue(job.id);
  mutate((d) => {
    d.jobs[job.id] = { creatorId: c.id, campaignId: campaign?.id, vodId: vod.id, startedAt: Date.now() };
    const x = d.creators.find((y) => y.id === c.id);
    if (x) x.seenVods = [vod.id, ...(x.seenVods ?? []).filter((v) => v !== vod.id)].slice(0, 100);
  });
  bizLog(`Clipping ${c.name}: "${vod.title.slice(0, 80)}"${campaign ? ` for ${campaign.name}` : ""}`);
  return job;
}

/** Twitch clips viewers made in the last 6 hours, most viewed first, each turned into one short. */
async function clipLane(room: number): Promise<number> {
  if (!twitchCreds()) return 0;
  const d = biz();
  const min = Number(process.env.CF_CLIP_LANE_MIN_VIEWS || 2000);
  let started = 0;
  for (const c of d.creators.filter((x) => x.platform === "twitch" && x.autopilot && x.platformId)) {
    if (started >= room) break;
    const campaign = campaignFor(c.id);
    if (!campaign && c.permission !== "allowed") continue;
    if (!c.clipLane) continue;
    const since = new Date(Date.now() - 6 * 3600_000).toISOString();
    const clips = await twitchClips(c.platformId!, since, new Date().toISOString(), 100).catch(() => []);
    for (const clip of clips.filter((x) => x.view_count >= min && !(c.seenVods ?? []).includes(`clip:${x.id}`)).slice(0, room - started)) {
      const job = createJob({ ...jobOptions(c, campaign, { count: 1, minSec: Math.min(10, Math.max(3, clip.duration - 1)), maxSec: Math.ceil(clip.duration) + 1, teaser: false, slowmo: false }), url: clip.url });
      enqueue(job.id);
      mutate((dd) => {
        dd.jobs[job.id] = { creatorId: c.id, campaignId: campaign?.id, vodId: `clip:${clip.id}`, startedAt: Date.now() };
        const x = dd.creators.find((y) => y.id === c.id);
        if (x) x.seenVods = [`clip:${clip.id}`, ...(x.seenVods ?? [])].slice(0, 100);
      });
      bizLog(`Fast lane: ${c.name} clip "${clip.title.slice(0, 60)}" (${clip.view_count.toLocaleString()} views on Twitch)`);
      started++;
    }
  }
  return started;
}

/** Jobs the autopilot started that have finished get their posts scheduled. */
export function followJobs() {
  const d = biz();
  for (const [jobId, meta] of Object.entries(d.jobs)) {
    if (meta.posted) continue;
    const job = getJob(jobId);
    if (!job || job.status === "failed" || job.status === "canceled") {
      mutate((dd) => (dd.jobs[jobId].posted = true));
      if (job) bizLog(`Job ${job.name} ${job.status}: ${job.error ?? "nothing to post"}`, "warn");
      continue;
    }
    if (job.status !== "done") continue;
    const n = schedulePosts(job, meta.creatorId, meta.campaignId);
    mutate((dd) => (dd.jobs[jobId].posted = true));
    bizLog(n ? `Scheduled ${n} post${n === 1 ? "" : "s"} from ${job.name}` : `Nothing from ${job.name} cleared the bar (score ≥ ${d.autopilot.minScore}) or no account can take it`, n ? "info" : "warn");
  }
}

/**
 * The accounts a short goes to: one per platform (the same file on two
 * accounts of one platform gets them linked as duplicates). Per platform, the
 * creator's theme page if there is one, else a general account.
 */
export function accountsFor(creatorId: string | undefined, campaign?: Campaign): Account[] {
  const allowed = campaign?.rules.platforms?.length ? campaign.rules.platforms : PLATFORMS;
  const out: Account[] = [];
  for (const p of allowed) {
    const ready = biz().accounts.filter((a) => a.platform === p && !a.error && publisherReady(a));
    const theme = creatorId ? ready.find((a) => a.creatorIds.includes(creatorId)) : undefined;
    const general = ready.find((a) => !a.creatorIds.length) ?? (creatorId ? undefined : ready[0]);
    if (theme || general) out.push((theme ?? general)!);
  }
  return out;
}

/** Put a finished job's best shorts into posting slots on each account. Returns how many posts were scheduled. */
export function schedulePosts(job: JobState, creatorId?: string, campaignId?: string, shortIds?: string[]): number {
  const d = biz();
  const campaign = campaignId ? d.campaigns.find((k) => k.id === campaignId) : undefined;
  const shorts = job.shorts
    .filter((s) => (shortIds ? shortIds.includes(s.id) : s.score >= d.autopilot.minScore && s.qa?.ok !== false) && s.status === "done" && s.file)
    .sort((a, b) => b.score - a.score);
  const accounts = accountsFor(creatorId, campaign);
  let n = 0;
  for (const short of shorts) {
    for (const a of accounts) {
      if (d.posts.some((p) => p.jobId === job.id && p.shortId === short.id && p.accountId === a.id && p.status !== "failed")) continue;
      const taken = biz()
        .posts.filter((p) => p.accountId === a.id && p.status !== "failed")
        .map((p) => new Date(p.at).getTime());
      const at = nextSlot(taken, { hours: d.autopilot.postHours, spacingMin: d.autopilot.spacingMin, dailyLimit: a.dailyLimit });
      const base = defaultPost(job, short);
      const post: PostRecord = {
        id: newId("pst"),
        platform: a.platform,
        accountId: a.id,
        jobId: job.id,
        shortId: short.id,
        creatorId,
        campaignId: campaign?.id,
        title: short.title,
        caption: captionFor(a.platform, { title: short.title, description: a.platform === "youtube" ? base.description.replace(/\n\n#[^\n]*$/, "") : short.description, hashtags: short.hashtags }, campaign?.rules),
        status: "scheduled",
        at: new Date(at).toISOString(),
        views: 0,
        category: short.category,
        score: short.score,
        hook: short.hook,
        teaser: Boolean(short.teaser),
      };
      mutate((dd) => dd.posts.push(post));
      n++;
    }
  }
  return n;
}

/** Upload what's due. YouTube goes up early and publishes itself at its time; the others post at their time. */
export async function postDue(limit = 3): Promise<number> {
  const d = biz();
  const now = Date.now();
  const due = d.posts
    .filter((p) => p.status === "scheduled" && (!d.autopilot.approvePosts || p.approved))
    .filter((p) => {
      const t = new Date(p.at).getTime();
      if (p.platform === "youtube" && d.autopilot.privacy === "public") return true;
      return t <= now;
    })
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, limit);
  let done = 0;
  for (const p of due) {
    const a = d.accounts.find((x) => x.id === p.accountId);
    const job = getJob(p.jobId);
    const short = job?.shorts.find((s) => s.id === p.shortId);
    const set = (patch: Partial<PostRecord>) =>
      mutate((dd) => {
        const x = dd.posts.find((y) => y.id === p.id);
        if (x) Object.assign(x, patch);
      });
    if (!a || !job || !short?.file) {
      set({ status: "failed", error: !a ? "The account was removed" : "The short is gone" });
      continue;
    }
    if (!publisherReady(a)) {
      set({ status: "failed", error: `${PLATFORM_NAME[a.platform]} isn't connected` });
      continue;
    }
    set({ status: "uploading", error: undefined });
    const t = new Date(p.at).getTime();
    const publishAt = p.platform === "youtube" && t > now + 2 * 60_000 ? p.at : undefined;
    try {
      const res = await postTo(a, insideJob(job.id, short.file), { title: p.title, caption: p.caption, tags: short.hashtags, privacy: d.autopilot.privacy, publishAt, language: job.analysis.transcript?.language });
      set({ status: "posted", remoteId: res.remoteId, url: res.url, postedAt: publishAt ? t : Date.now(), error: res.note });
      mirrorToJob(job, short, p, res.remoteId, res.url, publishAt);
      bizLog(`Posted ${job.name}/${short.id} to ${a.name} (${PLATFORM_NAME[a.platform]})${publishAt ? `, goes live ${new Date(t).toLocaleString()}` : ""}`);
      const k = p.campaignId ? d.campaigns.find((x) => x.id === p.campaignId) : undefined;
      if (k?.submitWithinMin && !publishAt) bizLog(`Submit to ${k.name} within ${k.submitWithinMin} min: ${res.url ?? res.remoteId}`, "warn");
      done++;
    } catch (err) {
      const msg = (err as Error).message;
      set({ status: "failed", error: msg });
      if (err instanceof AuthError)
        mutate((dd) => {
          const x = dd.accounts.find((y) => y.id === a.id);
          if (x) x.error = msg;
        });
      bizLog(`Posting to ${a.name} failed: ${msg}`, "warn");
    }
  }
  return done;
}

/** Post one scheduled post right away (after you approved it). */
export async function postNow(id: string): Promise<void> {
  for (let i = 0; i < 20 && ap.busy; i++) await new Promise((r) => setTimeout(r, 500));
  const p = biz().posts.find((x) => x.id === id);
  if (!p || p.status !== "scheduled") return;
  const others = biz().posts.filter((x) => x.status === "scheduled" && x.id !== id && new Date(x.at).getTime() <= Date.now());
  // Post only this one: push the others back a moment.
  mutate((d) => d.posts.forEach((x) => others.some((o) => o.id === x.id) && (x.at = new Date(Date.now() + 60_000).toISOString())));
  ap.busy = true;
  try {
    await postDue(1);
  } finally {
    ap.busy = false;
  }
}

/** YouTube posts also show on the short in the job's dashboard. */
function mirrorToJob(job: JobState, short: Short, p: PostRecord, videoId: string, url: string | undefined, publishAt?: string) {
  if (p.platform !== "youtube") return;
  update(job.id, (s) => {
    const sh = s.shorts.find((x) => x.id === short.id);
    if (sh) sh.youtube = { status: publishAt ? "scheduled" : "posted", progress: 1, privacy: biz().autopilot.privacy, publishAt, title: p.title, videoId, url, postedAt: Date.now(), note: "Posted by the autopilot" };
  });
}

/** Fresh view counts for everything posted in the last 30 days. */
export async function refreshStats(): Promise<number> {
  mutate((d) => (d.status.lastStatsAt = Date.now()));
  const d = biz();
  const recent = d.posts.filter((p) => p.status === "posted" && p.remoteId && Date.now() - (p.postedAt ?? 0) < 30 * 86400_000 && (p.postedAt ?? 0) <= Date.now());
  const groups = new Map<string, PostRecord[]>();
  for (const p of recent) {
    const k = `${p.platform}|${p.accountId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  let n = 0;
  for (const [k, ps] of groups) {
    const [platform, accountId] = k.split("|") as [PostRecord["platform"], string];
    try {
      const stats = await statsFor(platform, accountId, ps.map((p) => p.remoteId!));
      mutate((dd) => {
        for (const p of dd.posts) {
          const s = p.remoteId ? stats.get(p.remoteId) : undefined;
          if (!s || p.accountId !== accountId) continue;
          p.views = s.views;
          p.likes = s.likes;
          p.comments = s.comments;
          p.statsAt = Date.now();
          n++;
        }
      });
    } catch (err) {
      bizLog(`Couldn't read ${PLATFORM_NAME[platform]} views: ${(err as Error).message}`, "warn");
    }
  }
  return n;
}
