import type { Account, Platform } from "../../lib/biz.ts";
import type { Privacy } from "../../lib/types.ts";
import { status as ytStatus, isConnected, uploadVideo } from "../youtube.ts";
import { igPost, igReady, igStats } from "./instagram.ts";
import { tiktokPost, tiktokReady, tiktokStats } from "./tiktok.ts";
import { ytVideos } from "./ytdata.ts";

// One interface over the platforms the autopilot posts to.

export interface PostMeta {
  title: string;
  caption: string;
  tags: string[];
  privacy: Privacy;
  /** YouTube only: publish then (the video waits as private). */
  publishAt?: string;
  language?: string;
}

export interface Posted {
  remoteId: string;
  url?: string;
  /** Uploaded but the platform is still processing or the user has to finish it in the app. */
  note?: string;
}

export interface Stats {
  views: number;
  likes?: number;
  comments?: number;
}

export class AuthError extends Error {}

export function publisherReady(a: Account): boolean {
  if (a.platform === "youtube") return isConnected() && ytStatus("").channel?.id === a.id.slice("youtube:".length);
  if (a.platform === "tiktok") return tiktokReady(a.id);
  return igReady(a.id);
}

export async function postTo(a: Account, file: string, meta: PostMeta, onProgress?: (f: number) => void): Promise<Posted> {
  if (a.platform === "youtube") {
    const v = await uploadVideo(file, { title: meta.title, description: meta.caption, tags: meta.tags, privacy: meta.privacy, publishAt: meta.publishAt, language: meta.language }, { onProgress });
    return { remoteId: v.id, url: `https://youtube.com/shorts/${v.id}` };
  }
  if (a.platform === "tiktok") return tiktokPost(a.id, file, meta, onProgress);
  return igPost(a.id, file, meta, onProgress);
}

export async function statsFor(platform: Platform, accountId: string, ids: string[]): Promise<Map<string, Stats>> {
  if (!ids.length) return new Map();
  if (platform === "youtube") {
    const vids = await ytVideos(ids);
    return new Map(vids.map((v) => [v.id, { views: v.views ?? 0, likes: v.likes, comments: v.comments }]));
  }
  if (platform === "tiktok") return tiktokStats(accountId, ids);
  return igStats(accountId, ids);
}
