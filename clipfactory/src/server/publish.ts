import path from "node:path";
import { defaultPost } from "../lib/post-text.ts";
import type { Privacy, PublishPlan, YouTubePost } from "../lib/types.ts";
import { getJob, log, update } from "./jobs.ts";
import { insideJob } from "./paths.ts";
import { isConnected, uploadVideo, videoResource, videoState, type VideoMeta } from "./youtube.ts";

// Posting shorts to the connected YouTube channel, one upload at a time, with
// progress and results written into the job so the dashboard shows them.

interface Task {
  jobId: string;
  shortId: string;
  meta: VideoMeta;
}

const g = globalThis as unknown as { __cfPublish?: { queue: Task[]; busy: boolean; waiters: (() => void)[] } };
const q = (g.__cfPublish ??= { queue: [], busy: false, waiters: [] });

export interface PostInput {
  title?: string;
  description?: string;
  privacy: Privacy;
  publishAt?: string;
}

export class PublishError extends Error {}

/**
 * When each short goes live (undefined = post now). With a future startAt,
 * the first goes out then and the rest every N hours after; with only
 * everyHours, the first posts now and the rest follow every N hours; with
 * neither, all post now. YouTube does the scheduled publishing, so this
 * computer doesn't need to stay on.
 */
export function scheduleTimes(count: number, startAt?: string, everyHours?: number, now = Date.now()): (string | undefined)[] {
  const step = Math.max(0, everyHours ?? 0) * 3600_000;
  const t0 = startAt ? new Date(startAt).getTime() : NaN;
  if (startAt && !Number.isFinite(t0)) throw new PublishError("That schedule time isn't a valid date.");
  if (Number.isFinite(t0) && t0 > now + 90_000) return Array.from({ length: count }, (_, i) => new Date(t0 + i * (step || 24 * 3600_000)).toISOString());
  if (step) return Array.from({ length: count }, (_, i) => (i === 0 ? undefined : new Date(now + i * step).toISOString()));
  return Array.from({ length: count }, () => undefined);
}

export function publishShort(jobId: string, shortId: string, input: PostInput): YouTubePost {
  if (!isConnected()) throw new PublishError("Connect a YouTube channel first.");
  const job = getJob(jobId);
  const short = job?.shorts.find((s) => s.id === shortId);
  if (!job || !short) throw new PublishError("No such short.");
  if (short.status !== "done" || !short.file) throw new PublishError("That short isn't rendered yet.");
  if (short.youtube && ["queued", "uploading", "processing"].includes(short.youtube.status)) throw new PublishError("That short is already being posted.");
  if (input.publishAt && new Date(input.publishAt).getTime() < Date.now() + 60_000) throw new PublishError("Pick a schedule time at least a minute from now.");
  const d = defaultPost(job, short);
  const meta: VideoMeta = {
    title: input.title?.trim() || d.title,
    description: input.description ?? d.description,
    tags: d.tags,
    privacy: input.privacy,
    publishAt: input.publishAt,
    language: job.analysis.transcript?.language,
  };
  const post: YouTubePost = { status: "queued", progress: 0, privacy: input.privacy, publishAt: input.publishAt, title: videoResource(meta).snippet.title };
  update(jobId, (s) => {
    const sh = s.shorts.find((x) => x.id === shortId);
    if (sh) sh.youtube = post;
  });
  q.queue.push({ jobId, shortId, meta });
  void pump();
  return post;
}

/** Post every shipped short that isn't on YouTube yet, in posting order. Returns how many were queued. */
export function publishAll(jobId: string, plan: PublishPlan): number {
  const job = getJob(jobId);
  if (!job) throw new PublishError("No such job.");
  const todo = job.shorts
    .filter((s) => s.status === "done" && s.file && (!s.youtube || s.youtube.status === "failed"))
    .sort((a, b) => (a.order ?? a.n) - (b.order ?? b.n));
  // YouTube can only schedule a video to go public.
  const times = plan.privacy === "public" ? scheduleTimes(todo.length, plan.startAt, plan.everyHours) : todo.map(() => undefined);
  todo.forEach((s, i) => publishShort(jobId, s.id, { privacy: plan.privacy, publishAt: times[i] }));
  return todo.length;
}

/** Resolves once every queued upload has finished (used by the CLI). */
export function uploadsDone(): Promise<void> {
  if (!q.busy && !q.queue.length) return Promise.resolve();
  return new Promise((resolve) => q.waiters.push(resolve));
}

async function pump() {
  if (q.busy) return;
  q.busy = true;
  try {
    while (q.queue.length) await run(q.queue.shift()!);
  } finally {
    q.busy = false;
    for (const w of q.waiters.splice(0)) w();
  }
}

const REJECTED: Record<string, string> = {
  duplicate: "YouTube rejected it as a duplicate of a video already on the channel.",
  copyright: "YouTube rejected it for copyright.",
  claim: "YouTube rejected it because of a copyright claim.",
  termsOfUse: "YouTube rejected it for its terms of use.",
  length: "YouTube rejected it for its length.",
};

async function run(t: Task) {
  const set = (patch: Partial<YouTubePost>) =>
    update(t.jobId, (s) => {
      const sh = s.shorts.find((x) => x.id === t.shortId);
      if (sh?.youtube) sh.youtube = { ...sh.youtube, ...patch };
    });
  const short = getJob(t.jobId)?.shorts.find((x) => x.id === t.shortId);
  if (!short?.file) return;
  const name = path.basename(short.file);
  set({ status: "uploading", progress: 0, error: undefined, note: undefined });
  log(t.jobId, `Posting ${name} to YouTube${t.meta.publishAt ? ` (scheduled ${new Date(t.meta.publishAt).toLocaleString()})` : ""}`);
  let last = 0;
  try {
    const video = await uploadVideo(insideJob(t.jobId, short.file), t.meta, {
      onProgress: (f) => {
        if (f === 1 || Date.now() - last > 400) {
          last = Date.now();
          set({ progress: f });
        }
      },
    });
    const scheduled = Boolean(t.meta.publishAt);
    const url = `https://youtube.com/shorts/${video.id}`;
    const wanted = scheduled ? "private" : t.meta.privacy;
    const got = video.status?.privacyStatus;
    set({
      status: "processing",
      progress: 1,
      videoId: video.id,
      url,
      postedAt: Date.now(),
      note: got && got !== wanted ? `YouTube made it ${got} (your channel's upload defaults may override the API). Change it in YouTube Studio.` : undefined,
    });
    log(t.jobId, `${name} is on YouTube: ${url}`);
    // Follow processing for a few minutes; YouTube finishes on its own either way.
    const every = Number(process.env.CF_YT_POLL_MS || 10000);
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, every));
      const st = await videoState(video.id).catch(() => null);
      if (!st?.uploadStatus || st.uploadStatus === "uploaded") continue;
      if (st.uploadStatus === "processed") break;
      const why = st.uploadStatus === "rejected" ? (REJECTED[st.rejectionReason ?? ""] ?? `YouTube rejected it${st.rejectionReason ? ` (${st.rejectionReason})` : ""}.`) : `YouTube couldn't process it${st.failureReason ? ` (${st.failureReason})` : ""}.`;
      set({ status: "failed", error: why });
      log(t.jobId, `${name}: ${why}`, "warn");
      return;
    }
    set({ status: scheduled ? "scheduled" : "posted" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    set({ status: "failed", error: msg });
    log(t.jobId, `Posting ${name} failed: ${msg}`, "warn");
  }
}
