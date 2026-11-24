import { getAsset } from "@/lib/assets";
import { videoAssets, videoByToken } from "@/lib/video/make";

// A video ad's own media (logo, photo, voiceover) for its public page. Only
// files that belong to that video; nothing else in the asset store.

type Params = { params: Promise<{ token: string; asset: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { token, asset } = await params;
  const video = await videoByToken(token);
  if (!video || !videoAssets(video).includes(asset)) return new Response("Not found", { status: 404 });
  const file = await getAsset(asset);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.mime,
      "content-length": String(file.bytes.length),
      "cache-control": "public, max-age=86400, immutable",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
    },
  });
}
