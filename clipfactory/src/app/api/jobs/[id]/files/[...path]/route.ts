import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { guard } from "@/server/guard";
import { insideJob } from "@/server/paths";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json",
  ".csv": "text/csv; charset=utf-8",
  ".edl": "text/plain; charset=utf-8",
  ".llc": "text/plain; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".ass": "text/plain; charset=utf-8",
  ".wav": "audio/wav",
};

/** Files inside a job folder, with byte ranges so videos can seek. ?download=1 saves instead of playing. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; path: string[] }> }) {
  const blocked = guard(req, "read");
  if (blocked) return blocked;
  const { id, path: parts } = await params;
  let file: string;
  try {
    file = insideJob(id, parts.map((p) => decodeURIComponent(p)).join("/"));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Not found", { status: 404 });
  const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
    "Last-Modified": stat.mtime.toUTCString(),
  };
  if (new URL(req.url).searchParams.get("download")) headers["Content-Disposition"] = `attachment; filename="${path.basename(file).replace(/"/g, "")}"`;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
    start = Math.max(0, start);
    end = Math.min(stat.size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${stat.size}`, "Content-Length": String(end - start + 1) } });
  }
  const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new Response(body, { headers: { ...headers, "Content-Length": String(stat.size) } });
}
