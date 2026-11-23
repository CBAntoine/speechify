import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createJob, enqueue, removeJob } from "@/server/app";
import { parseOptions } from "@/server/options";
import { jobDir } from "@/server/paths";

export const dynamic = "force-dynamic";

const VIDEO = /\.(mp4|m4v|mov|mkv|webm|avi|flv|ts)$/i;

/**
 * Upload a VOD as the raw request body (no multipart, so multi-GB files stream
 * straight to disk): PUT /api/upload?name=stream.mp4&options={...}
 */
export async function PUT(req: Request) {
  const url = new URL(req.url);
  const name = path.basename(url.searchParams.get("name") ?? "");
  if (!req.body) return Response.json({ error: "Empty upload" }, { status: 400 });
  if (!VIDEO.test(name)) return Response.json({ error: "That doesn't look like a video file (mp4, mov, mkv, webm…)" }, { status: 400 });
  let options: unknown = {};
  try {
    options = JSON.parse(url.searchParams.get("options") ?? "{}");
  } catch {
    /* defaults */
  }
  const job = createJob({ ...parseOptions(options), file: `upload${path.extname(name).toLowerCase()}`, sourceName: name });
  const target = path.join(jobDir(job.id), `upload${path.extname(name).toLowerCase()}`);
  try {
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), fs.createWriteStream(target));
  } catch {
    removeJob(job.id);
    return Response.json({ error: "The upload was interrupted" }, { status: 400 });
  }
  enqueue(job.id);
  return Response.json({ id: job.id }, { status: 201 });
}
