import { HttpError, route, type IdParams } from "@/lib/http";
import { addMotionAsset, removeMotionAsset } from "@/lib/motion/make";

// A motion ad's pictures and music. POST ?kind=logo|photo|music&name=: the
// file itself as the body (pictures are resized in the browser first, so
// they fit the 4 MB upload limit). DELETE ?asset=: remove one.

export const dynamic = "force-dynamic";

const MAX = 4_400_000;

export const POST = route(async (req: Request, { params }: IdParams) => {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") ?? "";
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX) throw new HttpError(413, "That file is over 4 MB. Use a smaller one.");
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) throw new HttpError(400, "The file was empty");
  if (bytes.length > MAX) throw new HttpError(413, "That file is over 4 MB. Use a smaller one.");
  try {
    return Response.json(await addMotionAsset((await params).id, kind, bytes, mime, url.searchParams.get("name") ?? undefined));
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
});

export const DELETE = route(async (req: Request, { params }: IdParams) => {
  const asset = new URL(req.url).searchParams.get("asset") ?? "";
  if (!/^asset_[a-z0-9]+$/.test(asset)) throw new HttpError(400, "Which file?");
  try {
    return Response.json(await removeMotionAsset((await params).id, asset));
  } catch (err) {
    throw new HttpError(400, err instanceof Error ? err.message : String(err));
  }
});
