import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { Context } from "hono";

// Static files with byte ranges (iPhones won't play video without them),
// ETags and safe path handling.

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

export function mimeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Resolve `rel` inside `root`, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string | undefined {
  const target = path.resolve(root, `.${path.sep}${decodeURIComponent(rel).replace(/\\/g, "/")}`);
  return target === root || target.startsWith(root + path.sep) ? target : undefined;
}

export async function sendFile(c: Context, file: string, opts: { cache?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  let st: fs.Stats;
  try {
    st = await fs.promises.stat(file);
  } catch {
    return c.text("Not found", 404);
  }
  if (!st.isFile()) return c.text("Not found", 404);
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const base: Record<string, string> = {
    "content-type": mimeOf(file),
    "accept-ranges": "bytes",
    etag,
    "last-modified": st.mtime.toUTCString(),
    "cache-control": opts.cache ?? "public, max-age=300",
    ...opts.headers,
  };
  if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers: base });
  const range = c.req.header("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    let start = m?.[1] ? Number(m[1]) : NaN;
    let end = m?.[2] ? Number(m[2]) : st.size - 1;
    if (m && !m[1] && m[2]) {
      start = Math.max(0, st.size - Number(m[2]));
      end = st.size - 1;
    }
    if (!m || !Number.isFinite(start) || start > end || start >= st.size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${st.size}` } });
    end = Math.min(end, st.size - 1);
    const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream;
    return new Response(body, { status: 206, headers: { ...base, "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": String(end - start + 1) } });
  }
  if (c.req.method === "HEAD") return new Response(null, { status: 200, headers: { ...base, "content-length": String(st.size) } });
  const body = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers: { ...base, "content-length": String(st.size) } });
}
