import { getAsset } from "@/lib/assets";
import type { IdParams } from "@/lib/http";

// Ad art and voiceovers Rainmaker made. Behind the sign-in like the rest of
// the app; downloads get a file name.

export async function GET(req: Request, { params }: IdParams) {
  const asset = await getAsset((await params).id);
  if (!asset) return new Response("Not found", { status: 404 });
  const ext = asset.mime.includes("png") ? "png" : asset.mime.includes("webp") ? "webp" : asset.mime.includes("jpeg") ? "jpg" : asset.mime.includes("mpeg") ? "mp3" : "bin";
  const download = new URL(req.url).searchParams.get("download");
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "content-type": asset.mime,
      "content-length": String(asset.bytes.length),
      "cache-control": "private, max-age=86400, immutable",
      ...(download ? { "content-disposition": `attachment; filename="${download.replace(/[^a-z0-9._-]/gi, "-").slice(0, 80) || asset.id}.${ext}"` } : {}),
    },
  });
}
